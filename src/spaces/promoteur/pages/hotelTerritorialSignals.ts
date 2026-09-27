/** Publications territoriales vérifiées, distinctes des séries nationales INSEE. */
export type HotelTerritorialSignal = {
  label: string;
  value: string;
  perimeter: string;
  year: number;
  source: string;
  sourceUrl: string;
  implication: string;
};

const AURA_URL = 'https://pro.auvergnerhonealpes-tourisme.com/memento/hotellerie/';
const BUSINESS_SHARE_BY_DEPARTMENT: Record<string, number> = {
  '01': 41, '03': 35, '07': 33, '15': 27, '26': 36, '38': 34,
  '42': 56, '43': 38, '63': 38, '69': 28, '73': 14, '74': 23,
};

export function hotelTerritorialSignals(regionCode: string | null | undefined, department: string): HotelTerritorialSignal[] {
  if (regionCode === '84') {
    const businessShare = BUSINESS_SHARE_BY_DEPARTMENT[department];
    return [
      ...(businessShare == null ? [] : [{
        label: 'Nuitées d’affaires', value: `${businessShare} %`, perimeter: `Département ${department}`,
        year: 2025, source: 'Auvergne-Rhône-Alpes Tourisme', sourceUrl: AURA_URL,
        implication: 'Indique le poids observé du voyage d’affaires dans le département ; ne prédit pas la demande à l’adresse du projet.',
      }]),
      { label: 'Occupation des hôtels 4 et 5 étoiles', value: '67,5 %', perimeter: 'Auvergne-Rhône-Alpes',
        year: 2025, source: 'Auvergne-Rhône-Alpes Tourisme', sourceUrl: AURA_URL,
        implication: 'Moyenne régionale de cette gamme : à confronter au bassin local, à la saison et au prix visé.' },
    ];
  }
  if (regionCode === '53') return [{
    label: 'Occupation des hôtels 4 et 5 étoiles', value: '60,7 %', perimeter: 'Bretagne',
    year: 2025, source: 'Tourisme Bretagne',
    sourceUrl: 'https://pro.tourismebretagne.bzh/etudes/frequentation-des-hotels-bilan-annuel-2025/',
    implication: 'Moyenne régionale de cette gamme ; la performance du projet dépend du bassin, des tarifs et de l’exploitation.',
  }];
  if (regionCode === '28') return [{
    label: 'Nuitées d’affaires', value: '30,9 %', perimeter: 'Normandie',
    year: 2025, source: 'Normandie Tourisme',
    sourceUrl: 'https://pro.normandie-tourisme.fr/2026/04/27/une-frequentation-stable-dans-les-hotels-normands-en-2025/',
    implication: 'Part régionale observée du tourisme d’affaires ; le poids local peut différer fortement.',
  }];
  return [];
}
