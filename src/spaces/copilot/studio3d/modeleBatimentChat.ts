// src/spaces/copilot/studio3d/modeleBatimentChat.ts
// =============================================================================
// VIS-25 lot B — carte « Votre bâtiment » du MODÈLE COMPOSÉ : logique PURE (testée par modeleBatimentChat.test.ts,
// `npx tsx --test`). Aucune E/S, aucun React. Contrat : src/lib/studio/modeleBatiment.ts (lot A) ; message et portée :
// src/lib/studio/modeleBatimentMessage.ts.
//
// - `lireCarteModele` : sortie des outils « dessiner » / « retoucher » relue SANS confiance (modèle revalidé en strict) ;
// - `planVuDeDessus` / `facadePrincipale` : aperçu simplifié en SVG (volumes vus de dessus ; élévation de la façade sur
//   rue : murs, silhouette des toits, ouvertures, briques) — un dessin d'intention, pas un plan coté ;
// - `groupesListe` : liste lisible (volumes, toits, ouvertures, éléments, matières) avec la portée honnête de chacun ;
// - `etatCarte` : la carte a-t-elle été envoyée (« Reproduire en 3D »), ou remplacée par une retouche plus bas ?
// =============================================================================
import {
  contourVolume, englobantTerrain, hautMurs, hauteurToit, ouverturesPosees, toitEnPente, validerModele, empreinteModele,
  type ModeleBatiment, type Point2, type TypeOuverture, type VolumeModele,
} from '../../../lib/studio/modeleBatiment.ts';
import { MENTION_PHOTO } from '../../../lib/studio/descriptionBatiment.ts';
import {
  OUTILS_MODELE, porteeModele, referenceModeleDuMessage, type CategoriePortee, type LignePortee, type StatutsRendu,
} from '../../../lib/studio/modeleBatimentMessage.ts';
import { CATALOGUE_EXTERIEUR } from './catalogueExterieur.ts';

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const textes = (v: unknown, n: number): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, n).map((x) => x.slice(0, 200)) : []);

/** Statut « dans les images » des matières du catalogue extérieur (VIS-24). */
export const STATUTS_RENDU: StatutsRendu = Object.fromEntries(
  CATALOGUE_EXTERIEUR.filter((e) => typeof e.refStudio === 'string').map((e) => [e.refStudio as string, e.rendu]),
);

export interface CarteModele {
  modele: ModeleBatiment;
  empreinte: string;
  /** « Ce que j'ai corrigé » (validation du site). */
  corrections: string[];
  /** Ce qui semble étrange mais est gardé. */
  avertissements: string[];
  /** Retouche : ce qui a changé, en clair. */
  fait: string[];
  retouche: boolean;
  mentionPhoto: string | null;
}

/** Sortie de `studio_dessiner_batiment` / `studio_retoucher_batiment` → carte ; null : autre outil, en cours, refusée, illisible. */
export function lireCarteModele(appel: { name: string; status?: string; output?: unknown }): CarteModele | null {
  if (!OUTILS_MODELE.includes(appel.name) || appel.status === 'running') return null;
  const o = appel.output;
  if (!estObj(o) || o.status !== 'ok' || !estObj(o.data) || o.data.carte !== 'modele') return null;
  const v = validerModele(o.data.modele, { strict: true });
  if (!v.ok) return null;
  return {
    modele: v.modele, empreinte: empreinteModele(v.modele),
    corrections: textes(o.data.corrections, 12), avertissements: textes(o.data.avertissements, 8), fait: textes(o.data.fait, 12),
    retouche: typeof o.data.retouche_de === 'string', mentionPhoto: v.modele.origine === 'photo' ? MENTION_PHOTO : null,
  };
}

// ---- Aperçu en plan (vu de dessus) ----------------------------------------------

