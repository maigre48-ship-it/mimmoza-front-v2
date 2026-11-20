/**
 * VIS-18a (20/11/2026) — PONT « PARCOURS GUIDÉ ↔ STUDIO » (protocole `mimmoza-parcours-studio`, version 1).
 *
 * COPIE IDENTIQUE dans les deux dépôts (aucun import : le fichier se compile seul des deux côtés) :
 *   - mimmozia-studio/src/core/echange/pontParcoursStudio.ts
 *   - mimmoza-front-v2/src/spaces/promoteur/shared/echangeStudio/pontParcoursStudio.ts
 * Un test de chaque dépôt vérifie la table des étapes contre la vérité locale (colonne du Studio, clés du parcours).
 *
 * Canaux :
 *   site   → Studio : `etape.ouvrir`     (une étape du parcours a été cliquée : le Studio passe sur l'étape voulue)
 *   Studio → site   : `etape.accuse`     (accusé : ok / étape inconnue / autre projet / invalide — le site le dit)
 *   site   → Studio : `temoin.demander`  (le site veut l'état du logement témoin, ex. à l'ouverture)
 *   Studio → site   : `temoin.etat`      (logement témoin personnalisé, à chaque changement, ~1,5 s de calme)
 * Transport : `postMessage` vers/depuis l'iframe /studio/ (fenêtre exacte, origine exacte, jamais « * »), ou
 * `BroadcastChannel(CANAL_DIFFUSION_PARCOURS)` entre onglets de la MÊME origine (Studio ouvert dans un autre onglet).
 * Sécurité : un message d'une origine hors liste blanche (ni même origine, ni localhost en développement) est
 * IGNORÉ sans réponse ; forme validée ; version supérieure refusée avec une raison (accusé `version`).
 */

export const TYPE_PONT_PARCOURS = 'mimmoza-parcours-studio' as const;
export const VERSION_PONT_PARCOURS = 1 as const;
/** Nom du BroadcastChannel (onglets de même origine). */
export const CANAL_DIFFUSION_PARCOURS = 'mimmoza-parcours-studio';

export type CanalPont = 'etape.ouvrir' | 'etape.accuse' | 'temoin.demander' | 'temoin.etat';
export const CANAUX_PONT: readonly CanalPont[] = ['etape.ouvrir', 'etape.accuse', 'temoin.demander', 'temoin.etat'];

/* ───────────────────────── Étapes du Studio et table de correspondance ───────────────────────── */

/** Étapes de la colonne de gauche du Studio et leurs sous-onglets (vérité : src/ui/layout/etapesStudio.ts, testé). */
export const SOUS_ONGLETS_STUDIO = {
  projet: ['resume', 'ensemble'],
  terrain: ['terrain'],
  batiment: ['batiment', 'plans', 'bibliotheque', 'style', 'materiaux'],
  amenagement: ['quartier', 'voisinage', 'vegetation', 'objets', 'interieur'],
  images: ['archviz', 'lumiere', 'rendu', 'visite', 'production-images'],
  film: ['film-auto', 'film', 'livraison'],
  dessins: ['plans-vues', 'dossier-dp-pc', 'plan-existant'],
} as const;
export type EtapeStudio = keyof typeof SOUS_ONGLETS_STUDIO;
export const ETAPES_STUDIO = Object.keys(SOUS_ONGLETS_STUDIO) as EtapeStudio[];

export type TypeParcoursPont = 'image' | 'film' | 'visite';

export interface CibleStudio {
  readonly etape: EtapeStudio;
  readonly sousOnglet: string;
  /** Pour l'utilisateur : « Bâtiment → Style ». */
  readonly libelle: string;
}

const c = (etape: EtapeStudio, sousOnglet: string, libelle: string): CibleStudio => ({ etape, sousOnglet, libelle });

/**
 * Étape du parcours guidé (clés de src/lib/studio/parcours.ts, `CleEtape`, et cibles `studio-*`) → étape du Studio.
 * Les étapes 6 à 8 dépendent du type de parcours (image / film / visite).
 */
