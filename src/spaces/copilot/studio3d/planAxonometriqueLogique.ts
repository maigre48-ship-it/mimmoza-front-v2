// src/spaces/copilot/studio3d/planAxonometriqueLogique.ts
//
// Plan AXONOMÉTRIQUE du Dossier 3D, en logique pure (aucun DOM, aucun WebGL) :
// la même géométrie que la vue 3D (contour local de la parcelle en mètres,
// emprise et hauteur du volume d'étude) est projetée puis écrite en SVG.
// Le SVG sert à la fois à l'affichage dans le panneau, à l'export vectoriel et
// à l'export PNG (rastérisé par le navigateur). Il fonctionne donc sans WebGL.
//
// PROJECTION RETENUE — axonométrie planométrique à 45° (dite « militaire ») :
//   · le plan est tourné de 45° (+ k × 90° pour voir les quatre faces) mais n'est
//     pas déformé : angles et longueurs du plan sont vrais, la parcelle garde sa
//     forme cadastrale ;
//   · les verticales restent verticales, à la même échelle que le plan (1:1) ;
//   · projection parallèle (orthographique) : aucune fuite, aucune perspective.
// Pourquoi pas l'isométrie 30°/30° : elle raccourcit et déforme le plan (un
// rectangle y devient un losange), alors qu'ici la parcelle et l'emprise doivent
// rester lisibles et mesurables. L'axonométrie à 45° est la vue d'architecte
// usuelle pour présenter une implantation : une seule échelle graphique vaut
// pour le plan comme pour les hauteurs.
//
// Repères : x vers l'est, y vers le nord, z vers le haut (mètres) ; écran SVG :
// X vers la droite, Y vers le bas.

import { libelleNiveaux, type PointLocal, type VolumePropose } from './volumeParcelle.ts';

/** Angle de rotation du plan pour la position 0, en degrés. */
export const ANGLE_AXO_DEG = 45;
/** Quatre positions de rotation (pas de 90°) : chaque face du volume est vue au moins une fois. */
export type RotationAxo = 0 | 1 | 2 | 3;
export const tournerAxo = (r: RotationAxo): RotationAxo => ((r + 1) % 4) as RotationAxo;

export interface Point3 { x: number; y: number; z: number }
export interface Point2 { x: number; y: number }
export interface Boite { x0: number; y0: number; x1: number; y1: number }

const rad = (d: number) => d * Math.PI / 180;
const angleRotation = (r: RotationAxo) => rad(ANGLE_AXO_DEG + 90 * r);

/** Projection planométrique d'un point (mètres) : plan tourné, verticales verticales, échelle 1:1. */
export function projeterAxo(p: Point3, rotation: RotationAxo): Point2 {
  const t = angleRotation(rotation);
  const u = p.x * Math.cos(t) - p.y * Math.sin(t);
  const v = p.x * Math.sin(t) + p.y * Math.cos(t);
  // Le plan « monte » vers le haut de l'écran (v) et la hauteur aussi (z).
  return { x: u, y: -v - p.z };
}

/** Composante « vers le haut de l'écran » d'une direction du plan après rotation. */
function composanteV(d: PointLocal, rotation: RotationAxo) {
  const t = angleRotation(rotation);
  return d.x * Math.sin(t) + d.y * Math.cos(t);
}

/** Direction du nord à l'écran (vecteur unitaire, Y vers le bas). */
export function directionNordEcran(rotation: RotationAxo): Point2 {
  const a = projeterAxo({ x: 0, y: 1, z: 0 }, rotation), o = projeterAxo({ x: 0, y: 0, z: 0 }, rotation);
  const n = Math.hypot(a.x - o.x, a.y - o.y);
  return { x: (a.x - o.x) / n, y: (a.y - o.y) / n };
}

/** Une face verticale de l'emprise est vue si sa normale extérieure pointe vers l'observateur (bas de l'écran). */
export function faceVisible(a: PointLocal, b: PointLocal, interieur: PointLocal, rotation: RotationAxo): boolean {
  return composanteV(normaleExterieure(a, b, interieur), rotation) < -1e-9;
}

function normaleExterieure(a: PointLocal, b: PointLocal, interieur: PointLocal): PointLocal {
  const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
  let n = { x: dy / l, y: -dx / l };
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  if ((interieur.x - m.x) * n.x + (interieur.y - m.y) * n.y > 0) n = { x: -n.x, y: -n.y };
  return n;
}

