// src/lib/studio/modeleBatimentMessage.ts — VIS-25 lot B : le modèle COMPOSÉ du bâtiment dans le CHAT.
// COPIE À L'IDENTIQUE dans mimmozia-studio/src/core/echange/modeleBatimentMessage.ts (la machine de rendu y lit les
// mêmes listes honnêtes « dans la 3D et les images » / « dans la 3D seulement »).
// =============================================================================
// Ce module ne touche PAS au contrat (modeleBatiment.ts, lot A). Il ajoute ce dont le chat a besoin :
//   1. la RÉFÉRENCE du modèle portée par le message du bouton « Reproduire en 3D » (```mimmoza-modele-ref```) :
//      le message ne transporte pas le modèle entier (un message du chat est limité à 8 000 caractères) mais son
//      EMPREINTE ; le serveur retrouve le modèle dans les résultats d'outils de LA conversation de L'utilisateur ;
//      le message porte aussi la description VIS-22 la plus proche (```mimmoza-batiment```) et son habillage
//      (```mimmoza-brief```) : tout le trajet VIS-22 (forme et hauteur demandées au moteur, habillage des rendus,
//      clauses du Studio) continue de fonctionner tel quel ;
//   2. la PORTÉE honnête de chaque partie du modèle : « dans la 3D et les images » ou « dans la 3D seulement »
//      (une matière dont la texture n'est pas validée pour le photoréalisme est dite) ;
//   3. les avertissements du rendu (repris par le devis et par la machine de rendu).
// PUR : imports relatifs .ts seulement (Vite, tsx, vitest, Deno).
// =============================================================================

import { messageReproduire, MENTION_PHOTO } from './descriptionBatiment.ts';
import {
  LIBELLES_ELEMENT_MODELE, LIBELLES_OUVERTURE, LIBELLES_PLAN, LIBELLES_TOIT_MODELE, toitEnPente, versDescriptionBatiment,
  type ElementModele, type Matiere, type ModeleBatiment, type PartieMatiere, type TypeElementModele,
} from './modeleBatiment.ts';

/** Langue du bloc de RÉFÉRENCE porté par le message « Reproduire en 3D ». */
export const MODELE_REF_LANGUE = 'mimmoza-modele-ref';
export const MODELE_REF_VERSION = 1;
const RE_EMPREINTE = /^mb1-[0-9a-f]{8}$/;
const RE_BLOC_REF = new RegExp('```' + MODELE_REF_LANGUE + '[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n?```');

/** Noms des outils du chat (lot B). */
export const OUTIL_DESSINER_BATIMENT = 'studio_dessiner_batiment';
export const OUTIL_RETOUCHER_BATIMENT = 'studio_retoucher_batiment';
export const OUTILS_MODELE: readonly string[] = [OUTIL_DESSINER_BATIMENT, OUTIL_RETOUCHER_BATIMENT];

/** Message du bouton « Reproduire en 3D » : description VIS-22 + habillage + référence du modèle (empreinte). */
export function messageReproduireModele(m: ModeleBatiment, empreinte: string): string {
  return `${messageReproduire(versDescriptionBatiment(m))}\n\n\`\`\`${MODELE_REF_LANGUE}\n${JSON.stringify({ v: MODELE_REF_VERSION, empreinte })}\n\`\`\``;
}

export type ReferenceModele = { ok: true; empreinte: string } | { ok: false; erreur: string };

/** Bloc ```mimmoza-modele-ref``` d'un message → empreinte. null : pas de bloc. */
export function referenceModeleDuMessage(texte: unknown): ReferenceModele | null {
  if (typeof texte !== 'string') return null;
  const m = RE_BLOC_REF.exec(texte);
  if (!m) return null;
  let brut: unknown;
  try { brut = JSON.parse(m[1] ?? ''); } catch { return { ok: false, erreur: 'Référence du bâtiment illisible.' }; }
  const o = typeof brut === 'object' && brut !== null ? brut as Record<string, unknown> : {};
  if (o.v !== MODELE_REF_VERSION || typeof o.empreinte !== 'string' || !RE_EMPREINTE.test(o.empreinte)) return { ok: false, erreur: 'Référence du bâtiment illisible.' };
  return { ok: true, empreinte: o.empreinte };
}

