// metreStudio.ts — R4/R5 : métré v2 reçu de Studio → bilan promoteur (module PUR)
// ─────────────────────────────────────────────────────────────────────────────
// Contrat `mimmoza-metre` v2 (émis par mimmozia-studio, src/core/bim/metreV2.ts) :
// chaque valeur porte sa source (`mesure` sur le modèle, `estime`, `saisi`), et
// le message porte une empreinte du modèle et une révision. Ce module :
//   • valide un message (jamais d'exception, null si invalide) ;
//   • le projette en `MassingMetrics` (le métré que computeProForma connaît) ;
//   • applique la RÈGLE DE PRIORITÉ : le modèle fait foi quand il existe,
//     la Programmation sert de défaut avant le modèle ;
//   • mesure l'écart programmation ↔ modèle (signalé, jamais écrasé) ;
//   • calcule la synthèse CA / coûts / marge avec le moteur unique
//     computeProForma (aucune duplication de formule).
// ─────────────────────────────────────────────────────────────────────────────

import { computeProForma, type Assumptions } from "../../../../supabase/functions/_shared/finance/proForma.ts";
import type { MassingMetrics } from "../terrain3d/massingToBilan.ts";

export const CANAL_METRE = "mimmoza-metre-v2";
export const CLE_METRE_PREFIXE = "mimmoza.metre.v2.";
export const CLE_METRE_DERNIER = `${CLE_METRE_PREFIXE}dernier`;
export const cleMetreEtude = (etudeId: string): string => `${CLE_METRE_PREFIXE}etude.${etudeId}`;
export const cleResume = (etudeId: string): string => `mimmoza.bilan.resume.v1.${etudeId}`;

export type SourceValeur = "mesure" | "estime" | "saisi";
export interface ValeurMetre { valeur: number; source: SourceValeur }
export interface TypologieMetre { T1: number; T2: number; T3: number; T4: number; T5: number }

export interface BatimentMetre {
  id: string; nom: string;
  niveaux: ValeurMetre; niveauxHorsSol: ValeurMetre; sousSols: ValeurMetre; hauteurM: ValeurMetre;
  empriseSolM2: ValeurMetre; sdpM2: ValeurMetre; surfaceUtileM2: ValeurMetre; surfaceHabitableM2: ValeurMetre;
  logements: ValeurMetre; typologie: { valeurs: TypologieMetre; source: SourceValeur };
  stationnement: ValeurMetre; commerceM2: ValeurMetre; bureauxM2: ValeurMetre;
  facadeM2: ValeurMetre; facadeNetteM2: ValeurMetre; typeToiture: "terrasse" | "pente"; toitureM2: ValeurMetre;
  balconsM2: ValeurMetre; menuiseries: ValeurMetre;
}
export interface QuartierMetre {
  terrainM2: ValeurMetre; voirieM2: ValeurMetre; espacesVertsM2: ValeurMetre; espacesPublicsM2: ValeurMetre;
  cessibleM2: ValeurMetre; empriseBatieM2: ValeurMetre; sdpM2: ValeurMetre; logements: ValeurMetre;
}
export interface TotauxMetre {
  nbBatiments: number; niveauxMax: ValeurMetre; empriseSolM2: ValeurMetre; ces: ValeurMetre | null;
  sdpM2: ValeurMetre; surfaceHabitableM2: ValeurMetre; logements: ValeurMetre;
  typologie: { valeurs: TypologieMetre; source: SourceValeur };
  stationnement: ValeurMetre; commerceM2: ValeurMetre; bureauxM2: ValeurMetre;
  facadeM2: ValeurMetre; facadeNetteM2: ValeurMetre; toitureTerrasseM2: ValeurMetre; toiturePenteM2: ValeurMetre;
  balconsM2: ValeurMetre; menuiseries: ValeurMetre;
}
export interface MetreStudioV2 {
  format: "mimmoza-metre"; version: 2;
  etudeId: string | null; projetMimmozaId: string | null; architectureId: string; nom: string;
  revision: number; empreinte: string; emisLe: string;
  parcelleM2: ValeurMetre | null; batiments: BatimentMetre[]; totaux: TotauxMetre; quartier: QuartierMetre | null;
}

