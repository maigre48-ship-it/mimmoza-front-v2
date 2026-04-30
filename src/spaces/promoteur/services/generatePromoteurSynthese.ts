// src/spaces/promoteur/services/generatePromoteurSynthese.ts
// v4.3 — Correction analyseMarche :
//   - Prix DVF réel (prixMoyenDvf) séparé du prix de vente projet (prixNeufM2)
//   - Position prix calculée vs DVF moyen quand disponible, vs prix neuf sinon
//   - Prime neuf/ancien calculée correctement depuis DVF
//   - Zéro invention : aucune valeur affichée si non présente dans les données

import type {
  PromoteurSynthese,
  PromoteurRawInput,
  AnomalieItem,
  ModuleQualite,
  RisqueItem,
  Scenario,
  ContrainteTechnique,
  RecommendationType,
  DataQualite,
  ModuleStatut,
} from './promoteurSynthese.types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function n(v: unknown, fallback = 0): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function isPresent(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'number') return Number.isFinite(v) && v !== 0;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function eur(v: number): string {
  return v.toLocaleString('fr-FR', {
    style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
  });
}

function computeReco(margePercent: number): RecommendationType {
  if (margePercent >= 15) return 'GO';
  if (margePercent >= 8) return 'GO_CONDITION';
  return 'NO_GO';
}

// ─── Moteur principal ─────────────────────────────────────────────────────────

