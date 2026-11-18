// supabase/functions/_shared/extension/planLu.ts
// =============================================================================
// LOT G6 (18/11/2026) — PLAN DE LA MAISON LU (ou cotes saisies) DANS LE PARCOURS D'EXTENSION. Module PUR.
//
// Le plan fourni par l'utilisateur est lu dans le Studio (lecture déterministe du lot D7a, dans le navigateur, sans
// modèle de langage) ; le site en reçoit un résumé (`planLu` du relevé) que la personne peut confirmer cote par cote
// dans la carte « Plan lu » du chat, ou remplacer par 2–3 cotes saisies. Le site le transmet au serveur dans le
// contexte de la page (`pageSnapshot`, clés `plan_lu_*`, valeurs simples) ; ce module le relit, le borne, et dit ce
// qu'il change dans le parcours :
//   · une ligne « Emprise lue sur votre plan » (statut : confirmée / mesurée (lue) / estimée) à côté de la BD TOPO ;
//   · un écart d'emprise de plus de 10 % avec la BD TOPO est SIGNALÉ (le moteur garde le contour BD TOPO) ;
//   · niveaux CONFIRMÉS dans la carte → réponse à la question « Niveaux de la maison » ;
//   · surface des pièces lue → une puce « Celle de mon plan (≈ N m²) » à la question de la surface de plancher : la
//     personne la choisit (somme des pièces, dite telle quelle ; jamais présentée comme la surface de plancher
//     réglementaire sans son accord).
// Rien n'est inventé : une clé absente ou hors bornes est ignorée.
// =============================================================================

export const FORMAT_PLAN_LU_PARCOURS = 'mimmoza-plan-lu-parcours';
/** Écart d'emprise plan lu / BD TOPO au-delà duquel la lecture est signalée (fraction). */
export const SEUIL_ECART_EMPRISE_PLAN = 0.10;
/** Libellé de la puce « surface de plancher depuis le plan » (le nombre suit entre parenthèses). */
export const OPTION_SURFACE_PLAN = 'Celle de mon plan';

export type StatutPlanLu = 'confirme' | 'lu' | 'mesure' | 'deduit' | 'suppose' | 'a-confirmer';
const STATUTS: readonly StatutPlanLu[] = ['confirme', 'lu', 'mesure', 'deduit', 'suppose', 'a-confirmer'];
export type SourcePlanLu = 'import-plan' | 'saisie';

export interface PlanLuParcours {
  readonly v: 1;
  readonly source: SourcePlanLu;
  /** Nom du fichier lu (ou « cotes saisies »). */
  readonly origine: string;
  /** Date de la lecture ou de la saisie (AAAA-MM-JJ). */
  readonly le: string | null;
  readonly longueurM: number | null;
  readonly largeurM: number | null;
  readonly statutDimensions: StatutPlanLu | null;
  readonly empriseM2: number | null;
  readonly statutEmprise: StatutPlanLu | null;
  readonly niveaux: number | null;
  readonly statutNiveaux: StatutPlanLu | null;
  readonly surfacePiecesM2: number | null;
  readonly statutSurfacePieces: StatutPlanLu | null;
  readonly nbPieces: number | null;
  readonly echelle: string | null;
  readonly douteux: readonly string[];
  /** FINITIONS 18/11 — pièces posées sur l'emprise BD TOPO (relatives à son centre), pour l'existant des plans. */
  readonly interieur?: InterieurPlanLu | null;
}

export interface InterieurPlanLu {
  readonly reference: 'centre-emprise-v1';
  readonly batiment_id: string;
  readonly pieces: readonly { readonly nom: string | null; readonly niveau: string; readonly surface_m2: number; readonly statut: StatutPlanLu; readonly anneau: readonly (readonly [number, number])[] }[];
}