// ── Validation ──────────────────────────────────────────────────────────────
const SOURCES: readonly string[] = ["mesure", "estime", "saisi"];
const ident = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length < 200;
function valeur(v: unknown, max = 10_000_000): ValeurMetre | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  return typeof o.valeur === "number" && Number.isFinite(o.valeur) && o.valeur >= 0 && o.valeur <= max && SOURCES.includes(o.source as string)
    ? { valeur: o.valeur, source: o.source as SourceValeur } : null;
}
function typologie(v: unknown): { valeurs: TypologieMetre; source: SourceValeur } | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>; const t = o.valeurs as Record<string, unknown> | undefined;
  if (!t || !SOURCES.includes(o.source as string)) return null;
  const out = { T1: 0, T2: 0, T3: 0, T4: 0, T5: 0 };
  for (const k of ["T1", "T2", "T3", "T4", "T5"] as const) {
    const x = t[k]; if (typeof x !== "number" || !Number.isInteger(x) || x < 0 || x > 100_000) return null; out[k] = x;
  }
  return { valeurs: out, source: o.source as SourceValeur };
}
const CHAMPS_BAT = ["niveaux", "niveauxHorsSol", "sousSols", "hauteurM", "empriseSolM2", "sdpM2", "surfaceUtileM2", "surfaceHabitableM2", "logements",
  "stationnement", "commerceM2", "bureauxM2", "facadeM2", "facadeNetteM2", "toitureM2", "balconsM2", "menuiseries"] as const;
const CHAMPS_TOT = ["niveauxMax", "empriseSolM2", "sdpM2", "surfaceHabitableM2", "logements", "stationnement", "commerceM2", "bureauxM2",
  "facadeM2", "facadeNetteM2", "toitureTerrasseM2", "toiturePenteM2", "balconsM2", "menuiseries"] as const;
const CHAMPS_QUARTIER = ["terrainM2", "voirieM2", "espacesVertsM2", "espacesPublicsM2", "cessibleM2", "empriseBatieM2", "sdpM2", "logements"] as const;

