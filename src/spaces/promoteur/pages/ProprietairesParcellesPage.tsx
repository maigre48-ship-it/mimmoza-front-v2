// src/spaces/promoteur/pages/ProprietairesParcellesPage.tsx
//
// Recherche de propriétaires — personnes morales.
//
// ⚠️ Le point le plus important de cette page n'est pas ce qu'elle affiche mais
// ce qu'elle refuse de laisser croire. La source ne contient AUCUNE personne
// physique : une parcelle absente n'est pas « sans propriétaire », elle
// appartient vraisemblablement à un particulier. Un écran vide sans cette
// explication serait une erreur d'interprétation garantie, et l'utilisateur
// conclurait à un terrain sans maître.
//
// La couverture est en outre partielle tant que tous les départements ne sont
// pas importés — un « aucun résultat » peut donc aussi vouloir dire « ce
// département n'est pas encore chargé ». La page le dit.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Building2,
  Download,
  Info,
  Loader2,
  MapPin,
  Search,
  Sparkles,
} from "lucide-react";

import {
  formatAdresse,
  formatParcelle,
  formatSiren,
  iduValide,
  rechercherProprietaires,
  sirenValide,
} from "../services/proprietairesParcelles.service";
import { exporterProprietairesXlsx } from "../services/proprietairesParcellesExport";
import {
  searchCommuneSuggestions,
  type CommuneSuggestion,
} from "../utils/communeResolver";
import type {
  ModeRechercheProprietaire,
  ProprietaireParcelleRow,
  RechercheProprietairesResponse,
  RechercheProprietairesStatus,
} from "../types/proprietairesParcelles.types";

const PLACEHOLDER = "Non disponible";

const MODES: Array<{
  id: ModeRechercheProprietaire;
  label: string;
  aide: string;
}> = [
  {
    id: "parcelle",
    label: "Par parcelle",
    aide: "À qui appartient cette parcelle ?",
  },
  {
    id: "denomination",
    label: "Par nom de société",
    aide: "Quelles parcelles possède cette société ?",
  },
  {
    id: "siren",
    label: "Par SIREN",
    aide: "Recherche exacte sur l'identifiant de l'entreprise.",
  },
  {
    id: "commune",
    label: "Par commune",
    aide: "Toutes les personnes morales propriétaires sur un territoire.",
  },
];

