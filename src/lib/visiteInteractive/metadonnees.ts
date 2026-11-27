// src/lib/visiteInteractive/metadonnees.ts
// =============================================================================
// VIS-69 — Visite interactive « bureau de vente » : lecture de visite-interactive.json
// (format mimmozia.visite-interactive v1, écrit par le studio :
// unreal/mimmozia/visite_interactive/metadonnees.py) publié À CÔTÉ du manifeste v1
// dans visites/<visiteId>/. Module PUR (testé par metadonnees.test.ts).
//
// Si ce fichier manque, est illisible ou ne correspond pas au manifeste, la page
// /visite/<id> garde l'ancienne visionneuse (aucune visite existante n'est cassée).
//
// Conventions (identiques au manifeste v1) : cap horaire depuis le nord du plan,
// inclinaison positive vers le haut, x = est, y = nord, z = altitude (m).
// =============================================================================

import { fichierValide, type ManifesteVisite } from "../../pages/visite/manifeste";

export const FORMAT_INTERACTIF = "mimmozia.visite-interactive";
export const FICHIER_INTERACTIF = "visite-interactive.json";

export type Ambiance = "jour" | "nuit";

export interface ImagesAmbiance {
  readonly image: string;
  readonly apercu?: string;
}

export interface Hotspot {
  readonly vers: string;
  readonly libelle: string;
  /** « sol » : pastille posée au sol (on marche) ; « repere » : repère flottant (changement de niveau). */
  readonly mode: "sol" | "repere";
  readonly cap_deg: number;
  readonly inclinaison_deg: number;
  readonly distance_m: number;
}

export interface PanoramaInteractif {
  readonly id: string;
  readonly titre: string;
  readonly piece: string | null;
  readonly lieu: "interieur" | "exterieur";
  readonly niveau: number;
  readonly position_m: readonly [number, number, number];
  readonly hauteur_yeux_m: number;
  readonly cap_initial_deg: number;
  readonly images: Readonly<Partial<Record<Ambiance, ImagesAmbiance>>> & { readonly jour: ImagesAmbiance };
  readonly hotspots: readonly Hotspot[];
}

export interface PieceInteractive {
  readonly id: string;
  readonly titre: string;
  readonly fonction: string;
  readonly niveau: number;
  readonly surface_m2: number;
  readonly polygone_m: readonly (readonly [number, number])[];
  readonly panoramas: readonly string[];
}

export interface EntreeMenu {
  readonly piece: string | null;
  readonly titre: string;
  readonly panoramas: readonly string[];
}

export interface NiveauPlan {
  readonly cadre_m: readonly [number, number, number, number];
  readonly pieces: readonly string[];
}

export interface VisiteInteractive {
  readonly titre: string;
  readonly depart: string;
  readonly departConseille: string;
  readonly ambiances: readonly Ambiance[];
  readonly menu: readonly EntreeMenu[];
  readonly pieces: readonly PieceInteractive[];
  readonly panoramas: readonly PanoramaInteractif[];
  readonly emprise_batiment_m: readonly (readonly [number, number])[];
  readonly niveaux: Readonly<Record<string, NiveauPlan>>;
  readonly mentions: readonly string[];
}

export type LectureInteractive =
  | { readonly ok: true; readonly visite: VisiteInteractive; readonly avertissements: readonly string[] }
  | { readonly ok: false; readonly erreur: string };

type J = Record<string, unknown>;
const estObjet = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v);
const estNombre = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const estTexte = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const cap360 = (v: number): number => ((v % 360) + 360) % 360;

function point2(v: unknown): [number, number] | null {
  return Array.isArray(v) && v.length >= 2 && estNombre(v[0]) && estNombre(v[1]) ? [v[0], v[1]] : null;
}

function lireImages(v: unknown): ImagesAmbiance | null {
  if (!estObjet(v) || !fichierValide(v["image"])) return null;
  return { image: v["image"], ...(fichierValide(v["apercu"]) ? { apercu: v["apercu"] } : {}) };
}

