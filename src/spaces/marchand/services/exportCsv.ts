// src/spaces/marchand/services/exportCsv.ts

import type { MarchandSnapshotV1 } from "../shared/marchandSnapshot.store";

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.includes(";") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function snapshotToCsv(snapshot: MarchandSnapshotV1): string {
  const headers = [
    "deal_id",
    "title",
    "status",
    "address",
    "zip_code",
    "city",
    "prix_achat",
    "surface_m2",
    "prix_revente_cible",
  ];

  const rows = snapshot.deals.map((d) => [
    d.id,
    d.title,
    d.status,
    d.address ?? "",
    d.zipCode ?? "",
    d.city ?? "",
    d.prixAchat ?? "",
    d.surfaceM2 ?? "",
    d.prixReventeCible ?? "",
  ]);

  const lines = [
    headers.join(";"),
    ...rows.map((r) => r.map(escapeCsv).join(";")),
  ];

  return lines.join("\n");
}