/** Intérieur posé (objet, ou JSON du contexte de la page ≤ 60 000 caractères) ; mal formé : écarté. Pur. */
export function lireInterieurPlanLu(brut: unknown): InterieurPlanLu | null {
  let v: unknown = brut;
  if (typeof brut === 'string') {
    if (brut.length > 60_000) return null;
    try { v = JSON.parse(brut); } catch { return null; }
  }
  if (!estObj(v) || v.reference !== 'centre-emprise-v1') return null;
  const id = txt(v.batiment_id, 80);
  if (!id || !Array.isArray(v.pieces)) return null;
  const pieces: InterieurPlanLu['pieces'][number][] = [];
  for (const p of v.pieces.slice(0, 60)) {
    if (!estObj(p) || !Array.isArray(p.anneau) || p.anneau.length < 3 || p.anneau.length > 40) continue;
    const surf = nb(p.surface_m2, 0.5, 2_000);
    const s = statut(p.statut);
    const niveau = typeof p.niveau === 'string' && /^L\d{1,2}$/.test(p.niveau) ? p.niveau : null;
    const anneau = p.anneau.map((q) => (Array.isArray(q) && q.length === 2 && typeof q[0] === 'number' && typeof q[1] === 'number' && Math.abs(q[0]) <= 150 && Math.abs(q[1]) <= 150 ? [q[0], q[1]] as const : null));
    if (surf === null || !s || !niveau || anneau.some((q) => q === null)) continue;
    pieces.push({ nom: txt(p.nom, 60), niveau, surface_m2: surf, statut: s, anneau: anneau as (readonly [number, number])[] });
  }
  return pieces.length ? { reference: 'centre-emprise-v1', batiment_id: id, pieces } : null;
}

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const nb = (v: unknown, min: number, max: number): number | null => {
  const x = typeof v === 'string' && v.trim() !== '' ? Number(v.replace(',', '.')) : v;
  return typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max ? x : null;
};
const statut = (v: unknown): StatutPlanLu | null => (STATUTS.includes(v as StatutPlanLu) ? v as StatutPlanLu : null);
const txt = (v: unknown, n: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
const fr = (v: number, d = 1): string => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('fr-FR', { maximumFractionDigits: d }).replace(/ | /g, ' ');

/** Paire (valeur, statut) : une valeur sans statut reconnu est ignorée (jamais un statut supposé à sa place). */
function paire(v: unknown, s: unknown, min: number, max: number): { valeur: number | null; statut: StatutPlanLu | null } {
  const x = nb(v, min, max);
  const st = statut(s);
  return x !== null && st ? { valeur: x, statut: st } : { valeur: null, statut: null };
}

/**
 * Relit le plan lu depuis le contexte de la page (`pageSnapshot`, clés `plan_lu_*`) ou depuis un état stocké (même
 * forme, objet `PlanLuParcours`). null si rien d'exploitable. Pur.
 */
export function lirePlanLu(brut: unknown): PlanLuParcours | null {
  if (!estObj(brut)) return null;
  // Forme stockée (état du parcours).
  if (brut.v === 1 && (brut.source === 'import-plan' || brut.source === 'saisie')) {
    return normaliser({
      source: brut.source, origine: brut.origine, le: brut.le,
      longueur: brut.longueurM, largeur: brut.largeurM, sDim: brut.statutDimensions,
      emprise: brut.empriseM2, sEmp: brut.statutEmprise, niveaux: brut.niveaux, sNiv: brut.statutNiveaux,
      surface: brut.surfacePiecesM2, sSurf: brut.statutSurfacePieces, nbPieces: brut.nbPieces, echelle: brut.echelle,
      douteux: Array.isArray(brut.douteux) ? brut.douteux : [], interieur: brut.interieur,
    });
  }
  // Forme « contexte de la page » (valeurs simples).
  if (brut.plan_lu_v !== 1 && brut.plan_lu_v !== '1') return null;
  const source = brut.plan_lu_source === 'saisie' ? 'saisie' : brut.plan_lu_source === 'import-plan' ? 'import-plan' : null;
  if (!source) return null;
  return normaliser({
    source, origine: brut.plan_lu_origine, le: brut.plan_lu_le,
    longueur: brut.plan_lu_longueur_m, largeur: brut.plan_lu_largeur_m, sDim: brut.plan_lu_dimensions_statut,
    emprise: brut.plan_lu_emprise_m2, sEmp: brut.plan_lu_emprise_statut,
    niveaux: brut.plan_lu_niveaux, sNiv: brut.plan_lu_niveaux_statut,
    surface: brut.plan_lu_surface_pieces_m2, sSurf: brut.plan_lu_surface_pieces_statut,
    nbPieces: brut.plan_lu_nb_pieces, echelle: brut.plan_lu_echelle,
    douteux: typeof brut.plan_lu_douteux === 'string' ? brut.plan_lu_douteux.split(' | ') : [],
    interieur: brut.plan_lu_interieur,
  });
}

function normaliser(e: {
  source: SourcePlanLu; origine: unknown; le: unknown; longueur: unknown; largeur: unknown; sDim: unknown; emprise: unknown; sEmp: unknown;
  niveaux: unknown; sNiv: unknown; surface: unknown; sSurf: unknown; nbPieces: unknown; echelle: unknown; douteux: unknown[]; interieur?: unknown;
}): PlanLuParcours | null {
  const L = nb(e.longueur, 1, 300), l = nb(e.largeur, 1, 300);
  const sDim = statut(e.sDim);
  const dimsOk = L !== null && l !== null && sDim !== null;
  const emp = paire(e.emprise, e.sEmp, 5, 50_000);
  const niv = paire(e.niveaux, e.sNiv, 1, 20);
  const surf = paire(e.surface, e.sSurf, 5, 100_000);
  const niveauxEntiers = niv.valeur !== null && Number.isInteger(niv.valeur);
  const le = typeof e.le === 'string' && /^\d{4}-\d{2}-\d{2}/.test(e.le) ? e.le.slice(0, 10) : null;
  const p: PlanLuParcours = {
    v: 1, source: e.source, origine: txt(e.origine, 160) ?? (e.source === 'saisie' ? 'cotes saisies' : 'plan fourni'), le,
    longueurM: dimsOk ? Math.max(L!, l!) : null, largeurM: dimsOk ? Math.min(L!, l!) : null, statutDimensions: dimsOk ? sDim : null,
    // Emprise : lue, sinon longueur × largeur (même statut, dit dans la source de la ligne).
    empriseM2: emp.valeur, statutEmprise: emp.statut,
    niveaux: niveauxEntiers ? niv.valeur : null, statutNiveaux: niveauxEntiers ? niv.statut : null,
    surfacePiecesM2: surf.valeur, statutSurfacePieces: surf.statut,
    nbPieces: nb(e.nbPieces, 1, 500) !== null && Number.isInteger(Number(e.nbPieces)) ? Number(e.nbPieces) : null,
    echelle: txt(e.echelle, 160),
    douteux: e.douteux.map((x) => txt(x, 300)).filter((x): x is string => !!x).slice(0, 12),
    ...(e.source === 'import-plan' && lireInterieurPlanLu(e.interieur) ? { interieur: lireInterieurPlanLu(e.interieur) } : {}),
  };
  return p.longueurM === null && p.empriseM2 === null && p.niveaux === null && p.surfacePiecesM2 === null ? null : p;
}

/** Le plus récent de deux plans lus (date, puis celui du contexte de la page). Pur. */
export function planLuRetenu(stocke: PlanLuParcours | null, recu: PlanLuParcours | null): PlanLuParcours | null {
  if (!recu) return stocke;
  if (!stocke) return recu;
  if (stocke.le && recu.le && recu.le < stocke.le) return stocke;
  return recu;
}

/** Statut du parcours (contrat `Donnee`) d'une valeur du plan lu. */
export function statutDonneePlan(s: StatutPlanLu): 'confirmee' | 'mesuree' | 'estimee' | 'supposee' {
  return s === 'confirme' ? 'confirmee' : s === 'lu' || s === 'mesure' ? 'mesuree' : s === 'suppose' ? 'supposee' : 'estimee';
}

const LIBELLE_STATUT: Readonly<Record<StatutPlanLu, string>> = {
  confirme: 'confirmé par vous', lu: 'lu sur votre plan', mesure: 'mesuré sur votre plan', deduit: 'déduit de votre plan', suppose: 'supposé', 'a-confirmer': 'à confirmer',
};
export const libelleStatutPlan = (s: StatutPlanLu): string => LIBELLE_STATUT[s];

/** Source lisible (liste des sources du parcours). Pur. */
export function sourcePlanLu(p: PlanLuParcours): string {
  const date = p.le ? `, le ${p.le.slice(8, 10)}/${p.le.slice(5, 7)}/${p.le.slice(0, 4)}` : '';
  return p.source === 'saisie'
    ? `Cotes de la maison saisies par vous${date}`
    : `Plan de la maison fourni par vous (« ${p.origine} »), lu dans le Studio${date} — lecture automatique, sans modèle de langage${p.echelle ? ` ; échelle ${p.echelle}` : ''}`;
}

export interface EffetsPlanLu {
  /** Ligne ajoutée au tableau de la maison (après « Emprise au sol »), ou null. */
  readonly ligne: { readonly libelle: string; readonly valeur: string; readonly statut: 'confirmee' | 'mesuree' | 'estimee' | 'supposee'; readonly source: string } | null;
  readonly avertissements: readonly string[];
  readonly source: string;
  /** Écart d'emprise (en %, signé) avec la BD TOPO ; null si non comparable. */
  readonly ecartPct: number | null;
  readonly ecartSignale: boolean;
  /** Niveaux CONFIRMÉS (carte du chat) : réponse à « Niveaux de la maison » ; null sinon. */
  readonly niveauxConfirmes: number | null;
  /** Puce de surface (« Celle de mon plan (≈ 132 m²) ») ; null sans surface des pièces lue. */
  readonly optionSurface: string | null;
}

/**
 * Ce que le plan lu change dans le parcours, pour une maison dont l'emprise BD TOPO est `empriseBdTopoM2`. Pur.
 * L'emprise comparée est l'emprise lue, sinon longueur × largeur (rectangle hors tout, qui majore une maison en L :
 * dit dans la source, et seul un écart > 10 % est signalé).
 */
export function effetsPlanLu(p: PlanLuParcours, empriseBdTopoM2: number): EffetsPlanLu {
  const av: string[] = [];
  const emp = p.empriseM2 !== null ? { v: p.empriseM2, s: p.statutEmprise!, rect: false }
    : p.longueurM !== null && p.largeurM !== null ? { v: p.longueurM * p.largeurM, s: p.statutDimensions!, rect: true } : null;
  const ecartPct = emp && empriseBdTopoM2 > 0 ? Math.round(((emp.v - empriseBdTopoM2) / empriseBdTopoM2) * 1000) / 10 : null;
  const ecartSignale = ecartPct !== null && Math.abs(ecartPct) > SEUIL_ECART_EMPRISE_PLAN * 100;
  const qui = p.source === 'saisie' ? 'vos cotes' : 'votre plan';
  if (ecartSignale) {
    av.push(`Emprise ${p.source === 'saisie' ? 'déduite de vos cotes' : 'lue sur votre plan'} : ${fr(emp!.v, 0)} m² contre ${fr(empriseBdTopoM2, 0)} m² dans la BD TOPO (écart ${ecartPct! > 0 ? '+' : ''}${fr(ecartPct!, 0)} %, plus de 10 %). Vérifiez que ${p.source === 'saisie' ? 'les cotes sont celles des murs extérieurs' : 'c’est bien le plan de cette maison et que son échelle est juste'} ; l’extension reste calculée sur le contour de la BD TOPO.`);
  }
  if (p.statutDimensions === 'a-confirmer' || p.statutDimensions === 'suppose') av.push(`Dimensions de la maison lues sur ${qui} : à confirmer dans la carte « Plan lu ».`);
  for (const d of p.douteux.slice(0, 3)) av.push(`Plan lu : ${d}`);
  const morceaux: string[] = [];
  if (emp) morceaux.push(`${fr(emp.v, 0)} m²`);
  if (p.longueurM !== null && p.largeurM !== null) morceaux.push(`${fr(p.longueurM, 2)} × ${fr(p.largeurM, 2)} m hors tout`);
  if (ecartPct !== null) morceaux.push(`écart ${ecartPct > 0 ? '+' : ''}${fr(ecartPct, 0)} % avec la BD TOPO`);
  const statutLigne = emp ? emp.s : p.statutDimensions;
  const ligne = morceaux.length && statutLigne
    ? {
      libelle: p.source === 'saisie' ? 'Emprise d’après vos cotes' : 'Emprise lue sur votre plan',
      valeur: morceaux.join(', '),
      statut: statutDonneePlan(statutLigne),
      source: `${sourcePlanLu(p)}${emp?.rect ? ' ; emprise = longueur × largeur hors tout (majorée pour une maison en L)' : ''} ; ${libelleStatutPlan(statutLigne)}`,
    }
    : null;
  return {
    ligne, avertissements: av, source: sourcePlanLu(p), ecartPct, ecartSignale,
    niveauxConfirmes: p.niveaux !== null && p.statutNiveaux === 'confirme' ? p.niveaux : null,
    optionSurface: p.surfacePiecesM2 !== null ? `${OPTION_SURFACE_PLAN} (≈ ${fr(p.surfacePiecesM2, 0)} m²)` : null,
  };
}

/** La réponse « Surface de plancher existante » vient-elle de la puce du plan ? Pur. */
export function surfaceChoisieDepuisPlan(texte: string): boolean {
  return /surface de plancher existante\s*:\s*celle de mon plan/i.test(texte.normalize('NFC'));
}

/** Phrase ajoutée à la question de la surface quand une surface des pièces est lue. Pur. */
export function texteSurfacePlan(p: PlanLuParcours): string | null {
  if (p.surfacePiecesM2 === null) return null;
  return ` Votre ${p.source === 'saisie' ? 'saisie' : 'plan'} donne **${fr(p.surfacePiecesM2, 0)} m² de pièces**${p.nbPieces ? ` (${p.nbPieces} pièce${p.nbPieces > 1 ? 's' : ''})` : ''} (${libelleStatutPlan(p.statutSurfacePieces!)}) : c’est la somme des pièces, proche de la surface de plancher sans lui être égale. Choisissez « ${OPTION_SURFACE_PLAN} » pour la retenir, ou écrivez la surface de vos documents.`;
}

/** Consigne pour le modèle quand un plan est joint au message (marqueur posé par le site). Pur. */
export const MARQUEUR_PLAN_JOINT = '[Plan de la maison joint';
export function planJointAuMessage(texte: string): boolean {
  return texte.includes(MARQUEUR_PLAN_JOINT);
}
/** Message envoyé par la carte « Plan lu » (« Plan de la maison : valeurs vérifiées… »), ou plan joint : le parcours suit. */
export function messagePlanPourLeParcours(texte: string): boolean {
  return planJointAuMessage(texte) || /^\s*plan de la maison\s*:/i.test(texte);
}
export const CONSIGNE_PLAN_JOINT =
  ' Un plan de la maison est joint : il est lu par Mimmoza dans le Studio (lecture automatique, carte « Plan lu »), PAS par toi : ' +
  'ne cite, n’estime ni ne calcule aucune cote, surface ou nombre de pièces de ce plan.';

/** Bloc `existant_lu` de la fiche d'un travail (plans de l'extension) : valeurs simples, statuts compris. Pur. */
export function existantLuPourFiche(p: PlanLuParcours, empriseBdTopoM2: number | null): Record<string, unknown> {
  const e = empriseBdTopoM2 && empriseBdTopoM2 > 0 ? effetsPlanLu(p, empriseBdTopoM2) : null;
  return {
    v: 1, source: p.source, origine: p.origine, le: p.le,
    longueur_m: p.longueurM, largeur_m: p.largeurM, dimensions_statut: p.statutDimensions,
    emprise_m2: p.empriseM2, emprise_statut: p.statutEmprise,
    niveaux: p.niveaux, niveaux_statut: p.statutNiveaux,
    surface_pieces_m2: p.surfacePiecesM2, surface_pieces_statut: p.statutSurfacePieces, nb_pieces: p.nbPieces,
    echelle: p.echelle, ecart_bdtopo_pct: e?.ecartPct ?? null, ecart_signale: e?.ecartSignale ?? false,
    mention: sourcePlanLu(p),
    ...(p.interieur ? { interieur: p.interieur } : {}),
  };
}
