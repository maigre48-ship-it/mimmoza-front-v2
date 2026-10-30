// src/spaces/copilot/agent/rapport/bilanCalcul.ts
// Calcul du bilan promoteur « à rebours » (charge foncière admissible), en JS.
// Mêmes règles que calculerChargeFonciere du moteur
// (supabase/functions/copilot-chat/agent/rapport.ts) ET que les formules de
// l'onglet « Bilan » écrites par bilanExcel.ts :
//   · hypothèse ESSENTIELLE vide → pas de résultat ;
//   · part sociale vide → calcul sans logement social, signalé ;
//   · taxes, VRD, démolition vides → non comptés, signalés « non chiffré » ;
//   · part sociale > 0 sans prix de cession → pas de résultat.
// Sert de valeur en cache dans le classeur et de contrôle dans les tests.
// Fractions : 0,08 = 8 %.
import { DEFINITIONS_HYPOTHESES, type CleHypothese, type JeuHypotheses, type Nombre } from './rapportModele.ts';

export type EntreesBilan = Record<CleHypothese, Nombre> & { surface_terrain_m2: Nombre; prix_negocie_eur: Nombre };

export type EtatBilan = 'complet' | 'partiel' | 'incomplet';

export interface ResultatBilan {
  /** Hypothèses à renseigner (essentielles + secondaires + prix LLS si besoin). */
  postesManquants: number;
  /** Hypothèses dont l'absence empêche tout résultat. */
  postesBloquants: number;
  etat: EtatBilan;
  caLibre: Nombre; caLls: Nombre; ca: Nombre;
  travaux: Nombre; honoraires: Nombre; aleas: Nombre;
  /** `null` = non chiffré (compté 0 dans le total, et signalé). */
  demolition: Nombre; vrd: Nombre; taxes: Nombre;
  commercialisation: Nombre; fraisFinanciers: Nombre;
  coutsHorsFoncier: Nombre;
  margeCible: Nombre;
  chargeFonciere: Nombre; chargeFonciereM2Terrain: Nombre; chargeFonciereM2Sdp: Nombre;
  prixNegocie: Nombre; fraisAcquisition: Nombre; margeReelle: Nombre; margeReellePct: Nombre;
}

const ok = (...v: Nombre[]) => v.every((x) => x != null);

export function entreesDepuisJeu(jeu: JeuHypotheses, surface: Nombre, prixNegocie: Nombre = null): EntreesBilan {
  const e = { surface_terrain_m2: surface, prix_negocie_eur: prixNegocie } as EntreesBilan;
  for (const d of DEFINITIONS_HYPOTHESES) e[d.cle] = jeu[d.cle]?.valeur ?? null;
  return e;
}

const llsSansPrix = (e: EntreesBilan) => (e.part_lls_pct ?? 0) > 0 && e.prix_cession_lls_eur_m2_shab == null;

export function postesManquants(e: EntreesBilan): number {
  return DEFINITIONS_HYPOTHESES.filter((d) => d.requise && e[d.cle] == null).length + (llsSansPrix(e) ? 1 : 0);
}
export function postesBloquants(e: EntreesBilan): number {
  return DEFINITIONS_HYPOTHESES.filter((d) => d.role === 'essentielle' && e[d.cle] == null).length + (llsSansPrix(e) ? 1 : 0);
}

