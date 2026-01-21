// src/spaces/promoteur/components/PluUploaderPanel.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "../../../lib/supabaseClient";

type CommuneGeo = {
  nom: string;
  code: string; // INSEE
  codesPostaux?: string[];
};

type PluUploadResponse = {
  success: boolean;
  version?: string;
  path?: string;
  storage_path?: string;
  commune_insee?: string;
  bucket?: string;
  error?: string;
  message?: string;
  details?: any;
};

type PluIngestResponse = {
  success: boolean;
  version?: string;
  error?: string;
  message?: string;
  parser?: any;
  ingest?: any;
  [k: string]: any;
};

type ZoneResult = {
  parcel_id?: string;
  zone_code?: string;
  zone_libelle?: string;
  raw?: any;
};

type Status = "idle" | "loading" | "success" | "error";

// ============================================
// Configuration
// ============================================

// API Commune
const GEO_API_URL = "https://geo.api.gouv.fr/communes";

// Clés localStorage pour réutilisation depuis Foncier
const LS = {
  codePostal: "mimmoza.plu.last_code_postal",
  codeInsee: "mimmoza.plu.last_commune_insee",
  communeNom: "mimmoza.plu.last_commune_nom",
  storagePath: "mimmoza.plu.last_storage_path",
  address: "mimmoza.plu.last_address",
  parcelId: "mimmoza.plu.last_parcel_id",
  zoneCode: "mimmoza.plu.last_zone_code",
  zoneLibelle: "mimmoza.plu.last_zone_libelle",
  foncierParcelId: "mimmoza.cadastre.parcel_id",
  foncierCommuneInsee: "mimmoza.cadastre.commune_insee",
  foncierZoneCode: "mimmoza.cadastre.zone_code",
  foncierZoneLibelle: "mimmoza.cadastre.zone_libelle",
} as const;

function safeJsonParse<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function readLS(key: string, fallback = ""): string {
  try {
    if (typeof window === "undefined") return fallback;
    const v = window.localStorage.getItem(key);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function writeLS(key: string, value: string) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, value ?? "");
  } catch {
    // ignore
  }
}

function isValidCodePostal(v: string) {
  return /^\d{5}$/.test((v ?? "").trim());
}

function isValidCodeInsee(v: string) {
  return /^\d{5}$/.test((v ?? "").trim());
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

async function fetchCommunes(url: string): Promise<CommuneGeo[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`geo.api.gouv.fr: ${res.status}`);
  const data = (await res.json()) as CommuneGeo[];
  return Array.isArray(data) ? data : [];
}

