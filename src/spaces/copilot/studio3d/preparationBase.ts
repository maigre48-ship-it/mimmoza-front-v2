// src/spaces/copilot/studio3d/preparationBase.ts
// =============================================================================
// 23/11/2026 — UNE SEULE VÉRITÉ pour « la 3D préparée de la conversation » : la table studio_preparations.
// Avant, chaque écran (parcours, fiche Espace 3D, carte « 3D préparée », feuille des rendus, ouverture du Studio)
// cherchait la préparation dans les MESSAGES du chat ; une 3D préparée par l'action directe (« Préparer » du parcours,
// « Ouvrir mon projet en 3D ») n'a pas de message → étape 3 faite d'un côté, « préparez d'abord la 3D » de l'autre.
// Ici : dernière ligne de la conversation, mise en cache par conversation, relue sur événement.
// =============================================================================
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { dernierePreparation, referenceDepuisLigne, type MessageOutils, type ReferencePreparation } from './preparationStudio';

/** Émis quand la préparation de la conversation a pu changer (détail : id de conversation). */
export const EVENEMENT_PREPARATION_BASE = 'mzia-preparation-base';

const cache = new Map<string, ReferencePreparation | null>();

/** Référence en cache (undefined : pas encore lue). */
export function preparationBaseEnCache(conversationId: string | null): ReferencePreparation | null | undefined {
  return conversationId ? cache.get(conversationId) : null;
}

/** Relit la dernière préparation de la conversation (RLS : celles de l'utilisateur) et prévient les écrans. */
export async function chargerPreparationBase(conversationId: string): Promise<ReferencePreparation | null> {
  const { data, error } = await supabase.from('studio_preparations')
    .select('id,conception_id,idu,resume,commune:entree->>commune').eq('conversation_id', conversationId)
    .order('maj_le', { ascending: false }).limit(1);
  if (error) return cache.get(conversationId) ?? null;
  const ref = Array.isArray(data) && data.length ? referenceDepuisLigne(data[0]) : null;
  const avant = cache.get(conversationId);
  cache.set(conversationId, ref);
  if (avant === undefined || avant?.preparationId !== ref?.preparationId || JSON.stringify(avant) !== JSON.stringify(ref)) {
    window.dispatchEvent(new CustomEvent(EVENEMENT_PREPARATION_BASE, { detail: conversationId }));
  }
  return ref;
}

/** La base fait foi ; à défaut (pas encore lue, hors ligne) la préparation annoncée dans les messages. */
export function preparationCourante(messages: readonly MessageOutils[], conversationId: string | null): ReferencePreparation | null {
  return (conversationId ? cache.get(conversationId) : null) ?? dernierePreparation(messages);
}

/** Préparation courante de la conversation, relue à chaque réponse terminée et à chaque événement. */
export function usePreparationCourante(messages: readonly MessageOutils[], conversationId: string | null): ReferencePreparation | null {
  const [, setTic] = useState(0);
  const termines = messages.length;
  useEffect(() => {
    if (!conversationId) return;
    void chargerPreparationBase(conversationId).catch(() => undefined);
  }, [conversationId, termines]);
  useEffect(() => {
    const maj = (e: Event) => { if ((e as CustomEvent<string>).detail === conversationId) setTic((t) => t + 1); };
    window.addEventListener(EVENEMENT_PREPARATION_BASE, maj);
    return () => window.removeEventListener(EVENEMENT_PREPARATION_BASE, maj);
  }, [conversationId]);
  const base = conversationId ? cache.get(conversationId) : null;
  const desMessages = useMemo(() => dernierePreparation(messages), [messages]);
  return base ?? desMessages;
}
