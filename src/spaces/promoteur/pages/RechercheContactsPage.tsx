import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  searchMairieContacts,
  enrichRowsWithMaires,
} from '../services/rechercheContacts.service';
import { exportMairieContactsToXlsx } from '../services/rechercheContactsExport';
import type {
  MairieContactRow,
  RechercheContactsStatus,
} from '../types/rechercheContacts.types';

const PLACEHOLDER = 'Non disponible';
const SUGGEST_MIN_CHARS = 2;
const SUGGEST_DEBOUNCE_MS = 250;
const SUGGEST_LIMIT = 8;

const RADIUS_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: 'Sans rayon' },
  { value: 5, label: '5 km' },
  { value: 10, label: '10 km' },
  { value: 20, label: '20 km' },
  { value: 50, label: '50 km' },
];

type CommuneSuggestion = {
  code: string;
  nom: string;
  codePostal: string | null;
  codeDepartement: string | null;
};

type CopyStatus = 'idle' | 'emails' | 'error';

function displayOrPlaceholder(v: string | null | undefined): string {
  return v && v.trim().length > 0 ? v : PLACEHOLDER;
}

function formatMaire(row: MairieContactRow): string {
  const parts = [row.civiliteMaire, row.prenomMaire, row.nomMaire]
    .map((p) => (p && p.trim().length > 0 ? p.trim() : null))
    .filter((p): p is string => p !== null);

  return parts.length > 0 ? parts.join(' ') : PLACEHOLDER;
}

function formatDistance(km: number | null): string {
  if (km === null) return '—';
  if (km < 1) return '< 1 km';
  return km.toFixed(1).replace(/\.0$/, '') + ' km';
}

function EmptyCell() {
  return <span className="text-slate-400 italic">{PLACEHOLDER}</span>;
}

function EmailCell(props: { email: string | null }) {
  const email = props.email;
  if (!email) return <EmptyCell />;

  return (
    <a href={'mailto:' + email} className="text-violet-700 hover:underline break-all">
      {email}
    </a>
  );
}

function PhoneCell(props: { phone: string | null }) {
  const phone = props.phone;
  if (!phone) return <EmptyCell />;

  return (
    <a href={'tel:' + phone.replace(/\s+/g, '')} className="text-violet-700 hover:underline">
      {phone}
    </a>
  );
}

function TextCell(props: { value: string | null }) {
  if (!props.value) return <EmptyCell />;
  return <>{props.value}</>;
}

function SourceCell(props: { value: string | null }) {
  if (!props.value) return <EmptyCell />;
  return <>{props.value}</>;
}

function shouldSuggest(q: string): boolean {
  const trimmed = q.trim();
  if (trimmed.length < SUGGEST_MIN_CHARS) return false;
  if (/^\d{1,5}$/.test(trimmed)) return false;
  if (/^(2A|2B)$/i.test(trimmed)) return false;
  return true;
}

async function fetchCommuneSuggestions(
  query: string,
  signal: AbortSignal,
): Promise<CommuneSuggestion[]> {
  const url =
    'https://geo.api.gouv.fr/communes?nom=' +
    encodeURIComponent(query) +
    '&fields=nom,code,codesPostaux,codeDepartement' +
    '&boost=population&limit=' +
    String(SUGGEST_LIMIT);

  const resp = await fetch(url, { signal });
  if (!resp.ok) return [];

  const raw = (await resp.json()) as Array<{
    code?: string;
    nom?: string;
    codesPostaux?: string[];
    codeDepartement?: string;
  }>;

  if (!Array.isArray(raw)) return [];

  const out: CommuneSuggestion[] = [];

  for (const r of raw) {
    const code = typeof r.code === 'string' ? r.code : null;
    const nom = typeof r.nom === 'string' ? r.nom : null;
    if (!code || !nom) continue;

    const cp =
      Array.isArray(r.codesPostaux) && r.codesPostaux.length > 0
        ? r.codesPostaux[0]
        : null;

    const dep = typeof r.codeDepartement === 'string' ? r.codeDepartement : null;

    out.push({
      code,
      nom,
      codePostal: cp,
      codeDepartement: dep,
    });
  }

  return out;
}

async function copyToClipboard(text: string): Promise<void> {
  if (!text.trim()) return;

  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '-9999px';

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
}