export function cibleStudioDe(cle: string, type: TypeParcoursPont | null = null): CibleStudio | null {
  switch (cle) {
    case 'terrain': return c('terrain', 'terrain', 'Terrain');
    case 'conception': return c('projet', 'resume', 'Projet');
    case 'volume':
    case 'studio-batiment': return c('batiment', 'batiment', 'Bâtiment');
    case 'style': return c('batiment', 'style', 'Bâtiment → Style');
    case 'materiaux': return c('batiment', 'materiaux', 'Bâtiment → Matériaux');
    case 'interieurs':
    case 'studio-interieur': return c('amenagement', 'interieur', 'Aménagement → Intérieur');
    case 'vues': return c('images', 'archviz', 'Images & visite → Mise en scène');
    case 'lumiere': return c('images', 'lumiere', 'Images & visite → Lumière');
    case 'scenario': return c('film', 'film-auto', 'Film');
    case 'pieces': return c('images', 'visite', 'Images & visite → Visite');
    case 'apercu':
      return type === 'film' ? c('film', 'film-auto', 'Film')
        : type === 'visite' ? c('images', 'visite', 'Images & visite → Visite')
          : c('images', 'production-images', 'Images & visite → Produire des images');
    case 'final':
      return type === 'film' ? c('film', 'film', 'Film → Images et film Unreal')
        : type === 'visite' ? c('images', 'visite', 'Images & visite → Visite')
          : c('images', 'production-images', 'Images & visite → Produire des images');
    default: return null;
  }
}

/** Étape / sous-onglet du Studio donnés directement (événement historique VIS-17) : validés contre la table. */
export function cibleStudioDirecte(etape: unknown, sousOnglet: unknown): CibleStudio | null {
  if (typeof etape !== 'string' || !(etape in SOUS_ONGLETS_STUDIO)) return null;
  const e = etape as EtapeStudio;
  const liste = SOUS_ONGLETS_STUDIO[e] as readonly string[];
  const s = typeof sousOnglet === 'string' && liste.includes(sousOnglet) ? sousOnglet : sousOnglet === undefined || sousOnglet === null ? liste[0]! : null;
  if (s === null) return null;
  const nom: Record<EtapeStudio, string> = { projet: 'Projet', terrain: 'Terrain', batiment: 'Bâtiment', amenagement: 'Aménagement', images: 'Images & visite', film: 'Film', dessins: 'Plans & dossier' };
  return c(e, s, s === liste[0] ? nom[e] : `${nom[e]} → ${s}`);
}

/* ───────────────────────── Logement témoin personnalisé ───────────────────────── */

export const FORMAT_TEMOIN = 'mimmozia-temoin-personnalise' as const;
export const VERSION_TEMOIN = 1 as const;
export const TYPOLOGIES_TEMOIN = ['T1', 'T2', 'T3', 'T4', 'T5'] as const;
export type TypologieTemoin = (typeof TYPOLOGIES_TEMOIN)[number];
/** Taille maximale du bloc `reglage` (JSON) : au-delà il est retiré (le résumé reste). */
export const TAILLE_MAX_REGLAGE = 60_000;

export interface FinitionPieceTemoin {
  /** Fonction de pièce du moteur (« sejour », « chambre », « cuisine »…). */
  readonly fonction: string;
  readonly sol: string | null;
  readonly murs: string | null;
}