export const boitesSeChevauchent = (a: Boite, b: Boite) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

// ---------------------------------------------------------------------------
// Construction du plan (en pixels du dessin)
// ---------------------------------------------------------------------------

export type TonFace = 'dessus' | 'gauche' | 'droite';
export interface CoteAxo {
  lettre: 'L' | 'P' | 'H';
  texte: string;
  /** Ligne de cote (entre les deux flèches). */
  ligne: [Point2, Point2];
  /** Lignes d'attache (de l'ouvrage vers la ligne de cote). */
  attaches: [Point2, Point2][];
  /** Position et angle (degrés, lisible : entre -90 et 90) de la valeur. */
  valeur: { x: number; y: number; angle: number };
  boite: Boite;
}
export interface PlanAxo {
  rotation: RotationAxo;
  /** Pixels par mètre (identique en plan et en hauteur). */
  echelle: number;
  largeur: number;
  hauteurDessin: number;
  parcelle: Point2[];
  faces: { points: Point2[]; ton: TonFace }[];
  planchers: [Point2, Point2][];
  cotes: CoteAxo[];
  /** Flèche du nord : seulement si l'orientation de la parcelle est connue. */
  nord: { x: number; y: number; direction: Point2 } | null;
  echelleGraphique: { x: number; y: number; longueurM: number; pas: number; longueurPx: number };
}

export interface OptionsPlanAxo {
  rotation?: RotationAxo;
  /** Largeur du dessin en pixels SVG. */
  largeur?: number;
  /** Hauteur maximale de la zone de dessin. */
  hauteurMax?: number;
  /** Taille du texte des cotes (px SVG). */
  taillePolice?: number;
}

const fr = (v: number, d = 1) => v.toLocaleString('fr-FR', { maximumFractionDigits: d }).replace(/\u202f/g, '\u00a0');

/** Boîte englobante (alignée) d'un texte tourné, estimée sans DOM. */
export function boiteTexte(x: number, y: number, angleDeg: number, texte: string, taille: number): Boite {
  const w = texte.length * taille * 0.56 + taille * 0.6, h = taille * 1.25;
  const a = rad(angleDeg), c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const bw = w * c + h * s, bh = w * s + h * c;
  return { x0: x - bw / 2, y0: y - bh / 2, x1: x + bw / 2, y1: y + bh / 2 };
}

const angleLisible = (dx: number, dy: number) => {
  let a = Math.atan2(dy, dx) * 180 / Math.PI;
  if (a > 90) a -= 180;
  if (a <= -90) a += 180;
  return a;
};

/** L'orientation est connue quand le contour vient d'une géométrie géoréférencée (origine WGS84 valide). */
export const orientationConnue = (v: Pick<VolumePropose, 'origine'>) =>
  Number.isFinite(v.origine?.lon) && Number.isFinite(v.origine?.lat) && !(v.origine.lon === 0 && v.origine.lat === 0);

/**
 * Construit le plan axonométrique : parcelle (contour + aplat), volume (faces
 * vues, trois tons), lignes de plancher, cotes L/P/H d'architecte placées sans
 * chevauchement, flèche du nord, échelle graphique.
 */
