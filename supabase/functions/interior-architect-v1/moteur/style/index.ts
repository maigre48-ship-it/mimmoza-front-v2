/**
 * LOT INT-07 — Direction artistique : feuille de style d'un logement et application aux placements.
 *
 * buildStyleSheet(brief, analysis) : choisit, pour le style et la gamme du brief, les revêtements de chaque pièce
 *   (sol continu dans toutes les pièces sèches, sol distinct en pièces humides, sol extérieur ; murs dominants,
 *   mur d'accent selon la gamme), l'essence unique du mobilier, le métal, la lumière, les finitions par catégorie.
 *
 * applyStyle(layout, styleSheet, seed) : remplit `Placement.finish` de CHAQUE placement. Pour chaque pièce, il
 *   cherche l'affectation des finitions (une par spec : deux chevets ou les chaises d'une table sont identiques)
 *   qui s'écarte le moins des préférences du style tout en respectant EXACTEMENT ce que le critique mesure :
 *   STY-01 (palette 60/30/10), STY-02 (essences), STY-03 (matériaux principaux), STY-04 (même matériau dominant
 *   dans les pièces de jour). Les paramètres sont lus dans src/data/rules.ts et la mesure est celle de
 *   src/critic/style-mesures.ts : une seule définition.
 *   Recherche exacte par coût croissant (coût = rang de l'option retenue dans la liste du style), départage par
 *   proximité aux parts 60/30/10 visées, puis par la graine (rng). Déterministe.
 */
import type { FurnitureCategory, FurnitureSpec, InteriorBrief, LayoutPlan, PlanAnalysis, Placement, PlacementFinish, RoomRole } from '../types';
import { RULES } from '../data/rules';
import { getSpec } from '../data/catalog';
import { rng } from '../geometry';
import { aireApparente, defautsPalette, hexRvb, materiauDominant, partsPalette, type BornesPalette } from '../critic/style-mesures';
import { STYLES } from './styles';
import type { OptionFinition, RoomStyle, StyleSheet } from './types';

export { STYLES, STYLE_IDS, getStyle } from './styles';
export { STUDIO_MATERIAL_IDS, isStudioMaterial } from './bibliotheque-studio';
export type * from './types';

// ───────────────────────────── Feuille de style ─────────────────────────────

/** Pièces humides (sol distinct). La cuisine fermée en fait partie ; la cuisine ouverte sur séjour garde le sol sec. */
export const ROLES_HUMIDES: RoomRole[] = ['salle_de_bain', 'salle_d_eau', 'wc', 'buanderie', 'cuisine', 'cellier'];
/** Pièces d'eau recevant la faïence murale (zones d'eau). */
const ROLES_FAIENCE: RoomRole[] = ['salle_de_bain', 'salle_d_eau'];

export const typeSol = (role: RoomRole): RoomStyle['typeSol'] =>
  role === 'exterieur' ? 'exterieur' : ROLES_HUMIDES.includes(role) ? 'humide' : 'sec';

