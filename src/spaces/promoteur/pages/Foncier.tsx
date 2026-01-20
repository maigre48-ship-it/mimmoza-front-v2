import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { supabase } from "../../../supabaseClient";
import ParcelMapSelector from "../foncier/ParcelMapSelector";

// TEMP: désactivé à cause du CORS (header x-client-info rejeté par foncier-lookup-v1)
// Réactiver quand la function sera corrigée côté backend
const ENABLE_FONCIER_LOOKUP_ENRICH = false;

type PluLookupResult = {
  success?: boolean;
  error?: string;
  message?: string;

  commune_insee?: string;
  commune_nom?: string;

  parcel_id?: string;
  parcel?: any;

  zone_code?: string;
  zone_libelle?: string;

  rules?: any;
  ruleset?: any;
  plu?: any;
};

/** Structure de la sélection terrain persistée */
type TerrainSelection = {
  version: "v1";
  updated_at: string;
  commune_insee: string;
  parcel_ids: string[];
  parcels: { parcel_id: string; area_m2: number | null }[];
  surface_totale_m2: number;
  focus_parcel_id: string | null;
};

/** Structure du handoff cross-pages v1 */
type SelectedParcelsHandoff = {
  parcel_ids: string[];
  primary_parcel_id: string | null;
  commune_insee: string | null;
  updated_at: string;
};

const LS_KEY = "mimmoza_promoteur_foncier_query_v1";
const LS_TERRAIN_KEY = "mimmoza_promoteur_terrain_selection_v1";
const LS_SELECTED_PARCELS_V1 = "mimmoza.promoteur.selected_parcels_v1";

function safeParse(raw: string | null) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function pretty(v: any) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function extractKpis(payload: any) {
  const zone_code = payload?.plu?.zone?.zone_code ?? payload?.plu?.zone_code ?? payload?.zone_code ?? "—";
  const zone_libelle =
    payload?.plu?.zone?.zone_libelle ?? payload?.plu?.zone_libelle ?? payload?.zone_libelle ?? "—";

  const ruleset =
    payload?.plu?.ruleset ??
    payload?.ruleset ??
    payload?.plu?.rules ??
    payload?.rules ??
    null;

  const reculs =
    ruleset?.reculs ??
    ruleset?.implantation?.reculs ??
    ruleset?.implantation ??
    null;

  const hauteur =
    ruleset?.hauteur ??
    ruleset?.gabarit?.hauteur ??
    ruleset?.gabarit ??
    null;

  const parking =
    ruleset?.parking ??
    ruleset?.stationnement ??
    ruleset?.stationnement_min ??
    null;

  return { zone_code, zone_libelle, reculs, hauteur, parking };
}

async function extractSupabaseErrorMessage(err: any): Promise<string> {
  if (!err) return "Erreur inconnue.";

  const ctx = err?.context;

  if (ctx && typeof ctx.text === "function") {
    try {
      const bodyText = await ctx.text();
      if (!bodyText) return err?.message ?? "Erreur serveur (réponse vide).";

      try {
        const parsed = JSON.parse(bodyText);
        const msg =
          parsed?.error ??
          parsed?.message ??
          parsed?.details ??
          parsed?.hint ??
          null;
        if (msg) return typeof msg === "string" ? msg : pretty(msg);
        return pretty(parsed);
      } catch {
        return bodyText;
      }
    } catch {
      return err?.message ?? "Erreur lors de la lecture de la réponse.";
    }
  }

  if (ctx) {
    const msg = ctx.message ?? ctx.error ?? ctx.details ?? ctx.hint ?? ctx.code ?? null;
    if (msg) return typeof msg === "string" ? msg : pretty(msg);
    return pretty(ctx);
  }

  const details = err?.details ?? err?.hint ?? err?.code ?? null;
  if (details) return typeof details === "string" ? details : pretty(details);

  if (err?.message) return String(err.message);

  return pretty(err);
}