/**
 * Lit visite-interactive.json. Refuse (→ ancienne visionneuse) un format inconnu ou un fichier
 * qui ne décrit pas les mêmes panoramas que le manifeste v1 ; écarte avec avertissement le reste.
 */
export function lireVisiteInteractive(brut: unknown, manifeste: ManifesteVisite): LectureInteractive {
  if (!estObjet(brut) || brut["format"] !== FORMAT_INTERACTIF) return { ok: false, erreur: "format inconnu" };
  if (brut["version"] !== 1) return { ok: false, erreur: `version ${String(brut["version"])} non prise en charge` };
  const avert: string[] = [];
  const idsManifeste = new Set(manifeste.panoramas.map((p) => p.id));
  const panos: PanoramaInteractif[] = [];
  for (const p of Array.isArray(brut["panoramas"]) ? brut["panoramas"] : []) {
    if (!estObjet(p) || !estTexte(p["id"]) || !idsManifeste.has(p["id"])) {
      avert.push("panorama ignoré (absent du manifeste)");
      continue;
    }
    const imgs = estObjet(p["images"]) ? p["images"] : {};
    const jour = lireImages(imgs["jour"]);
    if (!jour) {
      avert.push(`${p["id"]} : image de jour invalide`);
      continue;
    }
    const nuit = lireImages(imgs["nuit"]);
    const pos = Array.isArray(p["position_m"]) && p["position_m"].length === 3 && p["position_m"].every(estNombre)
      ? (p["position_m"] as [number, number, number]) : null;
    if (!pos) {
      avert.push(`${p["id"]} : position invalide`);
      continue;
    }
    const hs: Hotspot[] = [];
    for (const h of Array.isArray(p["hotspots"]) ? p["hotspots"] : []) {
      if (!estObjet(h) || !estTexte(h["vers"]) || !idsManifeste.has(h["vers"]) || !estNombre(h["cap_deg"]) || !estNombre(h["inclinaison_deg"])) continue;
      hs.push({
        vers: h["vers"], libelle: estTexte(h["libelle"]) ? h["libelle"] : h["vers"],
        mode: h["mode"] === "sol" ? "sol" : "repere",
        cap_deg: cap360(h["cap_deg"]), inclinaison_deg: Math.max(-89, Math.min(89, h["inclinaison_deg"])),
        distance_m: estNombre(h["distance_m"]) ? h["distance_m"] : 0,
      });
    }
    panos.push({
      id: p["id"], titre: estTexte(p["titre"]) ? p["titre"] : p["id"],
      piece: estTexte(p["piece"]) ? p["piece"] : null,
      lieu: p["lieu"] === "exterieur" ? "exterieur" : "interieur",
      niveau: estNombre(p["niveau"]) ? p["niveau"] : 0,
      position_m: pos,
      hauteur_yeux_m: estNombre(p["hauteur_yeux_m"]) && p["hauteur_yeux_m"] > 0 ? p["hauteur_yeux_m"] : 1.6,
      cap_initial_deg: estNombre(p["cap_initial_deg"]) ? cap360(p["cap_initial_deg"]) : 0,
      images: { jour, ...(nuit ? { nuit } : {}) },
      hotspots: hs,
    });
  }
  // Mêmes panoramas que le manifeste : sinon la visite interactive serait incomplète → ancienne visionneuse.
  if (panos.length !== idsManifeste.size) return { ok: false, erreur: "panoramas différents du manifeste" };
  const ids = new Set(panos.map((p) => p.id));

  const pieces: PieceInteractive[] = [];
  for (const x of Array.isArray(brut["pieces"]) ? brut["pieces"] : []) {
    if (!estObjet(x) || !estTexte(x["id"]) || !Array.isArray(x["polygone_m"])) continue;
    const poly = x["polygone_m"].map(point2).filter((q): q is [number, number] => q !== null);
    if (poly.length < 3) continue;
    pieces.push({
      id: x["id"], titre: estTexte(x["titre"]) ? x["titre"] : "Pièce", fonction: estTexte(x["fonction"]) ? x["fonction"] : "autre",
      niveau: estNombre(x["niveau"]) ? x["niveau"] : 0, surface_m2: estNombre(x["surface_m2"]) ? x["surface_m2"] : 0,
      polygone_m: poly, panoramas: (Array.isArray(x["panoramas"]) ? x["panoramas"] : []).filter((v): v is string => typeof v === "string" && ids.has(v)),
    });
  }
  const menu: EntreeMenu[] = [];
  for (const m of Array.isArray(brut["menu"]) ? brut["menu"] : []) {
    if (!estObjet(m) || !estTexte(m["titre"])) continue;
    const vues = (Array.isArray(m["panoramas"]) ? m["panoramas"] : []).filter((v): v is string => typeof v === "string" && ids.has(v));
    if (vues.length) menu.push({ piece: estTexte(m["piece"]) ? m["piece"] : null, titre: m["titre"], panoramas: vues });
  }
  if (!menu.length) menu.push({ piece: null, titre: "Vues", panoramas: panos.map((p) => p.id) });

  const niveaux: Record<string, NiveauPlan> = {};
  const pl = estObjet(brut["plan"]) ? brut["plan"] : {};
  if (estObjet(pl["niveaux"])) {
    for (const [k, v] of Object.entries(pl["niveaux"])) {
      if (!estObjet(v)) continue;
      const c = v["cadre_m"];
      if (!(Array.isArray(c) && c.length === 4 && c.every(estNombre) && c[2] > c[0] && c[3] > c[1])) continue;
      niveaux[k] = { cadre_m: c as [number, number, number, number], pieces: (Array.isArray(v["pieces"]) ? v["pieces"] : []).filter(estTexte) };
    }
  }
  const emprise = (Array.isArray(pl["emprise_batiment_m"]) ? pl["emprise_batiment_m"] : []).map(point2).filter((q): q is [number, number] => q !== null);
  const ambiances: Ambiance[] = ["jour"];
  if (Array.isArray(brut["ambiances"]) && brut["ambiances"].includes("nuit") && panos.some((p) => p.images.nuit)) ambiances.push("nuit");
  const depart = estTexte(brut["depart"]) && ids.has(brut["depart"]) ? brut["depart"] : manifeste.depart;
  const conseille = estTexte(brut["depart_conseille"]) && ids.has(brut["depart_conseille"]) ? brut["depart_conseille"] : depart;
  return {
    ok: true,
    visite: {
      titre: estTexte(brut["titre"]) ? brut["titre"] : manifeste.titre, depart, departConseille: conseille, ambiances, menu, pieces,
      panoramas: panos, emprise_batiment_m: emprise, niveaux,
      mentions: manifeste.mentions,
    },
    avertissements: avert,
  };
}

