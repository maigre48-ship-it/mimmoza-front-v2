// src/spaces/copilot/agent/rapport/exporterRapport.ts
// Exports du rapport de mission, générés DANS LE NAVIGATEUR (aucun appel
// serveur) : PDF, Word, Excel (rapport + bilan), Bilan promoteur seul.
// Les bibliothèques lourdes (jspdf, docx, exceljs) ne sont chargées qu'au clic.
import logoMimmozaUrl from '@/assets/logo-mimmoza-baseline.png';
import { loadImageDataUrl } from '@/spaces/shared/loadImageDataUrl';
import { nomFichierRapport, type ModeleRapport } from './rapportModele';

export type FormatExport = 'pdf' | 'docx' | 'xlsx' | 'bilan';

const TYPE_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function telecharger(blob: Blob, nom: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nom;
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function exporterRapport(format: FormatExport, m: ModeleRapport): Promise<void> {
  if (format === 'pdf') {
    const { construirePdfRapport } = await import('./rapportPdf');
    let logo: { dataUrl: string; aspect: number } | null = null;
    try { logo = await loadImageDataUrl(logoMimmozaUrl); } catch { /* nom écrit en toutes lettres */ }
    telecharger(construirePdfRapport(m, { logo }).output('blob'), nomFichierRapport(m, 'pdf'));
    return;
  }
  if (format === 'docx') {
    const [{ construireWordRapport }, { Packer }] = await Promise.all([import('./rapportWord'), import('docx')]);
    telecharger(await Packer.toBlob(construireWordRapport(m)), nomFichierRapport(m, 'docx'));
    return;
  }
  if (format === 'xlsx') {
    const { construireClasseurRapport } = await import('./rapportExcel');
    const buffer = await construireClasseurRapport(m).xlsx.writeBuffer();
    telecharger(new Blob([new Uint8Array(buffer as ArrayBuffer)], { type: TYPE_XLSX }), nomFichierRapport(m, 'xlsx'));
    return;
  }
  const { construireClasseurBilan } = await import('./bilanExcel');
  const buffer = await construireClasseurBilan(m).xlsx.writeBuffer();
  telecharger(new Blob([new Uint8Array(buffer as ArrayBuffer)], { type: TYPE_XLSX }), nomFichierRapport(m, 'xlsx', true));
}
