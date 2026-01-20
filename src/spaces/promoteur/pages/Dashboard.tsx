// src/spaces/promoteur/pages/Dashboard.tsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../supabaseClient";

type PluLookupResult = {
  success?: boolean;
  error?: string;
  message?: string;

  commune_insee?: string;
  commune_nom?: string;

  zone_code?: string;
  zone_libelle?: string;

  parcel_id?: string;
  parcel?: any;

  rules?: any;
  ruleset?: any;
  plu?: any;
};

const LS_KEY = "mimmoza_promoteur_dashboard_lookup_v1";

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

// Extraction tolÃ©rante (on normalisera ensuite au format strict)
function extractKpis(payload: any) {
  const zone_code = payload?.plu?.zone_code ?? payload?.zone_code ?? "â€”";
  const zone_libelle =
    payload?.plu?.zone_libelle ?? payload?.zone_libelle ?? "â€”";

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

export default function Dashboard(): React.ReactElement {
  const [address, setAddress] = useState("");
  const [parcelId, setParcelId] = useState("");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<PluLookupResult | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    const saved = safeParse(localStorage.getItem(LS_KEY));
    if (!saved) return;
    setAddress(String(saved.address ?? ""));
    setParcelId(String(saved.parcelId ?? ""));
    setShowDetails(Boolean(saved.showDetails ?? false));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({ address, parcelId, showDetails })
      );
    } catch {
      // ignore
    }
  }, [address, parcelId, showDetails]);

  const kpis = useMemo(() => {
    if (!res) return null;
    return extractKpis(res);
  }, [res]);

  const reset = () => {
    setErr(null);
    setRes(null);
    setShowDetails(false);
  };

  const runLookup = async () => {
    setErr(null);
    setRes(null);
    setLoading(true);

    try {
      const pid = parcelId.trim();
      const addr = address.trim();

      if (!pid && !addr) {
        setErr("Renseigne une adresse ou un identifiant de parcelle.");
        return;
      }

      // PrioritÃ© parcelle
      if (pid) {
        const { data, error } = await supabase.functions.invoke(
          "plu-from-parcelle",
          { body: { parcel_id: pid } }
        );
        if (error) throw error;
        setRes(data ?? null);
        return;
      }

      // Sinon adresse
      const { data, error } = await supabase.functions.invoke("plu-from-address", {
        body: { address: addr },
      });
      if (error) throw error;
      setRes(data ?? null);
    } catch (e: any) {
      setErr(e?.message ?? "Erreur lors de la lecture PLU.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 980 }}>
      <h2 style={{ margin: "0 0 8px", color: "#0f172a" }}>Tableau de bord</h2>
      <p style={{ margin: "0 0 18px", color: "#475569" }}>
        Point dâ€™entrÃ©e opÃ©rationnel : adresse/parcelle â†’ zone PLU + rÃ¨gles clÃ©s
        (indÃ©pendant de lâ€™ingestion).
      </p>

      <div
        style={{
          border: "1px solid #e2e8f0",
          borderRadius: 14,
          padding: 16,
          background: "#ffffff",
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 6 }}>
              Adresse (option)
            </div>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="ex: 12 rue X, 64310 Ascain"
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #e2e8f0",
                outline: "none",
                fontSize: 14,
              }}
            />
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
              Appelle <code>plu-from-address</code>.
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 6 }}>
              ID Parcelle (prioritaire)
            </div>
            <input
              value={parcelId}
              onChange={(e) => setParcelId(e.target.value)}
              placeholder="ex: 64065000AI0002"
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #e2e8f0",
                outline: "none",
                fontSize: 14,
              }}
            />
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
              Appelle <code>plu-from-parcelle</code> si renseignÃ©.
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
            {loading ? "Lecture PLU..." : "Lire PLU"}
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
            RÃ©initialiser
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
            {showDetails ? "Masquer dÃ©tails" : "Afficher dÃ©tails"}
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
            }}
          >
            {err}
          </div>
        )}

        {res && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12 }}>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 800, textTransform: "uppercase" }}>
                  Zone PLU
                </div>
                <div style={{ marginTop: 6, fontSize: 18, fontWeight: 800, color: "#0f172a" }}>
                  {kpis?.zone_code ?? "â€”"}
                </div>
                <div style={{ marginTop: 4, fontSize: 12, color: "#475569" }}>
                  {kpis?.zone_libelle ?? "â€”"}
                </div>
              </div>

              <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12 }}>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 800, textTransform: "uppercase" }}>
                  Reculs (extrait)
                </div>
                <pre style={{ marginTop: 8, fontSize: 12, color: "#0f172a", whiteSpace: "pre-wrap" }}>
                  {kpis?.reculs ? pretty(kpis.reculs) : "â€”"}
                </pre>
              </div>

              <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: 12 }}>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 800, textTransform: "uppercase" }}>
                  Hauteur / Parking (extrait)
                </div>
                <pre style={{ marginTop: 8, fontSize: 12, color: "#0f172a", whiteSpace: "pre-wrap" }}>
{`Hauteur:
${kpis?.hauteur ? pretty(kpis.hauteur) : "â€”"}

Parking:
${kpis?.parking ? pretty(kpis.parking) : "â€”"}`}
                </pre>
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
                }}
              >
                <pre style={{ margin: 0, fontSize: 12, whiteSpace: "pre-wrap" }}>
                  {pretty(res)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>

      <p style={{ marginTop: 12, color: "#64748b", fontSize: 12 }}>
        Prochaine Ã©tape (quand tu me le demanderas) : normaliser la sortie en 3 champs stricts
        (reculs/hauteur/parking) au lieu dâ€™afficher du JSON extrait.
      </p>
    </div>
  );
}

