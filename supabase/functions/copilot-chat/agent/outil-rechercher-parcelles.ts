// supabase/functions/copilot-chat/agent/outil-rechercher-parcelles.ts
// =============================================================================
// Outil chat / mission `rechercher_parcelles` — prospection foncière
// -----------------------------------------------------------------------------
// Module autonome (aucun import de index.ts → pas d'import circulaire). Le
// MOTEUR l'intègre ainsi dans copilot-chat/index.ts :
//
//   import { TOOL_RECHERCHER_PARCELLES, executerRechercherParcelles } from './agent/outil-rechercher-parcelles.ts';
//   // INTERNAL_FUNCTIONS :
//   parcelles: Deno.env.get('COPILOT_FN_PARCELLES') ?? null,       // rechercher-parcelles-v1
//   // TOOLS :
//   TOOL_RECHERCHER_PARCELLES,
//   // executeTool :
//   case 'rechercher_parcelles':
//     return await executerRechercherParcelles(input, ctx, callInternalFunction, INTERNAL_FUNCTIONS.parcelles);
//
// Les types ci-dessous sont des copies STRUCTURELLES de ToolDef / ToolResult /
// MimmozaContext (index.ts) : TypeScript les accepte tels quels.
// =============================================================================

export type ModeOutil = 'quick' | 'advanced' | 'report';
export type StatutOutil = 'ok' | 'confirmation_requise' | 'not_configured' | 'not_found' | 'partial' | 'error';

export interface ToolDefParcelles {
  name: string;
  description: string;
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  available_in_modes: ModeOutil[];
}

export interface ResultatOutil {
  status: StatutOutil;
  source: string;
  data?: Record<string, unknown>;
  message?: string;
}

/** Sous-ensemble du MimmozaContext réellement lu ici. */
export interface CtxParcelles {
  parcel?: { commune?: string; code_postal?: string; code_insee?: string } | null;
}

export type AppelFonctionInterne = (fnName: string, body: unknown) => Promise<unknown>;

export const NOM_OUTIL_PARCELLES = 'rechercher_parcelles';

export const TOOL_RECHERCHER_PARCELLES: ToolDefParcelles = {
  name: NOM_OUTIL_PARCELLES,
  description:
    "TROUVER DES TERRAINS : repère les PARCELLES CANDIDATES d'une commune ou d'un secteur pour une prospection " +
    "foncière (« trouve-moi des terrains de 1 000 à 3 000 m² en zone U à X », « quelles parcelles constructibles " +
    "autour de ce point ? »). Lit le cadastre (Etalab / API Carto IGN), filtre par SURFACE, lit le zonage PLU publié " +
    "au Géoportail de l'urbanisme au centroïde de chaque parcelle, et peut écarter les parcelles déjà bâties " +
    "(BD TOPO IGN). Renvoie une liste triée (score_tri /100 : zonage 40, surface 30, forme compacte 30) avec IDU, " +
    "surface, zone, bâti et raisons. UN périmètre : code_insee, OU commune (+ cp), OU bbox, OU centre + rayon_m. " +
    "Utilise ENSUITE get_etude_parcelle / get_parcel_plu sur les 3-5 meilleures : cet outil ne donne qu'une " +
    "constructibilité de PRINCIPE. ⚠️ zonage_plu = null quand le GPU ne couvre pas le secteur ou que la parcelle " +
    "n'a pas été vérifiée (zonage_statut) : ne l'invente jamais. bati_detecte = null = non vérifié. Si la lecture " +
    "du cadastre est partielle (stats.couverture_cadastre), dis-le. Cite [source: Cadastre Etalab / API Carto IGN, " +
    "Géoportail de l'urbanisme, BD TOPO].",
  input_schema: {
    type: 'object',
    properties: {
      code_insee: { type: 'string', description: "Code INSEE de la commune (5 caractères). Paris/Lyon/Marseille : code de l'ARRONDISSEMENT." },
      commune: { type: 'string', description: 'Nom de la commune (si pas de code INSEE).' },
      cp: { type: 'string', description: 'Code postal pour lever une ambiguïté de nom de commune.' },
      bbox: { type: 'array', items: { type: 'number' }, description: 'Rectangle [minLon, minLat, maxLon, maxLat] en WGS84, 9 km² au plus.' },
      centre: { type: 'array', items: { type: 'number' }, description: 'Centre [lon, lat] en WGS84 (avec rayon_m).' },
      rayon_m: { type: 'number', description: 'Rayon autour du centre, 50 à 2 000 m (défaut 500).' },
      surface_min_m2: { type: 'number', description: 'Surface cadastrale minimale (m²).' },
      surface_max_m2: { type: 'number', description: 'Surface cadastrale maximale (m²).' },
      zonages: {
        type: 'array', items: { type: 'string' },
        description: "Zonages acceptés : types 'U', 'AU', 'A', 'N' ou codes PLU ('UB', '1AU'… comparés en préfixe). " +
          "Avec ce filtre, une parcelle dont la zone n'a pas pu être lue est ÉCARTÉE (et comptée).",
      },
      exclure_bati: { type: 'boolean', description: 'Écarter les parcelles portant au moins un bâtiment BD TOPO (hors constructions légères).' },
      limite: { type: 'number', description: 'Nombre de parcelles renvoyées (1 à 50, défaut 20).' },
    },
  },
  available_in_modes: ['quick', 'advanced', 'report'],
};

