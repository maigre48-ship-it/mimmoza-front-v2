// ============================================================================
// Garanties.tsx — Banque: gestion des sûretés + localisation projet
// Writes to: dossiersById[id].garanties + dossiersById[id].origination
// ============================================================================

import { useState, useEffect, useCallback } from "react";
import { useBanqueDossierContext } from "../hooks/useBanqueDossierContext";
import { upsertDossier, addEvent } from "../store/banqueSnapshot.store";
import type {
  GarantieItem,
  DossierGaranties,
  DossierOrigination,
} from "../store/banqueSnapshot.types";
import DossierContextBar from "../components/DossierContextBar";

// ── Constants ──

const GARANTIE_TYPES = [
  { value: "hypotheque", label: "Hypothèque" },
  { value: "nantissement", label: "Nantissement" },
  { value: "caution", label: "Caution" },
  { value: "gage", label: "Gage" },
  { value: "autre", label: "Autre" },
];

function emptyGarantie(): GarantieItem {
  return {
    id: crypto.randomUUID(),
    type: "hypotheque",
    description: "",
    valeurEstimee: undefined,
    rang: 1,
  };
}

// ── Project location state shape ──

interface ProjectLocationState {
  adresseProjet: string;
  codePostalProjet: string;
  communeProjet: string;
  communeInseeProjet: string;
  departementProjet: string;
  parcelleCadastrale: string;
  sectionCadastrale: string;
  prefixeCadastral: string;
  latProjet: string;
  lngProjet: string;
}

const EMPTY_LOCATION: ProjectLocationState = {
  adresseProjet: "",
  codePostalProjet: "",
  communeProjet: "",
  communeInseeProjet: "",
  departementProjet: "",
  parcelleCadastrale: "",
  sectionCadastrale: "",
  prefixeCadastral: "",
  latProjet: "",
  lngProjet: "",
};

function originationToLocationState(o?: DossierOrigination): ProjectLocationState {
  if (!o) return { ...EMPTY_LOCATION };
  return {
    adresseProjet: o.adresseProjet ?? "",
    codePostalProjet: o.codePostalProjet ?? o.codePostal ?? "",
    communeProjet: o.communeProjet ?? o.commune ?? "",
    communeInseeProjet: o.communeInseeProjet ?? "",
    departementProjet: o.departementProjet ?? "",
    parcelleCadastrale: o.parcelleCadastrale ?? "",
    sectionCadastrale: o.sectionCadastrale ?? "",
    prefixeCadastral: o.prefixeCadastral ?? "",
    latProjet: o.latProjet != null ? String(o.latProjet) : "",
    lngProjet: o.lngProjet != null ? String(o.lngProjet) : "",
  };
}

// ── Component ──

