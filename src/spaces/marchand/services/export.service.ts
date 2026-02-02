// src/spaces/marchand/services/export.service.ts

import { readMarchandSnapshot } from "../shared/marchandSnapshot.store";
import { snapshotToCsv } from "./exportCsv";
import { exportSnapshotToPdf } from "./exportPdf";

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

export function exportMarchandPdf() {
  const snapshot = readMarchandSnapshot();
  exportSnapshotToPdf(snapshot);
}
