// src/spaces/investisseur/services/dispositifs/index.ts
//
// Réexport du moteur des dispositifs fiscaux, partagé avec les edge functions.
//
// Le calcul vit dans supabase/functions/_shared/dispositifs/ : c'est la SEULE
// implémentation. Le front n'en possède pas de copie, exactement comme pour le
// moteur prédictif. Une divergence entre ce que le chat annonce et ce
// qu'affiche l'écran serait, sur un sujet fiscal, particulièrement fâcheuse.
//
// L'extension .ts dans le chemin est indispensable à Deno et tolérée par Vite
// grâce à `allowImportingTsExtensions` : c'est ce qui rend le partage possible
// sans étape de compilation.

export {
  calculerDenormandie,
  calculerJeanbrunAncien,
  calculerJeanbrunNeuf,
  calculerLocAvantages,
  coefficientStructure,
  FICHES_DISPOSITIFS,
  listerDispositifsClos,
  plafondLoyerIntermediaire,
  plafondLoyerLocAvantages,
  plafondsRessources,
  surfaceFiscale,
  trouverDispositifClos,
} from "@shared/dispositifs/engine.ts";

export {
  DISPOSITIFS_CLOS,
  MILLESIME_BAREMES,
  PLAFOND_NICHES_EUR,
  PLAFONDS_LOYER_INTERMEDIAIRE_EUR_M2,
  PRELEVEMENTS_SOCIAUX_PCT,
  TAUX_AMORTISSEMENT_JEANBRUN,
  TAUX_DENORMANDIE_PCT,
  TAUX_LOC_AVANTAGES_PCT,
} from "@shared/dispositifs/baremes.ts";

export type {
  Constat,
  DenormandieInput,
  DispositifCode,
  DispositifFiche,
  DispositifResultat,
  JeanbrunInput,
  LocAvantagesInput,
  LogementInput,
  MecaniqueFiscale,
  NiveauConstat,
  NiveauLoyer,
  PlafondLoyerResultat,
  PlafondRessourcesResultat,
  ProjectionAnnuelle,
  SituationFiscale,
  ZoneAbc,
} from "@shared/dispositifs/types.ts";
