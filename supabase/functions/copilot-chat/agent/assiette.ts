// supabase/functions/copilot-chat/agent/assiette.ts
// =============================================================
// LOT VIS-15 — ASSIETTE FONCIÈRE GROUPÉE (plusieurs parcelles cadastrales pour un même projet).
//
// Incident du 19/11/2026 (Ascain, 64065000AI0001 = 66 m² + AI0002 = 2 283 m², « R+4 de 28 logements sur
// l'assiette groupée ») : la mission de conception ne connaissait qu'UNE parcelle (criteres.idu) et refusait
// la seconde (« la mission porte sur AI0001 ») ; la conception était enregistrée sur 66 m² et la 3D aurait
// été construite dessus. Ce module, PUR (aucun réseau) :
//   1. lit la liste des parcelles d'une demande (criteres.parcel_ids / idus / parcelles + criteres.idu) ;
//   2. assemble les contours cadastraux en UNE assiette : union des géométries (arêtes communes retirées),
//      surface = somme des contenances cadastrales, contrôlée contre la surface calculée de chaque contour ;
//   3. refuse d'inventer : si l'union n'est pas d'un seul tenant (parcelles non contiguës), rien n'est
//      assemblé et la question « laquelle utiliser ? » est rédigée pour l'utilisateur.
// L'assiette est conservée DANS `parcelle` de la conception (jsonb : aucune migration) : `geometrie` = union,
// `surface_m2` = somme, `assiette` = détail par parcelle. Tous les consommateurs existants (moteur de volume,
// côté voie, Studio) lisent `parcelle.geometrie` et suivent donc l'assiette sans autre changement.
// =============================================================

import type { ParcelleVoisine, VoisinesParcelle } from './voisines-parcelle.ts';

/** Format IDU : INSEE (5, Corse 2A/2B) + préfixe (3) + section (2) + numéro (4). */
export const RE_IDU_ASSIETTE = /^(?:2[AB]\d{3}|\d{5})\d{3}[0-9A-Z]{2}\d{4}$/;
/** Au-delà, ce n'est plus une assiette de projet mais une prospection (mission de recherche). */
export const ASSIETTE_MAX_PARCELLES = 12;
/** Écart toléré entre contenance cadastrale et surface calculée du contour (le cadastre arrondit, la projection aussi). */
export const ECART_SURFACE_TOLERE_PCT = 10;

type Geometrie = { type: 'Polygon'; coordinates: number[][][] } | { type: 'MultiPolygon'; coordinates: number[][][][] };

/** Contour d'une parcelle tel que lu au cadastre (même forme que ParcelleConception, sans dépendance circulaire). */
export interface ContourParcelle {
  idu: string;
  geometrie: Geometrie;
  surface_m2: number | null;
  source: string;
  voisines?: VoisinesParcelle;
}

export interface ParcelleAssiette {
  idu: string;
  /** Contenance cadastrale (API Carto IGN). */
  surface_m2: number | null;
  /** Surface calculée du contour (projection locale), pour le contrôle. */
  surface_calculee_m2: number;
  /** Écart contenance / contour, en % de la contenance ; null sans contenance. */
  ecart_pct: number | null;
}

export interface AssietteFonciere {
  idus: string[];
  parcelles: ParcelleAssiette[];
  /** Somme des contenances cadastrales (surface calculée du contour à défaut de contenance). */
  surface_m2: number;
  /** Surface calculée de l'union (contrôle : doit valoir la somme, à l'arrondi près). */
  surface_union_calculee_m2: number;
  contigue: true;
  /** Phrase de contrôle, lisible telle quelle. */
  controle: string;
}

export type IssueAssiette =
  | { ok: true; parcelle: ContourParcelle & { assiette: AssietteFonciere } }
  | { ok: false; motif: 'non_contigue' | 'geometrie'; raison: string; groupes: string[][]; question: string };

const norm = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, '').toUpperCase();
  return RE_IDU_ASSIETTE.test(s) ? s : null;
};

/**
 * Parcelles d'une demande (critères de mission, entrée d'outil) : `idu` d'abord (parcelle principale), puis
 * les listes `parcel_ids`, `idus`, `parcelles` (chaînes ou objets { idu }). Dédoublonnées, format contrôlé.
 * Une chaîne « A+B » ou « A, B » (le modèle l'a écrit ainsi le 19/11 dans conception_id) est aussi lue.
 */