export interface TemoinPersonnalise {
  readonly format: typeof FORMAT_TEMOIN;
  readonly version: typeof VERSION_TEMOIN;
  /** Vrai dès que l'utilisateur a choisi/aménagé un logement dans l'étape Intérieur ou modifié meubles / finitions / plan. */
  readonly personnalise: boolean;
  readonly logement: {
    /** Clé du plan du logement (`LogementAmenageable.cle`) : celle du réglage d'aménagement. */
    readonly cle: string;
    readonly buildingId: string;
    readonly floorKey: string;
    readonly wingId: string;
    readonly logementId: string | null;
    readonly lot: string | null;
    readonly niveau: string | null;
    readonly rangNiveau: number | null;
    readonly typologie: TypologieTemoin | null;
    readonly surfaceM2: number | null;
  };
  /** Style du moteur (contemporain, scandinave, industriel, japandi, classique_chic, mediterraneen). */
  readonly style: string | null;
  /** Gamme du moteur (economique, standard, premium). */
  readonly gamme: string | null;
  readonly cible: string | null;
  readonly seed: number;
  /** Meubles posés (dernière variante calculée dans le Studio) ; null : non calculé dans cette session. */
  readonly meubles: number | null;
  readonly finitions: readonly FinitionPieceTemoin[];
  readonly modifications: { readonly ajouts: number; readonly suppressions: number; readonly ajustements: number; readonly finitions: number; readonly planModifie: boolean };
  /**
   * Réglage d'aménagement DE CE LOGEMENT (sous-ensemble de `ReglageAmenagementInterieur` : seed, brief, ajouts,
   * suppressions, ajustements, pointsEau, planLogement). Relu par le worker avec `normaliserReglage` ; absent si trop gros.
   */
  readonly reglage?: Readonly<Record<string, unknown>>;
  /** Une ligne : « T3 A204 · séjour scandinave · parquet · 18 meubles ». */
  readonly resume: string;
  /** `fnv1a32:` du contenu (hors `majLe`, `resume`) : idempotence des envois et des écritures. */
  readonly empreinte: string;
  readonly majLe: string;
}

const LIBELLES_STYLE: Readonly<Record<string, string>> = {
  contemporain: 'contemporain', scandinave: 'scandinave', industriel: 'industriel', japandi: 'japandi',
  classique_chic: 'classique chic', mediterraneen: 'méditerranéen',
};
const LIBELLES_GAMME: Readonly<Record<string, string>> = { economique: 'gamme économique', standard: 'gamme standard', premium: 'gamme premium' };
/** Sols (vérité : ROOM_FLOOR_FINISHES / ROOM_FINISH_LABELS de src/core/archviz/types.ts, testé). */
export const LIBELLES_SOL: Readonly<Record<string, string>> = {
  'av-parquet': 'parquet', 'av-parquet-clair': 'parquet clair', 'av-carrelage': 'carrelage', 'av-beton-cire': 'béton ciré',
  'av-moquette': 'moquette', 'av-carrelage-grand-format': 'carrelage grand format', 'av-tomettes': 'tomettes',
  'av-parquet-batons-rompus': 'parquet bâtons rompus',
};

/** Résumé d'une ligne pour le parcours : « T3 A204 · séjour scandinave · parquet · 18 meubles ». */
export function resumeTemoin(t: Pick<TemoinPersonnalise, 'logement' | 'style' | 'gamme' | 'meubles' | 'finitions'>): string {
  const morceaux: string[] = [];
  const tete = [t.logement.typologie, t.logement.lot].filter((x): x is string => typeof x === 'string' && x !== '').join(' ');
  morceaux.push(tete || 'Logement témoin');
  const style = t.style ? LIBELLES_STYLE[t.style] ?? t.style : null;
  if (style) morceaux.push(`séjour ${style}`);
  else if (t.gamme && LIBELLES_GAMME[t.gamme]) morceaux.push(LIBELLES_GAMME[t.gamme]!);
  const sejour = t.finitions.find((f) => f.fonction === 'sejour' && f.sol) ?? t.finitions.find((f) => f.sol);
  if (sejour?.sol) morceaux.push(LIBELLES_SOL[sejour.sol] ?? sejour.sol);
  if (typeof t.meubles === 'number') morceaux.push(`${t.meubles} meuble${t.meubles > 1 ? 's' : ''}`);
  return morceaux.join(' · ');
}

/** Empreinte FNV-1a 32 bits d'un JSON à clés triées. */
export function empreinteTemoin(t: Omit<TemoinPersonnalise, 'empreinte' | 'majLe' | 'resume'>): string {
  const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v);
  const s = JSON.stringify(canon(t));
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `fnv1a32:${h.toString(16).padStart(8, '0')}`;
}

const estObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const txt = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);
const nombre = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const entier = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(100_000, Math.round(v)) : 0);

