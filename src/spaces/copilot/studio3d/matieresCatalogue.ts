// src/spaces/copilot/studio3d/matieresCatalogue.ts
// =============================================================================
// VIS-31 — « Toutes les matières » dans la carte d'habillage (étape 4 « Style & façades »). Logique PURE (testée par
// vis31CatalogueMatieres.test.ts) : quelles matières du catalogue extérieur (catalogueExterieur.ts, généré) peuvent
// habiller chaque partie du bâtiment, et comment chacune se traduit dans le brief (briefCreatif.ts) :
//   exacte    → le catalogue la relie à une valeur fermée du brief (choixBrief) : rendue telle quelle ;
//   approchée → valeur fermée la plus proche (même famille de matière) : rendue « comme » cette valeur ;
//   aucune    → pas d'équivalent : la valeur fermée en place est gardée, et c'est dit.
// Seules les matières RENDUES (pleinement ou avec réserve) sont proposées ; « avec réserve » est toujours affiché.
// Module séparé de briefCreatif.ts : le catalogue (≈ 100 Ko) n'est téléchargé qu'à l'ouverture de « Toutes les matières ».
// =============================================================================
import { type EntreeCatalogueExterieur } from './catalogueExterieur.ts';
// VIS-32 : candidates et liste blanche partagées avec le serveur (module pur).
import { candidatesDeLaPartie, motsEntree, referenceTransmissible } from './matieresParPartie.ts';
import {
  FACADES, SOUBASSEMENTS, TOITURES, TRANSMETTRE_REFERENCES_CATALOGUE, libelleTeinte,
  type ChoixBrief, type Facade, type GardeCorps, type MatiereCatalogueChoisie, type Menuiseries, type PartieMatiere, type Soubassement,
  type Teinte, type Toiture,
} from './briefCreatif.ts';

export type Traduction = 'exacte' | 'approchee' | 'aucune';
export interface TraductionMatiere {
  readonly traduction: Traduction;
  /** Valeurs fermées du brief à appliquer (vide si « aucune »). */
  readonly champs: Partial<ChoixBrief>;
  /** Libellé de la valeur fermée rendue (« Pierre claire », « Deux pans, zinc ») ; null si « aucune ». */
  readonly rendueComme: string | null;
}

const mots = motsEntree;
const RE_MINERAL = /pierre|gres|silex|moellon|meuliere|calcaire|marbre/;

const ORDRE_TRADUCTION: Record<Traduction, number> = { exacte: 0, approchee: 1, aucune: 2 };

/** Matières proposées pour une partie : exactes d'abord, puis approchées, puis sans équivalent ; rendues avant « avec réserve ». */
export function matieresDeLaPartie(partie: PartieMatiere): EntreeCatalogueExterieur[] {
  return candidatesDeLaPartie(partie).sort((a, b) =>
    ORDRE_TRADUCTION[traduireMatiere(partie, a).traduction] - ORDRE_TRADUCTION[traduireMatiere(partie, b).traduction]
    || (a.rendu === b.rendu ? 0 : a.rendu === 'oui' ? -1 : 1)
    || a.nom.localeCompare(b.nom, 'fr'));
}

const LIB_MENUISERIES: Record<Menuiseries, string> = { gris: 'Menuiseries alu gris', anthracite: 'Menuiseries anthracite', blanc: 'Menuiseries blanches', bronze: 'Menuiseries bronze' };
const LIB_GARDE_CORPS: Record<GardeCorps, string> = { metal: 'Garde-corps en métal', verre: 'Garde-corps en verre', plein: 'Garde-corps pleins' };
const lib = <V>(liste: readonly { valeur: V; libelle: string }[], v: V): string => liste.find((o) => o.valeur === v)!.libelle;
function libelleFacade(f: Facade, t: Teinte): string { return t === 'naturelle' ? lib(FACADES, f) : libelleTeinte(f, t); }

/** Façade la plus proche (mots du nom et de l'identifiant). Colombage → enduit blanc (remplissage) ; métal → aucune. */
function facadeProche(t: string): { facade: Facade; teinte: Teinte } | null {
  if (/colombage/.test(t)) return { facade: 'enduit_blanc', teinte: 'naturelle' };
  if (/torchis/.test(t)) return { facade: 'enduit_clair', teinte: 'naturelle' };
  if (/verre/.test(t)) return { facade: 'verre', teinte: 'naturelle' };
  if (/brique/.test(t)) return { facade: 'brique', teinte: /claire|normande|orangee/.test(t) ? 'claire' : 'naturelle' };
  if (/beton/.test(t)) return { facade: 'beton', teinte: /clair|blanc/.test(t) ? 'claire' : 'naturelle' };
  if (/bois|bardage|meleze|douglas|lames/.test(t)) return { facade: 'bardage_bois', teinte: /brule|noirci|fonce|shou/.test(t) ? 'foncee' : 'naturelle' };
  if (RE_MINERAL.test(t)) return { facade: 'pierre', teinte: 'naturelle' };
  if (/enduit/.test(t)) return { facade: /blanc|perle/.test(t) ? 'enduit_blanc' : 'enduit_clair', teinte: 'naturelle' };
  return null;
}
function soubassementProche(t: string): Exclude<Soubassement, 'aucun'> | null {
  if (RE_MINERAL.test(t)) return 'pierre';
  if (/beton/.test(t)) return 'beton';
  if (/brique/.test(t)) return 'brique';
  return null;
}
function menuiseriesProches(t: string): Menuiseries | null {
  if (/blanc/.test(t)) return 'blanc';
  if (/noir|anthracite/.test(t)) return 'anthracite';
  if (/bronze|chene|bois/.test(t)) return 'bronze';
  if (/gris|anodise|alumin/.test(t)) return 'gris';
  return null;
}
function gardeCorpsProche(t: string): GardeCorps | null {
  if (/verre/.test(t)) return 'verre';
  if (/acier|metal/.test(t)) return 'metal';
  return null;
}
function toitureProche(t: string): Toiture | null {
  if (/vegetal/.test(t)) return 'vegetalisee';
  if (/tuile/.test(t)) return 'deux_pans_tuiles';
  if (/ardoise/.test(t)) return 'deux_pans_ardoise';
  if (/zinc|cuivre/.test(t)) return 'deux_pans_zinc';
  if (/membrane/.test(t)) return 'terrasse';
  return null;
}