export interface DessinPlan {
  viewBox: string;
  /** Volumes : points SVG, du plus bas au plus haut (le plus haut dessiné en dernier). */
  volumes: { id: string; nom: string; points: string; principal: boolean; sommet: number }[];
  /** Emprises des briques (formes simples) et ancrages des éléments libres. */
  briques: { points: string; rond: boolean; cx: number; cy: number; r: number }[];
  /** Repère de la rue (bas du dessin). */
  rue: { x1: number; x2: number; y: number };
  echelle: { x: number; y: number; longueur: number; libelle: string };
}

const r1 = (x: number): number => Math.round(x * 10) / 10;
const pts = (p: readonly Point2[]): string => p.map(([x, y]) => `${r1(x)},${r1(y)}`).join(' ');
/** Plan : x vers la droite ; y du terrain (vers le fond) dessiné VERS LE HAUT (la rue en bas). */
const versPlan = ([x, y]: Point2): Point2 => [x, -y];

function contourBrique(b: { forme: string; x: number; y: number; largeur: number; profondeur: number; rotation: number }): { poly: Point2[] | null; r: number } {
  if (b.forme === 'cylindre' || b.forme === 'cone' || b.forme === 'poteau') return { poly: null, r: b.largeur / 2 };
  const a = b.largeur / 2; const p = (b.profondeur || b.largeur) / 2;
  const c = Math.cos((b.rotation * Math.PI) / 180); const s = Math.sin((b.rotation * Math.PI) / 180);
  return { poly: ([[-a, -p], [a, -p], [a, p], [-a, p]] as Point2[]).map(([x, y]) => [b.x + x * c - y * s, b.y + x * s + y * c] as Point2), r: 0 };
}

export function planVuDeDessus(m: ModeleBatiment): DessinPlan {
  const tous: Point2[] = [];
  const principal = m.volumes.find((v) => v.role === 'principal')?.id ?? m.volumes[0]?.id;
  const volumes = [...m.volumes].sort((a, b) => hautMurs(a) - hautMurs(b)).map((v) => {
    const c = contourVolume(v).map(versPlan);
    tous.push(...c);
    return { id: v.id, nom: v.nom ?? v.id, points: pts(c), principal: v.id === principal, sommet: r1(hautMurs(v) + hauteurToit(v)) };
  });
  const briques: DessinPlan['briques'] = [];
  for (const e of m.elements) {
    for (const b of e.briques) {
      const k = contourBrique(b);
      if (k.poly) { const c = k.poly.map(versPlan); tous.push(...c); briques.push({ points: pts(c), rond: false, cx: 0, cy: 0, r: 0 }); }
      else { tous.push(versPlan([b.x - k.r, b.y - k.r]), versPlan([b.x + k.r, b.y + k.r])); briques.push({ points: '', rond: true, cx: r1(b.x), cy: r1(-b.y), r: r1(Math.max(0.15, k.r)) }); }
    }
    if (!e.briques.length && e.point) { tous.push(versPlan([e.point.x, e.point.y])); briques.push({ points: '', rond: true, cx: r1(e.point.x), cy: r1(-e.point.y), r: 0.4 }); }
  }
  const e = tous.length ? englobantTerrain(tous) : { minX: -5, maxX: 5, minY: -5, maxY: 5 };
  const marge = Math.max(1.5, 0.08 * Math.max(e.maxX - e.minX, e.maxY - e.minY));
  const yRue = e.maxY + marge * 0.6;
  const minX = e.minX - marge; const minY = e.minY - marge; const w = e.maxX - e.minX + 2 * marge; const h = e.maxY - e.minY + 2 * marge + marge * 0.6;
  const longueur = [1, 2, 5, 10, 20, 50].find((l) => l >= w / 6) ?? 50;
  return {
    viewBox: `${r1(minX)} ${r1(minY)} ${r1(w)} ${r1(h)}`, volumes, briques,
    rue: { x1: r1(minX), x2: r1(minX + w), y: r1(yRue) },
    echelle: { x: r1(minX + marge * 0.4), y: r1(minY + marge * 0.5), longueur, libelle: `${longueur} m` },
  };
}

// ---- Élévation de la façade sur rue ---------------------------------------------------------------------------

