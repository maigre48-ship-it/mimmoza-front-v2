// src/spaces/copilot/studio3d/modeleTravail.ts
// =============================================================================
// VIS-26 lot D — le bâtiment DESSINÉ suit l'aperçu et les images lancés depuis l'Espace 3D (FilmVisitePanel :
// étape 7 « aperçu », étape 8 « images finales », film et visite 360°).
//
// Avant : FilmVisitePanel construisait la fiche du travail (`studio_jobs.fiche`) sans le dessin ; seul le rendu lancé par
// Mimmo dans le chat (copilot-chat/agent/studio.ts::ficheDepuisPreparation) l'emportait. Maintenant le dessin en vigueur
// (même règle que « Voir en 3D » : dernier « Reproduire en 3D » non supplanté, modeleBatimentChat.modeleCourant) part
// dans `fiche.modele_batiment` — le champ que la machine de rendu lit déjà (mimmozia-studio/worker/src/fiche.ts →
// modeleBatiment.ts::lireModeleFiche) — ramené à la hauteur de la 3D préparée (même règle que le chat :
// src/lib/studio/modeleBatimentFiche.ts). Ne change rien au prix (aucun débit côté site pour ce champ).
//
// Cas laissés sans dessin (dits par `note`) : projet d'extension (maison existante conservée), composition de bâtiments.
// Plusieurs bâtiments (`charge.batiments`) : le dessin est joint ; la machine de rendu ne le construit pas et le DIT
// dans les avertissements du rendu (« seul son habillage est appliqué »).
// Logique PURE (testée par modeleTravail.test.ts, `npx tsx --test`).
// =============================================================================
import type { ModeleBatiment } from '../../../lib/studio/modeleBatiment.ts';
import { ficheModeleBatiment, type FicheModeleBatiment } from '../../../lib/studio/modeleBatimentFiche.ts';
import { jarvisMassing, parseJarvisDraft } from './jarvisDraft.ts';
import { CATALOGUE_EXTERIEUR } from './catalogueExterieur.ts';

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Références du catalogue extérieur (mêmes que l'Edge : dessin-batiment.ts::REFS_CATALOGUE). */
export const REFS_CATALOGUE_SITE: readonly string[] = CATALOGUE_EXTERIEUR.map((e) => e.refStudio).filter((r): r is string => typeof r === 'string' && /^(?:av|qm)-/.test(r));

export const NOTE_EXTENSION = 'Bâtiment dessiné non joint : ce rendu porte sur l’extension de la maison existante.';
export const NOTE_COMPOSITION = 'Bâtiment dessiné non joint : la 3D préparée compte plusieurs bâtiments ; le rendu applique seulement son habillage.';
export const NOTE_HAUTEUR_INCONNUE = 'Hauteur de la 3D préparée non lue : le dessin part à sa hauteur, sans plafond du terrain.';

/** Niveaux de la 3D préparée (fiche du projet « R+N », sinon commande d'architecture de la charge) ; null si illisibles. */
export function niveauxDeLaFiche(draftBrut: unknown, charge: unknown): number | null {
  const draft = parseJarvisDraft(draftBrut);
  const m = draft ? jarvisMassing(draft) : null;
  if (m && Number.isFinite(m.niveaux) && m.niveaux >= 1) return m.niveaux;
  const textes = [
    draft?.objectif, draft?.dimensions, draft?.programme,
    estObj(charge) && estObj(charge.programme) ? charge.programme.commandeArchitecture : null,
  ].filter((t): t is string => typeof t === 'string');
  for (const t of textes) {
    const r = /\bR\s*\+\s*(\d{1,2})\b/i.exec(t);
    if (r) return Number(r[1]) + 1;
    if (/\b(?:rez-de-chauss[ée]e seul|plain[- ]pied)\b/i.test(t)) return 1;
  }
  return null;
}

export interface TravailAvecFiche { type: string; fiche: object; options: unknown }

/**
 * Le travail avec le dessin en vigueur dans `fiche.modele_batiment` (ou inchangé). `note` : ce qui n'est pas joint ou pas
 * plafonné, à dire ; null sinon.
 */
export function travailAvecModele<T extends TravailAvecFiche>(travail: T, modele: ModeleBatiment | null): { travail: T; note: string | null; modeleBatiment: FicheModeleBatiment | null } {
  if (!modele) return { travail, note: null, modeleBatiment: null };
  const options = estObj(travail.options) ? travail.options : {};
  if (options.existant === 'conserver') return { travail, note: NOTE_EXTENSION, modeleBatiment: null };
  const fiche = travail.fiche as Obj;
  const charge = estObj(fiche.charge) ? fiche.charge : {};
  const composition = estObj(charge.extensionsV1) && Array.isArray(charge.extensionsV1.compositionArchitecture) && charge.extensionsV1.compositionArchitecture.length > 0;
  const batiments = Array.isArray(charge.batiments) && charge.batiments.length > 0;
  if (composition && !batiments) return { travail, note: NOTE_COMPOSITION, modeleBatiment: null };
  const niveaux = niveauxDeLaFiche(fiche.draft, charge);
  const mb = ficheModeleBatiment(modele, niveaux, REFS_CATALOGUE_SITE);
  return { travail: { ...travail, fiche: { ...fiche, modele_batiment: mb } }, note: niveaux === null ? NOTE_HAUTEUR_INCONNUE : null, modeleBatiment: mb };
}
