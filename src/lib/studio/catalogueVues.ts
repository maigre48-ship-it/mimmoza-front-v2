// src/lib/studio/catalogueVues.ts
// =============================================================================
// VIS-04 (18/11/2026) — CATALOGUE COMMUN DES VUES (mimmozia-studio docs/vis/COORDINATION.md).
//
// Identifiants communs à Mimmoza, au contrat `mimmoza-projet-v2` (VUES_CATALOGUE_V2), à la base
// (_studio_job_options_valides) et à la machine de rendu : NE PAS RENOMMER.
//
// Statut d'une vue :
//   · « disponible »     : la machine de rendu sait la produire aujourd'hui → cochable ;
//   · « sous_condition » : VIS-10 — produite par la machine de rendu SI le projet a l'espace voulu (terrasse,
//                          balcon, jardin privatif, toit-terrasse accessible, logement témoin) ; cochable, la
//                          condition est affichée ; sinon la machine la refuse AVEC sa raison (`vues_non_produites`) ;
//   · « bientot »        : vue prévue mais pas encore produite → AFFICHÉE grisée « bientôt », jamais cachée.
// Les vues extérieures du lot VIS-03 (angle de rue, aérienne, entrée, cœur d'îlot) sont LIVRÉES par le worker
// (mimmozia-studio worker/src/catalogueVues.ts : `livree`) : VUES_VIS03_ACTIVES = true. ORDRE DE MISE EN SERVICE :
// appliquer la migration 20261118180000_studio_image_vues_catalogue AVANT de redéployer copilot-chat / le front,
// sinon la base refuse les travaux qui demandent ces vues (le devis le dit : « image non activée »).
// Repli : repasser VUES_VIS03_ACTIVES à false RETIRE du choix les 4 vues VIS-03 (elles redeviennent « bientôt ») —
// VIS-14 : ce n'est PAS « exactement le comportement d'avant ». Ce drapeau ne rend pas : la pré-sélection d'avant
// (désormais rétablie par défaut : vues du brief projet enregistrées, sinon UNE vue 3/4 gauche ; voir FilmVisitePanel),
// ni la caméra piéton, le côté rue et la livraison d'avant (côté machine de rendu : MIMMOZIA_VIS_REPLI=1 dans
// worker/.env), ni l'application du brief projet. Pour la livraison commerciale : VUES_VIS_INT2_ACTIVES = false.
// VIS-10 (19/11/2026) — alignement sur le worker après VIS-INT-2 (mimmozia-studio worker/src/catalogueVues.ts :
// privatifs VIS-06 et séjour / chambre / vue_baie VIS-05 LIVRÉS, hall non livré) : ces 7 vues passent « sous
// condition » derrière VUES_VIS_INT2_ACTIVES (repli : false ⇒ catalogue VIS-04, elles redeviennent « bientôt », ET
// aucune clé `livraison` n'est plus envoyée — livraisonCommerciale.ts ; le worker garde sa règle « pack en finale »). La base les accepte déjà (migration 20261118180000) ; aucune migration nouvelle n'est nécessaire
// pour elles.
// Code PUR : partagé par le front (FilmVisitePanel, carte du devis, Style & tendances) et l'Edge Function.
// =============================================================================

import { VUES_CATALOGUE_V2, type VueV2 } from '../../spaces/promoteur/shared/echangeStudio/mimmozaProjetV2.ts';

export type VueCatalogue = VueV2;
export const VUES_CATALOGUE: readonly VueCatalogue[] = VUES_CATALOGUE_V2;

/** Interrupteur unique des vues extérieures du lot VIS-03 (voir l'en-tête). */
export const VUES_VIS03_ACTIVES = true;

/** VIS-10 — interrupteur des vues « sous condition » (privatifs VIS-06, intérieurs VIS-05) ; repli : false. */
export const VUES_VIS_INT2_ACTIVES = true;

/** Vues au plus par image (worker : MAX_VUES_PAR_IMAGE = 6 ; base : migration VIS-04). */
export const MAX_VUES_PAR_IMAGE = 6;

/** Vues que la machine de rendu produit déjà (avant le chantier VIS). */
const VUES_HISTORIQUES: readonly VueCatalogue[] = ['trois_quarts_gauche', 'trois_quarts_droite', 'face'];
/** Vues extérieures livrées par le lot VIS-03. */
const VUES_VIS03: readonly VueCatalogue[] = ['angle_rue', 'aerienne', 'entree', 'coeur_ilot'];
/** VIS-10 — vues livrées par le worker (VIS-INT-2) mais seulement si le projet a l'espace voulu. */
export const VUES_SOUS_CONDITION: readonly VueCatalogue[] = ['terrasse', 'balcon', 'jardin_prive', 'rooftop', 'sejour', 'chambre', 'vue_baie'];