export default function RechercheContactsPage() {
  const [query, setQuery] = useState('');
  const [radiusKm, setRadiusKm] = useState<number>(0);
  const [rows, setRows] = useState<MairieContactRow[]>([]);
  const [status, setStatus] = useState<RechercheContactsStatus>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastSource, setLastSource] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState<string>('');
  const [lastRadius, setLastRadius] = useState<number>(0);
  const [lastCenter, setLastCenter] = useState<string | null>(null);

  const [suggestions, setSuggestions] = useState<CommuneSuggestion[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [suggestLoading, setSuggestLoading] = useState(false);

  const [selectedEmails, setSelectedEmails] = useState<string[]>([]);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');

  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<number | null>(null);
  const skipNextSuggestRef = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  const isQueryDepartement = /^(2A|2B|\d{2,3})$/i.test(query.trim());
  const radiusEnabled = !isQueryDepartement;

  useEffect(() => {
    setSelectedEmails([]);
    setCopyStatus('idle');
  }, [rows]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (skipNextSuggestRef.current) {
      skipNextSuggestRef.current = false;
      return;
    }

    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }

    if (!shouldSuggest(query)) {
      setSuggestions([]);
      setSuggestOpen(false);
      setHighlightIdx(-1);
      setSuggestLoading(false);
      return;
    }

    setSuggestLoading(true);

    debounceRef.current = window.setTimeout(() => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      fetchCommuneSuggestions(query, ctrl.signal)
        .then((list) => {
          if (ctrl.signal.aborted) return;
          setSuggestions(list);
          setSuggestOpen(list.length > 0);
          setHighlightIdx(list.length > 0 ? 0 : -1);
        })
        .catch(() => {
          if (ctrl.signal.aborted) return;
          setSuggestions([]);
          setSuggestOpen(false);
          setHighlightIdx(-1);
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setSuggestLoading(false);
        });
    }, SUGGEST_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [query]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setSuggestOpen(false);
      }
    }

    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const rowsWithEmail = useMemo(
    () => rows.filter((r) => r.emailMairie && r.emailMairie.trim().length > 0),
    [rows],
  );

  const selectedEmailsText = useMemo(
    () =>
      selectedEmails
        .map((e) => e.trim())
        .filter(Boolean)
        .join('; '),
    [selectedEmails],
  );

  const setTemporaryCopyStatus = useCallback((value: CopyStatus) => {
    setCopyStatus(value);

    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }

    copyTimerRef.current = window.setTimeout(() => {
      setCopyStatus('idle');
    }, 1800);
  }, []);

  const handleCopyEmails = useCallback(async () => {
    try {
      await copyToClipboard(selectedEmailsText);
      setTemporaryCopyStatus('emails');
    } catch {
      setTemporaryCopyStatus('error');
    }
  }, [selectedEmailsText, setTemporaryCopyStatus]);

  const runSearch = useCallback(
    async (rawQuery: string, radius: number) => {
      const q = rawQuery.trim();
      if (!q) return;

      setSuggestOpen(false);
      setStatus('loading');
      setErrorMsg(null);
      setLastQuery(q);
      setLastRadius(radius);

      try {
        const res = await searchMairieContacts({
          query: q,
          radiusKm: radius > 0 ? radius : null,
        });

        let enriched: MairieContactRow[] = res.rows;

        try {
          enriched = await enrichRowsWithMaires(res.rows);
        } catch (enrichErr) {
          console.warn(
            '[RechercheContactsPage] enrichment failed, keeping base rows',
            enrichErr,
          );
          enriched = res.rows;
        }

        setRows(enriched);
        setLastSource(res.source);
        setLastCenter(res.centerCommune ?? null);
        setStatus(enriched.length === 0 ? 'empty' : 'success');
      } catch (err: unknown) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Erreur inattendue lors de la recherche.';

        setErrorMsg(msg);
        setRows([]);
        setLastSource(null);
        setLastCenter(null);
        setStatus('error');
      }
    },
    [],
  );

  const handleSelectSuggestion = useCallback(
    (s: CommuneSuggestion) => {
      const valueForInput = s.nom;
      const valueForSearch = s.codePostal ?? s.nom;

      skipNextSuggestRef.current = true;
      setQuery(valueForInput);
      setSuggestOpen(false);
      setSuggestions([]);
      setHighlightIdx(-1);

      void runSearch(valueForSearch, radiusKm);
    },
    [runSearch, radiusKm],
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (suggestOpen && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightIdx((i) => (i + 1) % suggestions.length);
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        setSuggestOpen(false);
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();

        if (highlightIdx >= 0 && highlightIdx < suggestions.length) {
          handleSelectSuggestion(suggestions[highlightIdx]);
        } else {
          void runSearch(query, radiusKm);
        }

        return;
      }

      if (e.key === 'Tab') {
        setSuggestOpen(false);
        return;
      }
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      void runSearch(query, radiusKm);
    }
  };

  const handleInputFocus = () => {
    if (suggestions.length > 0 && shouldSuggest(query)) {
      setSuggestOpen(true);
    }
  };

  const handleExport = useCallback(() => {
    if (rows.length === 0) return;

    try {
      exportMairieContactsToXlsx(rows, {
        query: lastQuery,
        radiusKm: lastRadius,
        centerCommune: lastCenter,
      });
    } catch (err) {
      console.error('[RechercheContactsPage] export xlsx failed', err);
    }
  }, [rows, lastQuery, lastRadius, lastCenter]);

  const handleToggleEmail = useCallback((email: string) => {
    const clean = email.trim();

    setSelectedEmails((prev) =>
      prev.includes(clean) ? prev.filter((e) => e !== clean) : [...prev, clean],
    );
  }, []);

  const handleSelectAll = useCallback(() => {
    const unique = Array.from(
      new Set(
        rowsWithEmail
          .map((r) => r.emailMairie?.trim())
          .filter((e): e is string => !!e),
      ),
    );

    setSelectedEmails(unique);
  }, [rowsWithEmail]);

  const handleResetSelection = useCallback(() => {
    setSelectedEmails([]);
  }, []);

  const isLoading = status === 'loading';
  const canSubmit = query.trim().length > 0 && !isLoading;
  const canExport = status === 'success' && rows.length > 0;
  const pluralS = rows.length > 1 ? 's' : '';
  const effectiveRadius = radiusEnabled ? radiusKm : 0;

  const showDistanceCol =
    status === 'success' &&
    rows.some((r) => typeof r.distanceKm === 'number' && r.distanceKm !== null);

  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-block w-1.5 h-6 rounded-sm bg-gradient-to-b from-violet-500 to-purple-600" />
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Recherche contacts
          </h1>
        </div>

        <p className="text-sm text-slate-600 max-w-3xl">
          Retrouvez les coordonnées des mairies d&apos;une zone : commune, code
          postal, maire, email, téléphone et adresse postale. Les informations
          manquantes sont signalées explicitement et ne sont jamais déduites.
        </p>
      </header>

      <section
        className="bg-white rounded-xl border border-slate-200 shadow-sm p-5"
        aria-label="Formulaire de recherche"
      >
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3 items-end">
          <div>
            <label
              htmlFor="rechContactQuery"
              className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2"
            >
              Zone à rechercher
            </label>

            <div ref={containerRef} className="relative">
              <input
                id="rechContactQuery"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={handleInputFocus}
                placeholder="Département, code postal ou commune (ex. 78, 92500, Rueil-Malmaison)"
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 disabled:bg-slate-50 disabled:cursor-not-allowed"
                disabled={isLoading}
                autoComplete="off"
                aria-autocomplete="list"
                aria-controls="rechContact-suggestions"
                aria-expanded={suggestOpen}
                aria-activedescendant={
                  highlightIdx >= 0 ? 'rechContact-opt-' + highlightIdx : undefined
                }
                role="combobox"
              />

              {suggestLoading && (
                <span
                  aria-hidden="true"
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-violet-500 border-t-transparent animate-spin"
                />
              )}

              {suggestOpen && suggestions.length > 0 && (
                <ul
                  id="rechContact-suggestions"
                  role="listbox"
                  className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg"
                >
                  {suggestions.map((s, i) => {
                    const isHi = i === highlightIdx;
                    const meta = [
                      s.codePostal,
                      s.codeDepartement ? 'dép. ' + s.codeDepartement : null,
                    ]
                      .filter(Boolean)
                      .join(' · ');

                    return (
                      <li
                        key={s.code + '-' + i}
                        id={'rechContact-opt-' + i}
                        role="option"
                        aria-selected={isHi}
                        className={
                          'flex items-center justify-between px-4 py-2.5 cursor-pointer text-sm ' +
                          (isHi
                            ? 'bg-violet-50 text-violet-900'
                            : 'text-slate-700 hover:bg-slate-50')
                        }
                        onMouseEnter={() => setHighlightIdx(i)}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleSelectSuggestion(s);
                        }}
                      >
                        <span className="font-medium truncate">{s.nom}</span>
                        {meta && (
                          <span className="text-xs text-slate-500 ml-3 shrink-0">
                            {meta}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <div>
            <label
              htmlFor="rechContactRadius"
              className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2"
            >
              Rayon
            </label>

            <select
              id="rechContactRadius"
              value={radiusKm}
              onChange={(e) => setRadiusKm(Number(e.target.value))}
              disabled={isLoading || !radiusEnabled}
              className="w-full sm:w-40 px-3 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 disabled:bg-slate-50 disabled:cursor-not-allowed"
              title={
                radiusEnabled
                  ? 'Rayon de recherche autour de la commune'
                  : 'Rayon indisponible pour une recherche par département'
              }
            >
              {RADIUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <button
              type="button"
              onClick={() => void runSearch(query, radiusKm)}
              disabled={!canSubmit}
              className="w-full sm:w-auto px-5 py-2.5 rounded-lg text-sm font-medium text-white bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all whitespace-nowrap"
            >
              {isLoading ? 'Recherche…' : 'Rechercher'}
            </button>
          </div>
        </div>

        <p className="text-xs text-slate-400 mt-3">
          {radiusEnabled
            ? 'Astuce : sélectionnez une commune puis un rayon pour inclure les communes limitrophes. Le rayon est ignoré pour une recherche par département.'
            : 'Rayon ignoré : la recherche par département couvre déjà toutes les communes du département.'}
          {effectiveRadius > 0 && (
            <>
              {' '}
              Rayon sélectionné : <strong>{effectiveRadius} km</strong>.
            </>
          )}
        </p>
      </section>

      {status === 'idle' && (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center">
          <div className="text-sm text-slate-500">
            Saisissez une zone puis lancez la recherche pour afficher les contacts
            des mairies.
          </div>
        </div>
      )}

      {isLoading && (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
          <div className="inline-flex items-center gap-3 text-sm text-slate-600">
            <span className="w-4 h-4 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
            Recherche en cours…
          </div>
        </div>
      )}

      {status === 'error' && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5" role="alert">
          <div className="text-sm font-semibold text-red-800 mb-1">
            Erreur lors de la recherche
          </div>
          <div className="text-sm text-red-700">
            {errorMsg ?? 'Une erreur inattendue est survenue.'}
          </div>

          <button
            type="button"
            onClick={() => void runSearch(lastQuery || query, lastRadius)}
            className="mt-3 text-sm font-medium text-red-700 hover:text-red-900 underline"
          >
            Réessayer
          </button>
        </div>
      )}

      {status === 'empty' && (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
          <div className="text-sm text-slate-700 font-medium mb-1">
            Aucun résultat
          </div>
          <div className="text-sm text-slate-500">
            Aucune mairie trouvée pour « {lastQuery} »
            {lastRadius > 0 && <> dans un rayon de {lastRadius} km</>}.
            Essayez une autre zone ou un rayon plus large.
          </div>
        </div>
      )}

      {status === 'success' && (
        <section
          className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
          aria-label="Résultats de la recherche"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-slate-200 bg-slate-50">
            <div className="text-sm text-slate-700">
              <span className="font-semibold text-slate-900">{rows.length}</span>{' '}
              mairie{pluralS} trouvée{pluralS} pour « {lastQuery} »
              {lastRadius > 0 && lastCenter && (
                <>
                  {' '}
                  dans un rayon de <strong>{lastRadius} km</strong> autour de{' '}
                  <strong>{lastCenter}</strong>
                </>
              )}
            </div>

            <div className="flex items-center gap-3">
              {lastSource && (
                <div className="text-xs text-slate-500">
                  Source : <span className="font-medium">{lastSource}</span>
                </div>
              )}

              <button
                type="button"
                onClick={handleExport}
                disabled={!canExport}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all whitespace-nowrap"
                title="Télécharger les résultats au format Excel (.xlsx)"
              >
                Exporter Excel
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3 w-10">
                    <span className="sr-only">Sélection</span>
                  </th>
                  <th className="px-4 py-3">Commune</th>
                  <th className="px-4 py-3">Code postal</th>
                  {showDistanceCol && <th className="px-4 py-3">Distance</th>}
                  <th className="px-4 py-3">Maire</th>
                  <th className="px-4 py-3">Email mairie</th>
                  <th className="px-4 py-3">Téléphone</th>
                  <th className="px-4 py-3">Adresse</th>
                  <th className="px-4 py-3">Source</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-200">
                {rows.map((row, i) => {
                  const cpKey = row.codePostal ? row.codePostal : 'na';
                  const key = row.commune + '-' + cpKey + '-' + i;
                  const email = row.emailMairie?.trim() ?? '';
                  const hasEmail = email.length > 0;
                  const isChecked = hasEmail && selectedEmails.includes(email);

                  return (
                    <tr key={key} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        {hasEmail ? (
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleToggleEmail(email)}
                            className="w-4 h-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500 cursor-pointer"
                            aria-label={`Sélectionner la mairie de ${row.commune}`}
                          />
                        ) : (
                          <span
                            className="inline-block w-4 h-4 rounded border border-slate-200 bg-slate-100"
                            title="Pas d'email disponible"
                          />
                        )}
                      </td>

                      <td className="px-4 py-3 text-slate-900 font-medium whitespace-nowrap">
                        {row.commune}
                      </td>

                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                        {displayOrPlaceholder(row.codePostal)}
                      </td>

                      {showDistanceCol && (
                        <td className="px-4 py-3 text-slate-700 whitespace-nowrap text-xs">
                          {formatDistance(row.distanceKm)}
                        </td>
                      )}

                      <td className="px-4 py-3 text-slate-700">
                        {formatMaire(row)}
                      </td>

                      <td className="px-4 py-3 text-slate-700">
                        <EmailCell email={row.emailMairie} />
                      </td>

                      <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                        <PhoneCell phone={row.telephoneMairie} />
                      </td>

                      <td className="px-4 py-3 text-slate-700">
                        <TextCell value={row.adresseMairie} />
                      </td>

                      <td className="px-4 py-3 text-xs text-slate-500">
                        <SourceCell value={row.source} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="border-t border-slate-200 bg-slate-50 px-5 py-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="inline-block w-1 h-5 rounded-sm bg-gradient-to-b from-violet-500 to-purple-600" />
              <h2 className="text-base font-bold text-slate-900 tracking-tight">
                Contacter les mairies
              </h2>
            </div>

            <div className="rounded-xl border border-violet-100 bg-violet-50/60 px-4 py-3 mb-4 text-sm text-slate-700">
              Copiez les adresses puis collez-les dans le champ{' '}
              <strong>CCI / BCC</strong> de votre messagerie. Les pièces jointes
              seront ajoutées directement depuis Gmail, Outlook ou votre boîte mail.
            </div>

            <div className="flex flex-wrap items-center gap-2 mb-4">
              <span className="text-sm text-slate-700">
                <span className="font-semibold text-violet-700">
                  {selectedEmails.length}
                </span>{' '}
                mairie{selectedEmails.length > 1 ? 's' : ''} sélectionnée
                {selectedEmails.length > 1 ? 's' : ''}
                {rowsWithEmail.length > 0 && (
                  <span className="text-slate-400">
                    {' '}
                    sur {rowsWithEmail.length} avec email
                  </span>
                )}
              </span>

              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={handleSelectAll}
                  disabled={
                    rowsWithEmail.length === 0 ||
                    selectedEmails.length === rowsWithEmail.length
                  }
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Tout sélectionner
                </button>

                <button
                  type="button"
                  onClick={handleResetSelection}
                  disabled={selectedEmails.length === 0}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 bg-white hover:bg-slate-100 border border-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Réinitialiser
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 bg-white rounded-xl border border-slate-200 p-4">
              <div>
                <label
                  htmlFor="selectedEmailsText"
                  className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5"
                >
                  Liste des emails à copier — CCI / BCC
                </label>

                <textarea
                  id="selectedEmailsText"
                  value={selectedEmailsText}
                  readOnly
                  rows={5}
                  placeholder="Sélectionnez une ou plusieurs mairies avec email."
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 resize-y"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-slate-500">
                  Collez cette liste dans le champ <strong>CCI</strong> ou{' '}
                  <strong>BCC</strong> de votre messagerie.
                </p>

                <div className="flex items-center gap-2">
                  {copyStatus !== 'idle' && (
                    <span
                      className={
                        'text-sm font-medium mr-1 ' +
                        (copyStatus === 'error' ? 'text-red-700' : 'text-emerald-700')
                      }
                    >
                      {copyStatus === 'emails' && 'Emails copiés'}
                      {copyStatus === 'error' && 'Copie impossible'}
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => void handleCopyEmails()}
                    disabled={selectedEmails.length === 0}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all whitespace-nowrap"
                  >
                    Copier les emails
                    {selectedEmails.length > 0 && (
                      <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-xs bg-white/20">
                        {selectedEmails.length}
                      </span>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}