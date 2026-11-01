// supabase/functions/plu-reglement-v1/index.ts
// =============================================================
// Mimmoza — Règlement écrit de PLU : récupération au Géoportail de l'urbanisme,
// extraction du texte page par page (en cache), lecture ciblée de la zone.
// -----------------------------------------------------------------------------
// Appel INTERNE uniquement (copilot-chat, mission conception) : clé de service
// exigée (SUPABASE_SECRET_KEYS, repli legacy service_role). verify_jwt = false
// dans config.toml : c'est ce code qui vérifie (même règle que copilot-chat).
//
// Actions (POST JSON) :
//   { action: 'gpu', latitude, longitude, zone?, fichier?, pages?, max_caracteres? }
//     (V1.8 : on ne choisit PAS seul quoi lire. Plusieurs pièces de règlement →
//      'choix_requis' avec la liste, AVANT tout téléchargement ; chapitre de zone
//      trop long → 'selection_trop_longue' avec les articles et leurs pages ;
//      zone inconnue ou introuvable → 'zone_non_reperee' avec les chapitres.
//      `fichier` et `pages` portent la réponse de l'utilisateur.)
//     1. API Carto GPU au point : document applicable (id, idurba, type) + zone ;
//     2. API GPU /document/<id>/details : pièces écrites → fichier « règlement » ;
//     3. cache : PDF téléchargé une fois dans le bucket plu-reglements, texte
//        extrait PAR LOTS dans documents_pdf_pages (clé = id du document GPU,
//        versionné : une nouvelle archive = un nouvel id) ;
//     4. extraction terminée → sélection des pages de la zone (dispositions
//        générales + chapitre de la zone + lexique) et texte de ces pages.
//     Réponses : { statut: 'pret' | 'en_cours' | 'choix_requis' | 'zone_non_reperee' | 'selection_trop_longue'
//                  | 'zonage_seul' | 'aucun_document' | 'erreur', … }
//   { action: 'extraire', bucket, chemin }
//     Texte page par page d'un PDF DÉJÀ dans le Storage (pièce jointe ou
//     règlement déposé), quand le navigateur n'a pas pu l'extraire.
//     Réponses : { statut: 'pret', pages: string[] } | { statut: 'en_cours', … } | { statut: 'erreur', … }
//
// ⚠️ Limites Supabase (docs « Edge Functions limits », 01/11/2026) : 2 s de CPU par
// requête, 256 Mo de mémoire, 150 s (gratuit) / 400 s (payant) de durée. Chaque
// appel extrait donc au plus ~LOT_BUDGET_MS de pages ; l'appelant rappelle tant
// que le statut est 'en_cours' (copilot-chat le fait dans son budget de temps).
// -----------------------------------------------------------------------------

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { clesServiceRole, estCleServiceRole } from '../copilot-chat/agent/interne.ts';
import { extraireLot } from '../_shared/documents/extractionPdf.ts';
import {
  assemblerTexte, estimerTokensTexte, listeArticles, plagesLisibles, resumeChapitres, selectionnerPages, semblerScanne,
  titresArticles,
} from '../_shared/documents/lectureCiblee.ts';
import {
  choisirDocumentPartition, choisirFichiersReglement, cheminCacheGpu, decisionFichier, cleCacheGpu, cleCacheStockage, libelleSource,
  lireDetailsDocument, lireDocumentsAuPoint, lireZonesAuPoint, urlApiCarto, urlDetailsDocument, urlDocumentsPartition,
  type ZoneAuPoint,
} from '../_shared/documents/gpuReglement.ts';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};

const BUCKET_CACHE = 'plu-reglements';
/** Buckets dont l'action 'extraire' peut lire un fichier. */
const BUCKETS_EXTRACTION = new Set(['copilot-pieces-jointes', 'agent-conception']);
/** Taille max d'un règlement téléchargé au GPU (au-delà : on ne le charge pas en mémoire). */
const MAX_OCTETS_REGLEMENT = 50 * 1024 * 1024;   // mémoire : 256 Mo par isolate
const MAX_OCTETS_STOCKAGE = 50 * 1024 * 1024;
/** Temps d'extraction par appel (mur, donc ≥ CPU) : marge sous les 2 s de CPU. */
const LOT_BUDGET_MS = Number(Deno.env.get('PLU_REGLEMENT_LOT_MS')) || 900;
const LOT_MAX_PAGES = 120;
const TIMEOUT_API_MS = 9000;
const TIMEOUT_TELECHARGEMENT_MS = 45_000;
/** Budget de caractères du texte rendu (≈ 40 000 tokens). */
const MAX_CARACTERES_DEFAUT = 120_000;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

