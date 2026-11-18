// src/spaces/copilot/studio3d/planLuChat.ts
// =============================================================================
// LOT G6 (18/11/2026) — « PLAN LU » DANS LE CHAT. Logique PURE (node --test : planLuChat.test.ts).
//
// 1. Un plan de la maison joint à un message du chat (DXF, ou PDF / image avec le mot « plan ») n'est PAS envoyé au
//    modèle de langage : il est gardé dans l'onglet (plan en attente, lot F5) et lu dans le Studio (lecture du lot
//    D7a, dans le navigateur, sans jeton) ; le message part avec un marqueur « [Plan de la maison joint … ] ».
// 2. Le relevé posé dans le Studio revient avec un résumé `planLu` (échelle, dimensions, emprise lue et écart avec la
//    BD TOPO, côtés, niveaux, pièces, points douteux) : relu ici sans rien compléter.
// 3. La carte « Plan lu » demande, si nécessaire, la confirmation de 1 à 3 valeurs clés (dimensions hors tout,
//    niveaux, surface des pièces) ; une valeur confirmée ou corrigée passe au statut « confirmé ».
// 4. Lecture impossible : 2 à 3 cotes saisies (longueur, largeur, niveaux) donnent un plan « saisi », confirmé.
// 5. Le plan lu part au serveur dans le contexte de la page (clés `plan_lu_*`, valeurs simples), relu par le parcours
//    d'extension (lot G6 serveur : _shared/extension/planLu.ts).
// Aucun nom interne n'est montré à l'utilisateur.
// =============================================================================

export type StatutPlan = 'confirme' | 'lu' | 'mesure' | 'deduit' | 'suppose' | 'a-confirmer' | 'non-visible';
const STATUTS: readonly StatutPlan[] = ['confirme', 'lu', 'mesure', 'deduit', 'suppose', 'a-confirmer', 'non-visible'];
export const LIBELLE_STATUT_PLAN: Readonly<Record<StatutPlan, string>> = {
  confirme: 'confirmé par vous', lu: 'lu sur le plan', mesure: 'mesuré sur le plan', deduit: 'déduit du plan', suppose: 'supposé', 'a-confirmer': 'à confirmer', 'non-visible': 'non visible',
};

export interface CoteExterieurePlan { libelle: string; longueurLueM: number; statut: StatutPlan; longueurBdTopoM: number | null; ecartM: number | null }
export interface PiecePlan { nom: string | null; niveau: string; surfaceM2: number; statut: StatutPlan }

export interface PlanLuSite {
  source: 'import-plan' | 'saisie';
  origine: string;
  recuLeMs: number;
  echelle: { texte: string; statut: StatutPlan; cotesConcordantes: number; cotesDiscordantes: number } | null;
  dimensions: { longueurM: number; largeurM: number; statut: StatutPlan } | null;
  emprise: { lueM2: number; statut: StatutPlan; bdTopoM2: number | null; ecartPct: number | null; signale: boolean } | null;
  position: { statut: StatutPlan; recouvrementPct: number } | null;
  cotesExterieures: CoteExterieurePlan[];
  niveaux: { nombre: number; statut: StatutPlan; libelles: string[] } | null;
  pieces: PiecePlan[];
  surfacePiecesM2: number | null;
  statutSurfacePieces: StatutPlan | null;
  pointsDouteux: string[];
}

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const fini = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const txt = (v: unknown, n = 300): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
const st = (v: unknown): StatutPlan | null => (STATUTS.includes(v as StatutPlan) ? v as StatutPlan : null);
const r2 = (v: number): number => Math.round(v * 100) / 100;
export const fr = (v: number, d = 2): string => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('fr-FR', { maximumFractionDigits: d }).replace(/ | /g, ' ');
const borne = (v: unknown, min: number, max: number): number | null => (fini(v) && v >= min && v <= max ? v : null);

/**
 * Résumé `planLu` du relevé renvoyé par le Studio (format `mimmoza-plan-lu` v1) → plan lu du site. Ne complète rien :
 * une valeur illisible est écartée (et l'élément entier si la valeur porte le sens). null si le bloc est absent. Pur.
 */