export function construirePlanAxo(volume: VolumePropose, options: OptionsPlanAxo = {}): PlanAxo {
  const rotation = options.rotation ?? 0;
  const largeur = options.largeur ?? 640;
  const hauteurMax = options.hauteurMax ?? 440;
  const police = options.taillePolice ?? 12;
  const etroit = largeur < 480;
  const marge = etroit ? 14 : 24;
  const e = volume.emprise;
  const H = e ? Math.max(0, volume.hauteurM) : 0;
  const pj = (p: Point3) => projeterAxo(p, rotation);

  const contour = volume.contour;
  const xs = contour.map(p => p.x), ys = contour.map(p => p.y);
  const etendue = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 10);

  // Emprise : coins dans l'ordre, intérieur = centre.
  const coins = e ? e.coins : [];
  const centre = e ? e.centre : { x: 0, y: 0 };
  const aretes = coins.map((a, i) => ({ a, b: coins[(i + 1) % coins.length] }));

  // Cotes en mètres : décalage hors du volume, proportionnel à l'étendue.
  const geometrieCotes = (decalage: number) => {
    if (!e || coins.length < 4) return [];
    const avecNormale = aretes.map(({ a, b }) => {
      const n = normaleExterieure(a, b, centre);
      return { a, b, n, longueur: Math.hypot(b.x - a.x, b.y - a.y), vers: composanteV(n, rotation) };
    });
    // Pour chaque dimension, l'arête la plus tournée vers l'observateur.
    const parLongueur = [...avecNormale].sort((p, q) => q.longueur - p.longueur);
    const longues = parLongueur.slice(0, 2).sort((p, q) => p.vers - q.vers);
    const courtes = parLongueur.slice(2).sort((p, q) => p.vers - q.vers);
    const cote = (arete: typeof avecNormale[number], lettre: 'L' | 'P', valeurM: number) => {
      const o = { x: arete.n.x * decalage, y: arete.n.y * decalage };
      const depasse = { x: arete.n.x * decalage * 0.25, y: arete.n.y * decalage * 0.25 };
      const ecart = { x: arete.n.x * decalage * 0.15, y: arete.n.y * decalage * 0.15 };
      const p = (q: PointLocal, d: PointLocal) => ({ x: q.x + d.x, y: q.y + d.y, z: 0 });
      return {
        lettre, valeurM,
        ligne: [p(arete.a, o), p(arete.b, o)] as [Point3, Point3],
        attaches: [[p(arete.a, ecart), p(arete.a, { x: o.x + depasse.x, y: o.y + depasse.y })], [p(arete.b, ecart), p(arete.b, { x: o.x + depasse.x, y: o.y + depasse.y })]] as [Point3, Point3][],
        normale: arete.n,
      };
    };
    return [cote(longues[0], 'L', e.largeurM), cote(courtes[0], 'P', e.profondeurM)];
  };

  // Mise à l'échelle : tout le dessin (parcelle, volume, cotes) dans la largeur et la hauteur disponibles.
  const decalageM = Math.max(2, etendue * 0.09);
  const cotesM = geometrieCotes(decalageM);
  const pointsM: Point3[] = [
    ...contour.map(p => ({ x: p.x, y: p.y, z: 0 })),
    ...coins.flatMap(c => [{ x: c.x, y: c.y, z: 0 }, { x: c.x, y: c.y, z: H }]),
    ...cotesM.flatMap(c => [...c.ligne, ...c.attaches.flat()]),
  ];
  const proj = pointsM.map(pj);
  const bx0 = Math.min(...proj.map(p => p.x)), bx1 = Math.max(...proj.map(p => p.x));
  const by0 = Math.min(...proj.map(p => p.y)), by1 = Math.max(...proj.map(p => p.y));
  const reserveTexte = police * (etroit ? 3.2 : 4.2); // place pour les valeurs de cote et la cote de hauteur
  let echelle = Math.min((largeur - 2 * marge - 2 * reserveTexte) / Math.max(bx1 - bx0, 1), (hauteurMax - 2 * marge - reserveTexte) / Math.max(by1 - by0, 1));
  echelle = Math.max(echelle, 0.05);
  const ox = (largeur - (bx1 - bx0) * echelle) / 2 - bx0 * echelle;
  const oy = marge + reserveTexte * 0.5 - by0 * echelle;
  const ecran = (p: Point3): Point2 => { const q = pj(p); return { x: ox + q.x * echelle, y: oy + q.y * echelle }; };

  const parcelle = contour.map(p => ecran({ x: p.x, y: p.y, z: 0 }));

  // Volume : faces vues dans l'ordre de peinture (du fond vers l'avant), puis le dessus.
  const faces: PlanAxo['faces'] = [];
  const planchers: [Point2, Point2][] = [];
  if (e && coins.length >= 3 && H > 0) {
    const vues = aretes
      .map(({ a, b }) => ({ a, b, n: normaleExterieure(a, b, centre) }))
      .filter(({ n }) => composanteV(n, rotation) < -1e-9)
      .sort((p, q) => composanteV(q.n, rotation) - composanteV(p.n, rotation));
    for (const { a, b } of vues) {
      const pa = ecran({ ...a, z: 0 }), pb = ecran({ ...b, z: 0 }), pbh = ecran({ ...b, z: H }), pah = ecran({ ...a, z: H });
      // Gauche / droite selon le sens de la normale à l'écran : deux tons distincts pour les faces verticales.
      const n = pj({ x: normaleExterieure(a, b, centre).x, y: normaleExterieure(a, b, centre).y, z: 0 });
      faces.push({ points: [pa, pb, pbh, pah], ton: n.x < 0 ? 'gauche' : 'droite' });
      for (let k = 1; k < volume.niveaux; k++) {
        const z = k * H / volume.niveaux;
        planchers.push([ecran({ ...a, z }), ecran({ ...b, z })]);
      }
    }
    faces.push({ points: coins.map(c => ecran({ ...c, z: H })), ton: 'dessus' });
  }

  // Cotes en pixels, puis placement des valeurs sans chevauchement.
  const cotes: CoteAxo[] = [];
  const occupees: Boite[] = [];
  for (const c of cotesM) {
    const a = ecran(c.ligne[0]), b = ecran(c.ligne[1]);
    const angle = angleLisible(b.x - a.x, b.y - a.y);
    // La valeur se place du côté extérieur de la ligne (sens de la normale projetée).
    const n = pj({ x: c.normale.x, y: c.normale.y, z: 0 }), o = pj({ x: 0, y: 0, z: 0 });
    const nx = n.x - o.x, ny = n.y - o.y, nl = Math.hypot(nx, ny) || 1;
    const texte = `${fr(c.valeurM)} m`;
    let choisie: CoteAxo['valeur'] | null = null, boite: Boite | null = null;
    for (const t of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      for (const recul of [0.85, 1.6, 2.4]) {
        const x = a.x + (b.x - a.x) * t + nx / nl * police * recul, y = a.y + (b.y - a.y) * t + ny / nl * police * recul;
        const bt = boiteTexte(x, y, angle, texte, police);
        if (!occupees.some(o2 => boitesSeChevauchent(o2, bt))) { choisie = { x, y, angle }; boite = bt; break; }
      }
      if (choisie) break;
    }
    if (!choisie || !boite) {
      const x = (a.x + b.x) / 2 + nx / nl * police * 3.2, y = (a.y + b.y) / 2 + ny / nl * police * 3.2;
      choisie = { x, y, angle }; boite = boiteTexte(x, y, angle, texte, police);
    }
    occupees.push(boite);
    cotes.push({ lettre: c.lettre, texte, ligne: [a, b], attaches: c.attaches.map(([p, q]) => [ecran(p), ecran(q)] as [Point2, Point2]), valeur: choisie, boite });
  }

  // Cote de hauteur : verticale, à gauche du coin visible le plus à gauche, hors de tout le reste.
  if (e && H > 0 && coins.length >= 3) {
    const bas = coins.map(c => ({ c, p: ecran({ ...c, z: 0 }) })).sort((p, q) => p.p.x - q.p.x)[0];
    const haut = ecran({ ...bas.c, z: H });
    const gauche = Math.min(bas.p.x, ...cotes.flatMap(c => [c.ligne[0].x, c.ligne[1].x, c.boite.x0].filter(x => x < bas.p.x + 1)));
    const xL = Math.min(bas.p.x, gauche) - police * 1.4;
    const texte = `${fr(H, 1)} m · ${libelleNiveaux(volume.niveaux)}`;
    let valeur = { x: xL - police * 1.05, y: (bas.p.y + haut.y) / 2, angle: -90 };
    let boite = boiteTexte(valeur.x, valeur.y, -90, texte, police);
    for (const t of [0.5, 0.3, 0.7, 0.15, 0.85]) {
      const v = { x: xL - police * 1.05, y: bas.p.y + (haut.y - bas.p.y) * t, angle: -90 };
      const bt = boiteTexte(v.x, v.y, -90, texte, police);
      if (!occupees.some(o2 => boitesSeChevauchent(o2, bt))) { valeur = v; boite = bt; break; }
    }
    occupees.push(boite);
    cotes.push({
      lettre: 'H', texte,
      ligne: [{ x: xL, y: bas.p.y }, { x: xL, y: haut.y }],
      attaches: [[{ x: bas.p.x - 2, y: bas.p.y }, { x: xL - police * 0.25, y: bas.p.y }], [{ x: haut.x - 2, y: haut.y }, { x: xL - police * 0.25, y: haut.y }]],
      valeur, boite,
    });
  }

  // Hauteur réelle du dessin (géométrie + valeurs de cote).
  const tout = [...parcelle, ...faces.flatMap(f => f.points), ...cotes.flatMap(c => [...c.ligne, { x: c.boite.x0, y: c.boite.y0 }, { x: c.boite.x1, y: c.boite.y1 }])];
  const yMax = Math.max(...tout.map(p => p.y));
  const hauteurDessin = Math.ceil(yMax + marge + 28);

  // Échelle graphique : 10/20 m par défaut, 50/100 m pour les grandes parcelles, 5/10 m pour les petites.
  const options_ = [[5, 10], [10, 20], [25, 50], [50, 100], [100, 200]] as const;
  const [pas, longueurM] = options_.find(([, l]) => l * echelle >= 70) ?? options_[options_.length - 1];
  const echelleGraphique = { x: marge, y: hauteurDessin - 20, longueurM, pas, longueurPx: longueurM * echelle };

  const nord = orientationConnue(volume) ? { x: largeur - marge - 14, y: marge + 14, direction: directionNordEcran(rotation) } : null;

  return { rotation, echelle, largeur, hauteurDessin, parcelle, faces, planchers, cotes, nord, echelleGraphique };
}