/** Texte sans le bloc de référence (bulle de l'utilisateur). */
export function sansBlocReference(texte: string): { visible: string; reference: boolean } {
  const m = RE_BLOC_REF.exec(texte);
  if (!m) return { visible: texte, reference: false };
  return { visible: (texte.slice(0, m.index) + texte.slice(m.index + m[0].length)).replace(/\n{3,}/g, '\n\n').trim(), reference: true };
}

// ---- Portée honnête : ce qui atteint la 3D, ce qui atteint aussi les images -----------------------------

/**
 * 'images' : dans la 3D et dans les images ; '3d' : dans la 3D seulement (Studio), pas dans les images ;
 * 'aucune' : noté mais pas dessiné (ni forme connue ni briques, ou élément sans support) — même règle que le moteur du Studio.
 */
export type Portee = 'images' | '3d' | 'aucune';
export type CategoriePortee = 'volume' | 'toit' | 'ouverture' | 'element' | 'matiere';
export interface LignePortee {
  categorie: CategoriePortee;
  /** Identifiant dans le modèle (volume, ouverture, élément) ou partie (matière). */
  id: string;
  libelle: string;
  detail: string;
  portee: Portee;
  /** Pourquoi pas dans les images, en une phrase simple. */
  note: string | null;
}

/** Statut de rendu d'une référence du catalogue extérieur (VIS-24) : 'oui' | 'reserve' | 'non' ; absent → inconnu. */
export type StatutsRendu = Readonly<Record<string, 'oui' | 'reserve' | 'non'>>;

/**
 * Éléments typés que le moteur du Studio construit mais que la machine de rendu ne montre pas encore dans les images.
 * Tenu ici (et seulement ici) : la carte, le devis et la machine de rendu disent la même chose.
 * Raison commune : la machine de rendu construit le bâtiment à partir du modèle par le moteur du Studio (même
 * géométrie que le Studio) — tout ce qui est géométrie y est ; il n'y manque que ce qui demande un objet 3D certifié.
 */
export const ELEMENTS_3D_SEULEMENT: Readonly<Partial<Record<TypeElementModele, string>>> = {};
const NOTE_MATIERE_NON = 'texture pas encore validée pour les images (photoréalisme) : elle peut y être remplacée par une teinte unie';
const NOTE_NON_DESSINE = 'ni forme connue ni briques : noté, pas dessiné';
const NOTE_SANS_SUPPORT = 'ni volume porteur ni briques : noté, pas dessiné';
const NOTE_MATIERE_RESERVE = 'reprise avec une réserve (teinte unie ou gros plan)';

const fr = (x: number): string => String(Math.round(x * 10) / 10).replace('.', ',');
const niveauxTexte = (n: number): string => (n <= 1 ? 'rez-de-chaussée' : `R+${n - 1}`);
const LIBELLES_PARTIE: Record<PartieMatiere, string> = {
  murs: 'Murs', toiture: 'Toiture', menuiseries: 'Menuiseries', volets: 'Volets', soubassement: 'Soubassement', boiseries: 'Boiseries',
  garde_corps: 'Garde-corps', sol: 'Sol',
};

