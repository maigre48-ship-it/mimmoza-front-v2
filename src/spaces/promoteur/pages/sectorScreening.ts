import type { HotelEvidence } from './hotelMarket.ts';
import { BPE_TYPES, type BpeMarket } from './bpeMarket.ts';

export type SectorKey = 'logement' | 'hotel' | 'ehpad' | 'commerce' | 'bureaux' | 'residence_etudiante' | 'clinique';
export type MarketResult = {
  success?: boolean;
  error?: string;
  meta?: { commune_nom?: string; commune_insee?: string; departement?: string; generated_at?: string; perimetres?: Record<string, string> };
  core?: {
    dvf?: { nb_transactions?: number; prix_m2_median?: number; perimetre_label?: string; coverage?: string;
      fenetre_label?: string; nb_transactions_plafonne?: boolean; transactions?: Array<{ date_mutation?: string; valeur_fonciere?: number;
        surface_reelle_bati?: number | null; type_local?: string; commune?: string; prix_m2?: number | null }> };
    insee?: { population?: number; revenu_median?: number; revenu_median_source?: string };
    bpe?: { coverage?: string; bpe_quality?: { full_coverage?: boolean } };
  };
  specific?: Record<string, unknown> | null;
  warnings?: string[];
};
export type SectorSnapshot = { key: SectorKey; market: MarketResult | null; error: string | null; hotel?: HotelEvidence | null; bpe?: BpeMarket | null };
export type SectorFact = { label: string; value: string; scope: string; source: string; sourceUrl?: string; direct: boolean };
export type SectorReading = {
  key: SectorKey; label: string; target: string; programme: string;
  facts: SectorFact[]; missing: string[]; status: 'a_instruire' | 'insuffisant';
};

export const SCREENING_SECTORS: { key: SectorKey; label: string }[] = [
  { key: 'logement', label: 'Logements' }, { key: 'hotel', label: 'Hôtel' },
  { key: 'ehpad', label: 'EHPAD' }, { key: 'commerce', label: 'Supermarché' },
  { key: 'bureaux', label: 'Bureaux' }, { key: 'residence_etudiante', label: 'Résidence étudiante' },
  { key: 'clinique', label: 'Clinique' },
];

const DETAILS: Record<SectorKey, { target: string; programme: string; missing: string[] }> = {
  logement: { target: 'Ménages du bassin, par taille et solvabilité à vérifier', programme: 'Comparer accession, locatif et typologies de logements.', missing: ['Ventes et loyers par typologie dans le bassin', 'Programmes concurrents et rythme d’absorption'] },
  hotel: { target: 'Séjours de loisirs et/ou d’affaires à départager localement', programme: 'Comparer classement, nombre de chambres et services selon la saison.', missing: ['Occupation et ADR d’hôtels comparables par saison', 'Motifs, provenance et durée des séjours du bassin'] },
  ehpad: { target: 'Personnes âgées dépendantes du bassin et prescripteurs à qualifier', programme: 'Étudier des places médicalisées seulement avec un exploitant et les autorisations.', missing: ['Places autorisées et projets du bassin', 'Listes d’attente, tarifs et autorisation ARS/département'] },
  commerce: { target: 'Ménages de la zone de chalandise à délimiter', programme: 'Comparer commerce de proximité et grande surface selon flux et accès.', missing: ['Dépenses alimentaires captables et flux réels', 'Enseignes concurrentes, accès et autorisation commerciale'] },
  bureaux: { target: 'Entreprises utilisatrices ou investisseurs tertiaires à identifier', programme: 'Tester plateaux divisibles et services selon utilisateurs.', missing: ['Demande placée et vacance de bureaux', 'Loyers et engagements d’utilisateurs du bassin'] },
  residence_etudiante: { target: 'Étudiants mobiles des campus accessibles à mesurer', programme: 'Tester studios et services selon les loyers accessibles.', missing: ['Effectifs et mobilité par campus', 'Lits concurrents, loyers et taux d’occupation'] },
  clinique: { target: 'Patients d’une spécialité à définir avec un opérateur', programme: 'Définir la spécialité, les plateaux techniques et les flux patients.', missing: ['Besoins de soins par spécialité', 'FINESS, capacités, autorisations et stratégie ARS'] },
};