export function idusDeLaDemande(src: unknown): string[] {
  const o = (src && typeof src === 'object' && !Array.isArray(src) ? src : {}) as Record<string, unknown>;
  const out: string[] = [];
  const ajouter = (v: unknown) => {
    if (typeof v === 'string') {
      // « 93048 000 AJ 0209 » (espaces internes) est UNE référence ; « A+B », « A, B » ou « A B » en sont plusieurs.
      const entiere = norm(v);
      const morceaux = entiere ? [entiere] : v.split(/[+,;/]+/).flatMap((m) => norm(m) ? [m] : m.split(/\s+/));
      for (const morceau of morceaux) { const i = norm(morceau); if (i && !out.includes(i)) out.push(i); }
    } else if (v && typeof v === 'object' && !Array.isArray(v)) ajouter((v as Record<string, unknown>).idu);
  };
  ajouter(o.idu);
  for (const cle of ['parcel_ids', 'idus', 'parcelles', 'assiette']) {
    const v = o[cle];
    if (Array.isArray(v)) v.forEach(ajouter);
    else if (typeof v === 'string') ajouter(v);
  }
  return out.slice(0, ASSIETTE_MAX_PARCELLES);
}

/** Parcelles couvertes par une conception enregistrée : `parcelle.assiette.idus`, sinon son seul idu. */
export function idusDeLaConception(c: { idu?: unknown; parcelle?: unknown } | null | undefined): string[] {
  const p = c?.parcelle && typeof c.parcelle === 'object' ? c.parcelle as Record<string, unknown> : null;
  const a = p?.assiette && typeof p.assiette === 'object' ? p.assiette as Record<string, unknown> : null;
  const liste = Array.isArray(a?.idus) ? (a!.idus as unknown[]).map(norm).filter((x): x is string => !!x) : [];
  if (liste.length) return [...new Set(liste)];
  const i = norm(c?.idu) ?? norm(p?.idu);
  return i ? [i] : [];
}

// ── Géométrie (projection locale équirectangulaire, suffisante à l'échelle d'un îlot) ─────────────────

type Pt = [number, number];
const R = 6378137;

function anneauxExterieurs(g: Geometrie): Pt[][] {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  return polys.map((p) => (p?.[0] ?? []).map((c) => [Number(c[0]), Number(c[1])] as Pt)).filter((r) => r.length >= 4);
}

function projeteur(lat0: number) {
  const k = Math.cos(lat0 * Math.PI / 180);
  return (p: Pt): Pt => [p[0] * Math.PI / 180 * R * k, p[1] * Math.PI / 180 * R];
}

