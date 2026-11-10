/**
 * LOT INT-04 — Programmateur.
 *
 * `buildProgram(analysis, brief)` traduit l'analyse du plan et le brief en un programme
 * d'aménagement par pièce (`RoomProgram[]`). PUR et DÉTERMINISTE : règles explicites ci-dessous,
 * aucun LLM, aucun hasard, aucune horloge. L'ordre de sortie suit `analysis.rooms`.
 *
 * ─────────────────────────── Règles appliquées (documentation) ───────────────────────────
 *
 * R1 — Fonctions par rôle (`requiredFunctions`) :
 *   entree → rangement_entree ; sejour → assise_salon, tv, repas ;
 *   cuisine / sejour_cuisine → cuisson, evier, froid, plan_de_travail, rangement_cuisine
 *     (+ lavage_vaisselle si T3 et plus ou cible famille ; + repas pour sejour_cuisine ; + repas pour une
 *     cuisine fermée de 10 m² et plus : coin repas) ;
 *   sejour_cuisine → + assise_salon, tv ;
 *   chambre / chambre_parentale → couchage (R2), rangement_vetements, chevet ;
 *   salle_de_bain → lavabo, bain (douche à la place du bain si PMR ; + douche si ≥ 6,5 m²) ;
 *   salle_d_eau → lavabo, douche ; WC intégré (toilette) si aucune pièce « wc » au même niveau ;
 *   wc → toilette ; cellier → rangement_general ; buanderie → rangement_general ; bureau → travail ;
 *   dressing → rangement_vetements ; degagement, exterieur → rien d'obligatoire.
 *   Studio (aucune chambre) : la pièce de vie reçoit le couchage double et le rangement de vêtements
 *   (si le catalogue n'a aucun meuble de vêtements admis dans ce rôle, il est programmé dans l'entrée).
 *
 * R2 — Couchages ≥ occupants, répartis :
 *   - chambre parentale = chambre_parentale déclarée, sinon la plus grande chambre ; lit double si ≥ 1 adulte
 *     (cible etudiant : un adulte par chambre, lit 90/120 + bureau, pas de chambre parentale) ;
 *   - adultes au-delà de 2 : une chambre chacun, lit 1 place ;
 *   - enfants : chambres du même niveau que la chambre parentale d'abord, puis les plus petites d'abord
 *     (la plus grande chambre restante est gardée en chambre d'amis / évolutive) ; lit 90. S'il y a plus
 *     d'enfants que de chambres, la dernière chambre enfant reçoit des lits superposés (gamme éco/standard)
 *     ou un second lit 90 ;
 *   - chambres restantes (amis / locataire) : lit double si ≥ 9 m², sinon lit 90 (toute chambre a un
 *     couchage, règle USA-07) ;
 *   - lit double : le plus grand de la gamme dont l'emprise ≤ 30 % de la pièce (ECH-05) et qui laisse
 *     0,60 m de chaque côté et au pied dans la boîte englobante ; replis = chaîne du catalogue ;
 *   - si les couchages restent < occupants : canapé convertible dans le séjour + note.
 *
 * R3 — Assises et table ≥ occupants (N = adultes + enfants) :
 *   canapé 2 places si N ≤ 2 (compact en gamme économique), 3 places si N = 3 (2 places + fauteuil en
 *   éco), puis fauteuils jusqu'à N ; table = plus petite table de la gamme dont le nombre de couverts
 *   ≥ N (≥ N + 1 pour la cible famille, sans dépasser N + 2, règle ECH-06) ; une chaise par couvert
 *   (obligatoires jusqu'à N, souhaitées au-delà). Meuble TV proportionné au canapé ; table basse
 *   souhaitée dont la largeur est 50–75 % de celle du canapé (ECH-02).
 *
 * R4 — Cible :
 *   investisseur_locatif : sobre (aucun décor, tapis ni luminaire d'appoint), rangement prioritaire
 *     (armoire un cran plus grande, commode souhaitée dans les chambres, bibliothèque souhaitée au séjour),
 *     chambres restantes meublées en lit double si ≥ 9 m² (attractivité locative) ;
 *   famille : rangements supplémentaires (commode souhaitée en chambre enfant, bibliothèque au séjour),
 *     table un cran plus grande, bureau « devoirs » obligatoire dans les chambres enfants ≥ 9 m² ;
 *   senior : dégagements larges → aucun tapis (risque de chute), pas de table basse, meubles d'entrée de
 *     faible profondeur, lit double avec accès des deux côtés ;
 *   etudiant : lit 1 place (120 si ≥ 9 m²), bureau obligatoire par chambre, table compacte ;
 *   couple / primo_accedant : programme de base.
 *
 * R5 — Gamme : seules les specs dont `gammes` contient `brief.gamme` sont retenues (items ET replis).
 * R6 — Télétravail : bureau dans la pièce « bureau » s'il y en a une ; sinon dans une chambre restante
 *   (amis) de 10 m² et plus ; sinon dans la chambre parentale si ≥ 11 m² ; sinon au séjour ; sinon dans une chambre.
 * R7 — PMR : douche 90 × 120 (zone accessible), WC avec espace latéral 0,80 m, aucun tapis, meubles
 *   d'entrée de faible profondeur, table basse supprimée.
 * R8 — imposed : chaque spec imposée est ajoutée (obligatoire) dans la première pièce admise par
 *   `allowedRoles` (en remplaçant un item de même catégorie s'il existe) ; hors gamme ou sans pièce admise
 *   → note explicite, jamais ajoutée. forbidden : jamais dans items ni replis ; si la spec retenue est
 *   interdite, on prend le premier repli autorisé, sinon note « fonction non couverte ».
 * R9 — Chaque item : priority, reason (français), fallbacks = fallbacksFor(id) + quelques alternatives
 *   équivalentes documentées (ALTERNATIVES), filtrés par rôle, gamme et forbidden.
 *
 * Ajouts INT-05b (convergence du banc, hypothèses Mimmoza documentées) :
 * R10 — Table du séjour : ses replis ne descendent jamais sous le nombre d'occupants (USA-13, bloquante).
 * R11 — Lave-linge : jamais dans une salle d'eau < SURFACE_BAIN_LAVE_LINGE_MIN (3,5 m²), ni, en PMR, dans une salle
 *   d'eau à WC intégré < SURFACE_BAIN_PMR_LAVE_LINGE (8 m², cercle Ø 1,50 m à préserver) : il va alors en cuisine.
 * R12 — Entrée de distribution (≥ 3 baies, ≤ LARGEUR_ENTREE_TRANSIT = 1,20 m de large) : rangement d'entrée souhaité
 *   seulement (le passage de 0,90 m de l'art. 11 prime), note explicative.
 * R13 — Séjour < SURFACE_SEJOUR_FAUTEUILS (24 m²) : fauteuils au-delà du premier seulement souhaités, note explicative.
 */