/** VIS-10 — condition d'une vue « sous condition », en clair (miroir des refus du worker : privatifs.ts, interieursImage.ts). */
export const CONDITION_VUE: Readonly<Partial<Record<VueCatalogue, string>>> = {
  terrasse: 'si le projet a une terrasse (d’attique ou de gradin)',
  balcon: 'si le projet a des balcons ou des loggias',
  jardin_prive: 'si un jardin privatif est attenant au rez-de-chaussée',
  rooftop: 'si le projet a un toit-terrasse accessible',
  sejour: 'si un logement témoin de collectif peut être aménagé',
  chambre: 'si un logement témoin de collectif peut être aménagé',
  vue_baie: 'si un logement témoin peut être aménagé et le voisinage est relevé',
};

export type GroupeVue = 'exterieur' | 'privatif' | 'interieur';
export interface VueDuCatalogue {
  id: VueCatalogue;
  libelle: string;
  /** Libellé en minuscules pour les phrases (« 3/4 gauche, aérienne »). */
  court: string;
  groupe: GroupeVue;
  statut: 'disponible' | 'sous_condition' | 'bientot';
  /** VIS-10 — condition affichée pour une vue « sous condition ». */
  condition?: string;
}

const DESCRIPTION: Record<VueCatalogue, { libelle: string; court: string; groupe: GroupeVue }> = {
  trois_quarts_gauche: { libelle: '3/4 gauche', court: '3/4 gauche', groupe: 'exterieur' },
  trois_quarts_droite: { libelle: '3/4 droite', court: '3/4 droite', groupe: 'exterieur' },
  face: { libelle: 'Face', court: 'face', groupe: 'exterieur' },
  angle_rue: { libelle: 'Angle de rue', court: 'angle de rue', groupe: 'exterieur' },
  aerienne: { libelle: 'Vue aérienne', court: 'aérienne', groupe: 'exterieur' },
  entree: { libelle: 'Entrée', court: 'entrée', groupe: 'exterieur' },
  coeur_ilot: { libelle: 'Cœur d’îlot', court: 'cœur d’îlot', groupe: 'exterieur' },
  terrasse: { libelle: 'Terrasse', court: 'terrasse', groupe: 'privatif' },
  balcon: { libelle: 'Balcon', court: 'balcon', groupe: 'privatif' },
  jardin_prive: { libelle: 'Jardin privé', court: 'jardin privé', groupe: 'privatif' },
  rooftop: { libelle: 'Rooftop', court: 'rooftop', groupe: 'privatif' },
  sejour: { libelle: 'Séjour', court: 'séjour', groupe: 'interieur' },
  chambre: { libelle: 'Chambre', court: 'chambre', groupe: 'interieur' },
  vue_baie: { libelle: 'Vue depuis la baie', court: 'vue depuis la baie', groupe: 'interieur' },
  hall: { libelle: 'Hall', court: 'hall', groupe: 'interieur' },
};

export const LIBELLES_GROUPE_VUE: Record<GroupeVue, string> = { exterieur: 'Extérieur', privatif: 'Extérieurs privatifs', interieur: 'Intérieur' };

/** Vues produisibles aujourd'hui (ordre du catalogue). */
export function vuesDisponibles(vis03 = VUES_VIS03_ACTIVES, int2 = VUES_VIS_INT2_ACTIVES): VueCatalogue[] {
  return VUES_CATALOGUE.filter((v) => VUES_HISTORIQUES.includes(v) || (vis03 && VUES_VIS03.includes(v)) || (int2 && VUES_SOUS_CONDITION.includes(v)));
}
export const VUES_DISPONIBLES: readonly VueCatalogue[] = vuesDisponibles();

/** Le catalogue complet, avec le statut de chaque vue (rien n'est caché). */
export function catalogueVues(vis03 = VUES_VIS03_ACTIVES, int2 = VUES_VIS_INT2_ACTIVES): VueDuCatalogue[] {
  const dispo = vuesDisponibles(vis03, int2);
  return VUES_CATALOGUE.map((id) => {
    if (!dispo.includes(id)) return { id, ...DESCRIPTION[id], statut: 'bientot' as const };
    const condition = VUES_SOUS_CONDITION.includes(id) ? CONDITION_VUE[id] : undefined;
    return condition ? { id, ...DESCRIPTION[id], statut: 'sous_condition' as const, condition } : { id, ...DESCRIPTION[id], statut: 'disponible' as const };
  });
}

/** VIS-10 — une vue du catalogue est-elle cochable (disponible, ou sous condition) ? */
export const vueCochable = (c: Pick<VueDuCatalogue, 'statut'>): boolean => c.statut !== 'bientot';

export const libelleVue = (v: VueCatalogue): string => DESCRIPTION[v]?.libelle ?? v;
export const libelleCourtVue = (v: VueCatalogue): string => DESCRIPTION[v]?.court ?? v;
export const estVueCatalogue = (v: unknown): v is VueCatalogue => typeof v === 'string' && (VUES_CATALOGUE as readonly string[]).includes(v);

