import type { QuoteStatus, InvoiceStatus, TargetSpace, Quote, Invoice, CreateQuoteLinePayload } from './types';

// ---- Formatage montant ----

export function formatCents(cents: number, currency = 'eur'): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

// ---- Labels statuts ----

export function formatBillingStatusLabel(status: QuoteStatus | InvoiceStatus): string {
  const labels: Record<string, string> = {
    draft:                'Brouillon',
    sent:                 'Envoyé',
    viewed:               'Consulté',
    accepted:             'Accepté',
    rejected:             'Refusé',
    expired:              'Expiré',
    converted_to_invoice: 'Converti',
    issued:               'Émise',
    paid:                 'Payée',
    partially_paid:       'Part. payée',
    overdue:              'En retard',
    cancelled:            'Annulée',
  };
  return labels[status] ?? status;
}

export function formatTargetSpaceLabel(space: TargetSpace): string {
  const labels: Record<TargetSpace, string> = {
    promoteur:   'Promoteur',
    financeur:   'Financeur',
    investisseur:'Investisseur',
    autre:       'Autre',
  };
  return labels[space];
}

// ---- Couleurs badges ----

export function getQuoteStatusColor(status: QuoteStatus): string {
  const map: Record<QuoteStatus, string> = {
    draft:                'bg-gray-100 text-gray-600',
    sent:                 'bg-blue-100 text-blue-700',
    viewed:               'bg-indigo-100 text-indigo-700',
    accepted:             'bg-green-100 text-green-700',
    rejected:             'bg-red-100 text-red-700',
    expired:              'bg-orange-100 text-orange-700',
    converted_to_invoice: 'bg-purple-100 text-purple-700',
  };
  return map[status] ?? 'bg-gray-100 text-gray-600';
}

export function getInvoiceStatusColor(status: InvoiceStatus): string {
  const map: Record<InvoiceStatus, string> = {
    draft:          'bg-gray-100 text-gray-600',
    issued:         'bg-blue-100 text-blue-700',
    sent:           'bg-indigo-100 text-indigo-700',
    paid:           'bg-green-100 text-green-700',
    partially_paid: 'bg-yellow-100 text-yellow-700',
    overdue:        'bg-red-100 text-red-700',
    cancelled:      'bg-gray-100 text-gray-400',
  };
  return map[status] ?? 'bg-gray-100 text-gray-600';
}

// ---- Guards métier ----

export function canConvertQuoteToInvoice(quote: Quote): boolean {
  return quote.status === 'accepted' && quote.invoice_id === null;
}

export function isQuoteConverted(quote: Quote): boolean {
  return quote.status === 'converted_to_invoice' || quote.invoice_id !== null;
}

export function isInvoicePayable(invoice: Invoice): boolean {
  return (
    invoice.status === 'issued' ||
    invoice.status === 'sent' ||
    invoice.status === 'overdue'
  );
}

// ---- Calcul totaux ----

export function computeLineTotals(
  lines: Pick<CreateQuoteLinePayload, 'quantity' | 'unit_price_ht_cents'>[],
  vatRateBps: number
): { amount_ht_cents: number; vat_amount_cents: number; amount_ttc_cents: number } {
  const amount_ht_cents = lines.reduce(
    (acc, l) => acc + Math.round(l.quantity * l.unit_price_ht_cents),
    0
  );
  const vat_amount_cents = Math.round(amount_ht_cents * (vatRateBps / 10000));
  return {
    amount_ht_cents,
    vat_amount_cents,
    amount_ttc_cents: amount_ht_cents + vat_amount_cents,
  };
}

// ---- Formatage date ----

export function formatDate(dateStr: string): string {
  return new Intl.DateTimeFormat('fr-FR').format(new Date(dateStr));
}