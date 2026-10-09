// src/spaces/promoteur/shared/ouvrirStudio3D.ts
//
// PA1 — Ouvre MimmozIA Studio (application 3D locale) sur la parcelle choisie.
// La sélection (une ou plusieurs parcelles cadastrales, GeoJSON WGS 84) voyage
// dans l'ancre de l'adresse : `#parcelles=<base64url(JSON)>`. L'ancre ne quitte
// jamais le navigateur (elle n'est pas envoyée au serveur). Le studio fusionne
// les parcelles contiguës et pose le terrain à la forme exacte de l'unité foncière.

export interface ParcelleStudio {
  id: string;
  feature?: unknown;
}

/** Serveur Vite local du studio, valable uniquement quand Mimmoza tourne lui-même en local. */
export const STUDIO_3D_URL_LOCALE = "http://localhost:5173";

/** Adresse configurée (VITE_MIMMOZIA_STUDIO_URL), brute, éventuellement absente. */
const STUDIO_3D_URL_CONFIGUREE: string | undefined =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_MIMMOZIA_STUDIO_URL;

/** Adresse du studio : variable d'environnement, sinon le serveur Vite local par défaut. */
export const STUDIO_3D_URL: string = STUDIO_3D_URL_CONFIGUREE ?? STUDIO_3D_URL_LOCALE;

/** PUB-A — hôte de poste local (localhost, *.localhost, 127.x, ::1, 0.0.0.0). */
export function estHoteLocal(hote: string): boolean {
  const h = hote.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  return h === "localhost" || h.endsWith(".localhost") || h === "::1" || h === "0.0.0.0" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/**
 * PUB-A — adresse du studio selon l'hôte de la page Mimmoza (null = hors navigateur, traité comme local).
 * En local : adresse configurée sinon serveur Vite local. Sur un domaine public : adresse https publique
 * obligatoire, sinon ErreurStudio3D (jamais d'onglet vers localhost).
 */
export function resoudreUrlStudio3D(configuree: string | null | undefined, hotePage: string | null | undefined): string {
  const pageLocale = !hotePage || estHoteLocal(hotePage);
  const brute = (configuree ?? "").trim();
  const prefixe = "Studio 3D indisponible sur ce domaine public : ";
  if (!brute) {
    if (pageLocale) return STUDIO_3D_URL_LOCALE;
    throw new ErreurStudio3D(`${prefixe}aucune adresse de studio n'est configurée (VITE_MIMMOZIA_STUDIO_URL).`);
  }
  let url: URL | null = null;
  try { url = new URL(brute); } catch { /* adresse invalide, signalée ci-dessous */ }
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new ErreurStudio3D(`${pageLocale ? "Studio 3D indisponible : " : prefixe}adresse de studio invalide (« ${brute} »).`);
  }
  if (!pageLocale) {
    if (estHoteLocal(url.hostname)) throw new ErreurStudio3D(`${prefixe}l'adresse de studio configurée pointe vers un poste local (${url.host}).`);
    if (url.protocol !== "https:") throw new ErreurStudio3D(`${prefixe}l'adresse de studio doit être en https (${url.host}).`);
  }
  url.hash = "";
  return url.href;
}

function hotePageCourante(): string | null {
  return typeof window !== "undefined" && window.location ? window.location.hostname : null;
}

/** PUB-A — adresse du studio pour la page courante ; lève ErreurStudio3D si elle est inutilisable. */
export function urlStudio3D(): string {
  return resoudreUrlStudio3D(STUDIO_3D_URL_CONFIGUREE, hotePageCourante());
}

/** PUB-A — pose l'ancre de transfert sur l'adresse du studio (chemin et paramètres conservés). */
export function adresseAvecTransfert(base: string, ancre: string): string {
  const url = new URL(base);
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  url.hash = ancre;
  return url.href;
}

