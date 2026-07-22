// supabase/functions/etude-parcelle-v1/index.ts
// =============================================================
// Mimmoza — ÉTUDE COMPLÈTE DE PARCELLE (rapport de synthèse)
//
// v3 — MARCHÉ ET NUISANCES. Trois évolutions par rapport à v2 :
//   1. DVF (dvf-comparables-v1) — le prix de sortie manquait, or c'est la
//      donnée qui rend un bilan chiffrable. Contrat standard MAIS transactions
//      dans un champ `comps` séparé → adaptateur dédié qui les replie dans
//      stats (échantillon borné à 8).
//   2. BRUIT (bruit-classement-v1) — classement sonore réglementaire des
//      voies. Source PARTIELLE assumée : dégrade proprement en no_data sur les
//      communes n'ayant pas numérisé la couche au GPU.
//   3. GARDE DE PRÉCISION — les sources `needs: 'geo'` exigent désormais
//      precision === 'parcelle'. Avant, un repli centroïde commune renseignait
//      lat/lon et les servitudes du centre-bourg étaient présentées comme
//      parcellaires : faux positif dangereux.
//
// v2 — DENSITÉ : surface cadastrale (contenance), risques Géorisques nommés,
// timeout par source.
//
// Rôle : à partir d'UN SEUL identifiant (IDU cadastral, coordonnées ou
// commune), interroger EN PARALLÈLE toutes les sources Mimmoza déployées et
// renvoyer un bundle structuré prêt à être rédigé par le LLM.
//
// POURQUOI UNE FONCTION PLUTÔT QU'UNE BOUCLE D'OUTILS :
//   · 1 appel LLM au lieu de 8 → ~2 s au lieu de ~30 s, coût jetons divisé ;
//   · MAX_TOOL_ITERATIONS.quick = 2 rend l'enchaînement impossible en mode
//     quick (le mode de la majorité des comptes) ;
//   · déterministe → testable dans le harnais de non-régression.
//
// AUTONOME (édité dans le Dashboard, aucun import _shared) :
//   · résout le code INSEE depuis l'IDU (5 premiers caractères) ;
//   · résout le CENTROÏDE + la CONTENANCE via le cadastre API Carto
//     (⚠️ numero PADDÉ sur 4 caractères, sinon apicarto renvoie HTTP 400) ;
//   · repli centroïde commune (geo.api) → précision dégradée SIGNALÉE.
//
// HORS PORTÉE (limite structurelle, ne pas tenter de l'ajouter ici) :
//   · le PLU est extrait par le parser côté FRONT et vit dans ctx.plu du
//     contexte copilot. Une Edge Function n'y a aucun accès. L'étude signale
//     son absence, copilot-chat le traite via get_parcel_plu.
//
// DÉGRADATION : chaque source est indépendante (Promise.allSettled). Une
// source morte n'empêche jamais le rapport ; elle apparaît en 'ko' avec son
// motif. Aucune valeur n'est inventée, aucun verdict n'est calculé ici.
//
// ⚠️ BUDGET TEMPS : risques ~20 s et DVF ~18 s s'exécutent en parallèle, donc
// l'étude reste bornée par la plus lente (~20 s). C'est proche du
// INTERNAL_FN_TIMEOUT_MS de copilot-chat (25 s par défaut) : passer le secret
// COPILOT_FN_TIMEOUT_MS à 30000.
//
// Contrat : { status, summary, stats, items } — toujours HTTP 200.
// =============================================================

const CADASTRE_URL = 'https://apicarto.ign.fr/api/cadastre/parcelle';
const GEO_API = 'https://geo.api.gouv.fr/communes';

const DEFAULT_TIMEOUT_MS = 14000;

interface Resolved {
  idu?: string;
  insee?: string;
  commune?: string;
  lat?: number;
  lon?: number;
  surface_m2?: number;
  precision: 'parcelle' | 'centre_commune' | 'aucune';
}

/** Réponse normalisée d'une source, quel que soit son contrat d'origine. */
interface Adapted {
  status: 'ok' | 'no_data' | 'ko';
  summary: string | null;
  stats: unknown;
  motif?: string;
}

// ── Sources mobilisées ───────────────────────────────────────
// `needs` : 'commune' = code INSEE suffit ; 'geo' = exige une localisation
//           RÉELLEMENT parcellaire (precision === 'parcelle').
// `adapt` : seulement pour les sources au contrat non standard.
// Ajouter une source = UNE entrée ici.
interface SourceDef {
  cle: string;
  env: string;                  // secret portant le slug de la fonction
  needs: 'commune' | 'geo';
  label: string;
  timeout?: number;
  body: (r: Resolved) => Record<string, unknown>;
  adapt?: (j: any) => Adapted;
}

