/**
 * INT-09b — Points d'eau SUPPOSÉS (« supposer, puis confirmer »).
 *
 * Les plans du Studio (générés ou lus) ne portent aucun point d'eau : sans lui, le solveur ne pose ni cuisine,
 * ni WC, ni sanitaires (spec `needsWater`). `supposerPointsEau` pose UNE gaine plausible dans chaque pièce
 * humide qui n'a aucun équipement d'eau, la marque `supposed: true` avec sa raison (français), et renvoie les
 * phrases d'hypothèse à afficher. L'utilisateur confirme ou déplace ensuite la gaine (UI = lot ultérieur).
 *
 * PUR et DÉTERMINISTE : aucune horloge, aucun hasard ; le plan d'entrée n'est jamais modifié et les équipements
 * existants ne sont JAMAIS déplacés (on ne fait qu'ajouter).
 *
 * Règles retenues (hypothèse Mimmoza, barème 2026 — `nature: hypothese_mimmoza`) :
 *  R1 Pièces concernées : rôle (déclaré ou déduit par analyzePlan) dans ROLES_HUMIDES de l'analyseur (cuisine,
 *     séjour-cuisine, salle de bains, salle d'eau, WC, buanderie) ET aucun équipement d'eau (gaine, arrivée,
 *     évacuation). Cas particulier « cellier » : un cellier au rôle DÉDUIT (non déclaré), aveugle, de moins de
 *     2,5 m², dans un logement sans aucune pièce WC, est traité comme un WC probable (sans point d'eau,
 *     l'analyseur ne peut pas distinguer un WC d'un placard ; avec la gaine, il le redéduit « wc »).
 *  R2 Une seule gaine par pièce, carré de 0,30 × 0,30 m (`size`), posée contre un mur, de préférence calée dans
 *     un angle intérieur de la pièce.
 *  R3 Choix du mur, par ordre de préférence :
 *     0. mur mitoyen d'une autre pièce humide (regroupement des réseaux, « noyau humide » de la promotion) ;
 *        à égalité, la position la plus proche d'un point d'eau déjà connu ou déjà supposé (dos à dos) ;
 *     1. mur mitoyen d'une circulation (entrée, dégagement) ou mur intérieur sans pièce voisine (palier) ;
 *     2. mur intérieur le plus long ;
 *     3. à défaut, mur de façade (ou mur inconnu).
 *     Séjour-cuisine : après la règle 0, la gaine va côté zone cuisine, c'est-à-dire sur le mur le plus ÉLOIGNÉ
 *     de l'entrée du séjour (portes vers une circulation ou le palier), façade comprise.
 *  R5 WC (rôle wc, ou cellier supposé WC) : la gaine est celle de chute, intégrée au coffrage du bâti-support
 *     derrière la cuvette, donc SANS emprise au sol (même convention que le banc INT-05b) ; elle est posée à
 *     0,10 m du mur latéral et 0,05 m du mur choisi par R3. Raison chiffrée : une gaine saillante de 0,30 m dans
 *     un WC de 1,00 m de large ne laisse que 0,70 m, moins que les 0,76 m d'une cuvette suspendue (0,36 m) et de
 *     ses dégagements latéraux (2 × 0,20 m) : aucun WC ne serait posable.
 *  R4 Interdits : aucune partie de la gaine dans un débattement de porte, ni à moins de 0,05 m d'une baie
 *     (fenêtre, porte-fenêtre, porte, baie libre) de la pièce, ni sur un équipement existant ; entièrement dans
 *     la pièce. Si aucune position ne convient, rien n'est posé et l'hypothèse le dit.
 *
 * Les mitoyennetés sont lues sur la géométrie : arête d'une autre pièce du même niveau, parallèle, de sens
 * opposé, à au plus 0,40 m (épaisseur de cloison ou de refend) et se recouvrant sur au moins 0,30 m.
 */
import type { AnalyzedRoom, Fixture, PlanAnalysis, PlanInput, RoomRole, Vec2, Wall } from '../types';
import { analyzePlan, EQUIPEMENTS_EAU, ROLES_HUMIDES, TOL_COLINEAIRE, ZONE_PAR_ROLE } from '../analyzer';
import { cross, dist, distPointSegment, dot, len, normalize, pointInPolygon, round, segmentsIntersect, sub } from '../geometry';