import type { AnalyzedRoom, FurnitureSpec, InteriorBrief, PlanAnalysis, ProgramItem, RoomProgram, RoomRole, UsageFunction } from '../types';
import { fallbacksFor, getSpec } from '../data/catalog';

// ───────────────────────────── Constantes documentées ─────────────────────────────

/** Surface à partir de laquelle une chambre restante reçoit un lit double (m²). */
export const SURFACE_LIT_DOUBLE_AMIS = 9;
/** Part maximale de la surface d'une chambre occupée par le lit (ECH-05). */
export const PART_MAX_LIT = 0.3;
/** Passage visé de chaque côté et au pied d'un lit double (m). */
export const PASSAGE_LIT = 0.6;
/** Surface d'une salle de bains à partir de laquelle on ajoute une douche en plus du bain (m²). */
export const SURFACE_SDB_DOUCHE = 6.5;
/** Surface minimale d'une salle d'eau / de bains avec WC intégré pour y loger le lave-linge (m²). */
export const SURFACE_BAIN_WC_LAVE_LINGE = 4.5;
/**
 * PMR (INT-05b) : surface minimale d'une salle d'eau / de bains accessible avec WC intégré pour y loger aussi le
 * lave-linge (m²). Douche 0,90 × 1,20 + WC à espace latéral 0,80 × 1,30 + vasque + cercle Ø 1,50 m hors débattement
 * occupent déjà ~7 m² (hypothèse Mimmoza) : en deçà, le lave-linge va en cuisine.
 */
export const SURFACE_BAIN_PMR_LAVE_LINGE = 8;
/**
 * INT-05b : surface minimale d'une salle d'eau SANS WC pour y loger le lave-linge (m²). Douche 0,80 × 0,80, vasque
 * et lave-linge top 0,40 avec leurs dégagements, la gaine d'angle et le débattement intérieur ne tiennent pas dans
 * ~3 m² (vérifié au centimètre sur la salle d'eau 1,40 × 2,20 du banc p03) : en deçà, lave-linge en cuisine.
 */
export const SURFACE_BAIN_LAVE_LINGE_MIN = 3.5;
/** INT-05b : surface de séjour sous laquelle les fauteuils au-delà du premier sont seulement souhaités (m²). */
export const SURFACE_SEJOUR_FAUTEUILS = 24;
/** INT-05b : largeur maximale d'une entrée « de distribution » (≥ 3 baies) dont le rangement n'est que souhaité (m). */
export const LARGEUR_ENTREE_TRANSIT = 1.2;
/** Surface d'une cuisine fermée à partir de laquelle on programme un coin repas (m²). */
export const SURFACE_CUISINE_REPAS = 10;
/** Surface d'une chambre enfant à partir de laquelle un bureau « devoirs » est obligatoire (famille). */
export const SURFACE_BUREAU_ENFANT = 9;
/** Surface minimale d'une chambre restante pour y installer le poste de télétravail (m²). */
export const SURFACE_CHAMBRE_TELETRAVAIL = 10;

/** Alternatives équivalentes (hors chaînes de repli du catalogue), documentées. */
export const ALTERNATIVES: Record<string, string[]> = {
  wc_pmr_espace_droite: ['wc_pmr_espace_gauche'],
  wc_pmr_espace_gauche: ['wc_pmr_espace_droite'],
  wc_suspendu: ['wc_pose'],
  armoire_coulissante_160: ['armoire_2p', 'armoire_1p'],
  armoire_coulissante_200: ['armoire_coulissante_160', 'armoire_2p', 'armoire_1p'],
  armoire_1p: ['commode_80'],
  vestiaire_100: ['console_90'],
  meuble_chaussures_80: ['console_90'],
  lit_90x200: ['lit_90x190'],
  /** Dernier lit double : à défaut, un lit 1 place ½ puis 1 place (perte de dormir_double signalée par le solveur). */
  lit_140x190: ['lit_120x190', 'lit_90x200', 'lit_90x190'],
  chevet_45: ['chevet_40'],
  canape_compact_2p: ['fauteuil_standard'],
  table_2_couverts: ['table_ronde_4'],
  table_4_couverts: ['table_ronde_4', 'table_2_couverts'],
  etagere_rangement_90: ['etagere_basse_160'],
  frigo_combine_60: ['frigo_table_top'],
};

const CHAMBRES: RoomRole[] = ['chambre', 'chambre_parentale'];
const SEJOURS: RoomRole[] = ['sejour', 'sejour_cuisine'];
const CUISINES: RoomRole[] = ['cuisine', 'sejour_cuisine'];
const BAINS: RoomRole[] = ['salle_de_bain', 'salle_d_eau'];

type Couchage = { kind: 'double' | 'simple' | 'superpose' | 'deux_simples'; qui: string };

interface Ctx {
  brief: InteriorBrief;
  analysis: PlanAnalysis;
  N: number;
  sobre: boolean;
  forbidden: Set<string>;
}

// ───────────────────────────── Sélection de specs ─────────────────────────────

const admise = (ctx: Ctx, s: FurnitureSpec | undefined, role: RoomRole): s is FurnitureSpec =>
  !!s && s.allowedRoles.includes(role) && s.gammes.includes(ctx.brief.gamme) && !ctx.forbidden.has(s.id);

