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
// son propre `draft`. La migration est mécanique (passer `onTranscript` et lire
// `recording` depuis le hook) mais doit être vérifiée à l'écran — à faire quand
// un typecheck sera disponible.
// =============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** Pièce jointe transmise au backend (contrat copilot-chat V1.7). */
export interface CopilotAttachment {
  mediaType: string;   // image/png|jpeg|gif|webp ou application/pdf
  data: string;        // base64 SANS le préfixe data:
  name?: string;
}

/** Pièce jointe côté UI : le base64 + de quoi afficher une pastille. */
export interface UiAttachment extends CopilotAttachment {
  id: string;
  name: string;
  size: number;
}

export const ACCEPT_FILES = 'image/png,image/jpeg,image/gif,image/webp,application/pdf';
export const MAX_FILE_BYTES = 3 * 1024 * 1024;   // 3 Mo par fichier
export const MAX_TOTAL_BYTES = 4 * 1024 * 1024;  // 4 Mo cumulés (le base64 gonfle de ~33 %)

/** Lit un fichier en base64 SANS le préfixe `data:…;base64,`. */
export function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const res = String(r.result);
      const comma = res.indexOf(',');
      resolve(comma >= 0 ? res.slice(comma + 1) : res);
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export interface UseComposerToolsOptions {
  /**
   * Appelé à chaque segment reconnu par la dictée. L'appelant décide où le
   * texte atterrit — le hook n'a pas connaissance du champ de saisie.
   */
  onTranscript: (text: string) => void;
}

export function useComposerTools({ onTranscript }: UseComposerToolsOptions) {
  // ── Pièces jointes ───────────────────────────────────────────────────────
  const [attachments, setAttachments] = useState<UiAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    const accepted: UiAttachment[] = [];
    let total = attachments.reduce((s, a) => s + a.size, 0);

    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE_BYTES) {
        setError(`« ${file.name} » dépasse 3 Mo.`);
        continue;
      }
      if (total + file.size > MAX_TOTAL_BYTES) {
        setError('Taille cumulée des pièces jointes dépassée (4 Mo).');
        break;
      }
      try {
        accepted.push({
          id: `${file.name}-${file.lastModified}-${file.size}`,
          name: file.name,
          size: file.size,
          mediaType: file.type,
          data: await readAsBase64(file),
        });
        total += file.size;
      } catch {
        setError(`Lecture impossible : ${file.name}`);
      }
    }
    if (accepted.length) {
      setAttachments((prev) => [
        ...prev,
        ...accepted.filter((a) => !prev.some((p) => p.id === a.id)),
      ]);
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

  /** Payload prêt pour sendMessage : on retire les champs propres à l'UI. */
  const toPayload = useCallback(
    (): CopilotAttachment[] => attachments.map(({ mediaType, data, name }) => ({ mediaType, data, name })),
    [attachments],
  );

  // ── Dictée ───────────────────────────────────────────────────────────────
  const [recording, setRecording] = useState(false);
  const recognitionRef = useRef<any>(null);

  /** SpeechRecognition n'existe que sur Chrome/Edge/Safari récents — pas Firefox. */
  const dictationSupported = useMemo(
    () => typeof window !== 'undefined'
      && Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition),
    [],
  );

  // La dictée alimente `onTranscript` à chaque résultat. On passe par une ref
  // pour que le callback puisse changer entre les rendus sans recréer la
  // reconnaissance en cours (ce qui couperait la dictée en plein milieu).
  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);

  const toggleDictation = useCallback(() => {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setError('Dictée non prise en charge par ce navigateur (essayez Chrome ou Edge).');
      return;
    }
    if (recording) { recognitionRef.current?.stop(); return; }

    const rec = new SR();
    rec.lang = 'fr-FR'; rec.interimResults = true; rec.continuous = false;
    rec.onstart = () => { setError(null); setRecording(true); };
    rec.onresult = (e: any) => {
      let tr = '';
      for (let i = e.resultIndex; i < e.results.length; i++) tr += e.results[i][0].transcript;
      onTranscriptRef.current(tr);
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
    clearAttachments, openFilePicker, toPayload,
    // dictée
    recording, dictationSupported, toggleDictation,
    // commun
    error, setError,
  };
}