/** Pack plaquette commerciale (COORDINATION.md ; identique au worker : PACKS.pack_plaquette). */
export const PACK_PLAQUETTE: readonly VueCatalogue[] = ['trois_quarts_gauche', 'trois_quarts_droite', 'aerienne', 'coeur_ilot', 'terrasse', 'sejour'];

/** Vues pré-cochées : le pack plaquette, restreint à ce qui est produisible (le reste reste affiché « bientôt »). */
export function vuesPreCochees(vis03 = VUES_VIS03_ACTIVES, int2 = VUES_VIS_INT2_ACTIVES): VueCatalogue[] {
  const dispo = vuesDisponibles(vis03, int2);
  const pack = PACK_PLAQUETTE.filter((v) => dispo.includes(v));
  return pack.length ? VUES_CATALOGUE.filter((v) => pack.includes(v)) : [dispo[0]!];
}

/** « 3/4 gauche, 3/4 droite ou face » (liste lisible des vues disponibles). */
export function phraseVuesDisponibles(dispo: readonly VueCatalogue[] = VUES_DISPONIBLES): string {
  const l = dispo.map(libelleCourtVue);
  return l.length <= 1 ? (l[0] ?? '') : `${l.slice(0, -1).join(', ')} ou ${l[l.length - 1]}`;
}

/**
 * Vues choisies → vues à rendre : seulement des vues DISPONIBLES, sans doublon, dans l'ordre du catalogue.
 * Les vues « bientôt » éventuellement demandées sont rendues à part (`nonProduites`) pour être DITES.
 */
export function vuesARendre(choisies: readonly unknown[], dispo: readonly VueCatalogue[] = VUES_DISPONIBLES): { vues: VueCatalogue[]; nonProduites: VueCatalogue[]; inconnues: string[] } {
  const inconnues = choisies.filter((v) => !estVueCatalogue(v)).map((v) => String(v));
  const connues = choisies.filter(estVueCatalogue);
  return {
    vues: VUES_CATALOGUE.filter((v) => connues.includes(v) && dispo.includes(v)),
    nonProduites: VUES_CATALOGUE.filter((v) => connues.includes(v) && !dispo.includes(v)),
    inconnues,
  };
}

/* ───────────── VIS-10 — pronostic des vues « sous condition » pour le devis ───────────── */

/**
 * Indices connus AU MOMENT DU DEVIS (habillage du brief de la 3D préparée) ; tout champ absent = inconnu.
 * Rien n'est déduit de la géométrie : seule la machine de rendu tranche (refus motivé dans `vues_non_produites`).
 */
export interface IndicesProjetVues {
  balcons?: 'balcons' | 'balcons_filants' | 'loggias' | 'aucun' | null;
  attique?: boolean | null;
  toiture?: string | null;
  rdc?: string | null;
}

export interface PronosticVue {
  vue: VueCatalogue;
  libelle: string;
  /** « probablement_refusee » : un indice du projet contredit la condition ; « selon_projet » : la machine tranchera. */
  pronostic: 'probablement_refusee' | 'selon_projet';
  raison: string;
}

/** Pronostic des vues demandées « sous condition » (les autres ne figurent pas). Pur. */
export function pronosticVues(vues: readonly unknown[], indices: IndicesProjetVues | null | undefined, int2 = VUES_VIS_INT2_ACTIVES): PronosticVue[] {
  if (!int2) return [];
  const i = indices ?? {};
  return VUES_CATALOGUE.filter((v) => vues.includes(v) && VUES_SOUS_CONDITION.includes(v)).map((vue) => {
    let refus: string | null = null;
    if (vue === 'balcon' && i.balcons === 'aucun') refus = 'l’habillage ne prévoit aucun balcon ni loggia';
    if (vue === 'terrasse' && i.attique === false) refus = 'l’habillage ne prévoit pas d’attique (seule une terrasse de gradin la permettrait)';
    if (vue === 'rooftop' && typeof i.toiture === 'string' && i.toiture.startsWith('deux_pans')) refus = 'toit à deux pans : aucun toit-terrasse accessible';
    if (vue === 'jardin_prive' && i.rdc === 'commerces') refus = 'rez-de-chaussée commercial : aucun jardin privatif attenant';
    return refus
      ? { vue, libelle: libelleVue(vue), pronostic: 'probablement_refusee' as const, raison: refus }
      : { vue, libelle: libelleVue(vue), pronostic: 'selon_projet' as const, raison: `selon le projet — produite ${CONDITION_VUE[vue] ?? ''}`.trim() };
  });
}

/** Phrases du devis pour le pronostic (une par vue). Pur. */
export function phrasesPronosticVues(p: readonly PronosticVue[]): string[] {
  return p.map((x) => x.pronostic === 'probablement_refusee'
    ? `Vue « ${x.libelle} » : sera probablement refusée par la machine de rendu (${x.raison}) ; les autres vues seront produites.`
    : `Vue « ${x.libelle} » : ${x.raison} ; sinon la machine de rendu la refuse et dit pourquoi.`);
}