function replis(ctx: Ctx, id: string, role: RoomRole): string[] {
  const out: string[] = [];
  const s0 = getSpec(id);
  // INT-05b : la table du séjour ne se replie jamais sous le nombre d'occupants (USA-13, bloquante).
  const minCouverts = s0?.category === 'table_repas' && SEJOURS.includes(role) ? Math.min(ctx.N, s0.seats ?? 0) : 0;
  for (const f of [...fallbacksFor(id), ...(ALTERNATIVES[id] ?? [])]) {
    if (f === id || out.includes(f)) continue;
    const sf = getSpec(f);
    if (admise(ctx, sf, role) && (sf.seats ?? 0) >= minCouverts) out.push(f);
  }
  return out;
}

/** Première spec admise d'une liste de préférences ; à défaut, premier repli admis de la première préférence. */
function choisir(ctx: Ctx, role: RoomRole, prefs: string[]): string | null {
  for (const id of prefs) if (admise(ctx, getSpec(id), role)) return id;
  for (const id of prefs) { const r = replis(ctx, id, role); if (r.length) return r[0]!; }
  return null;
}

class Prog {
  items: ProgramItem[] = [];
  notes: string[] = [];
  required: UsageFunction[] = [];
  constructor(public room: AnalyzedRoom, private ctx: Ctx) {}
  exige(...fs: UsageFunction[]) { for (const f of fs) if (!this.required.includes(f)) this.required.push(f); }
  /** Ajoute la première spec admise de `prefs` ; renvoie l'id retenu (ou null + note). */
  ajoute(prefs: string[], priority: ProgramItem['priority'], reason: string, fonction?: UsageFunction): string | null {
    const id = choisir(this.ctx, this.room.role, prefs);
    if (!id) {
      const quoi = fonction ? `la fonction « ${fonction} »` : `l'élément (${prefs.join(', ')})`;
      this.notes.push(`Aucun meuble admis (rôle ${this.room.role}, gamme ${this.ctx.brief.gamme}, hors interdits) pour ${quoi} : non programmé.`);
      return null;
    }
    this.items.push({ specId: id, priority, reason, fallbacks: replis(this.ctx, id, this.room.role) });
    return id;
  }
}

const spec = (id: string) => getSpec(id)!;
const dims = (r: AnalyzedRoom) => {
  const w = r.bbox.max[0] - r.bbox.min[0], h = r.bbox.max[1] - r.bbox.min[1];
  return { long: Math.max(w, h), court: Math.min(w, h) };
};
/**
 * Plus long pan de mur utilisable pour un meuble bas : wallRuns colinéaires fusionnés à travers les fenêtres
 * dont l'allège (connue) est ≥ 0,90 m (hauteur d'un plan de travail) — une cuisine peut passer sous une fenêtre haute.
 */
function runMax(r: AnalyzedRoom): number {
  type S = { key: string; lo: number; hi: number };
  const segs: S[] = [];
  const add = (a: AnalyzedRoom['wallRuns'][number]['a'], b: AnalyzedRoom['wallRuns'][number]['b']) => {
    if (Math.abs(a[0] - b[0]) < 1e-6) segs.push({ key: `x${a[0].toFixed(3)}`, lo: Math.min(a[1], b[1]), hi: Math.max(a[1], b[1]) });
    else if (Math.abs(a[1] - b[1]) < 1e-6) segs.push({ key: `y${a[1].toFixed(3)}`, lo: Math.min(a[0], b[0]), hi: Math.max(a[0], b[0]) });
  };
  for (const w of r.wallRuns) add(w.a, w.b);
  for (const w of r.windows) if (w.sillHeight !== null && w.sillHeight >= 0.9) add(w.a, w.b);
  segs.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.lo - b.lo));
  let best = 0, cur: S | null = null;
  for (const sg of segs) {
    if (cur && cur.key === sg.key && sg.lo <= cur.hi + 1e-3) cur.hi = Math.max(cur.hi, sg.hi);
    else cur = { ...sg };
    best = Math.max(best, cur.hi - cur.lo);
  }
  return best;
}
const fr = (x: number, d = 2) => x.toFixed(d).replace('.', ',');

/** Lit double le plus grand compatible avec la pièce (ECH-05 + passages). */
function litDouble(ctx: Ctx, r: AnalyzedRoom): string[] {
  const base = ['lit_180x200', 'lit_160x200', 'lit_140x200', 'lit_140x190'];
  const prefs = ctx.brief.target === 'investisseur_locatif' ? ['lit_140x200', 'lit_140x190'] : base;
  const { long, court } = dims(r);
  const ok = prefs.filter((id) => {
    const s = spec(id);
    const tient = (a: number, b: number) => s.size.w + 2 * PASSAGE_LIT <= a + 1e-9 && s.size.d + PASSAGE_LIT <= b + 1e-9;
    return s.size.w * s.size.d <= PART_MAX_LIT * r.area + 1e-9 && (tient(long, court) || tient(court, long));
  });
  return ok.length ? ok : ['lit_140x190'];
}

function litSimple(ctx: Ctx, r: AnalyzedRoom, etudiant = false): string[] {
  if (etudiant && r.area >= SURFACE_LIT_DOUBLE_AMIS) return ['lit_120x190', 'lit_90x200', 'lit_90x190'];
  return ctx.brief.gamme === 'economique' ? ['lit_90x190'] : ['lit_90x200', 'lit_90x190'];
}

// ───────────────────────────── Programme ─────────────────────────────