// ── Adaptateur risk-study ────────────────────────────────────
// risk-study ne suit pas le contrat { status, summary, stats } : il renvoie
// { meta, scores, data, categories, insights }. ⚠️ Ses scores sont des scores
// de SÉCURITÉ (100 = sûr). On produit ici un résumé en aléas NOMMÉS, seule
// façon de sortir du « aléa inconnu » qui rendait le verdict flou.
function adaptRisques(j: any): Adapted {
  if (!j || typeof j !== 'object' || j.success === false) {
    return { status: 'ko', summary: null, stats: null, motif: j?.error ?? 'réponse risk-study vide ou en erreur' };
  }
  const d = j.data ?? {};
  const s = j.scores ?? {};
  const faits: string[] = [];

  if (d.inondation?.zone_inondable === true) faits.push(d.inondation?.ppri ? 'zone inondable avec PPRI' : 'zone inondable');
  if (d.argiles?.niveau_alea) faits.push(`retrait-gonflement des argiles : aléa ${d.argiles.niveau_alea}`);
  if (d.seisme?.zone) faits.push(`sismicité zone ${d.seisme.zone}${d.seisme.libelle ? ` (${d.seisme.libelle})` : ''}`);
  if (d.radon?.classe_potentiel) faits.push(`radon classe ${d.radon.classe_potentiel}`);
  if (d.cavites?.count) faits.push(`${d.cavites.count} cavité(s) souterraine(s) recensée(s)`);
  if (d.mouvements_terrain?.count) faits.push(`${d.mouvements_terrain.count} mouvement(s) de terrain recensé(s)`);
  if (d.icpe?.seveso_haut_count) faits.push(`${d.icpe.seveso_haut_count} site(s) SEVESO seuil haut`);
  else if (d.icpe?.count) faits.push(`${d.icpe.count} ICPE`);
  if (d.sis?.count) faits.push(`${d.sis.count} site(s) pollué(s) (SIS)`);
  if (d.feux_foret?.zone_risque === true) faits.push(`zone à risque feux de forêt${d.feux_foret?.obligation_debroussaillement ? ' (débroussaillement obligatoire)' : ''}`);
  if (d.gaspar?.catnat_count) faits.push(`${d.gaspar.catnat_count} arrêté(s) de catastrophe naturelle`);

  const summary = faits.length
    ? `Risques identifiés : ${faits.join(' · ')}. Score de sécurité global ${s.global ?? 'n.c.'}/100 (100 = zone sûre).`
    : `Aucun aléa majeur remonté par Géorisques. Score de sécurité global ${s.global ?? 'n.c.'}/100 (100 = zone sûre).`;

  return {
    status: 'ok',
    summary,
    stats: {
      convention_score: 'Scores de SÉCURITÉ : 100 = zone très sûre, 0 = risque maximal. Un score élevé est BON.',
      scores_securite: {
        global: s.global ?? null, naturels: s.naturels ?? null,
        technologiques: s.technologiques ?? null, pollution: s.pollution ?? null,
        geotechniques: s.geotechniques ?? null,
      },
      inondation: { zone_inondable: d.inondation?.zone_inondable ?? null, ppri: d.inondation?.ppri ?? null },
      argiles_alea: d.argiles?.niveau_alea ?? null,
      seisme_zone: d.seisme?.zone ?? null,
      radon_classe: d.radon?.classe_potentiel ?? null,
      cavites_count: d.cavites?.count ?? null,
      mouvements_terrain_count: d.mouvements_terrain?.count ?? null,
      icpe_count: d.icpe?.count ?? null,
      seveso_haut_count: d.icpe?.seveso_haut_count ?? null,
      sis_count: d.sis?.count ?? null,
      feux_foret: d.feux_foret?.zone_risque ?? null,
      catnat_count: d.gaspar?.catnat_count ?? null,
      ppr_count: d.gaspar?.ppr_count ?? null,
      constats: Array.isArray(j.insights) ? j.insights.slice(0, 8).map((i: any) => i?.message).filter(Boolean) : [],
      source: 'Géorisques via risk-study',
    },
  };
}