const obj = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const nested = (value: unknown, key: string) => obj(obj(value)[key]);
const measured = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const signed = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const positive = (value: unknown): number | null => { const number = measured(value); return number != null && number > 0 ? number : null; };
const fmt = (value: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value);

/** Chaque fait garde son champ et son périmètre. Aucun score intersectoriel n'est construit. */
export function readSector(snapshot: SectorSnapshot): SectorReading {
  const { key, market } = snapshot;
  const details = DETAILS[key];
  const facts: SectorFact[] = [];
  const push = (label: string, value: number | null, unit: string, scope: string, source: string, direct = true) => {
    const sourceUrl = source === 'DVF via étude Mimmoza' ? 'https://www.data.gouv.fr/datasets/demandes-de-valeurs-foncieres'
      : source === 'BPE via étude Mimmoza' ? 'https://www.insee.fr/fr/statistiques/8217537'
        : source === 'INSEE Melodi' ? (['Hôtels existants', 'Chambres existantes'].includes(label) ? snapshot.hotel?.capacityUrl : snapshot.hotel?.annualUrl) ?? undefined
          : source.startsWith('INSEE') && /^(?:\d{5}|2[AB]\d{3})$/.test(commune) ? `https://www.insee.fr/fr/statistiques/2011101?geo=COM-${commune}` : undefined;
    if (value != null) facts.push({ label, value: `${fmt(value)}${unit}`, scope, source, sourceUrl, direct });
  };
  const spec = market?.specific;
  const insee = market?.core?.insee;
  const dvf = market?.core?.dvf;
  const commune = market?.meta?.commune_insee ?? snapshot.bpe?.communeInsee ?? 'non vérifiée';
  const communeScope = `Commune ${commune}`;
  const bpe = snapshot.bpe?.communeInsee === commune ? snapshot.bpe : null;
  const pushBpe = (type: keyof typeof BPE_TYPES) => {
    if (!bpe) return;
    const local = bpe.commune[type];
    const count = local ?? bpe.departmentCounts[type];
    if (count == null) return;
    facts.push({ label: BPE_TYPES[type], value: fmt(count), scope: local != null ? `Commune ${commune} · ${bpe.year}` : `Département ${bpe.department} · ${bpe.year}`,
      source: 'INSEE BPE', sourceUrl: local != null ? bpe.communeUrl : bpe.departmentUrl, direct: false });
  };
  if (key === 'logement') {
    const demo = nested(spec, 'demographie');
    if (demo.pct_logements_vacants_source === 'mesure') push('Logements vacants', measured(demo.pct_logements_vacants), ' %', communeScope, 'INSEE via étude Mimmoza', false);
    if (demo.pct_moins_15_source === 'mesure') push('Habitants de moins de 15 ans', measured(demo.pct_moins_15), ' %', communeScope, 'INSEE via étude Mimmoza', false);
    if (dvf?.coverage === 'ok') {
      const dvfScope = [dvf.perimetre_label ?? communeScope, dvf.fenetre_label, dvf.nb_transactions_plafonne ? 'décompte plafonné : au moins ce nombre de ventes' : null].filter(Boolean).join(' · ');
      push('Transactions DVF', measured(dvf.nb_transactions), '', dvfScope, 'DVF via étude Mimmoza');
      push('Prix médian DVF', positive(dvf.prix_m2_median), ' €/m²', dvfScope, 'DVF via étude Mimmoza', false);
    }
  } else if (key === 'hotel') {
    const hotel = snapshot.hotel;
    push('Hôtels existants', measured(hotel?.capacity.find((row) => row.ranking === '_T')?.hotels), '', `${communeScope} · ${hotel?.capacityYear ?? 'année inconnue'}`, 'INSEE Melodi', false);
    push('Chambres existantes', measured(hotel?.capacity.find((row) => row.ranking === '_T')?.rooms), '', `${communeScope} · ${hotel?.capacityYear ?? 'année inconnue'}`, 'INSEE Melodi', false);
    const hotelScope = `Département ${hotel?.department ?? 'non vérifié'} · ${hotel?.frequencyYear ?? 'année inconnue'}`;
    push('Nuitées hôtelières', measured(hotel?.annualNights), '', hotelScope, 'INSEE Melodi');
    if (hotel?.annualNights != null && hotel.previousAnnualNights != null && hotel.previousAnnualNights > 0)
      push('Évolution des nuitées sur un an', signed((hotel.annualNights / hotel.previousAnnualNights - 1) * 100), ' %', hotelScope, 'INSEE Melodi', false);
    push('Nuitées non résidentes', measured(hotel?.nonResidentSharePct), ' %', hotelScope, 'INSEE Melodi', false);
  } else if (key === 'ehpad') {
    const senior = nested(spec, 'demographie_senior');
    if (senior.population_75_plus_source === 'mesure') push('Habitants de 75 ans ou plus', measured(senior.population_75_plus), '', communeScope, 'INSEE via étude Mimmoza', false);
    const competition = nested(spec, 'concurrence');
    if (!bpe && competition.coverage === 'ok' && measured(competition.count)) push('Établissements repérés', measured(competition.count), '', 'Bassin de concurrence de l’étude', 'OpenStreetMap via étude Mimmoza', false);
    pushBpe('D401');
    pushBpe('D402');
  } else if (key === 'commerce') {
    const zone = nested(spec, 'zone_chalandise');
    push('Population communale', positive(zone.population), '', communeScope, 'INSEE via étude Mimmoza', false);
    if (zone.revenu_median_source !== 'dept_fallback') push('Revenu médian', measured(zone.revenu_median), ' €', communeScope, 'INSEE via étude Mimmoza', false);
    const shops = measured(nested(spec, 'concurrence').supermarches);
    if (!bpe && market?.core?.bpe?.coverage === 'ok' && (shops !== 0 || market.core.bpe.bpe_quality?.full_coverage))
      push('Supermarchés recensés', shops, '', communeScope, 'BPE via étude Mimmoza', false);
    pushBpe('B104');
    pushBpe('B105');
    pushBpe('B201');
    pushBpe('B202');
  } else if (key === 'bureaux') {
    const employment = nested(spec, 'bassin_emploi');
    if (employment.pct_actifs_source === 'mesure') push('Population active', measured(employment.pct_actifs), ' %', communeScope, 'INSEE via étude Mimmoza', false);
    push('Population communale', positive(insee?.population), '', communeScope, 'INSEE via étude Mimmoza', false);
  } else if (key === 'residence_etudiante') {
    const students = nested(spec, 'population_etudiante');
    if (students.pct_etudiants_source === 'mesure') push('Étudiants parmi les habitants', measured(students.pct_etudiants), ' %', communeScope, 'INSEE via étude Mimmoza', false);
    if (students.pct_15_29_source === 'mesure') push('Habitants de 15 à 29 ans', measured(students.pct_15_29), ' %', communeScope, 'INSEE via étude Mimmoza', false);
    const campuses = measured(students.nb_etablissements_superieurs);
    if (!bpe && market?.core?.bpe?.coverage === 'ok' && (campuses !== 0 || market.core.bpe.bpe_quality?.full_coverage))
      push('Établissements supérieurs recensés', campuses, '', communeScope, 'BPE via étude Mimmoza', false);
    pushBpe('C701');
    pushBpe('C501');
    pushBpe('C502');
  } else if (key === 'clinique') {
    pushBpe('D101');
    pushBpe('D102');
    pushBpe('D103');
    pushBpe('D104');
  }
  return {
    key, label: SCREENING_SECTORS.find((sector) => sector.key === key)?.label ?? key,
    target: details.target, programme: details.programme, facts,
    missing: [...details.missing, ...(snapshot.error ? [snapshot.error] : [])],
    status: facts.some((fact) => fact.direct) ? 'a_instruire' : 'insuffisant',
  };
}
