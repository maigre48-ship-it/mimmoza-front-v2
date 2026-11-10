// supabase/functions/copilot-chat/agent/adresse-precision.ts
// =============================================================
// Lot C4 (essai témoin du 10/11/2026) : « 100 rue de Paris, Montreuil » n'existe pas dans la Base Adresse
// Nationale, qui ne rend alors que la VOIE. L'étude se poursuivait au point milieu de la rue (à ~250 m du
// numéro voisin existant), pour 56 jetons. Désormais : numéro demandé + précision « street » = on s'arrête
// et on demande l'adresse exacte ou la référence cadastrale. Module PUR.
// =============================================================

/** Numéro de voirie en tête d'adresse (« 100 », « 12 bis », « 3B ») ; null s'il n'y en a pas. */
export function numeroDemande(adresse: string): string | null {
  const m = /^\s*(\d{1,4})\s?(bis|ter|quater|[a-d])?(?=[\s,])/i.exec(adresse ?? '');
  if (!m) return null;
  return m[2] ? `${m[1]} ${m[2].toLowerCase()}` : m[1];
}

/** Vrai si l'utilisateur a donné un numéro et que la BAN n'a reconnu que la voie. */
export function numeroNonReconnu(adresse: string, precisionBan: string): boolean {
  return precisionBan === 'street' && numeroDemande(adresse) != null;
}

export function messageNumeroNonReconnu(adresse: string, libelleVoie: string): string {
  return `Le numéro ${numeroDemande(adresse)} n'est pas connu de la Base Adresse Nationale : seule la voie a été ` +
    `localisée (${libelleVoie}). Aucune parcelle ne peut être désignée, et le point retenu est le milieu de la voie, ` +
    'pas le terrain : ni zonage, ni règles, ni risques ne peuvent être étudiés à partir de ce point. ' +
    'Il faut le numéro exact ou la référence cadastrale de la parcelle.';
}