// ── Adaptateur DVF ───────────────────────────────────────────
// dvf-comparables-v1 suit le contrat standard MAIS sort les transactions dans
// un champ `comps` séparé, que le handler générique jetterait. On les replie
// dans stats (échantillon borné) : le prix de sortie est la donnée qui rend un
// bilan chiffrable. `no_localization` reste traité en 'ko' par le générique.
function adaptDvf(j: any): Adapted {
  if (!j || typeof j !== 'object') {
    return { status: 'ko', summary: null, stats: null, motif: 'réponse DVF illisible' };
  }
  const st = String(j.status ?? '');
  if (st !== 'ok' && st !== 'no_data') {
    return { status: 'ko', summary: null, stats: null, motif: j?.summary ?? st ?? 'statut inconnu' };
  }
  const comps = Array.isArray(j.comps) ? j.comps : [];
  const vide = st === 'no_data' || comps.length === 0;
  return {
    status: vide ? 'no_data' : 'ok',
    summary: typeof j.summary === 'string' ? j.summary : null,
    stats: {
      ...(j.stats ?? {}),
      nb_comparables: comps.length,
      echantillon: comps.slice(0, 8).map((c: any) => ({
        date: c?.date ?? null, prix_m2: c?.price_m2 ?? null,
        surface_m2: c?.surface_m2 ?? null, type_local: c?.type_local ?? null,
        distance_m: c?.distance_m ?? null,
      })),
      source: 'DVF (DGFiP) via dvf-comparables-v1',
    },
  };
}

const SOURCES: SourceDef[] = [
  { cle: 'loyers', env: 'COPILOT_FN_LOYERS', needs: 'commune', label: 'Loyers de référence',
    body: (r) => ({ code_insee: r.insee }) },
  { cle: 'zonage', env: 'COPILOT_FN_ZONAGE', needs: 'commune', label: 'Zonage ABC',
    body: (r) => ({ code_insee: r.insee }) },
  { cle: 'taxes', env: 'COPILOT_FN_TAXES', needs: 'commune', label: 'Fiscalité locale',
    body: (r) => ({ code_insee: r.insee }) },
  { cle: 'assainissement', env: 'COPILOT_FN_ASSAINISSEMENT', needs: 'commune', label: 'Assainissement',
    body: (r) => ({ code_insee: r.insee }) },
  { cle: 'altimetrie', env: 'COPILOT_FN_ALTIMETRIE', needs: 'commune', label: 'Altitude et pente',
    body: (r) => ({ lat: r.lat, lon: r.lon, cadastral_ref: r.idu, code_insee: r.insee }) },
  { cle: 'servitudes', env: 'COPILOT_FN_SERVITUDES', needs: 'geo', label: "Servitudes d'utilité publique",
    body: (r) => ({ lat: r.lat, lon: r.lon, cadastral_ref: r.idu }) },
  { cle: 'solaire', env: 'COPILOT_FN_SOLAIRE', needs: 'commune', label: 'Potentiel solaire',
    body: (r) => ({ lat: r.lat, lon: r.lon, code_insee: r.insee }) },
  { cle: 'contexte', env: 'COPILOT_FN_CONTEXTE', needs: 'commune', label: 'Contexte territorial (Wikipédia)',
    body: (r) => ({ code_insee: r.insee, commune: r.commune }) },
  // ── Risques : contrat non standard → adaptateur. Plus lent (multi-API).
  { cle: 'risques', env: 'COPILOT_FN_RISKS', needs: 'commune', label: 'Risques naturels et technologiques',
    timeout: 20000, adapt: adaptRisques,
    body: (r) => ({ lat: r.lat, lon: r.lon, commune_insee: r.insee }) },
  // ── DVF : prix de sortie. Contrat standard + champ comps → adaptateur.
  { cle: 'dvf', env: 'COPILOT_FN_DVF', needs: 'commune', label: 'Transactions comparables (DVF)',
    timeout: 18000, adapt: adaptDvf,
    body: (r) => ({ lat: r.lat, lon: r.lon, commune_insee: r.insee, radius_km: 2, horizon_months: 24 }) },
  // ── Bruit : classement sonore réglementaire. Donnée strictement parcellaire
  //    (GPU) → needs 'geo'. Source partielle assumée : dégrade en no_data sur
  //    les communes n'ayant pas numérisé la couche.
  { cle: 'bruit', env: 'COPILOT_FN_BRUIT', needs: 'geo', label: 'Classement sonore des voies',
    body: (r) => ({ lat: r.lat, lon: r.lon, cadastral_ref: r.idu }) },
  // ── Non intégrables ici : PLU (lu par le FRONT dans ctx.plu, hors de portée
  //    d'une Edge Function → traité par copilot-chat) ; PPR détaillé (dormant,
  //    exige un jeton Géorisques gratuit non créé).
];

