// src/spaces/copilot/studio3d/reliefCache.ts
//
// R2 — RELIEF MIS EN CACHE PAR PARCELLE, CHARGÉ EN TÂCHE DE FOND, AVEC DÉLAI MAXIMAL.
//
// Avant : `chargerReliefMesure` (terrain-analysis-v1) était attendu AVANT
// l'ouverture de Studio, dans un onglet about:blank, sans délai maximal ; en
// repli OpenTopoData, au moins 11 s de pauses seules. Et chaque ouverture
// remesurait la même parcelle.
// Désormais :
//   - cache IndexedDB par sélection de parcelles (clé = identifiants triés +
//     paramètres de grille), 90 jours ; le relief d'une parcelle ne change pas ;
//   - préchargement dès que la parcelle est confirmée dans le tchat ;
//   - Studio s'ouvre tout de suite ; le relief lui est posté quand il arrive ;
//   - délai maximal (25 s) : au-delà, message clair et terrain plat provisoire.
//     La mesure engagée continue et remplit le cache : réessayer est instantané.

import { chargerReliefMesure, type ParcelleStudio, type TerrainStudio } from "../../promoteur/shared/ouvrirStudio3D.ts";

export const DELAI_RELIEF_MS = 25_000;
export const DUREE_VIE_RELIEF_MS = 90 * 24 * 3600 * 1000;
const PARAMS = "g50-p30";

export interface EntreeRelief { cle: string; terrain: TerrainStudio; mesureLe: number }

export interface StockageRelief {
  lire(cle: string): Promise<EntreeRelief | null>;
  ecrire(entree: EntreeRelief): Promise<void>;
}

/** Clé de cache : sélection entière (l'ordre des clics ne compte pas) et paramètres de la grille. */
export function cleRelief(parcelles: readonly Pick<ParcelleStudio, "id">[]): string {
  return `v1|${PARAMS}|${[...new Set(parcelles.map((p) => p.id.trim()))].sort().join(",")}`;
}

/* ------------------------------------------------------------------ */
/* Stockages                                                           */
/* ------------------------------------------------------------------ */

const NOM_BASE = "mimmoza-relief-cache";
const MAGASIN = "reliefs";

function ouvrirBase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("IndexedDB indisponible")); return; }
    const req = indexedDB.open(NOM_BASE, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(MAGASIN)) req.result.createObjectStore(MAGASIN, { keyPath: "cle" }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("ouverture du cache de relief impossible"));
  });
}

/** Cache du navigateur (IndexedDB). Toute erreur se lit comme « pas en cache ». */
export const stockageIndexedDb: StockageRelief = {
  async lire(cle) {
    try {
      const db = await ouvrirBase();
      return await new Promise<EntreeRelief | null>((resolve) => {
        const req = db.transaction(MAGASIN, "readonly").objectStore(MAGASIN).get(cle);
        req.onsuccess = () => resolve((req.result as EntreeRelief | undefined) ?? null);
        req.onerror = () => resolve(null);
      });
    } catch { return null; }
  },
  async ecrire(entree) {
    try {
      const db = await ouvrirBase();
      await new Promise<void>((resolve) => {
        const tx = db.transaction(MAGASIN, "readwrite");
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.objectStore(MAGASIN).put(entree);
      });
    } catch { /* cache facultatif */ }
  },
};

/** Stockage en mémoire (tests, navigation privée). */
export function stockageMemoire(): StockageRelief & { taille(): number } {
  const m = new Map<string, EntreeRelief>();
  return {
    async lire(cle) { return m.get(cle) ?? null; },
    async ecrire(e) { m.set(e.cle, e); },
    taille: () => m.size,
  };
}

/* ------------------------------------------------------------------ */
/* Lecture avec délai maximal                                          */
/* ------------------------------------------------------------------ */

export type IssueRelief =
  | { ok: true; terrain: TerrainStudio; source: "cache" | "mesure" }
  | { ok: false; raison: "delai" | "erreur"; message: string };