export default function PluUploaderPanel(): React.ReactElement {
  const navigate = useNavigate();

  // Auth state - utilisation du client Supabase
  const [accessToken, setAccessToken] = useState<string | null>(null);

  // persistés
  const [codePostal, setCodePostal] = useState(() => readLS(LS.codePostal, ""));
  const [codeInsee, setCodeInsee] = useState(() => readLS(LS.codeInsee, ""));
  const [communeNom, setCommuneNom] = useState(() => readLS(LS.communeNom, ""));
  const [storagePath, setStoragePath] = useState(() => readLS(LS.storagePath, ""));
  const [address, setAddress] = useState(() => readLS(LS.address, ""));
  const [parcelId, setParcelId] = useState(() => readLS(LS.parcelId, ""));

  // non persistés
  const [communes, setCommunes] = useState<CommuneGeo[]>([]);
  const [communeSearchStatus, setCommuneSearchStatus] = useState<Status>("idle");
  const [communeSearchError, setCommuneSearchError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);

  const [uploadStatus, setUploadStatus] = useState<Status>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadResponse, setUploadResponse] = useState<PluUploadResponse | null>(null);

  const [ingestStatus, setIngestStatus] = useState<Status>("idle");
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [ingestResponse, setIngestResponse] = useState<PluIngestResponse | null>(null);

  // Zone detection state
  const [zoneStatus, setZoneStatus] = useState<Status>("idle");
  const [zoneError, setZoneError] = useState<string | null>(null);
  const [zoneResult, setZoneResult] = useState<ZoneResult | null>(null);
  const [showZoneDetails, setShowZoneDetails] = useState(false);

  // État pour savoir si la zone vient de Foncier (lecture seule)
  const [zoneFromFoncier, setZoneFromFoncier] = useState(false);

  const [showDetails, setShowDetails] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auth: récupérer la session et écouter les changements
  useEffect(() => {
    // Récupérer la session initiale
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAccessToken(session?.access_token ?? null);
    });

    // Écouter les changements d'auth
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setAccessToken(session?.access_token ?? null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Helper pour construire les headers avec le token
  const buildAuthHeaders = useCallback(
    (extra?: Record<string, string>): Record<string, string> => {
      const headers: Record<string, string> = { ...(extra || {}) };

      if (SUPABASE_ANON_KEY) {
        headers.apikey = SUPABASE_ANON_KEY;
      }

      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }

      return headers;
    },
    [accessToken]
  );

  // useEffect pour charger les infos depuis Foncier au montage
  useEffect(() => {
    const foncierInsee = readLS(LS.foncierCommuneInsee, "") || readLS(LS.codeInsee, "");
    const foncierParcel = readLS(LS.foncierParcelId, "") || readLS(LS.parcelId, "");
    const foncierZoneCode = readLS(LS.foncierZoneCode, "") || readLS(LS.zoneCode, "");
    const foncierZoneLibelle = readLS(LS.foncierZoneLibelle, "") || readLS(LS.zoneLibelle, "");

    if (foncierInsee && !codeInsee) {
      setCodeInsee(foncierInsee);
      writeLS(LS.codeInsee, foncierInsee);
    }

    if (foncierParcel && !parcelId) {
      setParcelId(foncierParcel);
      writeLS(LS.parcelId, foncierParcel);
    }

    if (foncierZoneCode || foncierZoneLibelle) {
      setZoneResult({
        parcel_id: foncierParcel || undefined,
        zone_code: foncierZoneCode || undefined,
        zone_libelle: foncierZoneLibelle || undefined,
        raw: null,
      });
      setZoneStatus("success");
      setZoneFromFoncier(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // persist à chaque modif
  const persistPostal = useCallback((v: string) => {
    setCodePostal(v);
    writeLS(LS.codePostal, v);
  }, []);

  const persistInsee = useCallback((v: string) => {
    setCodeInsee(v);
    writeLS(LS.codeInsee, v);
  }, []);

  const persistNom = useCallback((v: string) => {
    setCommuneNom(v);
    writeLS(LS.communeNom, v);
  }, []);

  const persistStorage = useCallback((v: string) => {
    setStoragePath(v);
    writeLS(LS.storagePath, v);
  }, []);

  const persistAddress = useCallback((v: string) => {
    setAddress(v);
    writeLS(LS.address, v);
  }, []);

  const persistParcelId = useCallback((v: string) => {
    setParcelId(v);
    writeLS(LS.parcelId, v);
  }, []);

  const effectiveInsee = useMemo(() => (codeInsee ?? "").trim(), [codeInsee]);
  const effectiveAddress = useMemo(() => (address ?? "").trim(), [address]);
  const effectiveParcelId = useMemo(() => (parcelId ?? "").trim(), [parcelId]);

  const hasAnonKey = !!SUPABASE_ANON_KEY;

  // Conditions de validation incluant l'authentification
  const canUpload =
    !!file &&
    isValidCodeInsee(effectiveInsee) &&
    uploadStatus !== "loading" &&
    hasAnonKey &&
    !!accessToken;

  const canIngest =
    !!storagePath &&
    isValidCodeInsee(effectiveInsee) &&
    ingestStatus !== "loading" &&
    hasAnonKey &&
    !!accessToken;

  const canDetectZone =
    isValidCodeInsee(effectiveInsee) &&
    hasAnonKey &&
    zoneStatus !== "loading" &&
    (!!effectiveParcelId || !!effectiveAddress) &&
    !!accessToken;

  const handleGoToLogin = useCallback(() => {
    navigate("/login");
  }, [navigate]);

  // Recherche communes (CP -> liste) - pas besoin d'auth car API publique
  const onSearch = useCallback(async () => {
    if (!isValidCodePostal(codePostal)) {
      setCommuneSearchError("Code postal invalide (5 chiffres).");
      return;
    }

    setCommuneSearchStatus("loading");
    setCommuneSearchError(null);
    setCommunes([]);

    try {
      const url = `${GEO_API_URL}?codePostal=${codePostal}&fields=nom,code,codesPostaux&format=json`;
      const data = await fetchCommunes(url);

      if (!data || data.length === 0) {
        setCommuneSearchStatus("error");
        setCommuneSearchError(`Aucune commune trouvée pour ${codePostal}.`);
        return;
      }

      setCommunes(data);
      setCommuneSearchStatus("success");

      if (data.length === 1) {
        persistInsee(data[0].code);
        persistNom(data[0].nom);
      }
    } catch (e: any) {
      setCommuneSearchStatus("error");
      setCommuneSearchError(e?.message || "Erreur lors de la recherche.");
    }
  }, [codePostal, persistInsee, persistNom]);

  const handleCommuneSelect = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const v = e.target.value;
      const selected = communes.find((c) => c.code === v);
      if (selected) {
        persistInsee(selected.code);
        persistNom(selected.nom);
      }
    },
    [communes, persistInsee, persistNom],
  );

  const handleFileSelect = useCallback((f: File | null) => {
    setUploadError(null);
    setUploadResponse(null);
    setUploadStatus("idle");

    setIngestError(null);
    setIngestResponse(null);
    setIngestStatus("idle");

    if (!f) {
      setFile(null);
      return;
    }

    const isPdf =
      (f.type || "").toLowerCase() === "application/pdf" ||
      f.name.toLowerCase().endsWith(".pdf");

    if (!isPdf) {
      setFile(null);
      setUploadError("Seuls les fichiers PDF sont acceptés.");
      return;
    }

    setFile(f);
  }, []);

  // Upload
  const handleUpload = useCallback(async () => {
    if (!file) {
      setUploadError("Sélectionne un fichier PDF.");
      return;
    }
    if (!isValidCodeInsee(effectiveInsee)) {
      setUploadError("Code INSEE invalide (5 chiffres).");
      return;
    }
    if (!SUPABASE_ANON_KEY) {
      setUploadError("Configuration manquante : VITE_SUPABASE_ANON_KEY");
      return;
    }
    // Vérifier l'authentification AVANT l'appel API
    if (!accessToken) {
      setUploadError("Vous devez être connecté pour uploader un document.");
      return;
    }

    setUploadStatus("loading");
    setUploadError(null);
    setUploadResponse(null);

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("commune_insee", effectiveInsee);

      const res = await fetch(`${SUPABASE_URL}/functions/v1/plu-upload`, {
        method: "POST",
        headers: buildAuthHeaders(),
        body: fd,
      });

      const txt = await res.text();
      const data =
        safeJsonParse<PluUploadResponse>(txt) ??
        ({ success: false, error: "INVALID_JSON", message: txt } as PluUploadResponse);

      if (!res.ok || !data.success) {
        throw new Error(
          data.error || data.message || `Upload failed (${res.status})`,
        );
      }

      setUploadResponse(data);
      setUploadStatus("success");

      const path = (data.storage_path ?? data.path ?? "").trim();
      if (path) persistStorage(path);
    } catch (e: any) {
      setUploadStatus("error");
      setUploadError(e?.message || "Erreur lors de l'upload.");
    }
  }, [file, effectiveInsee, accessToken, buildAuthHeaders, persistStorage]);

  // Ingestion
  const handleIngest = useCallback(async () => {
    if (!isValidCodeInsee(effectiveInsee)) {
      setIngestError("Code INSEE invalide (5 chiffres).");
      return;
    }

    const sp = (storagePath || "").trim();
    if (!sp) {
      setIngestError("Aucun PLU uploadé. Uploade d'abord un PDF.");
      return;
    }
    if (!SUPABASE_ANON_KEY) {
      setIngestError("Configuration manquante : VITE_SUPABASE_ANON_KEY");
      return;
    }
    // Vérifier l'authentification AVANT l'appel API
    if (!accessToken) {
      setIngestError("Vous devez être connecté pour lancer l'ingestion.");
      return;
    }

    setIngestStatus("loading");
    setIngestError(null);
    setIngestResponse(null);

    try {
      const payload = JSON.stringify({
        commune_insee: effectiveInsee,
        commune_nom: (communeNom || "").trim() || undefined,
        storage_path: sp,
      });
      const headers = buildAuthHeaders({ "Content-Type": "application/json" });

      const res = await fetch(`${SUPABASE_URL}/functions/v1/plu-ingest-from-storage`, {
        method: "POST",
        headers,
        body: payload,
      });

      const txt = await res.text();
      if (import.meta.env.DEV) {
        console.log("[PLU][INGEST] status=", res.status, "raw=", txt.slice(0, 500));
      }

      const data =
        safeJsonParse<PluIngestResponse>(txt) ??
        ({ success: false, error: "INVALID_JSON", message: txt } as PluIngestResponse);

      setIngestResponse(data);

      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || "Ingestion échouée.");
      }

      setIngestStatus("success");
    } catch (e: any) {
      setIngestStatus("error");
      setIngestError(e?.message || "Erreur lors de l'ingestion.");
    }
  }, [effectiveInsee, storagePath, communeNom, accessToken, buildAuthHeaders]);

  // Zone detection
  const handleDetectZone = useCallback(async () => {
    if (!isValidCodeInsee(effectiveInsee)) {
      setZoneError("Code INSEE invalide (5 chiffres).");
      return;
    }
    if (!SUPABASE_ANON_KEY) {
      setZoneError("Configuration manquante : VITE_SUPABASE_ANON_KEY");
      return;
    }
    if (!effectiveParcelId && !effectiveAddress) {
      setZoneError("Renseignez une parcelle ou une adresse.");
      return;
    }
    // Vérifier l'authentification AVANT l'appel API
    if (!accessToken) {
      setZoneError("Vous devez être connecté pour détecter la zone PLU.");
      return;
    }

    setZoneFromFoncier(false);
    setZoneStatus("loading");
    setZoneError(null);
    setZoneResult(null);

    try {
      const body: Record<string, string> = { commune_insee: effectiveInsee };

      if (effectiveParcelId) {
        body.parcel_id = effectiveParcelId;
      }
      if (effectiveAddress) {
        body.address = effectiveAddress;
      }

      const res = await fetch(`${SUPABASE_URL}/functions/v1/plu-from-parcelle-v2`, {
        method: "POST",
        headers: buildAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });

      const txt = await res.text();
      const data = safeJsonParse<any>(txt) ?? { error: "INVALID_JSON", message: txt };

      if (!res.ok) {
        throw new Error(data.error || data.message || `Erreur ${res.status}`);
      }

      const result: ZoneResult = {
        parcel_id:
          data.parcel_id ||
          data.parcel?.parcel_id ||
          data.parcel?.id ||
          effectiveParcelId ||
          undefined,
        zone_code:
          data.zone_code ||
          data.zone?.zone_code ||
          data.zone?.code ||
          undefined,
        zone_libelle:
          data.zone_libelle ||
          data.zone?.zone_libelle ||
          data.zone?.libelle ||
          undefined,
        raw: data,
      };

      if (!result.zone_code && !result.zone_libelle) {
        throw new Error(
          data.error || data.message || "Aucune zone PLU détectée pour cette parcelle.",
        );
      }

      if (result.zone_code) writeLS(LS.zoneCode, result.zone_code);
      if (result.zone_libelle) writeLS(LS.zoneLibelle, result.zone_libelle);

      setZoneResult(result);
      setZoneStatus("success");
    } catch (e: any) {
      setZoneStatus("error");
      setZoneError(e?.message || "Erreur lors de la détection de zone.");
    }
  }, [effectiveInsee, effectiveParcelId, effectiveAddress, accessToken, buildAuthHeaders]);

  const reset = useCallback(() => {
    setFile(null);

    setCommunes([]);
    setCommuneSearchStatus("idle");
    setCommuneSearchError(null);

    setUploadStatus("idle");
    setUploadError(null);
    setUploadResponse(null);

    setIngestStatus("idle");
    setIngestError(null);
    setIngestResponse(null);

    setZoneStatus("idle");
    setZoneError(null);
    setZoneResult(null);
    setShowZoneDetails(false);
    setZoneFromFoncier(false);

    setShowDetails(false);

    persistStorage("");

    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [persistStorage]);

  return (
    <div>
      {/* Message d'authentification requise */}
      {!accessToken && (
        <div
          style={{
            margin: "0 0 16px",
            padding: 16,
            background: "linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)",
            border: "1px solid #fbbf24",
            borderRadius: 8,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "2rem", marginBottom: 8 }}>🔒</div>
          <div style={{ fontWeight: 600, color: "#92400e", marginBottom: 4 }}>
            Connexion requise
          </div>
          <div style={{ fontSize: 14, color: "#a16207", marginBottom: 12 }}>
            Vous devez être connecté pour uploader un PLU.
          </div>
          <button
            onClick={handleGoToLogin}
            style={{
              padding: "8px 16px",
              fontSize: 14,
              fontWeight: 600,
              color: "#ffffff",
              background: "#92400e",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Se connecter
          </button>
        </div>
      )}

      {/* Erreur si clé anon manquante */}
      {!hasAnonKey && (
        <div
          style={{
            margin: "0 0 12px",
            padding: 12,
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 8,
            color: "#b91c1c",
          }}
        >
          <strong>Configuration manquante :</strong> VITE_SUPABASE_ANON_KEY n'est pas défini.
          <br />
          <span style={{ fontSize: 12, opacity: 0.85 }}>L'upload et l'ingestion sont désactivés.</span>
        </div>
      )}

      {/* Bloc 1: Commune */}
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ margin: "0 0 8px" }}>Uploader un PLU</h3>
        <p style={{ margin: "0 0 12px", opacity: 0.75 }}>
          Choisis une commune (CP ou INSEE), uploade le PDF, puis lance l'ingestion.
        </p>

        <div style={{ display: "grid", gap: 10, maxWidth: 720 }}>
          <div>
            <label style={{ display: "block", marginBottom: 6 }}>Code postal</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={codePostal}
                onChange={(e) =>
                  persistPostal(e.target.value.replace(/\D/g, "").slice(0, 5))
                }
                placeholder="ex: 75001"
                style={{ flex: 1, padding: "10px 12px" }}
              />
              <button
                onClick={onSearch}
                disabled={
                  communeSearchStatus === "loading" || !isValidCodePostal(codePostal)
                }
              >
                {communeSearchStatus === "loading" ? "Recherche..." : "Rechercher"}
              </button>
            </div>
            {communeSearchError && (
              <div style={{ marginTop: 8, color: "#b91c1c" }}>{communeSearchError}</div>
            )}
          </div>

          {communes.length > 0 && (
            <div>
              <label style={{ display: "block", marginBottom: 6 }}>Commune</label>
              <select
                value={effectiveInsee}
                onChange={handleCommuneSelect}
                style={{ width: "100%", padding: "10px 12px" }}
              >
                <option value="">-- sélectionner --</option>
                {communes.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.nom} ({c.code})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label style={{ display: "block", marginBottom: 6 }}>
              Code INSEE (prioritaire)
            </label>
            <input
              value={codeInsee}
              onChange={(e) => persistInsee(e.target.value.replace(/\D/g, "").slice(0, 5))}
              placeholder="ex: 75056"
              style={{ width: "100%", padding: "10px 12px" }}
            />
          </div>

          {effectiveInsee && communeNom && (
            <div style={{ padding: 10, border: "1px solid #e5e7eb", borderRadius: 8 }}>
              Commune: <strong>{communeNom}</strong> — INSEE:{" "}
              <strong>{effectiveInsee}</strong>
            </div>
          )}
        </div>
      </div>

      {/* Bloc 1bis: Ciblage parcelle - Optionnel */}
      <div style={{ marginBottom: 16 }}>
        <h4 style={{ margin: "0 0 8px" }}>Ciblage parcelle (optionnel)</h4>
        <p style={{ margin: "0 0 12px", opacity: 0.75 }}>
          {zoneFromFoncier
            ? "Zone PLU récupérée depuis le module Foncier. Vous pouvez la recalculer si nécessaire."
            : "Renseigne une parcelle (IDU) ou une adresse pour détecter la zone PLU."}
        </p>

        <div style={{ display: "grid", gap: 10, maxWidth: 720 }}>
          {zoneStatus === "success" && zoneResult && (
            <div
              style={{
                padding: 12,
                border: zoneFromFoncier ? "1px solid #3b82f6" : "1px solid #10b981",
                borderRadius: 8,
                background: zoneFromFoncier ? "#eff6ff" : "#ecfdf5",
                color: zoneFromFoncier ? "#1e40af" : "#065f46",
              }}
            >
              {zoneFromFoncier && (
                <div style={{ fontSize: 11, marginBottom: 6, opacity: 0.8 }}>
                  ℹ️ Informations récupérées depuis Foncier
                </div>
              )}
              <div>
                <strong>Parcelle:</strong> {zoneResult.parcel_id || "—"}
              </div>
              <div>
                <strong>Zone PLU:</strong> {zoneResult.zone_code || "—"}
                {zoneResult.zone_libelle && ` — ${zoneResult.zone_libelle}`}
              </div>
            </div>
          )}

          <div>
            <label style={{ display: "block", marginBottom: 6 }}>
              Parcelle / IDU (prioritaire)
            </label>
            <input
              value={parcelId}
              onChange={(e) => persistParcelId(e.target.value.trim())}
              placeholder="ex: 64065000AI0002"
              style={{ width: "100%", padding: "10px 12px" }}
            />
          </div>

          <div>
            <label style={{ display: "block", marginBottom: 6 }}>Adresse</label>
            <input
              value={address}
              onChange={(e) => persistAddress(e.target.value)}
              placeholder="ex: 12 rue X, 64310 Ascain"
              style={{ width: "100%", padding: "10px 12px" }}
            />
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button
              onClick={handleDetectZone}
              disabled={!canDetectZone}
              title={
                !accessToken
                  ? "Connexion requise"
                  : !isValidCodeInsee(effectiveInsee)
                    ? "Renseigne un code INSEE valide (5 chiffres)"
                    : !hasAnonKey
                      ? "Clé Supabase manquante"
                      : zoneStatus === "loading"
                        ? "Détection en cours"
                        : !effectiveParcelId && !effectiveAddress
                          ? "Renseignez une parcelle ou une adresse"
                          : ""
              }
            >
              {zoneStatus === "loading"
                ? "Détection..."
                : zoneFromFoncier
                  ? "Recalculer zone PLU"
                  : "Détecter zone PLU"}
            </button>

            {zoneResult && !zoneFromFoncier && (
              <button type="button" onClick={() => setShowZoneDetails((v) => !v)}>
                {showZoneDetails ? "Masquer détails zone" : "Afficher détails zone"}
              </button>
            )}
          </div>

          {zoneError && (
            <div style={{ marginTop: 4, color: "#b91c1c" }}>{zoneError}</div>
          )}

          {showZoneDetails && zoneResult?.raw && (
            <pre
              style={{
                marginTop: 6,
                padding: 12,
                background: "#111827",
                color: "#f9fafb",
                borderRadius: 8,
                overflowX: "auto",
                fontSize: 12,
              }}
            >
              {JSON.stringify(zoneResult.raw, null, 2)}
            </pre>
          )}
        </div>
      </div>

      {/* Bloc 2: Upload */}
      <div style={{ marginBottom: 16 }}>
        <h4 style={{ margin: "0 0 8px" }}>1) Upload PDF</h4>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)}
            disabled={!hasAnonKey || !accessToken}
          />
          {file && (
            <div style={{ opacity: 0.85 }}>
              {file.name} ({formatFileSize(file.size)})
            </div>
          )}
          {file && (
            <button type="button" onClick={() => handleFileSelect(null)}>
              Retirer
            </button>
          )}
        </div>

        {!file && <div style={{ marginTop: 8, opacity: 0.75 }}>Sélectionne un PDF.</div>}
        {!isValidCodeInsee(effectiveInsee) && (
          <div style={{ marginTop: 8, opacity: 0.75 }}>
            Renseigne un code INSEE valide (5 chiffres).
          </div>
        )}

        {uploadError && (
          <div style={{ marginTop: 8, color: "#b91c1c" }}>{uploadError}</div>
        )}

        {uploadStatus === "success" && storagePath && (
          <div style={{ marginTop: 8, color: "#065f46" }}>
            Upload OK — {storagePath}
          </div>
        )}

        <div style={{ marginTop: 10 }}>
          <button
            onClick={handleUpload}
            disabled={!canUpload}
            title={
              !accessToken
                ? "Connexion requise"
                : !hasAnonKey
                  ? "Clé Supabase manquante"
                  : !file
                    ? "Sélectionne un PDF"
                    : !isValidCodeInsee(effectiveInsee)
                      ? "Renseigne un code INSEE valide (5 chiffres)"
                      : uploadStatus === "loading"
                        ? "Upload en cours"
                        : ""
            }
          >
            {uploadStatus === "loading" ? "Upload..." : "Uploader"}
          </button>
        </div>

        {uploadResponse && (
          <div style={{ marginTop: 10, opacity: 0.8, fontSize: 12 }}>
            {uploadResponse.version ? <>Version: {uploadResponse.version}</> : null}
          </div>
        )}
      </div>

      {/* Bloc 3: Ingestion */}
      <div style={{ marginBottom: 16 }}>
        <h4 style={{ margin: "0 0 8px" }}>2) Ingestion</h4>

        {!storagePath ? (
          <div style={{ opacity: 0.75 }}>Uploade d'abord un PLU.</div>
        ) : (
          <div style={{ opacity: 0.85, marginBottom: 8 }}>
            Fichier: <code>{storagePath}</code>
          </div>
        )}

        {ingestError && <div style={{ marginTop: 8, color: "#b91c1c" }}>{ingestError}</div>}
        {ingestStatus === "success" && (
          <div style={{ marginTop: 8, color: "#065f46" }}>Ingestion OK</div>
        )}

        <div
          style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}
        >
          <button
            onClick={handleIngest}
            disabled={!canIngest}
            title={
              !accessToken
                ? "Connexion requise"
                : !hasAnonKey
                  ? "Clé Supabase manquante"
                  : !storagePath
                    ? "Uploade d'abord un PLU"
                    : ingestStatus === "loading"
                      ? "Ingestion en cours"
                      : ""
            }
          >
            {ingestStatus === "loading" ? "Ingestion..." : "Lancer l'ingestion"}
          </button>

          {ingestResponse && (
            <button type="button" onClick={() => setShowDetails((v) => !v)}>
              {showDetails ? "Masquer détails" : "Afficher détails"}
            </button>
          )}

          {(uploadStatus !== "idle" ||
            ingestStatus !== "idle" ||
            !!storagePath ||
            zoneStatus !== "idle") && (
            <button type="button" onClick={reset}>
              Réinitialiser
            </button>
          )}
        </div>

        {showDetails && ingestResponse && (
          <pre
            style={{
              marginTop: 10,
              padding: 12,
              background: "#111827",
              color: "#f9fafb",
              borderRadius: 8,
              overflowX: "auto",
            }}
          >
            {JSON.stringify(ingestResponse, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}