export function buildProgram(analysis: PlanAnalysis, brief: InteriorBrief): RoomProgram[] {
  const N = brief.occupants.adults + brief.occupants.children;
  const ctx: Ctx = {
    brief, analysis, N,
    sobre: brief.target === 'investisseur_locatif',
    forbidden: new Set(brief.forbidden),
  };
  const t = brief.target, g = brief.gamme, pmr = brief.constraints.pmr;
  const senior = t === 'senior';
  const sansTapis = ctx.sobre || senior || pmr;
  const rooms = analysis.rooms;
  const comp = composantes(analysis);
  const levelOf = (r: AnalyzedRoom) => comp.get(r.id) ?? r.id;
  const progs = new Map<string, Prog>(rooms.map((r) => [r.id, new Prog(r, ctx)]));
  const P = (r: AnalyzedRoom) => progs.get(r.id)!;

  const avecLV = rooms.filter((r) => CHAMBRES.includes(r.role)).length >= 2 || t === 'famille';

  // ── R2 : répartition des couchages ──
  const chambres = rooms.filter((r) => CHAMBRES.includes(r.role));
  const parSurface = (a: AnalyzedRoom, b: AnalyzedRoom) => b.area - a.area || (a.id < b.id ? -1 : 1);
  const couchages = new Map<string, Couchage[]>();
  const addC = (r: AnalyzedRoom, c: Couchage) => (couchages.get(r.id) ?? couchages.set(r.id, []).get(r.id)!).push(c);
  const libres = [...chambres];
  const prendre = (r: AnalyzedRoom) => { libres.splice(libres.indexOf(r), 1); return r; };
  let adultes = brief.occupants.adults, enfants = brief.occupants.children;
  let parentale: AnalyzedRoom | undefined;
  const enfantsRooms: AnalyzedRoom[] = [];
  if (t === 'etudiant') {
    for (const r of [...libres].sort(parSurface)) { if (adultes <= 0) break; prendre(r); addC(r, { kind: 'simple', qui: 'étudiant' }); adultes--; }
  } else if (adultes > 0 && libres.length) {
    parentale = libres.find((r) => r.role === 'chambre_parentale') ?? [...libres].sort(parSurface)[0]!;
    prendre(parentale);
    addC(parentale, { kind: 'double', qui: adultes >= 2 ? 'couple' : 'adulte' });
    adultes -= Math.min(2, adultes);
    for (const r of [...libres].sort(parSurface)) { if (adultes <= 0) break; prendre(r); addC(r, { kind: 'simple', qui: 'adulte supplémentaire' }); adultes--; }
  }
  if (enfants > 0) {
    const niv = parentale ? levelOf(parentale) : null;
    const ordre = [...libres].sort((a, b) => (Number(levelOf(a) !== niv) - Number(levelOf(b) !== niv)) || a.area - b.area || (a.id < b.id ? -1 : 1));
    for (const r of ordre) { if (enfants <= 0) break; prendre(r); enfantsRooms.push(r); addC(r, { kind: 'simple', qui: 'enfant' }); enfants--; }
    if (enfants > 0 && enfantsRooms.length) {
      const der = enfantsRooms[enfantsRooms.length - 1]!;
      const c = couchages.get(der.id)!;
      c[0] = { kind: g === 'premium' ? 'deux_simples' : 'superpose', qui: 'enfants (chambre partagée)' };
      P(der).notes.push(`Plus d'enfants que de chambres : chambre partagée (${g === 'premium' ? 'deux lits 90' : 'lits superposés'}).`);
      enfants -= 1;
    }
  }
  const amis: AnalyzedRoom[] = [];
  for (const r of libres) {
    amis.push(r);
    addC(r, { kind: r.area >= SURFACE_LIT_DOUBLE_AMIS ? 'double' : 'simple', qui: ctx.sobre ? 'locataire' : "chambre d'amis / évolutive" });
  }

  // ── R6 : télétravail ──
  let posteTeletravail: AnalyzedRoom | undefined;
  if (brief.constraints.teletravail || t === 'etudiant') {
    posteTeletravail = rooms.find((r) => r.role === 'bureau')
      ?? amis.find((r) => r.area >= SURFACE_CHAMBRE_TELETRAVAIL)
      ?? (parentale && parentale.area >= 11 ? parentale : undefined)
      ?? rooms.find((r) => SEJOURS.includes(r.role))
      ?? chambres[0];
  }

  const wcParNiveau = new Set(rooms.filter((r) => r.role === 'wc').map(levelOf));

  // ── Lave-linge : buanderie > salle de bains > salle d'eau (plus grande d'abord) > cuisine ──
  const candLL = [
    ...rooms.filter((r) => r.role === 'buanderie'),
    ...rooms.filter((r) => r.role === 'salle_de_bain').sort(parSurface),
    ...rooms.filter((r) => r.role === 'salle_d_eau').sort(parSurface),
  ].filter((r) => !(BAINS.includes(r.role) && (r.area < SURFACE_BAIN_LAVE_LINGE_MIN
    || (!wcParNiveau.has(levelOf(r)) && r.area < (brief.constraints.pmr ? SURFACE_BAIN_PMR_LAVE_LINGE : SURFACE_BAIN_WC_LAVE_LINGE)))));
  const pieceLL = candLL[0] ?? rooms.find((r) => CUISINES.includes(r.role) && r.hasWater);

  const studio = chambres.length === 0;
  const piecePrincipale = rooms.filter((r) => SEJOURS.includes(r.role)).sort(parSurface)[0];
  let couchagesTotal = 0;

  for (const r of rooms) {
    const p = P(r);
    switch (r.role) {
      case 'entree': {
        p.exige('rangement_entree');
        const petite = r.area < 3.5 || senior || pmr;
        // INT-05b : entrée de distribution (≥ 3 baies) de 1,20 m de large au plus : un meuble de 0,30 m ramènerait le
        // passage sous les 0,90 m de l'art. 11 (CIR-01) devant une baie → rangement souhaité (placard à prévoir sinon).
        const transit = r.doors.length >= 3 && dims(r).court <= LARGEUR_ENTREE_TRANSIT + 1e-9;
        p.ajoute(petite ? ['meuble_chaussures_80', 'console_90'] : ['vestiaire_100'], transit ? 'souhaite' : 'obligatoire',
          transit ? `Entrée de distribution de ${fr(dims(r).court)} m de large desservant ${r.doors.length} baies : rangement d'entrée souhaité seulement (passage de 0,90 m prioritaire, sinon placard à prévoir).`
            : petite ? 'Rangement d\'entrée de faible profondeur (0,30 m) : entrée exiguë ou dégagement large recherché.' : 'Rangement d\'entrée (vestiaire) : manteaux et chaussures dès la porte.', 'rangement_entree');
        if (transit) p.notes.push(`rangement_entree : entrée de distribution (${r.doors.length} baies, ${fr(dims(r).court)} m de large) — meuble seulement souhaité, le passage de 0,90 m (art. 11) prime ; à défaut, placard à prévoir.`);
        if (ctx.sobre && !petite) p.ajoute(['banc_entree_100'], 'souhaite', 'Investisseur : rangement prioritaire (banc à chaussures).');
        if (!sansTapis) p.ajoute(['tapis_entree_60x90'], 'optionnel', 'Décoration : tapis d\'entrée.');
        break;
      }
      case 'sejour': case 'sejour_cuisine': {
        p.exige('assise_salon', 'tv', 'repas');
        if (r.role === 'sejour_cuisine') {
          p.exige('cuisson', 'evier', 'froid', 'plan_de_travail', 'rangement_cuisine');
          if (avecLV) p.exige('lavage_vaisselle');
          programmeCuisine(ctx, p, r, avecLV);
        }
        const sejourPrincipal = r === piecePrincipale;
        if (studio && sejourPrincipal) {
          p.exige(t === 'etudiant' ? 'dormir' : 'dormir_double', 'rangement_vetements');
          const id = p.ajoute(['canape_convertible_2p'], 'obligatoire', 'Studio sans chambre : canapé convertible (assise le jour, couchage double 140 × 190 la nuit).', 'dormir_double');
          if (id) couchagesTotal += spec(id).sleeps ?? 0;
          programmeAssises(ctx, p, 2);
          const vet = p.ajoute(['commode_120', 'commode_80'], 'obligatoire', 'Studio : rangement de vêtements dans la pièce de vie.', 'rangement_vetements');
          if (!vet) {
            p.notes.pop();
            const ent = rooms.find((x) => x.role === 'entree');
            if (ent) {
              P(ent).ajoute(['armoire_2p', 'armoire_1p'], 'obligatoire', 'Studio : le rangement de vêtements de la pièce de vie est reporté dans l\'entrée (aucun meuble de vêtements admis dans un séjour-cuisine au catalogue).');
              p.notes.push('rangement_vetements : aucun meuble admis en séjour-cuisine dans le catalogue ; armoire programmée dans l\'entrée adjacente.');
            } else p.notes.push('rangement_vetements : aucun meuble admis dans cette pièce et aucune entrée : fonction non couverte.');
          }
        } else if (sejourPrincipal || r.role === 'sejour') {
          programmeAssises(ctx, p, 0);
        }
        // Repas
        const cible = t === 'famille' ? Math.min(N + 1, N + 2) : N;
        const tables = ['table_2_couverts', 'table_4_couverts', 'table_6_couverts', 'table_8_couverts']
          .filter((id) => (spec(id).seats ?? 0) >= (t === 'etudiant' ? Math.min(N, 2) : cible));
        const table = p.ajoute(tables.length ? tables : ['table_8_couverts'], 'obligatoire',
          `Repas : table d'au moins ${cible} couverts pour ${N} occupant(s)${t === 'famille' ? ' (famille : une place d\'invité)' : ''}.`, 'repas');
        if (table) programmeChaises(ctx, p, spec(table).seats ?? 2);
        // TV + table basse
        const canape = p.items.find((i) => spec(i.specId).category === 'canape');
        const wc = canape ? spec(canape.specId).size.w : 1.6;
        p.ajoute(wc >= 2 ? ['meuble_tv_160', 'meuble_tv_120'] : ['meuble_tv_120'], 'obligatoire', 'TV face au canapé, meuble proportionné à la largeur du canapé.', 'tv');
        if (!senior && !pmr) {
          const tb = ['table_basse_120', 'table_basse_100', 'table_basse_70'].filter((id) => { const k = spec(id).size.w / wc; return k >= 0.5 && k <= 0.75; });
          if (tb.length) p.ajoute(tb, 'souhaite', `Table basse devant le canapé, 50 à 75 % de sa largeur (${fr(wc)} m).`);
        }
        if (ctx.sobre || t === 'famille') p.ajoute(['bibliotheque_80', 'etagere_basse_160'], 'souhaite', ctx.sobre ? 'Investisseur : rangement prioritaire au séjour.' : 'Famille : rangement supplémentaire au séjour.');
        if (!ctx.sobre && g !== 'economique') p.ajoute(['lampadaire'], 'optionnel', 'Éclairage d\'appoint près du canapé.');
        if (!sansTapis) p.ajoute(['tapis_160x230', 'tapis_120x170'], 'optionnel', 'Tapis délimitant le coin salon.');
        if (!ctx.sobre) p.ajoute(['plante_moyenne'], 'optionnel', 'Décoration végétale.');
        break;
      }
      case 'cuisine': {
        p.exige('cuisson', 'evier', 'froid', 'plan_de_travail', 'rangement_cuisine');
        if (avecLV) p.exige('lavage_vaisselle');
        programmeCuisine(ctx, p, r, avecLV);
        if (r.area >= SURFACE_CUISINE_REPAS) {
          p.exige('repas');
          const tab = p.ajoute(r.area >= 12 ? ['table_4_couverts', 'table_2_couverts'] : ['table_2_couverts'], 'obligatoire', `Cuisine fermée de ${fr(r.area, 1)} m² : coin repas du quotidien.`, 'repas');
          if (tab) programmeChaises(ctx, p, Math.min(spec(tab).seats ?? 2, Math.max(2, N)));
        }
        break;
      }
      case 'chambre': case 'chambre_parentale': {
        const cs = couchages.get(r.id) ?? [];
        p.exige('rangement_vetements', 'chevet');
        let double = false;
        for (const c of cs) {
          if (c.kind === 'double') {
            p.exige('dormir', 'dormir_double'); double = true;
            const id = p.ajoute(litDouble(ctx, r), 'obligatoire',
              `Couchage double (${c.qui}) : plus grand lit de la gamme occupant ≤ ${PART_MAX_LIT * 100} % des ${fr(r.area, 1)} m² avec ${fr(PASSAGE_LIT)} m de passage de chaque côté.`, 'dormir_double');
            if (id) couchagesTotal += 2;
          } else if (c.kind === 'superpose') {
            p.exige('dormir');
            const id = p.ajoute(['lit_superpose_90x190', 'lit_90x190'], 'obligatoire', `Couchage ${c.qui} : lits superposés.`, 'dormir');
            if (id) couchagesTotal += spec(id).sleeps ?? 1;
          } else if (c.kind === 'deux_simples') {
            p.exige('dormir');
            for (let k = 0; k < 2; k++) if (p.ajoute(litSimple(ctx, r), 'obligatoire', `Couchage ${c.qui} : lit 90 n° ${k + 1}.`, 'dormir')) couchagesTotal += 1;
          } else {
            p.exige('dormir');
            const id = p.ajoute(litSimple(ctx, r, t === 'etudiant'), 'obligatoire', `Couchage 1 place (${c.qui}).`, 'dormir');
            if (id) couchagesTotal += 1;
          }
        }
        // Chevets : deux pour un lit double, un pour un lit simple
        const chev = g === 'economique' ? ['chevet_40'] : ['chevet_45', 'chevet_40'];
        p.ajoute(chev, 'obligatoire', double ? 'Chevet côté gauche du lit double.' : 'Chevet à côté du lit.', 'chevet');
        if (double) p.ajoute(chev, 'souhaite', 'Second chevet : chacun son côté de lit.');
        // Rangement de vêtements (sauf dressing adjacent)
        const dressing = analysis.adjacency.some((a) => (a.a === r.id || a.b === r.id) && rooms.find((x) => x.id === (a.a === r.id ? a.b : a.a))?.role === 'dressing');
        if (dressing) p.notes.push('Dressing adjacent : il assure le rangement de vêtements (règle ORG-03).');
        else {
          const grand = double || ctx.sobre;
          const prefs = g === 'premium' && double ? ['armoire_coulissante_200', 'armoire_coulissante_160', 'armoire_3p']
            : grand ? (r.area >= 10 ? ['armoire_3p', 'armoire_2p'] : ['armoire_2p', 'armoire_1p']) : ['armoire_2p', 'armoire_1p'];
          p.ajoute(prefs, 'obligatoire', ctx.sobre ? 'Investisseur : rangement prioritaire, armoire la plus large compatible.' : 'Rangement de vêtements (armoire).', 'rangement_vetements');
        }
        const estEnfant = enfantsRooms.includes(r);
        if ((ctx.sobre && r.area >= 9) || (t === 'famille' && estEnfant)) p.ajoute(['commode_80'], 'souhaite', ctx.sobre ? 'Investisseur : rangement complémentaire (commode).' : 'Famille : commode pour les affaires de l\'enfant.');
        if (t === 'famille' && estEnfant && r.area >= SURFACE_BUREAU_ENFANT) {
          p.exige('travail');
          const id = p.ajoute(g === 'economique' ? ['bureau_080'] : ['bureau_100', 'bureau_080'], 'obligatoire', `Chambre enfant de ${fr(r.area, 1)} m² : bureau « devoirs ».`, 'travail');
          if (id) p.ajoute(['chaise_bureau_compacte', 'chaise_bureau_standard'], 'obligatoire', 'Chaise du bureau.');
        }
        if (t === 'etudiant' && !p.items.some((i) => spec(i.specId).category === 'bureau')) {
          p.exige('travail');
          if (p.ajoute(['bureau_100', 'bureau_080'], 'obligatoire', 'Étudiant : poste de travail dans la chambre.', 'travail')) p.ajoute(['chaise_bureau_standard', 'chaise_bureau_compacte'], 'obligatoire', 'Chaise du bureau.');
        }
        if (!sansTapis && g !== 'economique') p.ajoute(['tapis_120x170'], 'optionnel', 'Tapis en descente de lit.');
        break;
      }
      case 'salle_de_bain': case 'salle_d_eau': {
        p.exige('lavabo');
        if (r.role === 'salle_de_bain' && !pmr) {
          p.exige('bain');
          p.ajoute(r.area >= 6 ? ['baignoire_170x70', 'baignoire_160x70'] : ['baignoire_160x70'], 'obligatoire', 'Salle de bains : baignoire.', 'bain');
          if (r.area >= SURFACE_SDB_DOUCHE) { p.exige('douche'); p.ajoute(['douche_90x90', 'douche_80x80'], 'obligatoire', `Salle de bains de ${fr(r.area, 1)} m² ≥ ${fr(SURFACE_SDB_DOUCHE, 1)} m² : douche en plus du bain.`, 'douche'); }
        } else {
          p.exige('douche');
          p.ajoute(pmr ? ['douche_90x120'] : r.area >= 5 && g !== 'economique' ? ['douche_90x120', 'douche_90x90'] : r.area >= 4 ? ['douche_90x90', 'douche_80x80'] : ['douche_80x80', 'douche_70x90'], 'obligatoire',
            pmr ? 'PMR : douche de plain-pied 90 × 120 (zone de douche accessible).' : r.role === 'salle_de_bain' ? 'Douche (à la place du bain).' : 'Salle d\'eau : douche.', 'douche');
        }
        p.ajoute(r.area >= 7 && (t === 'famille' || g === 'premium') ? ['vasque_double_120', 'vasque_80'] : r.area >= 5 ? ['vasque_80', 'vasque_60'] : ['vasque_60'], 'obligatoire', 'Lavabo (meuble vasque).', 'lavabo');
        if (!wcParNiveau.has(levelOf(r))) {
          p.exige('toilette');
          p.ajoute(pmr ? ['wc_pmr_espace_droite', 'wc_pmr_espace_gauche'] : g === 'economique' ? ['wc_pose', 'wc_suspendu'] : ['wc_suspendu', 'wc_pose'], 'obligatoire',
            pmr ? 'Aucun WC séparé à ce niveau : WC intégré avec espace latéral 0,80 m (PMR).' : 'Aucun WC séparé à ce niveau : WC intégré.', 'toilette');
        }
        break;
      }
      case 'wc': {
        p.exige('toilette');
        p.ajoute(pmr ? ['wc_pmr_espace_droite', 'wc_pmr_espace_gauche'] : g === 'economique' ? ['wc_pose', 'wc_suspendu'] : ['wc_suspendu', 'wc_pose'], 'obligatoire', pmr ? 'WC avec espace latéral 0,80 m (PMR).' : 'WC séparé : cuvette près de la chute (gaine / évacuation).', 'toilette');
        if (r.area >= 1.4 && !ctx.sobre) p.ajoute(['lave_mains_40', 'lave_mains_angle'], 'optionnel', 'Lave-mains dans le WC séparé.');
        break;
      }
      case 'cellier': case 'buanderie': {
        p.exige('rangement_general');
        p.ajoute(['etagere_rangement_90'], 'obligatoire', r.role === 'cellier' ? 'Cellier : étagère de rangement.' : 'Buanderie : étagère de rangement.', 'rangement_general');
        break;
      }
      case 'bureau': {
        p.exige('travail');
        if (p.ajoute(g === 'premium' ? ['bureau_140', 'bureau_120'] : ['bureau_120', 'bureau_100'], 'obligatoire', 'Pièce bureau : poste de travail.', 'travail'))
          p.ajoute(['chaise_bureau_standard', 'chaise_bureau_compacte'], 'obligatoire', 'Chaise du bureau.');
        p.ajoute(['bibliotheque_80'], 'souhaite', 'Rangement de documents.');
        break;
      }
      case 'dressing': {
        p.exige('rangement_vetements');
        p.ajoute(['dressing_ouvert_200', 'dressing_ouvert_120'], 'obligatoire', 'Dressing : penderie ouverte.', 'rangement_vetements');
        break;
      }
      case 'exterieur': {
        if (!ctx.sobre && r.area >= 3) {
          if (p.ajoute(['table_exterieur_2'], 'optionnel', 'Extérieur : table de balcon.')) {
            p.ajoute(['chaise_exterieur'], 'optionnel', 'Chaise de balcon.');
            p.ajoute(['chaise_exterieur'], 'optionnel', 'Chaise de balcon.');
          }
        }
        break;
      }
      case 'degagement': default: break;
    }
  }

  // ── Lave-linge ──
  if (pieceLL) {
    const p = P(pieceLL);
    p.exige('lavage_linge');
    p.ajoute(pieceLL.role === 'buanderie' ? ['ll_frontal_60', 'll_top_40'] : pieceLL.area < 4 ? ['ll_top_40', 'll_frontal_60'] : ['ll_frontal_60', 'll_top_40'], 'obligatoire',
      CUISINES.includes(pieceLL.role) ? `Lave-linge sous plan en cuisine : salle d'eau trop exiguë (< ${fr(SURFACE_BAIN_LAVE_LINGE_MIN, 1)} m², ou WC intégré et < ${fr(brief.constraints.pmr ? SURFACE_BAIN_PMR_LAVE_LINGE : SURFACE_BAIN_WC_LAVE_LINGE, 1)} m²${brief.constraints.pmr ? ' en PMR' : ''}).` : `Lave-linge du logement (priorité buanderie > salle de bains > salle d'eau).`, 'lavage_linge');
  }

  // ── R6 : télétravail ──
  if (brief.constraints.teletravail && posteTeletravail && t !== 'etudiant') {
    const p = P(posteTeletravail);
    if (!p.items.some((i) => spec(i.specId).provides.includes('travail'))) {
      p.exige('travail');
      if (p.ajoute(g === 'economique' ? ['bureau_100', 'bureau_080'] : ['bureau_120', 'bureau_100', 'bureau_080'], 'obligatoire', `Télétravail : poste de travail (${posteTeletravail.role === 'bureau' ? 'pièce bureau' : SEJOURS.includes(posteTeletravail.role) ? 'au séjour, faute de chambre disponible' : 'dans une chambre'}).`, 'travail'))
        p.ajoute(['chaise_bureau_standard', 'chaise_bureau_compacte'], 'obligatoire', 'Chaise du poste de télétravail.');
    }
  }

  // ── Couchages insuffisants ──
  if (couchagesTotal < N && piecePrincipale) {
    const p = P(piecePrincipale);
    if (!p.items.some((i) => i.specId === 'canape_convertible_2p')) {
      const c = p.items.findIndex((i) => spec(i.specId).category === 'canape');
      const id = choisir(ctx, piecePrincipale.role, ['canape_convertible_2p']);
      if (id && c >= 0) {
        p.items[c] = { specId: id, priority: 'obligatoire', reason: `Couchages des chambres (${couchagesTotal}) < occupants (${N}) : canapé convertible d'appoint.`, fallbacks: replis(ctx, id, piecePrincipale.role) };
        couchagesTotal += 2;
      }
    }
    if (couchagesTotal < N) P(piecePrincipale).notes.push(`Couchages programmés (${couchagesTotal}) inférieurs aux occupants (${N}) : le plan ne le permet pas.`);
  }

  // ── R8 : imposés ──
  for (const id of brief.imposed) {
    const s = getSpec(id);
    if (!s) { notePlan(progs, rooms, `Spec imposée « ${id} » inconnue du catalogue : ignorée.`); continue; }
    if (ctx.forbidden.has(id)) { notePlan(progs, rooms, `Spec « ${id} » à la fois imposée et interdite : l'interdiction prévaut.`); continue; }
    if (!s.gammes.includes(g)) { notePlan(progs, rooms, `Spec imposée « ${id} » hors gamme ${g} : non programmée (gammes ${s.gammes.join(', ')}).`); continue; }
    const cibles = rooms.filter((r) => s.allowedRoles.includes(r.role));
    if (!cibles.length) { notePlan(progs, rooms, `Spec imposée « ${id} » : aucune pièce de rôle admis (${s.allowedRoles.join(', ')}).`); continue; }
    if (cibles.some((r) => P(r).items.some((i) => i.specId === id))) {
      for (const r of cibles) for (const i of P(r).items) if (i.specId === id) { i.priority = 'obligatoire'; i.reason += ' (imposé par l\'utilisateur)'; }
      continue;
    }
    const cible = cibles.find((r) => P(r).items.some((i) => spec(i.specId).category === s.category)) ?? cibles[0]!;
    const p = P(cible);
    const item: ProgramItem = { specId: id, priority: 'obligatoire', reason: 'Imposé par l\'utilisateur.', fallbacks: replis(ctx, id, cible.role) };
    const k = p.items.findIndex((i) => spec(i.specId).category === s.category);
    if (k >= 0) { p.notes.push(`« ${p.items[k]!.specId} » remplacé par « ${id} » (imposé).`); p.items[k] = item; } else p.items.push(item);
    for (const f of s.provides) p.exige(f);
  }

  return rooms.map((r) => {
    const p = P(r);
    return { roomId: r.id, role: r.role, requiredFunctions: p.required, items: p.items, notes: p.notes };
  });
}

