// src/spaces/admin/pages/Devis.tsx

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Trash2, ArrowRight, Eye, Loader2,
  ChevronDown, FileText, FileDown,
} from 'lucide-react';
import type {
  Quote, QuoteStatus, TargetSpace, CreateQuoteLinePayload,
} from '../../../features/admin/billing/types';
import {
  listQuotes, createQuoteWithLines, updateQuoteStatus,
  convertQuoteToInvoice, listQuoteLines,
} from '../../../features/admin/billing/services/quotes.service';
import {
  formatCents, formatBillingStatusLabel, formatTargetSpaceLabel,
  formatDate, getQuoteStatusColor, canConvertQuoteToInvoice,
  isQuoteConverted, computeLineTotals,
} from '../../../features/admin/billing/helpers';
import { exportQuotePdf } from '../../../features/admin/billing/exportBillingPdf';

// ---- Types formulaire ----

interface LineForm {
  label: string;
  description: string;
  quantity: string;
  unit_price_ht_euros: string;
}

const defaultLine = (): LineForm => ({
  label: '', description: '', quantity: '1', unit_price_ht_euros: '',
});

interface QuoteForm {
  company_name: string;
  contact_name: string;
  contact_email: string;
  target_space: TargetSpace;
  vat_rate_percent: string;
  notes: string;
  lines: LineForm[];
}

const defaultForm = (): QuoteForm => ({
  company_name: '', contact_name: '', contact_email: '',
  target_space: 'promoteur', vat_rate_percent: '20', notes: '',
  lines: [defaultLine()],
});

const QUOTE_STATUSES: { value: QuoteStatus; label: string }[] = [
  { value: 'draft',    label: 'Brouillon' },
  { value: 'sent',     label: 'Envoyé' },
  { value: 'viewed',   label: 'Consulté' },
  { value: 'accepted', label: 'Accepté' },
  { value: 'rejected', label: 'Refusé' },
  { value: 'expired',  label: 'Expiré' },
];

const TARGET_SPACES: TargetSpace[] = ['promoteur', 'financeur', 'investisseur', 'autre'];

// ============================================================
// Composant
// ============================================================

