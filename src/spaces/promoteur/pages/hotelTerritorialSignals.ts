/** Publications territoriales vérifiées, distinctes des séries nationales INSEE. */
export type HotelTerritorialSignal = {
  label: string;
  value: string;
  perimeter: string;
  year: number;
  period?: string;
  source: string;
  sourceUrl: string;
  updatesUrl?: string;
  implication: string;
};

const AURA_URL = 'https://pro.auvergnerhonealpes-tourisme.com/memento/hotellerie/';
const BUSINESS_SHARE_BY_DEPARTMENT: Record<string, number> = {
  '01': 41, '03': 35, '07': 33, '15': 27, '26': 36, '38': 34,
  '42': 56, '43': 38, '63': 38, '69': 28, '73': 14, '74': 23,
};
const DEPARTMENTS_BY_REGION: Record<string, string[]> = {
  '11': ['75', '77', '78', '91', '92', '93', '94', '95'],
  '28': ['14', '27', '50', '61', '76'],
  '44': ['08', '10', '51', '52', '54', '55', '57', '67', '68', '88'],
  '53': ['22', '29', '35', '56'],
  '75': ['16', '17', '19', '23', '24', '33', '40', '47', '64', '79', '86', '87'],
  '76': ['09', '11', '12', '30', '31', '32', '34', '46', '48', '65', '66', '81', '82'],
  '84': ['01', '03', '07', '15', '26', '38', '42', '43', '63', '69', '73', '74'],
  '93': ['04', '05', '06', '13', '83', '84'],
};

export function hotelTerritorialSignals(regionCode: string | null | undefined, department: string, communeInsee?: string): HotelTerritorialSignal[] {
  if (!regionCode || !DEPARTMENTS_BY_REGION[regionCode]?.includes(department)) return [];
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
  if (regionCode === '11') return [
    {
      label: 'Touristes internationaux · tous hébergements', value: 'Plus de 23 millions', perimeter: 'Île-de-France',
      year: 2025, source: 'Choose Paris Region',
      sourceUrl: 'https://pro.visitparisregion.com/presse/presse/communiques-de-presse/communique-de-presse-bilan-annuel-2025-frequentation-touristique-a-paris-ile-de-france',
      implication: 'Flux touristique régional, tous hébergements confondus. Ce nombre ne mesure ni les nuitées hôtelières ni la demande de la commune.',
    },
    ...(communeInsee === '75056' ? [{
      label: 'Occupation hôtelière · Paris intra-muros', value: '80,9 %', perimeter: 'Commune de Paris',
      year: 2026, period: 'juillet–août 2026', source: 'Paris je t’aime',
      sourceUrl: 'https://parisjetaime.com/media/article/barometre-septembre-2026-a2033',
      updatesUrl: 'https://parisjetaime.com/professionnels/article/barometre-du-tourisme-parisien-a1476',
      implication: 'Moyenne observée sur deux mois d’été ; elle ne représente ni l’année entière ni les autres communes franciliennes.',
    }] : []),
  ];
  if (regionCode === '93') {
    const regional: HotelTerritorialSignal = {
      label: 'Occupation · hôtellerie urbaine', value: '67 %', perimeter: 'Provence-Alpes-Côte d’Azur',
      year: 2025, source: 'CRT Provence-Alpes-Côte d’Azur',
      sourceUrl: 'https://provence-alpes-cotedazur.com/app/uploads/crt-paca/2026/06/Bilan-2025-de-lhotellerie-regionale.pdf',
      implication: 'Moyenne annuelle des hôtels urbains de la région ; le littoral et l’arrière-pays ont des saisons et des prix différents.',
    };
    const regionalPrice: HotelTerritorialSignal = {
      label: 'Prix moyen HT · hôtellerie urbaine', value: '157 €', perimeter: 'Provence-Alpes-Côte d’Azur',
      year: 2025, source: 'CRT Provence-Alpes-Côte d’Azur',
      sourceUrl: 'https://provence-alpes-cotedazur.com/app/uploads/crt-paca/2026/06/Bilan-2025-de-lhotellerie-regionale.pdf',
      implication: 'Prix moyen des chambres vendues sur le panel régional urbain. Ce n’est ni un tarif affiché ni une hypothèse de prix validée pour le projet.',
    };
    if (department !== '06') return [regional, regionalPrice];
    const coteUrl = 'https://cotedazurfrance.fr/professionnels-du-tourisme/actualites/bilan-touristique-2025-realise-par-lobservatoire-du-tourisme-de-la-cote-dazur/';
    return [regional, regionalPrice, {
      label: 'Occupation hôtelière · Côte d’Azur', value: 'Environ 66 %', perimeter: 'Destination Alpes-Maritimes et Monaco',
      year: 2025, source: 'Côte d’Azur France Tourisme', sourceUrl: coteUrl,
      updatesUrl: 'https://www.explorenicecotedazur.com/espaces-professionnels/observatoire-du-tourisme/barometre/',
      implication: 'Moyenne annuelle de la destination publiée par l’observatoire ; Monaco est inclus et le résultat ne décrit pas chaque commune.',
    }, {
      label: 'Occupation hôtelière · été', value: '85 %', perimeter: 'Destination Alpes-Maritimes et Monaco',
      year: 2025, period: 'juin–septembre 2025', source: 'Côte d’Azur France Tourisme', sourceUrl: coteUrl,
      implication: 'Moyenne des quatre mois d’été ; elle ne doit pas servir de taux annuel dans le prévisionnel.',
    }];
  }
  if (regionCode === '76') return [{
    label: 'Nuitées d’affaires', value: '30 %', perimeter: 'Occitanie',
    year: 2025, source: 'Tourisme Occitanie',
    sourceUrl: 'https://pro.tourisme-occitanie.com/veille-economique/etudes-et-chiffres-cles/hebergements/',
    implication: 'Part régionale des nuitées hôtelières liées aux affaires ; la clientèle du bassin peut être très différente.',
  }];
  if (regionCode === '44') return [{
    label: 'Clientèle allemande parmi les nuitées étrangères', value: '24,1 %', perimeter: 'Grand Est',
    year: 2025, period: 'avril–septembre 2025', source: 'INSEE Grand Est',
    sourceUrl: 'https://www.insee.fr/fr/statistiques/8729268',
    implication: 'Part des nuitées étrangères dans les hôtels régionaux sur la saison ; ce n’est pas 24,1 % de toutes les nuitées.',
  }];
  if (regionCode === '75') return [{
    label: 'Clientèle étrangère · hôtels 4 et 5 étoiles', value: '36 %', perimeter: 'Nouvelle-Aquitaine',
    year: 2025, period: 'avril–septembre 2025', source: 'INSEE Nouvelle-Aquitaine',
    sourceUrl: 'https://www.insee.fr/fr/statistiques/8673609',
    implication: 'Part des nuitées des clients étrangers effectuées dans cette gamme, sur la saison ; ne mesure pas l’occupation des hôtels 4 et 5 étoiles.',
  }];
  return [];
}
