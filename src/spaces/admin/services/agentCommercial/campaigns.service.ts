import { supabase } from "@/lib/supabase";

export type CampaignAudience = "clients" | "prospects" | "tous";
export type CampaignStatus = "draft" | "approved" | "archived";

export interface CommunicationCampaign {
  id: string;
  title: string;
  brief: string;
  audience: CampaignAudience;
  channel: "email";
  status: CampaignStatus;
  subject: string;
  body: string;
  internal_notes: string;
  ai_model: string | null;
  visual_path: string | null;
  visual_prompt: string | null;
  visual_model: string | null;
  visual_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function listCampaigns(): Promise<CommunicationCampaign[]> {
  const { data, error } = await supabase.from("communication_campaigns")
    .select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as CommunicationCampaign[];
}

async function callCampaignAgent(input: Record<string, unknown>): Promise<CommunicationCampaign> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Session expirée. Reconnectez-vous.");
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!base) throw new Error("Configuration Supabase manquante.");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  if (import.meta.env.VITE_SUPABASE_ANON_KEY) headers.apikey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const response = await fetch(`${base}/functions/v1/agent-communication-campaign`, {
    method: "POST", headers, body: JSON.stringify(input),
  });
  const result = await response.json().catch(() => null) as {
    campaign?: CommunicationCampaign;
    error?: { message?: string };
  } | null;
  if (!response.ok || !result?.campaign) {
    throw new Error(result?.error?.message ?? `Génération impossible (${response.status}).`);
  }
  return result.campaign;
}

export async function generateCampaign(input: {
  title: string;
  brief: string;
  audience: CampaignAudience;
}): Promise<CommunicationCampaign> {
  return callCampaignAgent(input);
}

export async function generateCampaignVisual(id: string): Promise<CommunicationCampaign> {
  return callCampaignAgent({ action: "generate_visual", campaign_id: id });
}

export async function getCampaignVisualUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from("communication-campaigns")
    .createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? "Visuel indisponible.");
  return data.signedUrl;
}

export async function saveCampaignDraft(
  id: string,
  patch: { title: string; subject: string; body: string; internal_notes: string },
): Promise<CommunicationCampaign> {
  const { data, error } = await supabase.from("communication_campaigns")
    .update(patch).eq("id", id).eq("status", "draft").select("*").single();
  if (error) throw new Error(error.message);
  return data as CommunicationCampaign;
}

export async function approveCampaign(id: string): Promise<CommunicationCampaign> {
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase.from("communication_campaigns")
    .update({ status: "approved", approved_by: auth.user?.id ?? null })
    .eq("id", id).eq("status", "draft").select("*").single();
  if (error) throw new Error(error.message);
  return data as CommunicationCampaign;
}

export async function archiveCampaign(id: string): Promise<void> {
  const { error } = await supabase.from("communication_campaigns")
    .update({ status: "archived" }).eq("id", id);
  if (error) throw new Error(error.message);
}