const DevisPage: React.FC = () => {
  const navigate = useNavigate();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<QuoteForm>(defaultForm());
  const [submitting, setSubmitting] = useState(false);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listQuotes();
      setQuotes(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const parsedLines = form.lines.map((l) => ({
    quantity: parseFloat(l.quantity) || 0,
    unit_price_ht_cents: Math.round((parseFloat(l.unit_price_ht_euros) || 0) * 100),
  }));
  const vatRateBps = Math.round((parseFloat(form.vat_rate_percent) || 0) * 100);
  const preview = computeLineTotals(parsedLines, vatRateBps);

  const setFormField = <K extends keyof QuoteForm>(key: K, value: QuoteForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const setLineField = (index: number, key: keyof LineForm, value: string) => {
    setForm((f) => {
      const lines = [...f.lines];
      lines[index] = { ...lines[index], [key]: value };
      return { ...f, lines };
    });
  };

  const addLine = () => setForm((f) => ({ ...f, lines: [...f.lines, defaultLine()] }));
  const removeLine = (index: number) =>
    setForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== index) }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const lines: CreateQuoteLinePayload[] = form.lines.map((l, i) => ({
        label: l.label,
        description: l.description || undefined,
        quantity: parseFloat(l.quantity) || 1,
        unit_price_ht_cents: Math.round((parseFloat(l.unit_price_ht_euros) || 0) * 100),
        sort_order: i,
      }));
      await createQuoteWithLines({
        company_name:  form.company_name,
        contact_name:  form.contact_name  || undefined,
        contact_email: form.contact_email || undefined,
        target_space:  form.target_space,
        vat_rate_bps:  vatRateBps,
        notes:         form.notes         || undefined,
        lines,
      });
      setForm(defaultForm());
      setShowForm(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (id: string, status: QuoteStatus) => {
    try {
      const updated = await updateQuoteStatus(id, status);
      setQuotes((prev) => prev.map((q) => (q.id === id ? updated : q)));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleConvert = async (quoteId: string) => {
    setConvertingId(quoteId);
    setError(null);
    try {
      const invoiceId = await convertQuoteToInvoice(quoteId);
      await load();
      navigate(`/admin/factures?highlight=${invoiceId}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setConvertingId(null);
    }
  };

  const handleExportPdf = async (quote: Quote) => {
    setExportingId(quote.id);
    try {
      const lines = await listQuoteLines(quote.id);
      exportQuotePdf(quote, lines);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExportingId(null);
    }
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Devis</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {"Gérez vos devis et convertissez-les en factures."}
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 transition-colors"
        >
          <Plus size={16} />
          Nouveau devis
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Formulaire */}
      {showForm && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-5 text-base font-semibold text-gray-800">Nouveau devis</h2>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  {"Société"} <span className="text-red-500">*</span>
                </label>
                <input
                  required type="text" value={form.company_name}
                  onChange={(e) => setFormField('company_name', e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  placeholder="Société ABC"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Espace cible</label>
                <select
                  value={form.target_space}
                  onChange={(e) => setFormField('target_space', e.target.value as TargetSpace)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                >
                  {TARGET_SPACES.map((s) => (
                    <option key={s} value={s}>{formatTargetSpaceLabel(s)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Contact</label>
                <input
                  type="text" value={form.contact_name}
                  onChange={(e) => setFormField('contact_name', e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  placeholder="Jean Dupont"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Email</label>
                <input
                  type="email" value={form.contact_email}
                  onChange={(e) => setFormField('contact_email', e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  placeholder="jean@societe.fr"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">TVA (%)</label>
                <input
                  type="number" step="0.01" min="0" value={form.vat_rate_percent}
                  onChange={(e) => setFormField('vat_rate_percent', e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Notes</label>
                <input
                  type="text" value={form.notes}
                  onChange={(e) => setFormField('notes', e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  placeholder="Conditions particulières…"
                />
              </div>
            </div>

            {/* Lignes */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Lignes</p>
                <button
                  type="button" onClick={addLine}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 transition-colors"
                >
                  <Plus size={12} /> Ajouter une ligne
                </button>
              </div>
              <div className="space-y-2">
                {form.lines.map((line, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 rounded-lg border border-gray-100 bg-gray-50 p-3">
                    <div className="col-span-4">
                      <input
                        required type="text" placeholder="Prestation" value={line.label}
                        onChange={(e) => setLineField(i, 'label', e.target.value)}
                        className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-indigo-400"
                      />
                    </div>
                    <div className="col-span-3">
                      <input
                        type="text" placeholder="Description" value={line.description}
                        onChange={(e) => setLineField(i, 'description', e.target.value)}
                        className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-indigo-400"
                      />
                    </div>
                    <div className="col-span-2">
                      <input
                        required type="number" step="0.01" min="0.01" placeholder="Qté" value={line.quantity}
                        onChange={(e) => setLineField(i, 'quantity', e.target.value)}
                        className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-indigo-400"
                      />
                    </div>
                    <div className="col-span-2">
                      <input
                        required type="number" step="0.01" min="0" placeholder="PU HT (€)"
                        value={line.unit_price_ht_euros}
                        onChange={(e) => setLineField(i, 'unit_price_ht_euros', e.target.value)}
                        className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-indigo-400"
                      />
                    </div>
                    <div className="col-span-1 flex items-center justify-center">
                      {form.lines.length > 1 && (
                        <button
                          type="button" onClick={() => removeLine(i)}
                          className="rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Totaux preview */}
            <div className="flex justify-end">
              <div className="min-w-[220px] rounded-lg border border-gray-100 bg-gray-50 px-5 py-3 text-sm space-y-1">
                <div className="flex justify-between gap-8 text-gray-600">
                  <span>Total HT</span>
                  <span className="font-medium text-gray-900">{formatCents(preview.amount_ht_cents)}</span>
                </div>
                <div className="flex justify-between gap-8 text-gray-500">
                  <span>TVA ({form.vat_rate_percent}%)</span>
                  <span>{formatCents(preview.vat_amount_cents)}</span>
                </div>
                <div className="flex justify-between gap-8 border-t border-gray-200 pt-1 font-semibold text-gray-900">
                  <span>Total TTC</span>
                  <span>{formatCents(preview.amount_ttc_cents)}</span>
                </div>
              </div>
            </div>

            {/* Actions formulaire */}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => { setShowForm(false); setForm(defaultForm()); }}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Annuler
              </button>
              <button
                type="submit" disabled={submitting}
                className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
              >
                {submitting && <Loader2 size={14} className="animate-spin" />}
                {"Créer le devis"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Liste */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 size={20} className="animate-spin mr-2" /> Chargement…
          </div>
        ) : quotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <FileText size={36} className="mb-3 text-gray-200" />
            <p className="text-sm font-medium text-gray-500">{"Aucun devis pour l'instant"}</p>
            <p className="mt-1 text-xs text-gray-400">{"Cliquez sur « Nouveau devis » pour commencer."}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead>
                <tr className="bg-gray-50">
                  {['Numéro', 'Société', 'Contact', 'Espace', 'Statut', 'HT', 'TTC', 'Date', 'Actions'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {quotes.map((q) => (
                  <tr key={q.id} className="hover:bg-gray-50/60 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs font-medium text-indigo-700">
                      {q.quote_number}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">{q.company_name}</td>
                    <td className="px-4 py-3 text-gray-500">{q.contact_name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{formatTargetSpaceLabel(q.target_space)}</td>
                    <td className="px-4 py-3">
                      {isQuoteConverted(q) ? (
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getQuoteStatusColor(q.status)}`}>
                          {formatBillingStatusLabel(q.status)}
                        </span>
                      ) : (
                        <div className="relative inline-block">
                          <select
                            value={q.status}
                            onChange={(e) => handleStatusChange(q.id, e.target.value as QuoteStatus)}
                            className={`appearance-none rounded-full border-0 px-2.5 py-0.5 pr-6 text-xs font-medium outline-none cursor-pointer ${getQuoteStatusColor(q.status)}`}
                          >
                            {QUOTE_STATUSES.map((s) => (
                              <option key={s.value} value={s.value}>{s.label}</option>
                            ))}
                          </select>
                          <ChevronDown size={10} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 opacity-50" />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                      {formatCents(q.amount_ht_cents)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-gray-900">
                      {formatCents(q.amount_ttc_cents)}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">{formatDate(q.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {/* Export PDF */}
                        <button
                          onClick={() => handleExportPdf(q)}
                          disabled={exportingId === q.id}
                          title="Exporter en PDF"
                          className="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                        >
                          {exportingId === q.id
                            ? <Loader2 size={11} className="animate-spin" />
                            : <FileDown size={11} />}
                          PDF
                        </button>

                        {/* Facturer */}
                        {canConvertQuoteToInvoice(q) && (
                          <button
                            onClick={() => handleConvert(q.id)}
                            disabled={convertingId === q.id}
                            className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
                          >
                            {convertingId === q.id
                              ? <Loader2 size={11} className="animate-spin" />
                              : <ArrowRight size={11} />}
                            Facturer
                          </button>
                        )}

                        {/* Voir facture */}
                        {isQuoteConverted(q) && q.invoice_id && (
                          <button
                            onClick={() => navigate(`/admin/factures?highlight=${q.invoice_id}`)}
                            className="flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                          >
                            <Eye size={11} />
                            Facture
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default DevisPage;