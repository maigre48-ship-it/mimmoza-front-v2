// src/spaces/copilot/hooks/useComposerTools.ts
// =============================================================
// Outils de composition partagés : pièces jointes + dictée.
//
// Cette logique existait uniquement en ligne dans MimmozIAPage.tsx, si bien que
// le composeur de l'état CONVERSATION (CopilotInput, utilisé par CopilotChat et
// par le drawer) n'avait ni trombone ni micro : les deux fonctions existaient
// mais n'étaient joignables que depuis l'écran d'accueil.
//
// Extrait ici pour être monté aux deux endroits sans recopie. Le hook ne rend
// rien et ne suppose aucune mise en page : il expose l'état et les actions, la
// présentation reste à l'appelant.
//
// ⚠️ MimmozIAPage conserve pour l'instant sa copie en ligne : sa variable
// `recording` alimente aussi l'état de l'orbe centrale, et sa dictée écrit dans
// son propre `draft`. La reconstruction est partagée via texteDictee.
// La migration du reste est mécanique (passer getValue/setValue et lire
// `recording` depuis le hook) mais doit être vérifiée à l'écran — à faire quand
// un typecheck sera disponible.
// =============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { texteDictee } from '../utils/texteDictee';
import { useCopilotStore } from '../store/copilotStore';
import {
  preparerPiecesJointes, readAsBase64, versPayload, type CopilotAttachment, type UiAttachment,
} from '../pieces-jointes/televersement';
import { ACCEPT_FILES, TAILLE_MAX_INLINE, TOTAL_MAX_INLINE } from '../pieces-jointes/piecesJointesLogique';

// V1.8 — les types et la préparation des pièces jointes vivent dans
// pieces-jointes/ (partagés avec MimmozIAPage). Réexportés ici pour les appelants.
export type { CopilotAttachment, UiAttachment };
export { ACCEPT_FILES, readAsBase64 };
/** @deprecated V1.8 : plafond de la voie base64 seulement (les PDF passent par le stockage, 50 Mo). */
export const MAX_FILE_BYTES = TAILLE_MAX_INLINE;
/** @deprecated V1.8 : idem, cumul base64. */
export const MAX_TOTAL_BYTES = TOTAL_MAX_INLINE;

export interface UseComposerToolsOptions {
  /** Texte actuel, relu au démarrage de chaque session. */
  getValue: () => string;
  /** Remplace le champ par la base et la transcription complète. */
  setValue: (text: string) => void;
}

export function useComposerTools({ getValue, setValue }: UseComposerToolsOptions) {
  // ── Pièces jointes ───────────────────────────────────────────────────────
  const [attachments, setAttachments] = useState<UiAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  // V1.8 : téléversement + extraction du texte en cours (l'envoi attend).
  const [preparation, setPreparation] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    const liste = Array.from(files);
    setPreparation(liste.length > 1 ? `Préparation de ${liste.length} fichiers…` : `Préparation de « ${liste[0].name} »…`);
    try {
      const st = useCopilotStore.getState();
      const { acceptees, erreur } = await preparerPiecesJointes(liste, attachments, {
        conversationId: st.currentConversationId, niveau: st.tier, surEtape: setPreparation,
      });
      if (erreur) setError(erreur);
      if (acceptees.length) {
        setAttachments((prev) => [...prev, ...acceptees.filter((a) => !prev.some((p) => p.id === a.id))]);
      }
    } finally {
      setPreparation(null);
    }
  }, [attachments]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments([]);
    setError(null);
  }, []);

  const openFilePicker = useCallback(() => fileInputRef.current?.click(), []);

  /** Payload prêt pour sendMessage : une pièce stockée part en RÉFÉRENCE (V1.8). */
  const toPayload = useCallback((): CopilotAttachment[] => versPayload(attachments), [attachments]);

  // ── Dictée ───────────────────────────────────────────────────────────────
  const [recording, setRecording] = useState(false);
  const recognitionRef = useRef<any>(null);

  /** SpeechRecognition n'existe que sur Chrome/Edge/Safari récents — pas Firefox. */
  const dictationSupported = useMemo(
    () => typeof window !== 'undefined'
      && Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition),
    [],
  );

  // Suit le champ actuel sans recréer la reconnaissance en cours.
  const valueAccessRef = useRef({ getValue, setValue });
  useEffect(() => { valueAccessRef.current = { getValue, setValue }; }, [getValue, setValue]);

  const toggleDictation = useCallback(() => {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setError('Dictée non prise en charge par ce navigateur (essayez Chrome ou Edge).');
      return;
    }
    if (recording) { recognitionRef.current?.stop(); return; }

    const base = valueAccessRef.current.getValue();
    const rec = new SR();
    rec.lang = 'fr-FR'; rec.interimResults = true; rec.continuous = false;
    rec.onstart = () => { setError(null); setRecording(true); };
    rec.onresult = (e: any) => {
      valueAccessRef.current.setValue(texteDictee(base, e.results));
    };
    rec.onend = () => setRecording(false);
    // Sans onerror, une permission micro refusée échoue en SILENCE : le bouton
    // reste allumé et l'utilisateur croit être en train de dicter.
    rec.onerror = (e: any) => {
      console.warn('[Copilot] dictée :', e?.error);
      setRecording(false);
      if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') {
        setError('Accès au micro refusé. Autorisez-le dans les réglages du navigateur.');
      } else if (e?.error === 'network') {
        setError('Reconnaissance vocale indisponible (service distant injoignable).');
      }
    };
    recognitionRef.current = rec;
    try {
      rec.start();
    } catch (err) {
      console.warn('[Copilot] démarrage dictée impossible :', err);
      setRecording(false);
    }
  }, [recording]);

  // Arrêt à la destruction : sinon le micro reste ouvert après navigation.
  useEffect(() => () => recognitionRef.current?.stop?.(), []);

  return {
    // pièces jointes
    attachments, fileInputRef, handleFiles, removeAttachment,
    clearAttachments, openFilePicker, toPayload, preparation,
    // dictée
    recording, dictationSupported, toggleDictation,
    // commun
    error, setError,
  };
}
