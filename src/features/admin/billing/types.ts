// ============================================================
// MIMMOZA — Billing Types
// ============================================================

export type QuoteStatus =
  | 'draft'
  | 'sent'
  | 'viewed'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'converted_to_invoice';

export type InvoiceStatus =
  | 'draft'
  | 'issued'
  | 'sent'
  | 'paid'
  | 'partially_paid'
  | 'overdue'
  | 'cancelled';

export type TargetSpace = 'promoteur' | 'financeur' | 'investisseur' | 'autre';

// ---- Quote ----

export interface Quote {
  id: string;
  quote_number: string;
  organization_id: string | null;
  company_name: string;
  contact_name: string | null;
  contact_email: string | null;
  target_space: TargetSpace;
  status: QuoteStatus;
  amount_ht_cents: number;
  vat_rate_bps: number;
  vat_amount_cents: number;
  amount_ttc_cents: number;
  notes: string | null;
  accepted_at: string | null;
  converted_to_invoice_at: string | null;
  invoice_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuoteLine {
  id: string;
  quote_id: string;
  label: string;
  description: string | null;
  quantity: number;
  unit_price_ht_cents: number;
  total_ht_cents: number;
  sort_order: number;
  created_at: string;
}

// ---- Invoice ----

export interface Invoice {
  id: string;
  invoice_number: string;
  quote_id: string | null;
  organization_id: string | null;
  company_name: string;
  contact_name: string | null;
  contact_email: string | null;
  status: InvoiceStatus;
  issue_date: string;
  due_date: string;
  amount_ht_cents: number;
  vat_rate_bps: number;
  vat_amount_cents: number;
  amount_ttc_cents: number;
  currency: string;
  notes: string | null;
  paid_at: string | null;
  pdf_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceLine {
  id: string;
  invoice_id: string;
  label: string;
  description: string | null;
  quantity: number;
  unit_price_ht_cents: number;
  total_ht_cents: number;
  sort_order: number;
  created_at: string;
}

// ---- Payloads ----

export interface CreateQuoteLinePayload {
  label: string;
  description?: string;
  quantity: number;
  unit_price_ht_cents: number;
  sort_order?: number;
}

export interface CreateQuotePayload {
  company_name: string;
  contact_name?: string;
  contact_email?: string;
  target_space: TargetSpace;
  vat_rate_bps?: number;
  notes?: string;
  organization_id?: string;
  lines: CreateQuoteLinePayload[];
}