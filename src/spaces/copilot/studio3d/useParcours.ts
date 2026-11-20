// src/spaces/copilot/studio3d/useParcours.ts
// =============================================================================
// VIS-17 (20/11/2026) — parcours guidé de la conversation, calculé UNE fois (CopilotChat) puis passé au panneau
// Espace 3D et à la carte « Votre parcours » du chat. Relit missions et rendus (base) à chaque réponse terminée,
// à chaque changement du brief projet ou de la mémoire du parcours, et toutes les 20 s tant qu'un rendu calcule.
// =============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { calculerParcours, type Parcours, type TypeParcours } from '@/lib/studio/parcours';
import { listerTravaux } from '@/lib/studio/travaux';
import { listerMissions } from '../agent/agentApi';
import { BRIEF_PROJET_EVENT, champsBriefDeLaConversation } from '@/spaces/promoteur/shared/briefProjet.store';
import type { BriefProjet } from '@/lib/studio/briefProjet';
import type { ChatMessage } from '../types/copilot.types';
import { parcelleRetenue } from './parcelleConfirmee';
import { parcelId } from './parcelFromGps';
import { assemblerSourcesEcran, instantaneDepuisSources, type MissionEcran } from './parcoursEcran';
import { lireMemoireParcours, majMemoireParcours, PARCOURS_EVENT, publierInstantaneParcours } from './parcours.store';
import type { SourcesParcours } from '@/lib/studio/parcours';

export interface EtatParcoursEcran {
  parcours: Parcours;
  sources: SourcesParcours;
  /** Type choisi dans le sélecteur (null : déduit des messages). */
  typeChoisi: TypeParcours | null;
  choisirType: (t: TypeParcours) => void;
  rafraichir: () => void;
}

function briefDe(conversationId: string | null): BriefProjet | null {
  if (!conversationId) return null;
  try { return champsBriefDeLaConversation(conversationId)?.brief ?? null; } catch { return null; }
}

export function useParcours(messages: readonly ChatMessage[], conversationId: string | null, actif = true): EtatParcoursEcran {
  const [missions, setMissions] = useState<MissionEcran[]>([]);
  const [travaux, setTravaux] = useState<unknown[]>([]);
  const [jeton, setJeton] = useState(0);
  const rafraichir = useCallback(() => setJeton((j) => j + 1), []);
  const enCours = messages.some((m) => m.status === 'streaming');
  const nbTermines = messages.filter((m) => m.status !== 'streaming').length;

  // Base : missions et rendus de la conversation (jamais bloquant).
  useEffect(() => {
    if (!actif || !conversationId || enCours) { if (!conversationId) { setMissions([]); setTravaux([]); } return; }
    let vivant = true;
    void listerMissions(30).then((l) => { if (vivant) setMissions(l.filter((m) => m.conversation_id === conversationId) as MissionEcran[]); }).catch(() => undefined);
    void listerTravaux(conversationId, 12).then((r) => { if (vivant) setTravaux(r.disponible ? r.valeur : []); }).catch(() => undefined);
    return () => { vivant = false; };
  }, [actif, conversationId, enCours, nbTermines, jeton]);

  // Rendu en calcul : relecture toutes les 20 s.
  const calcul = travaux.some((t) => ['en_attente', 'en_cours'].includes(String((t as { statut?: unknown }).statut)));
  useEffect(() => {
    if (!actif || !calcul) return;
    const id = window.setInterval(rafraichir, 20_000);
    return () => window.clearInterval(id);
  }, [actif, calcul, rafraichir]);

  // Navigateur : brief projet et mémoire du parcours (relus à chaque mise à jour).
  useEffect(() => {
    const maj = () => rafraichir();
    window.addEventListener(BRIEF_PROJET_EVENT, maj);
    window.addEventListener(PARCOURS_EVENT, maj);
    return () => { window.removeEventListener(BRIEF_PROJET_EVENT, maj); window.removeEventListener(PARCOURS_EVENT, maj); };
  }, [rafraichir]);

  const memoire = useMemo(() => lireMemoireParcours(conversationId), [conversationId, jeton]); // eslint-disable-line react-hooks/exhaustive-deps
  const brief = useMemo(() => briefDe(conversationId), [conversationId, jeton]); // eslint-disable-line react-hooks/exhaustive-deps
  const parcelle = useMemo(() => {
    const r = conversationId ? parcelleRetenue(conversationId) : null;
    if (!r) return null;
    const commune = typeof r.parcel.properties?.commune === 'string' ? r.parcel.properties.commune : null;
    return `${parcelId(r.parcel)}${commune ? ` · ${commune}` : r.adresse ? ` · ${r.adresse}` : ''}`;
  }, [conversationId, jeton]); // eslint-disable-line react-hooks/exhaustive-deps

  const sources = useMemo(() => assemblerSourcesEcran({
    messages: messages as never, conversationId, typeChoisi: memoire.type, missions, travaux, parcelle, brief, film: memoire.film, visite: memoire.visite,
  }), [messages, conversationId, memoire, missions, travaux, parcelle, brief]);
  const parcours = useMemo(() => calculerParcours(sources), [sources]);

  useEffect(() => { publierInstantaneParcours(conversationId, instantaneDepuisSources(sources, memoire.type)); }, [conversationId, sources, memoire.type]);

  const choisirType = useCallback((t: TypeParcours) => majMemoireParcours(conversationId, { type: t }), [conversationId]);
  return { parcours, sources, typeChoisi: memoire.type, choisirType, rafraichir };
}
