// src/spaces/marchand/services/exportPdf.ts

import type { MarchandSnapshotV1 } from "../shared/marchandSnapshot.store";

export function exportSnapshotToPdf(snapshot: MarchandSnapshotV1) {
  const activeDeal = snapshot.deals.find(
    (d) => d.id === snapshot.activeDealId
  );

  const html = `
    <html>
      <head>
        <title>Dossier Marchand</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 32px; }
          h1 { margin-bottom: 8px; }
          h2 { margin-top: 24px; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; }
          td, th { border: 1px solid #ccc; padding: 6px 8px; font-size: 12px; }
        </style>
      </head>
      <body>
        <h1>Dossier Marchand</h1>
        <p>Date : ${new Date().toLocaleDateString("fr-FR")}</p>

        ${
          activeDeal
            ? `
          <h2>Deal actif</h2>
          <table>
            <tr><th>ID</th><td>${activeDeal.id}</td></tr>
            <tr><th>Titre</th><td>${activeDeal.title}</td></tr>
            <tr><th>Statut</th><td>${activeDeal.status}</td></tr>
            <tr><th>Ville</th><td>${activeDeal.city ?? ""}</td></tr>
            <tr><th>Prix achat</th><td>${activeDeal.prixAchat ?? ""}</td></tr>
          </table>
        `
            : "<p>Aucun deal actif</p>"
        }
      </body>
    </html>
  `;

  const win = window.open("", "_blank");
  if (!win) return;

  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}
