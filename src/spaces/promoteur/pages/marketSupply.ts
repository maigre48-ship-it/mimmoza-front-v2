export type HousingPipeline = { communeInsee: string; years: string[]; annual: { year: string; homes: number; collective: number }[];
  authorisedHomes: number; collectiveHomes: number; sourceUrl: string };
export type SocialHousing = { communeInsee: string; year: number; homes: number; waitingApplications: number | null; allocations: number | null; sourceUrl: string };
export type MarketSupply = { pipeline: HousingPipeline | null; social: SocialHousing | null; warnings: string[] };

const whole = (value: unknown): number | null => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function parseSitadel(raw: unknown, insee: string): HousingPipeline | null {
  const response = object(raw), stats = object(response?.stats), homes = object(stats?.logements);
  if (response?.status !== 'ok' || stats?.commune_insee !== insee || !homes) return null;
  const series = Array.isArray(homes.par_annee) ? homes.par_annee.map(object).filter((row): row is Record<string, unknown> => !!row) : [];
  const recent = series.slice(0, 3);
  const years = recent.map((row) => String(row.annee ?? '')).filter((year) => /^20\d{2}$/.test(year));
  if (!recent.length || years.length !== recent.length || recent.some((row) => whole(row.total) == null || whole(row.collectif) == null)) return null;
  return { communeInsee: insee, years, annual: recent.map((row) => ({ year: String(row.annee), homes: whole(row.total)!, collective: whole(row.collectif)! })),
    authorisedHomes: recent.reduce((sum, row) => sum + whole(row.total)!, 0),
    collectiveHomes: recent.reduce((sum, row) => sum + whole(row.collectif)!, 0),
    sourceUrl: 'https://www.statistiques.developpement-durable.gouv.fr/la-base-de-donnees-sitadel-methodologie' };
}
export function parseRpls(raw: unknown, insee: string): SocialHousing | null {
  const response = object(raw);
  const homes = whole(response?.logementsRpls);
  const year = whole(response?.rplsAnnee);
  if (response?.codeInsee !== insee || response?.rplsMode !== 'reel' || homes == null || year == null || year < 2000 || year > new Date().getFullYear()) return null;
  return { communeInsee: insee, year, homes, waitingApplications: whole(response?.demandesEnAttente), allocations: whole(response?.attributionsAnnuelles),
    sourceUrl: 'https://www.statistiques.developpement-durable.gouv.fr/les-logements-sociaux' };
}
