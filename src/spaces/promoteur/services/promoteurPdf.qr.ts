// src/spaces/promoteur/services/promoteurPdf.qr.ts
import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';

const VERIFY_BASE_URL = 'https://www.mimmoza.fr/verify';

export function getVerificationUrl(documentId: string): string {
  return `${VERIFY_BASE_URL}/${documentId}`;
}

export async function drawQr(
  doc: jsPDF,
  x: number,
  y: number,
  size: number,
  documentId: string,
): Promise<void> {
  const content = `Mimmoza — Ref. ${documentId}`;

  try {
    const dataUrl = await QRCode.toDataURL(content, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 512,
      color: { dark: '#2e1065', light: '#ffffff' },
    });
    doc.addImage(dataUrl, 'PNG', x, y, size, size);
  } catch (err) {
    console.error('[QR] Génération échouée :', err);
    doc.setFillColor(46, 16, 101);
    doc.rect(x, y, size, size, 'F');
  }
}

export function drawDocRef(
  doc: jsPDF,
  x: number,
  y: number,
  documentId: string,
  align: 'left' | 'center' | 'right' = 'center',
): void {
  doc.setFontSize(5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(150, 150, 170);
  doc.text(documentId, x, y, { align });
}