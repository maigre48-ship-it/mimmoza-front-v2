import type { HotelEvidence } from './hotelMarket';
import { hotelTerritorialSignals } from './hotelTerritorialSignals.ts';

export type ProgrammeKind = 'hotel' | 'housing' | 'ehpad' | 'clinic' | 'retail' | 'office' | 'activity' | 'student' | 'other';
export type PluEnvelope = { cesRatio: number | null; heightM: number | null; parkingPerHousing: number | null; notes: string[] };
export type CapacityInput = { terrainM2: number; floors: number; floorHeightM: number; grossM2PerUnit: number; siteEfficiencyPct: number };
export type CapacityResult = { footprintCeilingM2: number; grossCeilingM2: number; indicativeUnits: number; heightTest: 'within' | 'above' | 'unknown'; parkingMinimum: number | null } | null;

const num = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v.replace(',', '.'))) ? Number(v.replace(',', '.')) : null;
const ratio = (v: unknown): number | null => { const n = num(v); return n != null && n > 0 && n <= 1 ? n : n != null && n > 1 && n <= 100 ? n / 100 : null; };
const asRecord = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};

export function extractPluEnvelope(raw: Record<string, unknown> | null): PluEnvelope {
  const rs = asRecord(raw);
  const ces = asRecord(rs.ces), density = asRecord(rs.densite_emprise), legacy = asRecord(rs.emprise_sol);
  const height = asRecord(rs.hauteur), heights = asRecord(rs.hauteurs);
  const parking = asRecord(rs.stationnement), housing = asRecord(parking.logement);
  const notes: string[] = [];
  const cesRatio = ratio(ces.max_ratio ?? density.emprise_max_ratio ?? legacy.emprise_sol_max ?? legacy.ces_max_ratio);
  const heightM = num(height.max_m ?? heights.h_max_egout_m ?? height.hauteur_egout_m ?? height.hauteur_max_m);
  const parkingPerHousing = num(parking.par_logement ?? housing.places_par_logement ?? parking.places_par_logement);
  if (cesRatio == null) notes.push('Emprise maximale absente du règlement structuré.');
  if (heightM == null) notes.push('Hauteur maximale à l’égout absente du règlement structuré.');
  notes.push('Reculs, pleine terre, accès, servitudes, PPRI, destination autorisée et sécurité ERP restent à vérifier sur les pièces opposables.');
  return { cesRatio, heightM, parkingPerHousing, notes };
}

/** Plafond géométrique partiel, jamais des droits acquis ni un plan d'architecte. */
export function calculateIndicativeCapacity(kind: ProgrammeKind, plu: PluEnvelope, input: CapacityInput): CapacityResult {
  if (plu.cesRatio == null || !Number.isFinite(input.terrainM2) || input.terrainM2 <= 0 || !Number.isInteger(input.floors) || input.floors < 1 || input.floors > 30
    || !Number.isFinite(input.grossM2PerUnit) || input.grossM2PerUnit <= 0 || !Number.isFinite(input.floorHeightM) || input.floorHeightM <= 0
    || !Number.isFinite(input.siteEfficiencyPct) || input.siteEfficiencyPct <= 0 || input.siteEfficiencyPct > 100) return null;
  const footprintCeilingM2 = input.terrainM2 * plu.cesRatio * input.siteEfficiencyPct / 100;
  const grossCeilingM2 = footprintCeilingM2 * input.floors;
  const indicativeUnits = Math.floor(grossCeilingM2 / input.grossM2PerUnit);
  const heightTest = plu.heightM == null ? 'unknown' : input.floors * input.floorHeightM <= plu.heightM ? 'within' : 'above';
  return { footprintCeilingM2, grossCeilingM2, indicativeUnits, heightTest,
    parkingMinimum: kind === 'housing' && plu.parkingPerHousing != null ? Math.ceil(indicativeUnits * plu.parkingPerHousing) : null };
}

export function programmeKind(label: string): ProgrammeKind {
  const key = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/hotel|hoteller/.test(key)) return 'hotel';
  if (/ehpad|maison de retraite/.test(key)) return 'ehpad';
  if (/clinique|hopital|sante/.test(key)) return 'clinic';
  if (/supermarche|commerce|magasin/.test(key)) return 'retail';
  if (/etudiant/.test(key)) return 'student';
  if (/locaux d.activite|local d.activite|atelier|entrepot|parc d.activite/.test(key)) return 'activity';
  if (/bureau|tertiaire/.test(key)) return 'office';
  if (/logement|habitation|residence/.test(key)) return 'housing';
  return 'other';
}