export function lirePlanLuStudio(v: unknown, origineReleve: string, recuLeMs: number): PlanLuSite | null {
  if (!estObj(v) || v.format !== 'mimmoza-plan-lu' || v.version !== 1) return null;
  const e = estObj(v.echelle) ? v.echelle : null;
  const echelle = e && txt(e.texte, 160) && st(e.statut)
    ? { texte: txt(e.texte, 160)!, statut: st(e.statut)!, cotesConcordantes: fini(e.cotesConcordantes) ? e.cotesConcordantes : 0, cotesDiscordantes: fini(e.cotesDiscordantes) ? e.cotesDiscordantes : 0 }
    : null;
  const d = estObj(v.dimensions) ? v.dimensions : null;
  const L = borne(d?.longueurM, 1, 300), l = borne(d?.largeurM, 1, 300);
  const dimensions = d && L !== null && l !== null && st(d.statut) ? { longueurM: r2(Math.max(L, l)), largeurM: r2(Math.min(L, l)), statut: st(d.statut)! } : null;
  const em = estObj(v.emprise) ? v.emprise : null;
  const lue = borne(em?.lueM2, 5, 50_000);
  const emprise = em && lue !== null && st(em.statut)
    ? { lueM2: r2(lue), statut: st(em.statut)!, bdTopoM2: borne(em.bdTopoM2, 1, 50_000), ecartPct: fini(em.ecartPct) ? em.ecartPct : null, signale: em.signale === true }
    : null;
  const po = estObj(v.position) ? v.position : null;
  const position = po && st(po.statut) && fini(po.recouvrementPct) ? { statut: st(po.statut)!, recouvrementPct: Math.round(po.recouvrementPct) } : null;
  const cotesExterieures: CoteExterieurePlan[] = [];
  for (const c of Array.isArray(v.cotesExterieures) ? v.cotesExterieures.slice(0, 40) : []) {
    if (!estObj(c)) continue;
    const lg = borne(c.longueurLueM, 0.3, 300);
    const s = st(c.statut);
    if (lg === null || !s) continue;
    cotesExterieures.push({ libelle: txt(c.libelle, 80) ?? 'côté', longueurLueM: r2(lg), statut: s, longueurBdTopoM: borne(c.longueurBdTopoM, 0.3, 300), ecartM: fini(c.ecartM) ? r2(c.ecartM) : null });
  }
  const n = estObj(v.niveaux) ? v.niveaux : null;
  const nb = n && fini(n.nombre) && Number.isInteger(n.nombre) && n.nombre >= 1 && n.nombre <= 20 && st(n.statut) ? n.nombre : null;
  const niveaux = nb !== null ? { nombre: nb, statut: st(n!.statut)!, libelles: (Array.isArray(n!.libelles) ? n!.libelles : []).map((x) => txt(x, 40)).filter((x): x is string => !!x).slice(0, 20) } : null;
  const pieces: PiecePlan[] = [];
  for (const p of Array.isArray(v.pieces) ? v.pieces.slice(0, 200) : []) {
    if (!estObj(p)) continue;
    const s = borne(p.surfaceM2, 0.2, 10_000);
    const sp = st(p.statut);
    if (s === null || !sp) continue;
    pieces.push({ nom: txt(p.nom, 80), niveau: txt(p.niveau, 40) ?? '?', surfaceM2: r2(s), statut: sp });
  }
  const surfacePiecesM2 = pieces.length ? r2(pieces.reduce((a, p) => a + p.surfaceM2, 0)) : null;
  const RANG: Record<StatutPlan, number> = { confirme: 0, lu: 1, mesure: 1, deduit: 2, suppose: 3, 'a-confirmer': 4, 'non-visible': 5 };
  const statutSurfacePieces = pieces.length ? pieces.map((p) => p.statut).sort((a, b) => RANG[b] - RANG[a])[0]! : null;
  return {
    source: 'import-plan', origine: txt(v.origine, 200) ?? origineReleve, recuLeMs,
    echelle, dimensions, emprise, position, cotesExterieures, niveaux, pieces, surfacePiecesM2, statutSurfacePieces,
    pointsDouteux: (Array.isArray(v.pointsDouteux) ? v.pointsDouteux : []).map((x) => txt(x, 300)).filter((x): x is string => !!x).slice(0, 12),
  };
}

