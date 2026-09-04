export interface UnsupportedInference { code: string; explanation: string; excerpt: string }

const RULES: Array<{ code: string; explanation: string; pattern: RegExp }> = [
  { code: 'SPONTANEOUS_PARCEL_YIELD', explanation: 'Un rapport parcellaire non financier ne doit pas calculer spontanément un rendement en croisant loyer communal et prix DVF.', pattern: /(?:rendement brut|rentabilit[eé]).{0,100}(?:loyer.{0,50}(?:dvf|prix)|(?:dvf|prix).{0,50}loyer)/gis },
  { code: 'SLOPE_COST_OR_FAVORABILITY', explanation: "Une pente ne suffit pas à qualifier le terrassement, l'aménagement ou leurs coûts.", pattern: /pente.{0,100}(?:favorable|ais[eé]ment am[eé]nageable|facile [àa] am[eé]nager|sans difficult[eé]|terrassement (?:faible|limit[eé])|pas de surco[uû]t|surco[uû]t (?:faible|important)|co[uû]t.{0,30}terrassement)/gis },
  { code: 'GEOTECH_LEGAL_OVERCLAIM', explanation: "Les missions G1/G2 ne sont pas obligatoires de façon générale.", pattern: /(?:G1|G2|[eé]tude g[eé]otechnique).{0,90}(?:obligatoire|exig[eé]e)/gis },
  { code: 'THRS_VACANT_CONFUSION', explanation: 'La majoration THRS ne doit pas être présentée comme applicable aux logements vacants sans champ légal explicite.', pattern: /(?:majoration\s+THRS|majoration de (?:la )?taxe d.habitation).{0,100}logements? vacants?/gis },
  { code: 'UNMEASURED_IMMEDIATE_PROXIMITY', explanation: "La proximité ne peut être qualifiée d'immédiate sans distance numérique sourcée.", pattern: /proximit[eé] imm[eé]diate(?![^.!?\n]{0,80}\b\d+(?:[.,]\d+)?\s*(?:m|km)\b)/gis },
  { code: 'STREET_NAME_CHARACTERIZATION', explanation: "Le nom d'une voie ne permet pas de la qualifier de structurante ou bruyante.", pattern: /(?:avenue|boulevard|rue|route)[^.!?\n]{0,80}(?:structurante|bruyante)/gis },
  { code: 'UNSOURCED_QUALITATIVE_LABEL', explanation: 'Un qualificatif décisionnel doit provenir explicitement d’une métrique source portant ce label.', pattern: /\b(?:march[eé] actif|bien valoris[eé]|demande soutenue|risques? [eé]lev[eé]s?|[eé]l[eé]ments solides)\b/gis },
  { code: 'SPR_ABF_CERTAINTY', explanation: "Sans intersection explicite, un SPR ou un monument proche ne rend pas l'intervention de l'ABF certaine.", pattern: /(?:SPR|site patrimonial remarquable|monument historique).{0,140}(?:ABF|architecte des b[aâ]timents de France).{0,50}(?:certain|obligatoire|syst[eé]matique|quasi certain)/gis },
];

export function unsupportedInferencePolicy(): string {
  return [
    '# POLITIQUE PRIORITAIRE — INFÉRENCES ET QUALIFICATIFS',
    "Dans un rapport issu de get_etude_parcelle, si la question n'est pas explicitement financière, ne calcule aucun rendement, ratio, dispersion ou indicateur nouveau en combinant des données. Les synthèses d'investissement explicitement financières conservent leurs calculs prévus.",
    "Une pente ponctuelle, au centroïde ou même parcellaire ne permet jamais de qualifier le terrain de favorable ou facile à aménager, ni d'affirmer un coût ou une absence de coût de terrassement.",
    "Pour les argiles, ne présente jamais G1 ou G2 comme obligatoires de façon générale. Vérifie le champ d'application juridique, notamment selon le projet, la vente de terrain constructible, les maisons individuelles et les zones d'exposition définies ; fais déterminer la mission géotechnique adaptée.",
    "Distingue la taxe d'habitation sur les résidences secondaires et sa majoration éventuelle des régimes propres aux logements vacants. N'étends jamais la majoration THRS aux logements vacants sans champ explicite.",
    "N'écris pas « proximité immédiate » sans distance numérique sourcée. Ne qualifie pas une rue de structurante ou bruyante à partir de son nom.",
    "N'emploie pas « marché actif », « bien valorisé », « demande soutenue », « risques élevés » ou « éléments solides » sauf si une métrique source porte explicitement ce label.",
    "Sans intersection explicite avec un SPR, un périmètre de monument ou une servitude, l'intervention de l'ABF reste conditionnelle et à vérifier.",
  ].join('\n');
}

export function unsupportedInferenceProhibitions(): string[] {
  return [
    'Aucun calcul financier spontané dans un rapport parcellaire non financier.',
    'Aucun verdict de terrassement, de coût ou de facilité d’aménagement fondé sur la pente seule.',
    'Aucune obligation générale G1/G2 sans vérification du champ juridique et du projet.',
    'Aucune extension de la majoration THRS aux logements vacants sans champ explicite.',
    'Aucune proximité immédiate sans distance numérique sourcée.',
    'Aucune caractérisation d’une voie à partir de son nom.',
    'Aucun qualificatif décisionnel non porté par une métrique source.',
    'Aucune certitude SPR/ABF sans intersection explicite.',
  ];
}

export function detectUnsupportedInferences(text: string): UnsupportedInference[] {
  const findings: UnsupportedInference[] = [];
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    for (const match of text.matchAll(rule.pattern)) findings.push({ code: rule.code, explanation: rule.explanation, excerpt: match[0].replace(/\s+/g, ' ').trim().slice(0, 240) });
  }
  return findings;
}
