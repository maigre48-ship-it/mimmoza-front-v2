import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../../../supabaseClient";
import ParcelMapSelector from "../foncier/ParcelMapSelector";

// ✅ Hook réutilisable pour la sélection foncière
import { useFoncierSelection, extractCommuneInsee } from "../shared/hooks/useFoncierSelection";

// ✅ Snapshot store (existe déjà)
import { patchPromoteurSnapshot, patchModule } from "../shared/promoteurSnapshot.store";

// TEMP: désactivé à cause du CORS (header x-client-info rejeté par foncier-lookup-v1)
const ENABLE_FONCIER_LOOKUP_ENRICH = false;

/** Centre par défaut (Paris) quand aucune commune n'est connue */
const DEFAULT_MAP_CENTER = { lat: 48.8566, lon: 2.3522 };
const DEFAULT_MAP_ZOOM = 6;

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

/** Structure d'une étude dans le Dashboard */
type PromoteurStudy = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  parcel_count: number;
  total_surface_m2: number;
  commune_insee: string | null;
  steps_status: {
    foncier: "pending" | "done";
    plu: "pending" | "done";
    marche: "pending" | "done";
    risques: "pending" | "done";
    bilan: "pending" | "done";
    implantation: "pending" | "done";
  };
  last_opened_step: string | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Clés localStorage (formulaire uniquement)
// ─────────────────────────────────────────────────────────────────────────────
const LS_KEY = "mimmoza_promoteur_foncier_query_v1";
const LS_STUDIES_KEY = "mimmoza.promoteur.studies.v1";

function safeParse<T = any>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
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

function formatAreaM2(area: number | null | undefined): string {
  if (area == null) return "—";
  return area.toLocaleString("fr-FR") + " m²";
}

/**
 * Met à jour une étude dans la liste des études du Dashboard.
 */
function updateStudyInDashboard(params: {
  studyId: string;
  parcelCount: number;
  totalSurfaceM2: number;
  communeInsee: string | null;
  communeNom?: string | null;
}): boolean {
  const { studyId, parcelCount, totalSurfaceM2, communeInsee, communeNom } = params;

  try {
    const raw = localStorage.getItem(LS_STUDIES_KEY);
    let studies: PromoteurStudy[] = safeParse<PromoteurStudy[]>(raw) ?? [];

    const idx = studies.findIndex((s) => s.id === studyId);
    const now = new Date().toISOString();

    if (idx >= 0) {
      const study = studies[idx];
      study.parcel_count = parcelCount;
      study.total_surface_m2 = totalSurfaceM2;
      study.commune_insee = communeInsee;
      study.updated_at = now;
      study.steps_status = { ...study.steps_status, foncier: "done" };
      study.last_opened_step = "plu";

      if (study.name.startsWith("Nouvelle étude —") && communeInsee) {
        const displayName = communeNom || `Commune ${communeInsee}`;
        study.name = `${displayName} — ${communeInsee}`;
      }

      studies[idx] = study;
    } else {
      const displayName = communeNom || (communeInsee ? `Commune ${communeInsee}` : "Nouvelle étude");
      const newStudy: PromoteurStudy = {
        id: studyId,
        name: communeInsee ? `${displayName} — ${communeInsee}` : displayName,
        created_at: now,
        updated_at: now,
        parcel_count: parcelCount,
        total_surface_m2: totalSurfaceM2,
        commune_insee: communeInsee,
        steps_status: {
          foncier: "done",
          plu: "pending",
          marche: "pending",
          risques: "pending",
          bilan: "pending",
          implantation: "pending",
        },
        last_opened_step: "plu",
      };
      studies.push(newStudy);
    }

    localStorage.setItem(LS_STUDIES_KEY, JSON.stringify(studies));
    return true;
  } catch (e) {
    console.error("[Foncier] updateStudyInDashboard failed:", e);
    return false;
  }
}