export default function BanqueGaranties() {
  const { dossierId, dossier, refresh } = useBanqueDossierContext();

  // Garanties state
  const [items, setItems] = useState<GarantieItem[]>([]);
  const [commentaire, setCommentaire] = useState("");

  // Project location state
  const [loc, setLoc] = useState<ProjectLocationState>({ ...EMPTY_LOCATION });
  const [locOpen, setLocOpen] = useState(true);

  // UI
  const [saved, setSaved] = useState(false);

  // ── Init from dossier ──
  useEffect(() => {
    if (dossier?.garanties) {
      setItems(dossier.garanties.items ?? []);
      setCommentaire(dossier.garanties.commentaire ?? "");
    }
    setLoc(originationToLocationState(dossier?.origination));
  }, [dossier?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Garanties helpers ──
  const addItem = () => setItems((prev) => [...prev, emptyGarantie()]);
  const removeItem = (id: string) =>
    setItems((prev) => prev.filter((g) => g.id !== id));
  const updateItem = (id: string, key: keyof GarantieItem, value: unknown) => {
    setItems((prev) =>
      prev.map((g) => (g.id === id ? { ...g, [key]: value } : g))
    );
    setSaved(false);
  };

  // ── Location helper ──
  const updateLoc = useCallback(
    (key: keyof ProjectLocationState, value: string) => {
      setLoc((prev) => ({ ...prev, [key]: value }));
      setSaved(false);
    },
    []
  );

  // Auto-derive département from CP
  const handleCpChange = useCallback(
    (value: string) => {
      updateLoc("codePostalProjet", value);
      if (value.length >= 2) {
        const prefix = value.substring(0, 2);
        if (value.startsWith("20") && value.length >= 3) {
          const cp3 = value.substring(0, 3);
          updateLoc("departementProjet", Number(cp3) >= 201 && Number(cp3) <= 209 ? "2A" : "2B");
        } else {
          updateLoc("departementProjet", prefix);
        }
      }
    },
    [updateLoc]
  );

  const totalCouverture = items.reduce(
    (sum, g) => sum + (g.valeurEstimee ?? 0),
    0
  );

  // ── Save ──
  const handleSave = () => {
    if (!dossierId) return;

    const ratioValue =
      dossier?.origination.montantDemande && totalCouverture
        ? Math.round((totalCouverture / dossier.origination.montantDemande) * 100)
        : undefined;

    const garantiesData: DossierGaranties = {
      items,
      couvertureTotale: totalCouverture,
      ratioGarantieSurPret: ratioValue,
      commentaire,
    };

    // Build origination patch — preserve existing fields, add/overwrite project location
    const originationPatch: Partial<DossierOrigination> = {
      ...dossier?.origination,
      adresseProjet: loc.adresseProjet || undefined,
      codePostalProjet: loc.codePostalProjet || undefined,
      communeProjet: loc.communeProjet || undefined,
      communeInseeProjet: loc.communeInseeProjet || undefined,
      departementProjet: loc.departementProjet || undefined,
      parcelleCadastrale: loc.parcelleCadastrale || undefined,
      sectionCadastrale: loc.sectionCadastrale || undefined,
      prefixeCadastral: loc.prefixeCadastral || undefined,
      latProjet: loc.latProjet ? Number(loc.latProjet) : undefined,
      lngProjet: loc.lngProjet ? Number(loc.lngProjet) : undefined,
      // Keep legacy fields in sync for backward compat
      codePostal: loc.codePostalProjet || dossier?.origination?.codePostal || undefined,
      commune: loc.communeProjet || dossier?.origination?.commune || undefined,
    };

    upsertDossier({
      id: dossierId,
      garanties: garantiesData,
      origination: originationPatch as DossierOrigination,
      updatedAt: new Date().toISOString(),
    } as any);

    addEvent({
      type: "garanties_updated",
      dossierId,
      message: `${items.length} garantie(s) — couverture ${(totalCouverture / 1e6).toFixed(2)} M€ — ratio ${ratioValue ?? "N/A"}%`,
    });

    const locFields = [
      loc.adresseProjet,
      loc.codePostalProjet,
      loc.communeProjet,
      loc.communeInseeProjet,
      loc.parcelleCadastrale,
    ].filter(Boolean);

    if (locFields.length > 0) {
      addEvent({
        type: "projet_localisation_updated",
        dossierId,
        message: `Localisation projet : ${loc.communeProjet || "—"} (${loc.codePostalProjet || "—"}) — INSEE ${loc.communeInseeProjet || "—"} — parcelle ${loc.parcelleCadastrale || "—"}`,
      });
    }

    console.log("[Garanties] ✅ Saved to dossier:", {
      dossierId,
      garanties: { count: items.length, couvertureTotale: totalCouverture, ratio: ratioValue },
      location: {
        adresse: loc.adresseProjet,
        cp: loc.codePostalProjet,
        commune: loc.communeProjet,
        insee: loc.communeInseeProjet,
        dept: loc.departementProjet,
        parcelle: loc.parcelleCadastrale,
        section: loc.sectionCadastrale,
        lat: loc.latProjet,
        lng: loc.lngProjet,
      },
    });

    refresh();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // ── Completeness indicator ──
  const locFieldsCount = [
    loc.adresseProjet,
    loc.codePostalProjet,
    loc.communeProjet,
    loc.communeInseeProjet,
  ].filter(Boolean).length;
  const locComplete = locFieldsCount >= 3;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <DossierContextBar dossier={dossier} dossierId={dossierId} />

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-slate-900">Garanties & Sûretés</h1>
        {saved && (
          <span className="text-sm text-green-600 font-medium">✓ Sauvegardé</span>
        )}
      </div>

      {!dossierId ? (
        <p className="text-sm text-slate-500">
          Sélectionnez un dossier depuis le tableau de bord.
        </p>
      ) : (
        <div className="space-y-4">
          {/* ─── Localisation du projet ─── */}
          <div className="rounded-lg border border-blue-200 bg-blue-50/40">
            <button
              type="button"
              onClick={() => setLocOpen((v) => !v)}
              className="flex w-full items-center justify-between px-4 py-3"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-blue-900">
                  📍 Localisation du projet
                </span>
                {!locOpen && (
                  <span className="text-xs text-slate-500">
                    {loc.communeProjet
                      ? `${loc.communeProjet} (${loc.codePostalProjet})`
                      : "Non renseignée"}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {!locComplete && (
                  <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                    Incomplet
                  </span>
                )}
                {locComplete && (
                  <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                    {locFieldsCount}/4
                  </span>
                )}
                <span className="text-xs text-slate-400">{locOpen ? "▲" : "▼"}</span>
              </div>
            </button>

            {locOpen && (
              <div className="border-t border-blue-200 px-4 pb-4 pt-3 space-y-3">
                <p className="text-xs text-slate-500">
                  Ces champs alimentent l'enrichissement géographique (DVF, INSEE, Géorisques, BAN…).
                  Renseignez au minimum l'adresse, le code postal et la commune.
                </p>

                {/* Row 1: Adresse projet */}
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Adresse du projet
                  </label>
                  <input
                    value={loc.adresseProjet}
                    onChange={(e) => updateLoc("adresseProjet", e.target.value)}
                    placeholder="ex: 6 parc de la Bérengère, 92210 Saint-Cloud"
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                  />
                </div>

                {/* Row 2: CP / Commune / INSEE / Département */}
                <div className="grid grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Code postal
                    </label>
                    <input
                      value={loc.codePostalProjet}
                      onChange={(e) => handleCpChange(e.target.value)}
                      placeholder="92210"
                      maxLength={5}
                      className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Commune
                    </label>
                    <input
                      value={loc.communeProjet}
                      onChange={(e) => updateLoc("communeProjet", e.target.value)}
                      placeholder="Saint-Cloud"
                      className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Code INSEE
                    </label>
                    <input
                      value={loc.communeInseeProjet}
                      onChange={(e) => updateLoc("communeInseeProjet", e.target.value)}
                      placeholder="92064"
                      maxLength={5}
                      className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Département
                    </label>
                    <input
                      value={loc.departementProjet}
                      onChange={(e) => updateLoc("departementProjet", e.target.value)}
                      placeholder="92"
                      maxLength={3}
                      className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm bg-slate-50"
                    />
                  </div>
                </div>

                {/* Row 3: Parcelle cadastrale / Section / Préfixe */}
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Parcelle cadastrale
                    </label>
                    <input
                      value={loc.parcelleCadastrale}
                      onChange={(e) => updateLoc("parcelleCadastrale", e.target.value.toUpperCase())}
                      placeholder="000 AB 0123"
                      className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Section cadastrale
                    </label>
                    <input
                      value={loc.sectionCadastrale}
                      onChange={(e) => updateLoc("sectionCadastrale", e.target.value.toUpperCase())}
                      placeholder="AB"
                      maxLength={4}
                      className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Préfixe cadastral
                    </label>
                    <input
                      value={loc.prefixeCadastral}
                      onChange={(e) => updateLoc("prefixeCadastral", e.target.value)}
                      placeholder="000"
                      maxLength={3}
                      className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono"
                    />
                  </div>
                </div>

                {/* Row 4: Lat / Lng */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Latitude
                    </label>
                    <input
                      value={loc.latProjet}
                      onChange={(e) => updateLoc("latProjet", e.target.value)}
                      placeholder="48.8448"
                      className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Longitude
                    </label>
                    <input
                      value={loc.lngProjet}
                      onChange={(e) => updateLoc("lngProjet", e.target.value)}
                      placeholder="2.2157"
                      className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ─── KPI bar ─── */}
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4 text-center">
              <p className="text-xs text-slate-500">Nombre</p>
              <p className="text-2xl font-bold text-slate-900">{items.length}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4 text-center">
              <p className="text-xs text-slate-500">Couverture totale</p>
              <p className="text-2xl font-bold text-slate-900">
                {(totalCouverture / 1e6).toFixed(2)} M€
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4 text-center">
              <p className="text-xs text-slate-500">Ratio garantie/prêt</p>
              <p className="text-2xl font-bold text-slate-900">
                {dossier?.origination.montantDemande && totalCouverture
                  ? `${Math.round((totalCouverture / dossier.origination.montantDemande) * 100)}%`
                  : "—"}
              </p>
            </div>
          </div>

          {/* ─── Garantie items ─── */}
          {items.map((g, idx) => (
            <div key={g.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-slate-700">
                  Garantie #{idx + 1}
                </span>
                <button
                  onClick={() => removeItem(g.id)}
                  className="text-xs text-red-500 hover:text-red-700"
                >
                  Supprimer
                </button>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
                  <select
                    value={g.type}
                    onChange={(e) => updateItem(g.id, "type", e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  >
                    {GARANTIE_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Description
                  </label>
                  <input
                    value={g.description}
                    onChange={(e) => updateItem(g.id, "description", e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Valeur (€)
                  </label>
                  <input
                    type="number"
                    value={g.valeurEstimee?.toString() ?? ""}
                    onChange={(e) =>
                      updateItem(
                        g.id,
                        "valeurEstimee",
                        e.target.value ? Number(e.target.value) : undefined
                      )
                    }
                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </div>
              </div>
            </div>
          ))}

          <button
            onClick={addItem}
            className="w-full rounded-lg border-2 border-dashed border-slate-300 py-3 text-sm text-slate-500 hover:border-slate-400 hover:text-slate-700"
          >
            + Ajouter une garantie
          </button>

          {/* ─── Commentaire ─── */}
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <label className="block text-xs font-medium text-slate-600 mb-1">Commentaire</label>
            <textarea
              value={commentaire}
              onChange={(e) => {
                setCommentaire(e.target.value);
                setSaved(false);
              }}
              rows={3}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleSave}
              className="rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
            >
              Enregistrer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}