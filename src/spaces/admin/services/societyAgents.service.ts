import { supabase } from "@/lib/supabase";

export interface SocietyInvoice {
  id: string; invoice_number: string; company_name: string; contact_name: string | null;
  contact_email: string | null; status: string; issue_date: string; due_date: string;
  amount_ttc_cents: number; currency: string; created_at: string;
}

export interface SocietyClient {
  id: string; name: string; email: string; plan: string;
  created_at: string; last_activity_at: string | null;
}

export interface SocietyTicket {
  id: string; requester_name: string; requester_email: string; subject: string; message: string;
  category: string; priority: "normal" | "urgent"; status: "open" | "closed";
  draft_subject: string; draft_body: string; internal_note: string;
  created_at: string; updated_at: string;
}

export interface SocietySnapshot {
  generated_at: string;
  invoices: SocietyInvoice[];
  platform_invoices: Array<{ id: string; status: string; total_cents: number; currency: string; paid_at: string | null; created_at: string }>;
  clients: SocietyClient[];
  tickets: SocietyTicket[];
  limits: Record<string, number>;
}

export interface AgentDraft { subject: string; body: string; internal_note: string }
export interface WeeklyBrief {
  metrics: { date: string; invoices_overdue: number; invoices_pending: number; outstanding_cents: number;
    platform_payments_paid_30d_cents: number; open_support_tickets: number; clients_total_in_snapshot: number; new_clients_30d: number };
  summary: string; actions: string[];
}

async function callAgent<T>(input: Record<string, unknown>): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Session expirée. Reconnectez-vous.");
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!base) throw new Error("Configuration Supabase manquante.");
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  if (import.meta.env.VITE_SUPABASE_ANON_KEY) headers.apikey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const response = await fetch(`${base}/functions/v1/admin-society-agents`, {
    method: "POST", headers, body: JSON.stringify(input),
  });
  const result = await response.json().catch(() => null) as { data?: T; error?: { message?: string } } | null;
  if (!response.ok || result?.data === undefined) throw new Error(result?.error?.message ?? `Agent indisponible (${response.status}).`);
  return result.data;
}

export const getSocietySnapshot = () => callAgent<SocietySnapshot>({ action: "snapshot" });
export const createSupportTicket = (input: { requester_name: string; requester_email: string; subject: string; message: string }) =>
  callAgent<SocietyTicket>({ action: "create_ticket", ...input });
export const updateSupportTicket = (id: string, patch: Partial<Pick<SocietyTicket, "status" | "draft_subject" | "draft_body" | "internal_note">>) =>
  callAgent<SocietyTicket>({ action: "update_ticket", id, ...patch });
export const generateSocietyDraft = (kind: "support" | "finance" | "followup", sourceId: string) =>
  callAgent<{ draft: AgentDraft; ticket?: SocietyTicket }>({ action: "draft", kind, source_id: sourceId });
export const generateWeeklyBrief = () => callAgent<WeeklyBrief>({ action: "weekly_brief" });