export interface OptionsRelief {
  stockage?: StockageRelief;
  charger?: (parcelles: readonly ParcelleStudio[], communeInsee: string | null) => Promise<TerrainStudio>;
  delaiMs?: number;
  maintenant?: () => number;
}

const enCours = new Map<string, Promise<TerrainStudio>>();

function frais(e: EntreeRelief | null, t: number): e is EntreeRelief {
  return !!e && Number.isFinite(e.mesureLe) && t - e.mesureLe < DUREE_VIE_RELIEF_MS && !!e.terrain?.grid?.z;
}

/** Relief en cache seulement (lecture rapide, sans réseau) ; `null` si absent ou périmé. */
export async function reliefEnCache(parcelles: readonly ParcelleStudio[], options: OptionsRelief = {}): Promise<TerrainStudio | null> {
  if (parcelles.length === 0) return null;
  const e = await (options.stockage ?? stockageIndexedDb).lire(cleRelief(parcelles)).catch(() => null);
  return frais(e, (options.maintenant ?? Date.now)()) ? e.terrain : null;
}

/** Enregistre un relief déjà mesuré (ex. parcours photo/GPS du tchat). */
export async function memoriserRelief(parcelles: readonly ParcelleStudio[], terrain: TerrainStudio, options: OptionsRelief = {}): Promise<void> {
  if (parcelles.length === 0) return;
  await (options.stockage ?? stockageIndexedDb).ecrire({ cle: cleRelief(parcelles), terrain, mesureLe: (options.maintenant ?? Date.now)() }).catch(() => undefined);
}

/** Mesure dédoublonnée (une seule requête par sélection) ; le résultat remplit le cache. */
function mesurer(parcelles: readonly ParcelleStudio[], communeInsee: string | null, options: OptionsRelief): Promise<TerrainStudio> {
  const cle = cleRelief(parcelles);
  const existante = enCours.get(cle);
  if (existante) return existante;
  const charger = options.charger ?? ((p, insee) => chargerReliefMesure(p, insee));
  const p = charger(parcelles, communeInsee)
    .then(async (terrain) => { await memoriserRelief(parcelles, terrain, options); return terrain; })
    .finally(() => enCours.delete(cle));
  enCours.set(cle, p);
  return p;
}

/**
 * Relief de la sélection : cache d'abord, sinon mesure — avec un délai maximal.
 * Ne rejette jamais : l'échec et le délai sont des issues, avec un message affichable.
 */
export async function reliefAvecDelai(parcelles: readonly ParcelleStudio[], communeInsee: string | null, options: OptionsRelief = {}): Promise<IssueRelief> {
  if (parcelles.length === 0) return { ok: false, raison: "erreur", message: "aucune parcelle pour mesurer le relief" };
  const cache = await reliefEnCache(parcelles, options);
  if (cache) return { ok: true, terrain: cache, source: "cache" };
  const delaiMs = options.delaiMs ?? DELAI_RELIEF_MS;
  let minuteur: ReturnType<typeof setTimeout> | null = null;
  const delai = new Promise<IssueRelief>((resolve) => {
    minuteur = setTimeout(() => resolve({ ok: false, raison: "delai", message: `le service de relief n'a pas répondu en ${Math.round(delaiMs / 1000)} s` }), delaiMs);
  });
  const mesure = mesurer(parcelles, communeInsee, options).then(
    (terrain): IssueRelief => ({ ok: true, terrain, source: "mesure" }),
    (e: unknown): IssueRelief => ({ ok: false, raison: "erreur", message: (e instanceof Error ? e.message : String(e)).replace(/^Relief indisponible : /, "").replace(/\.$/, "") }),
  );
  try { return await Promise.race([mesure, delai]); }
  finally { if (minuteur) clearTimeout(minuteur); }
}

/** Préchargement en tâche de fond (parcelle confirmée) : remplit le cache, n'affiche rien. */
export function prechargerRelief(parcelles: readonly ParcelleStudio[], communeInsee: string | null, options: OptionsRelief = {}): void {
  void reliefEnCache(parcelles, options).then((c) => { if (!c) void mesurer(parcelles, communeInsee, options).catch(() => undefined); });
}