export type TargetProposal = { title: string; reasons: string[]; programme: string[]; alternatives: string[]; decisiveChecks: string[] };
export function targetProposal(kind: ProgrammeKind, hotel: HotelEvidence | null): TargetProposal {
  if (kind === 'hotel') {
    const share = hotel?.nonResidentSharePct;
    const resident = share == null ? null : Math.round((100 - share) * 10) / 10;
    const peak = hotel?.months.reduce((best, month) => month.nights != null && (best == null || month.nights > best.nights!) ? month : best, null as typeof hotel.months[number] | null);
    const basque = hotel?.codeEpci === '200067106';
    const businessSignal = hotelTerritorialSignals(hotel?.codeRegion, hotel?.department ?? '')
      .find((signal) => signal.label === 'Nuitées d’affaires');
    return {
      title: basque ? 'Piste prioritaire à tester : séjours de loisirs au Pays basque' : resident != null ? 'Signal départemental : résidents en France ; motif du séjour inconnu' : 'Clientèle cible à établir avant de choisir le standing',
      reasons: basque ? [
        'L’enquête de clientèle ADT64 décrit au Pays basque des séjours tournés vers le repos, la baignade, la randonnée et la découverte du territoire. C’est un signal de destination, non une part de marché acquise pour ce terrain.',
        'Les baromètres hôteliers ADT64 publient occupation et prix par mois sur un échantillon d’établissements. Ils permettent de tester plusieurs saisons, sans valider le prix ou le remplissage du projet.',
        resident != null ? `${resident} % des nuitées hôtelières du département proviennent de résidents en France (${hotel?.frequencyYear}) ; cette statistique ne mesure pas le motif de séjour au Pays basque.` : 'L’origine des nuitées départementales n’est pas disponible.',
      ] : resident != null ? [
        `${resident} % des nuitées hôtelières du département proviennent de personnes résidant en France (${hotel?.frequencyYear}). Leur motif (loisirs, affaires ou autre) n’est pas mesuré ici, ni leur présence sur la parcelle étudiée.`,
        ...(businessSignal ? [`${businessSignal.value} des nuitées hôtelières sont liées aux affaires (${businessSignal.perimeter}, ${businessSignal.year}, ${businessSignal.source}). Ce signal justifie de tester une offre semaine et des comptes entreprises, sans conclure pour ce terrain.`] : []),
        peak?.nights != null ? `Le pic départemental de fréquentation est en ${peak.month}. Il impose de tester le modèle hors saison et les charges fixes.` : 'La saisonnalité locale reste à mesurer.',
      ] : ['La répartition de clientèle par origine n’est pas encore disponible ; aucune cible dominante ne peut être prouvée.'],
      programme: ['Tester plusieurs mixes de chambres seulement après mesure des profils et réservations comparables.', 'Tester petit déjeuner, accueil flexible et services de séjour selon enquêtes clients et coût d’exploitation.', 'Dimensionner la restauration, le parking et les espaces communs seulement après étude d’usage et règles ERP/PLU.'],
      alternatives: ['Familles et séjours longs : à vérifier avec taille des groupes, durée des séjours et typologies demandées.', 'Clientèle affaires en semaine : à mesurer avec entreprises, nuitées semaine et comptes locaux.', 'Clientèle internationale/premium : à tester avec tarifs et taux d’occupation d’hôtels comparables du bassin.'],
      decisiveChecks: ['Occupation et ADR de 5 à 10 hôtels comparables par saison.', 'Origine, durée de séjour et motif des voyages à l’échelle du bassin.', 'Entretiens exploitants avec programme, prix, coûts et conditions d’implantation.'],
    };
  }
  const catalog: Record<Exclude<ProgrammeKind, 'hotel'>, TargetProposal> = {
    activity: { title:'Entreprises et artisans à qualifier par métier', reasons:['Une présence d’entreprises ne prouve pas une demande d’implantation ni un besoin de bâtiment.'], programme:['Tester des lots divisibles avec hauteur libre, charge au sol et puissance électrique adaptées.', 'Vérifier accès poids lourds, manœuvres, logistique, part de bureaux et contraintes propres aux activités.'], alternatives:['Ateliers artisanaux','Locaux mixtes activité/bureaux','Stockage et distribution'], decisiveChecks:['Demandes d’implantation et cahiers des charges utilisateurs','Loyers signés, offres disponibles et projets concurrents','Précommercialisation, coût complet et valeur de sortie'] },
    housing: { title: 'Cible résidentielle à sélectionner par typologie et solvabilité', reasons: ['Les transactions DVF agrégées ne suffisent pas à départager primo-accédants, familles et seniors.'], programme: ['Comparer T1/T2, T3 et familiaux selon ménages, revenus, loyers et ventes comparables.', 'Dimensionner stationnement et espaces extérieurs selon règlement et demande vérifiée.'], alternatives: ['Accession libre', 'Locatif', 'Résidence services'], decisiveChecks: ['Ventes et loyers comparables par surface/typologie', 'Structure des ménages et projets concurrents', 'Prix de sortie et coût complet'] },
    ehpad: { title: 'Cible dépendance à définir avec les autorités et exploitants', reasons: ['La population âgée ne prouve ni le besoin en lits médicalisés ni l’autorisation.'], programme: ['Tester capacité, unités de vie, soins, locaux du personnel et logistique avec exploitant.', 'Vérifier accessibilité, ERP, accès secours et fonctionnement 24 h/24.'], alternatives: ['Résidence autonomie', 'Accueil temporaire'], decisiveChecks: ['FINESS et places autorisées du bassin', 'Schéma autonomie départemental et ARS', 'Occupation, personnel et tarifs locaux'] },
    clinic: { title: 'Spécialité médicale à établir avant le programme bâti', reasons: ['Un besoin de soins ne se déduit pas de la population seule.'], programme: ['Définir plateaux techniques, parcours patients et flux propres à la spécialité.', 'Séparer logistique, soins, visiteurs et accès secours.'], alternatives: ['Centre de santé', 'Maison médicale'], decisiveChecks: ['FINESS et offre par spécialité', 'PRS et autorisations ARS', 'Praticiens partenaires et bassin de recrutement'] },
    retail: { title: 'Format commercial à choisir après étude de chalandise', reasons: ['Les habitants de la commune ne représentent pas les flux ni le panier capturable.'], programme: ['Tester surface de vente, réserve, livraisons et stationnement sur flux observés.', 'Prévoir accès piéton et logistique distincts si le site le permet.'], alternatives: ['Proximité', 'Supermarché', 'Commerce spécialisé'], decisiveChecks: ['Temps de trajet et dépenses de la zone', 'Concurrence et parts de marché', 'Flux, CDAC éventuelle et critères d’enseigne'] },
    office: { title: 'Utilisateur tertiaire à qualifier avant le gabarit', reasons: ['L’emploi communal ne renseigne pas la demande placée ni la vacance de bureaux.'], programme: ['Tester plateaux divisibles, lumière, accès et services mutualisés.', 'Dimensionner surfaces et stationnement sur besoins utilisateurs signés.'], alternatives: ['Bureaux divisibles', 'Locaux d’activité'], decisiveChecks: ['Vacance et loyers de marché', 'Transactions utilisateurs', 'Précommercialisation'] },
    student: { title: 'Étudiants à cibler selon campus et mobilité', reasons: ['La part de jeunes habitants ne mesure pas le besoin de lits étudiants.'], programme: ['Tester studios et espaces collectifs selon loyers, coûts et distances campus.', 'Vérifier la gestion et la saison universitaire.'], alternatives: ['Résidence étudiante', 'Colocation', 'Logement classique'], decisiveChecks: ['Effectifs et mobilité des campus', 'Lits existants et loyers', 'Taux d’occupation annuel'] },
    other: { title: 'Cible à préciser pour ce programme', reasons: ['Aucune mesure sectorielle spécialisée ne permet encore de choisir le public.'], programme: ['Définir unités, surfaces et services avec un futur utilisateur.', 'Tester le gabarit avec le règlement opposable.'], alternatives: ['Usage alternatif à comparer après cadrage'], decisiveChecks: ['Demande et offre propres à cet usage', 'Modèle économique', 'Autorisations et opérateur'] },
  };
  return catalog[kind];
}
