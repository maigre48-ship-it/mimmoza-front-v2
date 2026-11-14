import { reparerEncodageProfond } from '../_shared/texte/reparerEncodage.ts';
import { rechercherMonuments, type MerimeeInput } from './logique.ts';

// supabase/functions/patrimoine-merimee-v1/index.ts
// =============================================================
// Patrimoine Mérimée v1 — Monuments Historiques (abords 500 m)
// Source (LOT P11, 14/11/2026) : jeu « Immeubles protégés au titre des
//   Monuments Historiques » (Ministère de la Culture) sur data.gouv.fr,
//   Licence Ouverte 2.0, interrogé par l'API tabulaire data.gouv.fr.
//   L'ancienne source (Opendatasoft data.culture.gouv.fr) redirige vers une
//   page HTML depuis la migration du portail : voir logique.ts.
//
// ENTRÉE (body JSON) : { lat, lon, radius_m?, code_insee? }
//   → recherche géographique par rayon (bande de latitude + distance réelle) ;
//   → repli code_insee (commune entière) si pas de coordonnées.
//
// SORTIE (contrat inchangé) : { status, summary, stats, items }
//   status : 'ok' | 'no_data' | 'no_localization' | 'error'  (HTTP 200)
//   stats.dans_perimetre_abf_500m conservé ; en cas de panne de la source :
//   status 'error', erreur 'source_indisponible', jamais « aucun monument ».
//
// ⚠️ Un monument CLASSÉ ou INSCRIT génère un périmètre de protection de 500 m
//    (abords). Tout projet dans ce périmètre passe en avis ABF. On le signale.
//    On n'invente jamais : si aucun MH dans le rayon, on le dit clairement.
// ⚠️ Importe `_shared/texte/reparerEncodage.ts` : déployer par la CLI.
// =============================================================

function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (req.method !== 'POST') {
    return json({ status: 'error', summary: 'POST only' }, 405);
  }

  let input: MerimeeInput;
  try {
    input = (await req.json()) as MerimeeInput;
  } catch {
    return json({ status: 'error', summary: 'Body JSON invalide.' }, 400);
  }

  try {
    // La base Mérimée est notoirement affectée par le double encodage sur les
    // noms d'édifices — on répare à la frontière, ligne par ligne.
    const sortie = await rechercherMonuments(input ?? {}, fetch, { reparer: reparerEncodageProfond });
    if (sortie.status === 'error') console.error('[merimee]', sortie.summary);
    return json(sortie, 200);
  } catch (e) {
    return json({
      status: 'error',
      summary: `Erreur interrogation Mérimée : ${e instanceof Error ? e.message : String(e)}`,
      stats: null,
      items: [],
    }, 200);
  }
});