/** Côté de la gaine supposée (m). */
export const COTE_GAINE_SUPPOSEE = 0.3;
/** Garde minimale entre la gaine et une baie de la pièce (m). */
export const GARDE_BAIE = 0.05;
/** Écart maximal entre deux arêtes mitoyennes (épaisseur de mur) (m). */
export const ECART_MITOYEN_MAX = 0.4;
/** Pas de glissement de la gaine le long d'un mur quand l'angle est interdit (m). */
export const PAS_GLISSEMENT = 0.05;
/** WC : distance de la gaine (coffrage du bâti-support) au mur latéral, puis au mur de la cuvette (m). */
export const DECALAGE_WC_LATERAL = 0.1;
export const DECALAGE_WC_MUR = 0.05;
/** Surface sous laquelle un cellier déduit, aveugle, est supposé être un WC (m²). */
export const SURFACE_MAX_CELLIER_WC = 2.5;

export interface PointsEauSupposes {
  /** Plan d'entrée complété des gaines supposées (copie ; l'entrée n'est pas modifiée). */
  plan: PlanInput;
  /** Gaines ajoutées (supposed: true, reason renseignée). */
  supposes: Fixture[];
  /** Phrases d'hypothèse à reporter (une par gaine posée ou impossible à poser). */
  hypotheses: string[];
}

interface Candidat {
  rang: number;
  coin: number; // 0 = calée dans un angle intérieur, 1 = le long du mur
  secondaire: number; // plus petit = meilleur
  bout: number;
  arete: number;
  t: number;
  centre: Vec2;
  motif: string;
}

const f2 = (x: number) => round(x, 2).toFixed(2).replace('.', ',');
const r4 = (x: number) => round(x, 4) + 0;
const at = (o: Vec2, d: Vec2, t: number): Vec2 => [o[0] + d[0] * t, o[1] + d[1] * t];

/** Carré orienté (sens anti-horaire) de centre c, d'axes d (le long du mur) et n (vers l'intérieur). */
function carre(c: Vec2, d: Vec2, n: Vec2, h: number): Vec2[] {
  const p = (sd: number, sn: number): Vec2 => [c[0] + d[0] * h * sd + n[0] * h * sn, c[1] + d[1] * h * sd + n[1] * h * sn];
  return [p(-1, -1), p(1, -1), p(1, 1), p(-1, 1)];
}

function distanceSegmentPolygone(a: Vec2, b: Vec2, poly: Vec2[]): number {
  if (pointInPolygon(a, poly) || pointInPolygon(b, poly)) return 0;
  let m = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
    if (segmentsIntersect(a, b, p, q)) return 0;
    m = Math.min(m, distPointSegment(a, p, q), distPointSegment(b, p, q), distPointSegment(p, a, b), distPointSegment(q, a, b));
  }
  return m;
}

function polygonesSeRecoupent(A: Vec2[], B: Vec2[]): boolean {
  const centreA = A.reduce<Vec2>((s, p) => [s[0] + p[0] / A.length, s[1] + p[1] / A.length], [0, 0]);
  if (pointInPolygon(centreA, B)) return true;
  for (const p of B) if (pointInPolygon(p, A)) return true;
  for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) {
    if (segmentsIntersect(A[i]!, A[(i + 1) % A.length]!, B[j]!, B[(j + 1) % B.length]!)) return true;
  }
  return A.some((p) => pointInPolygon(p, B));
}

/** Murs collinéaires recouvrant l'arête : 'facade' si tous sont des façades, 'interieur' si l'un ne l'est pas, 'inconnu' sinon. */
function natureArete(p: Vec2, d: Vec2, L: number, walls: Wall[], level: number): 'facade' | 'interieur' | 'inconnu' {
  const proj = (x: Vec2) => dot(sub(x, p), d);
  const murs = walls.filter((w) => (w.level === undefined || w.level === level)
    && Math.abs(cross(normalize(sub(w.b, w.a)), d)) < 1e-6 && Math.abs(cross(sub(w.a, p), d)) <= TOL_COLINEAIRE
    && Math.min(L, Math.max(proj(w.a), proj(w.b))) - Math.max(0, Math.min(proj(w.a), proj(w.b))) > 1e-6);
  if (!murs.length) return 'inconnu';
  return murs.every((w) => w.exterior === true) ? 'facade' : 'interieur';
}