/** Valide un métré v2 ; null s'il est malformé (taille bornée, nombres finis, sources connues). */
export function lireMetreV2(v: unknown): MetreStudioV2 | null {
  try {
    if (!v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    if (o.format !== "mimmoza-metre" || o.version !== 2 || !ident(o.architectureId) || typeof o.nom !== "string" || o.nom.length > 200) return null;
    if (o.etudeId !== null && !ident(o.etudeId)) return null;
    if (o.projetMimmozaId !== null && !ident(o.projetMimmozaId)) return null;
    if (typeof o.revision !== "number" || !Number.isInteger(o.revision) || o.revision < 0) return null;
    if (typeof o.empreinte !== "string" || !/^[0-9a-f]{8}$/.test(o.empreinte)) return null;
    if (typeof o.emisLe !== "string" || !Number.isFinite(Date.parse(o.emisLe))) return null;
    if (!Array.isArray(o.batiments) || o.batiments.length > 50) return null;
    const batiments: BatimentMetre[] = [];
    for (const item of o.batiments) {
      if (!item || typeof item !== "object") return null;
      const b = item as Record<string, unknown>;
      if (!ident(b.id) || typeof b.nom !== "string" || b.nom.length > 200 || (b.typeToiture !== "terrasse" && b.typeToiture !== "pente")) return null;
      const row: Record<string, unknown> = { id: b.id, nom: b.nom, typeToiture: b.typeToiture };
      for (const k of CHAMPS_BAT) { const x = valeur(b[k]); if (!x) return null; row[k] = x; }
      const t = typologie(b.typologie); if (!t) return null; row.typologie = t;
      batiments.push(row as unknown as BatimentMetre);
    }
    const tt = o.totaux as Record<string, unknown> | undefined;
    if (!tt || typeof tt.nbBatiments !== "number") return null;
    const totaux: Record<string, unknown> = { nbBatiments: tt.nbBatiments, ces: tt.ces === null ? null : valeur(tt.ces, 100) };
    if (tt.ces !== null && !totaux.ces) return null;
    for (const k of CHAMPS_TOT) { const x = valeur(tt[k]); if (!x) return null; totaux[k] = x; }
    const t = typologie(tt.typologie); if (!t) return null; totaux.typologie = t;
    let quartier: QuartierMetre | null = null;
    if (o.quartier !== null && o.quartier !== undefined) {
      const q = o.quartier as Record<string, unknown>; const out: Record<string, unknown> = {};
      for (const k of CHAMPS_QUARTIER) { const x = valeur(q[k]); if (!x) return null; out[k] = x; }
      quartier = out as unknown as QuartierMetre;
    }
    const parcelleM2 = o.parcelleM2 === null || o.parcelleM2 === undefined ? null : valeur(o.parcelleM2);
    if (o.parcelleM2 && !parcelleM2) return null;
    if (batiments.length === 0 && !quartier) return null;
    return {
      format: "mimmoza-metre", version: 2, etudeId: o.etudeId as string | null, projetMimmozaId: o.projetMimmozaId as string | null,
      architectureId: o.architectureId, nom: o.nom, revision: o.revision, empreinte: o.empreinte, emisLe: o.emisLe,
      parcelleM2, batiments, totaux: totaux as unknown as TotauxMetre, quartier,
    };
  } catch { return null; }
}

/** Le métré concerne-t-il cette étude ? (étude portée par Studio, ou liaison explicite au modèle). */
export function metreConcerneEtude(m: MetreStudioV2, studyId: string | null, lien: { projectId: string; studyId: string } | null): boolean {
  if (!studyId) return false;
  if (m.etudeId) return m.etudeId === studyId;
  return !!lien && lien.studyId === studyId && lien.projectId === m.architectureId;
}

/** `a` est-il plus récent que `b` ? (horodatage d'émission, puis révision). */
export function plusRecent(a: MetreStudioV2, b: MetreStudioV2 | null): boolean {
  if (!b) return true;
  const ta = Date.parse(a.emisLe), tb = Date.parse(b.emisLe);
  return ta !== tb ? ta > tb : a.revision > b.revision;
}

// ── Projection vers le métré du Bilan ─────────────────────────────────────────
export function metreVersMassing(m: MetreStudioV2): MassingMetrics {
  const parBatiment: MassingMetrics["parBatiment"] = m.batiments.map((b) => ({
    id: b.id, name: b.nom,
    niveaux: b.niveauxHorsSol.valeur,
    empriseSolM2: b.empriseSolM2.valeur, sdpM2: b.sdpM2.valeur, shabM2: b.surfaceHabitableM2.valeur,
    surfaceFacadeM2: b.facadeM2.valeur, surfaceFacadeNetteM2: b.facadeNetteM2.valeur,
    roofType: b.typeToiture, surfaceToitureM2: b.toitureM2.valeur, surfaceBalconsM2: b.balconsM2.valeur,
    nbMenuiseries: b.menuiseries.valeur, nbLogements: b.logements.valeur,
  }));
  const t = m.totaux;
  const typo = t.typologie.valeurs;
  const typologie = { T1: typo.T1, T2: typo.T2, T3: typo.T3, T4: typo.T4, T5: typo.T5 };
  const terrain = m.parcelleM2?.valeur ?? (m.batiments.length === 0 ? m.quartier?.cessibleM2.valeur : undefined);
  return {
    parBatiment,
    totaux: {
      nbBatiments: t.nbBatiments, empriseSolM2: t.empriseSolM2.valeur, sdpM2: t.sdpM2.valeur,
      shabM2: m.batiments.length === 0 ? 0 : t.surfaceHabitableM2.valeur,
      surfaceFacadeM2: t.facadeM2.valeur, surfaceFacadeNetteM2: t.facadeNetteM2.valeur,
      surfaceToitureTerrasseM2: t.toitureTerrasseM2.valeur, surfaceToiturePenteM2: t.toiturePenteM2.valeur,
      surfaceBalconsM2: t.balconsM2.valeur, nbMenuiseries: t.menuiseries.valeur, nbLogements: t.logements.valeur,
    },
    typologie,
    ratios: {
      ...(terrain ? { terrainM2: terrain, densiteSdp: terrain > 0 ? t.sdpM2.valeur / terrain : undefined } : {}),
      ...(t.ces ? { cesEmprise: t.ces.valeur } : {}),
    },
  };
}

// ── Règle de priorité ─────────────────────────────────────────────────────────
export type SourceSurfaces = "rehab" | "massing" | "programmation" | "snap2d" | "emprise";

export interface EntreeSurfaces {
  rehabMode: boolean; surfaceRehabM2: number;
  sdpProgrammeM2: number;
  massing: MassingMetrics | null;
  footprintBuildingsM2Raw: number; footprintBuildingsM2: number; sdpFromSnap: number;
  niveauxSaisis: number;               // 1 + étages saisis sur la page
  logementsProgramme: number;          // > 0 si la Programmation les fixe
  logementsSaisis: number;             // état local de la page
}
export interface SurfacesRetenues {
  sdpSource: SourceSurfaces; sdpM2: number;
  logements: number; logementsSource: "modele" | "programmation" | "saisie";
  levelsCount: number; niveauxSource: "modele" | "saisie";
}

/** Typologie T1..T5 du métré → nombre de logements. */
export function logementsDuMassing(massing: MassingMetrics | null): number {
  if (!massing?.typologie) return 0;
  const t = massing.typologie as MassingMetrics["typologie"] & { T5?: number };
  const somme = Number(t.T1 ?? 0) + Number(t.T2 ?? 0) + Number(t.T3 ?? 0) + Number(t.T4 ?? 0) + Number(t.T5 ?? 0);
  return somme > 0 ? somme : Math.max(0, Number(massing.totaux.nbLogements ?? 0));
}

/**
 * LE MODÈLE FAIT FOI : réhabilitation > modèle 3D (Studio ou Massing 3D) >
 * Programmation > implantation 2D > emprise × niveaux. Même ordre pour les
 * logements et les niveaux. La Programmation reste l'objectif affiché (écart).
 */
export function resoudreSurfaces(e: EntreeSurfaces): SurfacesRetenues {
  const modele = !e.rehabMode && !!e.massing && e.massing.totaux.sdpM2 > 0;
  const niveauxModele = modele ? Math.max(0, ...e.massing!.parBatiment.map((b) => Math.round(b.niveaux))) : 0;
  const levelsCount = niveauxModele > 0 ? niveauxModele : e.niveauxSaisis;
  let sdpSource: SourceSurfaces; let sdpM2: number;
  if (e.rehabMode && e.surfaceRehabM2 > 0) { sdpSource = "rehab"; sdpM2 = e.surfaceRehabM2; }
  else if (modele) { sdpSource = "massing"; sdpM2 = e.massing!.totaux.sdpM2; }
  else if (e.sdpProgrammeM2 > 0) { sdpSource = "programmation"; sdpM2 = e.sdpProgrammeM2; }
  else if (e.footprintBuildingsM2Raw <= 0 && e.sdpFromSnap > 0) { sdpSource = "snap2d"; sdpM2 = e.sdpFromSnap; }
  else { sdpSource = "emprise"; sdpM2 = e.footprintBuildingsM2 * levelsCount; }
  const lgtModele = modele ? logementsDuMassing(e.massing) : 0;
  const logementsSource = lgtModele > 0 ? "modele" : e.logementsProgramme > 0 ? "programmation" : "saisie";
  const logements = lgtModele > 0 ? lgtModele : e.logementsProgramme > 0 ? e.logementsProgramme : e.logementsSaisis;
  return { sdpSource, sdpM2, logements, logementsSource, levelsCount, niveauxSource: niveauxModele > 0 ? "modele" : "saisie" };
}

// ── Écart programmation ↔ modèle ──────────────────────────────────────────────
export interface EcartProgrammation { notable: boolean; lignes: string[]; sdpPct: number | null; logementsDelta: number | null }

/** Écart signalé au-delà de `seuilPct` (10 % par défaut) ; ne modifie rien. */
export function ecartProgrammationModele(
  p: { sdpProgrammeM2: number; logementsProgramme: number },
  m: { sdpModeleM2: number; logementsModele: number },
  seuilPct = 10,
): EcartProgrammation {
  const lignes: string[] = [];
  let sdpPct: number | null = null; let logementsDelta: number | null = null;
  if (p.sdpProgrammeM2 > 0 && m.sdpModeleM2 > 0) {
    sdpPct = ((m.sdpModeleM2 - p.sdpProgrammeM2) / p.sdpProgrammeM2) * 100;
    if (Math.abs(sdpPct) > seuilPct) lignes.push(`Surface de plancher : programmation ${Math.round(p.sdpProgrammeM2)} m² · modèle ${Math.round(m.sdpModeleM2)} m² (${sdpPct > 0 ? "+" : ""}${sdpPct.toFixed(0)} %)`);
  }
  if (p.logementsProgramme > 0 && m.logementsModele > 0) {
    logementsDelta = m.logementsModele - p.logementsProgramme;
    if (Math.abs(logementsDelta) >= Math.max(1, Math.ceil(p.logementsProgramme * seuilPct / 100))) {
      lignes.push(`Logements : programmation ${p.logementsProgramme} · modèle ${m.logementsModele} (${logementsDelta > 0 ? "+" : ""}${logementsDelta})`);
    }
  }
  return { notable: lignes.length > 0, lignes, sdpPct, logementsDelta };
}

// ── Synthèse (moteur unique computeProForma) ──────────────────────────────────
export interface EntreeSynthese {
  ass: Assumptions; sdpM2: number; surfaceVendableM2: number; massing: MassingMetrics | null;
  regionFactor: number; levelsCount: number; parkingCost: number;
}
/** CA, coûts et marge exactement comme les affiche la page Bilan (terrassement en sus du pro forma). */
export function calculerSyntheseBilan(e: EntreeSynthese) {
  const pf = computeProForma(e.ass, e.sdpM2, e.surfaceVendableM2, e.massing, 1, e.regionFactor, e.levelsCount);
  const terr = Number.isFinite(e.ass.terrassementEur) ? e.ass.terrassementEur : 0;
  const coutTotal = pf.coutTotal + terr;
  const marge = pf.caTotal - coutTotal;
  return {
    pf, coutTotal, marge,
    margePct: pf.caTotal > 0 ? (marge / pf.caTotal) * 100 : 0,
    totalTravaux: pf.totalTravaux + terr + e.parkingCost,
  };
}

// ── Résumé renvoyé à Studio (mini-panneau) ────────────────────────────────────
export interface ResumeBilan {
  format: "mimmoza-bilan-resume"; version: 1;
  etudeId: string; architectureId: string | null; empreinteMetre: string | null; sourceSurfaces: string;
  caTotal: number; coutTotal: number; marge: number; margePct: number; sdpM2: number; logements: number;
  calculeLe: string; urlBilan: string;
}
