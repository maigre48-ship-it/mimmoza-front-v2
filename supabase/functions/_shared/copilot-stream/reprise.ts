// supabase/functions/_shared/copilot-stream/reprise.ts
// =============================================================================
// Reprise d'une réponse de Mimmo coupée en cours de route — logique PURE.
//
// Partagé entre l'Edge Function copilot-chat (Deno) et le front (Vite + node
// --test) : aucun import, aucune API Deno ni DOM. Toute règle qui décide si un
// texte est complet, comment on raccorde une suite, ou comment on regroupe les
// erreurs vit ici, une seule fois.
// =============================================================================

/**
 * Préfixe d'un message utilisateur SYNTHÉTIQUE qui demande la suite d'une
 * réponse coupée. Il est persisté en base comme n'importe quel message ; le
 * front le reconnaît pour ne pas l'afficher et pour recoller la suite à la
 * réponse qu'elle prolonge.
 */
export const MARQUEUR_SUITE = '[[mimmo:suite]]';

/** Consigne envoyée au modèle pour obtenir la suite exacte. */
export function messageDeSuite(): string {
  return `${MARQUEUR_SUITE} Ta réponse précédente a été coupée avant la fin. ` +
    "Poursuis-la EXACTEMENT là où elle s'arrête : ne répète rien, ne la résume pas, " +
    "n'ajoute ni introduction ni excuse, ne rappelle aucun outil déjà appelé. " +
    "Si elle s'arrête au milieu d'un mot, réécris ce mot en entier. " +
    'Termine ensuite la réponse normalement.';
}

export function estDemandeDeSuite(message: string | null | undefined): boolean {
  return typeof message === 'string' && message.trimStart().startsWith(MARQUEUR_SUITE);
}

// Marqueurs posés par le serveur (réponse interrompue persistée) ou par
// d'anciennes versions du front (« _(interrompu)_ »).
const MARQUEURS_FIN: RegExp[] = [
  /\s*_\[Réponse interrompue avant la fin[^\]]*\]_\s*$/u,
  /\s*_\(interrompu\)_\s*$/u,
  /\s*\[réponse interrompue\]\s*$/u,
];

/** Retire le marqueur d'interruption final, s'il y en a un. */
export function retirerMarqueursInterruption(texte: string): string {
  let t = texte;
  for (const re of MARQUEURS_FIN) t = t.replace(re, '');
  return t;
}

export function porteMarqueurInterruption(texte: string): boolean {
  return MARQUEURS_FIN.some((re) => re.test(texte));
}

/**
 * Raccorde la suite au texte partiel.
 *
 * - si la suite recommence par la fin du partiel (≥ 12 caractères), le
 *   chevauchement est retiré ;
 * - si le partiel s'arrête au milieu d'un mot que la suite réécrit en entier
 *   (« immédia » + « immédiatement »), le fragment est remplacé ;
 * - sinon on insère au plus une espace, jamais au milieu d'une ponctuation ou
 *   d'un saut de ligne.
 */
export function raccorderSuite(partiel: string, suite: string): string {
  const base = retirerMarqueursInterruption(partiel);
  if (!suite) return base;
  if (!base) return suite.replace(/^\s+/, '');

  const suiteNette = suite.replace(/^[ \t]+/, '');

  // 1. Chevauchement littéral (le modèle a repris quelques mots).
  const max = Math.min(400, base.length, suiteNette.length);
  for (let k = max; k >= 12; k--) {
    if (base.endsWith(suiteNette.slice(0, k))) return base + suiteNette.slice(k);
  }

  // 2. Mot coupé.
  const dernierMot = /([\p{L}\p{N}'’-]+)$/u.exec(base)?.[1] ?? '';
  const premierMot = /^([\p{L}\p{N}'’-]+)/u.exec(suiteNette)?.[1] ?? '';
  if (dernierMot && premierMot && premierMot.length > dernierMot.length
      && premierMot.toLowerCase().startsWith(dernierMot.toLowerCase())) {
    return base.slice(0, base.length - dernierMot.length) + suiteNette;
  }

  // 3. Jointure simple.
  if (/\s$/.test(base) || /^\s/.test(suite) || /^[,.;:!?)\]»%]/.test(suiteNette)) {
    return base + (/^\s/.test(suite) && /\s$/.test(base) ? suite.replace(/^\s+/, '') : suite);
  }
  if (/^(#{1,6}\s|[-*+]\s|\d+[.)]\s|\|)/.test(suiteNette)) return base + '\n\n' + suiteNette;
  return base + ' ' + suiteNette;
}

/** Forme minimale d'un message d'historique, côté front comme côté serveur. */
export interface MessageHistorique {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

/**
 * Regroupe, pour l'AFFICHAGE, chaque « demande de suite » et sa réponse avec la
 * réponse qu'elles prolongent. Les messages en base restent séparés (c'est ce
 * qui garde la facturation et les outils traçables) ; seul l'écran les fusionne.
 *
 * Le message fusionné garde l'identifiant du DERNIER morceau : c'est lui qui
 * porte la fin de la réponse, donc son statut.
 */
export function fusionnerSuites<T extends MessageHistorique>(
  messages: T[],
  fusion: (precedent: T, suite: T, texte: string) => T = (p, s, texte) => ({ ...s, text: texte }),
): T[] {
  const out: T[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === 'user' && estDemandeDeSuite(m.text)) {
      const precedent = out.at(-1);
      const reponse = messages[i + 1];
      if (precedent?.role === 'assistant' && reponse?.role === 'assistant') {
        out[out.length - 1] = fusion(precedent, reponse, raccorderSuite(precedent.text, reponse.text));
        i++;
      }
      // Demande de suite orpheline (la suite a échoué) : simplement masquée.
      continue;
    }
    out.push(m);
  }
  return out;
}

// -----------------------------------------------------------------------------
// Empreinte d'erreur (suivi des erreurs) — partagée front / Edge.
// -----------------------------------------------------------------------------

/**
 * Normalise un message d'erreur pour que deux occurrences « identiques » aient
 * la même empreinte : identifiants, nombres, URLs et chaînes entre guillemets
 * sont remplacés par des jokers.
 */
export function normaliserMessageErreur(message: string): string {
  return message
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\b[0-9a-f]{16,}\b/gi, '<hex>')
    .replace(/\d+/g, '<n>')
    .replace(/(["'`])(?:(?!\1).){1,80}\1/g, '<str>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/** FNV-1a 32 bits, en hexadécimal. Synchrone, identique dans les deux mondes. */
export function hacherFnv1a(texte: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Empreinte d'une erreur : source + message normalisé + premier cadre de pile
 * utile (sans numéro de ligne ni hash de fichier, qui changent à chaque build).
 */
export function empreinteErreur(source: string, message: string, stack?: string | null): string {
  const cadre = (stack ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('at ') || l.includes('@')) ?? '';
  const cadreNormalise = cadre
    .replace(/https?:\/\/[^/\s]+/g, '')
    .replace(/[-.][0-9a-zA-Z_-]{8,}\.js/g, '.js')
    .replace(/:\d+(:\d+)?/g, '');
  return hacherFnv1a(`${source}|${normaliserMessageErreur(message)}|${cadreNormalise}`);
}