export interface DessinFacade {
  viewBox: string;
  /** Murs (rectangles) et toits (polygones), du fond vers l'avant. */
  murs: { id: string; x: number; y: number; l: number; h: number }[];
  toits: { id: string; points: string }[];
  ouvertures: { x: number; y: number; l: number; h: number; type: TypeOuverture }[];
  briques: { points: string }[];
  sol: { x1: number; x2: number; y: number };
}

/** Élévation : x vers la droite, z vers le haut (dessiné vers le haut : y SVG = -z). */
function silhouetteToit(v: VolumeModele, x0: number, x1: number): Point2[] {
  const z0 = hautMurs(v); const h = Math.max(0.15, hauteurToit(v)); const t = v.toit; const w = x1 - x0; const cx = (x0 + x1) / 2;
  const P = (x: number, z: number): Point2 => [x, -z];
  switch (t.forme) {
    case 'plat': case 'terrasse': return [P(x0, z0), P(x1, z0), P(x1, z0 + h), P(x0, z0 + h)];
    case 'deux_pans': return t.faitage === 'profondeur' ? [P(x0, z0), P(x1, z0), P(cx, z0 + h)] : [P(x0, z0), P(x1, z0), P(x1, z0 + h), P(x0, z0 + h)];
    case 'quatre_pans': { const i = Math.min(w / 2, h / Math.max(0.2, Math.tan((t.pente * Math.PI) / 180))); return [P(x0, z0), P(x1, z0), P(x1 - i, z0 + h), P(x0 + i, z0 + h)]; }
    case 'un_pan': return t.basVers === 'gauche' ? [P(x0, z0), P(x1, z0), P(x1, z0 + h)] : t.basVers === 'droite' ? [P(x0, z0), P(x1, z0), P(x0, z0 + h)] : [P(x0, z0), P(x1, z0), P(x1, z0 + h), P(x0, z0 + h)];
    case 'mansart': { const i = Math.min(w * 0.12, 1); return [P(x0, z0), P(x1, z0), P(x1 - i, z0 + h * 0.6), P(cx, z0 + h), P(x0 + i, z0 + h * 0.6)]; }
    case 'conique': case 'pyramide': return [P(x0, z0), P(x1, z0), P(cx, z0 + h)];
  }
}

export function facadePrincipale(m: ModeleBatiment): DessinFacade {
  // Du fond (y grand) vers la rue (y petit) : le volume le plus proche de la rue est dessiné en dernier.
  const parProfondeur = [...m.volumes].map((v) => ({ v, e: englobantTerrain(contourVolume(v)) })).sort((a, b) => b.e.minY - a.e.minY);
  const murs: DessinFacade['murs'] = []; const toits: DessinFacade['toits'] = [];
  let minX = Infinity; let maxX = -Infinity; let maxZ = 0;
  for (const { v, e } of parProfondeur) {
    murs.push({ id: v.id, x: r1(e.minX), y: r1(-hautMurs(v)), l: r1(e.maxX - e.minX), h: r1(hautMurs(v) - v.altitudeBase) });
    toits.push({ id: v.id, points: pts(silhouetteToit(v, e.minX, e.maxX)) });
    minX = Math.min(minX, e.minX); maxX = Math.max(maxX, e.maxX); maxZ = Math.max(maxZ, hautMurs(v) + hauteurToit(v));
  }
  // Ouvertures des façades tournées vers la rue (normale vers -y), placées le long de la façade.
  const ouvertures: DessinFacade['ouvertures'] = [];
  for (const o of ouverturesPosees(m)) {
    if (o.facade.normale[1] > -0.5 && o.type !== 'lucarne') continue;
    if (o.type === 'lucarne' && o.facade.cote !== 'avant') continue;
    const k = o.facade.longueur > 0 ? o.centre / o.facade.longueur : 0.5;
    const x = o.facade.gauche[0] + (o.facade.droite[0] - o.facade.gauche[0]) * k;
    ouvertures.push({ x: r1(x - o.largeur / 2), y: r1(-(o.bas + o.hauteur)), l: r1(o.largeur), h: r1(o.hauteur), type: o.type });
  }
  const briques: DessinFacade['briques'] = [];
  for (const el of m.elements) for (const b of el.briques) {
    const a = b.largeur / 2;
    const forme: Point2[] = b.forme === 'cone' || b.forme === 'pyramide' ? [[b.x - a, -b.z], [b.x + a, -b.z], [b.x, -(b.z + b.hauteur)]]
      : [[b.x - a, -b.z], [b.x + a, -b.z], [b.x + a, -(b.z + b.hauteur)], [b.x - a, -(b.z + b.hauteur)]];
    briques.push({ points: pts(forme) });
    minX = Math.min(minX, b.x - a); maxX = Math.max(maxX, b.x + a); maxZ = Math.max(maxZ, b.z + b.hauteur);
  }
  if (!Number.isFinite(minX)) { minX = -5; maxX = 5; }
  const marge = Math.max(1, 0.08 * Math.max(maxX - minX, maxZ));
  return {
    viewBox: `${r1(minX - marge)} ${r1(-maxZ - marge)} ${r1(maxX - minX + 2 * marge)} ${r1(maxZ + 1.5 * marge)}`,
    murs, toits, ouvertures, briques, sol: { x1: r1(minX - marge), x2: r1(maxX + marge), y: 0 },
  };
}

