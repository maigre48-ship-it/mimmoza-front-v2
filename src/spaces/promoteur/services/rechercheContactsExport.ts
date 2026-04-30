import * as XLSX from 'xlsx';
import type { MairieContactRow } from '../types/rechercheContacts.types';

const PLACEHOLDER = 'Non disponible';

type ExportContext = {
  query: string;
  radiusKm: number;
  centerCommune: string | null;
};

function cellOrPlaceholder(v: string | null | undefined): string {
  return v && v.trim().length > 0 ? v.trim() : PLACEHOLDER;
}

function formatMaireForExport(row: MairieContactRow): string {
  const parts = [row.civiliteMaire, row.prenomMaire, row.nomMaire]
    .map((p) => (p && p.trim().length > 0 ? p.trim() : null))
    .filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(' ') : PLACEHOLDER;
}

function formatDistanceForExport(km: number | null): string {
  if (km === null) return '';
  if (km < 1) return '< 1 km';
  return km.toFixed(1).replace(/\.0$/, '') + ' km';
}

function buildFilename(ctx: ExportContext): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');

  const slug = ctx.query
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'export';

  const radiusPart = ctx.radiusKm > 0 ? `-${ctx.radiusKm}km` : '';

  return `mimmoza-contacts-mairies-${slug}${radiusPart}-${yyyy}${mm}${dd}-${hh}${mi}.xlsx`;
}

/**
 * Exporte les résultats de recherche au format Excel (.xlsx).
 *
 * - Colonne distance affichée uniquement si au moins une ligne la possède.
 * - Cellules vides affichées "Non disponible" pour cohérence avec l'UI.
 * - Largeurs de colonnes pré-dimensionnées pour un rendu direct.
 * - Ligne d'en-tête mise en gras.
 */
export function exportMairieContactsToXlsx(
  rows: MairieContactRow[],
  ctx: ExportContext,
): void {
  if (!Array.isArray(rows) || rows.length === 0) return;

  const hasDistance = rows.some(
    (r) => typeof r.distanceKm === 'number' && r.distanceKm !== null,
  );

  // 1) En-têtes
  const headers: string[] = [
    'Commune',
    'Code postal',
    'Code INSEE',
  ];
  if (hasDistance) headers.push('Distance');
  headers.push(
    'Civilité',
    'Prénom du maire',
    'Nom du maire',
    'Maire (formaté)',
    'Email mairie',
    'Téléphone',
    'Adresse',
    'Source',
  );

  // 2) Lignes
  const dataRows: Array<Array<string>> = rows.map((row) => {
    const line: string[] = [
      row.commune,
      cellOrPlaceholder(row.codePostal),
      cellOrPlaceholder(row.codeInsee),
    ];
    if (hasDistance) line.push(formatDistanceForExport(row.distanceKm));
    line.push(
      cellOrPlaceholder(row.civiliteMaire),
      cellOrPlaceholder(row.prenomMaire),
      cellOrPlaceholder(row.nomMaire),
      formatMaireForExport(row),
      cellOrPlaceholder(row.emailMairie),
      cellOrPlaceholder(row.telephoneMairie),
      cellOrPlaceholder(row.adresseMairie),
      cellOrPlaceholder(row.source),
    );
    return line;
  });

  // 3) Construction de la feuille
  const aoa: Array<Array<string>> = [headers, ...dataRows];
  const worksheet = XLSX.utils.aoa_to_sheet(aoa);

  // 4) Largeurs de colonnes (approximatives en caractères)
  const widthsBase = [
    { wch: 30 }, // Commune
    { wch: 12 }, // Code postal
    { wch: 11 }, // Code INSEE
  ];
  const widthsMid: Array<{ wch: number }> = [];
  if (hasDistance) widthsMid.push({ wch: 10 }); // Distance
  const widthsRest = [
    { wch: 10 }, // Civilité
    { wch: 18 }, // Prénom
    { wch: 22 }, // Nom
    { wch: 35 }, // Maire formaté
    { wch: 35 }, // Email
    { wch: 16 }, // Téléphone
    { wch: 50 }, // Adresse
    { wch: 30 }, // Source
  ];
  worksheet['!cols'] = [...widthsBase, ...widthsMid, ...widthsRest];

  // 5) Liens hypertextes pour email et téléphone
  const emailColIdx = hasDistance ? 8 : 7;
  const phoneColIdx = emailColIdx + 1;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const excelRow = r + 2; // ligne 1 = en-têtes

    if (row.emailMairie) {
      const addr = XLSX.utils.encode_cell({ c: emailColIdx, r: excelRow - 1 });
      const cell = worksheet[addr];
      if (cell) {
        cell.l = { Target: 'mailto:' + row.emailMairie, Tooltip: 'Envoyer un email' };
      }
    }
    if (row.telephoneMairie) {
      const addr = XLSX.utils.encode_cell({ c: phoneColIdx, r: excelRow - 1 });
      const cell = worksheet[addr];
      if (cell) {
        const tel = row.telephoneMairie.replace(/\s+/g, '');
        cell.l = { Target: 'tel:' + tel, Tooltip: 'Appeler' };
      }
    }
  }

  // 6) Gel de la première ligne et filtres auto
  worksheet['!freeze'] = { xSplit: 0, ySplit: 1 };
  const lastColLetter = XLSX.utils.encode_col(headers.length - 1);
  worksheet['!autofilter'] = { ref: `A1:${lastColLetter}${rows.length + 1}` };

  // 7) Style des en-têtes (gras). Note : le style dépend du support côté moteur XLSX.
  //    SheetJS (xlsx community) applique ces props si supportées par le client.
  for (let c = 0; c < headers.length; c++) {
    const addr = XLSX.utils.encode_cell({ c, r: 0 });
    const cell = worksheet[addr];
    if (cell) {
      cell.s = {
        font: { bold: true },
        fill: { fgColor: { rgb: 'F1F5F9' } },
        alignment: { vertical: 'center' },
      };
    }
  }

  // 8) Feuille méta
  const metaRows: Array<Array<string>> = [
    ['Mimmoza — Export contacts mairies'],
    [],
    ['Date export', new Date().toLocaleString('fr-FR')],
    ['Requête', ctx.query],
    [
      'Rayon',
      ctx.radiusKm > 0 ? `${ctx.radiusKm} km` : 'Sans rayon',
    ],
    [
      'Centre de recherche',
      ctx.centerCommune ?? (ctx.radiusKm > 0 ? 'Non déterminé' : 'Sans objet'),
    ],
    ['Nombre de mairies', String(rows.length)],
  ];
  const metaSheet = XLSX.utils.aoa_to_sheet(metaRows);
  metaSheet['!cols'] = [{ wch: 22 }, { wch: 40 }];

  // 9) Assemblage du classeur
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Contacts mairies');
  XLSX.utils.book_append_sheet(workbook, metaSheet, 'Paramètres');

  // 10) Téléchargement
  const filename = buildFilename(ctx);
  XLSX.writeFile(workbook, filename);
}