// supabase/functions/copilot-chat/agent/garde-calcul.ts
// =============================================================
// Lot C4 « le modèle ne calcule pas » (essai témoin du 10/11/2026, Montreuil).
//
// Constat : dans le chat, le modèle a écrit « 563 × 5 × 0,85 = 2 390 m² SDP », puis « ~5,0 M€ HT »,
// à partir d'une emprise mal lue, d'une hauteur supposée et d'un coefficient sans origine. Aucun moteur
// n'avait été appelé. Règle du produit : le LLM ne fait PAS les calculs.
//
// Ce module est PUR. Il fournit :
//   · CONSIGNE_PAS_DE_CALCUL : la règle ajoutée au prompt système ;
//   · expressionsCalculees   : repère, dans un texte, les opérations posées par écrit ;
//   · calculParMoteur        : vrai si un outil de calcul a tourné dans ce tour ;
//   · avisCalculNonMoteur    : l'avis affiché sous la réponse quand un calcul n'a pas de moteur.
// La garde ne réécrit jamais la réponse : elle la signale.
// =============================================================

export const CONSIGNE_PAS_DE_CALCUL =
  "4sexvicies-bis. SURFACES, CAPACITÉ ET RATIOS — Tu ne poses AUCUNE opération toi-même : ni surface de plancher " +
  "(emprise × niveaux × coefficient), ni emprise ou pleine terre en m² tirée d'un pourcentage, ni coût total " +
  "(€/m² × surface), ni ratio ou division entre deux chiffres. Une valeur calculée n'existe que si un outil l'a " +
  "renvoyée (volume du Studio, bilan, charge foncière). Sans outil : donne les règles et les données telles " +
  "qu'elles sont lues, dis que la capacité ou le montant n'est pas calculé, et propose l'outil ou la mission qui le " +
  "calcule. Jamais de coefficient (0,85, 0,9…) qui ne vient ni d'un outil ni de l'utilisateur.";

/** Outils dont le résultat EST un calcul de moteur : leur présence dans le tour lève la garde. */
const RE_OUTIL_CALCUL = /^(?:calculer_|studio_preparer_3d$|get_bilan_promoteur$)/;

export function calculParMoteur(outilsAppeles: ReadonlyArray<{ name: string }>): boolean {
  return outilsAppeles.some((o) => RE_OUTIL_CALCUL.test(o.name));
}

// Un nombre (« 563 », « 2 390 », « 0,85 », « 1.5 ») éventuellement suivi d'une unité courte.
const NOMBRE = String.raw`\d(?:[\d   .,]*\d)?`;
const UNITE = String.raw`(?:\s?(?:m²|m2|m|%|€|k€|M€|€\/m²|niveaux?|logements?|lgts?|places?))?`;
// Opérateur de multiplication : « × » partout ; « x » et « * » seulement entre espaces (« 12 x 18 »).
const FOIS = String.raw`(?:\s?×\s?|\s[x*]\s)`;
const OPERANDE = `${NOMBRE}${UNITE}`;
// (a) au moins DEUX multiplications enchaînées : « 563 × 5 × 0,85 » ;
// (b) UNE multiplication suivie, sur la même ligne, d'un résultat : « 804 m² × 70 % = 563 m² ».
const RE_CHAINE = new RegExp(`${OPERANDE}${FOIS}${OPERANDE}(?:${FOIS}${OPERANDE})+`, 'g');
const RE_EGAL = new RegExp(`${OPERANDE}${FOIS}${OPERANDE}[^\\n=|]{0,30}(?:=|≈|→|soit)\\s*~?\\s*${NOMBRE}`, 'g');

/**
 * Opérations posées par écrit dans `texte` (une par occurrence, dans l'ordre, sans doublon, 5 au plus).
 * Ne relève PAS : une dimension (« 12 × 18 m »), un multiplicateur seul (« × 2 »), une date, une division.
 */
export function expressionsCalculees(texte: string): string[] {
  const propre = (texte ?? '').replace(/\*\*|__|`/g, '');
  const vues = new Set<string>();
  for (const ligne of propre.split('\n')) {
    for (const re of [RE_CHAINE, RE_EGAL]) {
      re.lastIndex = 0;
      for (const m of ligne.matchAll(re)) {
        const e = m[0].replace(/\s+/g, ' ').trim();
        // Une expression déjà couverte par une plus longue (chaîne ⊂ égalité) n'est pas répétée.
        if (![...vues].some((v) => v.includes(e) || e.includes(v))) vues.add(e);
        else if ([...vues].some((v) => e.includes(v) && e !== v)) {
          for (const v of [...vues]) if (e.includes(v) && e !== v) vues.delete(v);
          vues.add(e);
        }
        if (vues.size >= 5) return [...vues];
      }
    }
  }
  return [...vues];
}

export function avisCalculNonMoteur(expressions: readonly string[]): string {
  const cite = expressions.slice(0, 2).map((e) => `« ${e} »`).join(', ');
  return "\n\n_[Contrôle Mimmoza : cette réponse contient un calcul posé par l'assistant " +
    `(${cite}) qui ne sort d'aucun moteur de calcul. Ne l'utilisez pas tel quel : demandez le volume ou le bilan, ` +
    'qui sont calculés par les moteurs à partir de règles confirmées.]_';
}