function base64Url(texte: string): string {
  const octets = new TextEncoder().encode(texte);
  let bin = "";
  for (const o of octets) bin += String.fromCharCode(o);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Construit l'adresse du studio pour une sélection ; null si aucune géométrie. */
/** PA2 — le point d'adresse (WGS 84) désigne la limite côté rue : la plus proche de lui. */
export interface PointAdresse { lat: number; lon: number }

/** ENV1 — photos 360° du terrain, en adresses signées (1 h). */
export interface PanoramaStudio { url: string; nom: string }

/** CH2 — ce que le tchat Mimmoza envoie en plus : description, photos de façade, plans (adresses signées). */
export interface ExtrasStudio {
  brief?: string | null;
  facades?: readonly PanoramaStudio[];
  plans?: readonly PanoramaStudio[];
}

/** CAD04 — erreur destinée à l'utilisateur (message affichable tel quel). */
export class ErreurStudio3D extends Error {
  constructor(message: string) { super(message); this.name = "ErreurStudio3D"; }
}

type Position = [number, number];
type PolygoneCoords = Position[][];

/** CAD04 — relief mesuré, réduit à ce dont le studio a besoin (pas de parcelGeojson : les parcelles voyagent déjà). */
export interface TerrainStudio {
  provider: string;
  renderBounds: [number, number, number, number];
  parcelBounds: [number, number, number, number];
  grid: { z: number[][]; n: number };
  altitudeMin: number;
  altitudeMax: number;
  penteMoyenne: number | null;
}

function anneauValide(anneau: unknown): anneau is Position[] {
  return Array.isArray(anneau) && anneau.length >= 4 &&
    anneau.every((pt) => Array.isArray(pt) && pt.length >= 2 && Number.isFinite(pt[0]) && Number.isFinite(pt[1]));
}

function polygoneValide(poly: unknown): poly is PolygoneCoords {
  return Array.isArray(poly) && poly.length > 0 && poly.every(anneauValide);
}

/** Polygones d'une parcelle (Feature ou géométrie, Polygon ou MultiPolygon), trous compris ; null si absents ou invalides. */
function polygonesParcelle(feature: unknown): PolygoneCoords[] | null {
  if (!feature || typeof feature !== "object") return null;
  const f = feature as { type?: unknown; geometry?: unknown; coordinates?: unknown };
  const geom = (f.type === "Feature" ? f.geometry : f) as { type?: unknown; coordinates?: unknown } | null | undefined;
  if (!geom || typeof geom !== "object") return null;
  const coords: unknown = geom.coordinates;
  const copie = (poly: PolygoneCoords): PolygoneCoords => poly.map((a) => a.map((pt) => [pt[0], pt[1]] as Position));
  if (geom.type === "Polygon") return polygoneValide(coords) ? [copie(coords)] : null;
  if (geom.type === "MultiPolygon" && Array.isArray(coords) && coords.length > 0 && coords.every(polygoneValide)) {
    return (coords as PolygoneCoords[]).map(copie);
  }
  return null;
}

/** Identifiants des parcelles sélectionnées sans géométrie exploitable. */
export function parcellesSansGeometrie(parcelles: readonly ParcelleStudio[]): string[] {
  return parcelles.filter((p) => polygonesParcelle(p.feature) === null).map((p) => p.id);
}

function verifierGeometries(parcelles: readonly ParcelleStudio[]): void {
  const manquantes = parcellesSansGeometrie(parcelles);
  if (manquantes.length > 0) {
    throw new ErreurStudio3D(
      `Géométrie cadastrale absente pour ${manquantes.length > 1 ? "les parcelles" : "la parcelle"} ${manquantes.join(", ")} : ` +
      "le Studio 3D ne peut pas poser le terrain réel. Retirez-la ou sélectionnez-la à nouveau sur la carte.",
    );
  }
}

/** CAD04 — une seule Feature MultiPolygon pour TOUTES les parcelles (trous conservés) ; erreur si l'une n'a pas de géométrie. */
export function multiPolygonParcelles(parcelles: readonly ParcelleStudio[]): { type: "Feature"; properties: { parcel_ids: string[] }; geometry: { type: "MultiPolygon"; coordinates: PolygoneCoords[] } } {
  if (parcelles.length === 0) throw new ErreurStudio3D("Aucune parcelle sélectionnée.");
  verifierGeometries(parcelles);
  const coordinates = parcelles.flatMap((p) => polygonesParcelle(p.feature) as PolygoneCoords[]);
  return { type: "Feature", properties: { parcel_ids: parcelles.map((p) => p.id) }, geometry: { type: "MultiPolygon", coordinates } };
}

function bornes(v: unknown): [number, number, number, number] | null {
  return Array.isArray(v) && v.length === 4 && v.every((x) => Number.isFinite(x)) ? [v[0], v[1], v[2], v[3]] : null;
}

/** CAD04 — extrait de la réponse de terrain-analysis-v1 le terrainData compact (altitudes au centimètre) ; erreur si incomplet. */
export function terrainCompact(reponse: unknown): TerrainStudio {
  const r = (reponse && typeof reponse === "object" ? reponse : {}) as { success?: unknown; error?: unknown; terrainData?: unknown };
  if (r.success === false) throw new ErreurStudio3D(`Relief indisponible : ${typeof r.error === "string" && r.error ? r.error : "erreur du service terrain"}.`);
  const t = (r.terrainData && typeof r.terrainData === "object" ? r.terrainData : null) as Record<string, unknown> | null;
  if (!t) throw new ErreurStudio3D("Relief indisponible : réponse du service terrain sans terrainData.");
  const renderBounds = bornes(t.renderBounds);
  const parcelBounds = bornes(t.parcelBounds);
  const grid = t.grid as { z?: unknown; n?: unknown } | undefined;
  const n = Number(grid?.n);
  const z = grid?.z;
  const grilleOk = Number.isInteger(n) && n >= 2 && Array.isArray(z) && z.length === n &&
    z.every((ligne) => Array.isArray(ligne) && ligne.length === n && ligne.every((v) => Number.isFinite(v)));
  const altitudeMin = Number(t.altitudeMin);
  const altitudeMax = Number(t.altitudeMax);
  if (!renderBounds || !parcelBounds || !grilleOk || !Number.isFinite(altitudeMin) || !Number.isFinite(altitudeMax)) {
    throw new ErreurStudio3D("Relief indisponible : réponse du service terrain incomplète (bornes, grille ou altitudes).");
  }
  const cm = (v: number) => Math.round(v * 100) / 100;
  const pente = t.penteMoyenne;
  return {
    provider: typeof t.provider === "string" ? t.provider : "inconnu",
    renderBounds,
    parcelBounds,
    grid: { z: (z as number[][]).map((ligne) => ligne.map(cm)), n },
    altitudeMin: cm(altitudeMin),
    altitudeMax: cm(altitudeMax),
    penteMoyenne: typeof pente === "number" && Number.isFinite(pente) ? cm(pente) : null,
  };
}

export type InvoquerFonction = (nom: string, body: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;

/** Client Supabase chargé à la demande : les fonctions pures ci-dessus restent testables sans réseau ni variables d'environnement. */
const invoquerSupabase: InvoquerFonction = async (nom, body) => {
  const { supabase } = await import("../../../supabaseClient");
  return supabase.functions.invoke(nom, { body });
};

/** CAD04 — relief mesuré de la sélection entière (parcours Foncier et préparation du tchat). */
export async function chargerReliefMesure(parcelles: readonly ParcelleStudio[], communeInsee?: string | null, invoquer: InvoquerFonction = invoquerSupabase): Promise<TerrainStudio> {
  const parcel_geojson = multiPolygonParcelles(parcelles);
  let reponse: { data: unknown; error: unknown };
  try {
    reponse = await invoquer("terrain-analysis-v1", { parcel_geojson, grid_size: 50, padding_meters: 30, commune_insee: communeInsee ?? null });
  } catch (e) {
    throw new ErreurStudio3D(`Relief indisponible : ${e instanceof Error ? e.message : String(e)}.`);
  }
  if (reponse.error) {
    const msg = reponse.error instanceof Error ? reponse.error.message : String((reponse.error as { message?: unknown })?.message ?? reponse.error);
    throw new ErreurStudio3D(`Relief indisponible : ${msg}.`);
  }
  return terrainCompact(reponse.data);
}

export function adresseStudio3D(parcelles: readonly ParcelleStudio[], communeInsee?: string | null, adresse?: string | null, point?: PointAdresse | null, panoramas: readonly PanoramaStudio[] = [], extras: ExtrasStudio = {}, terrain: TerrainStudio | null = null): string | null {
  // CAD04 : aucune parcelle sélectionnée n'est écartée en silence.
  verifierGeometries(parcelles);
  const brief = (extras.brief ?? "").trim().slice(0, 2000);
  const facades = (extras.facades ?? []).slice(0, 4);
  const plans = (extras.plans ?? []).slice(0, 6);
  // CH2 : sans parcelle, la prévisualisation reste possible à partir d'une description, de photos ou de plans.
  if (parcelles.length === 0 && !brief && facades.length === 0 && plans.length === 0) return null;
  const charge = {
    version: 1,
    source: "mimmoza-front-v2",
    communeInsee: communeInsee ?? null,
    adresse: adresse ?? null,
    pointAdresse: point && Number.isFinite(point.lat) && Number.isFinite(point.lon) ? { lat: point.lat, lon: point.lon } : null,
    parcels: parcelles.map((p) => ({ id: p.id, feature: p.feature })),
    ...(terrain && parcelles.length > 0 ? { terrainData: terrain } : {}),
    ...(panoramas.length > 0 ? { panoramas: panoramas.slice(0, 10) } : {}),
    ...(brief ? { brief } : {}),
    ...(facades.length > 0 ? { facades } : {}),
    ...(plans.length > 0 ? { plans } : {}),
  };
  return adresseAvecTransfert(urlStudio3D(), `parcelles=${base64Url(JSON.stringify(charge))}`);
}

/**
 * CAD04 — l'onglet est ouvert AVANT tout appel réseau (sinon le navigateur le bloque
 * comme fenêtre surgissante), puis dirigé vers le studio ; il est refermé si la
 * préparation échoue, et l'erreur remonte à l'appelant pour être affichée.
 * PUB-A — l'adresse du studio est vérifiée avant l'onglet et avant `preparer`
 * (relief, signatures) : sur un domaine public, pas d'onglet vers localhost.
 */
export async function ouvrirOngletStudio3D(
  preparer: () => Promise<string | null>,
  verifierStudio: () => string = urlStudio3D,
  hotePage: () => string | null = hotePageCourante,
): Promise<void> {
  verifierStudio();
  const onglet = window.open("about:blank", "_blank");
  try {
    const url = await preparer();
    if (!url) throw new ErreurStudio3D("Ajoutez au moins une parcelle, une photo, un plan ou une description.");
    const hote = hotePage();
    if (hote && !estHoteLocal(hote) && estHoteLocal(new URL(url).hostname)) {
      throw new ErreurStudio3D("Studio 3D indisponible sur ce domaine public : l'adresse de studio pointe vers un poste local.");
    }
    if (onglet) { onglet.opener = null; onglet.location.href = url; } else { window.location.href = url; }
  } catch (e) {
    onglet?.close();
    throw e;
  }
}

/** Ouvre le studio dans un nouvel onglet, relief mesuré compris. Lève ErreurStudio3D si une parcelle n'a pas de géométrie. */
export async function ouvrirStudio3D(parcelles: readonly ParcelleStudio[], communeInsee?: string | null, adresse?: string | null, point?: PointAdresse | null): Promise<void> {
  verifierGeometries(parcelles);
  await ouvrirOngletStudio3D(async () => {
    const terrain = parcelles.length > 0 ? await chargerReliefMesure(parcelles, communeInsee) : null;
    return adresseStudio3D(parcelles, communeInsee, adresse, point, [], {}, terrain);
  });
}

/**
 * ENV1 — même chose avec les photos 360° : il faut d'abord SIGNER leurs adresses
 * (appel réseau) ; CAD04 — et obtenir le relief mesuré de la sélection.
 */
export async function ouvrirStudio3DAvecPanoramas(
  parcelles: readonly ParcelleStudio[],
  signer: () => Promise<PanoramaStudio[]>,
  communeInsee?: string | null,
  adresse?: string | null,
  point?: PointAdresse | null,
): Promise<void> {
  if (parcelles.length === 0) throw new ErreurStudio3D("Aucune parcelle sélectionnée.");
  // Vérifiée avant l'ouverture : pas d'onglet vide pour une sélection incomplète.
  verifierGeometries(parcelles);
  await ouvrirOngletStudio3D(async () => {
    const [terrain, panoramas] = await Promise.all([
      chargerReliefMesure(parcelles, communeInsee),
      signer().catch(() => [] as PanoramaStudio[]),
    ]);
    return adresseStudio3D(parcelles, communeInsee, adresse, point, panoramas, {}, terrain);
  });
}
