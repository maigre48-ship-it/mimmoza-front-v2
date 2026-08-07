// ============================================================================
// L'étude courante, résolue une fois pour toutes.
//
// Le problème qu'il règle, constaté au premier test réel de la chaîne :
// l'onglet « PLU » de la barre supérieure pointe sur `/promoteur/foncier`,
// chemin statique, sans `?study=`. `PromoteurSidebar` ne fait que relire le
// paramètre dans l'URL courante — il propage donc le vide, indéfiniment. Les
// redirections (`/promoteur/faisabilite` → `/promoteur/foncier`) abandonnent
// elles aussi la query.
//
// Résultat : par le menu, on atteignait toujours une page incapable d'écrire
// quoi que ce soit. Et sans le moindre signe, puisque les pages sortaient en
// silence sur `if (!studyId) return`.
//
// Ce hook ferme la boucle des deux côtés :
//   · `?study=` présent  → il devient l'étude active, mémorisée ;
//   · `?study=` absent   → on retombe sur la dernière étude active ET on
//     réécrit l'URL, qui redevient vraie, partageable et rechargeable.
//
// La réécriture est volontaire. Un repli invisible rattacherait du travail à
// une étude qu'on ne voit nulle part ; l'URL est le seul endroit où l'état est
// lisible sans ouvrir la console.
// ============================================================================

import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

import { getActiveStudyId, setActiveStudyId } from './promoteurSnapshot.store';

export function usePromoteurStudyId(): string | null {
  const [searchParams, setSearchParams] = useSearchParams();

  const fromUrl = searchParams.get('study');
  // Le repli n'est consulté que si l'URL ne dit rien : l'URL fait toujours foi.
  const fallback = fromUrl ? null : getActiveStudyId();

  useEffect(() => {
    if (fromUrl) {
      setActiveStudyId(fromUrl);
      return;
    }
    if (!fallback) return;

    // `replace` : ce n'est pas une navigation, c'est une correction. Elle ne
    // doit pas s'empiler dans l'historique du navigateur.
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('study', fallback);
        return next;
      },
      { replace: true },
    );
  }, [fromUrl, fallback, setSearchParams]);

  return fromUrl ?? fallback;
}
