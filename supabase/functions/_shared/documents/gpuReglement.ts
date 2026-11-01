// supabase/functions/_shared/documents/gpuReglement.ts
// =============================================================
// RÈGLEMENT ÉCRIT DU DOCUMENT D'URBANISME APPLICABLE, via le Géoportail de
// l'urbanisme — parsing PUR des réponses (testé sur fixtures) + URLs.
//
// Chaîne utilisée par plu-reglement-v1 :
//   1. API Carto, module GPU (IGN), au POINT de la parcelle :
//        GET https://apicarto.ign.fr/api/gpu/document?geom=<Point>
//          → id (identifiant du document = archive téléversée), partition
//            (DU_<INSEE|SIREN>), name (= idurba <INSEE|SIREN>_<typedoc>_<datappro>), du_type
//        GET https://apicarto.ign.fr/api/gpu/zone-urba?geom=<Point>
//          → libelle (zone), libelong, typezone, nomfic / urlfic (fichier du
//            règlement de la zone), datappro, datvalid, idurba, partition
//      (attributs : « Documentation utilisateur d'API Carto, module Urbanisme »,
//       apicarto.ign.fr/api/doc/pdf/docUser_moduleUrbanisme.pdf)
//   2. API du Géoportail de l'urbanisme :
//        GET https://www.geoportail-urbanisme.gouv.fr/api/document/<id>/details
//          → files (PDF publiés), writingMaterials (PDF → URL d'accès),
//            archiveUrl, protected (si vrai : files et writingMaterials vides)
//        GET https://www.geoportail-urbanisme.gouv.fr/api/document?partition=<partition>&status=document.production
//          → repli si l'id n'a pas été obtenu au point
//      (« Utilisation de l'API GPU », v1.1 mai 2021,
//       geoportail-urbanisme.gouv.fr/image/UtilisationAPI_GPU_1-0.pdf)
//
// ⚠️ Écrit d'après la documentation et des fixtures : ni l'API Carto ni l'API GPU
// n'étaient joignables depuis l'environnement de développement. Le parsing est
// donc TOLÉRANT (objet ou tableau, noms de champs alternatifs) et tout écart de
// forme aboutit à « aucun règlement trouvé », jamais à une valeur inventée.
// =============================================================

export const APICARTO_GPU = 'https://apicarto.ign.fr/api/gpu';
export const API_GPU = 'https://www.geoportail-urbanisme.gouv.fr/api';

const chaine = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function urlApiCarto(couche: 'document' | 'zone-urba' | 'municipality', lon: number, lat: number): string {
  const geom = encodeURIComponent(JSON.stringify({ type: 'Point', coordinates: [lon, lat] }));
  return `${APICARTO_GPU}/${couche}?geom=${geom}`;
}
export const urlDetailsDocument = (id: string) => `${API_GPU}/document/${encodeURIComponent(id)}/details`;
export const urlDocumentsPartition = (partition: string) =>
  `${API_GPU}/document?partition=${encodeURIComponent(partition)}&status=document.production`;

/** « 20230615 » ou « 2023-06-15… » → « 2023-06-15 » ; sinon null. */
export function dateGpu(v: unknown): string | null {
  const s = chaine(v);
  if (!s) return null;
  const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(s);
  if (!m) return null;
  const [a, mo, j] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (a < 1900 || a > 2100 || mo < 1 || mo > 12 || j < 1 || j > 31) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Date d'approbation codée dans l'idurba (« 64065_PLU_20230615 » → 2023-06-15). */
export function dateDepuisIdurba(idurba: unknown): string | null {
  const s = chaine(idurba);
  const m = s ? /_(\d{8})(?:_|$)/.exec(s) : null;
  return m ? dateGpu(m[1]) : null;
}

const proprietes = (fc: unknown): Record<string, unknown>[] => {
  const f = (fc && typeof fc === 'object' ? (fc as Record<string, unknown>).features : null);
  return Array.isArray(f)
    ? f.map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>).properties : null))
      .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
    : [];
};