// ───────────────────────── Ambiance ─────────────────────────

/** Images à afficher pour un panorama dans une ambiance (repli jour si la nuit manque pour lui). */
export function imagesPour(p: PanoramaInteractif, ambiance: Ambiance): { images: ImagesAmbiance; ambiance: Ambiance } {
  const n = ambiance === "nuit" ? p.images.nuit : undefined;
  return n ? { images: n, ambiance: "nuit" } : { images: p.images.jour, ambiance: "jour" };
}

// ───────────────────────── Hotspots au sol ─────────────────────────

/**
 * Aplatissement vertical (0..1) d'une pastille posée au sol vue sous une inclinaison donnée :
 * un cercle au sol vu à −90° est rond, vu à −10° est très écrasé. Borné pour rester cliquable.
 */
export function aplatissementSol(inclinaisonDeg: number): number {
  return Math.max(0.32, Math.min(1, Math.sin((Math.abs(inclinaisonDeg) * Math.PI) / 180) * 1.6));
}

/** Échelle (0,55..1,15) d'une pastille au sol selon sa distance : proche = grande, loin = petite. */
export function echelleSol(distanceM: number): number {
  const d = Math.max(0.5, distanceM || 3);
  return Math.max(0.55, Math.min(1.15, 2.6 / d));
}

