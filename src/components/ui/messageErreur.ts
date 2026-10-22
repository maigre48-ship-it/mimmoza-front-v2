// src/components/ui/messageErreur.ts
// =============================================================================
// Transforme une erreur quelconque en message LISIBLE par un client.
//
// Les messages d'erreur bruts (réseau, API, Postgres, JavaScript) étaient
// affichés tels quels : « Failed to fetch », « HTTP 500 », « JWT expired »,
// « duplicate key value violates unique constraint… ». On garde le message
// d'origine uniquement s'il est déjà rédigé pour un humain, en français et
// sans jargon technique ; sinon on affiche le message de repli fourni par
// l'écran (qui dit CE QUI a échoué), éventuellement précisé par une cause
// connue (connexion, session expirée, délai dépassé).
//
// Le message brut reste disponible pour le diagnostic : l'appelant le journalise
// déjà en console dans la plupart des cas.
// =============================================================================

/** Motifs qui trahissent un message technique, à ne jamais montrer tel quel. */
const MOTIFS_TECHNIQUES: RegExp[] = [
  /\b(failed to fetch|networkerror|load failed|fetch failed|network request failed)\b/i,
  /\b(http|status|statut)\s*:?\s*\d{3}\b/i,
  /\b(typeerror|referenceerror|syntaxerror|rangeerror)\b/i,
  /\b(undefined|null|nan)\b/i,
  /\b(jwt|pgrst\d*|postgrest|supabase|edge function|functions?httperror|functionsrelayerror|functionsfetcherror|rpc)\b/i,
  /\b(json|unexpected token|cannot read|is not a function|is not defined)\b/i,
  /\b(violates|constraint|duplicate key|permission denied|row-level security|relation .* does not exist)\b/i,
  /\b(timeout|timed out|aborterror|the operation was aborted)\b/i,
  /\b[a-z]+_[a-z0-9_]+\b/, // snake_case : identifiants internes
  /[{}[\]<>]|=>|→/, // fragments de code ou de JSON
  /\b(error|failed|invalid|unable|could not|not found|unauthorized|forbidden|missing|request|response)\b/i,
];

function causeConnue(brut: string): string | null {
  if (/failed to fetch|networkerror|load failed|fetch failed|network request failed/i.test(brut)) {
    return "Le service n'a pas pu être joint. Vérifiez votre connexion internet puis réessayez.";
  }
  if (/jwt expired|session expir|not authenticated|unauthorized|\b401\b/i.test(brut)) {
    return "Votre session a expiré. Reconnectez-vous puis réessayez.";
  }
  if (/timeout|timed out|aborterror|the operation was aborted|\b504\b/i.test(brut)) {
    return "Le service a mis trop de temps à répondre. Réessayez dans un instant.";
  }
  return null;
}

/** Vrai si le texte peut être montré tel quel à un client. */
export function estMessageLisible(texte: string): boolean {
  const t = texte.trim();
  if (t.length < 4 || t.length > 300) return false;
  return !MOTIFS_TECHNIQUES.some((motif) => motif.test(t));
}

/**
 * Message à afficher pour `erreur`.
 * @param repli  phrase française qui dit ce qui a échoué (« Chargement impossible. »)
 */
export function messageErreur(erreur: unknown, repli: string): string {
  const brut =
    erreur instanceof Error
      ? erreur.message
      : typeof erreur === "string"
        ? erreur
        : erreur && typeof erreur === "object" && "message" in erreur && typeof (erreur as { message: unknown }).message === "string"
          ? (erreur as { message: string }).message
          : "";
  if (brut && estMessageLisible(brut)) return brut.trim();
  const cause = brut ? causeConnue(brut) : null;
  if (!cause) return repli;
  return `${repli.replace(/[.\s]+$/, "")}. ${cause}`;
}
