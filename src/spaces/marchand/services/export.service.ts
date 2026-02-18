// src/spaces/marchand/services/export.service.ts

import { readMarchandSnapshot } from "../shared/marchandSnapshot.store";
import type { MarchandSnapshotV1 } from "../shared/marchandSnapshot.store";
import { snapshotToCsv } from "./exportCsv";
import { exportSnapshotToPdf } from "./exportPdf";
import { generateExportAiReport } from "./exportAiReport.service";
import type { ExportContextV1 } from "../types/exportContext.types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DD_STORE_KEY = "mimmoza.banque.duediligence.v1";

function getDueDiligenceSafe(
  dossierId: string
): { report: any; computed?: any } | undefined {
  // 1) Lecture via localStorage sur la vraie clé du store DD
  try {
    const raw = localStorage.getItem(DD_STORE_KEY);
    if (raw) {
      const state = JSON.parse(raw) as Record<string, any>;
      const report = state?.[dossierId];
      if (report) {
        return { report, computed: report.computed };
      }
    }
  } catch {
    // silently ignore
  }

  // 2) Fallback legacy éventuel (si tu avais eu une autre clé)
  try {
    const legacyRaw = localStorage.getItem(`dd-report-${dossierId}`);
    if (legacyRaw) {
      const report = JSON.parse(legacyRaw);
      return { report, computed: report?.computed };
    }
  } catch {
    // silently ignore
  }

  return undefined;
}

function buildExportContext(snapshot: MarchandSnapshotV1): ExportContextV1 {
  const dossierId =
    (snapshot as any)?.dossier?.id ??
    (snapshot as any)?.id ??
    "DOSS-TEST-001";

  const dueDiligence = getDueDiligenceSafe(dossierId);

  return {
    version: "v1",
    generatedAt: new Date().toISOString(),
    space: "marchand",
    snapshot,
    dueDiligence,
  };
}

// ---------------------------------------------------------------------------
// CSV (inchangé)
// ---------------------------------------------------------------------------

export function exportMarchandCsv() {
  const snapshot = readMarchandSnapshot();
  const csv = snapshotToCsv(snapshot);

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "marchand-export.csv";
  a.click();

  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// PDF simple (inchangé – rétrocompatibilité)
// ---------------------------------------------------------------------------

export function exportMarchandPdf() {
  const snapshot = readMarchandSnapshot();
  exportSnapshotToPdf(snapshot);
}

// ---------------------------------------------------------------------------
// PDF enrichi avec IA (nouvelle fonction)
// ---------------------------------------------------------------------------

export async function exportSnapshotToPdfWithAi(
  snapshot?: MarchandSnapshotV1
): Promise<void> {
  const snap = snapshot ?? readMarchandSnapshot();
  const context = buildExportContext(snap);

  // Debug utile pour vérifier que DD est bien injecté
  console.log("[export] ExportContext built:", {
    dossierId: (snap as any)?.dossier?.id ?? (snap as any)?.id ?? "DOSS-TEST-001",
    hasDueDiligence: Boolean(context.dueDiligence?.report),
    ddScore: context.dueDiligence?.report?.computed?.score,
  });

  // Appel IA – dégradation gracieuse si échec
  let aiReport: any = undefined;
  try {
    const result = await generateExportAiReport(context);
    if (result.ok) {
      aiReport = result;
    } else {
      console.warn(
        "[export] IA report failed, continuing without AI section:",
        result.error
      );
    }
  } catch (err) {
    console.warn("[export] IA report threw, continuing without AI section:", err);
  }

  // ✅ IMPORTANT: opts passés au PDF
  exportSnapshotToPdf(snap, { aiReport, context });
}