export function buildStyleSheet(brief: InteriorBrief, analysis: PlanAnalysis): StyleSheet {
  const def = STYLES[brief.style];
  if (!def) throw new Error(`style inconnu : ${String(brief.style)}`);
  const v = def.gammes[brief.gamme];
  const assumptions: string[] = [
    `Style « ${def.nom} », gamme ${brief.gamme} : choix de direction artistique Mimmoza (hypothèse 2026), pas des références fabricant.`,
    'Sol continu dans toutes les pièces sèches (entrée, séjour, cuisine ouverte, chambres, dégagements) ; sol distinct dans les pièces humides (salle de bains, salle d\'eau, WC, buanderie, cuisine fermée, cellier).',
    'Équipements sanitaires et électroménager : blanc ou inox (notice descriptive du promoteur), hors palette décorative.',
  ];
  const rooms: RoomStyle[] = analysis.rooms.map((r) => {
    const t = typeSol(r.role);
    const sol = v.sols[t];
    const accent = t === 'sec' && v.murAccentRoles.includes(r.role) ? def.murs.accent
      : ROLES_FAIENCE.includes(r.role) ? def.murs.humide : null;
    return { roomId: r.id, role: r.role, typeSol: t, sol, murs: { dominante: def.murs.dominante, accent } };
  });
  const essencesSols = [...new Set(rooms.map((r) => r.sol.woodSpecies).filter((s): s is string => !!s))];
  const essencesAdmises = [def.bois.principale];
  for (const e of essencesSols) {
    if (essencesAdmises.includes(e)) continue;
    if (def.bois.compatibles.includes(e)) essencesAdmises.push(e);
    else assumptions.push(`Essence du sol (${e}) non déclarée compatible avec ${def.bois.principale}.`);
  }
  return {
    version: 1, styleId: def.id, nom: def.nom, gamme: brief.gamme, palette: def.palette, familles: def.familles,
    essencePrincipale: def.bois.principale, essencesAdmises, metal: def.metal, lumiereK: def.lumiereK,
    qualiteBois: v.qualiteBois, qualiteTextile: v.qualiteTextile, mobilier: def.mobilier, rooms,
    manques: def.manques, assumptions,
  };
}

// ───────────────────────────── Paramètres lus dans la base de règles ─────────────────────────────

interface ParamsStyle {
  palette: BornesPalette & { tol: number; minPlacements: number; exclues: Set<string> };
  materiauxMax: number;
  essencesMax: number;
  rolesJour: RoomRole[];
  excluesJour: Set<string>;
  excluesMateriaux: Set<string>;
}

function paramsStyle(): ParamsStyle {
  const p = (id: string) => RULES.find((r) => r.id === id)?.check.params ?? {};
  const num = (x: unknown, d: number) => (typeof x === 'number' ? x : d);
  const liste = (x: unknown) => new Set(Array.isArray(x) ? (x as string[]) : []);
  const p1 = p('STY-01');
  return {
    palette: {
      ...(typeof p1['dominantMin'] === 'number' ? { dominantMin: p1['dominantMin'] } : {}),
      ...(typeof p1['dominantMax'] === 'number' ? { dominantMax: p1['dominantMax'] } : {}),
      ...(typeof p1['secondaryMin'] === 'number' ? { secondaryMin: p1['secondaryMin'] } : {}),
      ...(typeof p1['secondaryMax'] === 'number' ? { secondaryMax: p1['secondaryMax'] } : {}),
      ...(typeof p1['accentMax'] === 'number' ? { accentMax: p1['accentMax'] } : {}),
      tol: num(p1['colorTolerance'], 0),
      minPlacements: num(p1['minPlacements'], 1),
      exclues: liste(p1['excludeCategories']),
    },
    materiauxMax: num(p('STY-03')['max'], Infinity),
    essencesMax: num(p('STY-02')['max'], Infinity),
    rolesJour: RULES.find((r) => r.id === 'STY-04')?.applicability.roles ?? [],
    excluesJour: liste(p('STY-04')['excludeCategories']),
    excluesMateriaux: liste(p('STY-03')['excludeCategories']),
  };
}

// ───────────────────────────── Recherche par pièce ─────────────────────────────

interface Groupe { cat: FurnitureCategory; options: OptionFinition[]; membres: Array<{ ordre: number; A: number }> }
interface Solution { choix: number[]; cout: number; penalite: number; ecart: number }

const COUT_MAX = 8;
const PLAFOND_ENUMERATION = 200_000;

function couleurDe(o: OptionFinition, sheet: StyleSheet): string {
  return o.color ?? sheet.palette[o.tier].hex;
}

