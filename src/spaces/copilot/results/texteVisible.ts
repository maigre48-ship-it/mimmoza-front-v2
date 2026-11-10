// src/spaces/copilot/results/texteVisible.ts
// =============================================================================
// LOT C3 — Cartes du chat : ce qui est écrit pour le MODÈLE ne s'affiche pas.
//
// Constat (essai témoin du 10/11/2026, Montreuil) : une carte « Règles du PLU »
// affichait « ne les invente sous aucun prétexte. Dis à l'utilisateur que… ».
// Les champs `message`, `note`, `note_repli`, `avertissement` des résultats
// d'outils sont rédigés par le serveur pour le modèle : ils mêlent un constat
// (utile à l'écran) et une consigne (qui ne doit jamais y paraître).
//
// `texteVisible` garde le constat et retire la consigne. Logique PURE, testée
// par texteVisible.test.ts (`node --test`). Elle ne réécrit rien : elle ne fait
// que retirer des phrases, des propositions ou des parenthèses entières.
// =============================================================================

/** Nom technique : identifiant avec tiret bas (get_parcel_plu, COPILOT_FN_GPU) ou paramètre d'outil. */
const NOM_TECHNIQUE = /\b[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+\b|\bconfirmer\s*:\s*true\b/;

/** La phrase parle DE l'utilisateur à la troisième personne : elle s'adresse au modèle. */
const PARLE_DE_L_UTILISATEUR = /\b(?:l['’]|d['’])?utilisateur\b/i;

/**
 * Verbes à l'impératif (2e personne du singulier) employés par le serveur pour diriger le modèle.
 * Un impératif n'est reconnu que suivi d'un pronom accolé (« Signale-le ») ou d'un déterminant, d'une
 * préposition ou d'un adverbe (« Demande l'adresse… », « Dis à… ») : « Demande locale non mesurée. »
 * est un constat, pas une consigne.
 */
const IMPERATIFS = [
  'signale', 'demande', 'invite', 'propose', 'présente', 'appelle', 'rappelle', 'précise', 'dis', 'explique', 'fais',
  'montre', 'pose', 'applique', 'cite', 'utilise', 'repasse', 'lis', 'écris', 'indique', 'vérifie', 'relance',
  'attends', 'reformule', 'résume', 'conclus', 'retiens',
];
const SUITE_IMPERATIF = "(?:-(?:le|la|les|lui|leur|toi|moi|en)(?![\\p{L}])|\\s+(?:l['’]|(?:le|la|les|un|une|des|du|à|au|aux|son|sa|ses|ce|cet|cette|ces|d['’]abord|uniquement|seulement|toujours|ensuite)(?![\\p{L}])))";
const DEBUT_IMPERATIF = new RegExp(`^(?:${IMPERATIFS.join('|')})${SUITE_IMPERATIF}`, 'iu');

/** Interdiction adressée au modèle : « ne les invente… », « N'invente… », « ne conclus SURTOUT PAS… ». */
const VERBES_INTERDITS = [
  'invente', 'conclus', 'prétends', 'annonce', 'complète', 'crée', 'lis', 'déduis', 'affirme', 'propose',
  'calcule', 'suppose', 'extrapole', 'répète', 'résume', 'recalcule', 'réponds',
];
const DEBUT_INTERDICTION = new RegExp(
  `^(?:ne\\s+|n['’]\\s*)(?:(?:le|la|les|l['’]|en|y|lui|leur)\\s*)?(?:${VERBES_INTERDITS.join('|')})(?![\\p{L}])`, 'iu');

/** Une proposition (phrase ou fin de phrase) est une consigne destinée au modèle. */
function estConsigne(proposition: string): boolean {
  const p = proposition.trim().replace(/^[«"“(\s⚠️-]+/u, '');
  return DEBUT_IMPERATIF.test(p) || DEBUT_INTERDICTION.test(p);
}

/** Phrases d'un texte : coupure après « . ! ? … » suivis d'une espace puis d'une majuscule, d'un guillemet ou d'un signe. */
function phrases(t: string): string[] {
  return t.split(/(?<=[.!?…])\s+(?=[\p{Lu}«"“⚠(])/u).map((s) => s.trim()).filter(Boolean);
}

/**
 * Texte d'un résultat d'outil → ce qui peut être montré dans une carte.
 * Retire : les parenthèses qui citent un nom technique, les phrases adressées au
 * modèle (impératif, interdiction, mention de « l'utilisateur », nom d'outil),
 * et la fin d'une phrase quand elle bascule en consigne après « : » ou « — ».
 * Rend `null` s'il ne reste rien : la carte n'affiche alors pas la ligne.
 */
export function texteVisible(valeur: unknown): string | null {
  if (typeof valeur !== 'string') return null;
  const brut = valeur.replace(/\s+/g, ' ').trim();
  if (!brut) return null;
  // « (COPILOT_FN_GPU non défini) », « (voir lecture_reglement_gpu) » : détail interne.
  const sansParentheses = brut.replace(/\s*\(([^()]*)\)/g, (tout, dedans: string) => NOM_TECHNIQUE.test(dedans) ? '' : tout);
  const gardees: string[] = [];
  for (const phrase of phrases(sansParentheses)) {
    if (estConsigne(phrase)) continue;
    // « … ne sont pas disponibles ici : ne les invente sous aucun prétexte. » → on garde le constat.
    let constat = phrase;
    const coupure = /\s+[:—–]\s+/gu;
    for (let m = coupure.exec(phrase); m; m = coupure.exec(phrase)) {
      if (estConsigne(phrase.slice(m.index + m[0].length))) { constat = phrase.slice(0, m.index).trimEnd(); break; }
    }
    if (PARLE_DE_L_UTILISATEUR.test(constat) || NOM_TECHNIQUE.test(constat)) continue;
    if (!constat) continue;
    // Phrase amputée de sa consigne : on la referme par un point. Une phrase intacte n'est pas retouchée.
    gardees.push(constat !== phrase && !/[.!?…]$/u.test(constat) ? `${constat}.` : constat);
  }
  return gardees.length ? gardees.join(' ') : null;
}
