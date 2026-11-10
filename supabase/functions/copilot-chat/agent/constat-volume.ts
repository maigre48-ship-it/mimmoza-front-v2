// supabase/functions/copilot-chat/agent/constat-volume.ts
// =============================================================
// LOT C11 — le rapport d'une mission de conception ne conclut pas à la place des données.
//
// Constat (mission réelle du 10/11/2026, Montreuil, 30 logements demandés) : le volume d'étude plaçait 7 logements,
// et le rapport rédigé par le modèle concluait « La parcelle est probablement sous-dimensionnée pour ce programme ».
// Ce jugement n'est déductible d'aucune donnée : le volume d'étude dépend de ses hypothèses (reculs appliqués,
// emprise, hauteur d'étage), et ce jour-là c'est une hypothèse du moteur qui limitait le volume, pas la parcelle.
//
// Ce module (PUR, aucune I/O) :
//   1. garde du résultat de studio_preparer_3d un CONSTAT chiffré (lireConstatVolume) ;
//   2. en fait une phrase qui ne contient que des chiffres du moteur et leur cause connue (phraseConstat) ;
//   3. retire d'un texte les jugements sur la taille de la parcelle ou l'ambition du programme
//      (neutraliserJugements) ;
//   4. applique 2 et 3 au rapport d'une mission dont le programme n'est pas atteint (appliquerConstatAuRapport).
//
// Volontairement étroit : seules des tournures de JUGEMENT sont retirées (« sous-dimensionnée », « trop petite »,
// « programme trop ambitieux »…). Un constat (« 7 logements placés sur 30 ») n'est jamais touché.
// =============================================================

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const fini = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const court = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const fr = (v: number, d = 0) => v.toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: 0 });

/** Ce qui est gardé du volume d'étude préparé pendant la mission (chiffres du moteur, tels quels). */
export interface ConstatVolume {
  logements_vises: number | null;
  logements_places: number | null;
  programme_atteint: boolean | null;
  batiments: number | null;
  gabarit: string | null;
  emprise_batie_m2: number | null;
  emprise_pct: number | null;
  sdp_estimee_m2: number | null;
  /** Implantation retenue par le moteur (première hypothèse du volume : reculs par côté), si elle a été transmise. */
  implantation: string | null;
  /** Plafonds opposés au volume (emprise, hauteur, niveaux), tels que les contrôles les donnent. */
  plafonds: string[];
  /** Alertes du moteur (programme non atteint : cause chiffrée). */
  alertes: string[];
}

/**
 * Constat tiré du résultat de l'outil studio_preparer_3d (`data.volume`, résumé compact de la mission ou résumé
 * complet). null si le résultat n'en porte pas (échec de l'outil, forme inattendue) : rien n'est alors supposé.
 */
export function lireConstatVolume(volume: unknown): ConstatVolume | null {
  if (!estObj(volume)) return null;
  const places = fini(volume.logements_places) ? volume.logements_places : null;
  const emprise = fini(volume.emprise_batie_m2) ? volume.emprise_batie_m2 : null;
  if (places === null && emprise === null) return null;
  const textes = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v.flatMap((x) => { const s = court(x, max); return s ? [s] : []; }).slice(0, n) : []);
  return {
    logements_vises: fini(volume.logements_vises) ? volume.logements_vises : null,
    logements_places: places,
    programme_atteint: typeof volume.programme_atteint === 'boolean' ? volume.programme_atteint : null,
    batiments: fini(volume.batiments) ? volume.batiments : null,
    gabarit: court(volume.gabarit, 12),
    emprise_batie_m2: emprise,
    emprise_pct: fini(volume.emprise_pct) ? volume.emprise_pct : null,
    sdp_estimee_m2: fini(volume.sdp_estimee_m2) ? volume.sdp_estimee_m2 : null,
    implantation: court(volume.implantation, 700) ?? (Array.isArray(volume.hypotheses) ? court(volume.hypotheses[0], 700) : null),
    plafonds: textes(volume.plafonds, 4, 260),
    alertes: textes(volume.alertes, 3, 300),
  };
}

/**
 * Le constat, en une phrase : ce qui est demandé, ce que le moteur a placé, sous quels plafonds et avec quelle
 * implantation. Aucun qualificatif. null si le programme est atteint ou si rien n'est chiffré.
 */
export function phraseConstat(c: ConstatVolume | null): string | null {
  if (!c || c.programme_atteint !== false || c.logements_places === null) return null;
  const pl = (n: number, mot: string) => `${fr(n)} ${mot}${n > 1 ? 's' : ''}`;
  const volume = [
    c.batiments !== null ? pl(c.batiments, 'bâtiment') : null,
    c.gabarit,
    c.emprise_batie_m2 !== null ? `${fr(c.emprise_batie_m2)} m² d’emprise${c.emprise_pct !== null ? ` (${fr(c.emprise_pct, 1)} % de la parcelle)` : ''}` : null,
    c.sdp_estimee_m2 !== null ? `${fr(c.sdp_estimee_m2)} m² de SDP estimée` : null,
  ].filter(Boolean).join(', ');
  const sansPoint = (s: string) => s.replace(/[.\s]+$/u, '');
  return `Volume d’étude : ${c.logements_vises !== null ? `${pl(c.logements_vises, 'logement')} demandé${c.logements_vises > 1 ? 's' : ''}, ` : ''}` +
    `${pl(c.logements_places, 'logement')} placé${c.logements_places > 1 ? 's' : ''} par le moteur${volume ? ` (${volume})` : ''}.` +
    (c.plafonds.length ? ` Plafonds opposés au volume : ${c.plafonds.map(sansPoint).join(' ; ')}.` : '') +
    (c.implantation ? ` Implantation retenue par le moteur : ${sansPoint(c.implantation)}.` : '') +
    (c.alertes.length ? ` Cause donnée par le moteur : ${c.alertes.map(sansPoint).join(' ; ')}.` : '') +
    ' Ces chiffres sont ceux du volume d’étude avec ses hypothèses (reculs, emprise, 3 m par étage, 70 m² de SDP par logement) : ils ne mesurent pas la capacité de la parcelle.';
}