/** Valide un témoin reçu (message, base, stockage local). null : illisible ou d'un autre format. */
export function lireTemoin(v: unknown): TemoinPersonnalise | null {
  if (!estObj(v) || v.format !== FORMAT_TEMOIN || v.version !== VERSION_TEMOIN || !estObj(v.logement)) return null;
  const l = v.logement;
  const cle = txt(l.cle, 300), buildingId = txt(l.buildingId, 120), floorKey = txt(l.floorKey, 120), wingId = txt(l.wingId, 120);
  if (!cle || !buildingId || !floorKey || !wingId) return null;
  const typologie = (TYPOLOGIES_TEMOIN as readonly string[]).includes(l.typologie as string) ? l.typologie as TypologieTemoin : null;
  const finitions: FinitionPieceTemoin[] = Array.isArray(v.finitions)
    ? v.finitions.slice(0, 40).flatMap((f) => (estObj(f) && txt(f.fonction, 60) ? [{ fonction: f.fonction as string, sol: txt(f.sol, 80), murs: txt(f.murs, 80) }] : []))
    : [];
  const m = estObj(v.modifications) ? v.modifications : {};
  let reglage: Record<string, unknown> | undefined;
  if (estObj(v.reglage)) {
    try { if (JSON.stringify(v.reglage).length <= TAILLE_MAX_REGLAGE) reglage = v.reglage; } catch { reglage = undefined; }
  }
  const meubles = nombre(v.meubles);
  const base = {
    format: FORMAT_TEMOIN, version: VERSION_TEMOIN, personnalise: v.personnalise === true,
    logement: {
      cle, buildingId, floorKey, wingId, logementId: txt(l.logementId, 120), lot: txt(l.lot, 40), niveau: txt(l.niveau, 40),
      rangNiveau: nombre(l.rangNiveau), typologie, surfaceM2: nombre(l.surfaceM2),
    },
    style: txt(v.style, 40), gamme: txt(v.gamme, 40), cible: txt(v.cible, 40), seed: nombre(v.seed) ?? 1,
    meubles: meubles === null ? null : entier(meubles), finitions,
    modifications: { ajouts: entier(m.ajouts), suppressions: entier(m.suppressions), ajustements: entier(m.ajustements), finitions: entier(m.finitions), planModifie: m.planModifie === true },
    ...(reglage ? { reglage } : {}),
  } as const;
  const majLe = txt(v.majLe, 40) ?? new Date(0).toISOString();
  return { ...base, resume: resumeTemoin(base), empreinte: empreinteTemoin(base), majLe };
}

/** Construit un témoin complet (résumé, empreinte, horodatage) — côté Studio. */
export function creerTemoin(base: Omit<TemoinPersonnalise, 'format' | 'version' | 'resume' | 'empreinte' | 'majLe'>, maintenant: Date = new Date()): TemoinPersonnalise {
  const b = { format: FORMAT_TEMOIN, version: VERSION_TEMOIN, ...base } as Omit<TemoinPersonnalise, 'resume' | 'empreinte' | 'majLe'>;
  return { ...b, resume: resumeTemoin(b), empreinte: empreinteTemoin(b), majLe: maintenant.toISOString() };
}

/* ───────────────────────── Messages ───────────────────────── */

export interface ChargeOuvrirEtape {
  readonly requeteId: string;
  /** Clé du parcours (`volume`, `style`, `interieurs`, `vues`…) — prioritaire. */
  readonly cle?: string;
  readonly type?: TypeParcoursPont;
  /** Ou étape / sous-onglet du Studio directement (événement VIS-17). */
  readonly etapeStudio?: string;
  readonly sousOnglet?: string;
  /** Projet du site (`mzchat-<conversation>`) : un Studio lié à un AUTRE projet répond `autre-projet`. */
  readonly projetId?: string;
}

export type StatutAccuse = 'ok' | 'etape-inconnue' | 'autre-projet' | 'version' | 'invalide';

export interface ChargeAccuse {
  readonly requeteId: string;
  readonly statut: StatutAccuse;
  readonly etapeStudio?: string;
  readonly sousOnglet?: string;
  readonly libelle?: string;
  readonly message: string;
}

export interface ChargeTemoinDemander { readonly requeteId: string; readonly projetId?: string }
export interface ChargeTemoinEtat { readonly projetId: string | null; readonly temoin: TemoinPersonnalise | null }