// ─── Construction du corps envoyé à rechercher-parcelles-v1 ──────────────────
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}
function nombre(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}
function tableauNombres(v: unknown, n: number): number[] | undefined {
  if (!Array.isArray(v) || v.length !== n) return undefined;
  const t = v.map(nombre);
  return t.every((x) => x !== undefined) ? (t as number[]) : undefined;
}

export function construireCorps(input: Record<string, unknown>, ctx: CtxParcelles | null | undefined):
  { corps: Record<string, unknown>; perimetre_deduit_du_contexte: boolean } | null {
  const corps: Record<string, unknown> = {};
  const insee = str(input.code_insee);
  const commune = str(input.commune);
  const bbox = tableauNombres(input.bbox, 4);
  const centre = tableauNombres(input.centre, 2);
  let deduit = false;

  if (insee) corps.code_insee = insee;
  else if (commune) { corps.commune = commune; const cp = str(input.cp) ?? str(input.code_postal); if (cp) corps.cp = cp; }
  else if (bbox) corps.bbox = bbox;
  else if (centre) { corps.centre = centre; const r = nombre(input.rayon_m); if (r !== undefined) corps.rayon_m = r; }
  else {
    // Repli : commune de la parcelle ouverte. Le nom (+ CP) est préféré au code
    // INSEE du contexte, qui n'est qu'une hypothèse : la fonction le confronte
    // au référentiel geo.api.gouv.fr.
    const p = ctx?.parcel;
    if (p?.commune) { corps.commune = p.commune; if (p.code_postal) corps.cp = p.code_postal; deduit = true; }
    else if (p?.code_insee) { corps.code_insee = p.code_insee; deduit = true; }
    else return null;
  }

  const sMin = nombre(input.surface_min_m2), sMax = nombre(input.surface_max_m2), lim = nombre(input.limite);
  if (sMin !== undefined) corps.surface_min_m2 = sMin;
  if (sMax !== undefined) corps.surface_max_m2 = sMax;
  if (lim !== undefined) corps.limite = lim;
  if (Array.isArray(input.zonages)) {
    const z = input.zonages.map((x) => String(x).trim()).filter(Boolean);
    if (z.length) corps.zonages = z;
  } else if (typeof input.zonages === 'string' && input.zonages.trim()) {
    corps.zonages = input.zonages.split(/[,;\s]+/).filter(Boolean);
  }
  if (input.exclure_bati === true || input.exclure_bati === 'true') corps.exclure_bati = true;
  return { corps, perimetre_deduit_du_contexte: deduit };
}

// ─── Résumé compact pour le LLM ──────────────────────────────────────────────
const MAX_ITEMS_LLM = 15;