const nomPiece = (plan: PlanInput, id: string) => {
  const r = plan.rooms.find((x) => x.id === id);
  return r?.name ? `« ${r.name} » (${id})` : id;
};

/** Une position admissible de gaine pour une pièce (R1–R5 respectées), prête à être ajoutée au plan. */
export interface CandidatPointEau {
  /** Équipement à ajouter (supposed: true, reason renseignée). */
  fixture: Fixture;
  /** Phrase d'hypothèse correspondante. */
  hypothese: string;
  /** Rang dans l'ordre de préférence R3 d'origine (0 = choix de `supposerPointsEau`). */
  rangR3: number;
  /** Calée dans un angle intérieur. */
  coin: boolean;
}

export interface CandidatsPiece {
  roomId: string;
  /** Positions retenues pour l'évaluation (bornées, voir `candidatsPointsEau`) ; [0] = choix R3 d'origine. */
  candidats: CandidatPointEau[];
  /** Nombre total de positions admissibles (avant bornage). */
  admissibles: number;
}

export interface CandidatsPointsEau {
  /** Pièces humides sans point d'eau qui ont au moins une position admissible, dans l'ordre de l'analyse. */
  pieces: CandidatsPiece[];
  /** Hypothèses des pièces où aucune position n'est admissible (rien n'est posé). */
  impossibles: string[];
}

/** Bornage de l'évaluation des positions candidates (INT-09c). */
export const MAX_CANDIDATS_PIECE = 10;
/** Deux positions candidates retenues sont distantes d'au moins cette valeur (angles exceptés) (m). */
export const ECART_MIN_CANDIDATS = 0.4;
/** Deux angles retenus sont distants d'au moins cette valeur (m). */
export const ECART_MIN_ANGLES = 0.1;

interface PieceExploree { room: AnalyzedRoom; nom: string; valides: CandidatPointEau[] }