/** Comment une matière du catalogue se traduit dans le brief, pour une partie. */
export function traduireMatiere(partie: PartieMatiere, e: EntreeCatalogueExterieur): TraductionMatiere {
  const t = mots(e);
  const aucune: TraductionMatiere = { traduction: 'aucune', champs: {}, rendueComme: null };
  switch (partie) {
    case 'facade': {
      const exacte = e.choixBrief.find((c) => c.champ === 'facade') ?? e.choixBrief.find((c) => c.champ === 'teinte');
      if (exacte) {
        const [facade, teinte] = (exacte.champ === 'facade' ? [exacte.valeur, 'naturelle'] : exacte.valeur.split(':')) as [Facade, Teinte];
        return { traduction: 'exacte', champs: { facade, teinte }, rendueComme: libelleFacade(facade, teinte) };
      }
      const p = facadeProche(t);
      return p ? { traduction: 'approchee', champs: { ...p }, rendueComme: libelleFacade(p.facade, p.teinte) } : aucune;
    }
    case 'soubassement': {
      const exacte = e.choixBrief.find((c) => c.champ === 'soubassement');
      const v = (exacte?.valeur as Soubassement | undefined) ?? soubassementProche(t);
      return v ? { traduction: exacte ? 'exacte' : 'approchee', champs: { soubassement: v }, rendueComme: `Soubassement en ${lib(SOUBASSEMENTS, v).toLowerCase()}` } : aucune;
    }
    case 'menuiseries': {
      const exacte = e.choixBrief.find((c) => c.champ === 'menuiseries');
      const v = (exacte?.valeur as Menuiseries | undefined) ?? menuiseriesProches(t);
      return v ? { traduction: exacte ? 'exacte' : 'approchee', champs: { menuiseries: v }, rendueComme: LIB_MENUISERIES[v] } : aucune;
    }
    case 'garde_corps': {
      const v = gardeCorpsProche(t);
      return v ? { traduction: 'approchee', champs: { garde_corps: v }, rendueComme: LIB_GARDE_CORPS[v] } : aucune;
    }
    case 'toiture': {
      const exacte = e.choixBrief.find((c) => c.champ === 'toiture');
      const v = (exacte?.valeur as Toiture | undefined) ?? toitureProche(t);
      return v ? { traduction: exacte ? 'exacte' : 'approchee', champs: { toiture: v }, rendueComme: lib(TOITURES, v) } : aucune;
    }
  }
}

/** VIS-32 : vrai = la référence part dans le brief et la machine de rendu la pose telle quelle (av-, pm-, rg-). */
export const estTransmise = (e: Pick<EntreeCatalogueExterieur, 'refStudio'>): boolean => TRANSMETTRE_REFERENCES_CATALOGUE && referenceTransmissible(e.refStudio);

/** Matière choisie, telle que la carte la garde (et la dit dans le message). */
export function matiereChoisie(partie: PartieMatiere, e: EntreeCatalogueExterieur): MatiereCatalogueChoisie {
  const tr = traduireMatiere(partie, e);
  const transmise = estTransmise(e);
  return {
    ref: e.refStudio ?? e.id, nom: e.nom, rendu: e.rendu === 'oui' ? 'oui' : 'reserve', noteRendu: e.noteRendu,
    exacte: tr.traduction === 'exacte' || transmise, rendueComme: tr.traduction === 'exacte' || transmise ? null : tr.rendueComme,
    ...(transmise ? { transmise: true } : {}),
  };
}

/**
 * VIS-32 — matière d'un brief connu (référence seule, relue à la réouverture de la carte) → matière complète (nom, statut,
 * traduction) ; null si la référence n'est plus proposée pour cette partie (elle est alors retirée de la carte).
 */
export function matiereDepuisRef(partie: PartieMatiere, ref: string): MatiereCatalogueChoisie | null {
  const e = candidatesDeLaPartie(partie).find((x) => x.refStudio === ref);
  return e ? matiereChoisie(partie, e) : null;
}

/** Phrase courte « dans le rendu » d'une carte du sélecteur (`e` : l'entrée, pour savoir si elle est transmise telle quelle). */
export function phraseRendu(tr: TraductionMatiere, e?: Pick<EntreeCatalogueExterieur, 'refStudio'>): string {
  if (tr.traduction === 'exacte' || (e && estTransmise(e))) return 'Rendue telle quelle dans les images.';
  if (tr.traduction === 'approchee') return `Rendue pour l’instant comme « ${tr.rendueComme} » (matière la plus proche).`;
  return 'Pas encore d’équivalent dans le rendu : le choix est noté, le rendu garde la matière actuelle.';
}