// ---- Liste lisible et portée ---------------------------------------------------------------------------------

export interface GroupeListe { categorie: CategoriePortee; titre: string; lignes: LignePortee[] }
const TITRES: Record<CategoriePortee, string> = { volume: 'Volumes', toit: 'Toits', ouverture: 'Ouvertures', element: 'Éléments', matiere: 'Matières' };
export const LIBELLE_PORTEE = { images: 'Dans la 3D et les images', '3d': 'Dans la 3D seulement', aucune: 'Noté, pas dessiné' } as const;

export function groupesListe(m: ModeleBatiment, statuts: StatutsRendu = STATUTS_RENDU): GroupeListe[] {
  const lignes = porteeModele(m, statuts);
  return (['volume', 'toit', 'ouverture', 'element', 'matiere'] as const)
    .map((c) => ({ categorie: c, titre: TITRES[c], lignes: lignes.filter((l) => l.categorie === c) }))
    .filter((g) => g.lignes.length > 0);
}

/**
 * VIS-34 — étiquettes VRAIES : tant que ce dessin n'est pas le projet en vigueur de la conversation (pas encore envoyé à la
 * 3D, ou remplacé), rien n'est « dans la 3D et les images » : on dit « prévu ». `place` : placeDuDessin (projetEnVigueur.ts).
 */
export const LIBELLE_PORTEE_PREVU = { images: 'Prévu : 3D et images', '3d': 'Prévu : 3D seulement', aucune: 'Noté, pas dessiné' } as const;
export type PlaceCarte = 'projet' | 'batiment' | 'pas_en_vigueur';
export function libellePortee(portee: keyof typeof LIBELLE_PORTEE, place: PlaceCarte = 'projet'): string {
  return place === 'pas_en_vigueur' ? LIBELLE_PORTEE_PREVU[portee] : LIBELLE_PORTEE[portee];
}

/** Pied de carte : « 14 parties dans la 3D et les images · 1 dans la 3D seulement » (« prévues pour… » hors projet en vigueur). */
export function phrasePortee(groupes: readonly GroupeListe[], place: PlaceCarte = 'projet'): string {
  const toutes = groupes.flatMap((g) => g.lignes);
  const img = toutes.filter((l) => l.portee === 'images').length; const seul = toutes.filter((l) => l.portee === '3d').length;
  const aucune = toutes.filter((l) => l.portee === 'aucune').length;
  const prevu = place === 'pas_en_vigueur';
  return [
    prevu ? `${img} partie${img > 1 ? 's' : ''} prévue${img > 1 ? 's' : ''} pour la 3D et les images` : `${img} partie${img > 1 ? 's' : ''} dans la 3D et les images`,
    seul ? (prevu ? `${seul} pour la 3D seulement` : `${seul} dans la 3D seulement`) : null,
    aucune ? `${aucune} noté${aucune > 1 ? 's' : ''}, pas dessiné${aucune > 1 ? 's' : ''}` : null,
  ].filter(Boolean).join(' · ');
}

