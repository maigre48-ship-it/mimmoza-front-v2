// src/spaces/investisseur/pages/deal-center/exports/exportZip.ts
//
// Export ZIP â€” agrÃ¨ge tous les PDFs + Excel disponibles
// Utilise JSZip + file-saver pour gÃ©nÃ©rer l'archive cÃ´tÃ© client

import { saveAs } from "file-saver";
import { jsPDF } from "jspdf";
import JSZip from "jszip";

import {
  ensureActiveDeal,
  readMarchandSnapshot,
} from "../../../../marchand/shared/marchandSnapshot.store";

// On importe les gÃ©nÃ©rateurs PDF mais on rÃ©cupÃ¨re les bytes sans save()
// Chaque fonction accepte un paramÃ¨tre optionnel `returnBytes: true`
// pour retourner le Uint8Array au lieu de dÃ©clencher le tÃ©lÃ©chargement.
// â†’ On fait Ã§a via des wrappers internes ci-dessous.


import * as XLSX from "xlsx";
import type { RentabiliteSnapshot } from "../../../types/rentabilite.types";

// â”€â”€â”€ Helpers â€” gÃ©nÃ¨re les PDFs en bytes (pas de save) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Pattern : on reconstruit un mini-doc jsPDF identique aux exports individuels
 * mais on retourne doc.output("arraybuffer") au lieu de doc.save().
 * Pour Ã©viter la duplication massive, on importe les builders des autres modules
 * via dynamic import et on exploite le fait que jsPDF peut sortir en mÃ©moire.
 *
 * Alternative plus lÃ©gÃ¨re : on rÃ©importe les modules et on monkey-patche jsPDF.save()
 * â†’ on utilise la mÃ©thode propre : chaque module exporte aussi une variante `*Bytes`.
 * Ici on contourne en faisant dynamic import + override de la mÃ©thode save sur l'instance.
 */

async function getPdfBytes(exportFn: () => Promise<void>): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    // Override temporaire de jsPDF.prototype.save
    const originalSave = jsPDF.prototype.save;
    jsPDF.prototype.save = function (filename?: string) {
      const bytes = this.output("arraybuffer");
      jsPDF.prototype.save = originalSave; // restore immÃ©diatement
      resolve(new Uint8Array(bytes as ArrayBuffer));
    } as any;

    exportFn().catch((err) => {
      jsPDF.prototype.save = originalSave;
      reject(err);
    });
  });
}

async function getExcelBytes(exportFn: () => Promise<void>): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    // Override de XLSX.writeFile pour intercepter les bytes
    const original = XLSX.writeFile;
    (XLSX as any).writeFile = function (wb: XLSX.WorkBook, filename: string, opts?: any) {
      const buf = XLSX.write(wb, { type: "array", bookType: "xlsx", ...opts });
      (XLSX as any).writeFile = original;
      resolve(new Uint8Array(buf));
    };

    exportFn().catch((err) => {
      (XLSX as any).writeFile = original;
      reject(err);
    });
  });
}

// â”€â”€â”€ Export ZIP principal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface ZipExportResult {
  ok:     boolean;
  count:  number;
  errors: string[];
}