export default function ProprietairesParcellesPage() {
  const [mode, setMode] = useState<ModeRechercheProprietaire>("parcelle");
  const [status, setStatus] = useState<RechercheProprietairesStatus>("idle");
  const [reponse, setReponse] = useState<RechercheProprietairesResponse | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [critereAffiche, setCritereAffiche] = useState("");

  // Champs de saisie
  const [idu, setIdu] = useState("");
  const [section, setSection] = useState("");
  const [numero, setNumero] = useState("");
  const [denomination, setDenomination] = useState("");
  const [siren, setSiren] = useState("");
  const [filtreDept, setFiltreDept] = useState("");

  // Commune : autocomplete
  const [communeSaisie, setCommuneSaisie] = useState("");
  const [commune, setCommune] = useState<CommuneSuggestion | null>(null);
  const [suggestions, setSuggestions] = useState<CommuneSuggestion[]>([]);
  const [suggestionsOuvertes, setSuggestionsOuvertes] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<number | null>(null);

  // ── Autocomplete commune ───────────────────────────────────────────────────
  useEffect(() => {
    const q = communeSaisie.trim();
    // Trop court, ou commune déjà choisie : on ne lance rien et on ne vide
    // aucun état. Vider ici serait un setState synchrone dans un effet ; la
    // visibilité de la liste se déduit au rendu (voir `suggestionsVisibles`),
    // ce qui rend d'anciennes suggestions inoffensives.
    if (q.length < 2 || commune?.nom === q) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      void searchCommuneSuggestions(q, ctrl.signal).then((res) => {
        if (!ctrl.signal.aborted) {
          setSuggestions(res);
          setSuggestionsOuvertes(res.length > 0);
        }
      });
    }, 250);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [communeSaisie, commune]);

  // ── Validité de la saisie ──────────────────────────────────────────────────
  const critere = useMemo(() => {
    switch (mode) {
      case "parcelle":
        return idu.trim()
          ? { valide: iduValide(idu), libelle: `Parcelle ${idu.trim().toUpperCase()}` }
          : {
              valide: Boolean(commune && section.trim() && numero.trim()),
              libelle: commune
                ? `${commune.nom} — ${section.trim().toUpperCase()} ${numero.trim()}`
                : "",
            };
      case "denomination":
        return {
          valide: denomination.trim().length >= 3,
          libelle: denomination.trim(),
        };
      case "siren":
        return { valide: sirenValide(siren), libelle: `SIREN ${siren.trim()}` };
      case "commune":
        return { valide: Boolean(commune), libelle: commune?.nom ?? "" };
      default:
        return { valide: false, libelle: "" };
    }
  }, [mode, idu, commune, section, numero, denomination, siren]);

  const lancer = useCallback(async () => {
    if (!critere.valide) return;
    setStatus("loading");
    setErreur(null);
    try {
      const res = await rechercherProprietaires({
        mode,
        idu: mode === "parcelle" && idu.trim() ? idu : null,
        codeInsee:
          mode === "denomination"
            ? filtreDept.trim() || null
            : (commune?.code ?? null),
        section: mode === "parcelle" ? section : null,
        numero: mode === "parcelle" ? numero : null,
        denomination: mode === "denomination" ? denomination : null,
        siren: mode === "siren" ? siren : null,
      });
      setReponse(res);
      setCritereAffiche(critere.libelle);
      setStatus(res.rows.length === 0 ? "empty" : "success");
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Recherche impossible.");
      setStatus("error");
    }
  }, [critere, mode, idu, commune, section, numero, denomination, siren, filtreDept]);

  /** La liste ne s'affiche que si la saisie la justifie encore. */
  const suggestionsVisibles =
    suggestionsOuvertes &&
    suggestions.length > 0 &&
    communeSaisie.trim().length >= 2 &&
    !commune;

  function choisirCommune(s: CommuneSuggestion) {
    setCommune(s);
    setCommuneSaisie(s.nom);
    setSuggestionsOuvertes(false);
  }

  function changerMode(nouveau: ModeRechercheProprietaire) {
    setMode(nouveau);
    setStatus("idle");
    setReponse(null);
    setErreur(null);
  }

  const modeCourant = MODES.find((m) => m.id === mode)!;

  return (
    <div className="space-y-6">
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-[32px] bg-gradient-to-r from-[#6f5bd6] via-[#8d78df] to-[#b39ddb] px-8 py-8 text-white shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white/90">
          <Sparkles className="h-3.5 w-3.5" />
          Promoteur · Opportunités
        </div>
        <h1 className="text-4xl font-semibold tracking-tight">
          Propriétaires de parcelles
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-slate-100">
          Identifie la personne morale propriétaire d'une parcelle, ou l'inverse :
          toutes les parcelles détenues par une société. Source DGFiP, Licence
          Ouverte 2.0.
        </p>
      </div>

      {/* ── Avertissement de périmètre, non masquable ─────────────────────── */}
      <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div className="text-sm text-amber-900">
          <div className="font-medium">Personnes morales uniquement</div>
          <p className="mt-1 text-amber-800">
            Cette base ne recense que les sociétés, SCI, collectivités et
            associations. Elle ne contient aucun particulier, et ne le peut pas :
            l'identité des propriétaires personnes physiques relève des fichiers
            fonciers, réservés aux acteurs publics et interdits de démarchage
            commercial. <strong>Une parcelle sans résultat n'est pas sans
            propriétaire</strong> — elle appartient vraisemblablement à un
            particulier.
          </p>
        </div>
      </div>

      {/* ── Formulaire ────────────────────────────────────────────────────── */}
      <section
        className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
        aria-label="Formulaire de recherche"
      >
        {/* Sélecteur de mode */}
        <div className="flex flex-wrap gap-2">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => changerMode(m.id)}
              className={[
                "rounded-xl border px-4 py-2 text-sm font-medium transition",
                mode === m.id
                  ? "border-violet-300 bg-violet-50 text-violet-800"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
              ].join(" ")}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">{modeCourant.aide}</p>

        <div className="mt-4 space-y-3">
          {mode === "parcelle" && (
            <>
              <Champ label="Référence cadastrale complète (IDU, 14 caractères)">
                <input
                  value={idu}
                  onChange={(e) => setIdu(e.target.value)}
                  placeholder="69256000BH0199"
                  className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm uppercase focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100"
                />
              </Champ>

              <div className="flex items-center gap-3 text-xs text-slate-400">
                <div className="h-px flex-1 bg-slate-200" />
                ou décris la parcelle
                <div className="h-px flex-1 bg-slate-200" />
              </div>

              <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
                <ChampCommune
                  saisie={communeSaisie}
                  setSaisie={(v) => {
                    setCommuneSaisie(v);
                    setCommune(null);
                  }}
                  commune={commune}
                  suggestions={suggestions}
                  ouvertes={suggestionsVisibles}
                  onChoisir={choisirCommune}
                  desactive={Boolean(idu.trim())}
                />
                <Champ label="Section">
                  <input
                    value={section}
                    onChange={(e) => setSection(e.target.value)}
                    placeholder="BH"
                    disabled={Boolean(idu.trim())}
                    className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm uppercase focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100 disabled:bg-slate-50"
                  />
                </Champ>
                <Champ label="Numéro">
                  <input
                    value={numero}
                    onChange={(e) => setNumero(e.target.value)}
                    placeholder="199"
                    disabled={Boolean(idu.trim())}
                    className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100 disabled:bg-slate-50"
                  />
                </Champ>
              </div>
            </>
          )}

          {mode === "denomination" && (
            <div className="grid gap-3 sm:grid-cols-[3fr_1fr]">
              <Champ label="Nom de la société (trois caractères minimum)">
                <input
                  value={denomination}
                  onChange={(e) => setDenomination(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void lancer()}
                  placeholder="FONCIERE DU RHONE"
                  className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100"
                />
              </Champ>
              <Champ label="Département (facultatif)">
                <input
                  value={filtreDept}
                  onChange={(e) => setFiltreDept(e.target.value)}
                  placeholder="69"
                  className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100"
                />
              </Champ>
            </div>
          )}

          {mode === "siren" && (
            <Champ label="SIREN (neuf chiffres)">
              <input
                value={siren}
                onChange={(e) => setSiren(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void lancer()}
                placeholder="822 205 449"
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100 sm:max-w-xs"
              />
            </Champ>
          )}

          {mode === "commune" && (
            <ChampCommune
              saisie={communeSaisie}
              setSaisie={(v) => {
                setCommuneSaisie(v);
                setCommune(null);
              }}
              commune={commune}
              suggestions={suggestions}
              ouvertes={suggestionsVisibles}
              onChoisir={choisirCommune}
            />
          )}

          <button
            type="button"
            onClick={() => void lancer()}
            disabled={!critere.valide || status === "loading"}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:from-violet-700 hover:to-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === "loading" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            Rechercher
          </button>
        </div>
      </section>

      {/* ── États ─────────────────────────────────────────────────────────── */}
      {status === "error" && (
        <div
          className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-5"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
          <p className="text-sm text-rose-800">{erreur}</p>
        </div>
      )}

      {status === "empty" && (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <Building2 className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm font-medium text-slate-800">
            Aucune personne morale trouvée
          </p>
          {/* Cette formulation est le cœur de la page : trois lectures
              possibles, aucune n'est « terrain sans propriétaire ». */}
          <p className="mx-auto mt-2 max-w-xl text-sm text-slate-600">
            Trois explications possibles : le bien appartient à un particulier,
            le département n'est pas encore chargé en base, ou la référence
            saisie ne correspond à aucune parcelle. Ce résultat ne signifie
            jamais que la parcelle est sans propriétaire.
          </p>
        </div>
      )}

      {status === "success" && reponse && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3">
            <div className="text-sm text-slate-600">
              {/* Le « plus de » n'est pas une coquetterie : au-delà du plafond,
                  le compte est un minorant et les lignes montrées ne sont pas
                  les premières de l'ordre alphabétique, mais un extrait.
                  Afficher « 5 000 » sec laisserait croire à une liste complète. */}
              <strong className="text-slate-900">
                {reponse.totalPlafonne ? "Plus de " : ""}
                {reponse.total.toLocaleString("fr-FR")}
              </strong>{" "}
              correspondance{reponse.total > 1 ? "s" : ""}
              {reponse.tronque && (
                <span className="text-slate-500">
                  {" "}
                  — {reponse.rows.length}{" "}
                  {reponse.totalPlafonne ? "extraites" : "affichées"}, affine le
                  critère pour la suite
                </span>
              )}
              {reponse.millesime && (
                <span className="text-slate-400"> · millésime {reponse.millesime}</span>
              )}
            </div>
            <button
              type="button"
              onClick={() =>
                exporterProprietairesXlsx(reponse, {
                  critere: critereAffiche,
                  modeLibelle: modeCourant.label,
                })
              }
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              <Download className="h-4 w-4" />
              Exporter Excel
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Propriétaire</th>
                  <th className="px-4 py-3">SIREN</th>
                  <th className="px-4 py-3">Forme</th>
                  <th className="px-4 py-3">Commune</th>
                  <th className="px-4 py-3">Parcelle</th>
                  <th className="px-4 py-3">Adresse</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {reponse.rows.map((r) => (
                  <LigneResultat key={`${r.idu}-${r.denomination}-${r.codeDroit}`} row={r} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

// ── Fragments ────────────────────────────────────────────────────────────────

function LigneResultat({ row }: { row: ProprietaireParcelleRow }) {
  const adresse = formatAdresse(row);
  return (
    <tr className="transition-colors hover:bg-slate-50">
      <td className="px-4 py-3">
        <div className="font-medium text-slate-900">{row.denomination}</div>
        <div className="font-mono text-xs text-slate-400">{row.idu}</div>
      </td>
      <td className="px-4 py-3 tabular-nums text-slate-700">
        {formatSiren(row.siren) ?? (
          // Un SIREN absent n'est pas une donnée manquante : la DGFiP crée des
          // identifiants fictifs commençant par « U » que l'import écarte
          // volontairement, pour éviter tout rapprochement faux avec Sirene.
          <span className="text-slate-400" title="SIREN non exploitable ou fictif">
            {PLACEHOLDER}
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-slate-600">{row.formeJuridique ?? "—"}</td>
      <td className="px-4 py-3 text-slate-700">
        {row.communeNom ?? row.codeInsee}
        <div className="text-xs text-slate-400">{row.codeInsee}</div>
      </td>
      <td className="px-4 py-3 font-mono text-slate-700">{formatParcelle(row)}</td>
      <td className="px-4 py-3 text-slate-600">{adresse ?? "—"}</td>
    </tr>
  );
}

function Champ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function ChampCommune({
  saisie,
  setSaisie,
  commune,
  suggestions,
  ouvertes,
  onChoisir,
  desactive = false,
}: {
  saisie: string;
  setSaisie: (v: string) => void;
  commune: CommuneSuggestion | null;
  suggestions: CommuneSuggestion[];
  ouvertes: boolean;
  onChoisir: (s: CommuneSuggestion) => void;
  desactive?: boolean;
}) {
  return (
    <div className="relative">
      <Champ label="Commune">
        <div className="relative">
          <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            placeholder="Vaulx-en-Velin, 69120…"
            disabled={desactive}
            role="combobox"
            aria-expanded={ouvertes}
            aria-autocomplete="list"
            className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-4 text-sm focus:border-violet-400 focus:outline-none focus:ring-4 focus:ring-violet-100 disabled:bg-slate-50"
          />
        </div>
      </Champ>

      {commune && (
        <p className="mt-1 text-xs text-emerald-700">
          {commune.nom} · INSEE {commune.code}
        </p>
      )}

      {ouvertes && !desactive && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
        >
          {suggestions.map((s) => (
            <li key={s.code}>
              <button
                type="button"
                onClick={() => onChoisir(s)}
                className="flex w-full items-baseline justify-between px-4 py-2 text-left text-sm hover:bg-violet-50"
              >
                <span className="text-slate-800">{s.nom}</span>
                <span className="text-xs text-slate-400">{s.code}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
