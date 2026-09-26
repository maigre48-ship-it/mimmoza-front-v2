import type { DossierParcel, ParcelDossier } from './parcelDossier';
import { selectedArea } from './dossierCalculations.ts';

/** Cadre de décision envoyé au copilote depuis un périmètre choisi sur la carte. */
export function buildParcelStrategyPrompt(dossier: ParcelDossier, selected: DossierParcel[]): string | null {
  if (!selected.length) return null;
  const area = selectedArea(selected);
  const ids = selected.map((parcel) => parcel.id).join(', ');
  const marketAnchor = selected.reduce((best, parcel) => (parcel.areaM2 ?? 0) > (best.areaM2 ?? 0) ? parcel : best);
  const floodSignal = dossier.prescriptions.some((value) => /inond|ppri/i.test(value))
    || dossier.servitudes.some((value) => /ppri/i.test(value));

  return [
    `Prépare une stratégie de projet et de cession pour le périmètre de travail sélectionné sur la carte : ${ids}.`,
    `Adresse : ${dossier.address ?? 'non renseignée'}. Surface cadastrale cumulée : ${area == null ? 'non vérifiée' : `${area} m²`}. Zone relevée au seul point d’adresse : ${dossier.zone ?? 'inconnue'}.`,
    'La sélection cartographique ne prouve ni la propriété, ni l’unité foncière, ni les droits à bâtir. Vérifie les contraintes parcelle par parcelle avant de parler de faisabilité.',
    floodSignal ? 'Signal inondation/PPRI au point : vérifie le zonage réglementaire opposable et son emprise sur chaque parcelle avant toute hypothèse de construction.' : 'Vérifie les risques et servitudes opposables sur chaque parcelle.',
    `Commence par appeler get_etude_marche avec parcel_id égal à ${marketAnchor.id}, la plus grande parcelle sélectionnée, pour centrer le rayon au plus près du terrain étudié. Utilise le marché local réel : transactions DVF (périmètre, période, nombre, typologie), demande, vacance, revenus et équipements seulement lorsqu’ils sont effectivement mesurés. Distingue mesure, estimation et donnée absente. Un score ne démontre pas à lui seul la demande pour un produit.`,
    'Présente 2 ou 3 scénarios de produit à tester, y compris une option prudente de cession en l’état si le droit à construire reste inconnu. Pour chacun : clientèle finale visée, indice de demande et comparables disponibles, contraintes et coûts à instruire, condition qui invaliderait le scénario. N’attribue aucune capacité constructive ni surface de plancher sans règlement PLU, PPRI et plan vérifiés.',
    'Compare ensuite les profils de contreparties possibles (par exemple promoteur, marchand, bailleur, opérateur spécialisé ou investisseur) seulement s’ils correspondent aux scénarios étayés. Indique ce qui serait vendu : foncier en l’état, promesse conditionnelle, projet autorisé ou opération achevée ; le niveau de preuve et les autorisations nécessaires à chaque stade ; le risque conservé par le vendeur. Pour chaque catégorie, indique la fonction du décideur à viser et comment identifier des acteurs pertinents ; aucun acheteur réel ni contact ne doit être inventé.',
    'Conclue par un scénario prioritaire conditionnel, un scénario de repli, la liste ordonnée des vérifications qui permettraient de choisir et les pièces d’un dossier de présentation à remettre aux interlocuteurs ciblés. Si le marché ou le règlement est indisponible, dis ce qui manque et ne chiffre ni prix de cession ni marge sans comparables et coûts sourcés.',
  ].join('\n\n');
}
