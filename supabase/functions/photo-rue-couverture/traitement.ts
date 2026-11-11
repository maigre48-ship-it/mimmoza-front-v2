// supabase/functions/photo-rue-couverture/traitement.ts
// =============================================================
// LOT P2 (11/11/2026) — « IMAGE DANS SA RUE » : couverture Panoramax d'une parcelle, en LECTURE SEULE.
//
// POST { contour: [[lon, lat], …] } → { ok: true, couverture: { couverte, photos: [{ id, date, distanceM }], verifieLe } }
//                                  ou { ok: false, raison }
// Photos de l'instance IGN de Panoramax sous Licence Ouverte 2.0 (`etalab-2.0`, filtre par photo) à 60 m au plus du
// contour. Pourquoi une fonction : l'appel direct depuis le navigateur dépend des en-têtes CORS de l'IGN, non vérifiés.
// Aucune écriture, aucune clé, aucune donnée de l'utilisateur transmise à l'IGN hormis l'emprise de la parcelle.
// Appel réservé aux utilisateurs connectés (vérification du JWT par la passerelle Supabase, réglage par défaut).
// Logique : src/lib/studio/couverturePhotoRue.ts (pure, partagée avec copilot-chat). Réseau injectable (tests).
// =============================================================

import { verifierCouverture } from '../../../src/lib/studio/couverturePhotoRue.ts';

const ENTETES = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};
/** Corps de requête accepté au plus (octets) : un contour de 400 sommets tient largement. */
export const CORPS_MAX = 32_000;

const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: ENTETES });

/** Traitement d'une requête ; `fetchFn` injectable (tests hors ligne). */
export async function traiter(req: Request, fetchFn: typeof fetch = fetch, maintenant: () => number = Date.now): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: ENTETES });
  if (req.method !== 'POST') return json({ ok: false, raison: 'Méthode non acceptée (POST attendu).' }, 405);
  const texte = await req.text();
  if (texte.length > CORPS_MAX) return json({ ok: false, raison: 'Requête trop volumineuse.' }, 413);
  let corps: unknown;
  try { corps = JSON.parse(texte); } catch { return json({ ok: false, raison: 'Requête illisible (JSON attendu).' }, 400); }
  const contour = typeof corps === 'object' && corps !== null && !Array.isArray(corps) ? (corps as Record<string, unknown>).contour : undefined;
  const r = await verifierCouverture(contour, fetchFn, maintenant);
  // Un échec de vérification n'est pas une erreur du client : réponse 200, `ok: false` et la raison (couverture « non vérifiée »).
  return json(r.ok ? { ok: true, couverture: r.couverture } : { ok: false, raison: r.raison });
}
