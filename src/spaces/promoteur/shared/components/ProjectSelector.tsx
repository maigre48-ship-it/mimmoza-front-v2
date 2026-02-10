// src/spaces/promoteur/shared/components/ProjectSelector.tsx
// ============================================
// Sélecteur de projet réutilisable
// Affiché en header de chaque page d'analyse
// ============================================

import React, { useState, useCallback, useEffect } from "react";
import {
  MapPin, Search, ChevronDown, ChevronUp, X, Check, Loader2,
  Building2, Navigation, Edit3
} from "lucide-react";
import { supabase } from "../../../../supabaseClient";
import type { ProjectInfo } from "../hooks/useProjectContext";

// ============================================
// TYPES
// ============================================

interface ProjectSelectorProps {
  projectInfo: ProjectInfo;
  onProjectChange: (info: Partial<ProjectInfo>) => void;
  /** Mode compact par défaut si projet existe */
  defaultExpanded?: boolean;
  /** Afficher les parcelles sélectionnées */
  showParcels?: boolean;
  /** Callback après sélection réussie */
  onSelectionComplete?: (info: ProjectInfo) => void;
}

interface AddressSuggestion {
  label: string;
  lat: number;
  lon: number;
  city?: string;
  postcode?: string;
  context?: string;
}

// ============================================
// STYLES
// ============================================

const styles = {
  container: {
    background: "white",
    borderRadius: "14px",
    border: "1px solid #e2e8f0",
    overflow: "hidden",
    marginBottom: "20px",
  } as React.CSSProperties,

  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 18px",
    cursor: "pointer",
    background: "#f8fafc",
    borderBottom: "1px solid #e2e8f0",
  } as React.CSSProperties,

  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  } as React.CSSProperties,

  body: {
    padding: "18px",
  } as React.CSSProperties,

  input: {
    width: "100%",
    padding: "12px 14px",
    paddingLeft: "42px",
    borderRadius: "10px",
    border: "1px solid #e2e8f0",
    fontSize: "14px",
    outline: "none",
    transition: "border-color 0.2s, box-shadow 0.2s",
  } as React.CSSProperties,

  inputWrapper: {
    position: "relative" as const,
  } as React.CSSProperties,

  inputIcon: {
    position: "absolute" as const,
    left: "14px",
    top: "50%",
    transform: "translateY(-50%)",
    color: "#94a3b8",
  } as React.CSSProperties,

  suggestions: {
    position: "absolute" as const,
    top: "100%",
    left: 0,
    right: 0,
    background: "white",
    border: "1px solid #e2e8f0",
    borderRadius: "10px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
    zIndex: 100,
    maxHeight: "240px",
    overflow: "auto",
    marginTop: "4px",
  } as React.CSSProperties,

  suggestionItem: {
    padding: "12px 14px",
    cursor: "pointer",
    borderBottom: "1px solid #f1f5f9",
    fontSize: "13px",
    display: "flex",
    alignItems: "center",
    gap: "10px",
  } as React.CSSProperties,

  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    padding: "4px 10px",
    borderRadius: "6px",
    fontSize: "11px",
    fontWeight: 600,
  } as React.CSSProperties,

  button: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    padding: "10px 18px",
    borderRadius: "10px",
    border: "none",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s",
  } as React.CSSProperties,
};

// ============================================
// HELPERS
// ============================================

function extractCommuneInsee(parcelId: string): string | null {
  const match = parcelId.match(/^(\d{5})/);
  return match?.[1] ?? null;
}