function extractCommuneInsee(parcelId: string): string | null {
  if (!parcelId || parcelId.length < 5) return null;
  const insee = parcelId.substring(0, 5);
  if (!/^\d{5}$/.test(insee)) return null;
  return insee;
}

function extractZoneCodeFromAny(payload: any): string | null {
  const z =
    payload?.plu?.zone?.zone_code ??
    payload?.plu?.zone_code ??
    payload?.zone_code ??
    payload?.zone?.zone_code ??
    null;

  if (!z) return null;
  const zone = String(z).trim().toUpperCase();
  return zone || null;
}

function extractCommuneInseeFromAny(payload: any, fallbackParcelId?: string): string | null {
  const c =
    payload?.commune_insee ??
    payload?.plu?.commune_insee ??
    payload?.parcel?.commune_insee ??
    payload?.parcel?.code_insee ??
    null;

  if (c && /^\d{5}$/.test(String(c))) return String(c);

  if (fallbackParcelId) {
    const insee = extractCommuneInsee(fallbackParcelId);
    if (insee) return insee;
  }

  return null;
}

/**
 * Formate une surface en m² avec séparateur de milliers.
 */
function formatAreaM2(area: number | null | undefined): string {
  if (area == null) return "—";
  return area.toLocaleString("fr-FR") + " m²";
}

/** Type étendu pour les parcelles sélectionnées avec surface */
type SelectedParcel = {
  id: string;
  feature?: any;
  area_m2?: number | null;
};

/**
 * Persiste la sélection de parcelles dans les clés de session et handoff.
 * Ne fait rien si aucune parcelle ou pas de communeInsee.
 */
function persistPromoteurSessionAndHandoff(params: {
  parcelIds: string[];
  focusParcelId: string | null;
  communeInsee: string | null;
  address: string;
}): boolean {
  const { parcelIds, focusParcelId, communeInsee, address } = params;

  // Guard: ne jamais écrire une valeur vide
  if (parcelIds.length === 0 || !communeInsee) {
    return false;
  }

  // Définir la parcelle principale
  const primaryParcelId = focusParcelId || parcelIds[0] || null;

  try {
    // 1) Écrire la clé handoff v1
    const handoff: SelectedParcelsHandoff = {
      parcel_ids: parcelIds,
      primary_parcel_id: primaryParcelId,
      commune_insee: communeInsee,
      updated_at: new Date().toISOString(),
    };
    localStorage.setItem(LS_SELECTED_PARCELS_V1, JSON.stringify(handoff));

    // 2) Synchroniser les clés session existantes (sans écraser avec des vides)
    if (primaryParcelId) {
      localStorage.setItem("mimmoza.session.parcel_id", primaryParcelId);
    }
    if (communeInsee) {
      localStorage.setItem("mimmoza.session.commune_insee", communeInsee);
      localStorage.setItem("mimmoza.plu.last_commune_insee", communeInsee);
    }
    const trimmedAddress = address.trim();
    if (trimmedAddress) {
      localStorage.setItem("mimmoza.session.address", trimmedAddress);
    }

    console.log("[Foncier] persistPromoteurSessionAndHandoff:", {
      handoff,
      primary_parcel_id: primaryParcelId,
      commune_insee: communeInsee,
      address: trimmedAddress || "(empty)",
    });

    return true;
  } catch (e) {
    console.error("[Foncier] persistPromoteurSessionAndHandoff failed:", e);
    return false;
  }
}