let _admin: SupabaseClient | null = null;
function admin(): SupabaseClient {
  if (_admin) return _admin;
  const url = Deno.env.get('SUPABASE_URL');
  const cle = clesServiceRole()[0];
  if (!url || !cle) throw new Error('configuration Supabase incomplète');
  _admin = createClient(url, cle, { auth: { persistSession: false, autoRefreshToken: false } });
  return _admin;
}

async function getJson(url: string): Promise<unknown | null> {
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_API_MS) });
    if (!r.ok) { console.warn('[plu-reglement] HTTP', r.status, url.split('?')[0]); return null; }
    return await r.json();
  } catch (e) {
    console.warn('[plu-reglement] échec', url.split('?')[0], errMsg(e));
    return null;
  }
}

// ── Cache : ligne + pages ────────────────────────────────────────────────────

interface LigneCache {
  id: string; cle: string; bucket: string; chemin: string; taille_octets: number | null;
  nb_pages: number | null; pages_extraites: number; statut: string; meta: Record<string, unknown>;
}

async function lireCache(cle: string): Promise<LigneCache | null> {
  const { data, error } = await admin().from('documents_pdf_cache')
    .select('id, cle, bucket, chemin, taille_octets, nb_pages, pages_extraites, statut, meta').eq('cle', cle).maybeSingle();
  if (error) throw new Error(`lecture du cache : ${error.message}`);
  return data as LigneCache | null;
}

async function creerCache(l: Omit<LigneCache, 'id' | 'pages_extraites' | 'statut' | 'nb_pages'> & { source: 'gpu' | 'stockage' }): Promise<LigneCache> {
  const { data, error } = await admin().from('documents_pdf_cache')
    .upsert({ ...l, statut: 'a_extraire' }, { onConflict: 'cle', ignoreDuplicates: true })
    .select('id, cle, bucket, chemin, taille_octets, nb_pages, pages_extraites, statut, meta').maybeSingle();
  if (error) throw new Error(`création du cache : ${error.message}`);
  return (data as LigneCache | null) ?? (await lireCache(l.cle))!;
}

async function telechargerStockage(bucket: string, chemin: string, max: number): Promise<Uint8Array> {
  const { data, error } = await admin().storage.from(bucket).download(chemin);
  if (error || !data) throw new Error(`fichier introuvable dans ${bucket}`);
  if (data.size > max) throw new Error(`fichier trop volumineux (${Math.round(data.size / 1048576)} Mo)`);
  return new Uint8Array(await data.arrayBuffer());
}

/**
 * Extrait le lot suivant et l'enregistre. Idempotent (upsert par page) : deux
 * appels concurrents sur le même document ne dupliquent rien.
 */
async function avancerExtraction(c: LigneCache, octets?: Uint8Array): Promise<LigneCache> {
  if (c.statut === 'termine' || c.statut === 'echec') return c;
  const pdf = octets ?? await telechargerStockage(c.bucket, c.chemin, MAX_OCTETS_REGLEMENT);
  let lot;
  try {
    // Le PDF n'est plus utilisé après l'extraction (déjà mis en cache) : pas de copie.
    lot = await extraireLot(pdf, c.pages_extraites + 1, { budgetMs: LOT_BUDGET_MS, maxPages: LOT_MAX_PAGES, copier: false });
  } catch (e) {
    // PDF chiffré, corrompu ou non standard : échec définitif, dit tel quel.
    await admin().from('documents_pdf_cache').update({ statut: 'echec', erreur: errMsg(e).slice(0, 900), updated_at: new Date().toISOString() }).eq('id', c.id);
    return { ...c, statut: 'echec' };
  }
  if (lot.pages.length) {
    const { error } = await admin().from('documents_pdf_pages').upsert(
      lot.pages.map((p) => ({ cache_id: c.id, page: p.n, texte: p.texte.slice(0, 60_000) })),
      { onConflict: 'cache_id,page' },
    );
    if (error) throw new Error(`enregistrement des pages : ${error.message}`);
  }
  const maj = {
    nb_pages: lot.nbPages,
    pages_extraites: lot.prochaine - 1,
    statut: lot.termine ? 'termine' : 'en_cours',
    updated_at: new Date().toISOString(),
  };
  await admin().from('documents_pdf_cache').update(maj).eq('id', c.id);
  return { ...c, ...maj };
}