export type MessagePont =
  | { readonly type: typeof TYPE_PONT_PARCOURS; readonly version: number; readonly canal: 'etape.ouvrir'; readonly charge: ChargeOuvrirEtape }
  | { readonly type: typeof TYPE_PONT_PARCOURS; readonly version: number; readonly canal: 'etape.accuse'; readonly charge: ChargeAccuse }
  | { readonly type: typeof TYPE_PONT_PARCOURS; readonly version: number; readonly canal: 'temoin.demander'; readonly charge: ChargeTemoinDemander }
  | { readonly type: typeof TYPE_PONT_PARCOURS; readonly version: number; readonly canal: 'temoin.etat'; readonly charge: ChargeTemoinEtat };

type ChargeDe<C extends CanalPont> = Extract<MessagePont, { canal: C }>['charge'];

export function creerMessagePont<C extends CanalPont>(canal: C, charge: ChargeDe<C>): Extract<MessagePont, { canal: C }> {
  return { type: TYPE_PONT_PARCOURS, version: VERSION_PONT_PARCOURS, canal, charge } as Extract<MessagePont, { canal: C }>;
}

export type LecturePont =
  | { readonly ok: true; readonly message: MessagePont }
  | { readonly ok: false; readonly erreur: string; readonly requeteId: string | null; readonly version: boolean };

const RE_REQUETE = /^[A-Za-z0-9_-]{6,80}$/;
const RE_PROJET = /^[A-Za-z0-9_.:-]{1,120}$/;

/** Valide la FORME d'un message du pont (l'origine se contrôle AVANT, voir `examinerMessagePont`). */
export function lireMessagePont(data: unknown): LecturePont {
  if (!estObj(data) || data.type !== TYPE_PONT_PARCOURS) return { ok: false, erreur: 'pas un message du parcours', requeteId: null, version: false };
  const ch = estObj(data.charge) ? data.charge : null;
  const requeteId = ch && typeof ch.requeteId === 'string' && RE_REQUETE.test(ch.requeteId) ? ch.requeteId : null;
  if (typeof data.version !== 'number' || !Number.isInteger(data.version) || data.version < 1) return { ok: false, erreur: 'version invalide', requeteId, version: true };
  if (data.version > VERSION_PONT_PARCOURS) return { ok: false, erreur: `version ${data.version} non prise en charge (max ${VERSION_PONT_PARCOURS}) : mettre à jour le Studio`, requeteId, version: true };
  if (!ch) return { ok: false, erreur: 'charge manquante', requeteId, version: false };
  const base = { type: TYPE_PONT_PARCOURS, version: data.version };
  const projetId = typeof ch.projetId === 'string' && RE_PROJET.test(ch.projetId) ? ch.projetId : undefined;
  switch (data.canal) {
    case 'etape.ouvrir': {
      if (!requeteId) return { ok: false, erreur: 'requeteId invalide', requeteId: null, version: false };
      const cle = txt(ch.cle, 40) ?? undefined;
      const etapeStudio = txt(ch.etapeStudio, 40) ?? undefined;
      if (!cle && !etapeStudio) return { ok: false, erreur: 'étape absente', requeteId, version: false };
      const type = ch.type === 'image' || ch.type === 'film' || ch.type === 'visite' ? ch.type : undefined;
      const sousOnglet = txt(ch.sousOnglet, 40) ?? undefined;
      return { ok: true, message: { ...base, canal: 'etape.ouvrir', charge: { requeteId, ...(cle ? { cle } : {}), ...(type ? { type } : {}), ...(etapeStudio ? { etapeStudio } : {}), ...(sousOnglet ? { sousOnglet } : {}), ...(projetId ? { projetId } : {}) } } };
    }
    case 'etape.accuse': {
      if (!requeteId) return { ok: false, erreur: 'requeteId invalide', requeteId: null, version: false };
      const statuts: readonly StatutAccuse[] = ['ok', 'etape-inconnue', 'autre-projet', 'version', 'invalide'];
      if (!statuts.includes(ch.statut as StatutAccuse)) return { ok: false, erreur: 'statut invalide', requeteId, version: false };
      const etapeStudio = txt(ch.etapeStudio, 40), sousOnglet = txt(ch.sousOnglet, 40), libelle = txt(ch.libelle, 120);
      return { ok: true, message: { ...base, canal: 'etape.accuse', charge: { requeteId, statut: ch.statut as StatutAccuse, ...(etapeStudio ? { etapeStudio } : {}), ...(sousOnglet ? { sousOnglet } : {}), ...(libelle ? { libelle } : {}), message: txt(ch.message, 300) ?? '' } } };
    }
    case 'temoin.demander':
      if (!requeteId) return { ok: false, erreur: 'requeteId invalide', requeteId: null, version: false };
      return { ok: true, message: { ...base, canal: 'temoin.demander', charge: { requeteId, ...(projetId ? { projetId } : {}) } } };
    case 'temoin.etat': {
      const temoin = ch.temoin === null ? null : lireTemoin(ch.temoin);
      if (ch.temoin !== null && temoin === null) return { ok: false, erreur: 'témoin illisible', requeteId: null, version: false };
      return { ok: true, message: { ...base, canal: 'temoin.etat', charge: { projetId: projetId ?? null, temoin } } };
    }
    default:
      return { ok: false, erreur: `canal « ${String(data.canal)} » inconnu`, requeteId, version: false };
  }
}

