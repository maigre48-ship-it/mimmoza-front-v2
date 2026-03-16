// src/spaces/admin/pages/Factures.tsx

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ReceiptText, CheckCircle2, Clock, Search, X,
  Loader2, ChevronRight, Euro, Download, FileDown,
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Invoice, InvoiceLine, InvoiceStatus } from '../../../features/admin/billing/types';
import {
  listInvoices, markInvoiceAsPaid, listInvoiceLines, getInvoiceById,
} from '../../../features/admin/billing/services/invoices.service';
import {
  formatCents, formatBillingStatusLabel, formatDate,
  getInvoiceStatusColor, isInvoicePayable,
} from '../../../features/admin/billing/helpers';
import { exportInvoicePdf } from '../../../features/admin/billing/exportBillingPdf';

const ALL_INVOICE_STATUSES: InvoiceStatus[] = [
  'draft', 'issued', 'sent', 'paid', 'partially_paid', 'overdue', 'cancelled',
];

function getMonthKey(dateStr: string): string {
  return dateStr.slice(0, 7);
}

function formatMonthLabel(key: string): string {
  const [year, month] = key.split('-');
  return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(
    new Date(Number(year), Number(month) - 1, 1)
  );
}

// Export liste PDF
function exportInvoicesToPdf(invoices: Invoice[], monthLabel: string): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Mimmoza — Liste des factures', 14, 16);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120);
  doc.text(
    `Période : ${monthLabel} · Exporté le ${new Intl.DateTimeFormat('fr-FR').format(new Date())}`,
    14, 23
  );
  doc.setTextColor(0);
  const totalHt   = invoices.reduce((a, i) => a + i.amount_ht_cents, 0);
  const totalTtc  = invoices.reduce((a, i) => a + i.amount_ttc_cents, 0);
  const totalPaid = invoices.filter((i) => i.status === 'paid').reduce((a, i) => a + i.amount_ttc_cents, 0);
  doc.setFontSize(8);
  doc.setTextColor(80);
  doc.text(
    `Total HT : ${(totalHt / 100).toFixed(2)} € · Total TTC : ${(totalTtc / 100).toFixed(2)} € · Encaissé : ${(totalPaid / 100).toFixed(2)} €`,
    14, 30
  );
  doc.setTextColor(0);
  autoTable(doc, {
    startY: 35,
    head: [['Numéro', 'Société', 'Contact', 'Émission', 'Échéance', 'HT (€)', 'TTC (€)', 'Statut']],
    body: invoices.map((inv) => [
      inv.invoice_number, inv.company_name, inv.contact_name ?? '—',
      formatDate(inv.issue_date), formatDate(inv.due_date),
      (inv.amount_ht_cents / 100).toFixed(2),
      (inv.amount_ttc_cents / 100).toFixed(2),
      formatBillingStatusLabel(inv.status),
    ]),
    headStyles: { fillColor: [30, 30, 30], textColor: 255, fontStyle: 'bold', fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [248, 249, 250] },
    columnStyles: {
      0: { cellWidth: 28, fontStyle: 'bold', textColor: [79, 70, 229] },
      5: { halign: 'right' },
      6: { halign: 'right', fontStyle: 'bold' },
    },
    margin: { left: 14, right: 14 },
  });
  doc.save(`factures_${monthLabel.replace(/\s/g, '_')}.pdf`);
}

// ============================================================
// Panneau détail
// ============================================================

interface DetailPanelProps {
  invoiceId: string;
  onClose: () => void;
  onPaid: (invoice: Invoice) => void;
}

