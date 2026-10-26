// src/pages/visite/manifeste.ts
// =============================================================================
// Visite 360° — manifeste v1 (contrat « film ou visite en 3 clics », 26/10/2026)
// Module PUR : lecture et contrôle du manifest.json, adresses des fichiers,
// conventions d'orientation. Testé par manifeste.test.ts (node --test).
//
// Conventions (studio : unreal/mimmozia/visite360/geometrie.py) :
//   cap_deg      relèvement HORAIRE depuis le nord du plan ; le CENTRE de chaque
//                image équirectangulaire regarde le nord (cap 0).
//   inclinaison  élévation en degrés, positive vers le haut.
//   position_m   plan du projet : x = est, y = nord, z = altitude (m).
// Repère three.js de la visionneuse : nord = −Z, est = +X, haut = +Y.
// =============================================================================

export const MENTION_OBLIGATOIRE = "Images de synthèse non contractuelles";
export const URL_SUPABASE_DEFAUT = "https://fwvrqngbafqdaekbdfnm.supabase.co";
export const ID_DEMO = "demo";

export interface LienVisite {
  readonly vers: string;
  readonly cap_deg: number;
  readonly inclinaison_deg: number;
  readonly libelle: string;
}

export interface PanoramaVisite {
  readonly id: string;
  readonly titre: string;
  readonly image: string;
  readonly apercu?: string;
  readonly largeur: number;
  readonly hauteur: number;
  readonly cap_initial_deg: number;
  readonly niveau: number;
  readonly position_m: readonly [number, number, number];
  readonly lieu?: "interieur" | "exterieur";
  readonly liens: readonly LienVisite[];
}

export interface PlanVisite {
  readonly image: string;
  readonly niveaux: readonly number[];
  readonly images?: Readonly<Record<string, string>>;
  readonly emprise_m?: readonly [number, number, number, number];
}

export interface ElementOmis {
  readonly categorie: string;
  readonly raison: string;
}

export interface ManifesteVisite {
  readonly version: 1;
  readonly titre: string;
  readonly depart: string;
  readonly panoramas: readonly PanoramaVisite[];
  readonly plan?: PlanVisite;
  readonly mentions: readonly string[];
  readonly elements_omis: readonly ElementOmis[];
}

export type LectureManifeste =
  | { readonly ok: true; readonly manifeste: ManifesteVisite; readonly avertissements: readonly string[] }
  | { readonly ok: false; readonly erreur: string };

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Nom de fichier simple, sans dossier ni schéma : jamais d'URL arbitraire chargée depuis un manifeste. */
const RE_FICHIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
/** Plan : image matricielle seulement (PNG publié par le studio) — jamais de SVG, contenu actif d'un bucket public. */
const RE_IMAGE_PLAN = /\.(png|jpe?g|webp)$/i;

type J = Record<string, unknown>;
const estObjet = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v);
const estNombre = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const estTexte = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** Identifiant de visite accepté par la page : UUID (bucket public) ou « demo ». */
export function identifiantValide(id: string | undefined | null): id is string {
  return !!id && (id === ID_DEMO || RE_UUID.test(id));
}

export function fichierValide(nom: unknown): nom is string {
  return typeof nom === "string" && RE_FICHIER.test(nom) && !nom.includes("..");
}

/** Dossier public d'une visite (barre finale comprise). */
export function dossierVisite(visiteId: string, urlSupabase: string = URL_SUPABASE_DEFAUT, baseDemo = "/"): string {
  if (visiteId === ID_DEMO) return `${baseDemo.replace(/\/?$/, "/")}visite-demo/`;
  return `${urlSupabase.replace(/\/+$/, "")}/storage/v1/object/public/visites/${encodeURIComponent(visiteId)}/`;
}

export function imagePlanValide(nom: unknown): nom is string {
  return fichierValide(nom) && RE_IMAGE_PLAN.test(nom);
}

export function urlFichier(dossier: string, nom: string): string {
  if (!fichierValide(nom)) throw new Error(`nom de fichier refusé : ${nom}`);
  return dossier + nom;
}

const cap360 = (v: number): number => ((v % 360) + 360) % 360;

