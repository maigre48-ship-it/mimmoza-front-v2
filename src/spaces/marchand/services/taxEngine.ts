export type TaxRegime = "marchand" | "particulier" | "societe_is";

export type VatMode = "none" | "margin" | "total";

export type TaxConfig = {
  regime: TaxRegime;

  // TVA
  vatMode: VatMode;
  vatRatePct: number; // ex 20
  // Si TVA sur marge : assiette = max(0, (prixRevente - prixAchatHT - travauxHT - autresHT ...))
  // On laisse paramétrable la part HT des coûts via vatRecoverablePct (approx)
  vatRecoverablePct: number; // 0..100 (si société récupère de la TVA sur travaux etc)

  // Droits de mutation / DMTO
  dmtoRatePct: number; // ex 5.80
  dmtoFixed: number;   // ex frais fixes
  dmtoEnabled: boolean;

  // Impôts
  // Particulier
  irRatePct: number;         // IR sur PV (si applicable)
  socialRatePct: number;     // prélèvements sociaux
  // Société IS
  isRatePct: number;         // IS sur résultat
};

export type DealInputs = {
  prixAchat: number;
  travaux: number;
  autresFrais: number;
  fraisNotairePct: number;  // si tu veux garder ce champ à part
  fraisAgencePct: number;
  prixRevente: number;
  fraisVentePct: number;
};

export type TaxBreakdown = {
  // Acquisition
  fraisNotaire: number;
  fraisAgenceAchat: number;
  dmto: number;

  // Revente
  fraisVente: number;

  // TVA
  vatDue: number;
  vatRecoverable: number;
  vatNet: number;

  // Impôts
  ir: number;
  social: number;
  is: number;

  // Résultat
  netVenteApresFraisEtTaxes: number;
};

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const nn = (n: number) => (Number.isFinite(n) ? n : 0);

export function getDefaultTaxConfig(regime: TaxRegime): TaxConfig {
  if (regime === "marchand") {
    return {
      regime,
      vatMode: "margin",
      vatRatePct: 20,
      vatRecoverablePct: 0, // à ajuster (si tu récupères TVA sur travaux, mets 100)
      dmtoEnabled: true,
      dmtoRatePct: 5.8,
      dmtoFixed: 0,
      irRatePct: 0,
      socialRatePct: 0,
      isRatePct: 0,
    };
  }
  if (regime === "societe_is") {
    return {
      regime,
      vatMode: "margin",
      vatRatePct: 20,
      vatRecoverablePct: 100, // souvent on récupère TVA sur travaux si factures TVA
      dmtoEnabled: true,
      dmtoRatePct: 5.8,
      dmtoFixed: 0,
      irRatePct: 0,
      socialRatePct: 0,
      isRatePct: 25, // par défaut, à ajuster
    };
  }
  // particulier
  return {
    regime,
    vatMode: "none",
    vatRatePct: 0,
    vatRecoverablePct: 0,
    dmtoEnabled: true,
    dmtoRatePct: 5.8,
    dmtoFixed: 0,
    irRatePct: 19,        // PV immo (indicatif)
    socialRatePct: 17.2,  // prélèvements sociaux (indicatif)
    isRatePct: 0,
  };
}

/**
 * Calcule le net de vente après frais/TVA/impôts selon config.
 * Modèle paramétrable : "précis" au sens déterministe selon tes paramètres.
 */
export function computeNetAfterTaxes(input: DealInputs, tax: TaxConfig): TaxBreakdown {
  const prixAchat = Math.max(0, nn(input.prixAchat));
  const travaux = Math.max(0, nn(input.travaux));
  const autres = Math.max(0, nn(input.autresFrais));
  const prixRevente = Math.max(0, nn(input.prixRevente));

  const fraisNotaire = prixAchat * (Math.max(0, nn(input.fraisNotairePct)) / 100);
  const fraisAgenceAchat = prixAchat * (Math.max(0, nn(input.fraisAgencePct)) / 100);

  const dmto = tax.dmtoEnabled
    ? prixAchat * (Math.max(0, nn(tax.dmtoRatePct)) / 100) + Math.max(0, nn(tax.dmtoFixed))
    : 0;

  const fraisVente = prixRevente * (Math.max(0, nn(input.fraisVentePct)) / 100);

  // Coûts "de base" (hors TVA/impôts)
  const coutsAcq = prixAchat + fraisNotaire + fraisAgenceAchat + dmto;
  const coutsTotauxAvantTaxes = coutsAcq + travaux + autres;

  // TVA
  const vatRate = Math.max(0, nn(tax.vatRatePct)) / 100;
  const recoverPct = clamp(nn(tax.vatRecoverablePct), 0, 100) / 100;

  // Approche simple mais paramétrable :
  // - TVA due : selon mode (none/margin/total)
  // - TVA récupérable : recoverPct * TVA sur une base "travaux+autres" (approx)
  // NB: si tu veux séparer travaux HT/TTC plus tard, on le fera (v2).
  let vatDue = 0;

  if (tax.vatMode === "total") {
    vatDue = prixRevente * vatRate;
  } else if (tax.vatMode === "margin") {
    const margeAssiette = Math.max(0, prixRevente - prixAchat - travaux - autres);
    vatDue = margeAssiette * vatRate;
  }

  const vatRecoverable = (travaux + autres) * vatRate * recoverPct;
  const vatNet = Math.max(0, vatDue - vatRecoverable);

  // Résultat avant impôts (en incluant TVA nette comme charge)
  const netVenteAvantImpots = prixRevente - fraisVente - vatNet;

  const resultatAvantImpots = netVenteAvantImpots - coutsTotauxAvantTaxes;

  // Impôts selon régime
  let ir = 0, social = 0, is = 0;

  if (tax.regime === "particulier") {
    const basePV = Math.max(0, resultatAvantImpots);
    ir = basePV * (Math.max(0, nn(tax.irRatePct)) / 100);
    social = basePV * (Math.max(0, nn(tax.socialRatePct)) / 100);
  } else if (tax.regime === "societe_is") {
    const baseIS = Math.max(0, resultatAvantImpots);
    is = baseIS * (Math.max(0, nn(tax.isRatePct)) / 100);
  } else {
    // marchand : par défaut, pas d'IR/IS ici (selon structure),
    // on laisse paramétrable via isRatePct si tu veux activer.
    if (nn(tax.isRatePct) > 0) {
      const baseIS = Math.max(0, resultatAvantImpots);
      is = baseIS * (Math.max(0, nn(tax.isRatePct)) / 100);
    }
  }

  const netVenteApresFraisEtTaxes = netVenteAvantImpots - ir - social - is;

  return {
    fraisNotaire,
    fraisAgenceAchat,
    dmto,
    fraisVente,
    vatDue,
    vatRecoverable,
    vatNet,
    ir,
    social,
    is,
    netVenteApresFraisEtTaxes,
  };
}