export function nomElement(e: Pick<ElementModele, 'type' | 'nom'>): string {
  const base = e.type === 'autre' ? (e.nom ?? 'élément') : LIBELLES_ELEMENT_MODELE[e.type];
  const t = e.type !== 'autre' && e.nom && e.nom.toLowerCase() !== base.toLowerCase() ? `${base} (${e.nom})` : base;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function texteMatiere(x: Matiere): string {
  return [x.refStudio ?? null, x.famille ?? null, x.couleur ?? null].filter(Boolean).join(' · ') || 'matière libre';
}

/** Ce que chaque partie du modèle devient : dans la 3D et les images, ou dans la 3D seulement (avec la raison). */
export function porteeModele(m: ModeleBatiment, statuts: StatutsRendu = {}): LignePortee[] {
  const out: LignePortee[] = [];
  for (const v of m.volumes) {
    out.push({
      categorie: 'volume', id: v.id, libelle: v.nom ?? v.id,
      detail: `${LIBELLES_PLAN[v.plan.type]}, ${niveauxTexte(v.niveaux)}, ${fr(v.hauteur)} m de murs${v.altitudeBase > 0 ? `, posé à ${fr(v.altitudeBase)} m` : ''}`,
      portee: 'images', note: null,
    });
    const t = v.toit;
    out.push({
      categorie: 'toit', id: v.id, libelle: `Toit — ${v.nom ?? v.id}`,
      detail: `${LIBELLES_TOIT_MODELE[t.forme]}${toitEnPente(t.forme) ? ` ${fr(t.pente)}°` : ''}${t.vegetalise ? ', végétalisé' : ''}`,
      portee: 'images', note: null,
    });
  }
  const groupes = new Map<string, { n: number; ids: string[] }>();
  for (const o of m.ouvertures) {
    const k = LIBELLES_OUVERTURE[o.type];
    const g = groupes.get(k) ?? { n: 0, ids: [] };
    g.n += o.nombre; g.ids.push(o.id); groupes.set(k, g);
  }
  for (const [k, g] of groupes) out.push({ categorie: 'ouverture', id: g.ids.join(','), libelle: k, detail: `${g.n} au total`, portee: 'images', note: null });
  for (const e of m.elements) {
    const raison = ELEMENTS_3D_SEULEMENT[e.type] ?? null;
    // Même règle que le moteur du Studio (construireModele) : sans briques, un élément « autre » ou sans volume porteur n'est pas dessiné.
    const nonDessine = e.briques.length ? null : (e.type === 'autre' ? NOTE_NON_DESSINE : !e.volume && e.type !== 'volets' ? NOTE_SANS_SUPPORT : null);
    out.push({
      categorie: 'element', id: e.id, libelle: nomElement(e),
      detail: e.briques.length ? `composé de ${e.briques.length} brique${e.briques.length > 1 ? 's' : ''}` : 'élément typé',
      portee: nonDessine ? 'aucune' : raison ? '3d' : 'images', note: nonDessine ?? raison,
    });
  }
  const parties = new Map<PartieMatiere, Matiere>();
  for (const [p, x] of Object.entries(m.matieres) as [PartieMatiere, Matiere][]) if (x) parties.set(p, x);
  for (const v of m.volumes) for (const [p, x] of Object.entries(v.matieres) as [PartieMatiere, Matiere][]) if (x && !parties.has(p)) parties.set(p, x);
  for (const [p, x] of parties) {
    const s = x.refStudio ? statuts[x.refStudio] : undefined;
    out.push({
      categorie: 'matiere', id: p, libelle: LIBELLES_PARTIE[p], detail: texteMatiere(x),
      portee: s === 'non' ? '3d' : 'images', note: s === 'non' ? NOTE_MATIERE_NON : s === 'reserve' ? NOTE_MATIERE_RESERVE : null,
    });
  }
  return out;
}

/** Avertissements du rendu pour un modèle (devis et machine de rendu) : jamais un élément tu. */
export function avertissementsModele(m: ModeleBatiment, statuts: StatutsRendu = {}): string[] {
  const lignes = porteeModele(m, statuts);
  const seul3d = lignes.filter((l) => l.portee === '3d' && l.categorie !== 'matiere').map((l) => `${l.libelle.toLowerCase()} (${l.note})`);
  const aucune = lignes.filter((l) => l.portee === 'aucune').map((l) => `${l.libelle.toLowerCase()} (${l.note})`);
  const matieres = lignes.filter((l) => l.categorie === 'matiere' && l.note).map((l) => `${l.libelle.toLowerCase()} : ${l.note}`);
  const briques = m.elements.filter((e) => e.briques.length > 0).length;
  return [
    ...(m.origine === 'photo' ? [`Bâtiment dessiné d’après une photo. ${MENTION_PHOTO}`] : []),
    'Bâtiment construit à partir du dessin du chat (volumes, toits, ouvertures, éléments) ; posé sur la 3D préparée du terrain.',
    ...(briques ? [`${briques} élément${briques > 1 ? 's' : ''} composé${briques > 1 ? 's' : ''} de formes simples : ${briques > 1 ? 'ils sont dessinés' : 'il est dessiné'} en volumes simples (pas d’objet 3D détaillé).`] : []),
    ...(seul3d.length ? [`Dans la 3D seulement, pas dans les images : ${seul3d.join(' ; ')}.`] : []),
    ...(aucune.length ? [`Noté mais pas dessiné : ${aucune.join(' ; ')}.`] : []),
    ...(matieres.length ? [`Matières : ${matieres.join(' ; ')}.`] : []),
    'Photoréalisme : un objet sans modèle 3D validé (mobilier, végétation, détail décoratif) peut être omis de l’image ; il est alors signalé.',
  ];
}
