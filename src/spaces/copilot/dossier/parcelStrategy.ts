import type { DossierParcel, ParcelDossier } from './parcelDossier';
import { selectedArea } from './dossierCalculations.ts';

export interface ProgrammeBrief {
  label: string;
  marketType: 'logement' | 'commerce' | 'bureaux' | 'hotel' | 'residence_etudiante' | 'ehpad' | null;
  sectionNaf: 'G' | 'I' | 'Q' | null;
  operatorNaf: string | null;
  criticalData: string;
  marketCaveat: string;
}

/** Le moteur de marché ne couvre que six familles, souvent avec des proxys. */
export function programmeBrief(intent: string): ProgrammeBrief | null {
  const label = intent.trim().replace(/\s+/g, ' ').slice(0, 120);
  if (!label) return null;
  const key = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/supermarche|hypermarch|grande surface/.test(key)) return {
    label, marketType: 'commerce', sectionNaf: 'G', operatorNaf: '47.11D',
    criticalData: 'zone de chalandise, dépenses alimentaires, flux réels, enseignes présentes, accessibilité/parking et autorisations commerciales',
    marketCaveat: 'Le mode commerce fournit un contexte communal, pas une étude de chalandise ni une prévision de chiffre d’affaires de supermarché.',
  };
  if (/clinique|hopital|etablissement de sante/.test(key)) return {
    label, marketType: null, sectionNaf: 'Q', operatorNaf: '86.10Z',
    criticalData: 'besoins de soins par spécialité, offre existante, bassin de recrutement, autorisations sanitaires, FINESS et stratégie ARS',
    marketCaveat: 'Aucun modèle de demande clinique n’est branché : les équipements proches ne prouvent ni besoin médical ni autorisation.',
  };
  if (/residence senior|residence autonomie/.test(key)) return {
    label, marketType: null, sectionNaf: null, operatorNaf: null,
    criticalData: 'demande senior autonome, loyers ou redevances, services, offre concurrente, solvabilité et cadre d’exploitation',
    marketCaveat: 'Une résidence services senior n’est pas un EHPAD : aucun modèle de demande spécialisé n’est branché.',
  };
  if (/ehpad|maison de retraite/.test(key)) return {
    label, marketType: 'ehpad', sectionNaf: 'Q', operatorNaf: '87.10A',
    criticalData: 'personnes âgées dépendantes, places autorisées, taux d’occupation, tarifs, solvabilité, personnels et autorisations',
    marketCaveat: 'Le mode EHPAD est un pré-diagnostic : le score ne remplace pas les données FINESS, départementales et d’occupation.',
  };
  if (/hotel|hoteller|hebergement touristique/.test(key)) return {
    label, marketType: 'hotel', sectionNaf: 'I', operatorNaf: '55.10Z',
    criticalData: 'parc hôtelier par catégorie, nuitées, saisonnalité, occupation, ADR/RevPAR, clientèle, concurrence et coûts d’exploitation',
    marketCaveat: 'Le mode hôtel actuel est un proxy équipements/transports : il ne mesure ni occupation, ni ADR/RevPAR, ni demande par catégorie.',
  };
  if (/residence etudiante|logement etudiant/.test(key)) return {
    label, marketType: 'residence_etudiante', sectionNaf: null, operatorNaf: null,
    criticalData: 'effectifs étudiants, mobilité, lits existants, loyers, taux d’occupation et proximité des campus',
    marketCaveat: 'Les parts étudiantes estimées ne constituent pas un relevé communal de demande locative.',
  };
  if (/locaux d.activite|local d.activite|atelier|entrepot|parc d.activite/.test(key)) return {
    label, marketType: null, sectionNaf: null, operatorNaf: null,
    criticalData: 'demande d’implantation par métier et taille de lot, loyers signés, vacance, hauteur libre, charge au sol, puissance électrique, desserte et accès poids lourds',
    marketCaveat: 'Le marché des locaux d’activité exige ses propres comparables et besoins utilisateurs. Aucun modèle spécialisé n’est branché ; un score bureaux ou commerce ne constitue pas un substitut.',
  };
  if (/bureau|tertiaire/.test(key)) return {
    label, marketType: 'bureaux', sectionNaf: null, operatorNaf: null,
    criticalData: 'demande placée par taille, offre immédiate, vacance, loyers signés HT HC/an, franchises, qualité des plateaux et précommercialisation utilisateurs',
    marketCaveat: 'Le mode bureaux ne fournit pas à lui seul les loyers et la vacance du marché tertiaire.',
  };
  if (/logement|habitation|residentiel/.test(key)) return {
    label, marketType: 'logement', sectionNaf: null, operatorNaf: null,
    criticalData: 'transactions comparables par typologie, loyers, vacance, ménages et produits neufs concurrents',
    marketCaveat: 'Une médiane DVF tous biens confondus ne définit pas le bon produit résidentiel.',
  };
  if (/commerce|magasin|retail/.test(key)) return {
    label, marketType: 'commerce', sectionNaf: 'G', operatorNaf: null,
    criticalData: 'zone de chalandise, dépenses, flux, commerces concurrents, loyers commerciaux et accès',
    marketCaveat: 'Le mode commerce est un contexte communal, pas une étude de chalandise par activité.',
  };
  return {
    label, marketType: null, sectionNaf: null, operatorNaf: null,
    criticalData: 'demande propre au programme, concurrence spécialisée, règles d’exploitation, coûts et opérateurs',
    marketCaveat: 'Aucun modèle de marché propre à ce programme n’est branché : ne lui substitue pas un score logement ou commerce.',
  };
}

