// src/lib/studio/modeleBatimentFiche.ts
// =============================================================================
// VIS-26 lot D — le bâtiment DESSINÉ joint à un rendu : UNE seule règle, partagée par le chat (Edge,
// copilot-chat/agent/dessin-batiment.ts::modeleContraint → studio.ts::ficheDepuisPreparation) et par l'Espace 3D du site
// (src/spaces/copilot/studio3d/modeleTravail.ts → FilmVisitePanel, aperçu et images finales).
//
// - `modeleContraint` : jamais plus haut que ce que la 3D préparée retient sur ce terrain (règles, gabarit). Chaque volume
//   est ramené sous le plafond (niveaux) ; un volume posé entièrement au-dessus est retiré. Les écarts sont DITS (notes).
//   Échec de la revalidation → dessin d'origine et raison (jamais un dessin cassé).
// - `ficheModeleBatiment` : la forme lue par la machine de rendu (mimmozia-studio/worker/src/modeleBatiment.ts::
//   lireModeleFiche, champ `studio_jobs.fiche.modele_batiment`) : { v: 1, empreinte (du dessin d'origine), modele, notes? }.
// Module PUR (imports relatifs en .ts : Vite, tsx et Deno). Le contrat (modeleBatiment.ts) n'est pas modifié.
// =============================================================================
import { appliquerRetouches, empreinteModele, type ModeleBatiment } from './modeleBatiment.ts';

const lib = (n: number): string => (n <= 1 ? 'rez-de-chaussée seul' : `R+${n - 1}`);

export function modeleContraint(m: ModeleBatiment, niveauxMax: number | null | undefined, refsConnues?: readonly string[]): { modele: ModeleBatiment; notes: string[] } {
  if (typeof niveauxMax !== 'number' || !Number.isFinite(niveauxMax) || niveauxMax < 1) return { modele: m, notes: [] };
  const retouches: Record<string, unknown>[] = [];
  const notes: string[] = [];
  for (const v of m.volumes) {
    const etagesSous = Math.round(v.altitudeBase / v.hauteurEtage);
    const permis = Math.floor(niveauxMax) - etagesSous;
    if (permis < 1) {
      if (m.volumes.length - retouches.filter((r) => r.action === 'retirer').length > 1) {
        retouches.push({ action: 'retirer', id: v.id });
        notes.push(`« ${v.nom ?? v.id} » retiré : il dépasse la hauteur retenue sur ce terrain (${lib(niveauxMax)})`);
      }
    } else if (v.niveaux > permis) {
      retouches.push({ action: 'modifier', id: v.id, champs: { niveaux: permis } });
      notes.push(`« ${v.nom ?? v.id} » ramené de ${v.niveaux} à ${permis} niveau${permis > 1 ? 'x' : ''}`);
    }
  }
  if (!retouches.length) return { modele: m, notes: [] };
  const r = appliquerRetouches(m, retouches, refsConnues ? { refsConnues } : {});
  if (!r.ok) return { modele: m, notes: [`Hauteur du dessin non ramenée automatiquement (${'erreur' in r ? r.erreur : ''}) : à vérifier dans le Studio`] };
  return { modele: r.modele, notes };
}

/** Champ `modele_batiment` de la fiche d'un rendu (même forme que l'Edge ; lu tel quel par la machine de rendu). */
export interface FicheModeleBatiment { v: 1; empreinte: string; modele: ModeleBatiment; notes?: string[] }

export function ficheModeleBatiment(m: ModeleBatiment, niveauxMax: number | null | undefined, refsConnues?: readonly string[]): FicheModeleBatiment {
  const c = modeleContraint(m, niveauxMax, refsConnues);
  return { v: 1, empreinte: empreinteModele(m), modele: c.modele, ...(c.notes.length ? { notes: c.notes } : {}) };
}