async function lirePages(c: LigneCache): Promise<string[]> {
  const pages: string[] = new Array(c.nb_pages ?? 0).fill('');
  // Par tranches de 500 lignes (limite PostgREST par défaut : 1 000).
  for (let debut = 1; debut <= (c.nb_pages ?? 0); debut += 500) {
    const { data, error } = await admin().from('documents_pdf_pages').select('page, texte')
      .eq('cache_id', c.id).gte('page', debut).lt('page', debut + 500).order('page');
    if (error) throw new Error(`lecture des pages : ${error.message}`);
    for (const r of (data ?? []) as Array<{ page: number; texte: string }>) pages[r.page - 1] = r.texte;
  }
  return pages;
}

// ── Action « gpu » ───────────────────────────────────────────────────────────

async function actionGpu(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const lat = Number(body.latitude), lon = Number(body.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return { statut: 'erreur', message: 'Coordonnées (latitude, longitude) requises : le document applicable se lit au point.' };
  }
  const maxCar = Math.min(300_000, Math.max(10_000, Number(body.max_caracteres) || MAX_CARACTERES_DEFAUT));

  const [fcDoc, fcZone] = await Promise.all([getJson(urlApiCarto('document', lon, lat)), getJson(urlApiCarto('zone-urba', lon, lat))]);
  if (fcDoc === null && fcZone === null) {
    return { statut: 'erreur', message: "API Carto (Géoportail de l'urbanisme) injoignable : règlement non récupéré." };
  }
  const zones = lireZonesAuPoint(fcZone);
  const zone: ZoneAuPoint | null = zones[0] ?? null;
  const zoneDemandee = typeof body.zone === 'string' && body.zone.trim() ? body.zone.trim() : null;
  const codeZone = zoneDemandee ?? zone?.zone ?? null;
  const docs = lireDocumentsAuPoint(fcDoc);
  let docId: string | null = docs[0]?.id ?? null;
  const partition = docs[0]?.partition ?? zone?.partition ?? null;
  if (!docId && partition) docId = choisirDocumentPartition(await getJson(urlDocumentsPartition(partition)));
  const base = {
    zone: codeZone, zone_libelle_long: zone?.libelle_long ?? null, type_zone: zone?.type_zone ?? null,
    document: {
      gpu_id: docId, partition, idurba: docs[0]?.idurba ?? zone?.idurba ?? null, du_type: docs[0]?.du_type ?? null,
      territoire: docs[0]?.territoire ?? null, date_approbation: zone?.date_approbation ?? null,
    },
  };
  if (!docId) {
    return { ...base, statut: 'aucun_document', message: "Aucun document d'urbanisme publié au Géoportail de l'urbanisme sur ce point (commune au RNU, non numérisée, ou hors couverture)." };
  }

  const details = lireDetailsDocument(await getJson(urlDetailsDocument(docId)));
  if (details.protege) {
    return { ...base, statut: 'zonage_seul', message: 'Document protégé au Géoportail de l\'urbanisme : pièces écrites non téléchargeables.' };
  }
  const fichiers = choisirFichiersReglement(details, zone);
  if (!fichiers.length) {
    return { ...base, statut: 'zonage_seul', message: 'Aucune pièce « règlement écrit » identifiable parmi les fichiers publiés de ce document.' };
  }
  // V1.8 : plusieurs pièces → c'est l'UTILISATEUR qui choisit (rien n'est téléchargé avant).
  const decision = decisionFichier(fichiers, typeof body.fichier === 'string' ? body.fichier : null);
  if (decision.action === 'choisir') {
    return {
      ...base, statut: 'choix_requis', choix_pieces: decision.choix,
      message: (decision.demande ? `Aucune pièce ne correspond à « ${decision.demande} ». ` : '') +
        `Le règlement de ce document est publié en ${decision.choix.length} pièces : ` +
        decision.choix.map((c) => `${c.nom} (${c.raison})`).join(' ; ') + '. Laquelle lire ?',
    };
  }
  const f = decision.fichier;
  const cle = cleCacheGpu(docId, f.nom);
  let c = await lireCache(cle);
  let octets: Uint8Array | undefined;
  if (!c) {
    const r = await fetch(f.url, { signal: AbortSignal.timeout(TIMEOUT_TELECHARGEMENT_MS) }).catch((e) => { throw new Error(`téléchargement du règlement : ${errMsg(e)}`); });
    if (!r.ok) return { ...base, statut: 'zonage_seul', message: `Règlement publié mais non téléchargeable (HTTP ${r.status}).` };
    const annonce = Number(r.headers.get('content-length'));
    if (Number.isFinite(annonce) && annonce > MAX_OCTETS_REGLEMENT) {
      return { ...base, statut: 'zonage_seul', message: `Règlement trop volumineux pour une lecture automatique (${Math.round(annonce / 1048576)} Mo).` };
    }
    octets = new Uint8Array(await r.arrayBuffer());
    if (octets.length > MAX_OCTETS_REGLEMENT) return { ...base, statut: 'zonage_seul', message: 'Règlement trop volumineux pour une lecture automatique.' };
    const chemin = cheminCacheGpu(docId, f.nom);
    const up = await admin().storage.from(BUCKET_CACHE).upload(chemin, octets, { contentType: 'application/pdf', upsert: true });
    if (up.error) throw new Error(`mise en cache du règlement : ${up.error.message}`);
    c = await creerCache({
      cle, source: 'gpu', bucket: BUCKET_CACHE, chemin, taille_octets: octets.length,
      meta: { ...base.document, fichier: f.nom, url_source: f.url, raison_choix: f.raison, autres_pieces: fichiers.slice(1, 6).map((x) => x.nom), mis_en_ligne: details.date_mise_en_ligne },
    });
  }
  c = await avancerExtraction(c, octets);
  const meta = { ...(c.meta ?? {}), ...base.document } as Record<string, unknown>;
  const source = libelleSource({
    du_type: (meta.du_type as string) ?? null, territoire: (meta.territoire as string) ?? null,
    idurba: (meta.idurba as string) ?? null, date_approbation: (meta.date_approbation as string) ?? null, fichier: f.nom,
  });
  if (c.statut === 'echec') {
    return { ...base, statut: 'zonage_seul', source, message: 'Le PDF du règlement n\'a pas pu être lu (fichier protégé ou non standard).' };
  }
  if (c.statut !== 'termine') {
    return { ...base, statut: 'en_cours', source, pages_extraites: c.pages_extraites, nb_pages: c.nb_pages };
  }

  const pages = await lirePages(c);
  if (semblerScanne(pages)) {
    return { ...base, statut: 'zonage_seul', source, nb_pages: c.nb_pages, message: 'Règlement publié sous forme scannée (aucun texte extractible) : lecture automatique impossible.' };
  }
  const sel = selectionnerPages(pages, codeZone, maxCar);
  const commun = {
    ...base, source, nb_pages: pages.length, fichier: f.nom, url_source: f.url,
    autres_pieces_reglement: fichiers.filter((x) => x.url !== f.url).slice(0, 6).map((x) => x.nom),
    chapitres: sel.chapitres.slice(0, 60),
  };
  // Pages choisies par l'utilisateur : lues telles quelles (bornées au budget).
  const demandees = Array.isArray(body.pages)
    ? (body.pages as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= pages.length).slice(0, 300)
    : [];
  if (demandees.length) {
    const texte = assemblerTexte(pages, demandees, maxCar);
    return {
      ...commun, statut: 'pret', zone_lue: codeZone, pages_retenues: demandees, pages_zone: plagesLisibles(demandees),
      pages_dispositions_generales: '', pages_lexique: '', pages_choisies_par_utilisateur: true,
      tronque: texte.includes('budget de lecture atteint'), tokens_estimes: estimerTokensTexte(texte.length), texte,
    };
  }
  if (sel.statut === 'zone_trouvee' && sel.tronque) {
    const ch = sel.chapitres.find((c) => c.zone === sel.zoneRetenue)!;
    const articles = titresArticles(pages, ch.debut, ch.fin);
    return {
      ...commun, statut: 'selection_trop_longue', zone_lue: sel.zoneRetenue,
      pages_chapitre: `${ch.debut}-${ch.fin}`, articles,
      message: `Le chapitre de la zone ${sel.zoneRetenue} (p. ${ch.debut}-${ch.fin}) est trop long pour être lu en une fois. ` +
        (articles.length ? `Articles repérés : ${listeArticles(articles)}. ` : '') + 'Quels articles ou quelles pages lire ?',
    };
  }
  if (sel.statut !== 'zone_trouvee') {
    return {
      ...commun, statut: 'zone_non_reperee',
      message: `${codeZone ? `Chapitre de la zone ${codeZone} non repéré` : 'Zone inconnue'} dans ce fichier. ${resumeChapitres(sel.chapitres)} ` +
        'Quelle zone (ou quelles pages) lire ?',
    };
  }
  const texte = assemblerTexte(pages, sel.pages, maxCar);
  return {
    ...commun, statut: 'pret',
    zone_lue: sel.zoneRetenue,
    pages_retenues: sel.pages,
    pages_zone: plagesLisibles(sel.pagesZone),
    pages_dispositions_generales: plagesLisibles(sel.pagesDispositionsGenerales),
    pages_lexique: plagesLisibles(sel.pagesLexique),
    tronque: false,
    tokens_estimes: estimerTokensTexte(texte.length),
    texte,
  };
}

