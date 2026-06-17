// src/spaces/investisseur/pages/deal-center/exports/exportZip.ts
//
// Export ZIP — agrège tous les PDFs + Excel disponibles
// Utilise JSZip + file-saver pour générer l'archive côté client

import { saveAs } from "file-saver";
import { jsPDF } from "jspdf";
import JSZip from "jszip";

import {
  ensureActiveDeal,
  readMarchandSnapshot,
} from "../../../../marchand/shared/marchandSnapshot.store";

// On importe les générateurs PDF mais on récupère les bytes sans save()
// Chaque fonction accepte un paramètre optionnel `returnBytes: true`
// pour retourner le Uint8Array au lieu de déclencher le téléchargement.
// → On fait ça via des wrappers internes ci-dessous.


import * as XLSX from "xlsx";
import type { RentabiliteSnapshot } from "../../../../marchand/types/rentabilite.types";

// ─── Helpers — génère les PDFs en bytes (pas de save) ────────────────────────

/**
 * Pattern : on reconstruit un mini-doc jsPDF identique aux exports individuels
 * mais on retourne doc.output("arraybuffer") au lieu de doc.save().
 * Pour éviter la duplication massive, on importe les builders des autres modules
 * via dynamic import et on exploite le fait que jsPDF peut sortir en mémoire.
 *
 * Alternative plus légère : on réimporte les modules et on monkey-patche jsPDF.save()
 * → on utilise la méthode propre : chaque module exporte aussi une variante `*Bytes`.
 * Ici on contourne en faisant dynamic import + override de la méthode save sur l'instance.
 */

async function getPdfBytes(exportFn: () => Promise<void>): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    // Override temporaire de jsPDF.prototype.save
    const originalSave = jsPDF.prototype.save;
    jsPDF.prototype.save = function (filename?: string) {
      const bytes = this.output("arraybuffer");
      jsPDF.prototype.save = originalSave; // restore immédiatement
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

// ─── Export ZIP principal ─────────────────────────────────────────────────────

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

  // Liste des exports à inclure selon disponibilité des données
  interface ZipEntry {
    label:    string;
    filename: string;
    fn:       () => Promise<Uint8Array>;
    active:   boolean;
  }

  const entries: ZipEntry[] = [
    {
      label:    "Synthèse Qualification",
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
      label:    "Rapport Comité",
      filename: `RapportComite_${safeName}_${dateStr}.pdf`,
      fn:       () => getPdfBytes(exportCommitteeReviewPdf),
      active:   hasRenta || hasMarche,
    },
    {
      label:    "Modèle Financier (PDF)",
      filename: `ModeleFinancier_${safeName}_${dateStr}.pdf`,
      fn:       () => getPdfBytes(exportFinancialEnginePdf),
      active:   hasRenta,
    },
    {
      label:    "Modèle Financier (Excel)",
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
      console.error(`[exportZip] Échec : ${entry.label}`, err);
    }
    done++;
  }

  // README.txt dans le ZIP
  const readme = [
    `MIMMOZA — Export Deal`,
    `Deal     : ${dealName}`,
    `Adresse  : ${deal?.address ?? "—"}`,
    `Date     : ${new Date().toLocaleDateString("fr-FR")}`,
    ``,
    `Contenu de cette archive :`,
    ...active.map((e) => `  · ${e.filename}`),
    ``,
    `Ces documents sont générés à titre indicatif.`,
    `Ils ne constituent pas un conseil en investissement.`,
    `© Mimmoza ${new Date().getFullYear()}`,
  ].join("\n");
  folder.file("README.txt", readme);

  onProgress?.("Compression…", 95);

  try {
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
    saveAs(blob, `Mimmoza_${safeName}_${dateStr}.zip`);
    onProgress?.("Terminé", 100);
  } catch (err) {
    errors.push("Génération ZIP");
    console.error("[exportZip] Erreur génération ZIP", err);
  }

  return {
    ok:     errors.length === 0,
    count:  active.length - errors.length,
    errors,
  };
}