export interface DocumentAuPoint {
  id: string;
  partition: string | null;
  idurba: string | null;
  du_type: string | null;
  territoire: string | null;
}

/** Couche `document` d'API Carto au point. Un PSMV prime (il remplace le PLU sur son périmètre). */
export function lireDocumentsAuPoint(fc: unknown): DocumentAuPoint[] {
  const docs = proprietes(fc)
    .map((p) => ({
      id: chaine(p.id) ?? chaine(p.gpu_doc_id) ?? '',
      partition: chaine(p.partition),
      idurba: chaine(p.name) ?? chaine(p.idurba),
      du_type: chaine(p.du_type),
      territoire: chaine(p.grid_title),
    }))
    .filter((d) => d.id && /^[A-Za-z0-9_-]{6,80}$/.test(d.id));
  const rang = (d: DocumentAuPoint) => (d.du_type === 'PSMV' ? 0 : /^PLUI?$/.test(d.du_type ?? '') ? 1 : 2);
  return docs.sort((a, b) => rang(a) - rang(b));
}

export interface ZoneAuPoint {
  zone: string | null;
  libelle_long: string | null;
  type_zone: string | null;
  fichier: string | null;
  url_fichier: string | null;
  date_approbation: string | null;
  date_validation: string | null;
  idurba: string | null;
  partition: string | null;
}

export function lireZonesAuPoint(fc: unknown): ZoneAuPoint[] {
  return proprietes(fc).map((p) => ({
    zone: chaine(p.libelle),
    libelle_long: chaine(p.libelong),
    type_zone: chaine(p.typezone),
    fichier: chaine(p.nomfic),
    url_fichier: chaine(p.urlfic),
    date_approbation: dateGpu(p.datappro) ?? dateDepuisIdurba(p.idurba),
    date_validation: dateGpu(p.datvalid),
    idurba: chaine(p.idurba),
    partition: chaine(p.partition),
  }));
}

export interface PieceEcrite { nom: string; url: string }
export interface DetailsDocument {
  id: string | null;
  nom: string | null;
  protege: boolean;
  pieces: PieceEcrite[];
  date_mise_en_ligne: string | null;
  statut: string | null;
}

const estUrlHttps = (u: string) => /^https:\/\/[^\s]+$/i.test(u);

/**
 * Réponse de /api/document/<id>/details. `writingMaterials` associe chaque PDF
 * publié à son URL d'accès ; on accepte un objet { nom: url }, un tableau
 * d'objets { name|title, url|path }, ou à défaut la liste `files` seule (sans URL :
 * inutilisable, ignorée).
 */
export function lireDetailsDocument(json: unknown): DetailsDocument {
  const j = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const pieces: PieceEcrite[] = [];
  const wm = j.writingMaterials;
  if (wm && typeof wm === 'object' && !Array.isArray(wm)) {
    for (const [nom, url] of Object.entries(wm as Record<string, unknown>)) {
      if (typeof url === 'string' && estUrlHttps(url)) pieces.push({ nom, url });
    }
  } else if (Array.isArray(wm)) {
    for (const x of wm) {
      const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
      const url = chaine(o.url) ?? chaine(o.path) ?? chaine(o.href);
      const nom = chaine(o.name) ?? chaine(o.title) ?? (url ? url.split('/').pop() ?? null : null);
      if (url && nom && estUrlHttps(url)) pieces.push({ nom, url });
    }
  }
  return {
    id: chaine(j.id),
    nom: chaine(j.name) ?? chaine(j.originalName),
    protege: j.protected === true,
    pieces: pieces.filter((p) => /\.pdf(?:$|\?)/i.test(p.url) || /\.pdf$/i.test(p.nom)),
    date_mise_en_ligne: dateGpu(j.uploadDate) ?? dateGpu(j.updateDate),
    statut: chaine(j.status),
  };
}

