// src/spaces/promoteur/pages/MassingPage.tsx
// ─────────────────────────────────────────────────────────────────────────────
// MASSING 3D PROMOTEUR — V2
// Page d'analyse de capacité : répond à
//   "Que puis-je construire sur cette parcelle ?"
//   "Quel scénario maximise la valeur du foncier ?"
//
// Consomme le Massing Engine (services/massing/*). Aucune donnée inventée :
// - CES / hauteur / stationnement viennent du PLU (préremplis si détectés, éditables).
// - Le prix de sortie est saisi ou injecté depuis le Valuation Engine ;
//   tant qu'il vaut 0, le bloc Économie reste masqué.
// - Pas de Three.js : volumétrie en SVG isométrique simplifié.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ACCENT_PRO, GRAD_PRO } from "../shared/promoteurDesign.tokens";

import type {
  EconomicsHypotheses,
  MassingScenario,
  ParcelContext,
  PluRulesetInput,
  ScenarioName,
} from "../../../services/massing/massing.types";
import {
  DEFAULT_HYPOTHESES,
  computeAllEconomics,
  pickBestForLandValue,
} from "../../../services/massing/massingEconomics.service";
import { runMassingEngine } from "../../../services/massing/massingEngine.service";
import { buildAllGeometries } from "../../../services/massing/massingGeometry.service";
import { buildMassingReport } from "../../../services/massing/massingReport";

// ── Formatage ─────────────────────────────────────────────────────────────────

const fmtInt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const fmtEur = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});
function m2(n: number): string {
  return `${fmtInt.format(Math.round(n))} m²`;
}
function eur(n: number | null): string {
  return n == null ? "—" : fmtEur.format(n);
}
function pct(n: number | null): string {
  return n == null ? "—" : `${(n * 100).toFixed(1)} %`;
}

// ── Lecture best-effort de la sélection terrain persistée ─────────────────────
// Clé déjà écrite par la page Foncier. Aucune donnée inventée si absente.

function readPersistedSurface(): number | null {
  try {
    const raw = localStorage.getItem("mimmoza_promoteur_terrain_selection_v1");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { surface_totale_m2?: number };
    const s = parsed?.surface_totale_m2;
    return typeof s === "number" && s > 0 ? Math.round(s) : null;
  } catch {
    return null;
  }
}

// ── UI atoms ──────────────────────────────────────────────────────────────────

const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({
  children,
  style,
}) => (
  <div
    style={{
      background: "#fff",
      border: "1px solid #e2e8f0",
      borderRadius: 14,
      padding: 18,
      boxShadow: "0 1px 3px rgba(15,23,42,0.04)",
      ...style,
    }}
  >
    {children}
  </div>
);

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h2
    style={{
      fontSize: 13,
      fontWeight: 700,
      letterSpacing: "0.04em",
      textTransform: "uppercase",
      color: "#64748b",
      margin: "0 0 12px",
    }}
  >
    {children}
  </h2>
);

const NumField: React.FC<{
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  step?: number;
  hint?: string;
}> = ({ label, value, onChange, suffix, step = 1, hint }) => (
  <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
    <span style={{ color: "#475569", fontWeight: 600 }}>{label}</span>
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        style={{
          width: "100%",
          padding: "7px 9px",
          borderRadius: 8,
          border: "1px solid #e2e8f0",
          fontSize: 13,
          color: "#0f172a",
        }}
      />
      {suffix && <span style={{ color: "#94a3b8", fontSize: 11 }}>{suffix}</span>}
    </span>
    {hint && <span style={{ color: "#94a3b8", fontSize: 10 }}>{hint}</span>}
  </label>
);

// ── Volumétrie SVG isométrique simplifiée (sans Three.js) ─────────────────────

const ISO_AX = Math.cos(Math.PI / 6); // 0.866
const ISO_AY = Math.sin(Math.PI / 6); // 0.5

function iso(px: number, py: number, pz: number) {
  return { X: (px - py) * ISO_AX, Y: (px + py) * ISO_AY - pz };
}

