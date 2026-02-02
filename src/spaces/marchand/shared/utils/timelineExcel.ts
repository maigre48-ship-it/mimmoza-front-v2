/**
 * Timeline Excel Import/Export Utilities
 * 
 * Requires: xlsx (SheetJS)
 * Install: npm install xlsx
 * 
 * If xlsx is not available, falls back to CSV export.
 */

import type { TimelinePhase, PhaseCategory } from "../ui/TimelinePlanner";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ExportOptions = {
  context?: string;        // Added to filename: planning_YYYYMMDD_<context>.xlsx
  sheetName?: string;      // Default: "Planning"
  includeNotes?: boolean;  // Default: true
};

type ExcelRow = {
  id: string;
  name: string;
  category: string;
  startDay: number;
  durationDays: number;
  notes?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const VALID_CATEGORIES: PhaseCategory[] = [
  "etude",
  "admin",
  "financement",
  "travaux",
  "commercialisation",
  "vente",
];

const CATEGORY_ALIASES: Record<string, PhaseCategory> = {
  // French aliases
  "étude": "etude",
  "etude": "etude",
  "study": "etude",
  "admin": "admin",
  "administration": "admin",
  "financement": "financement",
  "financing": "financement",
  "finance": "financement",
  "travaux": "travaux",
  "works": "travaux",
  "work": "travaux",
  "construction": "travaux",
  "commercialisation": "commercialisation",
  "marketing": "commercialisation",
  "commercial": "commercialisation",
  "vente": "vente",
  "sale": "vente",
  "sales": "vente",
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const formatDate = (): string => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
};

const mkPhaseId = () => `P-${Math.random().toString(16).slice(2, 10)}`;

const normalizeCategory = (raw: string): PhaseCategory | null => {
  const lower = raw.toLowerCase().trim();
  if (VALID_CATEGORIES.includes(lower as PhaseCategory)) {
    return lower as PhaseCategory;
  }
  return CATEGORY_ALIASES[lower] || null;
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// ─────────────────────────────────────────────────────────────────────────────
// CSV Fallback (if xlsx not available)
// ─────────────────────────────────────────────────────────────────────────────

const escapeCSV = (val: string | number | undefined): string => {
  if (val === undefined || val === null) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

const exportToCSV = (phases: TimelinePhase[], options: ExportOptions = {}): void => {
  const { context, includeNotes = true } = options;

  const headers = includeNotes
    ? ["id", "name", "category", "startDay", "durationDays", "notes"]
    : ["id", "name", "category", "startDay", "durationDays"];

  const rows = phases.map((p) => {
    const base = [p.id, p.name, p.category, p.startDay, p.durationDays];
    if (includeNotes) base.push(p.notes || "");
    return base.map(escapeCSV).join(",");
  });

  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });

  const filename = context
    ? `planning_${formatDate()}_${context}.csv`
    : `planning_${formatDate()}.csv`;

  downloadBlob(blob, filename);
};

const parseCSV = (text: string): ExcelRow[] => {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headerLine = lines[0].toLowerCase();
  const headers = headerLine.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));

  const idxId = headers.indexOf("id");
  const idxName = headers.indexOf("name");
  const idxCategory = headers.indexOf("category");
  const idxStart = headers.indexOf("startday");
  const idxDuration = headers.indexOf("durationdays");
  const idxNotes = headers.indexOf("notes");

  const rows: ExcelRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    // Simple CSV parsing (doesn't handle all edge cases)
    const values = lines[i].split(",").map((v) => v.trim().replace(/^"|"$/g, ""));

    const row: ExcelRow = {
      id: values[idxId] || mkPhaseId(),
      name: values[idxName] || "Sans nom",
      category: values[idxCategory] || "admin",
      startDay: parseInt(values[idxStart], 10) || 1,
      durationDays: parseInt(values[idxDuration], 10) || 1,
      notes: idxNotes >= 0 ? values[idxNotes] : undefined,
    };

    rows.push(row);
  }

  return rows;
};

// ─────────────────────────────────────────────────────────────────────────────
// XLSX Export
// ─────────────────────────────────────────────────────────────────────────────