/* ------------------------------------------------------------------ */
/* Confirmations (1 à 3 valeurs clés)                                  */
/* ------------------------------------------------------------------ */

export type CleConfirmation = 'dimensions' | 'niveaux' | 'surface';
export interface ValeurCle {
  cle: CleConfirmation;
  libelle: string;
  valeur: string;
  statut: StatutPlan;
  /** À confirmer avant d'être retenue (statut incertain, écart avec la BD TOPO, cotes du plan discordantes). */
  necessaire: boolean;
  raison: string | null;
}

const sur = (s: StatutPlan): boolean => s === 'confirme' || s === 'lu' || s === 'mesure';

/** Valeurs clés montrées par la carte (au plus 3), avec celles qui DOIVENT être confirmées. Pur. */
export function valeursCles(p: PlanLuSite): ValeurCle[] {
  const out: ValeurCle[] = [];
  if (p.dimensions) {
    const raisons: string[] = [];
    if (p.dimensions.statut !== 'confirme' && !sur(p.dimensions.statut)) raisons.push(LIBELLE_STATUT_PLAN[p.dimensions.statut]);
    if (p.dimensions.statut !== 'confirme' && p.emprise?.signale) raisons.push('écart de plus de 10 % avec la base de l’IGN');
    if (p.dimensions.statut !== 'confirme' && (p.echelle?.cotesDiscordantes ?? 0) > 0) raisons.push('cotes du plan discordantes');
    out.push({
      cle: 'dimensions', libelle: 'Dimensions de la maison (hors tout)', valeur: `${fr(p.dimensions.longueurM)} × ${fr(p.dimensions.largeurM)} m`,
      statut: p.dimensions.statut, necessaire: raisons.length > 0, raison: raisons.length ? raisons.join(', ') : null,
    });
  }
  if (p.niveaux) {
    out.push({
      cle: 'niveaux', libelle: 'Niveaux de la maison', valeur: `${p.niveaux.nombre} niveau${p.niveaux.nombre > 1 ? 'x' : ''}${p.niveaux.libelles.length ? ` (${p.niveaux.libelles.join(', ')})` : ''}`,
      statut: p.niveaux.statut, necessaire: p.niveaux.statut !== 'confirme', raison: p.niveaux.statut !== 'confirme' ? 'une page du plan par niveau : à vérifier' : null,
    });
  }
  if (p.surfacePiecesM2 !== null && p.statutSurfacePieces) {
    out.push({
      cle: 'surface', libelle: 'Surface des pièces', valeur: `${fr(p.surfacePiecesM2, 1)} m² (${p.pieces.length} pièce${p.pieces.length > 1 ? 's' : ''})`,
      statut: p.statutSurfacePieces, necessaire: !sur(p.statutSurfacePieces), raison: !sur(p.statutSurfacePieces) ? LIBELLE_STATUT_PLAN[p.statutSurfacePieces] : null,
    });
  }
  return out.slice(0, 3);
}