// ── Helpers ──────────────────────────────────────────────────
function cors(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}
function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { ...cors(), 'Content-Type': 'application/json; charset=utf-8' } });
}
function normStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}
function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}
function readFirstJsonKey(raw: string | undefined | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string') return parsed;
    if (parsed && typeof parsed === 'object') {
      const first = Object.values(parsed).find((v) => typeof v === 'string');
      if (typeof first === 'string') return first;
    }
  } catch { return raw; }
  return null;
}
function serviceKey(): string {
  // ⚠️ JWT Signing Keys : SUPABASE_SECRET_KEYS en priorité (la legacy → 401).
  const k = readFirstJsonKey(Deno.env.get('SUPABASE_SECRET_KEYS'))
    ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    ?? Deno.env.get('SERVICE_ROLE_KEY');
  if (!k) throw new Error('Missing Supabase service role key env');
  return k;
}

// ── Résolution de la localisation ────────────────────────────
/** IDU 14 car. → { insee, section, numero }. numero PADDÉ (apicarto exige 4 car.). */
function parseIdu(idu: string): { insee: string; section: string; numero: string } | null {
  const s = idu.replace(/\s/g, '').toUpperCase();
  if (s.length < 14) return null;
  const insee = s.slice(0, 5);
  const section = s.slice(8, 10);
  const numero = s.slice(10, 14).padStart(4, '0');
  if (!/^(\d{5}|2[AB]\d{3})$/.test(insee)) return null;
  if (!/^[0-9A-Z]{2}$/.test(section) || !/^\d{4}$/.test(numero)) return null;
  return { insee, section, numero };
}
function centroidOf(geom: any): { lat: number; lon: number } | null {
  let ring: number[][] | null = null;
  if (geom?.type === 'Polygon') ring = geom.coordinates?.[0];
  else if (geom?.type === 'MultiPolygon') ring = geom.coordinates?.[0]?.[0];
  if (!Array.isArray(ring) || ring.length === 0) return null;
  let sx = 0, sy = 0, n = 0;
  for (const c of ring) if (Array.isArray(c) && c.length >= 2) { sx += c[0]; sy += c[1]; n++; }
  return n ? { lon: sx / n, lat: sy / n } : null;
}
/** Centroïde + CONTENANCE + nom de commune depuis l'IDU (une seule requête). */
async function parcelleFromIdu(idu: string): Promise<{ lat: number; lon: number; surface_m2?: number; commune?: string } | null> {
  const p = parseIdu(idu);
  if (!p) { console.error(`[etude] IDU illisible: ${idu}`); return null; }
  const url = `${CADASTRE_URL}?code_insee=${p.insee}&section=${encodeURIComponent(p.section)}&numero=${encodeURIComponent(p.numero)}`;
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) { console.error(`[etude] cadastre HTTP ${r.status} — URL: ${url}`); return null; }
    const fc = await r.json();
    const nb = Array.isArray(fc?.features) ? fc.features.length : 0;
    console.log(`[etude] cadastre insee=${p.insee} section=${p.section} numero=${p.numero} → ${nb} parcelle(s)`);
    if (!nb) return null;
    const f = fc.features[0];
    const c = centroidOf(f?.geometry);
    if (!c) return null;
    return {
      ...c,
      surface_m2: num(f?.properties?.contenance),   // ← la donnée qu'on jetait
      commune: f?.properties?.nom_com ?? undefined,
    };
  } catch (e) {
    console.error(`[etude] cadastre échec: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}
async function communeInfo(p: { insee?: string; commune?: string; zip?: string }): Promise<{ insee?: string; nom?: string; lat?: number; lon?: number }> {
  const query = p.insee ? `code=${encodeURIComponent(p.insee)}`
    : p.zip ? `codePostal=${encodeURIComponent(p.zip)}`
    : p.commune ? `nom=${encodeURIComponent(p.commune)}` : null;
  if (!query) return {};
  try {
    const r = await fetch(`${GEO_API}?${query}&fields=code,nom,centre&limit=1`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return {};
    const d = await r.json();
    const row = Array.isArray(d) ? d[0] : null;
    if (!row) return {};
    const c = row.centre?.coordinates;
    return {
      insee: row.code ? String(row.code) : undefined,
      nom: row.nom ?? undefined,
      lon: Array.isArray(c) ? c[0] : undefined,
      lat: Array.isArray(c) ? c[1] : undefined,
    };
  } catch { return {}; }
}

// ── Appel d'une source ───────────────────────────────────────
interface SourceResult {
  cle: string; label: string; status: 'ok' | 'no_data' | 'ko';
  summary: string | null; stats: unknown; motif?: string; duree_ms: number;
}
async function callSource(def: SourceDef, r: Resolved, baseUrl: string, key: string): Promise<SourceResult> {
  const t0 = Date.now();
  const slug = Deno.env.get(def.env);
  const base = { cle: def.cle, label: def.label, summary: null, stats: null };

  if (!slug) return { ...base, status: 'ko', motif: `non branché (${def.env} non défini)`, duree_ms: 0 };
  // ⚠️ GARDE DE PRÉCISION : lat/lon peuvent provenir du centroïde COMMUNE.
  // Interroger le GPU au centre-bourg renverrait des servitudes / secteurs de
  // bruit qui ne concernent PAS la parcelle : faux positif inacceptable.
  if (def.needs === 'geo' && (r.lat == null || r.lon == null || r.precision !== 'parcelle')) {
    return { ...base, status: 'ko', motif: 'exige une localisation à la parcelle (non résolue)', duree_ms: 0 };
  }
  if (def.needs === 'commune' && !r.insee && r.lat == null) {
    return { ...base, status: 'ko', motif: 'aucune commune identifiée', duree_ms: 0 };
  }

  try {
    const res = await fetch(`${baseUrl}/functions/v1/${slug}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify(def.body(r)),
      signal: AbortSignal.timeout(def.timeout ?? DEFAULT_TIMEOUT_MS),
    });
    const duree_ms = Date.now() - t0;
    if (!res.ok) {
      // Cas vécu : slug déployé ≠ valeur du secret → 404 silencieux.
      console.error(`[etude] ${def.cle} → HTTP ${res.status} (slug "${slug}")`);
      return { ...base, status: 'ko', motif: `HTTP ${res.status} sur "${slug}"`, duree_ms };
    }
    const j = await res.json();

    // Contrat non standard (risques, DVF…) → adaptateur dédié.
    if (def.adapt) {
      const a = def.adapt(j);
      return { cle: def.cle, label: def.label, status: a.status, summary: a.summary, stats: a.stats, motif: a.motif, duree_ms };
    }

    const st = String(j?.status ?? '');
    if (st === 'ok' || st === 'no_data') {
      return {
        cle: def.cle, label: def.label,
        status: st === 'ok' ? 'ok' : 'no_data',
        summary: typeof j.summary === 'string' ? j.summary : null,
        stats: j.stats ?? null,
        duree_ms,
      };
    }
    return { ...base, status: 'ko', motif: j?.summary ?? st ?? 'statut inconnu', duree_ms };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[etude] ${def.cle} échec: ${msg}`);
    const limite = def.timeout ?? DEFAULT_TIMEOUT_MS;
    return { ...base, status: 'ko', motif: msg.includes('timed out') ? `timeout (${limite}ms)` : msg, duree_ms: Date.now() - t0 };
  }
}

// ── Handler ──────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (req.method !== 'POST') return json({ status: 'error', summary: 'POST only', stats: null, items: [] }, 405);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* {} */ }

  const idu = normStr(body.cadastral_ref) ?? normStr(body.parcel_id);
  let lat = num(body.lat);
  let lon = num(body.lon) ?? num(body.lng);
  let insee = normStr(body.code_insee);
  let commune = normStr(body.commune);
  let surface_m2 = num(body.surface_m2);
  const zip = normStr(body.zip_code) ?? normStr(body.code_postal);
  let precision: Resolved['precision'] = 'aucune';

  // 1) INSEE dérivé de l'IDU (tout identifiant cadastral commence par lui).
  if (!insee && idu) {
    const m = /^(2[ab]\d{3}|\d{5})/i.exec(idu.replace(/\s/g, ''));
    if (m) insee = m[1].toUpperCase();
  }
  // 2) Cadastre : centroïde + contenance. Interrogé même si lat/lon fournis,
  //    car la SURFACE est une donnée de décision (emprise, prix au m²).
  if (idu) {
    const p = await parcelleFromIdu(idu);
    if (p) {
      if (lat == null || lon == null) { lat = p.lat; lon = p.lon; }
      surface_m2 = surface_m2 ?? p.surface_m2;
      commune = commune ?? p.commune;
      precision = 'parcelle';
    }
  }
  if (precision === 'aucune' && lat != null && lon != null) precision = 'parcelle';

  // 3) Repli commune (INSEE / nom / code postal) — précision dégradée.
  if (!insee || lat == null || lon == null) {
    const g = await communeInfo({ insee, commune, zip });
    insee = insee ?? g.insee;
    commune = commune ?? g.nom;
    if (lat == null || lon == null) {
      if (g.lat != null && g.lon != null) { lat = g.lat; lon = g.lon; precision = 'centre_commune'; }
    }
  }

  if (!insee && (lat == null || lon == null)) {
    return json({
      status: 'no_localization',
      summary: "Étude impossible : fournir un identifiant cadastral (IDU), des coordonnées ou une commune.",
      stats: null, items: [],
    }, 200);
  }

  const resolved: Resolved = { idu, insee, commune, lat, lon, surface_m2, precision };
  const baseUrl = Deno.env.get('SUPABASE_URL');
  if (!baseUrl) return json({ status: 'error', summary: 'Missing SUPABASE_URL env', stats: null, items: [] }, 200);

  let key: string;
  try { key = serviceKey(); }
  catch (e) { return json({ status: 'error', summary: String(e), stats: null, items: [] }, 200); }

  // ── Collecte PARALLÈLE : une source morte ne bloque jamais le rapport ──
  const t0 = Date.now();
  const settled = await Promise.allSettled(SOURCES.map((s) => callSource(s, resolved, baseUrl, key)));
  const items: SourceResult[] = settled.map((s, i) =>
    s.status === 'fulfilled'
      ? s.value
      : { cle: SOURCES[i].cle, label: SOURCES[i].label, status: 'ko', summary: null, stats: null, motif: 'exception interne', duree_ms: 0 },
  );
  const dureeTotale = Date.now() - t0;

  const ok = items.filter((i) => i.status === 'ok');
  const vides = items.filter((i) => i.status === 'no_data');
  const ko = items.filter((i) => i.status === 'ko');

  const avertissements: string[] = [];
  if (precision === 'centre_commune') {
    avertissements.push("Parcelle non localisée : les données géométriques (pente, solaire, risques) valent pour le centre de la commune et sont INDICATIVES. Les sources strictement parcellaires (servitudes, classement sonore) n'ont PAS été interrogées.");
  }
  if (surface_m2 == null) {
    avertissements.push("Surface cadastrale non résolue : tout raisonnement en emprise au sol ou en prix au m² de terrain est impossible.");
  }
  if (ko.length) {
    avertissements.push(`Sources indisponibles pour cette étude : ${ko.map((k) => k.label).join(', ')}. L'absence de donnée ne vaut pas absence de contrainte.`);
  }
  avertissements.push("Le règlement PLU n'est pas collecté par cette étude (il est extrait côté application, page Foncier) : aucune capacité constructive ne peut être déduite d'ici.");

  return json({
    status: ok.length > 0 ? 'ok' : (vides.length > 0 ? 'no_data' : 'error'),
    summary:
      `Étude de parcelle${commune ? ` — ${commune}` : ''}${idu ? ` (${idu})` : ''}` +
      `${surface_m2 != null ? `, ${surface_m2.toLocaleString('fr-FR')} m²` : ''} : ` +
      `${ok.length} source(s) exploitables, ${vides.length} sans donnée, ${ko.length} indisponible(s). ` +
      `Précision de localisation : ${precision}.`,
    stats: {
      parcelle: {
        idu: idu ?? null,
        code_insee: insee ?? null,
        commune: commune ?? null,
        surface_m2: surface_m2 ?? null,      // ← contenance cadastrale
        lat: lat ?? null,
        lon: lon ?? null,
      },
      precision,
      sources_ok: ok.map((i) => i.cle),
      sources_sans_donnee: vides.map((i) => i.cle),
      sources_indisponibles: ko.map((i) => ({ cle: i.cle, motif: i.motif })),
      duree_ms: dureeTotale,
      avertissements,
      note_methode: "Collecte brute multi-sources. Aucun verdict n'est calculé ici : la synthèse et les points de vigilance sont rédigés par MimmozIA à partir de ces données, sans extrapolation.",
    },
    items,
  }, 200);
});