export function resumerRechercheParcelles(raw: unknown): { status: StatutOutil; data?: Record<string, unknown>; message?: string } {
  const r = raw as Record<string, any>;
  if (!r || typeof r !== 'object' || typeof r.status !== 'string') {
    return { status: 'error', message: 'Réponse de rechercher-parcelles illisible : aucune parcelle fiable.' };
  }
  if (r.status === 'error') {
    return { status: 'error', message: String(r.summary ?? 'Erreur de la recherche de parcelles.'), data: r.stats && Object.keys(r.stats).length ? { stats: r.stats } : undefined };
  }
  const items: any[] = Array.isArray(r.items) ? r.items : [];
  const st = r.stats ?? {};
  const data: Record<string, unknown> = {
    empty: items.length === 0,
    resume: r.summary ?? null,
    perimetre: st.perimetre ?? null,
    comptage: {
      parcelles_lues: st.parcelles_lues ?? null,
      couverture_cadastre: st.couverture_cadastre ?? null,
      apres_filtre_surface: st.apres_filtre_surface ?? null,
      apres_filtre_zonage: st.apres_filtre_zonage ?? null,
      retenues: st.retenues ?? items.length,
      zonage: st.zonage ? { methode: st.zonage.methode, lues: st.zonage.lues, hors_zone_publiee: st.zonage.hors_zone_publiee, non_verifiees: st.zonage.non_verifiees, commune_rnu: st.zonage.commune_rnu } : null,
      bati: st.bati ?? null,
    },
    parcelles: items.slice(0, MAX_ITEMS_LLM).map((it) => ({
      idu: it.idu,
      commune: it.commune ?? null,
      surface_m2: it.surface_m2,
      ...(it.surface_source === 'calculee_geometrie' ? { surface_calculee: true } : {}),
      zone: it.zonage_plu ?? null,
      type_zone: it.type_zone ?? null,
      zonage_statut: it.zonage_statut,
      bati: it.bati_detecte ?? null,
      score: it.score_tri,
      centroide: it.centroide,
      compacite: it.compacite,
    })),
    parcelles_non_affichees: Math.max(0, items.length - MAX_ITEMS_LLM),
    tri: st.tri ?? null,
    avertissements: Array.isArray(r.avertissements) ? r.avertissements.slice(0, 6) : [],
    sources: Array.isArray(r.sources) ? r.sources : [],
    consigne:
      "Constructibilité de PRINCIPE seulement (zone lue au centroïde). Approfondis les meilleures avec " +
      "get_etude_parcelle / get_parcel_plu avant tout verdict. N'invente ni zone, ni bâti, ni surface absents.",
  };
  if (r.status === 'no_data' || items.length === 0) {
    return { status: 'not_found', data, message: String(r.summary ?? 'Aucune parcelle ne remplit les critères.') };
  }
  const partiel = st.couverture_cadastre === 'partielle';
  return { status: partiel ? 'partial' : 'ok', data, message: partiel ? 'Lecture du cadastre partielle : le dire à l\'utilisateur.' : undefined };
}

// ─── Exécution ───────────────────────────────────────────────────────────────
export async function executerRechercherParcelles(
  input: Record<string, unknown>,
  ctx: CtxParcelles | null | undefined,
  callInternalFunction: AppelFonctionInterne,
  nomFonction: string | null = (typeof Deno !== 'undefined' ? Deno.env.get('COPILOT_FN_PARCELLES') : undefined) ?? null,
): Promise<ResultatOutil> {
  const source = nomFonction ?? 'rechercher-parcelles';
  if (!nomFonction) {
    return {
      status: 'not_configured', source: 'rechercher-parcelles',
      message: "La recherche de parcelles n'est pas encore branchée (COPILOT_FN_PARCELLES non défini). Signale-le sans proposer de parcelle.",
    };
  }
  const c = construireCorps(input ?? {}, ctx);
  if (!c) {
    return {
      status: 'error', source,
      message: 'Périmètre manquant : demande la commune (ou son code INSEE), ou un point avec un rayon, avant de chercher des parcelles.',
    };
  }
  try {
    const raw = await callInternalFunction(nomFonction, c.corps);
    const s = resumerRechercheParcelles(raw);
    const data = s.data ? { ...s.data, ...(c.perimetre_deduit_du_contexte ? { perimetre_deduit_du_contexte: true } : {}) } : undefined;
    const message = c.perimetre_deduit_du_contexte
      ? `Périmètre déduit de la parcelle ouverte (commune ${String(c.corps.commune ?? c.corps.code_insee)}) : précise-le à l'utilisateur.${s.message ? ` ${s.message}` : ''}`
      : s.message;
    return { status: s.status, source, data, message };
  } catch (e) {
    return { status: 'error', source, message: `${e instanceof Error ? e.message : String(e)} — aucune parcelle n'a pu être recherchée, n'en propose aucune.` };
  }
}