export default function Foncier(): React.ReactElement {
  const [address, setAddress] = useState("");
  const [parcelId, setParcelId] = useState("");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<PluLookupResult | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  // --- Carte et sélection multi-parcelles ---
  const [showMap, setShowMap] = useState(false);
  const [selectedParcels, setSelectedParcels] = useState<SelectedParcel[]>([]);

  // --- Feedback "Sélection enregistrée" ---
  const [savedOk, setSavedOk] = useState(false);
  const savedOkTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const communeInsee = useMemo(() => {
    if (res?.commune_insee) return res.commune_insee;
    if (res?.parcel?.commune_insee) return res.parcel.commune_insee;

    const pid = parcelId.trim();
    if (pid) return extractCommuneInsee(pid);

    return null;
  }, [res, parcelId]);

  const mapCenter = useMemo(() => {
    const centroid = res?.parcel?.centroid;
    if (centroid?.lat != null && centroid?.lon != null) {
      return { lat: centroid.lat, lon: centroid.lon };
    }
    return null;
  }, [res]);

  // ID de la parcelle "focus" pour centrage automatique
  const focusParcelId = useMemo(() => {
    return (res?.parcel_id ?? res?.parcel?.parcel_id ?? parcelId.trim()) || null;
  }, [res, parcelId]);

  // Total cumulé des surfaces
  const totalAreaM2 = useMemo(() => {
    let total = 0;
    let hasAny = false;
    for (const p of selectedParcels) {
      if (p.area_m2 != null) {
        total += p.area_m2;
        hasAny = true;
      }
    }
    return hasAny ? total : null;
  }, [selectedParcels]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Persistance TerrainSelection dans localStorage
  // ─────────────────────────────────────────────────────────────────────────────
  const saveTerrainSelection = useCallback(() => {
    if (!communeInsee || selectedParcels.length === 0) {
      return false;
    }

    const terrainSelection: TerrainSelection = {
      version: "v1",
      updated_at: new Date().toISOString(),
      commune_insee: communeInsee,
      parcel_ids: selectedParcels.map((p) => p.id),
      parcels: selectedParcels.map((p) => ({
        parcel_id: p.id,
        area_m2: p.area_m2 ?? null,
      })),
      surface_totale_m2: totalAreaM2 ?? 0,
      focus_parcel_id: focusParcelId,
    };

    try {
      localStorage.setItem(LS_TERRAIN_KEY, JSON.stringify(terrainSelection));
      console.log("[Foncier] TerrainSelection saved:", terrainSelection);
      return true;
    } catch (e) {
      console.error("[Foncier] Failed to save TerrainSelection:", e);
      return false;
    }
  }, [communeInsee, selectedParcels, totalAreaM2, focusParcelId]);

  // Auto-save à chaque changement de selectedParcels (si communeInsee défini)
  // + auto-persist handoff v1
  useEffect(() => {
    if (communeInsee && selectedParcels.length > 0) {
      saveTerrainSelection();

      // Également persister le handoff v1 pour cross-pages
      persistPromoteurSessionAndHandoff({
        parcelIds: selectedParcels.map((p) => p.id),
        focusParcelId,
        communeInsee,
        address,
      });
    }
  }, [selectedParcels, communeInsee, saveTerrainSelection, focusParcelId, address]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Bouton "Utiliser cette sélection"
  // ─────────────────────────────────────────────────────────────────────────────
  const handleUseSelection = () => {
    const success = saveTerrainSelection();
    if (success) {
      // ─────────────────────────────────────────────────────────────────────────
      // Persistance session + handoff standardisée pour PLU & Faisabilité / Implantation 2D
      // ─────────────────────────────────────────────────────────────────────────
      persistPromoteurSessionAndHandoff({
        parcelIds: selectedParcels.map((p) => p.id),
        focusParcelId,
        communeInsee,
        address,
      });
      // ─────────────────────────────────────────────────────────────────────────

      setSavedOk(true);

      // Clear previous timeout if any
      if (savedOkTimeoutRef.current) {
        clearTimeout(savedOkTimeoutRef.current);
      }

      // Hide message after 3 seconds
      savedOkTimeoutRef.current = setTimeout(() => {
        setSavedOk(false);
      }, 3000);
    }
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (savedOkTimeoutRef.current) {
        clearTimeout(savedOkTimeoutRef.current);
      }
    };
  }, []);

  // ─────────────────────────────────────────────────────────────────────────────
  // AUTO-PERSISTENCE session parcelle (non intrusive)
  // Écrit dès que focusParcelId + communeInsee disponibles, sans UI feedback
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    // Guard clauses
    if (!focusParcelId || !communeInsee) return;

    try {
      // Lire les valeurs actuelles pour éviter des écritures inutiles
      const currentParcelId = localStorage.getItem("mimmoza.session.parcel_id");
      const currentCommune = localStorage.getItem("mimmoza.session.commune_insee");
      const currentAddress = localStorage.getItem("mimmoza.session.address");
      const trimmedAddress = address.trim();

      let changed = false;

      if (currentParcelId !== focusParcelId) {
        localStorage.setItem("mimmoza.session.parcel_id", focusParcelId);
        changed = true;
      }

      if (currentCommune !== communeInsee) {
        localStorage.setItem("mimmoza.session.commune_insee", communeInsee);
        localStorage.setItem("mimmoza.plu.last_commune_insee", communeInsee);
        changed = true;
      }

      if (trimmedAddress && currentAddress !== trimmedAddress) {
        localStorage.setItem("mimmoza.session.address", trimmedAddress);
        changed = true;
      }

      // Également mettre à jour le handoff v1 si on a des parcelles
      if (changed && selectedParcels.length > 0) {
        persistPromoteurSessionAndHandoff({
          parcelIds: selectedParcels.map((p) => p.id),
          focusParcelId,
          communeInsee,
          address,
        });
      }

      if (changed) {
        console.log("[Foncier] Auto-persisted session:", {
          parcel_id: focusParcelId,
          commune_insee: communeInsee,
          address: trimmedAddress || "(empty)",
        });
      }
    } catch (e) {
      // Silently ignore localStorage errors
      console.warn("[Foncier] Auto-persistence failed:", e);
    }
  }, [focusParcelId, communeInsee, address, selectedParcels]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Restauration des états depuis localStorage (formulaire)
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const saved = safeParse(localStorage.getItem(LS_KEY));
    if (!saved) return;
    setAddress(String(saved.address ?? ""));
    setParcelId(String(saved.parcelId ?? ""));
    setShowDetails(Boolean(saved.showDetails ?? false));
    setShowMap(Boolean(saved.showMap ?? false));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({ address, parcelId, showDetails, showMap })
      );
    } catch {
      // ignore
    }
  }, [address, parcelId, showDetails, showMap]);

  const kpis = useMemo(() => {
    if (!res) return null;
    return extractKpis(res);
  }, [res]);

  const reset = () => {
    setErr(null);
    setRes(null);
    setShowDetails(false);
    setSelectedParcels([]);
    setShowMap(false);
    setSavedOk(false);
  };

  useEffect(() => {
    if (!res) return;
    if (res.success === false) return;

    const pid = (res.parcel_id ?? res.parcel?.parcel_id ?? parcelId.trim()) || "";
    if (!pid) return;

    setSelectedParcels((prev) => {
      if (prev.some((p) => p.id === pid)) return prev;
      return [{ id: pid, feature: res.parcel?.geojson ?? res.parcel?.geometry ?? null, area_m2: null }, ...prev];
    });
  }, [res, parcelId]);

  const handleToggleParcel = useCallback((pid: string, feature: any, area_m2: number | null) => {
    setSelectedParcels((prev) => {
      const exists = prev.find((p) => p.id === pid);
      if (exists) return prev.filter((p) => p.id !== pid);
      return [...prev, { id: pid, feature, area_m2 }];
    });
  }, []);

  const handleRemoveParcel = (pid: string) => {
    setSelectedParcels((prev) => prev.filter((p) => p.id !== pid));
  };

  const handleClearSelection = () => setSelectedParcels([]);

  // Callback pour auto-enrichir les parcelles sélectionnées avec leur surface
  const handleAutoEnrichSelected = useCallback((updates: { id: string; area_m2: number | null }[]) => {
    if (updates.length === 0) return;

    setSelectedParcels((prev) => {
      const updateMap = new Map(updates.map((u) => [u.id, u.area_m2]));
      let changed = false;

      const next = prev.map((p) => {
        // Enrichir seulement si area_m2 manquant
        if (p.area_m2 == null && updateMap.has(p.id)) {
          changed = true;
          return { ...p, area_m2: updateMap.get(p.id) };
        }
        return p;
      });

      return changed ? next : prev;
    });
  }, []);

  const runLookup = async () => {
    setErr(null);
    setRes(null);
    setLoading(true);
    setSavedOk(false);

    try {
      const pid = parcelId.trim();
      const addr = address.trim();

      if (!pid && !addr) {
        setErr("Renseigne une adresse ou un identifiant de parcelle.");
        return;
      }

      // 1) Réponse "base" (parcelle + zone) via les fonctions existantes
      let base: any = null;

      if (pid) {
        const commune_insee = extractCommuneInsee(pid);

        if (!commune_insee) {
          setErr(
            `ID parcelle invalide : "${pid}".\n` +
              `L'identifiant doit commencer par 5 chiffres (code INSEE commune).\n` +
              `Exemple : 64065000AI0001 → INSEE 64065`
          );
          return;
        }

        const payload = { parcel_id: pid, commune_insee };

        // PATCH: Essayer v2 en premier, fallback sur v1
        const r1 = await supabase.functions.invoke("plu-from-parcelle-v2", { body: payload });
        if (!r1.error) {
          base = r1.data ?? null;
        } else {
          const r2 = await supabase.functions.invoke("plu-from-parcelle", { body: payload });
          if (r2.error) throw r2.error;
          base = r2.data ?? null;
        }
      } else {
        const r = await supabase.functions.invoke("plu-from-address", { body: { address: addr } });
        if (r.error) throw r.error;
        base = r.data ?? null;
      }

      if (!base) {
        setErr("Réponse vide du backend.");
        return;
      }

      // 2) Enrichissement PLU: récupérer le ruleset via foncier-lookup-v1 (commune + zone)
      // TEMP: désactivé à cause du CORS (header x-client-info rejeté)
      // Réactiver ENABLE_FONCIER_LOOKUP_ENRICH quand la function sera corrigée côté backend
      const ci = extractCommuneInseeFromAny(base, pid || undefined);
      const zc = extractZoneCodeFromAny(base);

      if (ENABLE_FONCIER_LOOKUP_ENRICH && ci && zc) {
        const rPlu = await supabase.functions.invoke("foncier-lookup-v1", {
          body: { commune_insee: ci, zone_code: zc },
        });

        // Si ça échoue: on garde "base" (zone affichable)
        if (!rPlu.error && rPlu.data?.success) {
          const pluData = rPlu.data;

          base = {
            ...base,
            zone_code: base.zone_code ?? pluData.zone_code,
            zone_libelle: base.zone_libelle ?? pluData.zone_libelle,
            ruleset: pluData.ruleset ?? base.ruleset,
            plu: {
              ...(base.plu ?? {}),
              zone_code: base.plu?.zone_code ?? pluData.zone_code,
              zone_libelle: base.plu?.zone_libelle ?? pluData.zone_libelle,
              ruleset: pluData.ruleset ?? base.plu?.ruleset,
              normalized: pluData.normalized ?? base.plu?.normalized,
            },
          };
        }
      }

      setRes(base as any);
      setShowMap(true);
    } catch (e: any) {
      const errorMessage = await extractSupabaseErrorMessage(e);
      setErr(errorMessage);
      console.log("[FONCIER] lookup exception:", e);
    } finally {
      setLoading(false);
    }
  };

  const canUseSelection = selectedParcels.length > 0 && communeInsee != null;

  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>
      <h2 style={{ margin: "0 0 8px", color: "#0f172a" }}>Foncier</h2>
      <p style={{ margin: "0 0 18px", color: "#475569" }}>
        Recherche terrain : adresse ou parcelle → parcelle(s) + zone PLU (prévisualisation).
      </p>

      <div style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: 16, background: "#ffffff" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 6 }}>Adresse (option)</div>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="ex: 12 rue X, 64310 Ascain"
              style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #e2e8f0", outline: "none", fontSize: 14 }}
            />
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
              Appelle <code>plu-from-address</code> puis enrichit via <code>foncier-lookup-v1</code>.
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 6 }}>ID Parcelle (prioritaire)</div>
            <input
              value={parcelId}
              onChange={(e) => setParcelId(e.target.value)}
              placeholder="ex: 64065000AI0002"
              style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #e2e8f0", outline: "none", fontSize: 14 }}
            />
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
              Appelle <code>plu-from-parcelle-v2</code> (fallback sur <code>plu-from-parcelle</code>) puis enrichit via <code>foncier-lookup-v1</code>.
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          <button
            onClick={runLookup}
            disabled={loading}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #0f172a",
              background: "#0f172a",
              color: "white",
              fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.65 : 1,
            }}
          >
            {loading ? "Recherche..." : "Trouver parcelle + PLU"}
          </button>

          <button
            onClick={reset}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #e2e8f0",
              background: "white",
              color: "#0f172a",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Réinitialiser
          </button>

          <button
            onClick={() => setShowDetails((v) => !v)}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #e2e8f0",
              background: "white",
              color: "#334155",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {showDetails ? "Masquer détails" : "Afficher détails"}
          </button>

          <button
            onClick={() => setShowMap((v) => !v)}
            disabled={!communeInsee}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #3b82f6",
              background: showMap ? "#3b82f6" : "white",
              color: showMap ? "white" : "#3b82f6",
              fontWeight: 700,
              cursor: communeInsee ? "pointer" : "not-allowed",
              opacity: communeInsee ? 1 : 0.5,
            }}
          >
            {showMap ? "Masquer carte" : "Afficher carte"}
          </button>
        </div>

        {err && (
          <div
            style={{
              marginTop: 14,
              padding: 12,
              borderRadius: 10,
              background: "#fef2f2",
              border: "1px solid #fecaca",
              color: "#991b1b",
              fontSize: 13,
              fontWeight: 600,
              whiteSpace: "pre-wrap",
            }}
          >
            {err}
          </div>
        )}

        {res && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12 }}>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 800, textTransform: "uppercase" }}>
                  Parcelle / Commune
                </div>
                <div style={{ marginTop: 6, fontSize: 13, fontWeight: 800, color: "#0f172a" }}>
                  {res.parcel_id ?? res.parcel?.parcel_id ?? "—"}
                </div>
                <div style={{ marginTop: 4, fontSize: 12, color: "#475569" }}>
                  {res.commune_nom ?? res.parcel?.nom_com ?? "—"} — INSEE {res.commune_insee ?? res.parcel?.commune_insee ?? "—"}
                </div>
              </div>

              <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12 }}>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 800, textTransform: "uppercase" }}>
                  Zone PLU
                </div>
                <div style={{ marginTop: 6, fontSize: 18, fontWeight: 800, color: "#0f172a" }}>
                  {kpis?.zone_code ?? "—"}
                </div>
                <div style={{ marginTop: 4, fontSize: 12, color: "#475569" }}>
                  {kpis?.zone_libelle ?? "—"}
                </div>
              </div>
            </div>

            {showDetails && (
              <div
                style={{
                  marginTop: 12,
                  borderRadius: 12,
                  border: "1px solid #0f172a",
                  background: "#0b1220",
                  color: "#e2e8f0",
                  padding: 12,
                  overflow: "auto",
                  maxHeight: 400,
                }}
              >
                <pre style={{ margin: 0, fontSize: 12, whiteSpace: "pre-wrap" }}>
                  {pretty(res)}
                </pre>
              </div>
            )}
          </div>
        )}

        {showMap && communeInsee && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 14 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 8 }}>
                  Carte cadastrale — Cliquez pour sélectionner/désélectionner
                </div>

                <ParcelMapSelector
                  communeInsee={communeInsee}
                  selectedIds={selectedParcels.map((p) => p.id)}
                  onToggleParcel={handleToggleParcel}
                  initialCenter={mapCenter}
                  initialZoom={17}
                  focusParcelId={focusParcelId}
                  onAutoEnrichSelected={handleAutoEnrichSelected}
                />
              </div>

              <div
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 12,
                  padding: 12,
                  background: "#f8fafc",
                  maxHeight: 440,
                  overflow: "auto",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>Parcelles sélectionnées ({selectedParcels.length})</span>
                  {selectedParcels.length > 0 && (
                    <button
                      onClick={handleClearSelection}
                      style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #e2e8f0", background: "white", color: "#64748b", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                    >
                      Vider
                    </button>
                  )}
                </div>

                {selectedParcels.length === 0 ? (
                  <div style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic" }}>
                    Aucune parcelle sélectionnée.
                    <br />
                    Cliquez sur la carte pour en ajouter.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                    {selectedParcels.map((p) => (
                      <div
                        key={p.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "8px 10px",
                          borderRadius: 8,
                          background: "white",
                          border: "1px solid #e2e8f0",
                        }}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: "#0f172a", fontFamily: "monospace" }}>
                            {p.id}
                          </span>
                          <span style={{ fontSize: 11, color: "#64748b" }}>
                            {formatAreaM2(p.area_m2)}
                          </span>
                        </div>
                        <button
                          onClick={() => handleRemoveParcel(p.id)}
                          style={{ padding: "2px 8px", borderRadius: 4, border: "1px solid #fecaca", background: "#fef2f2", color: "#dc2626", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Total cumulé */}
                {selectedParcels.length > 0 && (
                  <div
                    style={{
                      marginTop: 12,
                      paddingTop: 10,
                      borderTop: "1px solid #e2e8f0",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#334155" }}>
                      Surface totale
                    </span>
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 800,
                        color: "#0f172a",
                        background: "#e0f2fe",
                        padding: "4px 10px",
                        borderRadius: 6,
                      }}
                    >
                      {formatAreaM2(totalAreaM2)}
                    </span>
                  </div>
                )}

                {/* Bouton "Utiliser cette sélection" */}
                <div style={{ marginTop: 14 }}>
                  <button
                    onClick={handleUseSelection}
                    disabled={!canUseSelection}
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      borderRadius: 8,
                      border: "1px solid #10b981",
                      background: canUseSelection ? "#10b981" : "#e2e8f0",
                      color: canUseSelection ? "white" : "#94a3b8",
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: canUseSelection ? "pointer" : "not-allowed",
                      transition: "background 0.15s",
                    }}
                  >
                    ✓ Utiliser cette sélection
                  </button>

                  {/* Message de confirmation */}
                  {savedOk && (
                    <div
                      style={{
                        marginTop: 8,
                        padding: "8px 10px",
                        borderRadius: 6,
                        background: "#ecfdf5",
                        border: "1px solid #a7f3d0",
                        color: "#065f46",
                        fontSize: 11,
                        fontWeight: 600,
                        textAlign: "center",
                      }}
                    >
                      ✓ Sélection enregistrée — vous pouvez aller à PLU & Faisabilité / Implantation 2D
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <p style={{ marginTop: 12, color: "#64748b", fontSize: 12 }}>
        Étape suivante : consultez "PLU & Faisabilité" pour les règles détaillées ou "Implantation 2D" pour dessiner votre projet.
      </p>
    </div>
  );
}