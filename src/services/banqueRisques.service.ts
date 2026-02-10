import { supabase } from "../lib/supabaseClient";

export type BanqueRisquesInput = {
  dossierId: string;
  adresse?: string;
  lat?: number;
  lng?: number;
  parcel_id?: string;
  rayon_m?: number;
  persist?: boolean;
  ttl_seconds?: number;
  debug?: boolean;
};

export async function runBanqueRisques(input: BanqueRisquesInput) {
  const { data, error } = await supabase.functions.invoke("banque-risques-v1", {
    body: {
      rayon_m: 1000,
      persist: true,
      debug: false,
      ...input,
    },
  });

  if (error) {
    throw new Error(`banque-risques-v1 failed: ${error.message}`);
  }

  return data;
}