function aireSignee(r: Pt[]): number {
  let s = 0;
  for (let i = 0; i < r.length - 1; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
  return s / 2;
}

/** Surface calculée (m²) d'un contour (somme des polygones, anneaux extérieurs). */
export function surfaceCalculeeM2(g: Geometrie): number {
  const anneaux = anneauxExterieurs(g);
  if (!anneaux.length) return 0;
  const lat0 = anneaux[0][0][1];
  const pr = projeteur(lat0);
  return Math.abs(anneaux.reduce((s, r) => s + Math.abs(aireSignee(r.map(pr))), 0));
}

/**
 * Union de polygones jointifs par retrait des arêtes communes. Les sommets distants de moins de `tolM` sont
 * fusionnés, et un sommet posé sur l'arête d'un voisin la découpe (jonctions en T du cadastre). Renvoie les
 * anneaux extérieurs résultants (en degrés) : UN anneau = assiette d'un seul tenant.
 */
export function unionContours(geoms: Geometrie[], tolM = 0.05): Pt[][] {
  const anneaux = geoms.flatMap(anneauxExterieurs);
  if (!anneaux.length) return [];
  const lat0 = anneaux[0][0][1];
  const pr = projeteur(lat0);
  const k = Math.cos(lat0 * Math.PI / 180);
  const inv = (p: Pt): Pt => [p[0] / (R * k) * 180 / Math.PI, p[1] / R * 180 / Math.PI];
  // 1. Sommets fusionnés (indices), anneaux orientés dans le sens trigonométrique.
  const sommets: Pt[] = [];
  const indice = (p: Pt): number => {
    for (let i = 0; i < sommets.length; i++) if (Math.hypot(sommets[i][0] - p[0], sommets[i][1] - p[1]) < tolM) return i;
    sommets.push(p);
    return sommets.length - 1;
  };
  const cycles = anneaux.map((r) => {
    const m = r.map(pr);
    const ccw = aireSignee(m) >= 0 ? m : [...m].reverse();
    const ids = ccw.slice(0, -1).map(indice);
    return ids.filter((v, i) => v !== ids[(i + ids.length - 1) % ids.length]);
  });
  // 2. Arêtes découpées aux sommets des autres anneaux posés dessus.
  const aretes: [number, number][] = [];
  for (const c of cycles) {
    for (let i = 0; i < c.length; i++) {
      const a = c[i], b = c[(i + 1) % c.length];
      const A = sommets[a], B = sommets[b];
      const dx = B[0] - A[0], dy = B[1] - A[1], l2 = dx * dx + dy * dy;
      if (l2 === 0) continue;
      const sur: { t: number; v: number }[] = [];
      for (let v = 0; v < sommets.length; v++) {
        if (v === a || v === b) continue;
        const P = sommets[v];
        const t = ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / l2;
        if (t <= 0 || t >= 1) continue;
        const d = Math.abs((P[0] - A[0]) * dy - (P[1] - A[1]) * dx) / Math.sqrt(l2);
        if (d < tolM) sur.push({ t, v });
      }
      sur.sort((x, y) => x.t - y.t);
      let prec = a;
      for (const s of sur) { aretes.push([prec, s.v]); prec = s.v; }
      aretes.push([prec, b]);
    }
  }
  // 3. Arêtes communes (parcourues dans les deux sens) retirées.
  const cle = (a: number, b: number) => `${a}>${b}`;
  const compte = new Map<string, number>();
  for (const [a, b] of aretes) compte.set(cle(a, b), (compte.get(cle(a, b)) ?? 0) + 1);
  const restantes: [number, number][] = [];
  for (const [k, n] of compte) {
    const [a, b] = k.split('>').map(Number);
    const reste = n - (compte.get(cle(b, a)) ?? 0);
    for (let i = 0; i < reste; i++) restantes.push([a, b]);
  }
  // 4. Chaînage des arêtes restantes en anneaux.
  const sortantes = new Map<number, number[]>();
  for (const [a, b] of restantes) { const l = sortantes.get(a) ?? []; l.push(b); sortantes.set(a, l); }
  const anneauxOut: Pt[][] = [];
  for (const [depart] of restantes) {
    if (!(sortantes.get(depart)?.length)) continue;
    const chemin = [depart];
    let cur = depart;
    for (let garde = 0; garde < restantes.length + 1; garde++) {
      const l = sortantes.get(cur);
      if (!l?.length) break;
      const suivant = l.shift()!;
      if (suivant === depart) break;
      chemin.push(suivant);
      cur = suivant;
    }
    if (chemin.length >= 3) {
      const m = chemin.map((i) => sommets[i]);
      if (aireSignee([...m, m[0]]) > 0) anneauxOut.push([...m, m[0]].map(inv));
    }
  }
  return anneauxOut;
}

/** Groupes de parcelles d'un seul tenant (pour dire lesquelles se touchent quand l'ensemble ne se tient pas). */
function groupesContigus(contours: ContourParcelle[], tolM: number): string[][] {
  const n = contours.length;
  const parent = contours.map((_, i) => i);
  const racine = (i: number): number => (parent[i] === i ? i : (parent[i] = racine(parent[i])));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (unionContours([contours[i].geometrie, contours[j].geometrie], tolM).length === 1) parent[racine(i)] = racine(j);
  }
  const g = new Map<number, string[]>();
  contours.forEach((c, i) => { const r = racine(i); g.set(r, [...(g.get(r) ?? []), c.idu]); });
  return [...g.values()];
}

const m2 = (v: number) => `${Math.round(v).toLocaleString('fr-FR')} m²`;
const court = (idu: string) => idu.slice(-6);

/** Voisines de l'assiette : celles de chaque parcelle, sans les parcelles de l'assiette elles-mêmes. */
export function voisinesDeLAssiette(contours: ContourParcelle[]): VoisinesParcelle | undefined {
  const listes = contours.map((c) => c.voisines).filter((v): v is VoisinesParcelle => !!v);
  if (listes.length !== contours.length) return listes.length ? { statut: 'indisponibles', parcelles: [], source: listes[0].source, raison: 'Parcelles voisines absentes pour une des parcelles de l’assiette.' } : undefined;
  const ko = listes.find((v) => v.statut !== 'disponibles');
  if (ko) return { statut: 'indisponibles', parcelles: [], source: ko.source, raison: ko.raison ?? 'Parcelles voisines indisponibles pour une des parcelles de l’assiette.' };
  const membres = new Set(contours.map((c) => c.idu));
  const vues = new Set<string>();
  const parcelles: ParcelleVoisine[] = [];
  for (const v of listes.flatMap((l) => l.parcelles)) {
    const id = v.idu ? v.idu.toUpperCase() : null;
    if (id && membres.has(id)) continue;
    const k = id ?? JSON.stringify(v.geometrie).slice(0, 200);
    if (vues.has(k)) continue;
    vues.add(k);
    parcelles.push(v);
  }
  return { statut: 'disponibles', parcelles, source: listes[0].source };
}

