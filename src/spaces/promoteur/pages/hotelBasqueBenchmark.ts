/** Relevé daté des baromètres publics ADT64. Les mois absents restent absents. */
export type HotelBenchmarkMonth = {
  month: string;
  respondents: number;
  occupancyPct: number;
  adrEuro: number;
  revparEuro: number;
  sourceUrl: string;
};

export const BASQUE_HOTEL_BENCHMARK: HotelBenchmarkMonth[] = [
  { month: '2025-03', respondents: 37, occupancyPct: 55, adrEuro: 115, revparEuro: 62, sourceUrl: 'https://pro.tourisme64.com/wp-content/uploads/2025/04/Barometre-hotelier-Pays-basque-Mars-2025.pdf' },
  { month: '2025-04', respondents: 31, occupancyPct: 65, adrEuro: 129, revparEuro: 79, sourceUrl: 'https://pro.tourisme64.com/wp-content/uploads/2025/05/Barometre-hotelier-Pays-basque-Avril-2025.pdf' },
  { month: '2025-05', respondents: 35, occupancyPct: 66, adrEuro: 143, revparEuro: 92, sourceUrl: 'https://pro.tourisme64.com/wp-content/uploads/2025/06/Barometre-hotelier-Pays-basque-Mai-2025-1.pdf' },
  { month: '2025-07', respondents: 35, occupancyPct: 78, adrEuro: 182, revparEuro: 147, sourceUrl: 'https://pro.tourisme64.com/wp-content/uploads/2025/08/Barometre-hotelier-Pays-basque-Juillet-2025.pdf' },
  { month: '2025-08', respondents: 28, occupancyPct: 90, adrEuro: 224, revparEuro: 206, sourceUrl: 'https://pro.tourisme64.com/wp-content/uploads/2025/09/Barometre-hotelier-Pays-basque-Aout-2025.pdf' },
  { month: '2025-10', respondents: 28, occupancyPct: 67, adrEuro: 150, revparEuro: 100, sourceUrl: 'https://pro.tourisme64.com/wp-content/uploads/2025/11/Barometre-hotelier-Pays-basque-Octobre-2025.pdf' },
  { month: '2025-11', respondents: 46, occupancyPct: 54, adrEuro: 119, revparEuro: 60, sourceUrl: 'https://pro.tourisme64.com/wp-content/uploads/2025/12/Barometre-hotelier-Pays-basque-Novembre-2025.pdf' },
  { month: '2025-12', respondents: 38, occupancyPct: 47, adrEuro: 147, revparEuro: 69, sourceUrl: 'https://pro.tourisme64.com/wp-content/uploads/2026/01/Barometre-hotelier-Pays-basque-Decembre-2025.pdf' },
  { month: '2026-01', respondents: 31, occupancyPct: 47, adrEuro: 129, revparEuro: 62, sourceUrl: 'https://pro.tourisme64.com/wp-content/uploads/2026/02/Barometre-hotelier-Pays-basque-Janvier-2026.pdf' },
  { month: '2026-02', respondents: 33, occupancyPct: 43, adrEuro: 127, revparEuro: 55, sourceUrl: 'https://pro.tourisme64.com/wp-content/uploads/2026/03/Barometre-hotelier-Pays-basque-Fevrier-2026.pdf' },
];

export function hotelBenchmarkForEpci(codeEpci: string | null | undefined): HotelBenchmarkMonth[] {
  return codeEpci === '200067106' ? BASQUE_HOTEL_BENCHMARK : [];
}