// ── Action « extraire » ──────────────────────────────────────────────────────

async function actionExtraire(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const bucket = typeof body.bucket === 'string' ? body.bucket : '';
  const chemin = typeof body.chemin === 'string' ? body.chemin : '';
  if (!BUCKETS_EXTRACTION.has(bucket) || !chemin || chemin.includes('..') || !/\.pdf$/i.test(chemin)) {
    return { statut: 'erreur', message: 'bucket ou chemin refusé' };
  }
  // Taille lue dans les MÉTADONNÉES avant tout téléchargement.
  const i = chemin.lastIndexOf('/');
  const liste = await admin().storage.from(bucket).list(chemin.slice(0, i), { search: chemin.slice(i + 1), limit: 5 });
  const meta = ((liste.data ?? []) as Array<{ name: string; metadata?: { size?: number } }>).find((f) => f.name === chemin.slice(i + 1));
  if (liste.error || !meta) return { statut: 'erreur', message: 'fichier introuvable' };
  const taille = Number(meta.metadata?.size) || null;
  if (taille && taille > MAX_OCTETS_STOCKAGE) return { statut: 'erreur', message: 'fichier trop volumineux' };
  const cle = cleCacheStockage(bucket, chemin, taille ?? 0);
  let c = await lireCache(cle) ?? await creerCache({ cle, source: 'stockage', bucket, chemin, taille_octets: taille, meta: {} });
  c = await avancerExtraction(c);
  if (c.statut === 'echec') return { statut: 'erreur', message: 'PDF illisible (protégé ou non standard)' };
  if (c.statut !== 'termine') return { statut: 'en_cours', pages_extraites: c.pages_extraites, nb_pages: c.nb_pages };
  return { statut: 'pret', nb_pages: c.nb_pages, pages: await lirePages(c) };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ statut: 'erreur', message: 'POST uniquement' }, 405);
  if (!estCleServiceRole(req.headers.get('Authorization'), clesServiceRole())) {
    return json({ statut: 'erreur', message: 'appel interne uniquement' }, 401);
  }
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ statut: 'erreur', message: 'corps JSON invalide' }, 400); }
  const debut = Date.now();
  try {
    const r = body.action === 'extraire' ? await actionExtraire(body)
      : body.action === 'gpu' ? await actionGpu(body)
      : { statut: 'erreur', message: "action inconnue (attendu : 'gpu' ou 'extraire')" };
    return json({ ...r, duree_ms: Date.now() - debut });
  } catch (e) {
    console.error('[plu-reglement]', errMsg(e));
    return json({ statut: 'erreur', message: errMsg(e).slice(0, 300), duree_ms: Date.now() - debut });
  }
});