/** Parcours commun : toutes les positions VALIDES (R4) de chaque pièce concernée (R1), triées selon R3. */
function explorer(plan: PlanInput, analysis: PlanAnalysis | undefined): { pieces: PieceExploree[]; ordre: Array<{ roomId: string; nom: string; ok: boolean }> } {
  const an = analysis ?? analyzePlan(plan);
  const niveau = new Map(plan.rooms.map((r) => [r.id, r.level]));
  const aDeLEau = (roomId: string) => plan.fixtures.some((f) => f.roomId === roomId && EQUIPEMENTS_EAU.includes(f.kind));
  const sansWc = !an.rooms.some((r) => r.role === 'wc');

  const concernees: Array<{ room: AnalyzedRoom; roleSuppose: RoomRole; celWc: boolean }> = [];
  for (const room of an.rooms) {
    if (aDeLEau(room.id)) continue;
    if (ROLES_HUMIDES.includes(room.role)) { concernees.push({ room, roleSuppose: room.role, celWc: false }); continue; }
    if (room.role === 'cellier' && room.roleSource === 'deduit' && room.area < SURFACE_MAX_CELLIER_WC && room.windows.length === 0 && sansWc) {
      concernees.push({ room, roleSuppose: 'wc', celWc: true });
    }
  }
  const rolesHumides = new Map<string, boolean>(an.rooms.map((r) => [r.id, ROLES_HUMIDES.includes(r.role) || aDeLEau(r.id)]));
  for (const c of concernees) rolesHumides.set(c.room.id, true);

  // Points d'eau connus (existants puis supposés au fil de l'eau, choix R3) : sert au regroupement « dos à dos ».
  const pointsConnus: Vec2[] = plan.fixtures.filter((f) => EQUIPEMENTS_EAU.includes(f.kind)).map((f) => [f.position[0], f.position[1]]);
  const idsPris = new Set(plan.fixtures.map((f) => f.id));
  const pieces: PieceExploree[] = [];
  const ordre: Array<{ roomId: string; nom: string; ok: boolean }> = [];
  const h = COTE_GAINE_SUPPOSEE / 2;

  for (const { room, roleSuppose, celWc } of concernees) {
    const P = room.polygon;
    const lv = niveau.get(room.id) ?? 0;
    const voisines = an.rooms.filter((r) => r.id !== room.id && (niveau.get(r.id) ?? 0) === lv);
    const existants = plan.fixtures.filter((f) => f.roomId === room.id);
    const baies = [...room.windows.map((w) => ({ a: w.a, b: w.b })), ...room.doors.map((w) => ({ a: w.a, b: w.b }))];
    const entrees = room.doors.filter((d) => d.to === null || ZONE_PAR_ROLE[an.rooms.find((r) => r.id === d.to)?.role ?? 'degagement'] === 'circulation');
    const portesRef = (entrees.length ? entrees : room.doors).map((d) => [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2] as Vec2);
    const estSejourCuisine = roleSuppose === 'sejour_cuisine';

    const candidats: Candidat[] = [];
    for (let i = 0; i < P.length; i++) {
      const p = P[i]!, q = P[(i + 1) % P.length]!;
      const L = len(sub(q, p));
      if (L < COTE_GAINE_SUPPOSEE - 1e-9) continue;
      const d = normalize(sub(q, p)), n: Vec2 = [-d[1], d[0]];
      // Angles intérieurs convexes aux deux bouts de l'arête.
      const prev = P[(i - 1 + P.length) % P.length]!, next = P[(i + 2) % P.length]!;
      const coinDebut = cross(normalize(sub(p, prev)), d) > 1e-6;
      const coinFin = cross(d, normalize(sub(next, q))) > 1e-6;

      // Segments de l'arête : mitoyennetés, puis l'arête entière.
      const segments: Array<{ lo: number; hi: number; rang: number; motif: string }> = [];
      for (const v of voisines) {
        const Q = v.polygon;
        for (let j = 0; j < Q.length; j++) {
          const a = Q[j]!, b = Q[(j + 1) % Q.length]!;
          const dv = normalize(sub(b, a));
          if (Math.abs(cross(dv, d)) > 1e-6 || dot(dv, d) > 0) continue;
          const ecart = dot(sub(a, p), [-n[0], -n[1]]);
          if (ecart < -TOL_COLINEAIRE || ecart > ECART_MITOYEN_MAX) continue;
          const ta = dot(sub(a, p), d), tb = dot(sub(b, p), d);
          const lo = Math.max(0, Math.min(ta, tb)), hi = Math.min(L, Math.max(ta, tb));
          if (hi - lo < COTE_GAINE_SUPPOSEE - 1e-9) continue;
          if (rolesHumides.get(v.id)) segments.push({ lo, hi, rang: 0, motif: `mur mitoyen de la pièce humide ${nomPiece(plan, v.id)} (regroupement des réseaux)` });
          else if (!estSejourCuisine && ZONE_PAR_ROLE[v.role] === 'circulation') segments.push({ lo, hi, rang: 1, motif: `mur mitoyen de la circulation ${nomPiece(plan, v.id)}` });
        }
      }
      const nature = natureArete(p, d, L, plan.walls, lv);
      const aVoisin = segments.length > 0 || voisines.some((v) => v.polygon.some((x, j) => {
        const y = v.polygon[(j + 1) % v.polygon.length]!;
        const dv = normalize(sub(y, x));
        return Math.abs(cross(dv, d)) < 1e-6 && dot(dv, d) < 0 && Math.abs(dot(sub(x, p), n)) <= ECART_MITOYEN_MAX;
      }));
      if (estSejourCuisine) segments.push({ lo: 0, hi: L, rang: 1, motif: nature === 'facade' ? 'côté cuisine : mur de façade le plus éloigné de l\'entrée du séjour' : 'côté cuisine : mur le plus éloigné de l\'entrée du séjour' });
      else if (nature === 'interieur' && !aVoisin) segments.push({ lo: 0, hi: L, rang: 1, motif: 'mur intérieur sans pièce voisine (palier, parties communes)' });
      else if (nature === 'interieur') segments.push({ lo: 0, hi: L, rang: 2, motif: `mur intérieur le plus long disponible (${f2(L)} m)` });
      else segments.push({ lo: 0, hi: L, rang: 3, motif: nature === 'facade' ? 'à défaut, mur de façade' : 'à défaut, mur de nature inconnue' });

      for (const s of segments) {
        // Positions : les deux bouts exacts du segment (angles), puis glissement par pas de PAS_GLISSEMENT.
        const ts: number[] = [s.lo + h, s.hi - h];
        for (let k = 1; s.lo + h + k * PAS_GLISSEMENT < s.hi - h - 1e-9; k++) ts.push(s.lo + h + k * PAS_GLISSEMENT);
        for (const tt of ts) {
          if (tt > s.hi - h + 1e-9) continue;
          const centre = at(at(p, d, tt), n, h);
          const coin = (coinDebut && tt - h < 1e-6) || (coinFin && tt + h > L - 1e-6) ? 0 : 1;
          const bout = Math.min(tt - h - s.lo, s.hi - h - tt);
          let secondaire: number;
          if (s.rang === 0) secondaire = pointsConnus.length ? Math.min(...pointsConnus.map((x) => dist(x, centre))) : -(s.hi - s.lo);
          else if (estSejourCuisine) secondaire = portesRef.length ? -Math.min(...portesRef.map((x) => dist(x, centre))) : 0;
          else secondaire = -L;
          candidats.push({ rang: s.rang, coin, secondaire: round(secondaire, 6), bout: round(bout, 6), arete: i, t: round(tt, 6), centre, motif: s.motif });
        }
      }
    }
    candidats.sort((a, b) => a.rang - b.rang || a.coin - b.coin || a.secondaire - b.secondaire || a.bout - b.bout || a.arete - b.arete || a.t - b.t);

    const valide = (c: Candidat): boolean => {
      const p = P[c.arete]!, q = P[(c.arete + 1) % P.length]!;
      const d = normalize(sub(q, p)), n: Vec2 = [-d[1], d[0]];
      const sq = carre(c.centre, d, n, h);
      const retreci = carre(c.centre, d, n, h - 1e-3);
      if (!retreci.every((x) => pointInPolygon(x, P))) return false;
      if (room.swingZones.some((z) => polygonesSeRecoupent(retreci, z.polygon))) return false;
      if (baies.some((b) => distanceSegmentPolygone(b.a, b.b, sq) < GARDE_BAIE - 1e-9)) return false;
      for (const f of existants) {
        const fw = (f.size?.w ?? 0) / 2, fd = (f.size?.d ?? 0) / 2;
        const fp: Vec2[] = [[f.position[0] - fw, f.position[1] - fd], [f.position[0] + fw, f.position[1] - fd], [f.position[0] + fw, f.position[1] + fd], [f.position[0] - fw, f.position[1] + fd]];
        if (pointInPolygon(f.position, sq) || (f.size && polygonesSeRecoupent(retreci, fp))) return false;
      }
      return true;
    };
    const nom = nomPiece(plan, room.id);
    const valides = candidats.filter(valide);
    if (!valides.length) { ordre.push({ roomId: room.id, nom, ok: false }); continue; }
    let id = `eau-supposee-${room.id}`, k = 2;
    while (idsPris.has(id)) id = `eau-supposee-${room.id}-${k++}`;
    idsPris.add(id);
    const wc = roleSuppose === 'wc';
    const forme = wc ? 'gaine de chute intégrée au coffrage du bâti-support (non saillante, sans emprise au sol)' : 'gaine 0,30 × 0,30 m';
    const versCandidat = (choix: Candidat, rangR3: number): CandidatPointEau => {
      let position: Vec2 = [r4(choix.centre[0]), r4(choix.centre[1])];
      if (wc) {
        // R5 (WC) : gaine de chute intégrée au coffrage du bâti-support, sans emprise au sol, à 0,10 m du mur
        // latéral et 0,05 m du mur porteur de la cuvette (convention du banc INT-05b).
        const p = P[choix.arete]!, q = P[(choix.arete + 1) % P.length]!;
        const L = len(sub(q, p)), d = normalize(sub(q, p)), n: Vec2 = [-d[1], d[0]];
        const le = choix.t - h < 1e-6 ? DECALAGE_WC_LATERAL : choix.t + h > L - 1e-6 ? L - DECALAGE_WC_LATERAL : choix.t;
        const pt = at(at(p, d, le), n, DECALAGE_WC_MUR);
        position = [r4(pt[0]), r4(pt[1])];
      }
      const reason = `Hypothèse Mimmoza : ${forme} supposée${celWc ? ' (cellier aveugle de moins de 2,5 m² dans un logement sans WC : WC probable)' : ''}, ${choix.coin === 0 ? 'calée dans un angle intérieur' : 'le long du mur'}, ${choix.motif} ; hors débattement de porte et hors baie. À confirmer ou déplacer.`;
      const fixture: Fixture = { id, kind: 'gaine', roomId: room.id, position, ...(wc ? {} : { size: { w: COTE_GAINE_SUPPOSEE, d: COTE_GAINE_SUPPOSEE } }), supposed: true, reason };
      return { fixture, hypothese: `Point d'eau supposé dans ${nom} : ${forme} en (${f2(position[0])} ; ${f2(position[1])}) — ${choix.motif}. À confirmer.`, rangR3, coin: choix.coin === 0 };
    };
    const tous = valides.map(versCandidat);
    pieces.push({ room, nom, valides: tous });
    ordre.push({ roomId: room.id, nom, ok: true });
    pointsConnus.push(tous[0]!.fixture.position);
  }
  return { pieces, ordre };
}