export async function exportZip(
  onProgress?: (label: string, pct: number) => void,
): Promise<ZipExportResult> {
  const snap     = readMarchandSnapshot();
  const deal     = ensureActiveDeal();
  const id       = deal?.id ?? null;
  const renta    = (id ? snap.rentabiliteByDeal[id]?.computed : undefined) as RentabiliteSnapshot | undefined;
  const marche   = (id ? snap.marcheRisquesByDeal[id]?.data : undefined) as any;
  const dealName = deal?.nom ?? deal?.address ?? "Deal";
  const safeName = dealName.replace(/[^a-zA-Z0-9_\-]/g, "_");
  const dateStr  = new Date().toISOString().slice(0, 10);

  const hasBaseDeal = !!(deal?.prixAchat || deal?.address);
  const hasRenta    = !!(renta as any)?.scenarios?.base;
  const hasMarche   = !!marche;

  // Imports dynamiques des fonctions export
  const [
    { exportQualificationPdf },
    { exportDataConfidencePdf },
    { exportInvestmentPackPdf },
    { exportCommitteeReviewPdf },
    { exportFinancialEnginePdf, exportFinancialEngineExcel },
  ] = await Promise.all([
    import("./exportQualification"),
    import("./exportDataConfidence"),
    import("./exportInvestmentPack"),
    import("./exportCommitteeReview"),
    import("./exportFinancialEngine"),
  ]);

  // Liste des exports Ã  inclure selon disponibilitÃ© des donnÃ©es
  interface ZipEntry {
    label:    string;
    filename: string;
    fn:       () => Promise<Uint8Array>;
    active:   boolean;
  }

  const entries: ZipEntry[] = [
    {
      label:    "SynthÃ¨se Qualification",
      filename: `Qualification_${safeName}_${dateStr}.pdf`,
      fn:       () => getPdfBytes(exportQualificationPdf),
      active:   hasBaseDeal,
    },
    {
      label:    "Rapport Data Confidence",
      filename: `DataConfidence_${safeName}_${dateStr}.pdf`,
      fn:       () => getPdfBytes(exportDataConfidencePdf),
      active:   hasMarche || hasRenta,
    },
    {
      label:    "Investment Pack",
      filename: `InvestmentPack_${safeName}_${dateStr}.pdf`,
      fn:       () => getPdfBytes(exportInvestmentPackPdf),
      active:   hasBaseDeal,
    },
    {
      label:    "Rapport ComitÃ©",
      filename: `RapportComite_${safeName}_${dateStr}.pdf`,
      fn:       () => getPdfBytes(exportCommitteeReviewPdf),
      active:   hasRenta || hasMarche,
    },
    {
      label:    "ModÃ¨le Financier (PDF)",
      filename: `ModeleFinancier_${safeName}_${dateStr}.pdf`,
      fn:       () => getPdfBytes(exportFinancialEnginePdf),
      active:   hasRenta,
    },
    {
      label:    "ModÃ¨le Financier (Excel)",
      filename: `ModeleFinancier_${safeName}_${dateStr}.xlsx`,
      fn:       () => getExcelBytes(exportFinancialEngineExcel),
      active:   hasRenta,
    },
  ];

  const active = entries.filter((e) => e.active);
  const zip    = new JSZip();
  const errors: string[] = [];
  let done = 0;

  // Dossier principal dans le ZIP
  const folder = zip.folder(`Mimmoza_${safeName}_${dateStr}`)!;

  for (const entry of active) {
    onProgress?.(entry.label, Math.round((done / active.length) * 90));
    try {
      const bytes = await entry.fn();
      folder.file(entry.filename, bytes);
    } catch (err) {
      errors.push(entry.label);
      console.error(`[exportZip] Ã‰chec : ${entry.label}`, err);
    }
    done++;
  }

  // README.txt dans le ZIP
  const readme = [
    `MIMMOZA â€” Export Deal`,
    `Deal     : ${dealName}`,
    `Adresse  : ${deal?.address ?? "â€”"}`,
    `Date     : ${new Date().toLocaleDateString("fr-FR")}`,
    ``,
    `Contenu de cette archive :`,
    ...active.map((e) => `  Â· ${e.filename}`),
    ``,
    `Ces documents sont gÃ©nÃ©rÃ©s Ã  titre indicatif.`,
    `Ils ne constituent pas un conseil en investissement.`,
    `Â© Mimmoza ${new Date().getFullYear()}`,
  ].join("\n");
  folder.file("README.txt", readme);

  onProgress?.("Compressionâ€¦", 95);

  try {
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
    saveAs(blob, `Mimmoza_${safeName}_${dateStr}.zip`);
    onProgress?.("TerminÃ©", 100);
  } catch (err) {
    errors.push("GÃ©nÃ©ration ZIP");
    console.error("[exportZip] Erreur gÃ©nÃ©ration ZIP", err);
  }

  return {
    ok:     errors.length === 0,
    count:  active.length - errors.length,
    errors,
  };
}
