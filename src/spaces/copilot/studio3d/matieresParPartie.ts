// src/spaces/copilot/studio3d/matieresParPartie.ts
// =============================================================================
// VIS-32 — LISTE BLANCHE des matières du catalogue extérieur par partie du bâtiment, PARTAGÉE par le site (carte
// d'habillage, matieresCatalogue.ts) et le serveur (copilot-chat/agent/studio.ts, validerBrief : import Deno avec
// extension `.ts`). Module PUR : il n'importe que catalogueExterieur.ts (généré, sans dépendance).
//
// Candidates d'une partie (règle VIS-31, inchangée) : matières RENDUES (« oui » ou « réserve ») du catalogue, dont la
// famille / l'application correspond à la partie. TRANSMISSIBLES (VIS-32) : celles que la machine de rendu sait poser
// telles quelles sur un bâtiment du Studio, c.-à-d. les références de la bibliothèque de matières du bâtiment
// (`av-…` ArchViz, `pm-…` premium, `rg-…` régional : getPbrMaterial du Studio). Les `qm-…` (matières du moteur de
// QUARTIER) n'en font pas partie : elles restent traduites vers la valeur fermée la plus proche (repli VIS-31), dit.
// =============================================================================
import { CATALOGUE_EXTERIEUR, normaliserTexte, type EntreeCatalogueExterieur } from './catalogueExterieur.ts';

export type PartieCatalogue = 'facade' | 'soubassement' | 'menuiseries' | 'garde_corps' | 'toiture';
export const PARTIES_CATALOGUE: readonly PartieCatalogue[] = ['facade', 'soubassement', 'menuiseries', 'garde_corps', 'toiture'];
export const LIBELLES_PARTIE_CATALOGUE: Readonly<Record<PartieCatalogue, string>> = {
  facade: 'façade', soubassement: 'soubassement', menuiseries: 'menuiseries', garde_corps: 'garde-corps', toiture: 'toiture',
};

const RENDUES = CATALOGUE_EXTERIEUR.filter((e) => e.nature === 'matiere' && e.rendu !== 'non' && !!e.refStudio && /^(?:av|pm|rg|qm)-/.test(e.refStudio));
export const motsEntree = (e: EntreeCatalogueExterieur): string => normaliserTexte(`${e.nom} ${e.refStudio ?? ''}`);
const relieA = (e: EntreeCatalogueExterieur, champ: string): boolean => e.choixBrief.some((c) => c.champ === champ);

/** Matières candidates de chaque partie (catalogue, rendues seulement) — règle VIS-31. */
const CANDIDATES: Readonly<Record<PartieCatalogue, (e: EntreeCatalogueExterieur) => boolean>> = {
  facade: (e) => relieA(e, 'facade') || relieA(e, 'teinte') || (e.famille === 'facades' && e.application !== 'Quartier : soubassement'),
  soubassement: (e) => relieA(e, 'soubassement')
    || (e.famille === 'facades' && (/soubassement/i.test(e.application) || /pierre|gres|silex|moellon|meuliere|calcaire|beton|brique/.test(motsEntree(e)))),
  menuiseries: (e) => relieA(e, 'menuiseries')
    || (e.famille === 'menuiseries' && ['Cadres des fenêtres et des portes', 'Menuiseries en bois peint', 'Fenêtres et vitrages'].includes(e.application) && !/verre/.test(motsEntree(e))),
  garde_corps: (e) => e.famille === 'balcons',
  toiture: (e) => relieA(e, 'toiture')
    || (e.famille === 'toitures' && ['Couverture du toit', 'Couverture et zinguerie'].includes(e.application) && !/gouttiere/.test(motsEntree(e))),
};

/** Entrées candidates d'une partie (non triées). */
export const candidatesDeLaPartie = (partie: PartieCatalogue): EntreeCatalogueExterieur[] => RENDUES.filter(CANDIDATES[partie]);

/** Vrai : la machine de rendu pose cette référence telle quelle sur un bâtiment du Studio (bibliothèque du bâtiment). */
export const referenceTransmissible = (ref: string | null | undefined): boolean => typeof ref === 'string' && /^(?:av|pm|rg)-[a-z0-9-]{1,60}$/.test(ref);

export interface MatiereAutorisee { readonly ref: string; readonly nom: string; readonly rendu: 'oui' | 'reserve'; readonly noteRendu: string }

/** Liste blanche : par partie, les références transmissibles (rendu « oui » ou « réserve »). */
export const LISTE_BLANCHE_MATIERES: Readonly<Record<PartieCatalogue, ReadonlyMap<string, MatiereAutorisee>>> = Object.fromEntries(
  PARTIES_CATALOGUE.map((p) => [p, new Map(candidatesDeLaPartie(p).filter((e) => referenceTransmissible(e.refStudio))
    .map((e) => [e.refStudio!, { ref: e.refStudio!, nom: e.nom, rendu: e.rendu === 'oui' ? 'oui' : 'reserve', noteRendu: e.noteRendu } as const]))]),
) as unknown as Record<PartieCatalogue, ReadonlyMap<string, MatiereAutorisee>>;

export const matiereAutorisee = (partie: PartieCatalogue, ref: unknown): MatiereAutorisee | null =>
  typeof ref === 'string' ? LISTE_BLANCHE_MATIERES[partie].get(ref) ?? null : null;

export type MatieresBrief = Partial<Record<PartieCatalogue, string>>;

/**
 * Champ `matieres` d'un brief → références retenues (liste blanche) + ce qui est IGNORÉ (phrases à dire). Ne refuse
 * jamais : une clé ou une référence inconnue est écartée et nommée.
 */
export function lireMatieresBrief(brut: unknown): { matieres: MatieresBrief; ignorees: string[] } {
  const matieres: MatieresBrief = {};
  const ignorees: string[] = [];
  if (brut === undefined || brut === null) return { matieres, ignorees };
  if (typeof brut !== 'object' || Array.isArray(brut)) return { matieres, ignorees: ['matières du catalogue illisibles (objet attendu), ignorées'] };
  for (const [cle, v] of Object.entries(brut as Record<string, unknown>).slice(0, 12)) {
    const court = (x: unknown) => String(x).replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 40);
    if (!(PARTIES_CATALOGUE as readonly string[]).includes(cle)) { ignorees.push(`partie « ${court(cle)} » inconnue, ignorée`); continue; }
    const p = cle as PartieCatalogue;
    if (v === undefined || v === null) continue;
    const m = matiereAutorisee(p, v);
    if (!m) { ignorees.push(`${LIBELLES_PARTIE_CATALOGUE[p]} : matière « ${court(v)} » hors du catalogue rendu, ignorée`); continue; }
    matieres[p] = m.ref;
  }
  return { matieres, ignorees };
}