// ───────────────────────── Plan ─────────────────────────

export interface CadreSvg {
  readonly largeur: number;
  readonly hauteur: number;
  /** Plan (m) → SVG (px), nord en haut. */
  readonly vers: (x: number, y: number) => [number, number];
}

/** Transformation du cadre (m) d'un niveau vers un SVG dont le plus grand côté vaut `cote` px. */
export function cadreSvg(cadre: readonly [number, number, number, number], cote = 320): CadreSvg {
  const [x0, y0, x1, y1] = cadre;
  const s = cote / Math.max(x1 - x0, y1 - y0, 1e-6);
  return { largeur: (x1 - x0) * s, hauteur: (y1 - y0) * s, vers: (x, y) => [(x - x0) * s, (y1 - y) * s] };
}

export function centroide(poly: readonly (readonly [number, number])[]): [number, number] {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-9) return [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
  return [cx / (3 * a), cy / (3 * a)];
}

/** Cadre à afficher pour un niveau : celui du studio, sinon les panoramas de ce niveau (+ 3 m). */
export function cadreNiveau(v: VisiteInteractive, niveau: number): [number, number, number, number] {
  const c = v.niveaux[String(niveau)]?.cadre_m;
  if (c) return [c[0], c[1], c[2], c[3]];
  const pts = v.panoramas.filter((p) => p.niveau === niveau).map((p) => p.position_m);
  if (!pts.length) return [0, 0, 10, 10];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs) - 3, Math.min(...ys) - 3, Math.max(...xs) + 3, Math.max(...ys) + 3];
}

// ───────────────────────── Partage et impression ─────────────────────────

/** Lien public de la visite, ouvert sur le panorama courant (et l'ambiance nuit si choisie). */
export function lienPublic(origine: string, visiteId: string, panoramaId?: string, ambiance?: Ambiance): string {
  const q = new URLSearchParams();
  if (panoramaId) q.set("p", panoramaId);
  if (ambiance === "nuit") q.set("ambiance", "nuit");
  const s = q.toString();
  return `${origine.replace(/\/+$/, "")}/visite/${encodeURIComponent(visiteId)}${s ? `?${s}` : ""}`;
}

/** Lien mailto prérempli (objet + corps) vers la page publique. */
export function lienMailto(titre: string, piece: string, lien: string): string {
  const objet = `Visite 360° — ${titre}`;
  const corps = [
    "Bonjour,",
    "",
    `Je vous invite à découvrir ce logement en visite virtuelle 360° (${piece}) :`,
    lien,
    "",
    "La visite s'ouvre dans le navigateur, sur ordinateur, tablette ou téléphone, sans installation.",
    "",
    "Images de synthèse non contractuelles.",
  ].join("\n");
  return `mailto:?subject=${encodeURIComponent(objet)}&body=${encodeURIComponent(corps)}`;
}

/** Nom de fichier de capture : visite-<titre>-<piece>-<ambiance>.png, caractères sûrs. */
export function nomCapture(titre: string, piece: string, ambiance: Ambiance): string {
  const s = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `visite-${[s(titre), s(piece), ambiance].filter(Boolean).join("-")}.png`;
}

/** Pièce (entrée du menu) d'un panorama. */
export function entreeDuPanorama(v: VisiteInteractive, panoramaId: string): EntreeMenu | undefined {
  return v.menu.find((m) => m.panoramas.includes(panoramaId));
}

/** Libellé du niveau pour l'en-tête du plan. */
export function libelleNiveau(n: number): string {
  return n === 0 ? "Rez-de-chaussée" : n === 1 ? "1er étage" : `${n}e étage`;
}