export function generatePromoteurSynthese(raw: PromoteurRawInput): PromoteurSynthese {
  const foncier    = raw.foncier    ?? {};
  const plu        = raw.plu        ?? {};
  const conception = raw.conception ?? {};
  const marche     = raw.marche     ?? {};
  const risquesIn  = raw.risques    ?? {};
  const bilan      = raw.bilan      ?? {};

  // ─── Valeurs extraites ───────────────────────────────────────────────────

  const caTotal       = n(bilan.chiffreAffaires, 0);
  const sdp           = n(conception.surfacePlancher, 0);
  const emprise       = n(conception.empriseBatie, 0);
  const niveaux       = n(conception.nbNiveaux, 1);
  const nbLogements   = n(conception.nbLogements, 0);
  const hauteurProjet = n(conception.hauteurProjet, 0);
  const hauteurMaxPlu = n(plu.hauteurMax, 0);
  const programmeType = conception.programmeType ?? '';

  const coutFoncier        = n(bilan.coutFoncier ?? foncier.prixAcquisition, 0);
  const coutFoncierPresent = isPresent(bilan.coutFoncier) || isPresent(foncier.prixAcquisition);

  const margeNette        = n(bilan.margeNette, 0);
  const margeNettePercent = n(bilan.margeNettePercent, 0);
  const trnRendement      = n(bilan.trnRendement, 0);
  const coutTravaux       = n(bilan.coutTravaux, 0);
  const coutTravauxM2     = n(bilan.coutTravauxM2, 0);
  const coutFinanciers    = n(bilan.fraisFinanciers, 0);
  const fraisComm         = n(bilan.fraisCommercialisation, 0);
  const fraisGestion      = n(bilan.fraisGestion, 0);
  const coutRevientTotal  = caTotal - margeNette;

  const surfaceVendableEstim = sdp > 0 ? sdp * 0.82 : 1;
  const chiffreAffairesM2    = Math.round(caTotal / surfaceVendableEstim);
  const coutRevientM2        = coutRevientTotal > 0 ? Math.round(coutRevientTotal / surfaceVendableEstim) : 0;
  const bilancielRatio       = caTotal > 0 ? (coutFoncier / caTotal) * 100 : 0;
  const margeOpPct           = caTotal > 0
    ? ((caTotal - coutTravaux - coutFinanciers - fraisComm - fraisGestion) / caTotal) * 100
    : 0;

  // ─── DÉTECTION D'ANOMALIES ───────────────────────────────────────────────

  const anomalies: AnomalieItem[] = [];

  if (!coutFoncierPresent) {
    anomalies.push({
      id: 'FONCIER_ABSENT',
      niveau: 'CRITIQUE',
      module: 'Bilan',
      libelle: 'Coût foncier absent — marge et TRN non fiables',
      detail: `La marge affichée (${margeNettePercent.toFixed(1)}%) et le TRN (${trnRendement.toFixed(1)}%) sont calculés hors foncier. Ces indicateurs sont structurellement surestimés.`,
      actionRequise: 'Renseigner le prix d\'acquisition dans le Bilan.',
    });
  }

  if (caTotal <= 0) {
    anomalies.push({
      id: 'CA_NUL',
      niveau: 'CRITIQUE',
      module: 'Bilan',
      libelle: 'Chiffre d\'affaires nul ou absent',
      detail: 'Aucune recette calculée. Le bilan est vide.',
      actionRequise: 'Vérifier le prix de vente et la surface vendable dans le Bilan.',
    });
  }

  if (nbLogements === 1 && programmeType.toLowerCase().includes('collectif')) {
    anomalies.push({
      id: 'PROGRAMME_INCOHERENT',
      niveau: 'ALERTE',
      module: 'Conception',
      libelle: `1 logement qualifié de "${programmeType}"`,
      detail: 'Un programme mono-logement devrait être qualifié d\'individuel.',
      actionRequise: 'Ajuster le type de programme dans le Bilan.',
    });
  }

  if (hauteurProjet > 0 && hauteurMaxPlu > 0 && hauteurProjet > hauteurMaxPlu) {
    anomalies.push({
      id: 'HAUTEUR_DEPASSE_PLU',
      niveau: 'CRITIQUE',
      module: 'Conception / PLU',
      libelle: `Hauteur projet (${hauteurProjet} m) > hauteur max PLU (${hauteurMaxPlu} m)`,
      detail: `Dépassement de ${(hauteurProjet - hauteurMaxPlu).toFixed(1)} m.`,
      actionRequise: 'Réduire la hauteur du projet ou demander une dérogation.',
    });
  }

  if (isPresent(bilan.coutFoncier) && n(bilan.coutFoncier) === 0) {
    anomalies.push({
      id: 'FONCIER_ZERO',
      niveau: 'ALERTE',
      module: 'Bilan',
      libelle: 'Coût foncier renseigné à 0 €',
      detail: 'Un foncier à 0 € est incohérent sauf cas exceptionnel.',
      actionRequise: 'Vérifier et corriger le prix foncier dans le Bilan.',
    });
  }

  // ─── QUALITÉ PAR MODULE ──────────────────────────────────────────────────

  const qualiteParModule: ModuleQualite[] = [];

  {
    const manquants: string[] = [];
    const presents: string[] = [];
    if (isPresent(foncier.commune)) presents.push(`Commune : ${foncier.commune}`);
    else manquants.push('Commune');
    if (isPresent(foncier.surfaceTerrain)) presents.push(`Surface terrain : ${n(foncier.surfaceTerrain)} m²`);
    else manquants.push('Surface terrain');
    if (coutFoncierPresent) presents.push(`Prix acquisition : ${eur(coutFoncier)}`);
    else manquants.push('Prix d\'acquisition (CRITIQUE)');
    if (isPresent(foncier.codePostal)) presents.push(`CP : ${foncier.codePostal}`);
    else manquants.push('Code postal');
    const statut: ModuleStatut = manquants.some(m => m.includes('CRITIQUE'))
      ? 'INSUFFISANT'
      : manquants.length === 0 ? 'COMPLET' : 'PARTIEL';
    qualiteParModule.push({ module: 'Foncier', statut, donneesManquantes: manquants, donneesPresentes: presents });
  }

  {
    const manquants: string[] = [];
    const presents: string[] = [];
    if (isPresent(plu.zone)) presents.push(`Zone : ${plu.zone}`);
    else manquants.push('Zone PLU');
    if (isPresent(plu.hauteurMax)) presents.push(`Hauteur max : ${n(plu.hauteurMax)} m`);
    else manquants.push('Hauteur max');
    if (isPresent(plu.cub)) presents.push(`CES/CUB : ${n(plu.cub)}`);
    else manquants.push('CES / CUB (emprise max)');
    if (isPresent(plu.pleineTerre)) presents.push(`Pleine terre : ${Math.round(n(plu.pleineTerre) * 100)}%`);
    else manquants.push('Pleine terre min');
    const statut: ModuleStatut = manquants.length === 0 ? 'COMPLET'
      : manquants.length <= 2 ? 'PARTIEL' : 'INSUFFISANT';
    qualiteParModule.push({ module: 'PLU', statut, donneesManquantes: manquants, donneesPresentes: presents });
  }

  {
    const manquants: string[] = [];
    const presents: string[] = [];
    if (sdp > 0) presents.push(`SDP : ${Math.round(sdp)} m²`);
    else manquants.push('Surface de plancher');
    if (nbLogements > 0) presents.push(`${nbLogements} logement${nbLogements > 1 ? 's' : ''}`);
    else manquants.push('Nombre de logements');
    if (niveaux > 0) presents.push(`${niveaux} niveau${niveaux > 1 ? 'x' : ''}`);
    else manquants.push('Nombre de niveaux');
    if (hauteurProjet > 0) presents.push(`Hauteur projet : ${hauteurProjet} m`);
    else manquants.push('Hauteur projet');
    const anomConc = anomalies.filter(a => a.module === 'Conception');
    anomConc.forEach(a => manquants.push(`⚠ ${a.libelle}`));
    qualiteParModule.push({ module: 'Conception', statut: manquants.length === 0 ? 'COMPLET' : 'PARTIEL', donneesManquantes: manquants, donneesPresentes: presents });
  }

  {
    const manquants: string[] = [];
    const presents: string[] = [];
    if (isPresent(marche.prixNeufM2)) presents.push(`Prix neuf : ${n(marche.prixNeufM2).toLocaleString('fr-FR')} €/m²`);
    else manquants.push('Prix neuf/m²');
    if (isPresent(marche.prixAncienM2)) presents.push(`Prix ancien : ${n(marche.prixAncienM2).toLocaleString('fr-FR')} €/m²`);
    else manquants.push('Prix ancien/m²');
    if (isPresent(marche.nbTransactionsDvf)) presents.push(`${n(marche.nbTransactionsDvf)} transactions DVF`);
    else manquants.push('Transactions DVF');
    if (isPresent(marche.offreConcurrente)) presents.push(`${n(marche.offreConcurrente)} programme(s) concurrent(s)`);
    else manquants.push('Offre concurrente');
    if (isPresent(marche.absorptionMensuelle)) presents.push(`Absorption : ${n(marche.absorptionMensuelle)}/mois`);
    else manquants.push('Absorption mensuelle');
    const statut: ModuleStatut = manquants.length === 0 ? 'COMPLET'
      : manquants.length <= 2 ? 'PARTIEL' : 'INSUFFISANT';
    qualiteParModule.push({ module: 'Marché', statut, donneesManquantes: manquants, donneesPresentes: presents });
  }

  {
    const hasRisques = Array.isArray(risquesIn.risquesIdentifies) && risquesIn.risquesIdentifies.length > 0;
    const manquants: string[] = [];
    const presents: string[] = [];
    if (hasRisques) risquesIn.risquesIdentifies!.forEach(r => presents.push(r));
    else manquants.push('Aucun risque analysé — module vide');
    if (isPresent(risquesIn.zonageRisque)) presents.push(`Zonage : ${risquesIn.zonageRisque}`);
    else manquants.push('Zonage risque');
    qualiteParModule.push({
      module: 'Risques',
      statut: hasRisques ? 'PARTIEL' : 'INSUFFISANT',
      donneesManquantes: manquants,
      donneesPresentes: presents,
    });
  }

  {
    const manquants: string[] = [];
    const presents: string[] = [];
    if (coutFoncierPresent) presents.push(`Foncier : ${eur(coutFoncier)}`);
    else manquants.push('Coût foncier (CRITIQUE)');
    if (caTotal > 0) presents.push(`CA : ${eur(caTotal)}`);
    else manquants.push('Chiffre d\'affaires (CRITIQUE)');
    if (isPresent(bilan.coutTravaux)) presents.push(`Travaux : ${eur(coutTravaux)}`);
    else manquants.push('Coût travaux');
    if (isPresent(bilan.margeNettePercent)) presents.push(`Marge : ${margeNettePercent.toFixed(1)}%`);
    const statut: ModuleStatut = manquants.some(m => m.includes('CRITIQUE')) ? 'INSUFFISANT'
      : manquants.length === 0 ? 'COMPLET' : 'PARTIEL';
    qualiteParModule.push({ module: 'Bilan', statut, donneesManquantes: manquants, donneesPresentes: presents });
  }

  // ─── QUALITÉ GLOBALE ─────────────────────────────────────────────────────

  const nbInsuffisants = qualiteParModule.filter(q => q.statut === 'INSUFFISANT').length;
  const nbPartiels = qualiteParModule.filter(q => q.statut === 'PARTIEL').length;
  const nbCritiques = anomalies.filter(a => a.niveau === 'CRITIQUE').length;

  let dataQualite: DataQualite;
  if (nbCritiques > 0 || nbInsuffisants >= 2) {
    dataQualite = 'INSUFFISANT';
  } else if (nbInsuffisants === 1 || nbPartiels >= 3) {
    dataQualite = 'FAIBLE';
  } else if (nbPartiels >= 1) {
    dataQualite = 'MOYENNE';
  } else {
    dataQualite = 'HAUTE';
  }

  // ─── MARCHÉ ──────────────────────────────────────────────────────────────

  const nbTransactionsDvf = n(marche.nbTransactionsDvf, 0);
  const marcheFiable      = nbTransactionsDvf >= 10;

  // [v4.3] Séparation stricte :
  // - prixDvfMoyen  = prix réel des transactions DVF (prixMoyenDvf)
  // - prixNeufM2    = prix de vente projet (saisie utilisateur)
  // - prixAncienM2  = prix médian DVF ou prix ancien saisi (référence transaction)
  const prixDvfMoyen  = n(marche.prixMoyenDvf, 0);  // prix moyen DVF brut
  const prixNeufM2    = n(marche.prixNeufM2, 0);     // prix de vente projet
  const prixAncienM2  = n(marche.prixAncienM2, 0);   // médian DVF ou ancien saisi

  // prixNeufMoyenM2 : référence de marché neuf pour les calculs de position.
  // Priorité : prix neuf saisi explicitement > prix DVF moyen (ne pas mélanger).
  const prixNeufMoyenM2 = prixNeufM2 > 0 ? prixNeufM2 : prixDvfMoyen;

  // Prix projet = prix de vente retenu (evaluation > prixNeufM2)
  const prixProjetM2 = n(raw.evaluation?.prixVenteM2 ?? marche.prixNeufM2, 0);

  // Position prix : vs DVF moyen si disponible, vs prix neuf sinon
  const refPrixPosition = prixDvfMoyen > 0 ? prixDvfMoyen : prixNeufMoyenM2;
  const positionPrix = refPrixPosition > 0 && prixProjetM2 > 0
    ? ((prixProjetM2 - refPrixPosition) / refPrixPosition) * 100
    : 0;

  // Prime neuf/ancien : prix DVF moyen vs prix ancien/médian DVF
  const primiumNeuf = prixAncienM2 > 0 && prixDvfMoyen > 0
    ? ((prixDvfMoyen - prixAncienM2) / prixAncienM2) * 100
    : prixAncienM2 > 0 && prixNeufMoyenM2 > 0
      ? ((prixNeufMoyenM2 - prixAncienM2) / prixAncienM2) * 100
      : 0;

  const offreConcurrente    = n(marche.offreConcurrente, 0);
  const absorptionMensuelle = n(marche.absorptionMensuelle, 0);
  const delaiEcoulementMois = absorptionMensuelle > 0 && nbLogements > 0
    ? Math.ceil(nbLogements / absorptionMensuelle)
    : null;

  const notesMarcheLibre: string[] = [];
  if (!marcheFiable) {
    if (nbTransactionsDvf > 0) {
      notesMarcheLibre.push(
        `Seulement ${nbTransactionsDvf} transaction${nbTransactionsDvf > 1 ? 's' : ''} DVF — échantillon réduit, prix à interpréter avec prudence.`
      );
    } else {
      notesMarcheLibre.push(
        'ANALYSE DE MARCHÉ NON FIABLE — données DVF absentes. ' +
        'Le prix de vente est une hypothèse non étayée par des transactions réelles.'
      );
    }
  }
  if (positionPrix > 10) {
    notesMarcheLibre.push(`Prix projet ${positionPrix.toFixed(1)}% au-dessus du marché — risque de délai de vente allongé.`);
  } else if (positionPrix < -10 && refPrixPosition > 0) {
    notesMarcheLibre.push(`Prix projet ${Math.abs(positionPrix).toFixed(1)}% en dessous du marché — marge potentiellement sous-optimisée.`);
  }

  // ─── TECHNIQUE ───────────────────────────────────────────────────────────

  const zonePlu = plu.zone ?? 'NON RENSEIGNÉ';
  const contraintes: ContrainteTechnique[] = [];

  if (hauteurProjet > 0 && hauteurMaxPlu > 0) {
    contraintes.push({
      libelle: 'Hauteur du projet',
      statut: hauteurProjet <= hauteurMaxPlu ? 'CONFORME' : 'BLOQUANT',
      valeurProjet: `${hauteurProjet} m`,
      valeurPlu: `max ${hauteurMaxPlu} m`,
    });
  } else if (hauteurProjet > 0 && !hauteurMaxPlu) {
    contraintes.push({
      libelle: 'Hauteur — PLU non renseigné',
      statut: 'A_VERIFIER',
      valeurProjet: `${hauteurProjet} m`,
      valeurPlu: 'NON RENSEIGNÉ',
    });
  }

  if (!isPresent(plu.cub)) {
    contraintes.push({
      libelle: 'CES (emprise au sol max) — non renseigné',
      statut: 'A_VERIFIER',
      valeurProjet: emprise > 0 ? `${Math.round(emprise)} m²` : 'N/A',
      valeurPlu: 'NON RENSEIGNÉ',
    });
  }

  if (isPresent(plu.pleineTerre)) {
    contraintes.push({
      libelle: `Pleine terre min ${Math.round(n(plu.pleineTerre) * 100)}%`,
      statut: 'A_VERIFIER',
      valeurProjet: 'À vérifier sur plan masse',
      valeurPlu: `min ${Math.round(n(plu.pleineTerre) * 100)}%`,
    });
  }

  const faisabiliteTechnique: PromoteurSynthese['technique']['faisabiliteTechnique'] =
    contraintes.some(c => c.statut === 'BLOQUANT') ? 'IMPOSSIBLE' :
    !isPresent(plu.zone) ? 'NON_DETERMINABLE' :
    contraintes.some(c => c.statut === 'A_VERIFIER') ? 'SOUS_RESERVE' : 'CONFIRME';

  // ─── RISQUES ─────────────────────────────────────────────────────────────

  const risqueItems: RisqueItem[] = [];
  const hasRisques = Array.isArray(risquesIn.risquesIdentifies) && risquesIn.risquesIdentifies.length > 0;

  if (!hasRisques) {
    risqueItems.push({
      id: 'RISQUES_NON_ANALYSES',
      niveau: 'ELEVE',
      libelle: 'RISQUES NON ANALYSÉS — module vide',
      mitigation: 'Lancer l\'analyse depuis le module Risques (Géorisques, risques naturels, servitudes PLU).',
    });
  }

  if (!coutFoncierPresent) {
    risqueItems.push({
      id: 'BILAN_INCOMPLET',
      niveau: 'CRITIQUE',
      libelle: 'Bilan financier structurellement incomplet — foncier manquant',
      mitigation: 'Renseigner le prix d\'acquisition foncier dans le Bilan.',
    });
  }

  if (!marcheFiable) {
    risqueItems.push({
      id: 'MARCHE_NON_VALIDE',
      niveau: 'MODERE',
      libelle: 'Prix de vente non validé par des données de marché',
      mitigation: 'Lancer l\'étude de marché DVF pour confirmer le prix de vente sur la commune.',
    });
  }

  // ─── KILL SWITCHES & ANALYSE SUFFISANTE ──────────────────────────────────

  const killSwitches: string[] = [];
  if (!coutFoncierPresent) killSwitches.push('Coût foncier absent — indicateurs de rentabilité non fiables');
  if (caTotal <= 0)         killSwitches.push('Chiffre d\'affaires nul — aucune recette calculée');
  if (anomalies.some(a => a.id === 'HAUTEUR_DEPASSE_PLU')) {
    killSwitches.push('Hauteur projet dépasse le PLU — faisabilité bloquée');
  }
  if (!marcheFiable) killSwitches.push('Données de marché insuffisantes — prix de vente non validé');

  const analyseSuffisante = killSwitches.length === 0;

  // ─── SCÉNARIOS ───────────────────────────────────────────────────────────

  const baseHypotheses = {
    prixVenteM2:    n(raw.evaluation?.prixVenteM2 ?? marche.prixNeufM2, 0),
    coutTravauxM2,
    tauxAbsorption: absorptionMensuelle > 0 ? Math.ceil(nbLogements / absorptionMensuelle) : 0,
    tauxCredit:     4,
  };

  const mkScenarioResult = (ca2: number, cost2: number) => {
    const m = ca2 - cost2;
    const mp = ca2 > 0 ? (m / ca2) * 100 : 0;
    const trn = cost2 > 0 ? (m / cost2) * 100 : 0;
    return {
      chiffreAffaires: ca2,
      coutTotal: cost2,
      margeNette: m,
      margeNettePercent: mp,
      trnRendement: trn,
      recommendation: computeReco(mp),
    };
  };

  const scenarios: Scenario[] = caTotal > 0 ? [
    {
      id: 'BASE',
      type: 'BASE',
      libelle: 'Hypothèses du bilan',
      hypotheses: baseHypotheses,
      resultat: {
        chiffreAffaires:   caTotal,
        coutTotal:         coutRevientTotal,
        margeNette,
        margeNettePercent,
        trnRendement,
        recommendation: killSwitches.length > 0 ? 'ANALYSE_INSUFFISANTE' : computeReco(margeNettePercent),
      },
    },
    {
      id: 'OPTIMISTE',
      type: 'OPTIMISTE',
      libelle: '+5% prix de vente',
      hypotheses: { ...baseHypotheses, prixVenteM2: baseHypotheses.prixVenteM2 * 1.05 },
      resultat: mkScenarioResult(caTotal * 1.05, coutRevientTotal),
    },
    {
      id: 'PESSIMISTE',
      type: 'PESSIMISTE',
      libelle: '-5% prix de vente',
      hypotheses: { ...baseHypotheses, prixVenteM2: baseHypotheses.prixVenteM2 * 0.95 },
      resultat: mkScenarioResult(caTotal * 0.95, coutRevientTotal),
    },
    {
      id: 'STRESS',
      type: 'STRESS',
      libelle: '+10% coûts / -8% prix',
      hypotheses: {
        ...baseHypotheses,
        prixVenteM2:   baseHypotheses.prixVenteM2   * 0.92,
        coutTravauxM2: baseHypotheses.coutTravauxM2 * 1.10,
      },
      resultat: mkScenarioResult(caTotal * 0.92, coutRevientTotal * 1.10),
    },
  ] : [];

  // ─── FINANCEMENT ─────────────────────────────────────────────────────────

  const fondsPropres = coutRevientTotal > 0 ? coutRevientTotal * 0.20 : 0;
  const creditMontant = Math.max(0, coutRevientTotal - fondsPropres);
  const fondsPropresPercent = coutRevientTotal > 0 ? (fondsPropres / coutRevientTotal) * 100 : 0;
  const notesBancaires: string[] = [];
  if (!coutFoncierPresent) {
    notesBancaires.push('PLAN DE FINANCEMENT NON FIABLE — coût foncier absent.');
  }
  if (margeNettePercent > 0 && margeNettePercent < 8 && coutFoncierPresent) {
    notesBancaires.push('Marge insuffisante pour un financement bancaire standard (seuil usuel 8–10%).');
  }

  // ─── SCORES ──────────────────────────────────────────────────────────────

  const scoreFinancier = !coutFoncierPresent ? 0
    : margeNettePercent >= 20 ? 90
    : margeNettePercent >= 15 ? 75
    : margeNettePercent >= 10 ? 55
    : margeNettePercent >= 8  ? 40
    : 15;

  const scoreMarche = marcheFiable ? 75
    : isPresent(marche.prixNeufM2) ? 35
    : 10;

  const scoreTechnique = faisabiliteTechnique === 'CONFIRME' ? 85
    : faisabiliteTechnique === 'SOUS_RESERVE' ? 55
    : faisabiliteTechnique === 'NON_DETERMINABLE' ? 30
    : 5;

  const scoreRisque = hasRisques ? 70 : 15;

  const scoreGlobal = Math.round(
    scoreFinancier * 0.40 +
    scoreMarche    * 0.25 +
    scoreTechnique * 0.20 +
    scoreRisque    * 0.15
  );

  // ─── RECOMMANDATION ──────────────────────────────────────────────────────

  const recommendation: RecommendationType = killSwitches.length > 0
    ? 'ANALYSE_INSUFFISANTE'
    : computeReco(margeNettePercent);

  const motifRecommandation = recommendation === 'ANALYSE_INSUFFISANTE'
    ? 'ANALYSE INSUFFISANTE POUR RECOMMANDATION — données critiques manquantes.'
    : recommendation === 'GO'
      ? `Marge nette ${margeNettePercent.toFixed(1)}% >= 15% — opération viable.`
      : recommendation === 'GO_CONDITION'
        ? `Marge nette ${margeNettePercent.toFixed(1)}% (seuil limite 8–15%) — viable sous conditions.`
        : `Marge nette ${margeNettePercent.toFixed(1)}% < 8% — opération non viable.`;

  const pointsForts: string[] = [];
  const pointsVigilance: string[] = [];

  if (isPresent(plu.zone)) pointsForts.push(`Zone PLU renseignée : ${zonePlu}`);
  if (hauteurProjet > 0 && hauteurMaxPlu > 0 && hauteurProjet <= hauteurMaxPlu) {
    pointsForts.push(`Hauteur projet (${hauteurProjet} m) conforme au PLU (max ${hauteurMaxPlu} m)`);
  }
  if (isPresent(foncier.surfaceTerrain) && n(foncier.surfaceTerrain) >= 1000) {
    pointsForts.push(`Grande parcelle : ${n(foncier.surfaceTerrain).toLocaleString('fr-FR')} m²`);
  }
  if (marcheFiable) {
    pointsForts.push(`${nbTransactionsDvf} transactions DVF analysées — prix de marché validé`);
  }
  if (isPresent(plu.pleineTerre)) {
    pointsForts.push(`Exigence pleine terre connue : ${Math.round(n(plu.pleineTerre) * 100)}% minimum`);
  }

  if (!coutFoncierPresent) pointsVigilance.push('Coût foncier absent — marge surestimée');
  if (!marcheFiable) pointsVigilance.push('Prix de vente non étayé par des transactions DVF');
  if (!hasRisques) pointsVigilance.push('Risques non analysés');
  anomalies.filter(a => a.niveau === 'ALERTE').forEach(a => pointsVigilance.push(a.libelle));
  if (!isPresent(plu.cub)) pointsVigilance.push('CES (emprise max) absent');

  // ─── SYNTHÈSE TEXTUELLE ──────────────────────────────────────────────────

  const communeLabel = foncier.commune ?? 'commune non renseignée';
  const deptLabel    = foncier.departement ?? '?';
  const surfLabel    = isPresent(foncier.surfaceTerrain)
    ? `${n(foncier.surfaceTerrain).toLocaleString('fr-FR')} m²`
    : 'surface non renseignée';

  const syntheseIA = {
    texteExecutif: [
      `Opération ${programmeType || 'résidentielle'} sur terrain de ${surfLabel} à ${communeLabel} (${deptLabel}).`,
      `Programme : ${nbLogements > 0 ? nbLogements : 'N/D'} logement${nbLogements > 1 ? 's' : ''} — ${sdp > 0 ? Math.round(sdp) + ' m² SDP' : 'SDP non renseignée'}.`,
      !analyseSuffisante
        ? `ANALYSE INCOMPLÈTE — ${killSwitches.length} point${killSwitches.length > 1 ? 's' : ''} bloquant${killSwitches.length > 1 ? 's' : ''}. Recommandation impossible.`
        : `Marge nette : ${margeNettePercent.toFixed(1)}% — ${recommendation}.`,
    ].join(' '),

    // [v4.3] analyseMarche corrigée :
    // - Prix DVF moyen (prixDvfMoyen) clairement séparé du prix projet (prixProjetM2)
    // - Position prix calculée vs DVF moyen (référence transactions réelles)
    // - Prime neuf/ancien = DVF moyen / médian DVF (pas prix projet / DVF)
    // - Aucune valeur inventée : chaque segment est conditionnel à sa présence
    analyseMarche: marcheFiable
      ? [
          // Période uniquement — pas le count de transactions (source peut varier)
          marche.periodeDvf ? `Données DVF (${marche.periodeDvf}).` : '',
          // Prix DVF réel — séparé du prix de vente projet
          prixDvfMoyen > 0
            ? `Prix moyen DVF : ${prixDvfMoyen.toLocaleString('fr-FR')} EUR/m².`
            : '',
          // Prix médian DVF (prixAncienM2 = médian DVF dans ce contexte)
          prixAncienM2 > 0 && prixAncienM2 !== prixDvfMoyen
            ? `Prix médian DVF : ${prixAncienM2.toLocaleString('fr-FR')} EUR/m².`
            : '',
          // Prix projet vs DVF moyen (la vraie référence de marché)
          prixProjetM2 > 0
            ? `Prix projet : ${prixProjetM2.toLocaleString('fr-FR')} EUR/m²${
                refPrixPosition > 0
                  ? ` (${positionPrix >= 0 ? '+' : ''}${positionPrix.toFixed(1)}% vs marché)`
                  : ''
              }.`
            : '',
          // Prime neuf/ancien = DVF moyen vs médian DVF (transactions réelles)
          primiumNeuf !== 0 && prixAncienM2 > 0
            ? `Prime neuf/ancien : ${primiumNeuf.toFixed(1)}%.`
            : '',
          offreConcurrente > 0
            ? `Concurrence : ${offreConcurrente} programme(s) identifié(s).`
            : '',
          delaiEcoulementMois
            ? `Délai d'écoulement estimé : ${delaiEcoulementMois} mois.`
            : '',
        ].filter(Boolean).join(' ')
      : 'ANALYSE DE MARCHÉ NON FIABLE — données DVF et concurrence absentes. ' +
        `Le prix de vente retenu (${prixProjetM2 > 0 ? prixProjetM2.toLocaleString('fr-FR') + ' EUR/m²' : 'N/D'}) n'est pas étayé par des transactions réelles. ` +
        'Lancer l\'étude de marché depuis le module dédié.',

    analyseTechnique: [
      `Zone PLU : ${zonePlu}.`,
      hauteurMaxPlu > 0 ? `Hauteur max : ${hauteurMaxPlu} m.` : 'Hauteur max PLU : NON RENSEIGNÉE.',
      hauteurProjet > 0 ? `Hauteur projet : ${hauteurProjet} m.` : 'Hauteur projet : NON RENSEIGNÉE.',
      isPresent(plu.cub) ? `CES max : ${n(plu.cub)}.` : 'CES : NON RENSEIGNÉ.',
      isPresent(plu.pleineTerre) ? `Pleine terre min : ${Math.round(n(plu.pleineTerre) * 100)}%.` : 'Pleine terre : NON RENSEIGNÉE.',
      `Faisabilité : ${faisabiliteTechnique}.`,
    ].join(' '),

    analyseFinanciere: !coutFoncierPresent
      ? [
          'BILAN INCOMPLET — coût foncier absent.',
          caTotal > 0 ? `CA : ${eur(caTotal)}.` : 'CA : NON RENSEIGNÉ.',
          coutTravaux > 0 ? `Coûts hors foncier : ~${eur(coutRevientTotal)}.` : '',
          `La marge affichée (${margeNettePercent.toFixed(1)}%) est surestimée.`,
        ].filter(Boolean).join(' ')
      : [
          `CA : ${eur(caTotal)}.`,
          `Coût de revient : ${eur(coutRevientTotal)} (foncier : ${eur(coutFoncier)}, travaux : ${eur(coutTravaux)}).`,
          `Marge nette : ${eur(margeNette)} (${margeNettePercent.toFixed(1)}%).`,
          `TRN : ${trnRendement.toFixed(1)}%.`,
          `Coût de revient : ${coutRevientM2.toLocaleString('fr-FR')} EUR/m² vendable.`,
        ].join(' '),

    analyseRisques: !hasRisques
      ? [
          'RISQUES NON ANALYSÉS — aucune donnée dans le module.',
          `Commune de ${communeLabel} (${deptLabel}) : analyser l'exposition aux risques naturels (Géorisques),`,
          'les servitudes d\'utilité publique, les risques de voisinage et les contraintes de sol.',
        ].join(' ')
      : [
          `${risquesIn.risquesIdentifies?.length ?? 0} risque(s) identifié(s).`,
          risquesIn.zonageRisque ? `Zonage : ${risquesIn.zonageRisque}.` : 'Zonage risque non précisé.',
        ].join(' '),

    conclusion: !analyseSuffisante
      ? `ANALYSE INSUFFISANTE POUR RECOMMANDATION. Actions requises : ${killSwitches.map((ks, i) => `(${i + 1}) ${ks}`).join('; ')}. Compléter les données et régénérer la synthèse.`
      : [
          `Opération ${recommendation === 'GO' ? 'viable' : recommendation === 'GO_CONDITION' ? 'conditionnellement viable' : 'non viable en l\'état'}.`,
          pointsVigilance.length > 0
            ? `Points de vigilance : ${pointsVigilance.slice(0, 3).join('; ')}.`
            : 'Aucun point de vigilance majeur identifié.',
        ].join(' '),
  };

  // ─── TITRE ────────────────────────────────────────────────────────────────

  const titreOperation = [
    programmeType || 'Programme résidentiel',
    foncier.commune ? `— ${foncier.commune}` : '',
    foncier.codePostal ? `(${foncier.codePostal})` : '',
    sdp > 0 ? `— ${Math.round(sdp)} m² SDP` : '',
  ].filter(Boolean).join(' ');

  // ─── RETURN ───────────────────────────────────────────────────────────────

  const hasQualityWarning =
    !analyseSuffisante ||
    dataQualite === 'FAIBLE' ||
    dataQualite === 'INSUFFISANT';

  return {
    metadata: {
      generatedAt: new Date().toISOString(),
      dataQualite,
      analyseSuffisante,
      version: '4.3',
      sourceFoncier:  foncier.commune ? 'Saisie utilisateur / cadastre' : 'Non renseigné',
      sourcePlu:      isPresent(plu.zone) ? 'PLU communal' : 'Non renseigné',
      sourceMarche:   marcheFiable ? 'DVF + saisie utilisateur' : 'Saisie utilisateur',
      avertissements: hasQualityWarning ? [
        'Analyse générée sur données partielles — conclusions à confirmer après complétion du dossier.',
      ] : [],
    },
    projet: {
      adresse:         foncier.adresse               ?? 'Adresse non renseignée',
      commune:         foncier.commune               ?? 'Commune non renseignée',
      codePostal:      foncier.codePostal,
      departement:     foncier.departement,
      surfaceTerrain:  isPresent(foncier.surfaceTerrain) ? n(foncier.surfaceTerrain) : undefined,
      surfacePlancher: sdp > 0 ? sdp : 0,
      nbLogements,
      programmeType:   programmeType || 'Non renseigné',
      typologieMix:    {},
      dateEtude:       new Date().toISOString(),
    },
    executiveSummary: {
      titreOperation,
      recommendation,
      motifRecommandation,
      killSwitchesActifs: killSwitches,
      pointsForts,
      pointsVigilance,
      caTotal,
      resultatNet:   margeNette,
      margeNette:    margeNettePercent,
      trnRendement,
      scores: {
        global:    scoreGlobal,
        financier: scoreFinancier,
        marche:    scoreMarche,
        technique: scoreTechnique,
        risque:    scoreRisque,
        foncier:   60,
      },
    },
    anomalies,
    qualiteParModule,
    financier: {
      chiffreAffairesTotal:       caTotal,
      chiffreAffairesM2,
      coutRevientTotal,
      coutRevientM2,
      coutFoncier,
      coutFoncierPresent,
      coutTravaux,
      coutTravauxM2,
      coutFinanciers,
      fraisCommercialisation:     fraisComm,
      fraisGestion,
      margeNette,
      margeNettePercent,
      margeOperationnellePercent: margeOpPct,
      trnRendement,
      bilancielRatio,
      autresCouts:                [],
    },
    marche: {
      zoneMarche:            `${foncier.commune ?? ''} (${foncier.departement ?? '?'})`,
      prixNeufMoyenM2,
      prixProjetM2,
      prixAncienMoyenM2:     prixAncienM2,
      positionPrix,
      primiumNeuf,
      offreConcurrente,
      absorptionMensuelle:   absorptionMensuelle > 0 ? absorptionMensuelle : null,
      delaiEcoulementMois,
      analyseFiable:         marcheFiable,
      notesMarcheLibre,
      transactionsRecentes: {
        nbTransactions: nbTransactionsDvf,
        prixMoyenM2:    prixDvfMoyen,
        prixMin:        n(marche.prixMinDvf, 0),
        prixMax:        n(marche.prixMaxDvf, 0),
        periode:        marche.periodeDvf ?? '',
        source:         nbTransactionsDvf > 0 ? 'DVF' : '',
      },
      demographieIndicateurs: [],
    },
    technique: {
      faisabiliteTechnique,
      zonePlu,
      cub:           isPresent(plu.cub) ? n(plu.cub) : null,
      hauteurMax:    hauteurMaxPlu > 0 ? hauteurMaxPlu : null,
      hauteurProjet: hauteurProjet > 0 ? hauteurProjet : null,
      nbNiveaux:     niveaux > 0 ? niveaux : null,
      pleineTerre:   isPresent(plu.pleineTerre) ? Math.round(n(plu.pleineTerre) * 100) : null,
      reculs: {
        voirie:             null,
        limitesSeparatives: null,
      },
      contraintes,
      notesTechniques: [],
    },
    risques: risqueItems,
    scenarios,
    financement: {
      fondsPropresRequis:     fondsPropres,
      fondsPropresPercent,
      creditPromoteurMontant: creditMontant,
      creditPromoteurDuree:   24,
      tauxCredit:             4,
      prefinancementVentes:   30,
      ratioFondsPropres:      fondsPropresPercent,
      garantiesRequises:      [],
      notesBancaires,
    },
    syntheseIA,
  };
}