/** Liste de /api/document?partition=… : le document « production » le plus récent. */
export function choisirDocumentPartition(json: unknown): string | null {
  const liste = Array.isArray(json) ? json : (json && typeof json === 'object' && Array.isArray((json as Record<string, unknown>).documents)
    ? (json as Record<string, unknown>).documents as unknown[] : []);
  const docs = liste
    .map((x) => (x && typeof x === 'object' ? x as Record<string, unknown> : {}))
    .filter((d) => chaine(d.id) && (!chaine(d.status) || d.status === 'document.production'))
    .sort((a, b) => String(b.uploadDate ?? b.updateDate ?? '').localeCompare(String(a.uploadDate ?? a.updateDate ?? '')));
  return docs.length ? chaine(docs[0].id) : null;
}

const RE_REGLEMENT = /r[eè]glement|reglt|_regl/i;
const RE_PAS_ECRIT = /graphique|zonage|plan[_ -]?de|planche|carte|annexe|oap|orientation|padd|rapport|pr[eé]sentation|justification|[eé]valuation|servitude|notice|d[eé]lib|arr[eê]t[eé]/i;

export interface FichierReglement extends PieceEcrite { raison: string; rang: number }

/**
 * Fichiers candidats du RÈGLEMENT ÉCRIT, du plus sûr au moins sûr :
 *   1. le fichier désigné par la zone elle-même (nomfic/urlfic de zone-urba) s'il est publié ;
 *   2. les pièces écrites dont le nom évoque le règlement mais pas le zonage, les
 *      annexes, les OAP, le PADD ni le rapport de présentation ; parmi elles, une
 *      pièce qui cite la zone ou sa famille (« zones_urbaines » pour une zone U) passe devant.
 * Liste vide = rien d'identifiable : on le DIT, on ne lit pas un fichier au hasard.
 */
export function choisirFichiersReglement(details: DetailsDocument, zone: ZoneAuPoint | null): FichierReglement[] {
  const out: FichierReglement[] = [];
  const vus = new Set<string>();
  const ajouter = (p: PieceEcrite, raison: string, rang: number) => {
    if (vus.has(p.url)) return;
    vus.add(p.url);
    out.push({ ...p, raison, rang });
  };
  const nomZone = zone?.fichier?.toLowerCase().replace(/\.pdf$/i, '') ?? null;
  if (nomZone) {
    const p = details.pieces.find((x) => x.nom.toLowerCase().replace(/\.pdf$/i, '') === nomZone);
    if (p) ajouter(p, 'fichier désigné par la zone (nomfic)', 0);
  }
  if (zone?.url_fichier && estUrlHttps(zone.url_fichier) && /\.pdf(?:$|\?)/i.test(zone.url_fichier)) {
    ajouter({ nom: zone.fichier ?? zone.url_fichier.split('/').pop() ?? 'reglement.pdf', url: zone.url_fichier },
      'fichier désigné par la zone (urlfic)', 0);
  }
  const code = zone?.zone?.toLowerCase() ?? '';
  const famille = zone?.type_zone ? ({ U: 'urbain', AU: 'urbanis', AUc: 'urbanis', AUs: 'urbanis', A: 'agricol', N: 'nature' } as Record<string, string>)[zone.type_zone] ?? null : null;
  const reglements = details.pieces.filter((p) => RE_REGLEMENT.test(p.nom) && !RE_PAS_ECRIT.test(p.nom.replace(RE_REGLEMENT, '')));
  for (const p of reglements) {
    const n = p.nom.toLowerCase();
    const citeZone = code.length >= 2 && new RegExp(`(?:^|[^a-z0-9])${code.replace(/[^a-z0-9]/g, '')}(?:[^a-z0-9]|$)`).test(n);
    const citeFamille = famille ? n.includes(famille) : false;
    const general = /g[eé]n[eé]ral|commun/.test(n);
    ajouter(p, citeZone ? 'règlement citant la zone' : citeFamille ? 'règlement de la famille de zones' : general ? 'règlement — dispositions générales' : 'règlement écrit',
      citeZone ? 1 : citeFamille ? 2 : general ? 4 : 3);
  }
  return out.sort((a, b) => a.rang - b.rang);
}

