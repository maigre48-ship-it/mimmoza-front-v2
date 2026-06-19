// src/supabaseFunctions.ts
import { supabase } from "./supabaseClient";

/**
 * Helper gÃ©nÃ©rique pour appeler une Edge Function Supabase.
 * - Ne gÃ¨re plus les URLs ni les headers (Supabase le fait)
 * - RÃ©cupÃ¨re le vrai message d'erreur renvoyÃ© par la fonction (JSON)
 */
export async function callEdgeFunction
  TInput extends Record<string, unknown>,
  TOutput
>(
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
      backendErrorMessage || `Ã‰chec de la fonction ${name}`
    );
  }

  return data as TOutput;
}