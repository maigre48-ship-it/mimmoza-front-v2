// src/features/admin/billing/exportBillingPdf.ts

import mimmozaLogo from '@/assets/logo-mimmoza.png';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

import { formatBillingStatusLabel, formatDate } from './helpers';
import type { Invoice, InvoiceLine, Quote, QuoteLine } from './types';

function fmtEur(cents: number): string {
  const euros = cents / 100;
  const [intPart, decPart] = euros.toFixed(2).split('.');
  const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${intFormatted},${decPart} EUR`;
}

function fmtEurShort(cents: number): string {
  const euros = cents / 100;
  const [intPart, decPart] = euros.toFixed(2).split('.');
  const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${intFormatted}.${decPart}`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

const BLUE_DARK: [number, number, number] = [15, 82, 186];
const BLUE_MID: [number, number, number] = [56, 132, 222];

const WHITE: [number, number, number] = [255, 255, 255];
const SLATE_900: [number, number, number] = [15, 23, 42];
const SLATE_700: [number, number, number] = [51, 65, 85];
const SLATE_600: [number, number, number] = [71, 85, 105];
const SLATE_200: [number, number, number] = [226, 232, 240];
const SLATE_50: [number, number, number] = [248, 250, 252];

async function drawGradientHeader(
  doc: jsPDF,
  docType: 'FACTURE' | 'DEVIS',
  number: string
): Promise<void> {
  const w = doc.internal.pageSize.getWidth();

  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, w, 44, 'F');

  try {
    const logo = await loadImage(mimmozaLogo);
    doc.addImage(logo, 'PNG', 14, 8, 44, 17);
  } catch {
    doc.setFontSize(17);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...SLATE_900);
    doc.text('Mimmoza', 14, 18);
  }

  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BLUE_DARK);
  doc.text(docType, w - 14, 19, { align: 'right' });

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...SLATE_700);
  doc.text(number, w - 14, 28, { align: 'right' });

  doc.setTextColor(0, 0, 0);
}

function drawInfoBlocks(
  doc: jsPDF,
  left: { title: string; lines: string[] },
  right: { title: string; lines: string[] },
  y: number
): void {
  const pageW = doc.internal.pageSize.getWidth();
  const blockW = (pageW - 14 - 14 - 6) / 2;

  doc.setFillColor(...SLATE_50);
  doc.setDrawColor(...SLATE_200);
  doc.setLineWidth(0.3);
  doc.roundedRect(14, y, blockW, 38, 3, 3, 'FD');
  doc.setFillColor(...BLUE_MID);
  doc.roundedRect(14, y, 3, 38, 1.5, 1.5, 'F');

  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BLUE_DARK);
  doc.text(left.title.toUpperCase(), 21, y + 9);

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...SLATE_900);
  left.lines.slice(0, 4).forEach((line, i) => {
    doc.text(line, 21, y + 18 + i * 6.5);
  });

  const rx = 14 + blockW + 6;

  doc.setFillColor(...SLATE_50);
  doc.setDrawColor(...SLATE_200);
  doc.roundedRect(rx, y, blockW, 38, 3, 3, 'FD');
  doc.setFillColor(...BLUE_MID);
  doc.roundedRect(rx, y, 3, 38, 1.5, 1.5, 'F');

  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BLUE_DARK);
  doc.text(right.title.toUpperCase(), rx + 7, y + 9);

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...SLATE_900);
  right.lines.slice(0, 4).forEach((line, i) => {
    doc.text(line, rx + 7, y + 18 + i * 6.5);
  });

  doc.setTextColor(0, 0, 0);
}

function drawTotals(
  doc: jsPDF,
  amountHt: number,
  vatRateBps: number,
  vatAmount: number,
  amountTtc: number,
  finalY: number
): void {
  const pageW = doc.internal.pageSize.getWidth();
  const boxW = 82;
  const boxX = pageW - 14 - boxW;
  const y = finalY + 10;
  const rowH = 8;

  doc.setFillColor(...SLATE_50);
  doc.setDrawColor(...SLATE_200);
  doc.setLineWidth(0.3);
  doc.roundedRect(boxX, y, boxW, rowH * 2 + 14, 3, 3, 'FD');

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');

  doc.setTextColor(...SLATE_600);
  doc.text('Total HT', boxX + 5, y + 7);

  doc.setTextColor(...SLATE_900);
  doc.text(fmtEur(amountHt), boxX + boxW - 5, y + 7, { align: 'right' });

  doc.setTextColor(...SLATE_600);
  doc.text(`TVA ${vatRateBps / 100}%`, boxX + 5, y + 7 + rowH);

  doc.setTextColor(...SLATE_900);
  doc.text(fmtEur(vatAmount), boxX + boxW - 5, y + 7 + rowH, { align: 'right' });

  doc.setDrawColor(...SLATE_200);
  doc.line(boxX + 4, y + 7 + rowH + 3, boxX + boxW - 4, y + 7 + rowH + 3);

  const ttcY = y + rowH * 2 + 5;
  const ttcH = 10;
  const steps = 20;

  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const r = Math.round(BLUE_DARK[0] + (BLUE_MID[0] - BLUE_DARK[0]) * t);
    const g = Math.round(BLUE_DARK[1] + (BLUE_MID[1] - BLUE_DARK[1]) * t);
    const b = Math.round(BLUE_DARK[2] + (BLUE_MID[2] - BLUE_DARK[2]) * t);

    doc.setFillColor(r, g, b);
    doc.rect(boxX + (i / steps) * boxW, ttcY, boxW / steps + 0.5, ttcH, 'F');
  }

  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...WHITE);
  doc.text('Total TTC', boxX + 5, ttcY + 6.5);
  doc.text(fmtEur(amountTtc), boxX + boxW - 5, ttcY + 6.5, { align: 'right' });

  doc.setTextColor(0, 0, 0);
}

