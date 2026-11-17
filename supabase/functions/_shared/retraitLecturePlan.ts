// supabase/functions/_shared/retraitLecturePlan.ts
// =============================================================================
// LOT F5 (17/11/2026) — RETRAIT de la transcription de plans par gpt-4o (décision d'Albé).
//
// `analyze-rehab-plan` et `transcribe-rehab-plan` restent DÉPLOYÉES (un ancien onglet ou un appel direct reçoit une
// réponse claire) mais ne lisent plus rien : aucun appel au modèle, aucun jeton débité, aucune donnée conservée.
// La lecture de plan se fait dans le Studio (« Plans & dossier › Plan de l'existant › Importer un plan »), dans le
// navigateur, sans jeton : recalage sur l'emprise du bâtiment, statut de chaque valeur, questions sur l'incertain.
// =============================================================================

export const CODE_RETRAIT = 'REMPLACEE_PAR_STUDIO';
export const MESSAGE_RETRAIT =
  "Cette lecture de plan est retirée : elle est remplacée par la lecture de plan du Studio (Plans & dossier › Plan de l'existant › Importer un plan), gratuite et calculée sur votre ordinateur. Aucun jeton n'a été débité.";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Réponse unique des deux fonctions retirées : 410 Gone (OPTIONS : préliminaire CORS normal). Pure. */
export function reponseRetrait(req: Request): Response {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  return new Response(
    JSON.stringify({ success: false, error: { code: CODE_RETRAIT, message: MESSAGE_RETRAIT } }),
    { status: 410, headers: { ...CORS, 'Content-Type': 'application/json' } },
  );
}