async function searchAddressAPI(query: string): Promise<AddressSuggestion[]> {
  if (!query || query.length < 3) return [];
  
  try {
    const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&limit=5`;
    const res = await fetch(url);
    const data = await res.json();
    
    return (data.features || []).map((f: any) => ({
      label: f.properties.label,
      lat: f.geometry.coordinates[1],
      lon: f.geometry.coordinates[0],
      city: f.properties.city,
      postcode: f.properties.postcode,
      context: f.properties.context,
    }));
  } catch {
    return [];
  }
}

// ============================================
// COMPONENT
// ============================================

export function ProjectSelector({
  projectInfo,
  onProjectChange,
  defaultExpanded,
  showParcels = true,
  onSelectionComplete,
}: ProjectSelectorProps) {
  const hasProject = !!(projectInfo.parcelId || projectInfo.address || projectInfo.communeInsee);
  
  const [expanded, setExpanded] = useState(defaultExpanded ?? !hasProject);
  const [addressInput, setAddressInput] = useState(projectInfo.address || "");
  const [parcelInput, setParcelInput] = useState(projectInfo.parcelId || "");
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync inputs with projectInfo changes
  useEffect(() => {
    if (projectInfo.address && !addressInput) {
      setAddressInput(projectInfo.address);
    }
    if (projectInfo.parcelId && !parcelInput) {
      setParcelInput(projectInfo.parcelId);
    }
  }, [projectInfo]);

  // Address search with debounce
  useEffect(() => {
    if (!addressInput || addressInput.length < 3) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      const results = await searchAddressAPI(addressInput);
      setSuggestions(results);
      setShowSuggestions(results.length > 0);
      setIsSearching(false);
    }, 300);

    return () => clearTimeout(timer);
  }, [addressInput]);

  // Select address suggestion
  const handleSelectSuggestion = useCallback((suggestion: AddressSuggestion) => {
    setAddressInput(suggestion.label);
    setShowSuggestions(false);
    setSuggestions([]);

    onProjectChange({
      address: suggestion.label,
      city: suggestion.city,
      postalCode: suggestion.postcode,
      lat: suggestion.lat,
      lon: suggestion.lon,
    });
  }, [onProjectChange]);

  // Validate parcel ID
  const handleValidateParcel = useCallback(async () => {
    const pid = parcelInput.trim().toUpperCase();
    if (!pid) {
      setError("Veuillez saisir un identifiant de parcelle");
      return;
    }

    const insee = extractCommuneInsee(pid);
    if (!insee) {
      setError("Format invalide. L'ID doit commencer par 5 chiffres (INSEE).");
      return;
    }

    setIsValidating(true);
    setError(null);

    try {
      // Appel API pour valider et enrichir
      const { data, error: apiError } = await supabase.functions.invoke("plu-from-parcelle-v2", {
        body: { parcel_id: pid, commune_insee: insee },
      });

      if (apiError) throw apiError;

      const newInfo: Partial<ProjectInfo> = {
        parcelId: pid,
        communeInsee: insee,
        communeName: data?.commune_nom || data?.parcel?.nom_com,
        lat: data?.parcel?.centroid?.lat,
        lon: data?.parcel?.centroid?.lon,
      };

      onProjectChange(newInfo);
      setExpanded(false);
      onSelectionComplete?.({ ...projectInfo, ...newInfo });

    } catch (err) {
      console.error("Parcel validation error:", err);
      // On garde quand même les infos de base
      onProjectChange({
        parcelId: pid,
        communeInsee: insee,
      });
      setExpanded(false);
    } finally {
      setIsValidating(false);
    }
  }, [parcelInput, projectInfo, onProjectChange, onSelectionComplete]);

  // Clear project
  const handleClear = useCallback(() => {
    setAddressInput("");
    setParcelInput("");
    setError(null);
    onProjectChange({
      address: undefined,
      parcelId: undefined,
      parcelIds: undefined,
      city: undefined,
      postalCode: undefined,
      communeInsee: undefined,
      communeName: undefined,
      lat: undefined,
      lon: undefined,
      surfaceM2: undefined,
    });
  }, [onProjectChange]);

  // Render compact header when collapsed
  const renderCompactHeader = () => (
    <div style={styles.header} onClick={() => setExpanded(!expanded)}>
      <div style={styles.headerLeft}>
        <div style={{
          width: "40px",
          height: "40px",
          borderRadius: "10px",
          background: hasProject ? "#10b981" : "#e2e8f0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}>
          {hasProject ? (
            <Check size={20} color="white" />
          ) : (
            <MapPin size={20} color="#64748b" />
          )}
        </div>
        <div>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "#0f172a" }}>
            {hasProject ? (projectInfo.communeName || projectInfo.city || "Projet sélectionné") : "Sélectionner un terrain"}
          </div>
          <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
            {hasProject ? (
              <>
                {projectInfo.parcelId && (
                  <span style={{ fontFamily: "monospace", marginRight: "8px" }}>{projectInfo.parcelId}</span>
                )}
                {projectInfo.address && <span>{projectInfo.address}</span>}
              </>
            ) : (
              "Adresse ou identifiant de parcelle"
            )}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        {hasProject && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleClear();
            }}
            style={{
              padding: "6px 10px",
              background: "#fef2f2",
              border: "none",
              borderRadius: "6px",
              color: "#dc2626",
              fontSize: "11px",
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <X size={12} />
            Effacer
          </button>
        )}
        {expanded ? <ChevronUp size={20} color="#64748b" /> : <ChevronDown size={20} color="#64748b" />}
      </div>
    </div>
  );

  return (
    <div style={styles.container}>
      {renderCompactHeader()}

      {expanded && (
        <div style={styles.body}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
            {/* Address input */}
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "#334155", marginBottom: "6px" }}>
                Adresse
              </label>
              <div style={styles.inputWrapper}>
                <Navigation size={16} style={styles.inputIcon} />
                <input
                  type="text"
                  value={addressInput}
                  onChange={(e) => setAddressInput(e.target.value)}
                  onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                  placeholder="ex: 10 rue de la Paix, 75002 Paris"
                  style={styles.input}
                />
                {isSearching && (
                  <Loader2 size={16} style={{ position: "absolute", right: "14px", top: "50%", transform: "translateY(-50%)", animation: "spin 1s linear infinite" }} color="#64748b" />
                )}
                {showSuggestions && suggestions.length > 0 && (
                  <div style={styles.suggestions}>
                    {suggestions.map((s, i) => (
                      <div
                        key={i}
                        style={styles.suggestionItem}
                        onClick={() => handleSelectSuggestion(s)}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
                      >
                        <MapPin size={14} color="#3b82f6" />
                        <div>
                          <div style={{ fontWeight: 600, color: "#0f172a" }}>{s.label}</div>
                          <div style={{ fontSize: "11px", color: "#64748b" }}>{s.context}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Parcel ID input */}
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "#334155", marginBottom: "6px" }}>
                ID Parcelle (prioritaire)
              </label>
              <div style={styles.inputWrapper}>
                <Building2 size={16} style={styles.inputIcon} />
                <input
                  type="text"
                  value={parcelInput}
                  onChange={(e) => setParcelInput(e.target.value.toUpperCase())}
                  placeholder="ex: 75102000AB0123"
                  style={styles.input}
                />
              </div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div style={{
              padding: "10px 14px",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: "8px",
              color: "#991b1b",
              fontSize: "13px",
              marginBottom: "14px",
            }}>
              {error}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: "10px" }}>
            <button
              onClick={handleValidateParcel}
              disabled={isValidating || (!parcelInput.trim() && !addressInput.trim())}
              style={{
                ...styles.button,
                background: isValidating ? "#94a3b8" : "#0f172a",
                color: "white",
                opacity: (!parcelInput.trim() && !addressInput.trim()) ? 0.5 : 1,
              }}
            >
              {isValidating ? (
                <>
                  <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
                  Validation...
                </>
              ) : (
                <>
                  <Search size={16} />
                  Valider le terrain
                </>
              )}
            </button>

            {hasProject && (
              <button
                onClick={() => setExpanded(false)}
                style={{
                  ...styles.button,
                  background: "#f1f5f9",
                  color: "#475569",
                }}
              >
                Annuler
              </button>
            )}
          </div>

          {/* Help text */}
          <p style={{ fontSize: "11px", color: "#94a3b8", marginTop: "12px", lineHeight: 1.5 }}>
            L'ID parcelle est prioritaire sur l'adresse. Le terrain sélectionné sera utilisé pour toutes les analyses (PLU, marché, risques, bilan).
          </p>
        </div>
      )}

      {/* CSS for spinner */}
      <style>{`
        @keyframes spin {
          from { transform: translateY(-50%) rotate(0deg); }
          to { transform: translateY(-50%) rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default ProjectSelector;