const DetailPanel: React.FC<DetailPanelProps> = ({ invoiceId, onClose, onPaid }) => {
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [inv, ls] = await Promise.all([
          getInvoiceById(invoiceId),
          listInvoiceLines(invoiceId),
        ]);
        setInvoice(inv);
        setLines(ls);
      } finally {
        setLoading(false);
      }
    })();
  }, [invoiceId]);

  const handlePay = async () => {
    if (!invoice) return;
    setPaying(true);
    try {
      const updated = await markInvoiceAsPaid(invoice.id);
      setInvoice(updated);
      onPaid(updated);
    } finally {
      setPaying(false);
    }
  };

  const handleExportPdf = async () => {
    if (!invoice) return;
    setExporting(true);
    try {
      // Les lignes sont déjà chargées
      exportInvoicePdf(invoice, lines);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-lg flex-col border-l border-gray-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <ReceiptText size={18} className="text-indigo-600" />
            {invoice && (
              <span className="font-mono text-sm font-bold text-indigo-700">
                {invoice.invoice_number}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {invoice && (
              <button
                onClick={handleExportPdf}
                disabled={exporting || loading}
                title="Exporter en PDF"
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                {exporting
                  ? <Loader2 size={12} className="animate-spin" />
                  : <FileDown size={12} />}
                PDF
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-1 items-center justify-center text-gray-400">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : invoice ? (
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
            {/* Statut + paiement */}
            <div className="flex items-center justify-between">
              <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${getInvoiceStatusColor(invoice.status)}`}>
                {formatBillingStatusLabel(invoice.status)}
              </span>
              {isInvoicePayable(invoice) && (
                <button
                  onClick={handlePay}
                  disabled={paying}
                  className="flex items-center gap-2 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-60 transition-colors"
                >
                  {paying ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                  Marquer payée
                </button>
              )}
            </div>

            {/* Infos */}
            <div className="grid grid-cols-2 gap-4 rounded-lg border border-gray-100 bg-gray-50 p-4 text-sm">
              <div>
                <p className="text-xs text-gray-400">{"Société"}</p>
                <p className="font-medium text-gray-900">{invoice.company_name}</p>
              </div>
              {invoice.contact_name && (
                <div>
                  <p className="text-xs text-gray-400">Contact</p>
                  <p className="text-gray-700">{invoice.contact_name}</p>
                </div>
              )}
              {invoice.contact_email && (
                <div className="col-span-2">
                  <p className="text-xs text-gray-400">Email</p>
                  <p className="text-gray-700">{invoice.contact_email}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-gray-400">{"Émission"}</p>
                <p className="text-gray-700">{formatDate(invoice.issue_date)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">{"Échéance"}</p>
                <p className="text-gray-700">{formatDate(invoice.due_date)}</p>
              </div>
              {invoice.paid_at && (
                <div>
                  <p className="text-xs text-gray-400">{"Payée le"}</p>
                  <p className="font-medium text-green-700">{formatDate(invoice.paid_at)}</p>
                </div>
              )}
            </div>

            {/* Lignes */}
            {lines.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Lignes</p>
                <div className="divide-y divide-gray-100 rounded-lg border border-gray-100 bg-white overflow-hidden">
                  {lines.map((line) => (
                    <div key={line.id} className="flex items-start justify-between px-4 py-3 text-sm">
                      <div>
                        <p className="font-medium text-gray-900">{line.label}</p>
                        {line.description && <p className="text-xs text-gray-400">{line.description}</p>}
                        <p className="text-xs text-gray-400">
                          {line.quantity} &times; {formatCents(line.unit_price_ht_cents)}
                        </p>
                      </div>
                      <span className="font-semibold text-gray-900 tabular-nums">
                        {formatCents(line.total_ht_cents)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Totaux */}
            <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 space-y-1 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>Total HT</span>
                <span className="tabular-nums">{formatCents(invoice.amount_ht_cents)}</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>TVA ({invoice.vat_rate_bps / 100}%)</span>
                <span className="tabular-nums">{formatCents(invoice.vat_amount_cents)}</span>
              </div>
              <div className="flex justify-between border-t border-gray-200 pt-1 font-bold text-gray-900">
                <span>Total TTC</span>
                <span className="tabular-nums">{formatCents(invoice.amount_ttc_cents)}</span>
              </div>
            </div>

            {invoice.notes && (
              <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3">
                <p className="mb-1 text-xs font-medium text-amber-600">Note</p>
                <p className="text-sm text-amber-900">{invoice.notes}</p>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
};

// ============================================================
// Page principale
// ============================================================

const FacturesPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get('highlight');
  const highlightRef = useRef<string | null>(highlightId);

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'all'>('all');
  const [monthFilter, setMonthFilter] = useState<string>('all');
  const [detailId, setDetailId] = useState<string | null>(highlightId);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listInvoices();
      setInvoices(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (highlightRef.current && invoices.length > 0) {
      const found = invoices.find((inv) => inv.id === highlightRef.current);
      if (found) { setDetailId(found.id); highlightRef.current = null; }
    }
  }, [invoices]);

  const availableMonths = useMemo(() => {
    const keys = Array.from(new Set(invoices.map((inv) => getMonthKey(inv.issue_date))));
    return keys.sort((a, b) => b.localeCompare(a));
  }, [invoices]);

  const kpis = useMemo(() => {
    const total_ht      = invoices.reduce((a, i) => a + i.amount_ht_cents, 0);
    const total_ttc     = invoices.reduce((a, i) => a + i.amount_ttc_cents, 0);
    const total_paid    = invoices.filter((i) => i.status === 'paid').reduce((a, i) => a + i.amount_ttc_cents, 0);
    const total_pending = invoices.filter((i) => ['issued', 'sent', 'overdue'].includes(i.status)).reduce((a, i) => a + i.amount_ttc_cents, 0);
    return { count: invoices.length, total_ht, total_ttc, total_paid, total_pending };
  }, [invoices]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return invoices.filter((inv) => {
      const matchSearch =
        !q ||
        inv.invoice_number.toLowerCase().includes(q) ||
        inv.company_name.toLowerCase().includes(q) ||
        (inv.contact_name?.toLowerCase().includes(q) ?? false);
      const matchStatus = statusFilter === 'all' || inv.status === statusFilter;
      const matchMonth  = monthFilter === 'all' || getMonthKey(inv.issue_date) === monthFilter;
      return matchSearch && matchStatus && matchMonth;
    });
  }, [invoices, search, statusFilter, monthFilter]);

  const handleExportList = () => {
    const label = monthFilter === 'all' ? 'Toutes périodes' : formatMonthLabel(monthFilter);
    exportInvoicesToPdf(filtered, label);
  };

  const handlePaid = (updated: Invoice) => {
    setInvoices((prev) => prev.map((inv) => (inv.id === updated.id ? updated : inv)));
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Factures</h1>
          <p className="mt-0.5 text-sm text-gray-500">{"Suivi de toutes les factures émises."}</p>
        </div>
        <button
          onClick={handleExportList}
          disabled={filtered.length === 0}
          className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-40 transition-colors"
        >
          <Download size={15} />
          {"Exporter liste PDF"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        {[
          { label: 'Factures',    value: kpis.count.toString(),          icon: ReceiptText,  color: 'text-indigo-600', bg: 'bg-indigo-50' },
          { label: 'Total HT',   value: formatCents(kpis.total_ht),     icon: Euro,         color: 'text-gray-600',   bg: 'bg-gray-50'   },
          { label: 'Total TTC',  value: formatCents(kpis.total_ttc),    icon: Euro,         color: 'text-blue-600',   bg: 'bg-blue-50'   },
          { label: 'Encaissé',   value: formatCents(kpis.total_paid),   icon: CheckCircle2, color: 'text-green-600',  bg: 'bg-green-50'  },
          { label: 'En attente', value: formatCents(kpis.total_pending), icon: Clock,        color: 'text-orange-600', bg: 'bg-orange-50' },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <div className={`mb-2 inline-flex rounded-lg p-2 ${bg}`}>
              <Icon size={16} className={color} />
            </div>
            <p className="text-xs text-gray-400">{label}</p>
            <p className={`mt-0.5 font-bold text-gray-900 ${value.length > 10 ? 'text-sm' : 'text-base'}`}>
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* Filtres */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Rechercher par numéro, société…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-9 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          )}
        </div>
        <select
          value={monthFilter}
          onChange={(e) => setMonthFilter(e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        >
          <option value="all">Tous les mois</option>
          {availableMonths.map((key) => (
            <option key={key} value={key}>{formatMonthLabel(key)}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as InvoiceStatus | 'all')}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        >
          <option value="all">Tous les statuts</option>
          {ALL_INVOICE_STATUSES.map((s) => (
            <option key={s} value={s}>{formatBillingStatusLabel(s)}</option>
          ))}
        </select>
      </div>

      {(monthFilter !== 'all' || statusFilter !== 'all') && (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>
            {filtered.length} facture{filtered.length > 1 ? 's' : ''}
            {monthFilter !== 'all' ? ` · ${formatMonthLabel(monthFilter)}` : ''}
            {statusFilter !== 'all' ? ` · ${formatBillingStatusLabel(statusFilter as InvoiceStatus)}` : ''}
          </span>
          <button
            onClick={() => { setMonthFilter('all'); setStatusFilter('all'); }}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <X size={11} /> Réinitialiser
          </button>
        </div>
      )}

      {/* Tableau */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 size={20} className="animate-spin mr-2" /> Chargement…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <ReceiptText size={36} className="mb-3 text-gray-200" />
            <p className="text-sm font-medium text-gray-500">
              {invoices.length === 0 ? "Aucune facture pour l'instant" : "Aucun résultat pour ces filtres"}
            </p>
            {invoices.length === 0 && (
              <p className="mt-1 text-xs text-gray-400">
                {"Les factures apparaissent ici après conversion d'un devis accepté."}
              </p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead>
                <tr className="bg-gray-50">
                  {['Numéro', 'Société', 'Devis source', 'Émission', 'Échéance', 'HT', 'TTC', 'Statut', ''].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((inv) => (
                  <tr
                    key={inv.id}
                    onClick={() => setDetailId(inv.id)}
                    className={`cursor-pointer transition-colors hover:bg-indigo-50/40 ${detailId === inv.id ? 'bg-indigo-50/60' : ''}`}
                  >
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-indigo-700">{inv.invoice_number}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{inv.company_name}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">
                      {inv.quote_id
                        ? <span className="rounded bg-purple-50 px-1.5 py-0.5 font-medium text-purple-600">lié</span>
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{formatDate(inv.issue_date)}</td>
                    <td className="px-4 py-3 text-xs">
                      <span className={inv.status === 'overdue' ? 'font-medium text-red-600' : 'text-gray-500'}>
                        {formatDate(inv.due_date)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700">{formatCents(inv.amount_ht_cents)}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-gray-900">{formatCents(inv.amount_ttc_cents)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getInvoiceStatusColor(inv.status)}`}>
                        {formatBillingStatusLabel(inv.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ChevronRight size={14} className="text-gray-300" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detailId && (
        <DetailPanel
          invoiceId={detailId}
          onClose={() => setDetailId(null)}
          onPaid={handlePaid}
        />
      )}
    </div>
  );
};

export default FacturesPage;