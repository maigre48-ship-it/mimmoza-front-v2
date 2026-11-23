// src/spaces/copilot/store/erreurLisible.ts
// Traduit une erreur technique du copilote en message affichable (logique PURE, testée par node --test).
//
// Le message brut du serveur remontait tel quel jusqu'au bandeau : l'utilisateur lisait « Anthropic API 529 :
// {"type":"error",...} » — incompréhensible. Les cas connus sont reformulés ; le détail reste dans la console.
// VIS-21 : une panne du FOURNISSEUR d'IA (crédit du compte Mimmoza épuisé, surcharge) est reconnue AVANT le cas
// « jetons » : « … purchase credits » ne doit plus jamais devenir « vous n'avez plus assez de jetons ».
import { messagePanneFournisseur } from '../../../../supabase/functions/_shared/copilot-stream/fournisseurIA.ts';

export function messageErreurLisible(brut: string | undefined | null): string {
  const e = (brut ?? '').toString();
  if (e) console.warn('[copilot] erreur technique :', e);
  if (!e) return "Une erreur est survenue. Réessayez dans un instant.";

  const fournisseur = messagePanneFournisseur(e);
  if (fournisseur) return fournisseur;

  const bas = e.toLowerCase();

  if (bas.includes('insufficient_credits') || bas.includes('solde insuffisant') || bas.includes('jetons insuffisants')) {
    return "Vous n'avez plus assez de jetons pour cette demande.";
  }
  if (bas.includes('timeout') || bas.includes('aborted')) {
    return "La réponse a mis trop de temps à arriver. Reformulez plus simplement, ou réessayez.";
  }
  if (bas.includes('401') || bas.includes('unauthorized') || bas.includes('jwt')) {
    return "Votre session a expiré. Reconnectez-vous puis relancez la demande.";
  }
  if (bas.includes('network') || bas.includes('failed to fetch')) {
    return "Connexion interrompue. Vérifiez votre réseau et réessayez.";
  }
  return "Une erreur est survenue. Réessayez dans un instant.";
}