// ---- État de la carte dans la conversation ----------------------------------------------------------------

interface MessageLu { id: string; role: string; text: string; toolCalls?: readonly { name: string; status?: string; output?: unknown }[] }
export type EtatCarte = 'a_envoyer' | 'envoyee' | 'remplacee';

/**
 * La carte (message `messageId`, empreinte `empreinte`) : envoyée (un message « Reproduire en 3D » plus bas porte sa
 * référence), remplacée (une carte plus récente du modèle — retouche ou nouveau dessin — se trouve plus bas), ou à envoyer.
 */
export function etatCarte(messages: readonly MessageLu[], messageId: string, empreinte: string): EtatCarte {
  const i = messages.findIndex((m) => m.id === messageId);
  if (i < 0) return 'a_envoyer';
  let envoyee = false;
  for (let k = i + 1; k < messages.length; k++) {
    const m = messages[k]!;
    if (m.role === 'user') { const r = referenceModeleDuMessage(m.text); if (r?.ok && r.empreinte === empreinte) envoyee = true; continue; }
    if ((m.toolCalls ?? []).some((tc) => lireCarteModele(tc) !== null)) return envoyee ? 'envoyee' : 'remplacee';
  }
  return envoyee ? 'envoyee' : 'a_envoyer';
}

/**
 * VIS-26 lot D : la 3D de CE dessin a-t-elle été préparée ? Vrai si, plus bas que la carte, une préparation réussie
 * (`studio_preparer_3d`) porte le dessin de même empreinte (`batiment_decrit.modele.empreinte`). Sert au lien discret
 * « Voir dans le Studio » de la carte (jamais un second bouton principal).
 */
export function troisDPreparee(messages: readonly MessageLu[], messageId: string, empreinte: string): boolean {
  const i = messages.findIndex((m) => m.id === messageId);
  if (i < 0) return false;
  for (let k = i + 1; k < messages.length; k++) {
    for (const tc of messages[k]!.toolCalls ?? []) {
      if (tc.name !== 'studio_preparer_3d' || tc.status === 'running' || !estObj(tc.output) || tc.output.status !== 'ok' || !estObj(tc.output.data)) continue;
      const bd = tc.output.data.batiment_decrit;
      if (estObj(bd) && estObj(bd.modele) && bd.modele.empreinte === empreinte) return true;
    }
  }
  return false;
}

const A_UN_BRIEF = /```mimmoza-brief[ \t]*\r?\n/;

/**
 * Bâtiment DESSINÉ en vigueur dans la conversation affichée — même règle que le serveur (copilot-chat/agent/studio.ts::
 * modeleDuFil) : le DERNIER message d'habillage de l'utilisateur, s'il porte la référence d'un modèle (bouton
 * « Reproduire en 3D »), et ce modèle retrouvé (même empreinte) dans une carte plus haut. null sinon (jamais deviné) :
 * un habillage choisi ensuite dans l'Espace 3D le remplace. Sert à « Voir en 3D » (complément `modeleBatiment` du Studio).
 */
export function modeleCourant(messages: readonly MessageLu[]): ModeleBatiment | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== 'user' || !A_UN_BRIEF.test(m.text)) continue;
    const r = referenceModeleDuMessage(m.text);
    if (!r?.ok) return null;
    for (let k = i - 1; k >= 0; k--) {
      for (const tc of messages[k]!.toolCalls ?? []) {
        const c = lireCarteModele(tc);
        if (c && c.empreinte === r.empreinte) return c.modele;
      }
    }
    return null;
  }
  return null;
}

/** Alias demandé par l'intégration de « Voir en 3D » (MimmozIAPage) : même règle que `modeleCourant`. */
export const dernierModeleDuFil = modeleCourant;