/** Évalue une affectation : pénalité 0 = conforme aux règles STY telles que le critique les mesure. */
function evaluer(groupes: Groupe[], choix: number[], sheet: StyleSheet, P: ParamsStyle, cibleMateriau: string | null): { penalite: number; ecart: number } {
  let penalite = 0;
  // Entrées par placement, dans l'ordre du layout (comme le critique).
  const entrees: Array<{ ordre: number; A: number; cat: string; o: OptionFinition }> = [];
  groupes.forEach((g, i) => { for (const m of g.membres) entrees.push({ ordre: m.ordre, A: m.A, cat: g.cat, o: g.options[choix[i]!]! }); });
  entrees.sort((a, b) => a.ordre - b.ordre);
  // STY-03
  const mats = new Set(entrees.filter((e) => !P.excluesMateriaux.has(e.cat)).map((e) => e.o.material));
  if (mats.size > P.materiauxMax) penalite += 10 * (mats.size - P.materiauxMax);
  // STY-02 (une seule essence par construction ; contrôlé quand même)
  const nbEss = entrees.some((e) => e.o.material === 'bois') ? 1 : 0;
  if (nbEss > P.essencesMax) penalite += 10;
  // STY-04
  if (cibleMateriau !== null) {
    const dom = materiauDominant(entrees.map((e) => ({ material: e.o.material, A: e.A })), (i) => P.excluesJour.has(entrees[i]!.cat));
    if (dom !== cibleMateriau) penalite += 5;
  }
  // STY-01
  let ecart = 0;
  const colorees = entrees.filter((e) => !P.palette.exclues.has(e.cat))
    .map((e) => ({ ...e, hex: couleurDe(e.o, sheet) })).filter((e) => hexRvb(e.hex) !== null);
  if (colorees.length >= P.palette.minPlacements) {
    colorees.sort((a, b) => b.A - a.A || a.ordre - b.ordre);
    const parts = partsPalette(colorees.map((e) => ({ rvb: hexRvb(e.hex)!, hex: e.hex, A: e.A })), P.palette.tol);
    const defauts = defautsPalette(parts, P.palette, (x) => String(x));
    penalite += defauts.reduce((s, d) => s + Math.abs(d.m - d.e), 0) * 10 + defauts.length;
    ecart = Math.abs((parts[0]?.part ?? 0) - 0.6) + Math.abs((parts[1]?.part ?? 0) - 0.3) + Math.abs((parts[2]?.part ?? 0) - 0.1);
  }
  return { penalite, ecart };
}

/** Meilleure affectation d'une pièce (coût minimal parmi les conformes ; à défaut, pénalité minimale). */
function resoudrePiece(groupes: Groupe[], sheet: StyleSheet, P: ParamsStyle, cible: string | null, alea: () => number): Solution {
  const n = groupes.length;
  const maxRang = groupes.map((g) => g.options.length - 1);
  const resteMax: number[] = Array.from({ length: n + 1 }, () => 0);
  for (let i = n - 1; i >= 0; i--) resteMax[i] = resteMax[i + 1]! + maxRang[i]!;
  let meilleurDefaut: Solution | null = null;
  let compte = 0;
  const choix: number[] = Array.from({ length: n }, () => 0);
  const borne = Math.min(COUT_MAX, resteMax[0]!);
  for (let budget = 0; budget <= borne; budget++) {
    const conformes: Solution[] = [];
    const dfs = (i: number, reste: number) => {
      if (compte > PLAFOND_ENUMERATION) return;
      if (i === n) {
        if (reste !== 0) return;
        compte++;
        const ev = evaluer(groupes, choix, sheet, P, cible);
        const s: Solution = { choix: [...choix], cout: budget, penalite: ev.penalite, ecart: ev.ecart };
        if (ev.penalite === 0) conformes.push(s);
        else if (!meilleurDefaut || s.penalite < meilleurDefaut.penalite - 1e-12) meilleurDefaut = s;
        return;
      }
      if (reste > resteMax[i]!) return;
      for (let j = 0; j <= Math.min(maxRang[i]!, reste); j++) { choix[i] = j; dfs(i + 1, reste - j); }
      choix[i] = 0;
    };
    dfs(0, budget);
    if (conformes.length) {
      const best = Math.min(...conformes.map((s) => s.ecart));
      const ex = conformes.filter((s) => s.ecart <= best + 1e-9);
      return ex[Math.min(ex.length - 1, Math.floor(alea() * ex.length))]!;
    }
    if (compte > PLAFOND_ENUMERATION) break;
  }
  return meilleurDefaut ?? { choix: Array.from({ length: n }, () => 0), cout: 0, penalite: 0, ecart: 0 };
}

