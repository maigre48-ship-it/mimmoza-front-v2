import { supabase } from '../../../../lib/supabase';
import type { Invoice, InvoiceLine, InvoiceStatus } from '../types';

// ─── Admin : lecture globale ─────────────────────────────────────────────────

export async function listInvoices(): Promise<Invoice[]> {
  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Invoice[];
}

export async function getInvoiceById(id: string): Promise<Invoice> {
  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw new Error(error.message);
  return data as Invoice;
}

export async function listInvoiceLines(invoiceId: string): Promise<InvoiceLine[]> {
  const { data, error } = await supabase
    .from('invoice_lines')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as InvoiceLine[];
}

export async function updateInvoiceStatus(id: string, status: InvoiceStatus): Promise<Invoice> {
  const { data, error } = await supabase
    .from('invoices')
    .update({ status })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Invoice;
}

export async function markInvoiceAsPaid(id: string): Promise<Invoice> {
  const { data, error } = await supabase
    .from('invoices')
    .update({ status: 'paid', paid_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Invoice;
}

// ─── Admin : assignation / envoi au compte client ────────────────────────────

/** Lie une facture à un compte utilisateur (la rend visible dans son espace). */
export async function assignInvoiceRecipient(
  invoiceId: string,
  recipientUserId: string,
): Promise<Invoice> {
  const { data, error } = await supabase
    .from('invoices')
    .update({ recipient_user_id: recipientUserId })
    .eq('id', invoiceId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Invoice;
}

/**
 * "Envoyer au client" : assigne le destinataire et marque la facture comme émise
 * (si elle était encore en brouillon). La visibilité côté client est ensuite
 * garantie par la RLS (recipient_user_id = auth.uid()).
 */
export async function sendInvoiceToClient(
  invoiceId: string,
  recipientUserId: string,
): Promise<Invoice> {
  const patch: Partial<Invoice> = { recipient_user_id: recipientUserId };
  const current = await getInvoiceById(invoiceId);
  if (current.status === 'draft') patch.status = 'issued';

  const { data, error } = await supabase
    .from('invoices')
    .update(patch)
    .eq('id', invoiceId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Invoice;
}

// ─── Client : "mes factures" ─────────────────────────────────────────────────

/**
 * Factures du client connecté. La RLS restreint déjà aux factures dont
 * recipient_user_id = auth.uid() ; le filtre explicite est conservé par clarté.
 */
export async function listMyInvoices(): Promise<Invoice[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('recipient_user_id', user.id)
    .order('issue_date', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Invoice[];
}