// ---------------------------------------------------------------------------
// Écriture SVG (autonome : utilisable pour l'affichage et l'export)
// ---------------------------------------------------------------------------

export interface CartouchePlan {
  idu: string;
  reference?: string | null;
  zone?: string | null;
  programme?: string | null;
  /** Mention réglementaire obligatoire (hypothèse ou règles PLU appliquées), en gras. */
  mention: string;
  /** Précision qui suit la mention (texte courant). */
  precision?: string | null;
}

export const echapperXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Coupe un texte en lignes d'au plus `max` caractères (sans DOM). */
export function couperLignes(texte: string, max: number): string[] {
  const lignes: string[] = [];
  let ligne = '';
  for (const mot of texte.split(/\s+/).filter(Boolean)) {
    if (ligne && (ligne + ' ' + mot).length > max) { lignes.push(ligne); ligne = mot; } else ligne = ligne ? `${ligne} ${mot}` : mot;
  }
  if (ligne) lignes.push(ligne);
  return lignes;
}

const TONS: Record<TonFace, string> = { dessus: '#f5f3ff', gauche: '#d8d1f7', droite: '#b3a7ee' };
const ENCRE = '#1d1b2e', INDIGO = '#3a26a6';
const n1 = (v: number) => Math.round(v * 10) / 10;
const pts = (l: Point2[]) => l.map(p => `${n1(p.x)},${n1(p.y)}`).join(' ');