function notePlan(progs: Map<string, Prog>, rooms: AnalyzedRoom[], msg: string) {
  const r = rooms.find((x) => SEJOURS.includes(x.role)) ?? rooms[0];
  if (r) progs.get(r.id)!.notes.push(msg);
}

/**
 * « Niveau » d'une pièce sans toucher au contrat : AnalyzedRoom ne porte pas `level`, mais une porte ne
 * relie jamais deux niveaux (l'escalier n'est pas une Opening). Les composantes connexes du graphe des
 * passages (`analysis.adjacency`) sont donc des niveaux (ou des parties de niveau). Clé = plus petit id.
 */
export function composantes(analysis: PlanAnalysis): Map<string, string> {
  const parent = new Map(analysis.rooms.map((r) => [r.id, r.id]));
  const find = (x: string): string => { let y = x; while (parent.get(y) !== y) y = parent.get(y)!; parent.set(x, y); return y; };
  for (const a of analysis.adjacency) {
    if (a.b === null || !parent.has(a.a) || !parent.has(a.b)) continue;
    const x = find(a.a), y = find(a.b);
    if (x !== y) parent.set(x < y ? y : x, x < y ? x : y);
  }
  return new Map(analysis.rooms.map((r) => [r.id, find(r.id)]));
}

function programmeCuisine(ctx: Ctx, p: Prog, r: AnalyzedRoom, avecLV: boolean) {
  const L = runMax(r);
  const g = ctx.brief.gamme;
  const tailles = ['cuisine_360', 'cuisine_300', 'cuisine_240', 'cuisine_180', 'kitchenette_120'];
  const cible = ctx.N <= 1 || r.area < 18 ? 2.4 : ctx.N <= 3 ? 3.0 : 3.6;
  const prefs = tailles.filter((id) => { const s = spec(id); return s.size.w <= Math.min(cible, L) + 1e-9; });
  const k = p.ajoute(prefs.length ? prefs : ['kitchenette_120'], 'obligatoire',
    `Cuisine linéaire la plus longue compatible avec le plus grand pan de mur libre (${fr(L)} m), adossée près des arrivées d'eau.`, 'cuisson');
  const prov = k ? spec(k).provides : [];
  if (!prov.includes('froid')) p.ajoute(g === 'premium' && r.area >= 12 ? ['frigo_americain', 'frigo_combine_60'] : ['frigo_combine_60', 'frigo_table_top'], 'obligatoire', 'Réfrigérateur (non intégré à la cuisine linéaire).', 'froid');
  if (avecLV && !prov.includes('lavage_vaisselle')) p.ajoute(['lv_60', 'lv_45'], 'obligatoire', 'Lave-vaisselle (T3 et plus ou famille).', 'lavage_vaisselle');
  if (g === 'premium' && r.role === 'sejour_cuisine' && r.area >= 30 && !ctx.sobre) p.ajoute(['ilot_120'], 'optionnel', 'Premium : îlot central si la surface le permet.');
}