function drawFooter(doc: jsPDF): void {
  const pageH = doc.internal.pageSize.getHeight();
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFillColor(255, 255, 255);
  doc.rect(0, pageH - 13, pageW, 13, 'F');

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BLUE_DARK);
  doc.text('Mimmoza', 14, pageH - 4.5);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...SLATE_600);
  doc.text('Document genere automatiquement', pageW - 14, pageH - 4.5, {
    align: 'right',
  });

  doc.setTextColor(0);
}

export async function exportInvoicePdf(
  invoice: Invoice,
  lines: InvoiceLine[]
): Promise<void> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  await drawGradientHeader(doc, 'FACTURE', invoice.invoice_number);

  drawInfoBlocks(
    doc,
    {
      title: 'Facture a',
      lines: [
        invoice.company_name,
        invoice.contact_name ?? '',
        invoice.contact_email ?? '',
      ].filter(Boolean),
    },
    {
      title: 'Details',
      lines: [
        `Emission : ${formatDate(invoice.issue_date)}`,
        `Echeance : ${formatDate(invoice.due_date)}`,
        `Statut : ${formatBillingStatusLabel(invoice.status)}`,
        invoice.paid_at ? `Payee le : ${formatDate(invoice.paid_at)}` : '',
      ].filter(Boolean),
    },
    52
  );

  autoTable(doc, {
    startY: 98,
    head: [['Prestation', 'Description', 'Qte', 'PU HT', 'Total HT']],
    body: lines.map((l) => [
      l.label,
      l.description ?? '-',
      String(l.quantity),
      fmtEurShort(l.unit_price_ht_cents),
      fmtEurShort(l.total_ht_cents),
    ]),
    headStyles: {
      fillColor: BLUE_DARK,
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 8,
    },
    bodyStyles: {
      fontSize: 8.5,
      textColor: SLATE_900,
    },
    alternateRowStyles: {
      fillColor: SLATE_50,
    },
    columnStyles: {
      0: { cellWidth: 48, fontStyle: 'bold' },
      1: { cellWidth: 52 },
      2: { cellWidth: 14, halign: 'center' },
      3: { cellWidth: 32, halign: 'right' },
      4: { cellWidth: 32, halign: 'right', fontStyle: 'bold' },
    },
    margin: { left: 14, right: 14 },
    tableLineColor: SLATE_200,
    tableLineWidth: 0.2,
  });

  const finalY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  drawTotals(
    doc,
    invoice.amount_ht_cents,
    invoice.vat_rate_bps,
    invoice.vat_amount_cents,
    invoice.amount_ttc_cents,
    finalY
  );

  if (invoice.notes) {
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(...SLATE_600);
    doc.text(`Note : ${invoice.notes}`, 14, finalY + 54);
    doc.setTextColor(0);
  }

  drawFooter(doc);
  doc.save(`${invoice.invoice_number}.pdf`);
}

export async function exportQuotePdf(
  quote: Quote,
  lines: QuoteLine[]
): Promise<void> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  await drawGradientHeader(doc, 'DEVIS', quote.quote_number);

  drawInfoBlocks(
    doc,
    {
      title: 'Destinataire',
      lines: [
        quote.company_name,
        quote.contact_name ?? '',
        quote.contact_email ?? '',
      ].filter(Boolean),
    },
    {
      title: 'Details',
      lines: [
        `Date : ${formatDate(quote.created_at)}`,
        `Espace : ${quote.target_space}`,
        `Statut : ${formatBillingStatusLabel(quote.status)}`,
        quote.accepted_at ? `Accepte le : ${formatDate(quote.accepted_at)}` : '',
      ].filter(Boolean),
    },
    52
  );

  autoTable(doc, {
    startY: 98,
    head: [['Prestation', 'Description', 'Qte', 'PU HT', 'Total HT']],
    body: lines.map((l) => [
      l.label,
      l.description ?? '-',
      String(l.quantity),
      fmtEurShort(l.unit_price_ht_cents),
      fmtEurShort(l.total_ht_cents),
    ]),
    headStyles: {
      fillColor: BLUE_DARK,
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 8,
    },
    bodyStyles: {
      fontSize: 8.5,
      textColor: SLATE_900,
    },
    alternateRowStyles: {
      fillColor: SLATE_50,
    },
    columnStyles: {
      0: { cellWidth: 48, fontStyle: 'bold' },
      1: { cellWidth: 52 },
      2: { cellWidth: 14, halign: 'center' },
      3: { cellWidth: 32, halign: 'right' },
      4: { cellWidth: 32, halign: 'right', fontStyle: 'bold' },
    },
    margin: { left: 14, right: 14 },
    tableLineColor: SLATE_200,
    tableLineWidth: 0.2,
  });

  const finalY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  drawTotals(
    doc,
    quote.amount_ht_cents,
    quote.vat_rate_bps,
    quote.vat_amount_cents,
    quote.amount_ttc_cents,
    finalY
  );

  if (quote.notes) {
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(...SLATE_600);
    doc.text(`Note : ${quote.notes}`, 14, finalY + 54);
    doc.setTextColor(0);
  }

  drawFooter(doc);
  doc.save(`${quote.quote_number}.pdf`);
}