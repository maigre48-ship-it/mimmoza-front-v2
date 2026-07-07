// ─────────────────────────────────────────────────────────────────────────────
// transcribePlanReal.ts
// Service d'appel à la Edge Function Supabase : transcribe-rehab-plan
// Aucun mock — appel réseau réel uniquement
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../../lib/supabaseClient';
import type {
  PlanTranscriptionResult,
  TranscribePlanPayload,
  TranscribePlanRawResponse,
  TranscriptionError,
  TranscriptionErrorCode,
  TranscriptionOptions,
} from '../plan-reader/planTranscription.types';
import { DEFAULT_TRANSCRIPTION_OPTIONS } from '../plan-reader/planTranscription.types';

// ── Constantes ────────────────────────────────────────────────────────────────

const EDGE_FUNCTION_NAME = 'transcribe-rehab-plan' as const;
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 Mo
const SUPPORTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

type SupportedMimeType = (typeof SUPPORTED_MIME_TYPES)[number];

// ── Validation locale avant envoi ─────────────────────────────────────────────

function validateFile(file: File): TranscriptionError | null {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      code: 'FILE_TOO_LARGE',
      message: `Le fichier dépasse la limite de ${MAX_FILE_SIZE_BYTES / 1024 / 1024} Mo.`,
      retryable: false,
    };
  }

  if (!SUPPORTED_MIME_TYPES.includes(file.type as SupportedMimeType)) {
    return {
      code: 'UNSUPPORTED_FORMAT',
      message: `Format non supporté : ${file.type}. Formats acceptés : JPEG, PNG, WEBP, PDF.`,
      retryable: false,
    };
  }

  return null;
}

// ── Conversion File → Base64 ──────────────────────────────────────────────────

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Résultat FileReader inattendu (non string)'));
        return;
      }
      // Extraire uniquement la partie base64 (sans le préfixe data:...;base64,)
      const base64 = result.split(',')[1];
      if (!base64) {
        reject(new Error('Impossible d\'extraire le contenu base64 du fichier.'));
        return;
      }
      resolve(base64);
    };

    reader.onerror = () => {
      reject(new Error('Erreur lors de la lecture du fichier.'));
    };

    reader.readAsDataURL(file);
  });
}

// ── Mapping erreur réseau/API vers TranscriptionError ─────────────────────────

function mapToTranscriptionError(
  rawError: unknown,
  httpStatus?: number
): TranscriptionError {
  if (httpStatus === 413) {
    return { code: 'FILE_TOO_LARGE', message: 'Fichier trop volumineux pour le serveur.', retryable: false };
  }
  if (httpStatus === 429) {
    return { code: 'QUOTA_EXCEEDED', message: 'Quota d\'appels API dépassé. Réessayez plus tard.', retryable: true };
  }
  if (httpStatus === 503 || httpStatus === 502) {
    return { code: 'AI_SERVICE_UNAVAILABLE', message: 'Le service d\'analyse IA est temporairement indisponible.', retryable: true };
  }
  if (httpStatus === 504) {
    return { code: 'TIMEOUT', message: 'L\'analyse a pris trop de temps. Réessayez avec un plan plus simple.', retryable: true };
  }

  if (rawError instanceof Error) {
    if (rawError.message.toLowerCase().includes('fetch') || rawError.message.toLowerCase().includes('network')) {
      return { code: 'NETWORK_ERROR', message: 'Erreur réseau. Vérifiez votre connexion.', retryable: true };
    }
    return { code: 'UNKNOWN', message: rawError.message, retryable: false };
  }

  return { code: 'UNKNOWN', message: 'Une erreur inconnue s\'est produite.', retryable: false };
}

// ── Résultat du service ───────────────────────────────────────────────────────

export type TranscriptionServiceResult =
  | { success: true; data: PlanTranscriptionResult }
  | { success: false; error: TranscriptionError };

// ── Service principal ─────────────────────────────────────────────────────────

/**
 * Envoie un fichier plan (image ou PDF) à la Edge Function Supabase
 * `transcribe-rehab-plan` et retourne le résultat structuré.
 *
 * @param planId    Identifiant unique du plan (généré côté appelant)
 * @param file      Fichier brut sélectionné par l'utilisateur
 * @param options   Options de transcription (optionnel, defaults appliqués)
 */
export async function transcribePlanReal(
  planId: string,
  file: File,
  options?: Partial<TranscriptionOptions>
): Promise<TranscriptionServiceResult> {
  // 1. Validation locale
  const localError = validateFile(file);
  if (localError !== null) {
    return { success: false, error: localError };
  }

  // 2. Conversion base64
  let imageBase64: string;
  try {
    imageBase64 = await fileToBase64(file);
  } catch (conversionError) {
    return {
      success: false,
      error: {
        code: 'UNKNOWN',
        message: conversionError instanceof Error
          ? conversionError.message
          : 'Impossible de lire le fichier.',
        retryable: false,
      },
    };
  }

  // 3. Construction du payload
  const resolvedOptions: TranscriptionOptions = {
    ...DEFAULT_TRANSCRIPTION_OPTIONS,
    ...options,
  };

  const payload: TranscribePlanPayload = {
    plan_id: planId,
    image_base64: imageBase64,
    file_type: file.type as TranscribePlanPayload['file_type'],
    file_name: file.name,
    options: resolvedOptions,
  };

  // 4. Appel Edge Function via Supabase SDK
  try {
    const { data, error } = await supabase.functions.invoke<TranscribePlanRawResponse>(
      EDGE_FUNCTION_NAME,
      { body: payload }
    );

    if (error) {
      // FunctionsHttpError expose status
      const httpStatus = (error as { status?: number }).status;
      return {
        success: false,
        error: mapToTranscriptionError(error, httpStatus),
      };
    }

    if (!data) {
      return {
        success: false,
        error: {
          code: 'UNKNOWN',
          message: 'La Edge Function n\'a retourné aucune donnée.',
          retryable: false,
        },
      };
    }

    if (!data.success || !data.data) {
      return {
        success: false,
        error: {
          code: (data.error_code as TranscriptionErrorCode) ?? 'UNKNOWN',
          message: data.error ?? 'Erreur interne de transcription.',
          retryable: false,
        },
      };
    }

    return { success: true, data: data.data };
  } catch (networkError) {
    return {
      success: false,
      error: mapToTranscriptionError(networkError),
    };
  }
}

// ── Utilitaire : génération d'un plan_id unique ───────────────────────────────

/**
 * Génère un identifiant de plan unique basé sur le nom du fichier et l'horodatage.
 * À utiliser côté appelant (hook ou composant) avant d'appeler transcribePlanReal.
 */
export function generatePlanId(fileName: string): string {
  const sanitized = fileName.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40);
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  return `plan_${sanitized}_${timestamp}_${random}`;
}