/** Lit un manifeste v1 : refuse ce qui empêcherait la visite, écarte (avec avertissement) le reste. */
export function lireManifeste(brut: unknown): LectureManifeste {
  if (!estObjet(brut)) return { ok: false, erreur: "manifeste illisible" };
  if (brut["version"] !== 1) return { ok: false, erreur: `version de manifeste non prise en charge (${String(brut["version"])})` };
  const avert: string[] = [];
  const brutsPanos = Array.isArray(brut["panoramas"]) ? brut["panoramas"] : [];
  const panos: PanoramaVisite[] = [];
  for (const p of brutsPanos) {
    if (!estObjet(p) || !estTexte(p["id"]) || !fichierValide(p["image"])) {
      avert.push("panorama ignoré (identifiant ou image invalide)");
      continue;
    }
    const pos = Array.isArray(p["position_m"]) && p["position_m"].length === 3 && p["position_m"].every(estNombre)
      ? (p["position_m"] as [number, number, number]) : ([0, 0, 0] as [number, number, number]);
    const liens: LienVisite[] = [];
    for (const l of Array.isArray(p["liens"]) ? p["liens"] : []) {
      if (!estObjet(l) || !estTexte(l["vers"]) || !estNombre(l["cap_deg"])) continue;
      liens.push({
        vers: l["vers"], cap_deg: cap360(l["cap_deg"]),
        inclinaison_deg: estNombre(l["inclinaison_deg"]) ? Math.max(-90, Math.min(90, l["inclinaison_deg"])) : 0,
        libelle: estTexte(l["libelle"]) ? l["libelle"] : l["vers"],
      });
    }
    panos.push({
      id: p["id"], titre: estTexte(p["titre"]) ? p["titre"] : p["id"], image: p["image"],
      apercu: fichierValide(p["apercu"]) ? p["apercu"] : undefined,
      largeur: estNombre(p["largeur"]) ? p["largeur"] : 0, hauteur: estNombre(p["hauteur"]) ? p["hauteur"] : 0,
      cap_initial_deg: estNombre(p["cap_initial_deg"]) ? cap360(p["cap_initial_deg"]) : 0,
      niveau: estNombre(p["niveau"]) ? Math.round(p["niveau"]) : 0,
      position_m: pos,
      lieu: p["lieu"] === "interieur" || p["lieu"] === "exterieur" ? p["lieu"] : undefined,
      liens,
    });
  }
  if (!panos.length) return { ok: false, erreur: "aucun panorama dans cette visite" };
  const ids = new Set(panos.map((p) => p.id));
  if (ids.size !== panos.length) return { ok: false, erreur: "identifiants de panorama en double" };
  // Liens vers un panorama absent : retirés (un repère qui ne mène nulle part est pire qu'aucun).
  const propres = panos.map((p) => {
    const garde = p.liens.filter((l) => ids.has(l.vers) && l.vers !== p.id);
    if (garde.length !== p.liens.length) avert.push(`${p.id} : lien(s) vers un panorama absent retiré(s)`);
    return garde.length === p.liens.length ? p : { ...p, liens: garde };
  });
  const depart = estTexte(brut["depart"]) && ids.has(brut["depart"]) ? brut["depart"] : propres[0].id;
  if (depart !== brut["depart"]) avert.push("panorama de départ absent : premier panorama utilisé");

  let plan: PlanVisite | undefined;
  const pl = brut["plan"];
  if (estObjet(pl) && !imagePlanValide(pl["image"])) avert.push("plan ignoré (image PNG ou JPEG attendue)");
  if (estObjet(pl) && imagePlanValide(pl["image"])) {
    const images: Record<string, string> = {};
    if (estObjet(pl["images"])) for (const [k, v] of Object.entries(pl["images"])) if (imagePlanValide(v)) images[k] = v;
    const e = pl["emprise_m"];
    const emprise = Array.isArray(e) && e.length === 4 && e.every(estNombre) && e[2] > e[0] && e[3] > e[1]
      ? (e as [number, number, number, number]) : undefined;
    plan = {
      image: pl["image"],
      niveaux: Array.isArray(pl["niveaux"]) ? pl["niveaux"].filter(estNombre) : [],
      images: Object.keys(images).length ? images : undefined,
      emprise_m: emprise,
    };
  }
  const mentions = (Array.isArray(brut["mentions"]) ? brut["mentions"] : []).filter(estTexte);
  // La mention légale est TOUJOURS affichée, même si un manifeste l'oubliait.
  if (!mentions.includes(MENTION_OBLIGATOIRE)) mentions.unshift(MENTION_OBLIGATOIRE);
  const omis = (Array.isArray(brut["elements_omis"]) ? brut["elements_omis"] : [])
    .filter((x): x is J => estObjet(x) && estTexte(x["categorie"]))
    .map((x) => ({ categorie: String(x["categorie"]), raison: estTexte(x["raison"]) ? String(x["raison"]) : "" }));

  return {
    ok: true,
    manifeste: {
      version: 1, titre: estTexte(brut["titre"]) ? brut["titre"] : "Visite 360°", depart, panoramas: propres,
      plan, mentions, elements_omis: omis,
    },
    avertissements: avert,
  };
}