/** Valeur saisie (« 11,9 x 8 », « 2 », « 132 m² ») : nombres seulement, bornés. Pur. */
export function lireSaisie(cle: CleConfirmation, texte: string): number[] | null {
  const ns = [...texte.replace(/(\d),(\d)/g, '$1.$2').matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  if (cle === 'dimensions') return ns.length >= 2 && ns[0]! >= 1 && ns[0]! <= 300 && ns[1]! >= 1 && ns[1]! <= 300 ? [ns[0]!, ns[1]!] : null;
  if (cle === 'niveaux') return ns.length >= 1 && Number.isInteger(ns[0]) && ns[0]! >= 1 && ns[0]! <= 20 ? [ns[0]!] : null;
  return ns.length >= 1 && ns[0]! >= 5 && ns[0]! <= 100_000 ? [ns[0]!] : null;
}

/**
 * Confirme une valeur clé (telle que lue, ou corrigée). Une correction des dimensions retire l'emprise lue (le contour
 * du plan ne correspond plus) : le serveur compare alors longueur × largeur, et le dit. Pur.
 */
export function confirmerValeur(p: PlanLuSite, cle: CleConfirmation, correction: number[] | null = null): PlanLuSite {
  if (cle === 'dimensions' && p.dimensions) {
    if (correction) return { ...p, dimensions: { longueurM: r2(Math.max(correction[0]!, correction[1]!)), largeurM: r2(Math.min(correction[0]!, correction[1]!)), statut: 'confirme' }, emprise: null };
    return { ...p, dimensions: { ...p.dimensions, statut: 'confirme' }, ...(p.emprise ? { emprise: { ...p.emprise, statut: 'confirme' as StatutPlan } } : {}) };
  }
  if (cle === 'niveaux' && p.niveaux) return { ...p, niveaux: { ...p.niveaux, nombre: correction ? correction[0]! : p.niveaux.nombre, statut: 'confirme', libelles: correction ? [] : p.niveaux.libelles } };
  if (cle === 'surface' && p.surfacePiecesM2 !== null) return { ...p, surfacePiecesM2: correction ? r2(correction[0]!) : p.surfacePiecesM2, statutSurfacePieces: 'confirme' };
  return p;
}

/** Toutes les valeurs nécessaires sont-elles confirmées ? Pur. */
export const planPretPourLeParcours = (p: PlanLuSite): boolean => valeursCles(p).every((v) => !v.necessaire);

/**
 * Lecture impossible : 2 à 3 cotes saisies (longueur et largeur hors tout des murs extérieurs, niveaux facultatifs),
 * toutes « confirmées ». null si les cotes sont illisibles. Pur.
 */
export function planLuDepuisSaisie(e: { longueur: string; largeur: string; niveaux?: string }, maintenantMs: number): PlanLuSite | null {
  const L = Number(e.longueur.replace(',', '.'));
  const l = Number(e.largeur.replace(',', '.'));
  if (!fini(L) || !fini(l) || L < 1 || L > 300 || l < 1 || l > 300) return null;
  const n = e.niveaux && e.niveaux.trim() ? lireSaisie('niveaux', e.niveaux) : null;
  if (e.niveaux && e.niveaux.trim() && !n) return null;
  return {
    source: 'saisie', origine: 'cotes saisies', recuLeMs: maintenantMs, echelle: null,
    dimensions: { longueurM: r2(Math.max(L, l)), largeurM: r2(Math.min(L, l)), statut: 'confirme' }, emprise: null, position: null,
    cotesExterieures: [], niveaux: n ? { nombre: n[0]!, statut: 'confirme', libelles: [] } : null, pieces: [], surfacePiecesM2: null, statutSurfacePieces: null, pointsDouteux: [],
  };
}

/* ------------------------------------------------------------------ */
/* Contexte transmis au serveur (valeurs simples)                      */
/* ------------------------------------------------------------------ */

const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Clés `plan_lu_*` du contexte de la page (relues par le parcours d'extension). Pur. */
export function contextePlanLu(p: PlanLuSite): Record<string, string | number | null> {
  return {
    plan_lu_v: 1, plan_lu_source: p.source, plan_lu_origine: p.origine.slice(0, 160), plan_lu_le: iso(p.recuLeMs),
    plan_lu_longueur_m: p.dimensions?.longueurM ?? null, plan_lu_largeur_m: p.dimensions?.largeurM ?? null, plan_lu_dimensions_statut: p.dimensions?.statut ?? null,
    plan_lu_emprise_m2: p.emprise?.lueM2 ?? null, plan_lu_emprise_statut: p.emprise?.statut ?? null,
    plan_lu_niveaux: p.niveaux?.nombre ?? null, plan_lu_niveaux_statut: p.niveaux?.statut ?? null,
    plan_lu_surface_pieces_m2: p.surfacePiecesM2, plan_lu_surface_pieces_statut: p.statutSurfacePieces, plan_lu_nb_pieces: p.pieces.length || null,
    plan_lu_echelle: p.echelle?.texte ?? null,
    plan_lu_douteux: p.pointsDouteux.length ? p.pointsDouteux.slice(0, 6).join(' | ') : null,
  };
}

/**
 * Message envoyé à Mimmo quand la personne valide la carte : AUCUN nombre (les valeurs passent par le contexte de la
 * page ; un « 11,9 × 8 m » dans le texte serait lu comme les dimensions de l'extension). Pur.
 */
export function messageValidationPlan(p: PlanLuSite): string {
  return p.source === 'saisie'
    ? 'Plan de la maison : cotes saisies dans la carte « Plan lu ».'
    : 'Plan de la maison : valeurs vérifiées dans la carte « Plan lu ».';
}

/* ------------------------------------------------------------------ */
/* Plan joint à un message du chat                                     */
/* ------------------------------------------------------------------ */

export const MARQUEUR_PLAN_JOINT = '[Plan de la maison joint';
const RE_PLAN = /\b(?:plans?|releves?|cotes?|cotations?|dxf|dwg)\b/;
const sansAccents = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export interface PieceCandidate { name?: string; mediaType: string; data?: string; storagePath?: string }

/**
 * Indice de la pièce jointe qui est un plan de la maison, sinon -1. DXF : toujours ; PDF ou image : seulement si le
 * message ou le nom du fichier parle de plan (une photo de la maison n'est jamais prise pour un plan). Pur.
 */
export function indicePlanJoint(pieces: readonly PieceCandidate[], texte: string): number {
  const t = sansAccents(texte);
  return pieces.findIndex((p) => {
    const nom = sansAccents(p.name ?? '');
    if (/\.dxf$/.test(nom) || /dxf/.test(p.mediaType)) return true;
    const pdfOuImage = p.mediaType === 'application/pdf' || p.mediaType === 'image/png' || p.mediaType === 'image/jpeg';
    return pdfOuImage && (RE_PLAN.test(t) || RE_PLAN.test(nom.replace(/[_\-.]/g, ' ')));
  });
}

/** Texte du message une fois le plan retiré des pièces envoyées au modèle. Pur. */
export function texteAvecMarqueurPlan(texte: string, nom: string): string {
  return `${texte.trim()}\n\n${MARQUEUR_PLAN_JOINT} : « ${nom.slice(0, 120)} » — lu par Mimmoza dans le Studio, sans le modèle de langage]`;
}

/** base64 (sans préfixe) → ArrayBuffer. */
export function base64VersOctets(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) u[i] = bin.charCodeAt(i);
  return u.buffer;
}

/** Lignes courtes de la carte (et de l'avis sous la saisie). Pur. */
export function lignesPlanLu(p: PlanLuSite): string[] {
  const out: string[] = [p.source === 'saisie' ? 'Cotes de la maison saisies par vous.' : `Plan « ${p.origine} » lu dans le Studio (lecture automatique, sans jeton).`];
  if (p.echelle) out.push(`Échelle : ${p.echelle.texte} — ${LIBELLE_STATUT_PLAN[p.echelle.statut]}${p.echelle.cotesConcordantes ? `, ${p.echelle.cotesConcordantes} cote(s) du plan la confirment` : ''}.`);
  if (p.emprise) out.push(`Emprise lue : ${fr(p.emprise.lueM2, 0)} m²${p.emprise.bdTopoM2 !== null && p.emprise.ecartPct !== null ? ` (base de l’IGN : ${fr(p.emprise.bdTopoM2, 0)} m², écart ${p.emprise.ecartPct > 0 ? '+' : ''}${fr(p.emprise.ecartPct, 0)} %)` : ''}.`);
  return out;
}