/* ───────────────────────── Origines ───────────────────────── */

function origineWeb(o: string): boolean {
  try { const u = new URL(o); return (u.protocol === 'https:' || u.protocol === 'http:') && u.origin === o; } catch { return false; }
}
function origineLocale(o: string): boolean {
  try { const h = new URL(o).hostname.toLowerCase().replace(/^\[|\]$/g, ''); return h === 'localhost' || h === '127.0.0.1' || h === '::1'; } catch { return false; }
}

/** Origine admise : liste blanche exacte, ou même origine que la page ; localhost seulement en développement. Jamais « * ». */
export function origineAdmisePont(origine: unknown, autorisees: readonly string[], originePage: string | null, devLocal = false): boolean {
  if (typeof origine !== 'string' || origine === 'null' || origine === '*' || !origineWeb(origine)) return false;
  if (autorisees.includes(origine)) return true;
  if (originePage !== null && origine === originePage) return true;
  return devLocal && origineLocale(origine);
}

export type DecisionPont =
  | { readonly type: 'ignore'; readonly raison: string }
  /** Forme ou version refusée MAIS origine admise et requête identifiée : on peut répondre par un accusé. */
  | { readonly type: 'refus'; readonly requeteId: string; readonly statut: 'version' | 'invalide'; readonly raison: string }
  | { readonly type: 'message'; readonly message: MessagePont };

/** Filtre pur : origine d'abord (inconnue ⇒ ignorée, sans réponse), puis forme et version. */
export function examinerMessagePont(
  evt: { readonly origin: string; readonly data: unknown },
  autorisees: readonly string[],
  originePage: string | null,
  devLocal = false,
): DecisionPont {
  if (!origineAdmisePont(evt.origin, autorisees, originePage, devLocal)) return { type: 'ignore', raison: `origine non autorisée (${String(evt.origin)})` };
  const lu = lireMessagePont(evt.data);
  if (lu.ok) return { type: 'message', message: lu.message };
  if (lu.requeteId && (estObj(evt.data) && evt.data.type === TYPE_PONT_PARCOURS)) return { type: 'refus', requeteId: lu.requeteId, statut: lu.version ? 'version' : 'invalide', raison: lu.erreur };
  return { type: 'ignore', raison: lu.erreur };
}

/** Texte pour l'utilisateur d'un accusé reçu par le site. */
export function messageAccuse(a: ChargeAccuse | null, ailleurs = false): string {
  if (a === null) return 'Le Studio ne répond pas : dans sa colonne de gauche, choisissez l’étape voulue.';
  switch (a.statut) {
    case 'ok': return `${ailleurs ? 'Le Studio ouvert dans l’autre onglet' : 'Le Studio'} est passé sur l’étape « ${a.libelle ?? a.etapeStudio ?? '?'} ».`;
    case 'etape-inconnue': return 'Cette étape n’existe pas dans le Studio : choisissez-la dans sa colonne de gauche.';
    case 'autre-projet': return 'Le Studio ouvert montre un autre projet : il n’a pas changé d’étape.';
    case 'version': return 'Le Studio ouvert est d’une autre version : rechargez-le pour qu’il suive le parcours.';
    default: return `Le Studio a refusé la demande${a.message ? ` (${a.message})` : ''}.`;
  }
}
