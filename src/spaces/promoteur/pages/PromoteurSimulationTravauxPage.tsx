// src/spaces/promoteur/pages/PromoteurSimulationTravauxPage.tsx
//
// Estimation du coût de construction NEUVE (terrain nu) — espace Promoteur.
// Remplace l'ancienne simulation « réhabilitation » (non pertinente en neuf).
// Sortie : coût €/m² SDP (fourchette low/central/high) + décomposition par postes,
// pilotée par la région, la complexité chantier et les choix constructifs
// (niveaux, toiture, volets, balcons/terrasses, parking).

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  Calculator,
  Car,
  Gauge,
  HardHat,
  Info,
  Layers,
  MapPin,
  Minus,
  Plus,
  Ruler,
  TrendingUp,
} from "lucide-react";

import {
  COMPLEXITES,
  estimerCoutConstruction,
  GABARITS_ASCENSEUR,
  GAMMES,
  HYPOTHESES_DEFAUT,
  PARKINGS,
  REGIONS,
  TOITURES,
  TYPOLOGIES,
  VOLETS,
  type Complexite,
  type GabaritAscenseur,
  type Gamme,
  type Region,
  type TypeParking,
  type TypeToiture,
  type TypeVolets,
  type Typologie,
} from "../lib/constructionCostModel";
import {
  setActiveCopilotContext,
  clearActiveCopilotContext,
} from "../../copilot/store/activeCopilotContext.store";

const PROMOTEUR_GRADIENT =
  "linear-gradient(90deg, #6f5bd6 0%, #8d78df 50%, #b39ddb 100%)";
const ACCENT = "#5247b8";

const nf0 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const eur = (n: number): string =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);

