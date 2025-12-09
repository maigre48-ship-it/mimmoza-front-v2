// src/supabaseFunctions.ts
import { supabase } from "./supabaseClient";

/**
 * Helper générique pour appeler une Edge Function Supabase.
 * - Ne gère plus les URLs ni les headers (Supabase le fait)
 * - Récupère le vrai message d'erreur renvoyé par la fonction (JSON)
 */
export async function callEdgeFunction<TInput, TOutput>(
  name: string,
  body: TInput
): Promise<TOutput> {
  const { data, error } = await supabase.functions.invoke<TOutput>(name, {
    body,
  });

  if (error) {
    console.error(`Erreur Edge Function "${name}" :`, error);

    // Supabase renvoie souvent un objet dans error.context.error
    const anyError = error as any;

    const backendErrorMessage =
      anyError?.context?.error?.error ?? // { error: "..." }
      anyError?.context?.error?.message ?? // { message: "..." }
      anyError?.context?.error ?? // directement une string
      error.message;

    throw new Error(
      backendErrorMessage || `Échec de la fonction ${name}`
    );
  }

  return data as TOutput;
}
