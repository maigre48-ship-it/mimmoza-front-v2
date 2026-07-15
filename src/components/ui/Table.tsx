// src/components/ui/Table.tsx
// Table générique du module Agent commercial : tri de colonnes + pagination
// client-side. Aucune librairie externe. Style admin (carte arrondie, entête slate).

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";

type SortDir = "asc" | "desc";
type Align = "left" | "right" | "center";

export interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  align?: Align;
  className?: string;
  render?: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number | null;
}

const ALIGN_CLASS: Record<Align, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

export function Table<T>({
  columns,
  rows,
  rowKey,
  pageSize = 10,
  initialSort,
  onRowClick,
  emptyState,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  pageSize?: number;
  initialSort?: { key: string; dir: SortDir };
  onRowClick?: (row: T) => void;
  emptyState?: ReactNode;
}) {
  const [sortKey, setSortKey] = useState<string | null>(initialSort?.key ?? null);
  const [sortDir, setSortDir] = useState<SortDir>(initialSort?.dir ?? "asc");
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    const col = sortKey ? columns.find((c) => c.key === sortKey) : undefined;
    if (!col?.sortValue) return rows;
    const getVal = col.sortValue;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = getVal(a);
      const vb = getVal(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // valeurs vides en dernier
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), "fr") * dir;
    });
  }, [rows, columns, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * pageSize;
  const pageRows = useMemo(
    () => sorted.slice(start, start + pageSize),
    [sorted, start, pageSize],
  );

  function toggleSort(col: Column<T>) {
    if (!col.sortable || !col.sortValue) return;
    if (sortKey === col.key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col.key);
      setSortDir("asc");
    }
    setPage(0);
  }

  if (rows.length === 0 && emptyState) {
    return (
      <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
        {emptyState}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              {columns.map((col) => {
                const active = sortKey === col.key;
                const align = col.align ?? "left";
                return (
                  <th
                    key={col.key}
                    className={["px-5 py-3.5 font-medium", ALIGN_CLASS[align], col.className ?? ""].join(" ")}
                  >
                    {col.sortable && col.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col)}
                        className="inline-flex items-center gap-1.5 transition hover:text-slate-800"
                      >
                        <span>{col.header}</span>
                        {active ? (
                          sortDir === "asc" ? (
                            <ArrowUp className="h-3.5 w-3.5" />
                          ) : (
                            <ArrowDown className="h-3.5 w-3.5" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3.5 w-3.5 text-slate-300" />
                        )}
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pageRows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={[
                  "text-slate-700",
                  onRowClick ? "cursor-pointer transition hover:bg-slate-50" : "",
                ].join(" ")}
              >
                {columns.map((col) => {
                  const align = col.align ?? "left";
                  return (
                    <td
                      key={col.key}
                      className={["px-5 py-3.5", ALIGN_CLASS[align], col.className ?? ""].join(" ")}
                    >
                      {col.render ? col.render(row) : ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm text-slate-500">
        <span>
          {sorted.length === 0
            ? "0 résultat"
            : `${start + 1}–${Math.min(start + pageSize, sorted.length)} sur ${sorted.length}`}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage(Math.max(0, safePage - 1))}
            disabled={safePage <= 0}
            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-2.5 py-1.5 text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
            Précédent
          </button>
          <span className="tabular-nums">
            {safePage + 1} / {pageCount}
          </span>
          <button
            type="button"
            onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
            disabled={safePage >= pageCount - 1}
            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-2.5 py-1.5 text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Suivant
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