/** Texte alternatif du plan (title / desc du SVG). */
export function descriptionPlanAxo(volume: VolumePropose, cartouche: CartouchePlan): { titre: string; description: string } {
  const ref = cartouche.reference ?? cartouche.idu;
  const titre = `Plan axonométrique — parcelle ${ref}${cartouche.zone ? `, zone ${cartouche.zone}` : ''}`;
  const e = volume.emprise;
  const description = [
    `Parcelle de ${fr(volume.surfaceParcelleM2, 0)} m²`,
    e ? `volume d’étude de ${fr(e.largeurM)} × ${fr(e.profondeurM)} m, ${fr(volume.hauteurM, 1)} m de haut (${libelleNiveaux(volume.niveaux)}), SDP estimée ≈ ${fr(volume.sdpM2, 0)} m²` : 'aucun volume proposé',
    `Axonométrie planométrique à ${ANGLE_AXO_DEG}°, plan et hauteurs à la même échelle`,
    cartouche.mention + (cartouche.precision ? ` ${cartouche.precision}` : ''),
  ].join('. ').replace(/\.?$/, '.');
  return { titre, description };
}

/** SVG complet du plan (dessin + échelle graphique + nord + cartouche). */
export function svgPlanAxo(volume: VolumePropose, cartouche: CartouchePlan, options: OptionsPlanAxo = {}): string {
  const plan = construirePlanAxo(volume, options);
  const { largeur: W } = plan;
  const police = options.taillePolice ?? 12;
  const { titre, description } = descriptionPlanAxo(volume, cartouche);
  const famille = `'Segoe UI', 'Helvetica Neue', Arial, sans-serif`;

  // Cartouche : deux colonnes de données + mention (coupée en lignes).
  const e = volume.emprise;
  const gauche = [
    [`${cartouche.reference ?? cartouche.idu}${cartouche.zone ? ` · zone ${cartouche.zone}` : ''}`, true],
    [`IDU ${cartouche.idu}`, false],
    [cartouche.programme ? `Programme : ${cartouche.programme}` : 'Programme : à préciser', false],
  ] as const;
  const droite = e ? [
    [`${libelleNiveaux(volume.niveaux)} · ${fr(volume.hauteurM, 1)} m`, true],
    [`Emprise ${fr(e.largeurM)} × ${fr(e.profondeurM)} m`, false],
    [`SDP estimée ≈ ${fr(volume.sdpM2, 0)} m²`, false],
  ] as const : [[`Parcelle ${fr(volume.surfaceParcelleM2, 0)} m²`, true]] as const;
  const parLigne = Math.floor((W - 44) / (11 * 0.53));
  const mention = [
    ...couperLignes(cartouche.mention, parLigne).map(t => ({ t, fort: true })),
    ...couperLignes(cartouche.precision ?? '', parLigne).map(t => ({ t, fort: false })),
  ];
  // Deux colonnes si la largeur le permet, sinon une seule (panneau étroit, mobile).
  const deuxColonnes = W >= 460;
  const rangees = deuxColonnes ? Math.max(gauche.length, droite.length) : gauche.length + droite.length;
  const pied = couperLignes(`Axonométrie planométrique ${ANGLE_AXO_DEG}° (vue ${plan.rotation + 1}/4) · plan et hauteurs à la même échelle · volume d’étude Mimmoza, non contractuel`, Math.floor((W - 48) / (9.5 * 0.52)));
  const yCart = plan.hauteurDessin + 8;
  const hCart = 16 + rangees * 17 + 8 + mention.length * 15 + 10 + pied.length * 13;
  const H = yCart + hCart + 12;
  const regles = /appliqu/i.test(cartouche.mention);

  const o: string[] = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="axo-titre axo-desc" font-family="${famille}">`);
  o.push(`<title id="axo-titre">${echapperXml(titre)}</title><desc id="axo-desc">${echapperXml(description)}</desc>`);
  o.push(`<defs><marker id="axo-fleche" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1.5 L10,5 L0,8.5 z" fill="${ENCRE}"/></marker></defs>`);
  o.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`);

  // Parcelle : léger aplat + contour net.
  o.push(`<polygon points="${pts(plan.parcelle)}" fill="#eef6f1" stroke="${ENCRE}" stroke-width="1.3" stroke-linejoin="round"/>`);
  // Volume : faces ombrées par orientation, arêtes nettes, planchers discrets.
  for (const f of plan.faces) o.push(`<polygon points="${pts(f.points)}" fill="${TONS[f.ton]}" stroke="${INDIGO}" stroke-width="1.2" stroke-linejoin="round"/>`);
  for (const [a, b] of plan.planchers) o.push(`<line x1="${n1(a.x)}" y1="${n1(a.y)}" x2="${n1(b.x)}" y2="${n1(b.y)}" stroke="${INDIGO}" stroke-width="0.6" stroke-opacity="0.55"/>`);
  // Les faces vues d'un prisme convexe ne se recouvrent pas : les planchers tracés après restent sur leur face.

  // Cotes d'architecte : attaches fines, ligne à flèches, valeur détourée.
  for (const c of plan.cotes) {
    for (const [a, b] of c.attaches) o.push(`<line x1="${n1(a.x)}" y1="${n1(a.y)}" x2="${n1(b.x)}" y2="${n1(b.y)}" stroke="${ENCRE}" stroke-width="0.6"/>`);
    const [a, b] = c.ligne;
    o.push(`<line x1="${n1(a.x)}" y1="${n1(a.y)}" x2="${n1(b.x)}" y2="${n1(b.y)}" stroke="${ENCRE}" stroke-width="0.8" marker-start="url(#axo-fleche)" marker-end="url(#axo-fleche)"/>`);
    o.push(`<text x="${n1(c.valeur.x)}" y="${n1(c.valeur.y)}" transform="rotate(${n1(c.valeur.angle)} ${n1(c.valeur.x)} ${n1(c.valeur.y)})" text-anchor="middle" dominant-baseline="central" font-size="${police}" font-weight="600" fill="${ENCRE}" stroke="#ffffff" stroke-width="3" paint-order="stroke" data-cote="${c.lettre}">${echapperXml(c.texte)}</text>`);
  }

  // Flèche du nord (orientation connue seulement).
  if (plan.nord) {
    const { x, y, direction: d } = plan.nord, r = 12;
    // Pointe de flèche (moitié pleine, moitié claire) dirigée vers le nord projeté.
    const pointe = { x: x + d.x * r, y: y + d.y * r }, queue = { x: x - d.x * r, y: y - d.y * r };
    const creux = { x: x - d.x * r * 0.35, y: y - d.y * r * 0.35 };
    const pg = { x: queue.x - d.y * 6, y: queue.y + d.x * 6 }, pd = { x: queue.x + d.y * 6, y: queue.y - d.x * 6 };
    o.push(`<g aria-hidden="true"><circle cx="${n1(x)}" cy="${n1(y)}" r="${r + 4}" fill="#ffffff" stroke="${ENCRE}" stroke-width="0.8"/>`);
    o.push(`<polygon points="${pts([pointe, pd, creux])}" fill="${ENCRE}"/><polygon points="${pts([pointe, creux, pg])}" fill="#ffffff" stroke="${ENCRE}" stroke-width="0.8" stroke-linejoin="round"/>`);
    o.push(`<text x="${n1(x + d.x * (r + 12))}" y="${n1(y + d.y * (r + 12))}" text-anchor="middle" dominant-baseline="central" font-size="11" font-weight="700" fill="${ENCRE}">N</text></g>`);
  }

  // Échelle graphique (vraie en plan comme en hauteur).
  const g = plan.echelleGraphique, seg = g.pas * plan.echelle;
  o.push(`<g aria-hidden="true">`);
  for (let i = 0; i * g.pas < g.longueurM; i++) o.push(`<rect x="${n1(g.x + i * seg)}" y="${g.y}" width="${n1(seg)}" height="5" fill="${i % 2 ? '#ffffff' : ENCRE}" stroke="${ENCRE}" stroke-width="0.8"/>`);
  for (let i = 0; i * g.pas <= g.longueurM; i++) o.push(`<text x="${n1(g.x + i * seg)}" y="${g.y + 16}" text-anchor="middle" font-size="10" fill="${ENCRE}">${i * g.pas}${(i + 1) * g.pas > g.longueurM ? ' m' : ''}</text>`);
  o.push(`</g>`);

  // Cartouche.
  o.push(`<g><rect x="12" y="${yCart}" width="${W - 24}" height="${hCart}" rx="6" fill="#ffffff" stroke="${ENCRE}" stroke-width="0.9"/>`);
  if (deuxColonnes) o.push(`<line x1="${W / 2}" y1="${yCart + 8}" x2="${W / 2}" y2="${yCart + 8 + rangees * 17}" stroke="${ENCRE}" stroke-width="0.5" stroke-opacity="0.4"/>`);
  const cellules = deuxColonnes
    ? [...gauche.map((l, i) => ({ l, x: 24, i })), ...droite.map((l, i) => ({ l, x: W / 2 + 12, i }))]
    : [...gauche, ...droite].map((l, i) => ({ l, x: 24, i }));
  for (const { l: [t, fort], x, i } of cellules) o.push(`<text x="${x}" y="${yCart + 22 + i * 17}" font-size="${fort ? 13 : 11}" font-weight="${fort ? 700 : 400}" fill="${ENCRE}">${echapperXml(t)}</text>`);
  const yM = yCart + 16 + rangees * 17 + 8;
  o.push(`<line x1="20" y1="${yM - 4}" x2="${W - 20}" y2="${yM - 4}" stroke="${ENCRE}" stroke-width="0.5" stroke-opacity="0.4"/>`);
  o.push(`<rect x="20" y="${yM + 1}" width="3" height="${mention.length * 15 - 2}" fill="${regles ? '#2f9a66' : '#d39a2c'}"/>`);
  mention.forEach((l, i) => o.push(`<text x="30" y="${yM + 11 + i * 15}" font-size="11" font-weight="${l.fort ? 650 : 400}" fill="${ENCRE}">${echapperXml(l.t)}</text>`));
  pied.forEach((t, i) => o.push(`<text x="24" y="${yM + mention.length * 15 + 14 + i * 13}" font-size="9.5" fill="#5f5b78">${echapperXml(t)}</text>`));
  o.push(`</g></svg>`);
  return o.join('');
}

/** Nom de fichier d'export : « plan-axo-92050000AN0412-vue1.svg ». */
export const nomFichierPlan = (idu: string, rotation: RotationAxo, extension: 'svg' | 'png') =>
  `plan-axo-${idu.replace(/[^0-9A-Za-z_-]/g, '') || 'parcelle'}-vue${rotation + 1}.${extension}`;