export type DecisionFichier =
  | { action: 'lire'; fichier: FichierReglement }
  | { action: 'choisir'; choix: Array<{ nom: string; raison: string }>; demande: string | null };

/**
 * V1.8 (décision d'Albé) — on ne choisit PAS seul la pièce à lire quand il y en
 * a plusieurs (PLUi découpé : dispositions générales, zones urbaines, zones
 * naturelles…) : on renvoie la liste pour que l'UTILISATEUR choisisse. Une seule
 * pièce candidate, ou une pièce désignée par l'appelant (`demande`, réponse de
 * l'utilisateur) → lecture. Une demande qui ne correspond à aucune pièce →
 * on redemande, avec la liste.
 */
export function decisionFichier(fichiers: readonly FichierReglement[], demande: string | null | undefined): DecisionFichier {
  const choix = fichiers.slice(0, 12).map((f) => ({ nom: f.nom, raison: f.raison }));
  const d = (demande ?? '').trim().toLowerCase();
  if (d) {
    const exact = fichiers.find((f) => f.nom.toLowerCase() === d || f.nom.toLowerCase().replace(/\.pdf$/, '') === d.replace(/\.pdf$/, ''));
    const partiel = exact ?? (d.length >= 4 ? fichiers.filter((f) => f.nom.toLowerCase().includes(d)) : []);
    const trouve = exact ?? (Array.isArray(partiel) && partiel.length === 1 ? partiel[0] : null);
    return trouve ? { action: 'lire', fichier: trouve } : { action: 'choisir', choix, demande: demande ?? null };
  }
  if (fichiers.length === 1) return { action: 'lire', fichier: fichiers[0] };
  return { action: 'choisir', choix, demande: null };
}

/** Clé de cache : identifiant du document GPU (versionné : une nouvelle archive = un nouvel id) + fichier. */
export function cleCacheGpu(documentId: string, fichier: string): string {
  return `gpu:${documentId}:${fichier.toLowerCase().replace(/[^a-z0-9._-]+/g, '_').slice(0, 160)}`;
}

/** Chemin du PDF en cache dans le bucket plu-reglements. */
export function cheminCacheGpu(documentId: string, fichier: string): string {
  const nom = fichier.toLowerCase().replace(/[^a-z0-9._-]+/g, '_').replace(/^[._]+/, '').slice(0, 120) || 'reglement.pdf';
  return `gpu/${documentId.replace(/[^A-Za-z0-9_-]/g, '')}/${/\.pdf$/.test(nom) ? nom : `${nom}.pdf`}`;
}

/** Clé de cache d'un PDF déposé par un utilisateur (bucket + chemin + taille). */
export function cleCacheStockage(bucket: string, chemin: string, taille: number): string {
  return `stockage:${bucket}/${chemin}:${taille}`;
}

/** Source affichable d'un règlement lu : document, date d'approbation, fichier. */
export function libelleSource(p: { du_type: string | null; territoire: string | null; idurba: string | null; date_approbation: string | null; fichier: string }): string {
  const doc = [p.du_type ?? "Document d'urbanisme", p.territoire ? `de ${p.territoire}` : null].filter(Boolean).join(' ');
  const date = p.date_approbation ? `approuvé le ${p.date_approbation.split('-').reverse().join('/')}` : 'date d\'approbation non publiée';
  return `${doc} (${p.idurba ?? 'idurba inconnu'}, ${date}) — Géoportail de l'urbanisme, fichier ${p.fichier}`;
}