// ───────────────────────────── Application ─────────────────────────────

function grouper(placements: Array<{ p: Placement; s: FurnitureSpec; ordre: number }>, sheet: StyleSheet): Groupe[] {
  const parSpec = new Map<string, Groupe>();
  for (const { p, s, ordre } of placements) {
    const g = parSpec.get(p.specId) ?? { cat: s.category, options: sheet.mobilier[s.category], membres: [] };
    g.membres.push({ ordre, A: aireApparente(s) });
    parSpec.set(p.specId, g);
  }
  return [...parSpec.values()];
}

function finition(o: OptionFinition, sheet: StyleSheet): PlacementFinish {
  return { material: o.material, woodSpecies: o.material === 'bois' ? sheet.essencePrincipale : null, color: couleurDe(o, sheet), materialId: o.materialId };
}

export function applyStyle(layout: LayoutPlan, sheet: StyleSheet, seed: number, options: { spec?: (id: string) => FurnitureSpec | undefined } = {}): LayoutPlan {
  const spec = options.spec ?? getSpec;
  const P = paramsStyle();
  const alea = rng(seed);
  const roleDe = new Map(sheet.rooms.map((r) => [r.roomId, r.role]));
  const parPiece = new Map<string, Array<{ p: Placement; s: FurnitureSpec; ordre: number }>>();
  layout.placements.forEach((p, ordre) => {
    const s = spec(p.specId);
    if (!s) return;
    (parPiece.get(p.roomId) ?? parPiece.set(p.roomId, []).get(p.roomId)!).push({ p, s, ordre });
  });
  const pieces = [...parPiece.keys()];
  const groupesDe = new Map(pieces.map((id) => [id, grouper(parPiece.get(id)!, sheet)]));
  const solutions = new Map<string, Solution>();

  // Pièces de jour : un matériau dominant commun (STY-04), choisi pour minimiser le coût total.
  const jour = pieces.filter((id) => P.rolesJour.includes(roleDe.get(id) ?? 'degagement'));
  if (jour.length) {
    const candidats = [...new Set([...sheet.familles, ...jour.flatMap((id) => groupesDe.get(id)!.flatMap((g) => g.options.map((o) => o.material)))])];
    let meilleur: { m: string; total: number; sols: Map<string, Solution> } | null = null;
    for (const m of candidats) {
      const sols = new Map<string, Solution>();
      let total = 0;
      for (const id of jour) {
        const s = resoudrePiece(groupesDe.get(id)!, sheet, P, m, rng(seed + id.length));
        sols.set(id, s);
        total += s.penalite * 1000 + s.cout;
      }
      if (!meilleur || total < meilleur.total) meilleur = { m, total, sols };
    }
    // Résolution définitive avec l'aléa de la graine (départage), sur le matériau retenu.
    for (const id of jour) solutions.set(id, resoudrePiece(groupesDe.get(id)!, sheet, P, meilleur!.m, alea));
  }
  for (const id of pieces) if (!solutions.has(id)) solutions.set(id, resoudrePiece(groupesDe.get(id)!, sheet, P, null, alea));

  const finitionDe = new Map<number, PlacementFinish>();
  for (const id of pieces) {
    const gs = groupesDe.get(id)!, sol = solutions.get(id)!;
    gs.forEach((g, i) => {
      const f = finition(g.options[sol.choix[i]!]!, sheet);
      for (const m of g.membres) finitionDe.set(m.ordre, f);
    });
  }
  // Placement à spec inconnue : finition dominante neutre (rangement), pour qu'aucun placement ne reste sans finition.
  const neutre = finition(sheet.mobilier.commode[0]!, sheet);
  return {
    ...layout,
    placements: layout.placements.map((p, ordre) => ({ ...p, finish: { ...(finitionDe.get(ordre) ?? neutre) } })),
  };
}
