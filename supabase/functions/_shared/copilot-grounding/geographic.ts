export interface GeographicOverclaim {
  code: string;
  explanation: string;
  excerpt: string;
}

const OVERCLAIM_RULES: Array<{ code: string; explanation: string; pattern: RegExp }> = [
  { code: 'CATNAT_PARCEL_INFERENCE', explanation: 'Un arrêté CATNAT communal ne prouve pas que la parcelle est inondable.', pattern: /(?:catnat|arr[eê]t[eé]s? de catastrophe naturelle).{0,100}(?:parcelle|terrain|adresse).{0,50}(?:inondable|expos[eé]e?|en zone inondable)/gis },
  { code: 'LOW_ALTITUDE_FLOOD_PROOF', explanation: 'Une altitude basse est un indicateur, pas une preuve d’inondation.', pattern: /(?:altitude (?:basse|faible)|faible altitude).{0,100}(?:prouve|confirme|donc|signifie).{0,50}(?:inond|crue)/gis },
  { code: 'NEARBY_SEVESO_PPRT_INFERENCE', explanation: 'La proximité d’un site SEVESO ou ICPE ne prouve pas l’inclusion dans un PPRT.', pattern: /(?:seveso|icpe).{0,80}(?:proche|proximit[eé]).{0,100}(?:dans|couvert|soumis|inclus).{0,30}(?:pprt|p[eé]rim[eè]tre)/gis },
  { code: 'COMMUNE_SISPEA_CONNECTION_INFERENCE', explanation: 'La couverture SISPEA communale ne confirme pas le raccordement d’une adresse.', pattern: /(?:sispea|assainissement (?:collectif|communal)).{0,120}(?:adresse|bien|immeuble|parcelle).{0,40}(?:raccord[eé]e?|desservi)/gis },
  { code: 'FIRE_HAZARD_OLD_INFERENCE', explanation: 'Un aléa feu ne suffit pas à établir une obligation légale de débroussaillement.', pattern: /(?:al[eé]a|risque).{0,30}(?:feu|incendie).{0,100}(?:obligation|obligatoire|soumis).{0,30}(?:d[eé]broussail|\bOLD\b)/gis },
  { code: 'SLOPE_GEOTECHNICAL_INFERENCE', explanation: 'Une pente ponctuelle ne permet pas d’exclure terrassement ou étude géotechnique.', pattern: /(?:pente|altim[eé]trie).{0,100}(?:aucun|pas de|sans).{0,40}(?:terrassement|surco[uû]t|g[eé]otechnique)/gis },
  { code: 'NEARBY_SIS_PARCEL_INFERENCE', explanation: 'Un SIS à proximité ne prouve pas que la parcelle est située dans un SIS.', pattern: /(?:\bSIS\b|secteur d'information sur les sols).{0,80}(?:proche|proximit[eé]).{0,100}(?:parcelle|terrain|adresse).{0,40}(?:dans|situ[eé]e?|inscrite?)/gis },
  { code: 'UNRESOLVED_PARCEL_ASSERTION', explanation: 'Sans parcelle cadastrale résolue ou intersection géométrique, une exposition parcellaire ne peut pas être affirmée.', pattern: /(?:parcelle (?:cadastrale )?(?:non |pas )?(?:r[eé]solue|identifi[eé]e)|(?:adresse|coordonn[eé]es?) uniquement).{0,160}(?:la parcelle|le terrain).{0,50}(?:est expos[eé]e?|est situ[eé]e? dans|se trouve dans)/gis },
];

export function geographicGroundingPolicy(): string {
  return [
    '# POLITIQUE PRIORITAIRE — ANCRAGE GÉOGRAPHIQUE',
    'Pour chaque affirmation localisée, indique le périmètre exact (adresse, parcelle, rayon ou commune) et qualifie-la : « confirmé », « indicateur » ou « à vérifier ».',
    'Une donnée communale ou de proximité ne devient jamais une donnée parcellaire. Une adresse ou des coordonnées ne signifient pas qu’une parcelle cadastrale a été résolue.',
    'CATNAT communal ≠ parcelle inondable. Altitude basse ≠ preuve d’inondation. Proximité SEVESO/ICPE ≠ inclusion dans un PPRT.',
    'Couverture SISPEA communale ≠ raccordement de l’adresse. Aléa feu ≠ obligation légale de débroussaillement (OLD).',
    'Pente ponctuelle ≠ absence de terrassement, de surcoût ou de besoin géotechnique. SIS à proximité ≠ parcelle située dans un SIS.',
    'Si la parcelle ou sa surface n’est pas résolue, n’écris jamais « la parcelle est exposée » ou « la parcelle est située dans » sauf si un outil renvoie explicitement une intersection géométrique.',
    'En l’absence de preuve au bon périmètre, formule le signal comme un indicateur et précise la vérification nécessaire.',
  ].join('\n');
}

/** Heuristic regression signal. It deliberately does not block production. */
export function detectGeographicOverclaims(text: string): GeographicOverclaim[] {
  const findings: GeographicOverclaim[] = [];
  for (const rule of OVERCLAIM_RULES) {
    rule.pattern.lastIndex = 0;
    for (const match of text.matchAll(rule.pattern)) {
      findings.push({ code: rule.code, explanation: rule.explanation, excerpt: match[0].replace(/\s+/g, ' ').trim().slice(0, 240) });
    }
  }
  return findings;
}