const IsoBlock: React.FC<{
  widthM: number;
  depthM: number;
  heightM: number;
  levelHeightsM: number[];
  scale: number; // px / m
  color: string;
}> = ({ widthM, depthM, heightM, levelHeightsM, scale, color }) => {
  if (widthM <= 0 || heightM <= 0) {
    return (
      <text x={0} y={0} fontSize={11} fill="#94a3b8">
        Volume non calculable
      </text>
    );
  }
  const w = widthM * scale;
  const d = depthM * scale;
  const h = heightM * scale;

  const b0 = iso(0, 0, 0);
  const b1 = iso(w, 0, 0);
  const b2 = iso(w, d, 0);
  const b3 = iso(0, d, 0);
  const t0 = iso(0, 0, h);
  const t1 = iso(w, 0, h);
  const t2 = iso(w, d, h);
  const t3 = iso(0, d, h);

  const poly = (...pts: { X: number; Y: number }[]) =>
    pts.map((p) => `${p.X.toFixed(1)},${p.Y.toFixed(1)}`).join(" ");

  // Lignes de niveaux sur la face avant gauche (b0-b1).
  const floorLines: React.ReactNode[] = [];
  let acc = 0;
  for (let i = 0; i < levelHeightsM.length - 1; i++) {
    acc += levelHeightsM[i];
    const z = acc * scale;
    const l0 = iso(0, 0, z);
    const l1 = iso(w, 0, z);
    floorLines.push(
      <line
        key={i}
        x1={l0.X}
        y1={l0.Y}
        x2={l1.X}
        y2={l1.Y}
        stroke="rgba(255,255,255,0.5)"
        strokeWidth={0.8}
      />,
    );
  }

  return (
    <g>
      {/* Face droite */}
      <polygon points={poly(b1, b2, t2, t1)} fill={color} opacity={0.75} />
      {/* Face gauche (avant) */}
      <polygon points={poly(b0, b1, t1, t0)} fill={color} opacity={0.92} />
      {/* Toit */}
      <polygon points={poly(t0, t1, t2, t3)} fill={color} opacity={0.6} />
      {/* Arêtes */}
      <polygon
        points={poly(b0, b1, t1, t0)}
        fill="none"
        stroke="rgba(15,23,42,0.25)"
        strokeWidth={1}
      />
      {floorLines}
    </g>
  );
};

// ── Page ──────────────────────────────────────────────────────────────────────

const SCENARIO_COLORS: Record<ScenarioName, string> = {
  prudent: "#94a3b8",
  central: ACCENT_PRO,
  optimise: "#7c6fcd",
};