/**
 * Placeholder pour la carte quand aucune commune n'est connue.
 */
function EmptyMapPlaceholder(): React.ReactElement {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: 400,
        borderRadius: 12,
        overflow: "hidden",
        border: "1px solid #e2e8f0",
        background: "#f1f5f9",
      }}
    >
      <iframe
        title="Carte France"
        src="https://www.openstreetmap.org/export/embed.html?bbox=-5.5,41.3,10.0,51.2&layer=mapnik"
        style={{
          width: "100%",
          height: "100%",
          border: "none",
          filter: "grayscale(30%) opacity(0.7)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(255,255,255,0.85)",
          backdropFilter: "blur(2px)",
        }}
      >
        <div
          style={{
            textAlign: "center",
            padding: "24px 32px",
            background: "white",
            borderRadius: 12,
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            maxWidth: 400,
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 12 }}>🗺️</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>
            Aucune parcelle sélectionnée
          </div>
          <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.5 }}>
            Renseignez une <strong>adresse</strong> ou un <strong>identifiant de parcelle</strong> ci-dessus,
            puis cliquez sur <em>"Trouver parcelle + PLU"</em> pour afficher le cadastre.
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Foncier(): React.ReactElement {
  // ─────────────────────────────────────────────────────────────────────────────
  // Query params
  // ─────────────────────────────────────────────────────────────────────────────
  const [searchParams] = useSearchParams();
  const hasStudyParam = searchParams.has("study");
  const studyId = searchParams.get("study");

  // ─────────────────────────────────────────────────────────────────────────────
  // Formulaire state
  // ─────────────────────────────────────────────────────────────────────────────
  const [address, setAddress] = useState("");
  const [parcelId, setParcelId] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<PluLookupResult | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showMap, setShowMap] = useState(hasStudyParam);

  // ─────────────────────────────────────────────────────────────────────────────
  // ✅ Hook foncier selection (source de vérité)
  // ─────────────────────────────────────────────────────────────────────────────
  const {
    selectedParcels,
    communeInsee: hookCommuneInsee,
    focusParcelId: hookFocusParcelId,
    totalAreaM2,
    toggleParcel,
    clearSelection,
    setSelectedParcels,
    setFocusParcelId,
    setCommuneInsee,
    enrichParcels,
    persistNow,
    isHydrated,
  } = useFoncierSelection({
    studyId,
    address,
    autoPersist: true,
    debounceMs: 300,
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Feedback "Sélection enregistrée"
  // ─────────────────────────────────────────────────────────────────────────────
  const [savedOk, setSavedOk] = useState(false);
  const savedOkTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─────────────────────────────────────────────────────────────────────────────
  // ✅ Guard ref pour auto-lookup (évite les boucles infinies)
  // ─────────────────────────────────────────────────────────────────────────────
  const autoLookupDoneRef = useRef(false);

  // ─────────────────────────────────────────────────────────────────────────────
  // ✅ Guard ref pour auto-update Dashboard (évite writes redondants)
  // ─────────────────────────────────────────────────────────────────────────────
  const lastDashboardWriteHashRef = useRef<string | null>(null);

  // ─────────────────────────────────────────────────────────────────────────────
  // Computed values
  // ─────────────────────────────────────────────────────────────────────────────
  const communeInsee = useMemo(() => {
    if (res?.commune_insee) return res.commune_insee;
    if (res?.parcel?.commune_insee) return res.parcel.commune_insee;
    if (hookCommuneInsee) return hookCommuneInsee;

    const pid = parcelId.trim();
    if (pid) return extractCommuneInsee(pid);

    if (selectedParcels.length > 0) {
      return extractCommuneInsee(selectedParcels[0].id);
    }

    return null;
  }, [res, parcelId, hookCommuneInsee, selectedParcels]);

  const communeNom = useMemo(() => {
    return res?.commune_nom ?? res?.parcel?.nom_com ?? null;
  }, [res]);

  const mapCenter = useMemo(() => {
    const centroid = res?.parcel?.centroid;
    if (centroid?.lat != null && centroid?.lon != null) {
      return { lat: centroid.lat, lon: centroid.lon };
    }
    return null;
  }, [res]);

  const focusParcelId = useMemo(() => {
    return (res?.parcel_id ?? res?.parcel?.parcel_id ?? hookFocusParcelId ?? parcelId.trim()) || null;
  }, [res, hookFocusParcelId, parcelId]);

  const kpis = useMemo(() => {
    if (!res) return null;
    return extractKpis(res);
  }, [res]);

  const effectiveCommuneInsee = communeInsee;
  const canUseSelection = selectedParcels.length > 0 && effectiveCommuneInsee != null;

  // ─────────────────────────────────────────────────────────────────────────────
  // Sync hook commune avec la response du lookup
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (res?.commune_insee && res.commune_insee !== hookCommuneInsee) {
      setCommuneInsee(res.commune_insee);
    }
  }, [res, hookCommuneInsee, setCommuneInsee]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Afficher carte automatiquement si sélection restaurée
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isHydrated && selectedParcels.length > 0 && hookCommuneInsee) {
      setShowMap(true);

      // Pré-remplir parcelId si on a un focusParcelId
      if (hookFocusParcelId && !parcelId) {
        setParcelId(hookFocusParcelId);
      }
    }
  }, [isHydrated, selectedParcels.length, hookCommuneInsee, hookFocusParcelId, parcelId]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Snapshot persistence helper
  // ─────────────────────────────────────────────────────────────────────────────
  const persistToSnapshot = useCallback((params: {
    effectiveCommuneInsee: string | null;
    parcelIds: string[];
    focusParcelId: string | null;
    address: string;
    totalAreaM2: number | null;
    res: PluLookupResult | null;
  }) => {
    try {
      const { effectiveCommuneInsee, parcelIds, focusParcelId, address, totalAreaM2, res } = params;
      if (!effectiveCommuneInsee || parcelIds.length === 0) return;

      patchPromoteurSnapshot({
        project: {
          address: address.trim() || undefined,
          commune_insee: effectiveCommuneInsee,
          parcelId: focusParcelId || parcelIds[0] || undefined,
          surfaceM2: totalAreaM2 ?? undefined,
        } as any,
      });

      patchModule("foncier" as any, {
        ok: true,
        summary: `Sélection foncière : ${parcelIds.length} parcelle(s) · Surface totale ${totalAreaM2 != null ? `${Math.round(totalAreaM2).toLocaleString("fr-FR")} m²` : "—"} · INSEE ${effectiveCommuneInsee}`,
        data: {
          commune_insee: effectiveCommuneInsee,
          parcel_ids: parcelIds,
          focus_parcel_id: focusParcelId,
          total_area_m2: totalAreaM2,
          address: address.trim() || null,
          zone_code: extractZoneCodeFromAny(res),
          kpis: res ? extractKpis(res) : null,
          raw: res,
        },
      } as any);
    } catch (e) {
      console.warn("[Foncier] snapshot persist failed:", e);
    }
  }, []);

  // ─────────────────────────────────────────────────────────────────────────────
  // Auto-persist snapshot when selection changes
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isHydrated) return;
    if (effectiveCommuneInsee && selectedParcels.length > 0) {
      persistToSnapshot({
        effectiveCommuneInsee,
        parcelIds: selectedParcels.map((p) => p.id),
        focusParcelId,
        address,
        totalAreaM2,
        res,
      });
    }
  }, [selectedParcels, effectiveCommuneInsee, focusParcelId, address, totalAreaM2, res, persistToSnapshot, isHydrated]);

  // ─────────────────────────────────────────────────────────────────────────────
  // ✅ AUTO-UPDATE DASHBOARD: Met à jour l'étude dès qu'une sélection existe
  // Idempotent via hash pour éviter les writes redondants
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    // Guards
    if (!studyId) return;
    if (!isHydrated) return;
    if (selectedParcels.length === 0) return;
    if (!effectiveCommuneInsee) return;

    // Calculer un hash simple pour détecter les changements réels
    const parcelCount = selectedParcels.length;
    const surfaceM2 = totalAreaM2 ?? 0;
    const hash = `${studyId}|${parcelCount}|${Math.round(surfaceM2)}|${effectiveCommuneInsee}`;

    // Éviter les writes redondants (idempotence)
    if (lastDashboardWriteHashRef.current === hash) return;

    // Mettre à jour le Dashboard
    const success = updateStudyInDashboard({
      studyId,
      parcelCount,
      totalSurfaceM2: surfaceM2,
      communeInsee: effectiveCommuneInsee,
      communeNom,
    });

    if (success) {
      lastDashboardWriteHashRef.current = hash;
      console.log("[Foncier] Auto-updated dashboard study:", hash);
    }
  }, [studyId, isHydrated, selectedParcels.length, totalAreaM2, effectiveCommuneInsee, communeNom]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Bouton "Utiliser cette sélection"
  // ─────────────────────────────────────────────────────────────────────────────
  const handleUseSelection = () => {
    const success = persistNow();
    if (success && effectiveCommuneInsee) {
      persistToSnapshot({
        effectiveCommuneInsee,
        parcelIds: selectedParcels.map((p) => p.id),
        focusParcelId,
        address,
        totalAreaM2,
        res,
      });

      if (studyId) {
        updateStudyInDashboard({
          studyId,
          parcelCount: selectedParcels.length,
          totalSurfaceM2: totalAreaM2 ?? 0,
          communeInsee: effectiveCommuneInsee,
          communeNom,
        });
      }

      setSavedOk(true);

      if (savedOkTimeoutRef.current) {
        clearTimeout(savedOkTimeoutRef.current);
      }

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
  // Restauration formulaire depuis localStorage
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const saved = safeParse(localStorage.getItem(LS_KEY));
    if (!saved) return;
    setAddress(String(saved.address ?? ""));
    if (!parcelId) {
      setParcelId(String(saved.parcelId ?? ""));
    }
    setShowDetails(Boolean(saved.showDetails ?? false));
    if (!showMap) {
      setShowMap(Boolean(saved.showMap ?? false));
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ address, parcelId, showDetails, showMap }));
    } catch {
      // ignore
    }
  }, [address, parcelId, showDetails, showMap]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Reset
  // ─────────────────────────────────────────────────────────────────────────────
  const reset = () => {
    setErr(null);
    setRes(null);
    setShowDetails(false);
    clearSelection();
    setSavedOk(false);
    // Reset auto-lookup guard pour permettre un nouveau lookup après reset
    autoLookupDoneRef.current = false;
    // Reset dashboard write hash
    lastDashboardWriteHashRef.current = null;

    try {
      patchModule("foncier" as any, {
        ok: false,
        summary: "Sélection foncière réinitialisée.",
        data: null,
      } as any);
    } catch {
      // ignore
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Ajouter parcelle depuis lookup response
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!res) return;
    if (res.success === false) return;

    const pid = (res.parcel_id ?? res.parcel?.parcel_id ?? parcelId.trim()) || "";
    if (!pid) return;

    setSelectedParcels((prev) => {
      if (prev.some((p) => p.id === pid)) {
        // ✅ Parcelle existe déjà, mais on doit mettre à jour la feature si elle manque
        return prev.map((p) => {
          if (p.id === pid && !p.feature) {
            const feature = res.parcel?.geojson ?? res.parcel?.geometry ?? null;
            if (feature) {
              return { ...p, feature };
            }
          }
          return p;
        });
      }
      return [{ id: pid, feature: res.parcel?.geojson ?? res.parcel?.geometry ?? null, area_m2: null }, ...prev];
    });

    // Mettre à jour focusParcelId
    setFocusParcelId(pid);
  }, [res, parcelId, setSelectedParcels, setFocusParcelId]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Handlers
  // ─────────────────────────────────────────────────────────────────────────────
  const handleToggleParcel = useCallback((pid: string, feature: any, area_m2: number | null) => {
    toggleParcel(pid, feature, area_m2);
  }, [toggleParcel]);

  const handleRemoveParcel = (pid: string) => {
    setSelectedParcels((prev) => prev.filter((p) => p.id !== pid));
  };

  const handleClearSelection = () => clearSelection();

  const handleAutoEnrichSelected = useCallback((updates: { id: string; area_m2: number | null }[]) => {
    enrichParcels(updates);
  }, [enrichParcels]);

  // ─────────────────────────────────────────────────────────────────────────────
  // ✅ REFACTORISÉ: Lookup avec paramètres directs
  // Permet d'appeler le lookup sans dépendre du state (évite race conditions)
  // ─────────────────────────────────────────────────────────────────────────────
  const runLookupWith = useCallback(async (pidRaw: string, addrRaw: string, options?: { silent?: boolean }) => {
    const { silent = false } = options ?? {};

    if (!silent) {
      setErr(null);
      setRes(null);
      setLoading(true);
      setSavedOk(false);
    } else {
      setLoading(true);
    }

    try {
      const pid = pidRaw.trim();
      const addr = addrRaw.trim();

      if (!pid && !addr) {
        if (!silent) {
          setErr("Renseigne une adresse ou un identifiant de parcelle.");
        }
        return;
      }

      let base: any = null;

      if (pid) {
        const commune_insee = extractCommuneInsee(pid);

        if (!commune_insee) {
          if (!silent) {
            setErr(
              `ID parcelle invalide : "${pid}".\n` +
              `L'identifiant doit commencer par 5 chiffres (code INSEE commune).\n` +
              `Exemple : 75102000AB0123 → INSEE 75102`
            );
          }
          return;
        }

        const payload = { parcel_id: pid, commune_insee };

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
        if (!silent) {
          setErr("Réponse vide du backend.");
        }
        return;
      }

      const ci = extractCommuneInseeFromAny(base, pid || undefined);
      const zc = extractZoneCodeFromAny(base);

      if (ENABLE_FONCIER_LOOKUP_ENRICH && ci && zc) {
        const rPlu = await supabase.functions.invoke("foncier-lookup-v1", {
          body: { commune_insee: ci, zone_code: zc },
        });

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

      // Snapshot
      try {
        const inferredCommune = extractCommuneInseeFromAny(base, pid || undefined);
        const inferredParcelId = (base?.parcel_id ?? base?.parcel?.parcel_id ?? pid) || null;

        if (inferredCommune && inferredParcelId) {
          patchPromoteurSnapshot({
            project: {
              address: addr || undefined,
              commune_insee: inferredCommune,
              parcelId: inferredParcelId,
            } as any,
          });

          patchModule("foncier" as any, {
            ok: true,
            summary: `Lookup foncier OK · Parcelle ${inferredParcelId} · INSEE ${inferredCommune} · Zone ${extractZoneCodeFromAny(base) ?? "—"}`,
            data: {
              address: addr || null,
              commune_insee: inferredCommune,
              parcel_id: inferredParcelId,
              zone_code: extractZoneCodeFromAny(base),
              kpis: extractKpis(base),
              raw: base,
            },
          } as any);
        }
      } catch (e) {
        console.warn("[Foncier] snapshot persist after lookup failed:", e);
      }
    } catch (e: any) {
      const errorMessage = await extractSupabaseErrorMessage(e);
      if (!silent) {
        setErr(errorMessage);
      }
      console.log("[FONCIER] lookup exception:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  // ─────────────────────────────────────────────────────────────────────────────
  // Lookup depuis le bouton (utilise le state du formulaire)
  // ─────────────────────────────────────────────────────────────────────────────
  const runLookup = useCallback(() => {
    runLookupWith(parcelId.trim(), address.trim());
  }, [runLookupWith, parcelId, address]);

  // ─────────────────────────────────────────────────────────────────────────────
  // ✅ AUTO-LOOKUP: Récupère la géométrie au retour sur la page
  // Si on a une sélection restaurée (selectedParcels.length > 0) mais pas de res,
  // on lance automatiquement un lookup pour récupérer la feature/centroid.
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    // Guards
    if (!isHydrated) return;
    if (autoLookupDoneRef.current) return;
    if (res !== null) return; // Déjà un résultat
    if (selectedParcels.length === 0) return; // Pas de sélection à restaurer
    if (loading) return; // Déjà en cours

    // Déterminer l'ID de parcelle à lookup
    const pidToLookup = hookFocusParcelId || selectedParcels[0]?.id;
    if (!pidToLookup) return;

    // Vérifier que c'est un ID valide
    const insee = extractCommuneInsee(pidToLookup);
    if (!insee) return;

    // Marquer comme fait AVANT le lookup (évite les appels multiples)
    autoLookupDoneRef.current = true;

    console.log("[Foncier] Auto-lookup triggered for restored selection:", pidToLookup);

    // Pré-remplir le champ parcelId si vide
    if (!parcelId) {
      setParcelId(pidToLookup);
    }

    // Lancer le lookup en mode "silent" pour ne pas afficher d'erreur intrusive
    runLookupWith(pidToLookup, address.trim(), { silent: true });

  }, [isHydrated, res, selectedParcels, hookFocusParcelId, loading, parcelId, address, runLookupWith]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Reset du guard auto-lookup quand studyId change
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    autoLookupDoneRef.current = false;
  }, [studyId]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>
      <h2 style={{ margin: "0 0 8px", color: "#0f172a" }}>Foncier</h2>
      <p style={{ margin: "0 0 18px", color: "#475569" }}>
        Recherche terrain : adresse ou parcelle → parcelle(s) + zone PLU (prévisualisation).
        {studyId && (
          <span style={{ marginLeft: 8, fontSize: 11, color: "#64748b", background: "#f1f5f9", padding: "2px 6px", borderRadius: 4 }}>
            Étude: {studyId.slice(0, 8)}…
          </span>
        )}
      </p>

      <div style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: 16, background: "#ffffff" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 6 }}>Adresse (option)</div>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="ex: 10 rue de la Paix, 75002 Paris"
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
              placeholder="ex: 75102000AB0123"
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
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #3b82f6",
              background: showMap ? "#3b82f6" : "white",
              color: showMap ? "white" : "#3b82f6",
              fontWeight: 700,
              cursor: "pointer",
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

        {showMap && (
          <div style={{ marginTop: 16 }}>
            {effectiveCommuneInsee ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 14 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 8 }}>
                    Carte cadastrale — Cliquez pour sélectionner/désélectionner
                  </div>

                  <ParcelMapSelector
                    communeInsee={effectiveCommuneInsee}
                    selectedIds={selectedParcels.map((p) => p.id)}
                    selectedParcels={selectedParcels}
                    onToggleParcel={handleToggleParcel}
                    initialCenter={mapCenter ?? DEFAULT_MAP_CENTER}
                    initialZoom={mapCenter ? 17 : DEFAULT_MAP_ZOOM}
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
            ) : (
              <EmptyMapPlaceholder />
            )}
          </div>
        )}
      </div>

      <p style={{ marginTop: 12, color: "#64748b", fontSize: 12 }}>
        Étape suivante : consultez "PLU & Faisabilité" pour les règles détaillées ou "Implantation 2D" pour dessiner votre projet.
      </p>
    </div>
  );
}