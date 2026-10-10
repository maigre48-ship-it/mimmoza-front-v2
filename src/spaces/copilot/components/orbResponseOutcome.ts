/** Retour visuel conservateur : rouge seulement si la conclusion commence par un refus clair. */
export function reponseClairementNegative(texte: string): boolean {
  const debut = texte
    .replace(/^\s*(?:[#>*-]+\s*)+/gm, '')
    .replace(/[*_`]/g, '')
    .trim()
    .slice(0, 420)
    .replace(/\s+/g, ' ')
    .replace(/^(?:conclusion|résultat|réponse)\s*:\s*/i, '');

  if (!debut) return false;
  if (/^non\s*[,.:;!]/i.test(debut)) return true;
  if (/^(?:impossible|refusé|refusée|défavorable)\b/i.test(debut)) return true;
  if (/^non\s+(?:constructible|éligible|rentable|conforme|autorisé|autorisée)\b/i.test(debut)) return true;

  const premierePhrase = debut.split(/[.!?](?:\s|$)/, 1)[0] ?? '';
  return /\b(?:n['’]est pas|ne sont pas|n['’]est plus|non)\s+(?:constructible|éligible|rentable|conforme|autorisé|autorisée|possible|faisable)\b/i.test(premierePhrase);
}

/** Le flux démarre avant les premiers mots : ce temps correspond à la réflexion. */
export function phaseReponseEnFlux(messages: readonly { role?: string; text?: string }[]): 'thinking' | 'responding' {
  const dernierAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
  return dernierAssistant?.text?.trim() ? 'responding' : 'thinking';
}