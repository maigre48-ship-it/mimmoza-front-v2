import { computeLineTotals } from '../helpers';
import { supabase } from '../../../../lib/supabase';
import type { CreateQuoteLinePayload, Invoice, InvoiceLine, InvoiceStatus } from '../types';

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

// ─── Admin : création directe d'une facture ──────────────────────────────────

export interface CreateInvoicePayload {
  company_name: string;
  contact_name?: string;
  contact_email?: string;
  /** Défaut : 2000 (20 %), aligné sur createQuoteWithLines. */
  vat_rate_bps?: number;
  notes?: string;
  organization_id?: string | null;
  recipient_user_id?: string | null;
  /** Défaut : aujourd'hui. Format ISO `YYYY-MM-DD`. */
  issue_date?: string;
  /** Défaut : issue_date + 30 jours. Format ISO `YYYY-MM-DD`. */
  due_date?: string;
  lines: CreateQuoteLinePayload[];
}

function jourISO(date: Date): string {
  // Découpe la date locale plutôt que d'utiliser toISOString(), qui bascule en
  // UTC et décale d'un jour les créations faites en soirée depuis la France.
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const jour = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${mois}-${jour}`;
}

/**
 * Crée une facture sans devis préalable (`quote_id` reste null, ce que la base
 * autorise). Le numéro vient de la même RPC `generate_invoice_number` que la
 * conversion de devis : les deux chemins partagent donc une seule séquence, et
 * il ne peut pas y avoir deux numérotations concurrentes.
 *
 * Une facture naît en statut 'draft'. Le passage à 'issued'/'sent' reste un
 * geste explicite, depuis la page Factures.
 */
export async function createInvoiceWithLines(
  payload: CreateInvoicePayload,
): Promise<Invoice> {
  if (payload.lines.length === 0) {
    throw new Error('Une facture doit comporter au moins une ligne.');
  }

  // La base impose `invoice_lines.quantity > 0` et des montants positifs.
  // On refuse ici, avec un message lisible, plutôt que de laisser remonter
  // l'erreur brute de la contrainte Postgres.
  payload.lines.forEach((l, i) => {
    const rang = i + 1;
    if (!l.label.trim()) throw new Error(`Ligne ${rang} : la désignation est obligatoire.`);
    if (!(l.quantity > 0)) throw new Error(`Ligne ${rang} : la quantité doit être supérieure à 0.`);
    if (l.unit_price_ht_cents < 0) {
      throw new Error(`Ligne ${rang} : le prix unitaire ne peut pas être négatif.`);
    }
  });

  const { data: numData, error: numError } = await supabase.rpc('generate_invoice_number');
  if (numError) throw new Error(numError.message);
  const invoice_number = numData as string;

  const vatRateBps = payload.vat_rate_bps ?? 2000;
  const totals = computeLineTotals(payload.lines, vatRateBps);

  const issueDate = payload.issue_date ?? jourISO(new Date());
  const dueDate = payload.due_date ?? (() => {
    const d = new Date(`${issueDate}T00:00:00`);
    d.setDate(d.getDate() + 30);
    return jourISO(d);
  })();

  const { data: invoiceData, error: invoiceError } = await supabase
    .from('invoices')
    .insert({
      invoice_number,
      quote_id:          null,
      company_name:      payload.company_name,
      contact_name:      payload.contact_name    ?? null,
      contact_email:     payload.contact_email   ?? null,
      organization_id:   payload.organization_id ?? null,
      recipient_user_id: payload.recipient_user_id ?? null,
      status:            'draft',
      issue_date:        issueDate,
      due_date:          dueDate,
      vat_rate_bps:      vatRateBps,
      currency:          'eur',
      notes:             payload.notes ?? null,
      ...totals,
    })
    .select()
    .single();
  if (invoiceError) throw new Error(invoiceError.message);
  const invoice = invoiceData as Invoice;

  const lines = payload.lines.map((l, i) => ({
    invoice_id:          invoice.id,
    label:               l.label,
    description:         l.description ?? null,
    quantity:            l.quantity,
    unit_price_ht_cents: l.unit_price_ht_cents,
    total_ht_cents:      Math.round(l.quantity * l.unit_price_ht_cents),
    sort_order:          l.sort_order ?? i,
  }));

  const { error: linesError } = await supabase.from('invoice_lines').insert(lines);
  if (linesError) throw new Error(linesError.message);

  return invoice;
}