export function calculerBilan(e: EntreesBilan): ResultatBilan {
  const manquants = postesManquants(e), bloquants = postesBloquants(e);
  const shab = e.shab_m2, prix = e.prix_vente_libre_eur_m2_shab;
  const lls = e.part_lls_pct ?? 0;
  const caLibre = ok(shab, prix) ? shab! * (1 - lls) * prix! : null;
  const caLls = shab == null ? null : lls === 0 ? 0 : e.prix_cession_lls_eur_m2_shab != null ? shab * lls * e.prix_cession_lls_eur_m2_shab : null;
  const ca = ok(caLibre, caLls) ? caLibre! + caLls! : null;
  const travaux = ok(e.sdp_m2, e.cout_travaux_eur_m2_sdp) ? e.sdp_m2! * e.cout_travaux_eur_m2_sdp! : null;
  const honoraires = ok(travaux, e.honoraires_pct_travaux) ? travaux! * e.honoraires_pct_travaux! : null;
  const aleas = ok(travaux, e.aleas_pct_travaux) ? travaux! * e.aleas_pct_travaux! : null;
  const commercialisation = ok(ca, e.commercialisation_pct_ca) ? ca! * e.commercialisation_pct_ca! : null;
  const fraisFinanciers = ok(ca, e.frais_financiers_pct_ca) ? ca! * e.frais_financiers_pct_ca! : null;
  const indispensables = [travaux, honoraires, aleas, commercialisation, fraisFinanciers];
  const coutsHorsFoncier = ok(...indispensables)
    ? indispensables.reduce<number>((s, x) => s + x!, 0) + (e.demolition_eur ?? 0) + (e.vrd_eur ?? 0) + (e.taxes_urbanisme_eur ?? 0)
    : null;
  const margeCible = ok(ca, e.marge_cible_pct_ca) ? ca! * e.marge_cible_pct_ca! : null;
  const chargeFonciere = ok(ca, coutsHorsFoncier, e.marge_cible_pct_ca, e.frais_acquisition_pct_foncier)
    ? (ca! * (1 - e.marge_cible_pct_ca!) - coutsHorsFoncier!) / (1 + e.frais_acquisition_pct_foncier!) : null;
  const nego = e.prix_negocie_eur;
  const fraisAcquisition = ok(nego, e.frais_acquisition_pct_foncier) ? nego! * e.frais_acquisition_pct_foncier! : null;
  const margeReelle = ok(nego, ca, coutsHorsFoncier, e.frais_acquisition_pct_foncier)
    ? ca! - coutsHorsFoncier! - nego! * (1 + e.frais_acquisition_pct_foncier!) : null;
  return {
    postesManquants: manquants,
    postesBloquants: bloquants,
    etat: bloquants > 0 ? 'incomplet' : manquants > 0 ? 'partiel' : 'complet',
    caLibre, caLls, ca, travaux, honoraires, aleas,
    demolition: e.demolition_eur, vrd: e.vrd_eur, taxes: e.taxes_urbanisme_eur,
    commercialisation, fraisFinanciers, coutsHorsFoncier, margeCible, chargeFonciere,
    chargeFonciereM2Terrain: chargeFonciere != null && e.surface_terrain_m2 ? chargeFonciere / e.surface_terrain_m2 : null,
    chargeFonciereM2Sdp: chargeFonciere != null && e.sdp_m2 ? chargeFonciere / e.sdp_m2 : null,
    prixNegocie: nego, fraisAcquisition, margeReelle,
    margeReellePct: margeReelle != null && ca ? margeReelle / ca : null,
  };
}

/** Phrase d'état, identique à celle que calcule la formule Excel. */
export function libelleEtatBilan(r: Pick<ResultatBilan, 'etat' | 'postesManquants' | 'postesBloquants'>): string {
  if (r.etat === 'incomplet') return `Bilan incomplet : ${r.postesBloquants} poste(s) indispensable(s) à renseigner`;
  if (r.etat === 'partiel') return `Bilan partiel : ${r.postesManquants} poste(s) non chiffré(s), comptés à 0`;
  return 'Bilan complet';
}

/** Charge foncière avec un prix de vente et un coût de travaux modifiés (onglet Sensibilité). */
export function chargeFonciereSensibilite(e: EntreesBilan, variationPrix: number, variationCout: number): Nombre {
  if (postesBloquants(e) > 0) return null;
  return calculerBilan({
    ...e,
    prix_vente_libre_eur_m2_shab: e.prix_vente_libre_eur_m2_shab! * (1 + variationPrix),
    cout_travaux_eur_m2_sdp: e.cout_travaux_eur_m2_sdp! * (1 + variationCout),
  }).chargeFonciere;
}
