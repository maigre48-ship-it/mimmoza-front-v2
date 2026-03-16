import { supabase } from '../../../../lib/supabase';
import type {
  Quote,
  QuoteLine,
  QuoteStatus,
  CreateQuotePayload,
  CreateQuoteLinePayload,
} from '../types';
import { computeLineTotals } from '../helpers';

export async function listQuotes(): Promise<Quote[]> {
  const { data, error } = await supabase
    .from('quotes')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Quote[];
}

export async function getQuoteById(id: string): Promise<Quote> {
  const { data, error } = await supabase
    .from('quotes')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw new Error(error.message);
  return data as Quote;
}

export async function listQuoteLines(quoteId: string): Promise<QuoteLine[]> {
  const { data, error } = await supabase
    .from('quote_lines')
    .select('*')
    .eq('quote_id', quoteId)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as QuoteLine[];
}

export async function updateQuoteStatus(id: string, status: QuoteStatus): Promise<Quote> {
  const patch: Partial<Quote> = { status };
  if (status === 'accepted') {
    patch.accepted_at = new Date().toISOString();
  }
  const { data, error } = await supabase
    .from('quotes')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Quote;
}

export async function convertQuoteToInvoice(quoteId: string): Promise<string> {
  const { data, error } = await supabase.rpc('convert_quote_to_invoice', {
    p_quote_id: quoteId,
  });
  if (error) throw new Error(error.message);
  return data as string; // retourne invoice_id (uuid)
}

export async function createQuoteWithLines(payload: CreateQuotePayload): Promise<Quote> {
  // 1. Générer le numéro via RPC SQL
  const { data: numData, error: numError } = await supabase.rpc('generate_quote_number');
  if (numError) throw new Error(numError.message);
  const quote_number = numData as string;

  // 2. Calculer les totaux
  const vatRateBps = payload.vat_rate_bps ?? 2000;
  const totals = computeLineTotals(payload.lines, vatRateBps);

  // 3. Insérer le devis
  const { data: quoteData, error: quoteError } = await supabase
    .from('quotes')
    .insert({
      quote_number,
      company_name:    payload.company_name,
      contact_name:    payload.contact_name   ?? null,
      contact_email:   payload.contact_email  ?? null,
      target_space:    payload.target_space,
      vat_rate_bps:    vatRateBps,
      notes:           payload.notes          ?? null,
      organization_id: payload.organization_id ?? null,
      status:          'draft',
      ...totals,
    })
    .select()
    .single();
  if (quoteError) throw new Error(quoteError.message);
  const quote = quoteData as Quote;

  // 4. Insérer les lignes
  const lines = payload.lines.map((l, i): Omit<CreateQuoteLinePayload, 'description'> & {
    quote_id: string;
    description: string | null;
    total_ht_cents: number;
    sort_order: number;
  } => ({
    quote_id:           quote.id,
    label:              l.label,
    description:        l.description ?? null,
    quantity:           l.quantity,
    unit_price_ht_cents:l.unit_price_ht_cents,
    total_ht_cents:     Math.round(l.quantity * l.unit_price_ht_cents),
    sort_order:         l.sort_order ?? i,
  }));

  const { error: linesError } = await supabase.from('quote_lines').insert(lines);
  if (linesError) throw new Error(linesError.message);

  return quote;
}