function parseNum(v: string): number {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export default function PromoteurSimulationTravauxPage() {
  const [typologie, setTypologie] = useState<Typologie>("collectif");
  const [gamme, setGamme] = useState<Gamme>("standard");
  const [sdp, setSdp] = useState<number>(2000);

  const [region, setRegion] = useState<Region>("national_moyen");
  const [complexite, setComplexite] = useState<Complexite>("normal");

  const [niveaux, setNiveaux] = useState<number>(HYPOTHESES_DEFAUT.niveaux);
  const [typeToiture, setTypeToiture] = useState<TypeToiture>(HYPOTHESES_DEFAUT.typeToiture);
  const [typeVolets, setTypeVolets] = useState<TypeVolets>(HYPOTHESES_DEFAUT.typeVolets);
  const [surfaceBalcons, setSurfaceBalcons] = useState<number>(0);
  const [surfaceTerrasses, setSurfaceTerrasses] = useState<number>(0);
  const [avecAscenseur, setAvecAscenseur] = useState<boolean>(false);
  const [nbCages, setNbCages] = useState<number>(0); // 0 = auto
  const [gabaritAscenseur, setGabaritAscenseur] = useState<GabaritAscenseur>("basique");

  const [parkingPlaces, setParkingPlaces] = useState<number>(0);
  const [typeParking, setTypeParking] = useState<TypeParking>("aucun");

  const [vrdPct, setVrdPct] = useState<number>(HYPOTHESES_DEFAUT.vrdPct * 100);
  const [honorairesPct, setHonorairesPct] = useState<number>(HYPOTHESES_DEFAUT.honorairesPct * 100);
  const [aleasPct, setAleasPct] = useState<number>(HYPOTHESES_DEFAUT.aleasPct * 100);

  const result = useMemo(
    () =>
      estimerCoutConstruction({
        typologie,
        gamme,
        sdp,
        niveaux,
        typeToiture,
        typeVolets,
        surfaceBalcons,
        surfaceTerrasses,
        vrdPct: vrdPct / 100,
        honorairesPct: honorairesPct / 100,
        aleasPct: aleasPct / 100,
        parkingPlaces,
        region,
        complexite,
        typeParking,
        avecAscenseur,
        nbCages,
        gabaritAscenseur,
      }),
    [
      typologie, gamme, sdp, niveaux, typeToiture, typeVolets,
      surfaceBalcons, surfaceTerrasses, vrdPct, honorairesPct, aleasPct,
      parkingPlaces, region, complexite, typeParking, avecAscenseur, nbCages, gabaritAscenseur,
    ]
  );

  // ── Injection du contexte Copilot : la page "pousse" ses chiffres pour que
  //    le Copilot les voie (le LLM ne lit jamais le DOM directement).
  useEffect(() => {
    if (sdp <= 0) {
      clearActiveCopilotContext();
      return;
    }

    const labelOf = (
      arr: ReadonlyArray<{ id: string; label: string }>,
      id: string,
    ): string => arr.find((x) => x.id === id)?.label ?? id;

    const postesDetail = result.postes
      .map((p) => `${p.label} : ${Math.round(p.ratioM2)} €/m² (${Math.round(p.montant)} €)`)
      .join(" · ");

    setActiveCopilotContext({
      vertical: "promoteur",
      route: "/promoteur/simulation-travaux",
      surface: sdp,
      pageContext: {
        pathname: "/promoteur/simulation-travaux",
        space: "promoteur",
        mode: "cout_construction",
        tab: "simulation-travaux",
      },
      pageSnapshot: {
        page: "Coût de construction (Promoteur · construction neuve)",
        typologie: labelOf(TYPOLOGIES, typologie),
        gamme: labelOf(GAMMES, gamme),
        region: labelOf(REGIONS, region),
        complexite: labelOf(COMPLEXITES, complexite),
        sdp_m2: sdp,
        niveaux_hors_sol: niveaux,
        toiture: labelOf(TOITURES, typeToiture),
        volets: labelOf(VOLETS, typeVolets),
        balcons_m2: surfaceBalcons || null,
        terrasses_m2: surfaceTerrasses || null,
        nb_ascenseurs: result.nbAscenseurs || 0,
        parking_places: parkingPlaces || null,
        parking_type: parkingPlaces > 0 ? labelOf(PARKINGS, typeParking) : null,
        vrd_pct: vrdPct,
        honoraires_pct: honorairesPct,
        aleas_pct: aleasPct,
        cout_construction_eur_m2: Math.round(result.coutM2),
        cout_m2_fourchette_basse: Math.round(result.fourchette.low.coutM2),
        cout_m2_fourchette_haute: Math.round(result.fourchette.high.coutM2),
        total_ht_eur: Math.round(result.totalHT),
        total_ht_fourchette_basse: Math.round(result.fourchette.low.total),
        total_ht_fourchette_haute: Math.round(result.fourchette.high.total),
        sous_total_batiment_eur: Math.round(result.sousTotalBatiment),
        postes_detail: postesDetail || null,
        avertissements: result.warnings.map((w) => w.message).join(" · ") || null,
      },
    });
  }, [
    typologie, gamme, region, complexite, sdp, niveaux, typeToiture, typeVolets,
    surfaceBalcons, surfaceTerrasses, parkingPlaces, typeParking,
    vrdPct, honorairesPct, aleasPct, result,
  ]);

  // Nettoyage au démontage : le Copilot ne garde pas les chiffres hors de la page.
  useEffect(() => {
    return () => clearActiveCopilotContext();
  }, []);

  const maxMontant = Math.max(1, ...result.postes.map((p) => p.montant));

  return (
    <div className="space-y-5 py-4">
      {/* ── En-tête ─────────────────────────────────────────────── */}
      <div className="rounded-3xl px-6 py-7 text-white shadow-sm" style={{ background: PROMOTEUR_GRADIENT }}>
        <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold tracking-wide">
          <Building2 className="h-3.5 w-3.5" />
          PROMOTEUR · CONSTRUCTION NEUVE
        </div>
        <h1 className="text-3xl font-bold">Coût de construction</h1>
        <p className="mt-1 max-w-2xl text-sm text-white/90">
          Estimez le coût de construction d'une opération neuve sur terrain nu et
          obtenez un prix au m² de surface de plancher.
        </p>
      </div>

      {/* ── Avertissement ───────────────────────────────────────── */}
      <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
        <p>
          <span className="font-semibold">Estimation indicative HT</span> — hors
          foncier, démolition, désamiantage, fondations spéciales, taxes
          (TA, RAP), assurances et coûts de portage. À valider par un économiste
          de la construction.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(320px,380px)_1fr]">
        {/* ── Colonne paramètres ────────────────────────────────── */}
        <div className="space-y-5">
          {/* Typologie */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <SectionTitle>Typologie</SectionTitle>
            <div className="space-y-2">
              {TYPOLOGIES.map((t) => {
                const active = t.id === typologie;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTypologie(t.id)}
                    className="w-full rounded-xl border px-3 py-2.5 text-left transition-all"
                    style={active ? { borderColor: ACCENT, background: ACCENT + "0F" } : { borderColor: "#e2e8f0", background: "white" }}
                  >
                    <div className="text-sm font-semibold" style={{ color: active ? ACCENT : "#0f172a" }}>{t.label}</div>
                    <div className="text-xs text-slate-500">{t.description}</div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Gamme */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <SectionTitle>Niveau de prestation</SectionTitle>
            <Segmented
              options={GAMMES.map((g) => ({ id: g.id, label: g.label, title: g.description }))}
              value={gamme}
              onChange={(v) => setGamme(v as Gamme)}
              cols={3}
            />
          </section>

          {/* Contexte : région + complexité */}
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
            <SectionTitle>Contexte</SectionTitle>

            <SelectField
              icon={<MapPin className="h-4 w-4 text-slate-400" />}
              label="Région / marché"
              value={region}
              onChange={(v) => setRegion(v as Region)}
              options={REGIONS.map((r) => ({ id: r.id, label: r.label }))}
            />

            <div>
              <span className="mb-1 flex items-center gap-1.5 text-sm font-medium text-slate-700">
                <Gauge className="h-4 w-4 text-slate-400" />
                Complexité chantier
              </span>
              <Segmented
                options={COMPLEXITES.map((c) => ({ id: c.id, label: c.label, title: c.description }))}
                value={complexite}
                onChange={(v) => setComplexite(v as Complexite)}
                cols={2}
              />
            </div>
          </section>

          {/* Bâtiment */}
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
            <SectionTitle>Bâtiment</SectionTitle>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                  <Layers className="h-4 w-4 text-slate-400" />
                  Niveaux hors sol
                </span>
                <span className="text-sm font-semibold" style={{ color: ACCENT }}>
                  R+{Math.max(0, niveaux - 1)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <StepBtn onClick={() => setNiveaux((n) => Math.max(1, n - 1))} aria="Retirer un niveau"><Minus className="h-4 w-4" /></StepBtn>
                <input
                  type="number"
                  min={1}
                  value={niveaux || ""}
                  onChange={(e) => setNiveaux(Math.max(1, Math.round(parseNum(e.target.value))))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-center text-sm outline-none focus:border-[color:var(--acc)]"
                  style={{ ["--acc" as string]: ACCENT }}
                />
                <StepBtn onClick={() => setNiveaux((n) => n + 1)} aria="Ajouter un niveau"><Plus className="h-4 w-4" /></StepBtn>
              </div>
            </div>

            {/* Ascenseur : Sans / Avec (forcé si obligatoire, collectif R+3+) */}
            {result.ascenseurPossible ? (
              <div>
                <span className="mb-1 block text-sm font-medium text-slate-700">Ascenseur</span>
                <Segmented
                  cols={2}
                  value={result.nbAscenseurs > 0 ? "avec" : "sans"}
                  onChange={(v) => { if (!result.ascenseurObligatoire) setAvecAscenseur(v === "avec"); }}
                  options={[{ id: "sans", label: "Sans" }, { id: "avec", label: "Avec" }]}
                />
                {result.ascenseurObligatoire && (
                  <div className="mt-1 text-[11px] text-slate-400">Obligatoire dès R+3 (collectif)</div>
                )}

                {result.nbAscenseurs > 0 && (
                  <div className="mt-3 space-y-3">
                    <div>
                      <span className="mb-1 block text-sm font-medium text-slate-700">Nombre de cages</span>
                      <input
                        type="number"
                        min={0}
                        value={nbCages || ""}
                        placeholder={String(result.nbAscenseurs)}
                        onChange={(e) => setNbCages(Math.max(0, Math.round(parseNum(e.target.value))))}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[color:var(--acc)]"
                        style={{ ["--acc" as string]: ACCENT }}
                      />
                      <div className="text-[11px] text-slate-400">
                        → {result.nbAscenseurs} cage{result.nbAscenseurs > 1 ? "s" : ""} · {niveaux} arrêts{nbCages > 0 ? "" : " (auto)"}
                      </div>
                    </div>
                    <SelectField
                      label="Gabarit cabine"
                      value={gabaritAscenseur}
                      onChange={(v) => setGabaritAscenseur(v as GabaritAscenseur)}
                      options={GABARITS_ASCENSEUR.map((g) => ({ id: g.id, label: g.label }))}
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="text-[11px] text-slate-400">
                Ascenseur indisponible — aucun étage (RDC seul)
              </div>
            )}

            <div>
              <span className="mb-1 block text-sm font-medium text-slate-700">Toiture</span>
              <Segmented
                options={TOITURES.map((t) => ({ id: t.id, label: t.label }))}
                value={typeToiture}
                onChange={(v) => setTypeToiture(v as TypeToiture)}
                cols={2}
              />
            </div>

            <div>
              <span className="mb-1 block text-sm font-medium text-slate-700">Volets</span>
              <Segmented
                options={VOLETS.map((v) => ({ id: v.id, label: v.label }))}
                value={typeVolets}
                onChange={(v) => setTypeVolets(v as TypeVolets)}
                cols={2}
              />
            </div>
          </section>

          {/* Surfaces & ouvrages */}
          <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
            <SectionTitle>Surfaces & ouvrages</SectionTitle>

            <NumField icon={<Ruler className="h-4 w-4 text-slate-400" />} label="Surface de plancher (m²)" value={sdp} onChange={setSdp} />

            <div className="grid grid-cols-2 gap-3">
              <NumField label="Balcons (m²)" value={surfaceBalcons} onChange={setSurfaceBalcons} />
              <NumField label="Terrasses (m²)" value={surfaceTerrasses} onChange={setSurfaceTerrasses} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <NumField icon={<Car className="h-4 w-4 text-slate-400" />} label="Places parking" value={parkingPlaces} onChange={setParkingPlaces} />
              <SelectField
                label="Type de parking"
                value={typeParking}
                onChange={(v) => setTypeParking(v as TypeParking)}
                options={PARKINGS.map((p) => ({ id: p.id, label: p.label }))}
              />
            </div>
          </section>

          {/* Hypothèses % */}
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
            <SectionTitle>Hypothèses</SectionTitle>
            <SliderPct label="VRD & aménagements" hint="% du coût bâtiment" min={0} max={20} value={vrdPct} onChange={setVrdPct} />
            <SliderPct label="Honoraires (MOE, BET, CT)" hint="% des travaux" min={5} max={18} value={honorairesPct} onChange={setHonorairesPct} />
            <SliderPct label="Aléas & imprévus" hint="% travaux + honoraires" min={0} max={15} value={aleasPct} onChange={setAleasPct} />
          </section>
        </div>

        {/* ── Colonne résultats ─────────────────────────────────── */}
        <div className="space-y-5">
          {/* Bandeau chiffre clé */}
          <section className="grid grid-cols-1 gap-4 rounded-2xl border border-slate-200 bg-white p-6 sm:grid-cols-2">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <TrendingUp className="h-4 w-4" />
                Coût de construction
              </div>
              <div className="mt-1 text-4xl font-bold" style={{ color: ACCENT }}>
                {sdp > 0 ? nf0.format(result.coutM2) : "—"}
                <span className="ml-1 text-lg font-semibold text-slate-400">€/m²</span>
              </div>
              <div className="mt-1 text-sm text-slate-500">
                {sdp > 0
                  ? <>fourchette {nf0.format(result.fourchette.low.coutM2)} – {nf0.format(result.fourchette.high.coutM2)} €/m²</>
                  : <>sur — m² SDP</>}
              </div>
              {sdp > 0 && (
                <div className="mt-0.5 text-xs text-slate-400">sur {nf0.format(sdp)} m² SDP</div>
              )}
            </div>
            <div className="sm:text-right">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400 sm:justify-end">
                <Calculator className="h-4 w-4" />
                Total HT
              </div>
              <div className="mt-1 text-4xl font-bold text-slate-900">{sdp > 0 ? eur(result.totalHT) : "—"}</div>
              <div className="mt-1 text-sm text-slate-500">
                {sdp > 0
                  ? <>{eur(result.fourchette.low.total)} – {eur(result.fourchette.high.total)}</>
                  : <>—</>}
              </div>
              {sdp > 0 && (
                <div className="mt-0.5 text-xs text-slate-400">dont bâtiment {eur(result.sousTotalBatiment)}</div>
              )}
            </div>
          </section>

          {/* Avertissements métier */}
          {result.warnings.length > 0 && (
            <section className="space-y-2">
              {result.warnings.map((w) => {
                const cls =
                  w.level === "error"
                    ? "border-red-200 bg-red-50 text-red-800"
                    : w.level === "warning"
                      ? "border-amber-200 bg-amber-50 text-amber-900"
                      : "border-slate-200 bg-slate-50 text-slate-600";
                const Icon = w.level === "info" ? Info : AlertTriangle;
                return (
                  <div key={w.code} className={`flex gap-2 rounded-xl border px-3 py-2 text-sm ${cls}`}>
                    <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{w.message}</span>
                  </div>
                );
              })}
            </section>
          )}

          {/* Décomposition par postes */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="mb-4 flex items-center gap-2">
              <HardHat className="h-5 w-5" style={{ color: ACCENT }} />
              <h2 className="text-base font-semibold text-slate-900">Décomposition par postes</h2>
            </div>

            {sdp <= 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">
                Renseignez une surface de plancher pour voir l'estimation.
              </p>
            ) : (
              <div className="space-y-3">
                {result.postes.map((p) => {
                  const share = result.totalHT > 0 ? p.montant / result.totalHT : 0;
                  return (
                    <div key={p.id}>
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="font-medium text-slate-700">{p.label}</span>
                        <span className="tabular-nums text-slate-500">
                          {nf0.format(p.ratioM2)} €/m²
                          <span className="ml-3 font-semibold text-slate-900">{eur(p.montant)}</span>
                        </span>
                      </div>
                      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${(p.montant / maxMontant) * 100}%`, background: ACCENT, opacity: 0.35 + share }}
                        />
                      </div>
                    </div>
                  );
                })}

                {/* Sous-totaux (ventilation) */}
                <div className="mt-4 space-y-1.5 border-t border-slate-100 pt-4 text-sm">
                  <RowTotal label="Sous-total bâtiment" value={eur(result.ventilation.batiment)} />
                  {result.ventilation.ouvragesAnnexes > 0 && (
                    <RowTotal label="Ouvrages annexes" value={eur(result.ventilation.ouvragesAnnexes)} />
                  )}
                  <RowTotal label="Sous-total travaux" value={eur(result.ventilation.sousTotalTravaux)} />
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                  <span className="text-sm font-semibold text-slate-900">Total HT</span>
                  <span className="text-lg font-bold" style={{ color: ACCENT }}>{eur(result.totalHT)}</span>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/* ── Sous-composants ───────────────────────────────────────────── */

function SectionTitle(props: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">{props.children}</h2>
  );
}

function RowTotal(props: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-slate-500">
      <span>{props.label}</span>
      <span className="font-medium text-slate-700">{props.value}</span>
    </div>
  );
}

function Segmented(props: {
  options: { id: string; label: string; title?: string }[];
  value: string;
  onChange: (v: string) => void;
  cols: number;
}) {
  const { options, value, onChange, cols } = props;
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            title={o.title}
            onClick={() => onChange(o.id)}
            className="rounded-xl border px-2 py-2 text-sm font-medium transition-all"
            style={active ? { borderColor: ACCENT, background: ACCENT, color: "white" } : { borderColor: "#e2e8f0", color: "#475569" }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function SelectField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { id: string; label: string }[];
  icon?: React.ReactNode;
}) {
  const { label, value, onChange, options, icon } = props;
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1.5 text-sm font-medium text-slate-700">
        {icon}
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[color:var(--acc)]"
        style={{ ["--acc" as string]: ACCENT }}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function NumField(props: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  icon?: React.ReactNode;
}) {
  const { label, value, onChange, icon } = props;
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1.5 text-sm font-medium text-slate-700">
        {icon}
        {label}
      </span>
      <input
        type="number"
        min={0}
        value={value || ""}
        onChange={(e) => onChange(Math.max(0, parseNum(e.target.value)))}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[color:var(--acc)]"
        style={{ ["--acc" as string]: ACCENT }}
      />
    </label>
  );
}

function StepBtn(props: { onClick: () => void; aria: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={props.aria}
      onClick={props.onClick}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-all hover:border-slate-300 hover:bg-slate-50"
    >
      {props.children}
    </button>
  );
}

function SliderPct(props: {
  label: string;
  hint: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
}) {
  const { label, hint, min, max, value, onChange } = props;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <span className="text-sm font-semibold tabular-nums" style={{ color: ACCENT }}>{nf0.format(value)} %</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(parseNum(e.target.value))}
        className="w-full accent-[color:var(--acc)]"
        style={{ ["--acc" as string]: ACCENT }}
      />
      <div className="text-[11px] text-slate-400">{hint}</div>
    </div>
  );
}