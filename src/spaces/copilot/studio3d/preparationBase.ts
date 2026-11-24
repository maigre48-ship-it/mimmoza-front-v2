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
// VIS-34 : le PROJET EN VIGUEUR (dessin validé + portée) est enregistré avec la préparation (entree.projet_en_vigueur) :
// il est relu ici, pour toute la page — après rechargement et dans un autre onglet aussi (plus seulement la mémoire du chat).
import { lireProjetEnVigueur, type ProjetEnVigueur } from '@/lib/studio/projetEnVigueur';

/** Émis quand la préparation de la conversation a pu changer (détail : id de conversation). */
export const EVENEMENT_PREPARATION_BASE = 'mzia-preparation-base';

const cache = new Map<string, ReferencePreparation | null>();
/** VIS-34 : dessin en vigueur de la conversation, tel qu'enregistré en base (null : aucun ; absent : pas encore lu). */
const projets = new Map<string, ProjetEnVigueur | null>();

/** VIS-34 : projet en vigueur en cache (undefined : la base n'a pas encore répondu pour cette conversation). */
export function projetEnVigueurEnCache(conversationId: string | null): ProjetEnVigueur | null | undefined {
  return conversationId ? projets.get(conversationId) : null;
}

/** VIS-34 : relit la base puis rend le projet en vigueur ; undefined si la base n'a jamais pu répondre (repli : chat). */
export async function chargerProjetEnVigueur(conversationId: string): Promise<ProjetEnVigueur | null | undefined> {
  await chargerPreparationBase(conversationId).catch(() => null);
  return projets.get(conversationId);
}

/** Référence en cache (undefined : pas encore lue). */
export function preparationBaseEnCache(conversationId: string | null): ReferencePreparation | null | undefined {
  return conversationId ? cache.get(conversationId) : null;
}

/** Relit la dernière préparation de la conversation (RLS : celles de l'utilisateur) et prévient les écrans. */
export async function chargerPreparationBase(conversationId: string): Promise<ReferencePreparation | null> {
  const { data, error } = await supabase.from('studio_preparations')
    .select('id,conception_id,idu,resume,commune:entree->>commune,projet:entree->projet_en_vigueur').eq('conversation_id', conversationId)
    .order('maj_le', { ascending: false }).limit(1);
  if (error) return cache.get(conversationId) ?? null;
  const ref = Array.isArray(data) && data.length ? referenceDepuisLigne(data[0]) : null;
  // VIS-34 : dessin complet relu SANS confiance (modèle revalidé, empreinte recalculée, conversation vérifiée).
  projets.set(conversationId, Array.isArray(data) && data.length ? lireProjetEnVigueur((data[0] as { projet?: unknown }).projet, conversationId) : null);
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