const phraseImpossible = (nom: string) => `Point d'eau non supposé dans ${nom} : aucune position de gaine (0,30 × 0,30 m) hors débattement, baie et équipement existant — à renseigner.`;

/**
 * Pose une gaine supposée dans chaque pièce humide sans point d'eau (règles R1 à R5 ci-dessus) : pour chaque
 * pièce, la PREMIÈRE position admissible dans l'ordre de préférence R3. `analysis` : analyse du plan d'entrée
 * (recalculée si absente). Pour choisir la position selon le résultat de l'aménagement, voir `amenager`
 * (src/pipeline.ts) et `candidatsPointsEau`.
 */
export function supposerPointsEau(plan: PlanInput, analysis?: PlanAnalysis): PointsEauSupposes {
  const { pieces, ordre } = explorer(plan, analysis);
  const supposes: Fixture[] = [];
  const hypotheses: string[] = [];
  for (const o of ordre) {
    if (!o.ok) { hypotheses.push(phraseImpossible(o.nom)); continue; }
    const c = pieces.find((x) => x.room.id === o.roomId)!.valides[0]!;
    supposes.push(c.fixture);
    hypotheses.push(c.hypothese);
  }
  return { plan: { ...plan, fixtures: [...plan.fixtures, ...supposes] }, supposes, hypotheses };
}

