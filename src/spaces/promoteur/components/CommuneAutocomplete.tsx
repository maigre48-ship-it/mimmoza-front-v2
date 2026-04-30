// src/spaces/promoteur/components/CommuneAutocomplete.tsx

import { useCallback, useEffect, useRef, useState } from "react";
import type { CommuneSuggestion } from "../utils/communeResolver";
import { searchCommuneSuggestions } from "../utils/communeResolver";

interface Props {
  value: CommuneSuggestion | null;
  onChange: (commune: CommuneSuggestion | null) => void;
  placeholder?: string;
  required?: boolean;
  autoFocus?: boolean;
  id?: string;
  disabled?: boolean;
}

export function CommuneAutocomplete({
  value,
  onChange,
  placeholder = "Nom de la commune, code INSEE ou code postal…",
  required,
  autoFocus,
  id,
  disabled,
}: Props) {
  const [query, setQuery] = useState<string>(value?.nom ?? "");
  const [suggestions, setSuggestions] = useState<CommuneSuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Synchro : si la valeur externe change, on reflète dans le champ.
  useEffect(() => {
    setQuery(value?.nom ?? "");
  }, [value]);

  // Recherche debounced quand l'utilisateur tape (et que la saisie diffère
  // de la commune actuellement sélectionnée).
  useEffect(() => {
    const q = query.trim();
    if (!q || q.length < 2) {
      setSuggestions([]);
      setIsOpen(false);
      return;
    }
    if (value && q === value.nom) {
      // la saisie correspond déjà à la sélection, pas besoin de chercher
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const results = await searchCommuneSuggestions(q, controller.signal);
        setSuggestions(results);
        setIsOpen(results.length > 0);
        setActiveIndex(results.length > 0 ? 0 : -1);
      } catch {
        /* abort ou réseau */
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, value]);

  // Fermeture au clic hors du composant.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const selectSuggestion = useCallback(
    (sugg: CommuneSuggestion) => {
      onChange(sugg);
      setQuery(sugg.nom);
      setIsOpen(false);
      setSuggestions([]);
      setActiveIndex(-1);
    },
    [onChange],
  );

  const clear = () => {
    onChange(null);
    setQuery("");
    setSuggestions([]);
    setIsOpen(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      if (suggestions.length > 0) {
        e.preventDefault();
        setIsOpen(true);
        setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
      }
    } else if (e.key === "ArrowUp") {
      if (suggestions.length > 0 && isOpen) {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      }
    } else if (e.key === "Enter") {
      if (isOpen && activeIndex >= 0 && activeIndex < suggestions.length) {
        e.preventDefault();
        selectSuggestion(suggestions[activeIndex]);
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
    }
  };

  const hasValue = Boolean(value);

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </div>
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (value) onChange(null);
          }}
          onFocus={() => {
            if (suggestions.length > 0) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete="off"
          required={required}
          disabled={disabled}
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-invalid={required && !hasValue ? true : undefined}
          className={`w-full rounded-lg border bg-white px-9 py-2.5 text-sm transition focus:outline-none focus:ring-2 disabled:bg-slate-50 disabled:text-slate-400 ${
            required && !hasValue
              ? "border-slate-300 focus:border-violet-500 focus:ring-violet-200"
              : "border-slate-300 focus:border-violet-500 focus:ring-violet-200"
          }`}
        />
        {loading && !hasValue && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />
          </div>
        )}
        {hasValue && !disabled && (
          <button
            type="button"
            onClick={clear}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            aria-label="Effacer la commune"
            title="Effacer"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {isOpen && suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-auto rounded-xl border border-slate-200 bg-white shadow-xl"
        >
          {suggestions.map((s, i) => {
            const active = i === activeIndex;
            return (
              <li
                key={s.code}
                role="option"
                aria-selected={active}
                onMouseDown={(e) => {
                  // mousedown plutôt que click pour éviter le blur qui ferme la liste
                  e.preventDefault();
                  selectSuggestion(s);
                }}
                onMouseEnter={() => setActiveIndex(i)}
                className={`cursor-pointer border-b border-slate-100 px-3 py-2 text-sm last:border-b-0 ${
                  active ? "bg-violet-50" : "hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate font-medium text-slate-800">
                    {s.nom}
                  </span>
                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-600">
                    {s.code}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                  {s.codeDepartement && <span>Dép. {s.codeDepartement}</span>}
                  {s.codesPostaux.length > 0 && (
                    <span>
                      CP {s.codesPostaux.slice(0, 3).join(", ")}
                      {s.codesPostaux.length > 3 ? "…" : ""}
                    </span>
                  )}
                  {s.population !== null && (
                    <span>
                      {s.population.toLocaleString("fr-FR")} hab.
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}