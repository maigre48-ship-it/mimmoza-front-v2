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
  '01': ['971'],
  '02': ['972'],
  '03': ['973'],
  '04': ['974'],
  '06': ['976'],
  '11': ['75', '77', '78', '91', '92', '93', '94', '95'],
  '24': ['18', '28', '36', '37', '41', '45'],
  '27': ['21', '25', '39', '58', '70', '71', '89', '90'],
  '28': ['14', '27', '50', '61', '76'],
  '32': ['02', '59', '60', '62', '80'],
  '44': ['08', '10', '51', '52', '54', '55', '57', '67', '68', '88'],
  '52': ['44', '49', '53', '72', '85'],
  '53': ['22', '29', '35', '56'],
  '75': ['16', '17', '19', '23', '24', '33', '40', '47', '64', '79', '86', '87'],
  '76': ['09', '11', '12', '30', '31', '32', '34', '46', '48', '65', '66', '81', '82'],
  '84': ['01', '03', '07', '15', '26', '38', '42', '43', '63', '69', '73', '74'],
  '93': ['04', '05', '06', '13', '83', '84'],
  '94': ['2A', '2B'],
};

export function hotelTerritorialSignals(regionCode: string | null | undefined, department: string, communeInsee?: string): HotelTerritorialSignal[] {
  if (!regionCode || !DEPARTMENTS_BY_REGION[regionCode]?.includes(department)) return [];
  if (regionCode === '24') return [
    {
      label: 'Nuitées hôtelières · saison', value: '3 198 400', perimeter: 'Centre-Val de Loire',
      year: 2025, period: 'mai–septembre 2025', source: 'INSEE Centre-Val de Loire',
      sourceUrl: 'https://www.insee.fr/fr/statistiques/8675472',
      implication: 'Volume saisonnier, presque stable sur un an (-0,1 %) ; il ne représente pas la demande annuelle de la commune.',
    },
    {
      label: 'Hôtels 3 étoiles ou plus · évolution des nuitées', value: '+4,5 %', perimeter: 'Centre-Val de Loire',
      year: 2025, period: 'mai–septembre 2025', source: 'INSEE Centre-Val de Loire',
      sourceUrl: 'https://www.insee.fr/fr/statistiques/8675472',
      implication: 'Variation sur un an de la fréquentation de cette gamme ; ne mesure ni son occupation ni son prix.',
    },
  ];
  if (regionCode === '27') return [
    {
      label: 'Nuitées hôtelières · saison', value: '4,2 millions', perimeter: 'Bourgogne-Franche-Comté',
      year: 2025, period: 'avril–septembre 2025', source: 'INSEE Bourgogne-Franche-Comté',
      sourceUrl: 'https://www.insee.fr/fr/statistiques/8681513',
      implication: 'Fréquentation des hôtels de la région sur six mois ; ne doit pas être extrapolée à un site précis.',
    },
    {
      label: 'Clientèle non résidente · hôtels', value: '35,6 %', perimeter: 'Bourgogne-Franche-Comté',
      year: 2025, period: 'avril–septembre 2025', source: 'INSEE Bourgogne-Franche-Comté',
      sourceUrl: 'https://www.insee.fr/fr/statistiques/8681513',
      implication: 'Part calculée à partir de 1 502 000 nuitées non résidentes sur 4 217 000 nuitées hôtelières ; elle varie selon les bassins.',
    },
  ];
  if (regionCode === '32') return [
    {
      label: 'Nuitées hôtelières · saison', value: '5,2 millions', perimeter: 'Hauts-de-France',
      year: 2025, period: 'avril–septembre 2025', source: 'INSEE Hauts-de-France',
      sourceUrl: 'https://www.insee.fr/fr/statistiques/8684021',
      implication: 'Volume des hôtels régionaux, en hausse de 2,4 % sur un an ; le potentiel local reste à vérifier.',
    },
  ];
  if (regionCode === '52') return [
    {
      label: 'Nuitées d’affaires', value: 'Environ 1 sur 3', perimeter: 'Pays de la Loire',
      year: 2025, period: 'avril–septembre 2025', source: 'INSEE Pays de la Loire',
      sourceUrl: 'https://www.insee.fr/fr/statistiques/8742829',
      implication: 'Part régionale des nuitées hôtelières liées aux affaires sur la saison ; elle était proche de la moitié avant la crise sanitaire.',
    },
    {
      label: 'Nuitées hôtelières · saison', value: '4,3 millions', perimeter: 'Pays de la Loire',
      year: 2025, period: 'avril–septembre 2025', source: 'INSEE Pays de la Loire',
      sourceUrl: 'https://www.insee.fr/fr/statistiques/8742829',
      implication: 'Fréquentation des hôtels régionaux sur la saison, quasi stable (-0,2 %) ; elle ne prédit pas les ventes du projet.',
    },
  ];
  if (regionCode === '94') return [
    {
      label: 'Nuitées hôtelières · saison', value: '2,8 millions', perimeter: 'Corse',
      year: 2025, period: 'avril–septembre 2025', source: 'INSEE Corse',
      sourceUrl: 'https://www.insee.fr/fr/statistiques/8683931',
      implication: 'Fréquentation saisonnière des hôtels ; la haute saison ne suffit pas à établir la viabilité annuelle.',
    },
    {
      label: 'Clientèle résidant à l’étranger · hôtels', value: 'Environ 1 sur 3', perimeter: 'Corse',
      year: 2025, period: 'avril–septembre 2025', source: 'INSEE Corse',
      sourceUrl: 'https://www.insee.fr/fr/statistiques/8683931',
      implication: 'Part des nuitées hôtelières de personnes domiciliées hors de France ; elle ne décrit pas toutes les communes corses.',
    },
  ];
  if (regionCode === '01') return [
    {
      label: 'Nuitées hôtelières · année', value: '1,159 million', perimeter: 'Guadeloupe',
      year: 2025, source: 'INSEE Guadeloupe', sourceUrl: 'https://www.insee.fr/fr/statistiques/8905338',
      implication: 'Volume en recul de 9,5 % sur un an ; le trafic aérien progresse et ne doit pas être assimilé aux seules nuits d’hôtel.',
    },
    {
      label: 'Nuitées hôtelières de loisirs', value: '86 %', perimeter: 'Guadeloupe',
      year: 2025, source: 'INSEE Guadeloupe', sourceUrl: 'https://www.insee.fr/fr/statistiques/8905338',
      implication: 'Part des nuitées hôtelières de loisirs à l’échelle de l’archipel ; ne détermine pas la clientèle d’un établissement précis.',
    },
  ];
  if (regionCode === '02') return [
    {
      label: 'Nuitées hôtelières · année', value: '1,133 million', perimeter: 'Martinique',
      year: 2025, source: 'INSEE Martinique', sourceUrl: 'https://www.insee.fr/fr/statistiques/8905346',
      implication: 'Volume en baisse de 6,4 % sur un an ; les autres formes d’hébergement ne sont pas comprises.',
    },
    {
      label: 'Nuitées hôtelières de loisirs', value: '87 %', perimeter: 'Martinique',
      year: 2025, source: 'INSEE Martinique', sourceUrl: 'https://www.insee.fr/fr/statistiques/8905346',
      implication: 'Part des nuitées hôtelières de loisirs sur l’île ; vérifier localement la saison et les segments de clientèle.',
    },
  ];
  if (regionCode === '03') return [
    {
      label: 'Nuitées hôtelières · trimestre', value: '117 600', perimeter: 'Guyane',
      year: 2025, period: 'octobre–décembre 2025', source: 'INSEE Guyane',
      sourceUrl: 'https://www.insee.fr/fr/statistiques/8899571',
      implication: 'Volume du seul quatrième trimestre ; ne représente pas l’année entière.',
    },
    {
      label: 'Nuitées d’affaires', value: 'Près de 2 sur 3', perimeter: 'Guyane',
      year: 2025, period: 'octobre–décembre 2025', source: 'INSEE Guyane',
      sourceUrl: 'https://www.insee.fr/fr/statistiques/8899571',
      implication: 'Part des nuitées hôtelières d’affaires au quatrième trimestre ; la demande de missions doit être vérifiée hors de cette période.',
    },
  ];
  if (regionCode === '04') return [
    {
      label: 'Nuitées · hôtels et autres hébergements collectifs', value: '1 626 700', perimeter: 'La Réunion',
      year: 2025, source: 'INSEE La Réunion', sourceUrl: 'https://www.insee.fr/fr/statistiques/8968951',
      implication: 'Hôtels et 27 autres hébergements collectifs réunis : ce volume ne correspond pas aux seuls hôtels.',
    },
    {
      label: 'Occupation · hôtels et autres hébergements collectifs', value: '63 %', perimeter: 'La Réunion',
      year: 2025, source: 'INSEE La Réunion', sourceUrl: 'https://www.insee.fr/fr/statistiques/8968951',
      implication: 'Taux annuel des chambres offertes dans les deux types d’établissements ; il ne valide pas le remplissage d’un futur hôtel.',
    },
  ];
  if (regionCode === '06') return [
    {
      label: 'Nuitées · hôtels et autres hébergements collectifs', value: '149 500', perimeter: 'Mayotte',
      year: 2025, period: 'février–décembre 2025', source: 'INSEE Mayotte',
      sourceUrl: 'https://www.insee.fr/fr/statistiques/9010074',
      implication: 'Période partielle et offre réduite après Chido ; inclut deux résidences hôtelières et des séjours liés aux secours.',
    },
    {
      label: 'Occupation · hôtels et autres hébergements collectifs', value: '79 %', perimeter: 'Mayotte',
      year: 2025, period: 'février–décembre 2025', source: 'INSEE Mayotte',
      sourceUrl: 'https://www.insee.fr/fr/statistiques/9010074',
      implication: 'Taux élevé dans un parc réduit de 20 % après Chido, soutenu par les missions de secours ; ce n’est pas une demande touristique normale.',
    },
  ];
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