/** Cadre de décision envoyé au copilote depuis un périmètre choisi sur la carte. */
export function buildParcelStrategyPrompt(dossier: ParcelDossier, selected: DossierParcel[], intent = ''): string | null {
  if (!selected.length) return null;
  const area = selectedArea(selected);
  const ids = selected.map((parcel) => parcel.id).join(', ');
  const marketAnchor = selected.reduce((best, parcel) => (parcel.areaM2 ?? 0) > (best.areaM2 ?? 0) ? parcel : best);
  const programme = programmeBrief(intent);
  const floodSignal = dossier.prescriptions.some((value) => /inond|ppri/i.test(value))
    || dossier.servitudes.some((value) => /ppri/i.test(value));

  return [
    `Prépare une stratégie de projet et de cession pour le périmètre de travail sélectionné sur la carte : ${ids}.`,
    `Adresse : ${dossier.address ?? 'non renseignée'}. Surface cadastrale cumulée : ${area == null ? 'non vérifiée' : `${area} m²`}. Zone relevée au seul point d’adresse : ${dossier.zone ?? 'inconnue'}.`,
    'La sélection cartographique ne prouve ni la propriété, ni l’unité foncière, ni les droits à bâtir. Vérifie les contraintes parcelle par parcelle avant de parler de faisabilité.',
    floodSignal ? 'Signal inondation/PPRI au point : vérifie le zonage réglementaire opposable et son emprise sur chaque parcelle avant toute hypothèse de construction.' : 'Vérifie les risques et servitudes opposables sur chaque parcelle.',
    programme ? `Programme à instruire : ${programme.label}. Données décisives : ${programme.criticalData}. ${programme.marketCaveat}` : 'Compare plusieurs programmes plausibles sans présumer celui qui répond à la demande locale. Identifie pour chacun les données décisives qui manquent.',
    programme?.marketType
      ? `Appelle get_etude_marche avec parcel_id=${marketAnchor.id} et project_type=${programme.marketType}. C’est un pré-diagnostic ; lis la portée de chaque donnée et n’en tire pas une demande finale non mesurée.`
      : programme
        ? `Aucun modèle de marché adapté à ${programme.label} n’est disponible. N’appelle pas get_etude_marche avec un autre project_type comme substitut. Localise le terrain sur ${marketAnchor.id} et indique les sources spécialisées à connecter.`
        : `Aucun programme n’est encore choisi. Ne lance pas get_etude_marche sur son type logement par défaut pour classer tous les usages. Après avoir vérifié les contraintes du terrain ${marketAnchor.id}, retiens au plus trois usages à étudier et appelle get_etude_marche avec un project_type explicite pour chacun des usages couverts. Pour les autres, indique le connecteur spécialisé manquant. Aucun score ne suffit à classer les usages.`,
    programme?.sectionNaf
      ? `Appelle get_etablissements_proches avec parcel_id=${marketAnchor.id}, section_naf=${programme.sectionNaf} pour décrire l’offre immatriculée voisine. Ce relevé n’identifie ni la demande, ni les exploitants prêts à acheter ce projet.`
      : 'Décris les concurrents uniquement si une source vérifiée les recense ; leur absence dans la sortie ne prouve pas une absence sur le terrain.',
    programme?.operatorNaf
      ? `Appelle get_operateurs_candidats avec parcel_id=${marketAnchor.id}, programme=${programme.label} et code_naf=${programme.operatorNaf}. Donne quelques sociétés vérifiables avec SIREN et fiche officielle, comme candidats à qualifier seulement. La présence départementale ne prouve aucun intérêt pour ce projet.`
      : 'Pour les exploitants ou acquéreurs, distingue les catégories possibles. Aucun code d’activité fiable n’est établi pour ce programme : ne donne pas de noms de sociétés non sourcés ; indique le profil et les données nécessaires pour cibler une recherche.',
    'Distingue mesures, estimations et absences. Les prix DVF portent sur des transactions immobilières, pas sur le chiffre d’affaires d’une activité. Un score général ne valide jamais un programme.',
    'Présente 2 ou 3 scénarios de programme à tester, dont une cession en l’état si le droit à construire reste inconnu. Pour chacun : cible finale, données de demande et concurrents réellement disponibles, services ou fonctions utiles, contraintes et coûts à instruire, condition qui invaliderait le scénario. N’attribue aucune capacité constructive ni surface de plancher sans règlement PLU, PPRI et plan vérifiés.',
    'Propose une intention architecturale et une palette de matériaux/couleurs adaptées à la cible et au contexte urbain, explicitement comme pistes de conception. Vérifie zone PLU, prescriptions de façade, patrimoine/SPR, gabarit, accès, stationnement, ERP et risques avant toute affirmation de conformité. Sans documents opposables au terrain, ne dis pas que le dessin ou les couleurs sont autorisés.',
    'Compare ensuite les profils d’exploitants et d’acquéreurs possibles selon le programme, leurs critères d’implantation et le stade de maturité du projet. Une liste d’établissements déjà présents ne prouve pas un intérêt pour cette opération. Indique ce qui serait vendu : foncier en l’état, promesse conditionnelle, projet autorisé ou opération achevée ; le niveau de preuve et les autorisations nécessaires à chaque stade ; le risque conservé par le vendeur. Pour chaque catégorie, indique la fonction du décideur à viser et comment identifier des acteurs pertinents ; aucun acheteur réel ni contact ne doit être inventé.',
    'Conclue par un scénario prioritaire conditionnel, un scénario de repli, la liste ordonnée des vérifications qui permettraient de choisir et les pièces d’un dossier de présentation à remettre aux interlocuteurs ciblés. Si le marché ou le règlement est indisponible, dis ce qui manque et ne chiffre ni prix de cession ni marge sans comparables et coûts sourcés.',
  ].join('\n\n');
}