/** Tournures de jugement sur la parcelle ou sur le programme (texte sans accents, en minuscules). */
const JUGEMENTS: RegExp[] = [
  /\b(?:parcelle|terrain|foncier|unite fonciere|site)\b[^.!?]*\b(?:sous[- ]?dimensionne|trop (?:petit|etroit|exigu|juste|contraint|faible)|insuffisant|inadapte|inadequat|pas adapte|ne (?:permet|suffit|convient)(?:tra|trait)? pas)/u,
  /\b(?:sous[- ]?dimensionne|trop (?:petit|etroit|exigu))e?s?\b[^.!?]*\b(?:pour|au regard|par rapport)\b[^.!?]*\b(?:programme|projet|logements?)\b/u,
  /\b(?:programme|projet|objectif)\b[^.!?]*\b(?:trop ambitieux|irrealiste|irrealisable|sur[- ]?dimensionne|hors de portee|inatteignable|incompatible avec (?:la |cette )?(?:parcelle|taille|surface)|demesure)/u,
  /\b(?:surface|taille|superficie)\b[^.!?]*\b(?:parcelle|terrain)\b[^.!?]*\b(?:insuffisante?|trop (?:faible|petite|juste))\b/u,
  /\bil faudrait (?:une|un) (?:parcelle|terrain)\b[^.!?]*\bplus (?:grande?|vaste)\b/u,
];
const sansAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’`]/g, "'");

/** La phrase porte-t-elle un jugement sur la taille de la parcelle ou l'ambition du programme ? */
export function estJugement(phrase: string): boolean {
  const p = sansAccents(phrase);
  return JUGEMENTS.some((re) => re.test(p));
}

/**
 * Retire d'un texte les PHRASES qui jugent la parcelle ou le programme. Le reste est rendu tel quel (espaces
 * resserrés). `retires` : les phrases retirées, pour le journal et les tests. Une phrase qui mêle un constat et un
 * jugement est retirée en entier : le constat chiffré est redonné à part (phraseConstat), tiré des données.
 */
export function neutraliserJugements(texte: string): { texte: string; retires: string[] } {
  if (typeof texte !== 'string' || !texte.trim()) return { texte: typeof texte === 'string' ? texte : '', retires: [] };
  // Découpe en phrases : fin de phrase suivie d'une espace et d'une majuscule, d'un guillemet ou d'un tiret ; sauts de ligne gardés.
  const morceaux = texte.split(/(?<=[.!?…])(?=\s+(?:[A-ZÀ-ÖØ-Þ«"“\-–—•*]|\d))|(?=\n)/u);
  const retires: string[] = [];
  const gardes = morceaux.filter((m) => { if (estJugement(m)) { retires.push(m.trim()); return false; } return true; });
  if (!retires.length) return { texte, retires };
  return { texte: gardes.join('').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim(), retires };
}

/**
 * Applique le constat au rapport d'une mission de conception dont le programme N'EST PAS atteint par le volume
 * d'étude : jugements retirés de la synthèse et des limites, constat chiffré ajouté aux limites (une seule fois).
 * Programme atteint, ou aucun volume préparé : le rapport n'est pas touché. Rend les phrases retirées.
 */
export function appliquerConstatAuRapport(rapport: Obj, constat: ConstatVolume | null): string[] {
  const phrase = phraseConstat(constat);
  if (!phrase) return [];
  const retires: string[] = [];
  if (typeof rapport.synthese === 'string') {
    const n = neutraliserJugements(rapport.synthese);
    retires.push(...n.retires);
    // Une synthèse réduite à rien par le retrait reçoit le constat : elle ne reste jamais vide.
    rapport.synthese = n.texte || phrase;
  }
  const limites = Array.isArray(rapport.limites) ? rapport.limites.filter((x): x is string => typeof x === 'string') : [];
  const propres: string[] = [];
  for (const l of limites) {
    const n = neutraliserJugements(l);
    retires.push(...n.retires);
    if (n.texte.trim()) propres.push(n.texte);
  }
  if (!propres.includes(phrase)) propres.push(phrase);
  rapport.limites = propres;
  return retires;
}

/** Consigne courte jointe au résultat de l'outil quand le programme n'est pas atteint (lue par le modèle avant de rédiger). */
export const CONSIGNE_PROGRAMME_NON_ATTEINT =
  'Programme NON atteint par ce volume d’étude. Dans le rapport, donne seulement le constat chiffré (logements demandés, logements placés, emprise, niveaux, ' +
  'plafonds, implantation retenue) et la cause donnée par le moteur. N’écris AUCUN jugement sur la parcelle ou le programme (« sous-dimensionnée », « trop petite », ' +
  '« trop ambitieux »…) : ce volume dépend des hypothèses du moteur (reculs, emprise), il ne mesure pas la capacité de la parcelle.';
