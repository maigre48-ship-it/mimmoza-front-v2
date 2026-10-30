// supabase/functions/rechercher-parcelles-v1/index.ts
// =============================================================================
// Mimmoza — rechercher-parcelles-v1 : parcelles candidates d'un secteur
// -----------------------------------------------------------------------------
// Appelée par copilot-chat (outil `rechercher_parcelles`, secret
// COPILOT_FN_PARCELLES=rechercher-parcelles-v1) avec la clé de service.
// ACCÈS : clé de service UNIQUEMENT (acces.ts) → 401 sinon, y compris pour un
// JWT utilisateur ou la clé anon. Contrôle fait dans le code : il ne dépend pas
// du réglage verify_jwt de la passerelle.
//
// ENTRÉE (POST JSON) — UN périmètre parmi :
//   { code_insee }                    commune entière (arrondissement pour Paris/Lyon/Marseille)
//   { commune, cp? }                  résolu via geo.api.gouv.fr
//   { bbox: [minLon,minLat,maxLon,maxLat] }   ≤ 9 km²
//   { centre: [lon,lat], rayon_m? }   rayon 50–2 000 m (défaut 500)
// + filtres facultatifs :
//   surface_min_m2, surface_max_m2, zonages: ['U','AU','A','N'] ou codes PLU ('UB','1AU'…),
//   exclure_bati: bool, limite: 1–50 (défaut 20)
//
// SORTIE (toujours HTTP 200) : { status: 'ok'|'no_data'|'error', summary, stats,
//   items: [{ idu, commune, code_insee, section, numero, surface_m2, surface_source,
//             zonage_plu, type_zone, libelle_zone, zonage_statut, centroide:[lon,lat],
//             compacite, bati_detecte, emprise_batie_m2, score_tri, raisons[] }],
//   avertissements[], sources[] }
//
// Toute la logique (sources, stratégie temps, tri) est documentée dans logique.ts.
// =============================================================================

import { rechercherParcelles, type Entree } from './logique.ts';
import { clesService, estCleService } from './acces.ts';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  // Garde d'accès : clé de service uniquement (clé anon ou JWT utilisateur refusés,
  // sinon n'importe qui épuiserait les quotas IGN).
  if (!estCleService(req.headers.get('Authorization'), clesService())) {
    return json({ status: 'error', summary: 'Accès réservé aux appels internes (clé de service).', stats: {}, items: [] }, 401);
  }
  if (req.method !== 'POST') return json({ status: 'error', summary: 'POST uniquement.', stats: {}, items: [] }, 405);

  let body: Entree;
  try { body = await req.json(); }
  catch { return json({ status: 'error', summary: 'Corps JSON invalide.', stats: {}, items: [] }); }

  try {
    const sortie = await rechercherParcelles(body, { fetch: globalThis.fetch.bind(globalThis) });
    console.log(`[rechercher-parcelles] ${sortie.status} — ${sortie.items.length} item(s) en ${(sortie.stats as any)?.duree_ms ?? '?'} ms`);
    return json(sortie);
  } catch (e) {
    console.error('[rechercher-parcelles] erreur', e instanceof Error ? e.message : String(e));
    return json({
      status: 'error',
      summary: "Erreur interne de la recherche de parcelles : aucune donnée n'est fiable, ne conclus rien.",
      stats: {}, items: [], avertissements: [], sources: [],
    });
  }
});
