// src/spaces/admin/pages/agentCommercial/ProspectsImportPage.tsx
// Import CSV de prospects : upload → mapping des colonnes → rapport.
// Rejette toute adresse/domaine présent dans la liste d'exclusion, signale les
// doublons (déduplication douce sur lower(email)) sans les écraser.

import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { parse } from "csv-parse/browser/esm/sync";
import { AlertTriangle, ArrowLeft, Ban, CheckCircle2, Copy, FileText, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/Input";
import { useToast } from "@/components/ui/toastContext";
import type { ProspectFormValues } from "@/spaces/admin/types/agentCommercial.types";
import {
  getExistingEmailSet,
  insertImportedProspects,
} from "@/spaces/admin/services/agentCommercial/prospects.service";
import {
  exclusionReasonLabel,
  loadExclusionIndex,
  matchExclusion,
  normalizeEmail,
} from "@/spaces/admin/services/agentCommercial/exclusionCheck";
import { logActivity } from "@/spaces/admin/services/agentCommercial/activityLog.service";
import { autoMap, IMPORT_FIELDS, type ColumnMapping, type ImportFieldKey } from "./csvMapping";
import { emptyProspectForm } from "./prospectFormat";

const PROSPECTS_ROUTE = "/admin/agent-commercial/prospects";

type Step = "upload" | "mapping" | "report";

interface ReportRow {
  line: number;
  company: string;
  email: string;
  reason?: string;
}
interface ImportReport {
  total: number;
  inserted: number;
  duplicates: ReportRow[];
  excluded: ReportRow[];
  errors: ReportRow[];
}

export function AgentCommercialProspectsImportPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>(() => autoMap([]));
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);

  const headerIndex = useMemo(() => {
    const m = new Map<string, number>();
    headers.forEach((h, i) => {
      if (!m.has(h)) m.set(h, i);
    });
    return m;
  }, [headers]);

  function cell(row: string[], field: ImportFieldKey): string | null {
    const col = mapping[field];
    if (!col) return null;
    const idx = headerIndex.get(col);
    if (idx == null) return null;
    const v = (row[idx] ?? "").trim();
    return v.length > 0 ? v : null;
  }

  async function onFile(file: File) {
    try {
      const text = await file.text();
      const records = parse(text, {
        bom: true,
        skip_empty_lines: true,
        relax_column_count: true,
        trim: true,
      }) as string[][];

      if (records.length < 2) {
        toast.error("Le fichier ne contient pas de données exploitables (en-tête + lignes).");
        return;
      }
      const hdr = records[0];
      setFileName(file.name);
      setHeaders(hdr);
      setDataRows(records.slice(1));
      setMapping(autoMap(hdr));
      setStep("mapping");
    } catch (err) {
      toast.error(`CSV illisible : ${err instanceof Error ? err.message : "format invalide"}`);
    }
  }

  async function runImport() {
    setImporting(true);
    try {
      const [index, existing] = await Promise.all([loadExclusionIndex(), getExistingEmailSet()]);
      const seen = new Set<string>();
      const toInsert: ProspectFormValues[] = [];
      const excluded: ReportRow[] = [];
      const duplicates: ReportRow[] = [];
      const errors: ReportRow[] = [];

      dataRows.forEach((row, i) => {
        const line = i + 2; // +1 en-tête, +1 base 1
        const company = cell(row, "company_name");
        if (!company) {
          errors.push({ line, company: "—", email: "", reason: "Raison sociale manquante" });
          return;
        }
        const email = normalizeEmail(cell(row, "email"));

        const match = matchExclusion(index, { email });
        if (match.excluded) {
          excluded.push({
            line,
            company,
            email: email ?? "",
            reason: match.reason ? exclusionReasonLabel(match.reason) : "exclu",
          });
          return;
        }

        if (email) {
          if (existing.has(email) || seen.has(email)) {
            duplicates.push({ line, company, email });
            return;
          }
          seen.add(email);
        }

        toInsert.push({
          ...emptyProspectForm(),
          company_name: company,
          first_name: cell(row, "first_name"),
          last_name: cell(row, "last_name"),
          job_title: cell(row, "job_title"),
          email,
          phone: cell(row, "phone"),
          website: cell(row, "website"),
          city: cell(row, "city"),
          department: cell(row, "department"),
          zone: cell(row, "zone"),
          company_type: cell(row, "company_type"),
          company_size: cell(row, "company_size"),
          notes: cell(row, "notes"),
        });
      });

      const inserted = await insertImportedProspects(toInsert);

      void logActivity({
        event_type: "csv_import",
        entity: "prospect",
        entity_id: null,
        metadata: {
          file: fileName,
          total: dataRows.length,
          inserted,
          duplicates: duplicates.length,
          excluded: excluded.length,
          errors: errors.length,
        },
      });

      setReport({ total: dataRows.length, inserted, duplicates, excluded, errors });
      setStep("report");
      toast.success(`${inserted} prospect(s) importé(s).`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import impossible.");
    } finally {
      setImporting(false);
    }
  }

  function reset() {
    setStep("upload");
    setFileName("");
    setHeaders([]);
    setDataRows([]);
    setReport(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const companyMapped = mapping.company_name !== "";

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={() => navigate(PROSPECTS_ROUTE)}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-800"
      >
        <ArrowLeft className="h-4 w-4" />
        Prospects
      </button>

      {/* Étape 1 — Upload */}
      {step === "upload" && (
        <div className="rounded-[28px] border border-slate-200 bg-white p-8 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-950">Importer un fichier CSV</h2>
          <p className="mt-1 text-sm text-slate-600">
            Fichier CSV avec une ligne d'en-tête. Les adresses présentes dans la liste
            d'exclusion sont automatiquement rejetées ; les doublons d'email sont signalés.
          </p>

          <label className="mt-6 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-slate-200 bg-slate-50 px-6 py-12 text-center transition hover:border-slate-300 hover:bg-slate-100">
            <Upload className="h-8 w-8 text-slate-400" />
            <span className="text-sm font-medium text-slate-700">Choisir un fichier .csv</span>
            <span className="text-xs text-slate-400">ou glissez-le ici</span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
          </label>
        </div>
      )}

      {/* Étape 2 — Mapping */}
      {step === "mapping" && (
        <div className="space-y-5">
          <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
            <FileText className="h-4 w-4 text-slate-400" />
            <span className="font-medium text-slate-800">{fileName}</span>
            <span className="text-slate-400">·</span>
            <span>{dataRows.length} ligne(s)</span>
            <span className="text-slate-400">·</span>
            <span>{headers.length} colonne(s)</span>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
              Correspondance des colonnes
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Associez chaque champ à une colonne du fichier. La raison sociale est obligatoire.
            </p>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {IMPORT_FIELDS.map((field) => (
                <Field key={field.key} label={field.label} required={field.required} htmlFor={`map-${field.key}`}>
                  <Select
                    id={`map-${field.key}`}
                    value={mapping[field.key]}
                    onChange={(e) => setMapping((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  >
                    <option value="">— Ignorer</option>
                    {headers.map((h, i) => (
                      <option key={`${h}-${i}`} value={h}>
                        {h}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
            </div>

            {!companyMapped && (
              <div className="mt-4 flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Associez une colonne à « Raison sociale » pour lancer l'import.
              </div>
            )}
          </div>

          {/* Aperçu */}
          <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-3 text-sm font-medium text-slate-700">
              Aperçu (3 premières lignes)
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-slate-50 text-left text-slate-500">
                  <tr>
                    {headers.map((h, i) => (
                      <th key={`${h}-${i}`} className="px-4 py-2.5 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {dataRows.slice(0, 3).map((row, ri) => (
                    <tr key={ri} className="text-slate-700">
                      {headers.map((_, ci) => (
                        <td key={ci} className="px-4 py-2.5">
                          {row[ci] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <Button variant="secondary" onClick={reset} disabled={importing}>
              Changer de fichier
            </Button>
            <Button onClick={runImport} loading={importing} disabled={!companyMapped}>
              Lancer l'import
            </Button>
          </div>
        </div>
      )}

      {/* Étape 3 — Rapport */}
      {step === "report" && report && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <ReportStat label="Lignes lues" value={report.total} tone="slate" />
            <ReportStat label="Importés" value={report.inserted} tone="emerald" />
            <ReportStat label="Doublons ignorés" value={report.duplicates.length} tone="amber" />
            <ReportStat label="Exclus / erreurs" value={report.excluded.length + report.errors.length} tone="rose" />
          </div>

          {report.excluded.length > 0 && (
            <ReportList
              title="Lignes rejetées — liste d'exclusion"
              icon={<Ban className="h-4 w-4 text-rose-600" />}
              rows={report.excluded}
              withReason
            />
          )}
          {report.errors.length > 0 && (
            <ReportList
              title="Lignes rejetées — erreurs"
              icon={<AlertTriangle className="h-4 w-4 text-rose-600" />}
              rows={report.errors}
              withReason
            />
          )}
          {report.duplicates.length > 0 && (
            <ReportList
              title="Doublons ignorés (email déjà présent)"
              icon={<Copy className="h-4 w-4 text-amber-600" />}
              rows={report.duplicates}
            />
          )}

          {report.inserted > 0 && (
            <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              {report.inserted} prospect(s) ajouté(s) avec la source « Import CSV ».
            </div>
          )}

          <div className="flex items-center justify-between">
            <Button variant="secondary" onClick={reset}>
              Nouvel import
            </Button>
            <Button onClick={() => navigate(PROSPECTS_ROUTE)}>Voir les prospects</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ReportStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "slate" | "emerald" | "amber" | "rose";
}) {
  const toneClass: Record<string, string> = {
    slate: "text-slate-950",
    emerald: "text-emerald-600",
    amber: "text-amber-600",
    rose: "text-rose-600",
  };
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={["mt-1 text-2xl font-semibold tabular-nums", toneClass[tone]].join(" ")}>
        {value}
      </div>
    </div>
  );
}

function ReportList({
  title,
  icon,
  rows,
  withReason = false,
}: {
  title: string;
  icon: ReactNode;
  rows: ReportRow[];
  withReason?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3 text-sm font-medium text-slate-700">
        {icon}
        {title} ({rows.length})
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-5 py-2.5 font-medium">Ligne</th>
              <th className="px-5 py-2.5 font-medium">Raison sociale</th>
              <th className="px-5 py-2.5 font-medium">Email</th>
              {withReason && <th className="px-5 py-2.5 font-medium">Motif</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => (
              <tr key={i} className="text-slate-700">
                <td className="px-5 py-2.5 tabular-nums text-slate-400">{r.line}</td>
                <td className="px-5 py-2.5">{r.company}</td>
                <td className="px-5 py-2.5">{r.email || "—"}</td>
                {withReason && <td className="px-5 py-2.5 text-slate-500">{r.reason}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