/**
 * Assemble les contours lus au cadastre en UNE assiette. Une seule parcelle : renvoyée telle quelle, avec
 * son `assiette` (contrôle de surface). Plusieurs : union d'un seul tenant exigée, sinon refus + question.
 */
export function assemblerAssiette(contours: ContourParcelle[], tolM = 0.05): IssueAssiette {
  if (!contours.length) return { ok: false, motif: 'geometrie', raison: 'Aucun contour cadastral à assembler.', groupes: [], question: '' };
  const detail: ParcelleAssiette[] = contours.map((c) => {
    const calc = surfaceCalculeeM2(c.geometrie);
    const ecart = c.surface_m2 && c.surface_m2 > 0 ? Math.round(Math.abs(calc - c.surface_m2) / c.surface_m2 * 1000) / 10 : null;
    return { idu: c.idu, surface_m2: c.surface_m2, surface_calculee_m2: Math.round(calc), ecart_pct: ecart };
  });
  const somme = detail.reduce((s, d) => s + (d.surface_m2 ?? d.surface_calculee_m2), 0);
  const ecarts = detail.filter((d) => d.ecart_pct !== null && d.ecart_pct > ECART_SURFACE_TOLERE_PCT);
  const lignes = detail.map((d) => `${d.idu} : ${d.surface_m2 != null ? m2(d.surface_m2) : 'contenance inconnue'} (contour ${m2(d.surface_calculee_m2)})`);
  const controle = `Assiette ${contours.length > 1 ? 'groupée ' : ''}de ${m2(somme)} = ${lignes.join(' + ')}` +
    (ecarts.length ? ` ; écart contenance / contour supérieur à ${ECART_SURFACE_TOLERE_PCT} % pour ${ecarts.map((d) => d.idu).join(', ')} : à vérifier.` : ' ; contenances cohérentes avec les contours.');
  if (contours.length === 1) {
    const c = contours[0];
    return { ok: true, parcelle: { ...c, assiette: { idus: [c.idu], parcelles: detail, surface_m2: somme, surface_union_calculee_m2: detail[0].surface_calculee_m2, contigue: true, controle } } };
  }
  const anneaux = unionContours(contours.map((c) => c.geometrie), tolM);
  if (anneaux.length !== 1) {
    const groupes = groupesContigus(contours, tolM);
    const desc = groupes.map((g) => g.map(court).join(' + ')).join(' / ');
    const raison = `Les parcelles ${contours.map((c) => court(c.idu)).join(', ')} ne forment pas une assiette d’un seul tenant (groupes séparés : ${desc}).`;
    const question = `${raison} Sur quelle parcelle (ou quel groupe de parcelles contiguës) voulez-vous concevoir le projet : ${groupes.map((g) => g.join(' + ')).join(' ou ')} ?`;
    return { ok: false, motif: 'non_contigue', raison, groupes, question };
  }
  const geometrie: Geometrie = { type: 'MultiPolygon', coordinates: [[anneaux[0].map((p) => [Math.round(p[0] * 1e8) / 1e8, Math.round(p[1] * 1e8) / 1e8])]] };
  const unionCalc = Math.round(surfaceCalculeeM2(geometrie));
  const voisines = voisinesDeLAssiette(contours);
  return {
    ok: true,
    parcelle: {
      idu: contours[0].idu,
      geometrie,
      surface_m2: somme,
      source: `${contours[0].source} — assiette groupée de ${contours.length} parcelles (union des contours)`,
      ...(voisines ? { voisines } : {}),
      assiette: { idus: contours.map((c) => c.idu), parcelles: detail, surface_m2: somme, surface_union_calculee_m2: unionCalc, contigue: true, controle },
    },
  };
}

/** Libellé court d'une assiette pour l'utilisateur : « AI0001 + AI0002 (2 349 m²) ». */
export function libelleAssiette(a: Pick<AssietteFonciere, 'idus' | 'surface_m2'>): string {
  return `${a.idus.map(court).join(' + ')} (${m2(a.surface_m2)})`;
}