export default function MassingPage(): React.ReactElement {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const studyId = searchParams.get("study");

  // ── Entrées parcelle / PLU (éditables, préremplies si détectées) ───────────
  const [surfaceM2, setSurfaceM2] = React.useState<number>(
    () => readPersistedSurface() ?? 1000,
  );
  const [zoneCode, setZoneCode] = React.useState<string>("");
  const [cesPct, setCesPct] = React.useState<number>(40); // % d'emprise
  const [hauteurMaxM, setHauteurMaxM] = React.useState<number>(15);
  const [parkParLgt, setParkParLgt] = React.useState<number>(1);

  // ── Hypothèses économiques (éditables) ─────────────────────────────────────
  const [hyp, setHyp] = React.useState<EconomicsHypotheses>({ ...DEFAULT_HYPOTHESES });
  const patchHyp = (p: Partial<EconomicsHypotheses>) =>
    setHyp((h) => ({ ...h, ...p }));

  // ── Construction du ParcelContext ──────────────────────────────────────────
  const plu: PluRulesetInput = React.useMemo(
    () => ({
      zone_code: zoneCode || null,
      ces: { max_ratio: cesPct > 0 ? cesPct / 100 : null },
      hauteur: { max_m: hauteurMaxM > 0 ? hauteurMaxM : null },
      stationnement: {
        par_logement: parkParLgt > 0 ? parkParLgt : null,
        par_100m2: null,
      },
      completeness: { ok: cesPct > 0 && hauteurMaxM > 0, missing: [] },
    }),
    [zoneCode, cesPct, hauteurMaxM, parkParLgt],
  );

  const ctx: ParcelContext = React.useMemo(
    () => ({
      surfaceM2,
      zoneCode: zoneCode || null,
      plu,
      prixSortieM2: hyp.prixSortieM2 > 0 ? hyp.prixSortieM2 : null,
    }),
    [surfaceM2, zoneCode, plu, hyp.prixSortieM2],
  );

  // ── Moteur ─────────────────────────────────────────────────────────────────
  const result = React.useMemo(() => runMassingEngine(ctx), [ctx]);
  const economics = React.useMemo(
    () => computeAllEconomics(result.scenarios, hyp),
    [result.scenarios, hyp],
  );
  const geometries = React.useMemo(
    () => buildAllGeometries(result.scenarios, result.config),
    [result.scenarios, result.config],
  );
  const best = React.useMemo(() => pickBestForLandValue(economics), [economics]);

  const showEconomics = hyp.prixSortieM2 > 0;

  // ── Snapshot Copilot (best-effort) ─────────────────────────────────────────
  React.useEffect(() => {
    (async () => {
      try {
        const mod = await import("../shared/promoteurSnapshot.store");
        const bestScn = result.scenarios.find((s) => s.name === (best ?? "central"));
        mod.patchModule?.("massing" as never, {
          ok: !result.blocked,
          summary: result.blocked
            ? "Capacité non calculable (PLU incomplet)"
            : `${bestScn?.estimatedUnits ?? 0} logements · ${m2(bestScn?.sdpM2 ?? 0)} SDP (${best ?? "central"})`,
          data: { result, economics },
        } as never);
      } catch {
        /* snapshot non critique */
      }
    })();
  }, [result, economics, best]);

  // ── Export JSON (préparation PDF) ──────────────────────────────────────────
  const handleExport = React.useCallback(() => {
    const report = buildMassingReport(
      result,
      economics,
      zoneCode ? `Parcelle ${zoneCode}` : "Parcelle",
    );
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `massing-report-${studyId ?? "parcelle"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result, economics, zoneCode, studyId]);

  // ── Échelle commune pour la volumétrie ─────────────────────────────────────
  const maxSide = Math.max(
    1,
    ...geometries.map((g) => Math.max(g.boundingBox.widthM, g.boundingBox.heightM)),
  );
  const volScale = 70 / maxSide;

  return (
    <div
      style={{
        minHeight: "calc(100vh - 64px)",
        background: "#f8fafc",
        boxSizing: "border-box",
      }}
    >
      {/* ── Header ── */}
      <div
        style={{
          background: GRAD_PRO,
          padding: "26px 28px",
          color: "#fff",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexWrap: "wrap",
            gap: 14,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                opacity: 0.85,
              }}
            >
              Promoteur · Capacité
            </div>
            <h1 style={{ fontSize: 24, fontWeight: 800, margin: "4px 0 6px" }}>
              Massing 3D Promoteur
            </h1>
            <p style={{ fontSize: 13, opacity: 0.9, margin: 0, maxWidth: 560 }}>
              Que puis-je construire sur cette parcelle ? Quel scénario maximise la
              valeur du foncier ?
            </p>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={handleExport}
              style={ghostBtn}
              title="Exporter les données du rapport (JSON) — intégrable au PDF de synthèse"
            >
              ⬇ Exporter données
            </button>
            <button
              onClick={() =>
                navigate(
                  studyId
                    ? `/promoteur/bilan?study=${encodeURIComponent(studyId)}`
                    : "/promoteur/bilan",
                )
              }
              style={primaryBtn}
            >
              Voir le bilan →
            </button>
          </div>
        </div>
      </div>

      <div style={{ padding: "20px 28px", display: "grid", gap: 18 }}>
        {/* ── PARCELLE & CONTRAINTES ── */}
        <section>
          <SectionTitle>Parcelle & contraintes PLU</SectionTitle>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12,
            }}
          >
            <Card>
              <div style={{ display: "grid", gap: 12 }}>
                <NumField
                  label="Surface foncière"
                  value={surfaceM2}
                  onChange={setSurfaceM2}
                  suffix="m²"
                  step={10}
                  hint="Cumul des parcelles sélectionnées"
                />
                <label
                  style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}
                >
                  <span style={{ color: "#475569", fontWeight: 600 }}>Zone PLU</span>
                  <input
                    value={zoneCode}
                    onChange={(e) => setZoneCode(e.target.value)}
                    placeholder="ex. UC"
                    style={{
                      padding: "7px 9px",
                      borderRadius: 8,
                      border: "1px solid #e2e8f0",
                      fontSize: 13,
                    }}
                  />
                </label>
              </div>
            </Card>
            <Card>
              <div style={{ display: "grid", gap: 12 }}>
                <NumField
                  label="CES — emprise au sol max"
                  value={cesPct}
                  onChange={setCesPct}
                  suffix="%"
                  hint="Depuis le PLU (modifiable)"
                />
                <NumField
                  label="Hauteur max"
                  value={hauteurMaxM}
                  onChange={setHauteurMaxM}
                  suffix="m"
                  hint="Depuis le PLU (modifiable)"
                />
              </div>
            </Card>
            <Card>
              <div style={{ display: "grid", gap: 12 }}>
                <NumField
                  label="Stationnement"
                  value={parkParLgt}
                  onChange={setParkParLgt}
                  suffix="/ lgt"
                  step={0.5}
                />
                <div style={{ fontSize: 12, color: "#475569" }}>
                  <div>
                    Emprise max&nbsp;:{" "}
                    <b style={{ color: "#0f172a" }}>
                      {result.constraints.footprintMaxM2 != null
                        ? m2(result.constraints.footprintMaxM2)
                        : "—"}
                    </b>
                  </div>
                  <div>
                    Niveaux max&nbsp;:{" "}
                    <b style={{ color: "#0f172a" }}>
                      {result.constraints.niveauxMax != null
                        ? `R+${Math.max(0, result.constraints.niveauxMax - 1)}`
                        : "—"}
                    </b>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {result.constraints.warnings.length > 0 && (
            <div
              style={{
                marginTop: 10,
                fontSize: 11,
                color: "#b45309",
                background: "rgba(245,158,11,0.08)",
                border: "1px solid rgba(245,158,11,0.25)",
                borderRadius: 10,
                padding: "8px 12px",
              }}
            >
              {result.constraints.warnings.map((w, i) => (
                <div key={i}>⚠ {w}</div>
              ))}
            </div>
          )}
        </section>

        {/* ── RECOMMANDATION ── */}
        {!result.blocked && showEconomics && best && (
          <div
            style={{
              background: "rgba(124,111,205,0.08)",
              border: "1px solid rgba(124,111,205,0.3)",
              borderRadius: 12,
              padding: "12px 16px",
              fontSize: 13,
              color: "#4c3f9e",
            }}
          >
            🎯 Scénario maximisant la valeur du foncier&nbsp;:{" "}
            <b style={{ textTransform: "capitalize" }}>{best}</b> — charge foncière
            admissible{" "}
            <b>
              {eur(economics.find((e) => e.scenario === best)?.landValueMax ?? null)}
            </b>
            .
          </div>
        )}

        {/* ── SCENARIOS ── */}
        <section>
          <SectionTitle>Scénarios de capacité</SectionTitle>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 14,
            }}
          >
            {result.scenarios.map((s) => (
              <ScenarioCard
                key={s.name}
                scenario={s}
                highlight={s.name === best}
              />
            ))}
          </div>
        </section>

        {/* ── ECONOMIE ── */}
        <section>
          <SectionTitle>Économie promoteur</SectionTitle>
          <Card>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                gap: 12,
                marginBottom: showEconomics ? 16 : 0,
              }}
            >
              <NumField
                label="Prix de sortie"
                value={hyp.prixSortieM2}
                onChange={(v) => patchHyp({ prixSortieM2: v })}
                suffix="€/m² vendable"
                step={50}
                hint="À saisir ou injecter depuis le Valuation Engine"
              />
              <NumField
                label="Coût construction"
                value={hyp.coutConstructionM2}
                onChange={(v) => patchHyp({ coutConstructionM2: v })}
                suffix="€/m² SDP"
                step={50}
              />
              <NumField
                label="VRD"
                value={hyp.coutVrdM2}
                onChange={(v) => patchHyp({ coutVrdM2: v })}
                suffix="€/m² emprise"
                step={10}
              />
              <NumField
                label="Honoraires"
                value={Math.round(hyp.honorairesPct * 100)}
                onChange={(v) => patchHyp({ honorairesPct: v / 100 })}
                suffix="% CA"
              />
              <NumField
                label="Taxes"
                value={hyp.taxesM2Sdp}
                onChange={(v) => patchHyp({ taxesM2Sdp: v })}
                suffix="€/m² SDP"
                step={10}
              />
              <NumField
                label="Marge cible"
                value={Math.round(hyp.margeCiblePct * 100)}
                onChange={(v) => patchHyp({ margeCiblePct: v / 100 })}
                suffix="% CA"
              />
              <NumField
                label="Prix foncier (si connu)"
                value={hyp.foncierTotal ?? 0}
                onChange={(v) => patchHyp({ foncierTotal: v > 0 ? v : null })}
                suffix="€"
                step={10000}
                hint="Laisser 0 pour marge non calculée"
              />
            </div>

            {!showEconomics ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "18px 0",
                  color: "#94a3b8",
                  fontSize: 13,
                }}
              >
                Renseignez le <b>prix de sortie</b> pour afficher le bilan économique.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "#64748b" }}>
                      <th style={thCell}>Scénario</th>
                      <th style={thCell}>CA prévisionnel</th>
                      <th style={thCell}>Coûts hors foncier</th>
                      <th style={thCell}>Marge</th>
                      <th style={thCell}>Taux</th>
                      <th style={thCell}>Charge foncière max</th>
                    </tr>
                  </thead>
                  <tbody>
                    {economics.map((e) => (
                      <tr
                        key={e.scenario}
                        style={{
                          borderTop: "1px solid #f1f5f9",
                          background:
                            e.scenario === best ? "rgba(124,111,205,0.05)" : undefined,
                        }}
                      >
                        <td style={{ ...tdCell, textTransform: "capitalize", fontWeight: 600 }}>
                          {e.scenario}
                        </td>
                        <td style={tdCell}>{eur(e.revenue)}</td>
                        <td style={tdCell}>{eur(e.coutsHorsFoncier)}</td>
                        <td
                          style={{
                            ...tdCell,
                            color:
                              e.margin == null
                                ? "#94a3b8"
                                : e.margin >= 0
                                  ? "#15803d"
                                  : "#dc2626",
                            fontWeight: 600,
                          }}
                        >
                          {eur(e.margin)}
                        </td>
                        <td style={tdCell}>{pct(e.marginPct)}</td>
                        <td
                          style={{
                            ...tdCell,
                            fontWeight: 700,
                            color: e.viable ? "#0f172a" : "#dc2626",
                          }}
                        >
                          {eur(e.landValueMax)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </section>

        {/* ── VOLUMETRIE ── */}
        <section>
          <SectionTitle>Volumétrie simplifiée</SectionTitle>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 14,
            }}
          >
            {geometries.map((g) => (
              <Card key={g.scenario}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    textTransform: "capitalize",
                    color: SCENARIO_COLORS[g.scenario],
                    marginBottom: 6,
                  }}
                >
                  {g.scenario}
                </div>
                <svg
                  viewBox="-90 -120 180 150"
                  width="100%"
                  height={150}
                  style={{ display: "block" }}
                >
                  <IsoBlock
                    widthM={g.boundingBox.widthM}
                    depthM={g.boundingBox.depthM}
                    heightM={g.boundingBox.heightM}
                    levelHeightsM={g.levelHeightsM}
                    scale={volScale}
                    color={SCENARIO_COLORS[g.scenario]}
                  />
                </svg>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                  {g.levels > 0 ? `R+${g.levels - 1}` : "—"} · {g.heightM} m ·{" "}
                  {m2(g.footprintM2)} emprise
                </div>
              </Card>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

// ── ScenarioCard ──────────────────────────────────────────────────────────────

const ScenarioCard: React.FC<{
  scenario: MassingScenario;
  highlight: boolean;
}> = ({ scenario: s, highlight }) => (
  <Card
    style={{
      borderColor: highlight ? SCENARIO_COLORS[s.name] : "#e2e8f0",
      boxShadow: highlight
        ? `0 0 0 2px ${SCENARIO_COLORS[s.name]}33`
        : "0 1px 3px rgba(15,23,42,0.04)",
    }}
  >
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div
        style={{
          fontSize: 14,
          fontWeight: 800,
          textTransform: "capitalize",
          color: SCENARIO_COLORS[s.name],
        }}
      >
        {s.label}
      </div>
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "#64748b",
          background: "#f1f5f9",
          borderRadius: 6,
          padding: "2px 7px",
        }}
      >
        {Math.round(s.capacityFactor * 100)}% capacité
      </span>
    </div>

    <div style={{ display: "grid", gap: 7, marginTop: 12, fontSize: 13 }}>
      <KpiRow label="Emprise" value={m2(s.footprintM2)} />
      <KpiRow label="Niveaux" value={s.levels > 0 ? `R+${s.levels - 1}` : "—"} />
      <KpiRow label="Hauteur" value={`${s.heightM} m`} />
      <KpiRow label="SDP" value={m2(s.sdpM2)} />
      <KpiRow label="Surface vendable" value={m2(s.saleableAreaM2)} />
      <KpiRow label="Logements" value={String(s.estimatedUnits)} strong />
      <KpiRow label="Stationnement" value={`${s.parkingRequired} pl.`} />
    </div>

    <div
      style={{
        marginTop: 12,
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 11,
        color: "#64748b",
      }}
    >
      <span>Fiabilité</span>
      <div
        style={{
          flex: 1,
          height: 6,
          background: "#f1f5f9",
          borderRadius: 99,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.round(s.confidence * 100)}%`,
            height: "100%",
            background: SCENARIO_COLORS[s.name],
          }}
        />
      </div>
      <span style={{ fontWeight: 700, color: "#0f172a" }}>
        {Math.round(s.confidence * 100)}%
      </span>
    </div>

    {s.notes.length > 0 && (
      <div style={{ marginTop: 8, fontSize: 10, color: "#b45309" }}>
        {s.notes.map((n, i) => (
          <div key={i}>· {n}</div>
        ))}
      </div>
    )}
  </Card>
);

const KpiRow: React.FC<{ label: string; value: string; strong?: boolean }> = ({
  label,
  value,
  strong,
}) => (
  <div style={{ display: "flex", justifyContent: "space-between" }}>
    <span style={{ color: "#64748b" }}>{label}</span>
    <span style={{ color: "#0f172a", fontWeight: strong ? 800 : 600 }}>{value}</span>
  </div>
);

// ── Styles inline ───────────────────────────────────────────────────────────

const thCell: React.CSSProperties = { padding: "8px 10px", fontWeight: 700, fontSize: 12 };
const tdCell: React.CSSProperties = { padding: "9px 10px", color: "#334155" };
const primaryBtn: React.CSSProperties = {
  padding: "9px 16px",
  borderRadius: 10,
  border: "none",
  background: "rgba(255,255,255,0.95)",
  color: ACCENT_PRO,
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer",
};
const ghostBtn: React.CSSProperties = {
  padding: "9px 16px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.5)",
  background: "transparent",
  color: "#fff",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
};