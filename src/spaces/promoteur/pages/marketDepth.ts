import { readSector, type SectorFact, type SectorKey, type SectorSnapshot } from './sectorScreening.ts';

export type MarketChapter = { title: string; question: string; facts: SectorFact[]; missing: string };
export type MarketDepth = { label: string; target: string; programme: string; chapters: MarketChapter[]; blockers: string[]; observedActivity: boolean };

const GUIDE: Record<SectorKey, [string, string, string]> = {
  logement: ['Ventes et loyers par typologie, ménages solvables et rythme de commercialisation', 'Programmes neufs, stock disponible, vacance et temps de vente dans le bassin', 'Prix signés par typologie, loyers réellement pratiqués et coûts de construction'],
  hotel: ['Nuitées, occupation, provenance et saisonnalité au bassin de destination', 'Hôtels comparables par classement, chambres, services et projets annoncés', 'ADR et RevPAR observés par saison, coûts et budget d’exploitation'],
  ehpad: ['Personnes dépendantes, listes d’attente et solvabilité des familles au bassin', 'Places autorisées FINESS, taux d’occupation et projets autorisés', 'Tarifs hébergement et dépendance comparables, budget et conditions de l’exploitant'],
  commerce: ['Zone de chalandise réelle, dépenses captables et flux mesurés', 'Enseignes et surfaces concurrentes, accès et projets commerciaux', 'Chiffre d’affaires au m² soutenable, loyers et coûts d’exploitation'],
  bureaux: ['Demandes utilisateurs signées ou qualifiées, surfaces et emplois du bassin', 'Vacance, livraisons et surfaces concurrentes par qualité', 'Loyers signés, franchises, charges et durée d’absorption'],
  residence_etudiante: ['Effectifs par campus, étudiants mobiles et budgets logement', 'Lits concurrents, occupation et pipeline de résidences', 'Loyers signés, charges, services et budget d’exploitation'],
  clinique: ['Besoins de soins par spécialité, origine et parcours des patients', 'Capacités FINESS, spécialités, délais d’accès et projets autorisés', 'Tarification et volumes par acte, coûts médicaux et conditions de l’opérateur'],
};

const GROUPS: Record<SectorKey, [string[], string[], string[]]> = {
  logement: [['Transactions DVF', 'Habitants de moins de 15 ans'], ['Logements vacants'], ['Prix médian DVF']],
  hotel: [['Nuitées hôtelières', 'Évolution des nuitées sur un an', 'Nuitées non résidentes'], ['Hôtels existants', 'Chambres existantes'], []],
  ehpad: [['Habitants de 75 ans ou plus'], ['Établissements repérés', 'Hébergements pour personnes âgées', 'Services de soins à domicile pour personnes âgées'], []],
  commerce: [['Population communale', 'Revenu médian'], ['Supermarchés recensés', 'Hypermarchés et grands magasins', 'Supermarchés et magasins multi-commerces', 'Supérettes', 'Épiceries'], []],
  bureaux: [['Population active', 'Population communale'], [], []],
  residence_etudiante: [['Étudiants parmi les habitants', 'Habitants de 15 à 29 ans'], ['Établissements supérieurs recensés', 'Résidences universitaires CROUS', 'UFR', 'Instituts universitaires'], []],
  clinique: [[], ['Établissements de soins de courte durée', 'Établissements de soins de suite et de réadaptation', 'Établissements de soins de longue durée', 'Établissements psychiatriques'], []],
};

/** Conserve chaque mesure, son périmètre et la question à instruire ; aucun score artificiel. */
export function buildMarketDepth(snapshot: SectorSnapshot): MarketDepth {
  const reading = readSector(snapshot);
  const groups = GROUPS[snapshot.key];
  const guide = GUIDE[snapshot.key];
  const axes = ['Demande et cible', 'Offre et concurrence', 'Prix et économie'];
  const chapters = axes.map((title, index) => ({
    title, question: guide[index],
    facts: reading.facts.filter((fact) => groups[index].includes(fact.label)),
    missing: `À mesurer : ${guide[index]}.`,
  }));
  return { label: reading.label, target: reading.target, programme: reading.programme, chapters,
    blockers: reading.missing, observedActivity: reading.facts.some((fact) => fact.direct) };
}
