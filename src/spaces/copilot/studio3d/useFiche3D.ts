// src/spaces/copilot/studio3d/useFiche3D.ts
// LOT FICHE-3D — état de la fiche « Espace 3D » : volume préparé par Mimmo pour la conversation
// (ligne studio_preparations relue sans confiance), saisie de l'utilisateur, évaluation du moteur
// (ficheDimensions.ts) et brief courant (briefCreatif.ts). Aucune autre logique ici.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { dernierePreparation, lirePreparationStockee, type MessageOutils, type PreparationStockee } from './preparationStudio';
import { appliquerForme, evaluerSaisie, modifierCorps, saisieDepuisVolume, type EvaluationFiche, type Forme, type SaisieDimensions } from './ficheDimensions';
import { briefCourant } from './briefCreatif';

type MessageFiche = MessageOutils & { role: string; text: string };

export type EtatFiche3D =
  | { etat: 'aucune' }
  | { etat: 'chargement' }
  | { etat: 'erreur'; message: string }
  | { etat: 'ok'; prep: PreparationStockee; saisie: SaisieDimensions; ev: EvaluationFiche; brief: ReturnType<typeof briefCourant>;
    choisirForme: (f: Forme) => void; modifier: (i: number, champ: 'longueurM' | 'largeurM' | 'niveaux', v: string) => void; revenir: () => void };

/** Volume préparé par Mimmo pour la conversation (relu en base), saisie de l'utilisateur et évaluation du moteur. */
export function useFiche3D(messages: readonly MessageFiche[]): EtatFiche3D {
  const ref = useMemo(() => dernierePreparation(messages), [messages]);
  const brief = useMemo(() => briefCourant(messages), [messages]);
  const [lu, setLu] = useState<{ id: string; prep: PreparationStockee | null; erreur: string | null } | null>(null);
  const [saisie, setSaisie] = useState<SaisieDimensions | null>(null);
  const id = ref?.preparationId ?? null;
  useEffect(() => {
    if (!id) return;
    let actif = true;
    void Promise.resolve(supabase.from('studio_preparations').select('id,idu,entree,volume').eq('id', id).maybeSingle()).then(({ data, error }) => {
      if (!actif) return;
      const prep = error ? null : lirePreparationStockee(data);
      setLu({ id, prep, erreur: error ? 'Le volume préparé n’a pas pu être relu.' : prep ? null : 'Le volume préparé est illisible.' });
      setSaisie(prep ? saisieDepuisVolume(prep.volume) : null);
    }).catch(() => { if (actif) setLu({ id, prep: null, erreur: 'Le volume préparé n’a pas pu être relu.' }); });
    return () => { actif = false; };
  }, [id]);
  const prep = lu && lu.id === id ? lu.prep : null;
  const attique = brief?.attique ?? false;
  const ev = useMemo(() => (prep && saisie ? evaluerSaisie(prep, saisie, attique) : null), [prep, saisie, attique]);
  if (!id) return { etat: 'aucune' };
  if (!lu || lu.id !== id) return { etat: 'chargement' };
  if (!prep || !saisie || !ev) return { etat: 'erreur', message: lu.erreur ?? 'Volume indisponible.' };
  return {
    etat: 'ok', prep, saisie, ev, brief,
    choisirForme: (f) => setSaisie((s) => (s ? appliquerForme(prep, s, f) : s)),
    modifier: (i, champ, v) => setSaisie((s) => (s ? modifierCorps(s, i, champ, v) : s)),
    revenir: () => setSaisie(saisieDepuisVolume(prep.volume)),
  };
}