export const exportTimelineToXlsx = async (
  phases: TimelinePhase[],
  options: ExportOptions = {}
): Promise<void> => {
  const { context, sheetName = "Planning", includeNotes = true } = options;

  try {
    // Dynamic import of xlsx
    const XLSX = await import("xlsx");

    // Prepare data
    const data: ExcelRow[] = phases.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      startDay: p.startDay,
      durationDays: p.durationDays,
      ...(includeNotes ? { notes: p.notes || "" } : {}),
    }));

    // Create workbook
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);

    // Set column widths
    ws["!cols"] = [
      { wch: 12 },  // id
      { wch: 30 },  // name
      { wch: 18 },  // category
      { wch: 10 },  // startDay
      { wch: 12 },  // durationDays
      { wch: 30 },  // notes
    ];

    // Generate filename
    const filename = context
      ? `planning_${formatDate()}_${context}.xlsx`
      : `planning_${formatDate()}.xlsx`;

    // Write and download
    XLSX.writeFile(wb, filename);

  } catch (err) {
    console.warn("xlsx not available, falling back to CSV export:", err);
    exportToCSV(phases, options);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// XLSX Import
// ─────────────────────────────────────────────────────────────────────────────

export const importTimelineFromXlsx = async (
  file: File
): Promise<TimelinePhase[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const data = e.target?.result;
        if (!data) {
          reject(new Error("Failed to read file"));
          return;
        }

        let rows: ExcelRow[] = [];

        // Check file type
        const isCSV = file.name.toLowerCase().endsWith(".csv");

        if (isCSV) {
          // Parse as CSV
          const text = typeof data === "string" ? data : new TextDecoder().decode(data as ArrayBuffer);
          rows = parseCSV(text);
        } else {
          // Try xlsx
          try {
            const XLSX = await import("xlsx");
            const workbook = XLSX.read(data, { type: "array" });

            // Find sheet (prefer "Planning", else first)
            let sheetName = workbook.SheetNames.find(
              (n) => n.toLowerCase() === "planning"
            );
            if (!sheetName) sheetName = workbook.SheetNames[0];

            const sheet = workbook.Sheets[sheetName];
            rows = XLSX.utils.sheet_to_json<ExcelRow>(sheet);
          } catch (xlsxErr) {
            // Fallback: try parsing as CSV
            const text = typeof data === "string" ? data : new TextDecoder().decode(data as ArrayBuffer);
            rows = parseCSV(text);
          }
        }

        // Validate and transform rows to TimelinePhase
        const phases: TimelinePhase[] = [];

        for (const row of rows) {
          // Normalize category
          const category = normalizeCategory(String(row.category || "admin"));
          if (!category) continue; // Skip invalid category

          // Validate numbers
          const startDay = Math.max(1, parseInt(String(row.startDay), 10) || 1);
          const durationDays = Math.max(1, parseInt(String(row.durationDays), 10) || 1);

          // Name is required
          const name = String(row.name || "").trim();
          if (!name) continue;

          phases.push({
            id: row.id ? String(row.id) : mkPhaseId(),
            name,
            category,
            startDay,
            durationDays,
            notes: row.notes ? String(row.notes) : undefined,
          });
        }

        resolve(phases);
      } catch (err) {
        reject(err);
      }
    };

    reader.onerror = () => reject(reader.error);

    // Read as ArrayBuffer for xlsx, or text for CSV
    if (file.name.toLowerCase().endsWith(".csv")) {
      reader.readAsText(file);
    } else {
      reader.readAsArrayBuffer(file);
    }
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Template Generator (utility for creating blank templates)
// ─────────────────────────────────────────────────────────────────────────────

export const exportTemplateXlsx = async (): Promise<void> => {
  const templatePhases: TimelinePhase[] = [
    { id: "P-exemple1", name: "Étude & chiffrage", category: "etude", startDay: 1, durationDays: 5, notes: "Exemple" },
    { id: "P-exemple2", name: "Travaux", category: "travaux", startDay: 6, durationDays: 20 },
    { id: "P-exemple3", name: "Commercialisation", category: "commercialisation", startDay: 15, durationDays: 15 },
  ];

  await exportTimelineToXlsx(templatePhases, { context: "template" });
};