/** Message d'erreur affiché pour une réponse HTTP du stockage public. */
export function messageHttp(statut: number): string {
  if (statut === 400 || statut === 404) return "Cette visite n'existe pas ou n'est plus disponible.";
  if (statut === 401 || statut === 403) return "Cette visite n'est pas publique.";
  return `Le serveur n'a pas pu fournir la visite (erreur ${statut}). Réessayez dans un instant.`;
}

// ───────────────────────── Orientation ─────────────────────────

export type Vec3 = readonly [number, number, number];
const RAD = Math.PI / 180;

/** Direction three.js (nord = −Z, est = +X, haut = +Y) d'un cap et d'une inclinaison. */
export function directionVue(capDeg: number, inclinaisonDeg: number): Vec3 {
  const c = capDeg * RAD;
  const e = inclinaisonDeg * RAD;
  return [Math.sin(c) * Math.cos(e), Math.sin(e), -Math.cos(c) * Math.cos(e)];
}

/** Cap et inclinaison d'une direction three.js (inverse de directionVue). */
export function capDepuisDirection(d: Vec3): { cap: number; inclinaison: number } {
  const n = Math.hypot(d[0], d[1], d[2]) || 1;
  return { cap: cap360(Math.atan2(d[0], -d[2]) / RAD), inclinaison: Math.asin(Math.max(-1, Math.min(1, d[1] / n))) / RAD };
}

/** Colonne u (0..1) d'un cap dans l'image équirectangulaire (centre = nord). */
export function colonneImage(capDeg: number): number {
  return (((0.5 + capDeg / 360) % 1) + 1) % 1;
}

/** Écart signé b − a ramené dans ]−180, 180]. */
export function ecartCap(a: number, b: number): number {
  const d = cap360(b - a);
  return d > 180 ? d - 360 : d;
}

export function bornerInclinaison(v: number, limite = 85): number {
  return Math.max(-limite, Math.min(limite, v));
}

// ───────────────────────── Plan ─────────────────────────

/** Position (0..1, 0..1, origine en haut à gauche, nord en haut) d'un point du plan sur l'image du plan. */
export function positionSurPlan(pos: readonly number[], emprise: readonly [number, number, number, number]): { x: number; y: number } {
  const [x0, y0, x1, y1] = emprise;
  return { x: (pos[0] - x0) / (x1 - x0), y: (y1 - pos[1]) / (y1 - y0) };
}

export function imagePlan(plan: PlanVisite, niveau: number): string {
  return plan.images?.[String(niveau)] ?? plan.image;
}

// ───────────────────────── Liste des pièces ─────────────────────────

export interface GroupePieces {
  readonly titre: string;
  readonly panoramas: readonly PanoramaVisite[];
}

/** Panoramas regroupés : Extérieur puis Intérieur (ou par niveau si `lieu` est absent). */
export function grouperPieces(panos: readonly PanoramaVisite[]): GroupePieces[] {
  if (panos.some((p) => p.lieu)) {
    const ext = panos.filter((p) => p.lieu === "exterieur");
    const int = panos.filter((p) => p.lieu !== "exterieur");
    return [{ titre: "Extérieur", panoramas: ext }, { titre: "Intérieur", panoramas: int }].filter((g) => g.panoramas.length);
  }
  const niveaux = [...new Set(panos.map((p) => p.niveau))].sort((a, b) => a - b);
  if (niveaux.length <= 1) return [{ titre: "Pièces", panoramas: panos }];
  return niveaux.map((n) => ({ titre: n === 0 ? "Rez-de-chaussée" : `Niveau ${n}`, panoramas: panos.filter((p) => p.niveau === n) }));
}

/** Taille de texture à charger : jamais plus que le GPU ne l'accepte, 4096 px sur téléphone (mémoire). */
export function largeurTexture(largeurImage: number, maxTexture: number, mobile: boolean): number {
  const plafond = Math.min(maxTexture || 4096, mobile ? 4096 : 16384);
  return Math.max(256, Math.min(largeurImage || plafond, plafond));
}
