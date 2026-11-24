// src/spaces/copilot/studio3d/synchroSelectionCarte.ts
// =============================================================================
// VIS-33 — la carte d'habillage (CarteBriefCreatif) et la page catalogue extérieur (autre onglet) partagent la
// sélection de matières de la conversation (selectionCatalogue.ts) :
//   · un choix « Utiliser dans mon projet » de la page arrive dans la carte (mêmes garde-fous qu'un clic : refus dit) ;
//   · un choix ou un retrait fait dans la carte part dans la sélection (la page le montre dans « Ma sélection »).
// À la réouverture d'un brief connu (matières relues du serveur), le brief fait foi et la sélection est réécrite.
// Le catalogue (≈ 100 Ko) n'est chargé que s'il y a une matière à appliquer.
// =============================================================================
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { PARTIES_MATIERE, type DemandeBrief, type EtatBrief } from './briefCreatif';
import {
  appliquerProjetAEtat, ecouterSelection, ecrireSelection, lireSelection, memesChoix, nouvelAuteur, projetDepuisEtat,
  type ResoudreMatiere, type SelectionCatalogue,
} from './selectionCatalogue';

export function useSynchroSelectionCarte(
  conversationId: string | null | undefined, etat: EtatBrief, setEtat: Dispatch<SetStateAction<EtatBrief>>, demande: Pick<DemandeBrief, 'ambiances' | 'limites'>,
): string | null {
  const auteur = useRef<string>('');
  if (!auteur.current) auteur.current = nouvelAuteur('carte');
  const etatRef = useRef(etat);
  etatRef.current = etat;
  const demandeRef = useRef(demande);
  demandeRef.current = demande;
  const pret = useRef(false);
  const [refus, setRefus] = useState<string | null>(null);

  const appliquer = useCallback(async (s: SelectionCatalogue) => {
    if (!conversationId) return;
    const besoin = PARTIES_MATIERE.some((p) => (s.projet[p]?.ref ?? null) !== (etatRef.current.matieres?.[p]?.ref ?? null));
    if (!besoin) { pret.current = true; return; }
    try {
      const [mc, mp] = await Promise.all([import('./matieresCatalogue'), import('./matieresParPartie')]);
      const resoudre: ResoudreMatiere = (p, ref) => {
        const e = mp.candidatesDeLaPartie(p).find((x) => x.refStudio === ref);
        return e ? { matiere: mc.matiereChoisie(p, e), champs: mc.traduireMatiere(p, e).champs } : null;
      };
      const r = appliquerProjetAEtat(etatRef.current, s.projet, resoudre, demandeRef.current);
      etatRef.current = r.etat;
      setEtat(r.etat);
      const raisons = Object.values(r.refus);
      setRefus(raisons.length ? `Choix du catalogue non appliqué : ${raisons.join(' ')}` : null);
      const projet = projetDepuisEtat(r.etat);
      if (projet && (raisons.length || !memesChoix(projet, s.projet))) {
        ecrireSelection(conversationId, { ...s, projet, refus: { ...s.refus, ...r.refus } }, auteur.current);
      }
    } catch { /* hors ligne : la sélection reste stockée, elle sera appliquée à la prochaine ouverture */ }
    finally { pret.current = true; }
  }, [conversationId, setEtat]);

  // Ouverture : brief connu → il fait foi ; sinon la sélection stockée (page) est appliquée. Puis écoute.
  useEffect(() => {
    if (!conversationId) return undefined;
    pret.current = false;
    const s = lireSelection(conversationId);
    const depuisBrief = PARTIES_MATIERE.some((p) => etatRef.current.matieres?.[p]?.aResoudre);
    if (depuisBrief || s.maj === 0) pret.current = true;
    else void appliquer(s);
    return ecouterSelection(conversationId, auteur.current, (x) => { void appliquer(x); });
  }, [conversationId, appliquer]);

  // Choix ou retrait fait dans la carte → sélection partagée.
  const projetCarte = projetDepuisEtat(etat);
  const cle = projetCarte ? JSON.stringify(projetCarte) : null;
  useEffect(() => {
    if (!conversationId || !pret.current || !projetCarte) return;
    const s = lireSelection(conversationId);
    if (memesChoix(projetCarte, s.projet)) return;
    const refusRestants = { ...s.refus };
    for (const p of PARTIES_MATIERE) if (projetCarte[p]) delete refusRestants[p];
    ecrireSelection(conversationId, { ...s, projet: projetCarte, refus: refusRestants }, auteur.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle, conversationId]);

  return refus;
}