function programmeAssises(ctx: Ctx, p: Prog, dejaAssises: number) {
  const N = ctx.N, g = ctx.brief.gamme;
  let assises = dejaAssises;
  if (assises === 0) {
    let prefs: string[];
    if (N >= 3 && g !== 'economique') prefs = ['canape_3p', 'canape_2p'];
    else if (g === 'economique' || p.room.area < 18) prefs = ['canape_compact_2p', 'canape_2p'];
    else prefs = ['canape_2p', 'canape_compact_2p'];
    const id = p.ajoute(prefs, 'obligatoire', `Assise de salon pour ${N} occupant(s) : canapé ${N >= 3 && g !== 'economique' ? '3' : '2'} places.`, 'assise_salon');
    if (id) assises += spec(id).seats ?? 0;
  }
  let fauteuils = 0;
  while (assises < N) {
    // INT-05b : au-delà du premier fauteuil, un séjour de moins de SURFACE_SEJOUR_FAUTEUILS m² ne reçoit les suivants
    // qu'en « souhaité » (les chaises de la table complètent l'assise ; ORG-05 est une hypothèse dégradante, alors
    // qu'un fauteuil de trop étrangle les passages bloquants CIR-02).
    const prio = fauteuils >= 1 && p.room.area < SURFACE_SEJOUR_FAUTEUILS ? 'souhaite' : 'obligatoire';
    const id = p.ajoute(['fauteuil_standard', 'fauteuil_compact'], prio, `Assises ≥ occupants (${N}) : fauteuil complémentaire${prio === 'souhaite' ? ` (séjour < ${SURFACE_SEJOUR_FAUTEUILS} m² : souhaité)` : ''}.`, 'assise_salon');
    if (!id) break;
    assises += spec(id).seats ?? 1;
    fauteuils++;
  }
  if (fauteuils >= 2 && p.room.area < SURFACE_SEJOUR_FAUTEUILS) p.notes.push(`assise_salon : séjour de ${fr(p.room.area, 1)} m² < ${SURFACE_SEJOUR_FAUTEUILS} m² — fauteuils au-delà du premier seulement souhaités (les chaises de la table complètent l'assise des ${N} occupants).`);
}

function programmeChaises(ctx: Ctx, p: Prog, couverts: number) {
  for (let k = 0; k < couverts; k++) {
    p.ajoute(['chaise_repas'], k < Math.max(1, ctx.N) ? 'obligatoire' : 'souhaite', k < ctx.N ? `Chaise de repas n° ${k + 1} (une par occupant).` : `Chaise de repas n° ${k + 1} (couvert d'invité).`);
  }
}