/**
 * INT-09c — TOUTES les positions admissibles (R1 à R5 comme filtres, inchangées) de la gaine de chaque pièce
 * humide sans point d'eau, puis un sous-ensemble BORNÉ pour l'évaluation par `amenager` :
 *  1. le choix R3 d'origine (celui de `supposerPointsEau`) ;
 *  2. les positions calées dans un angle intérieur, dans l'ordre R3, distantes d'au moins ECART_MIN_ANGLES ;
 *  3. les autres positions, dans l'ordre R3, à au moins ECART_MIN_CANDIDATS de toutes celles déjà retenues ;
 * au plus MAX_CANDIDATS_PIECE positions par pièce. Le regroupement « dos à dos » (R3 règle 0) est calculé avec
 * les choix R3 des pièces précédentes. PUR et DÉTERMINISTE.
 */
export function candidatsPointsEau(plan: PlanInput, analysis?: PlanAnalysis, options: { max?: number } = {}): CandidatsPointsEau {
  const max = Math.max(1, options.max ?? MAX_CANDIDATS_PIECE);
  const { pieces, ordre } = explorer(plan, analysis);
  const out: CandidatsPiece[] = [];
  for (const pc of pieces) {
    const garde: CandidatPointEau[] = [pc.valides[0]!];
    const proche = (c: CandidatPointEau, e: number) => garde.some((g) => dist(g.fixture.position, c.fixture.position) < e - 1e-9);
    for (const c of pc.valides) { if (garde.length >= max) break; if (c.coin && !proche(c, ECART_MIN_ANGLES)) garde.push(c); }
    for (const c of pc.valides) { if (garde.length >= max) break; if (!garde.includes(c) && !proche(c, ECART_MIN_CANDIDATS)) garde.push(c); }
    out.push({ roomId: pc.room.id, candidats: garde, admissibles: pc.valides.length });
  }
  return { pieces: out, impossibles: ordre.filter((o) => !o.ok).map((o) => phraseImpossible(o.nom)) };
}
