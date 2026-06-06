// src/spaces/promoteur/pages/ProgrammationPage.tsx

import { useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle, Target, Loader2 } from "lucide-react";
import { patchModule, getSnapshot }    from "../shared/promoteurSnapshot.store";
import { usePromoteurStudy }           from "../shared/usePromoteurStudy";
import { GRAD_PRO, ACCENT_PRO } from "../shared/promoteurDesign.tokens";
import {
  PromoteurPageHero,
  HeroPrimaryButton,
} from "../shared/components/PromoteurPageHero";

// ─── Types ────────────────────────────────────────────────────────────────────

type TypeProjet = "collectif" | "maisons_groupees" | "residence_senior" | "mixte";
type ComplianceStatus = "conforme" | "a_verifier" | "non_conforme";
type ViabiliteStatus = "viable" | "conditions" | "non_viable";

export interface ProgrammationSnapshot {
  typeProjet:     TypeProjet;
  niveaux:        number;
  nbLogements:    number;
  empriseSol:     number;
  typologies:     { T1: number; T2: number; T3: number; T4: number; T5: number };
  surfacesTypologies: { T1: number; T2: number; T3: number; T4: number; T5: number };
  surfaceCommerce: number;
  nbParkings:     number;
  espacesVerts:   number;
  prixVenteLog:   number;
  prixVenteCom:   number;
  coutConstrLog:  number;
  coutConstrCom:  number;
  fraisPct:       number;
  margeCiblePct:  number;
  sdpLogement:    number;
  sdpCommerce:    number;
  sdpTotale:      number;
  caTotal:        number;
  caLogement:     number;
  caCommerce:     number;
  coutTravaux:    number;
  coutTotal:      number;
  margeBrute:     number;
  tauxMarge:      number;
  pluViabilite:   ViabiliteStatus;
  updatedAt:      string;
}

const TYPE_PROJET_OPTIONS: Array<{ label: string; value: TypeProjet }> = [
  { label: "Collectif (logements)",          value: "collectif" },
  { label: "Maisons groupées",               value: "maisons_groupees" },
  { label: "Résidence senior",               value: "residence_senior" },
  { label: "Mixte logements + commerce",     value: "mixte" },
];

const NIVEAUX_OPTIONS: Array<{ label: string; value: string }> = [
  { label: "RDC seulement (1 niveau)", value: "1" },
  ...Array.from({ length: 19 }, (_, i) => ({
    label: `R+${i + 1} (${i + 2} niveaux)`,
    value: String(i + 2),
  })),
];

// ─── Helpers format ───────────────────────────────────────────────────────────

function fmt(n: number, opts?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat("fr-FR", opts).format(n);
}
function fmtEur(n: number): string {
  return fmt(n, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
}
function fmtPct(n: number): string {
  return fmt(n, { maximumFractionDigits: 1 }) + "\u00a0%";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionCard({ title, children, style }: {
  title: string; children: React.ReactNode; style?: React.CSSProperties;
}) {
  return (
    <div style={{
      background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 12,
      padding: "20px 24px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)", ...style,
    }}>
      <h2 style={{
        margin: "0 0 16px", fontSize: 13, fontWeight: 700, color: "#6D28D9",
        textTransform: "uppercase", letterSpacing: "0.06em",
        borderBottom: "2px solid #EDE9FE", paddingBottom: 10,
      }}>
        {title}
      </h2>
      {children}
    </div>
  );
}

function SubHeading({ label }: { label: string }) {
  return (
    <p style={{
      margin: "14px 0 8px", fontSize: 11, fontWeight: 700, color: "#7C3AED",
      textTransform: "uppercase", letterSpacing: "0.05em",
    }}>
      {label}
    </p>
  );
}

function FieldRow({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "flex-start",
      padding: "7px 0", borderBottom: "1px solid #F3F4F6",
    }}>
      <span style={{ fontSize: 13, color: "#6B7280", flexShrink: 0, paddingRight: 12 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: "#111827", textAlign: "right" }}>
        {value}
        {note && <span style={{ fontSize: 11, color: "#9CA3AF", display: "block" }}>{note}</span>}
      </span>
    </div>
  );
}

function KpiCard({ label, value, sub, accent }: {
  label: string; value: string; sub?: string; accent?: boolean;
}) {
  return (
    <div style={{
      background: accent ? "#F5F3FF" : "#F9FAFB",
      border: `1px solid ${accent ? "#DDD6FE" : "#E5E7EB"}`,
      borderRadius: 10, padding: "12px 14px",
    }}>
      <p style={{ margin: 0, fontSize: 10, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </p>
      <p style={{ margin: "3px 0 0", fontSize: 17, fontWeight: 800, color: accent ? "#6D28D9" : "#111827", lineHeight: 1.1 }}>
        {value}
      </p>
      {sub && <p style={{ margin: "3px 0 0", fontSize: 11, color: "#9CA3AF" }}>{sub}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: ComplianceStatus }) {
  const map: Record<ComplianceStatus, { bg: string; text: string; border: string; label: string }> = {
    conforme:     { bg: "#F0FDF4", text: "#15803D", border: "#BBF7D0", label: "✓ Conforme" },
    a_verifier:   { bg: "#FFFBEB", text: "#B45309", border: "#FDE68A", label: "⚠ À vérifier" },
    non_conforme: { bg: "#FEF2F2", text: "#B91C1C", border: "#FECACA", label: "✗ Non conforme" },
  };
  const s = map[status];
  return (
    <span style={{
      display: "inline-block", padding: "3px 10px", borderRadius: 9999,
      fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
      background: s.bg, color: s.text, border: `1px solid ${s.border}`,
    }}>
      {s.label}
    </span>
  );
}

function NumberInput({ label, value, onChange, unit, min, max, step }: {
  label: string; value: number; onChange: (v: number) => void;
  unit?: string; min?: number; max?: number; step?: number;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 3 }}>
        {label}
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input
          type="number" value={value} min={min ?? 0} max={max} step={step ?? 1}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1px solid #D1D5DB", fontSize: 13, color: "#111827", outline: "none", background: "#FAFAFA", fontFamily: "inherit" }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "#7C3AED")}
          onBlur={(e)  => (e.currentTarget.style.borderColor = "#D1D5DB")}
        />
        {unit && <span style={{ fontSize: 12, color: "#9CA3AF", minWidth: 38, textAlign: "left" }}>{unit}</span>}
      </div>
    </div>
  );
}

function SelectInput<T extends string>({ label, value, onChange, options }: {
  label: string; value: T; onChange: (v: T) => void;
  options: Array<{ label: string; value: T }>;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 3 }}>
        {label}
      </label>
      <select
        value={value} onChange={(e) => onChange(e.target.value as T)}
        style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #D1D5DB", fontSize: 13, color: "#111827", background: "#FAFAFA", outline: "none", fontFamily: "inherit" }}
        onFocus={(e) => (e.currentTarget.style.borderColor = "#7C3AED")}
        onBlur={(e)  => (e.currentTarget.style.borderColor = "#D1D5DB")}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function ConclusionCard({ status, reasons }: { status: ViabiliteStatus; reasons: string[] }) {
  const map: Record<ViabiliteStatus, { bg: string; border: string; text: string; title: string; icon: string }> = {
    viable:     { bg: "#F0FDF4", border: "#86EFAC", text: "#15803D", title: "Projet viable en l'état",       icon: "✅" },
    conditions: { bg: "#FFFBEB", border: "#FDE68A", text: "#B45309", title: "Projet viable sous conditions", icon: "⚠️" },
    non_viable: { bg: "#FEF2F2", border: "#FECACA", text: "#B91C1C", title: "Projet non viable",            icon: "❌" },
  };
  const s = map[status];
  return (
    <div style={{ background: s.bg, border: `2px solid ${s.border}`, borderRadius: 10, padding: "18px 22px" }}>
      <p style={{ margin: "0 0 10px", fontSize: 18, fontWeight: 800, color: s.text }}>{s.icon}&nbsp; {s.title}</p>
      <ul style={{ margin: 0, paddingLeft: 20 }}>
        {reasons.map((r, i) => <li key={i} style={{ fontSize: 13, color: s.text, marginBottom: 4 }}>{r}</li>)}
      </ul>
    </div>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────

export default function ProgrammationPage() {
  const [searchParams] = useSearchParams();
  const studyId = searchParams.get("study");
  const { study, loadState } = usePromoteurStudy(studyId);

  const foncierData = useMemo(() => {
    const fromStudy = (study as any)?.foncier;
    const fromSnap  = getSnapshot()?.foncier as any;
    return fromStudy ?? fromSnap ?? null;
  }, [study]);

  const terrain = useMemo(() => {
    const f = foncierData;
    if (!f) return { surfaceM2: 0, prixVendeur: 0, codePostal: "", commune: "", typeBien: "", adresse: "", pluDisponible: false };

    const featureProps = f.parcels_raw?.[0]?.feature?.properties ?? {};
    const inseeFromParcel = (() => {
      const id = f.focus_id ?? f.parcel_ids?.[0] ?? "";
      return typeof id === "string" && id.length >= 5 ? id.slice(0, 5) : "";
    })();
    const commune =
      f.commune_nom ?? f.commune ?? f.ville ?? f.city ??
      f.nom_commune ?? f.libelle_commune ??
      featureProps.nom_com ?? featureProps.nom_commune ??
      featureProps.commune ?? featureProps.libelle_commune ??
      (inseeFromParcel ? `INSEE ${inseeFromParcel}` : "");
    const codePostal = f.code_postal ?? f.codePostal ?? f.cp ?? f.zip ?? f.parcels_raw?.[0]?.feature?.properties?.code_postal ?? "";
    const adresse = f.adresse ?? f.address ?? f.label ?? f.source_label ?? f.libelle ?? f.adresse_complete ?? f.focus_id ?? "";
    const typeBien = f.type_bien ?? f.typeBien ?? f.type ?? f.nature ?? "Terrain";
    const prixVendeur = f.prix_foncier ?? f.prixVendeur ?? f.prix_vendeur ?? f.prix ?? f.price ?? f.valeur ?? 0;
    return {
      surfaceM2: f.surface_m2 ?? f.surfaceM2 ?? f.surface ?? 0,
      prixVendeur, codePostal, commune, typeBien, adresse,
      pluDisponible: Boolean((study as any)?.plu ?? getSnapshot()?.plu),
    };
  }, [foncierData, study]);

  const plu = useMemo(() => {
    const fromStudy = (study as any)?.plu;
    const fromSnap  = getSnapshot()?.plu as any;
    const p = fromStudy ?? fromSnap ?? null;

    if (!p) return {
      zone: "", description: "", hauteurEgoutM: null, hauteurFaitageM: null,
      hauteurMaxM: 0, empriseMaxPct: 0, empriseNote: null,
      reculVoirie: null, reculVoirieNote: null, reculLimites: null, reculLimitesNote: null,
      parkingParLogement: 1, espaceVertMinPct: 0, pleineTerreMinPct: null,
      coefficientOccupSol: null, cosNote: null,
      extra: [] as Array<{ label: string; value: string | null; note: string | null }>,
    };

    const rs = p.ruleset ?? p;

    function numFrom(obj: any): number | null {
      if (obj == null) return null;
      if (typeof obj === "number") return obj;
      if (typeof obj === "string") { const n = parseFloat(obj); return isNaN(n) ? null : n; }
      for (const k of ["valeur","m","metres","max","min","min_pct","pct","pourcentage","percent","max_ratio","min_m","valeur_m","distance","ratio","value","v"]) {
        if (obj[k] != null && typeof obj[k] === "number") return obj[k];
        if (obj[k] != null && typeof obj[k] === "string") { const n = parseFloat(obj[k]); if (!isNaN(n)) return n; }
      }
      return null;
    }
    function noteFrom(obj: any): string | null {
      if (!obj || typeof obj !== "object") return null;
      return obj.note ?? obj.label ?? obj.description ?? null;
    }

    const ces      = rs.ces ?? {};
    const cos      = rs.cos ?? {};
    const reculs   = rs.reculs ?? rs.recul ?? {};
    const hauteurs = rs.hauteurs ?? rs.gabarit ?? rs.hauteur ?? {};
    const stat     = rs.stationnement ?? rs.parking ?? {};
    const pt       = rs.pleine_terre ?? rs.espaces_verts ?? rs.espace_vert ?? {};
    const reculsVoirie  = reculs.voirie ?? reculs.voirie_m ?? null;
    const reculsLimites = reculs.limites ?? reculs.limites_separatives ?? reculs.limite ?? null;
    const parkingParLogement = numFrom(stat) ?? numFrom(stat.par_logement) ?? numFrom(p.parking_par_logement) ?? 1;

    const HANDLED = new Set(["ces","cos","reculs","recul","stationnement","parking","hauteurs","gabarit","hauteur","pleine_terre","espaces_verts","espace_vert"]);
    const LABELS: Record<string, string> = {
      hauteurs: "Hauteurs", gabarit: "Gabarit", hauteur: "Hauteur",
      pleine_terre: "Pleine terre", espaces_verts: "Espaces verts", espace_vert: "Espaces verts",
      facades: "Façades", toiture: "Toiture", clotures: "Clôtures",
      plantations: "Plantations", energie: "Énergie", bruit: "Bruit",
      assainissement: "Assainissement", acces: "Accès / voirie",
      servitudes: "Servitudes", mixite: "Mixité fonctionnelle",
    };

    function flattenEntry(key: string, val: any): Array<{ label: string; value: string | null; note: string | null }> {
      if (val == null) return [];
      const baseLabel = LABELS[key] ?? key.replace(/_/g, " ");
      const directNum = numFrom(val);
      if (directNum != null) return [{ label: baseLabel, value: String(directNum), note: noteFrom(val) }];
      if (typeof val !== "object") return [];
      const subObjs = Object.entries(val).filter(([k]) =>
        !["note","label","description","unit","done"].includes(k) &&
        typeof (val as any)[k] === "object" && (val as any)[k] !== null
      );
      if (subObjs.length > 0) {
        return subObjs.flatMap(([subKey, subVal]: [string, any]) => {
          const subLabel = `${baseLabel} — ${LABELS[subKey] ?? subKey.replace(/_/g, " ")}`;
          const n = numFrom(subVal); const nt = noteFrom(subVal);
          if (n == null && nt == null) return [];
          return [{ label: subLabel, value: n != null ? String(n) : null, note: nt }];
        });
      }
      const n = numFrom(val); const nt = noteFrom(val);
      if (n == null && nt == null) return [];
      return [{ label: baseLabel, value: n != null ? String(n) : null, note: nt }];
    }

    const extra = Object.entries(rs).filter(([k]) => !HANDLED.has(k)).flatMap(([k, v]) => flattenEntry(k, v)).filter(e => e.value != null || e.note != null);

    return {
      zone: p.zone ?? p.zone_plu ?? rs.zone ?? "",
      description: p.description ?? p.libelle_zone ?? rs.libelle ?? "",
      hauteurEgoutM: numFrom(hauteurs.egout) ?? numFrom(hauteurs.egout_m) ?? numFrom(hauteurs.egout_max) ?? numFrom(hauteurs.hauteur_egout) ?? numFrom(hauteurs.max) ?? numFrom(p.hauteur_egout_m) ?? null,
      hauteurFaitageM: numFrom(hauteurs.faitage) ?? numFrom(hauteurs.faitage_m) ?? numFrom(hauteurs.faitage_max) ?? numFrom(p.hauteur_faitage_m) ?? null,
      hauteurMaxM: numFrom(hauteurs.max) ?? numFrom(p.hauteur_max_m) ?? 0,
      hauteurNote: noteFrom(hauteurs) ?? null,
      hauteurEgoutFromNote: (() => {
        const note = noteFrom(hauteurs);
        if (!note) return null;
        const m = note.match(/(\d+(?:[.,]\d+)?)\s*m?\s*[eé]gout/i);
        return m ? parseFloat(m[1].replace(",", ".")) : null;
      })(),
      empriseMaxPct: numFrom(ces) ?? 0,
      empriseNote: noteFrom(ces),
      reculVoirie: numFrom(reculsVoirie),
      reculVoirieNote: noteFrom(reculsVoirie),
      reculLimites: numFrom(reculsLimites),
      reculLimitesNote: noteFrom(reculsLimites),
      parkingParLogement,
      espaceVertMinPct: numFrom(pt.min) ?? numFrom(pt.min_pct) ?? numFrom(pt.pct) ?? numFrom(pt) ?? 0,
      pleineTerreMinPct: numFrom(pt.min) ?? numFrom(pt.min_pct) ?? numFrom(pt.pct) ?? numFrom(pt) ?? null,
      pleineTerreNote: noteFrom(pt) ?? null,
      coefficientOccupSol: numFrom(cos),
      cosNote: noteFrom(cos),
      extra,
    };
  }, [study]);

  const [typeProjet,      setTypeProjet]      = useState<TypeProjet>("collectif");
  const [niveaux,         setNiveaux]         = useState(3);
  const [empriseSol,      setEmpriseSol]      = useState(0);
  const [nbT1, setNbT1] = useState(0);
  const [nbT2, setNbT2] = useState(0);
  const [nbT3, setNbT3] = useState(0);
  const [nbT4, setNbT4] = useState(0);
  const [nbT5, setNbT5] = useState(0);
  const [surfT1, setSurfT1] = useState(35);
  const [surfT2, setSurfT2] = useState(50);
  const [surfT3, setSurfT3] = useState(68);
  const [surfT4, setSurfT4] = useState(85);
  const [surfT5, setSurfT5] = useState(105);
  const nbLogements = nbT1 + nbT2 + nbT3 + nbT4 + nbT5;
  const [surfaceCommerce, setSurfaceCommerce] = useState(0);
  const [nbParkings,      setNbParkings]      = useState(0);
  const [espacesVerts,    setEspacesVerts]    = useState(0);
  const [prixVenteLog,    setPrixVenteLog]    = useState(5_500);
  const [prixVenteCom,    setPrixVenteCom]    = useState(4_000);
  const [coutConstrLog,   setCoutConstrLog]   = useState(1_800);
  const [coutConstrCom,   setCoutConstrCom]   = useState(1_400);
  const [fraisPct,        setFraisPct]        = useState(12);
  const [margeCiblePct,   setMargeCiblePct]   = useState(10);
  const [savedForBilan,   setSavedForBilan]   = useState(false);

  const showCommerce = typeProjet === "mixte";

  const calculs = useMemo(() => {
    const sdpLogement    = nbT1*surfT1 + nbT2*surfT2 + nbT3*surfT3 + nbT4*surfT4 + nbT5*surfT5;
    const sdpCommerce    = showCommerce ? surfaceCommerce : 0;
    const sdpTotale      = sdpLogement + sdpCommerce;
    const hauteurEstimeeM = niveaux * 3.2;
    const prixTerrainM2  = terrain.surfaceM2 > 0 ? terrain.prixVendeur / terrain.surfaceM2 : 0;
    const chargeFonciere = sdpTotale > 0 ? terrain.prixVendeur / sdpTotale : 0;
    const caLogement     = sdpLogement * prixVenteLog;
    const caCommerce     = sdpCommerce * prixVenteCom;
    const caTotal        = caLogement + caCommerce;
    const coutTravauxLog = sdpLogement * coutConstrLog;
    const coutTravauxCom = sdpCommerce * coutConstrCom;
    const coutTravaux    = coutTravauxLog + coutTravauxCom;
    const fraisAnnexes   = (coutTravaux + terrain.prixVendeur) * (fraisPct / 100);
    const coutTotal      = terrain.prixVendeur + coutTravaux + fraisAnnexes;
    const margeBrute     = caTotal - coutTotal;
    const tauxMarge      = caTotal > 0 ? (margeBrute / caTotal) * 100 : 0;
    return { sdpLogement, sdpCommerce, sdpTotale, hauteurEstimeeM, prixTerrainM2, chargeFonciere, caLogement, caCommerce, caTotal, coutTravauxLog, coutTravauxCom, coutTravaux, fraisAnnexes, coutTotal, margeBrute, tauxMarge };
  }, [nbT1,nbT2,nbT3,nbT4,nbT5,surfT1,surfT2,surfT3,surfT4,surfT5,showCommerce,surfaceCommerce,niveaux,terrain,prixVenteLog,prixVenteCom,coutConstrLog,coutConstrCom,fraisPct]);

  type PluCheck = { critere: string; valeurProjet: string; valeurPLU: string; status: ComplianceStatus };

  const pluChecks = useMemo((): PluCheck[] => {
    if (!terrain.pluDisponible) return [];
    const emprisePctProjet = terrain.surfaceM2 > 0 ? (empriseSol / terrain.surfaceM2) * 100 : 0;
    const parkingsRequis  = nbLogements * plu.parkingParLogement;
    const espaceVertMin   = terrain.surfaceM2 * ((plu.pleineTerreMinPct ?? plu.espaceVertMinPct) / 100);
    function checkEmprise(): ComplianceStatus {
      if (plu.empriseMaxPct === 0) return "a_verifier";
      if (emprisePctProjet <= plu.empriseMaxPct) return "conforme";
      if (emprisePctProjet <= plu.empriseMaxPct * 1.05) return "a_verifier";
      return "non_conforme";
    }
    function checkHauteur(): ComplianceStatus {
      const hMax = plu.hauteurEgoutM ?? plu.hauteurMaxM;
      if (!hMax) return "a_verifier";
      if (calculs.hauteurEstimeeM <= hMax) return "conforme";
      if (calculs.hauteurEstimeeM <= hMax * 1.05) return "a_verifier";
      return "non_conforme";
    }
    function checkParkings(): ComplianceStatus {
      if (nbParkings >= parkingsRequis) return "conforme";
      if (nbParkings >= Math.ceil(parkingsRequis * 0.9)) return "a_verifier";
      return "non_conforme";
    }
    function checkVerts(): ComplianceStatus {
      if (espacesVerts >= espaceVertMin) return "conforme";
      if (espacesVerts >= espaceVertMin * 0.9) return "a_verifier";
      return "non_conforme";
    }
    return [
      { critere: "Emprise au sol",              valeurProjet: fmtPct(emprisePctProjet) + ` (${fmt(empriseSol)} m²)`, valeurPLU: plu.empriseMaxPct > 0 ? `max. ${fmtPct(plu.empriseMaxPct)}` : "Pas de règle CES", status: checkEmprise() },
      { critere: "Hauteur du projet",           valeurProjet: `${calculs.hauteurEstimeeM.toFixed(1)} m (${niveaux} niv.)`, valeurPLU: plu.hauteurEgoutM != null ? `max. ${plu.hauteurEgoutM} m (égout)` : plu.hauteurMaxM > 0 ? `max. ${plu.hauteurMaxM} m` : "—", status: checkHauteur() },
      { critere: "Stationnement",               valeurProjet: `${nbParkings} place${nbParkings > 1 ? "s" : ""}`, valeurPLU: `min. ${parkingsRequis} (${plu.parkingParLogement} pl/logt)`, status: checkParkings() },
      { critere: "Pleine terre / espaces verts", valeurProjet: `${fmt(espacesVerts)} m²`, valeurPLU: espaceVertMin > 0 ? `min. ${fmt(Math.round(espaceVertMin))} m² (${plu.pleineTerreMinPct ?? plu.espaceVertMinPct} %)` : "Pas de règle", status: checkVerts() },
    ];
  }, [terrain, empriseSol, nbLogements, plu, calculs.hauteurEstimeeM, niveaux, nbParkings, espacesVerts]);

  const { viabilite, reasons } = useMemo((): { viabilite: ViabiliteStatus; reasons: string[] } => {
    const msgs: string[] = [];
    let blocages = 0; let warnings = 0;
    for (const check of pluChecks) {
      if (check.status === "non_conforme") { blocages++; msgs.push(`PLU — ${check.critere} non conforme : ${check.valeurProjet} (règle : ${check.valeurPLU})`); }
      else if (check.status === "a_verifier") { warnings++; msgs.push(`PLU — ${check.critere} à vérifier : ${check.valeurProjet} (règle : ${check.valeurPLU})`); }
    }
    if (!terrain.pluDisponible) { warnings++; msgs.push("PLU non chargé — le contrôle réglementaire reste à confirmer"); }
    if (calculs.margeBrute <= 0) { blocages++; msgs.push(`Marge brute négative : ${fmtEur(calculs.margeBrute)} — projet déficitaire`); }
    else if (calculs.tauxMarge < margeCiblePct) { warnings++; msgs.push(`Marge ${fmtPct(calculs.tauxMarge)} inférieure à la cible de ${fmtPct(margeCiblePct)}`); }
    else { msgs.push(`Marge ${fmtPct(calculs.tauxMarge)} — cible ${fmtPct(margeCiblePct)} atteinte`); }
    const detailTotal = nbT1+nbT2+nbT3+nbT4+nbT5;
    if (detailTotal === 0) { warnings++; msgs.push("Aucun logement saisi — renseignez au moins un type de logement"); }
    const sdpEmprise = empriseSol * niveaux;
    if (calculs.sdpTotale > sdpEmprise * 1.15) { warnings++; msgs.push(`SDP totale (${fmt(Math.round(calculs.sdpTotale))} m²) dépasse l'emprise × niveaux (${fmt(Math.round(sdpEmprise))} m²)`); }
    const status: ViabiliteStatus = blocages > 0 ? "non_viable" : warnings > 0 ? "conditions" : "viable";
    return { viabilite: status, reasons: msgs };
  }, [pluChecks, terrain.pluDisponible, calculs, margeCiblePct, nbT1,nbT2,nbT3,nbT4,nbT5, empriseSol, niveaux]);

  const handleSaveForBilan = () => {
    const snapshot: ProgrammationSnapshot = {
      typeProjet, niveaux, nbLogements, empriseSol,
      typologies: { T1: nbT1, T2: nbT2, T3: nbT3, T4: nbT4, T5: nbT5 },
      surfacesTypologies: { T1: surfT1, T2: surfT2, T3: surfT3, T4: surfT4, T5: surfT5 },
      surfaceCommerce: showCommerce ? surfaceCommerce : 0,
      nbParkings, espacesVerts, prixVenteLog, prixVenteCom, coutConstrLog, coutConstrCom, fraisPct, margeCiblePct,
      sdpLogement: calculs.sdpLogement, sdpCommerce: calculs.sdpCommerce, sdpTotale: calculs.sdpTotale,
      caTotal: calculs.caTotal, caLogement: calculs.caLogement, caCommerce: calculs.caCommerce,
      coutTravaux: calculs.coutTravaux, coutTotal: calculs.coutTotal,
      margeBrute: calculs.margeBrute, tauxMarge: calculs.tauxMarge,
      pluViabilite: viabilite, updatedAt: new Date().toISOString(),
    };
    patchModule("programmation", snapshot);
    setSavedForBilan(true);
    setTimeout(() => setSavedForBilan(false), 3000);
  };

  if (loadState === "loading") {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 300, fontFamily: "inherit" }}>
        <Loader2 size={28} color="#7C3AED" style={{ animation: "spin 1s linear infinite" }} />
        <span style={{ marginLeft: 14, fontSize: 14, color: "#6B7280" }}>Chargement de l'étude…</span>
        <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "inherit" }}>

      {/* ── Hero — pleine largeur ── */}
      <div style={{ padding: "16px 40px 0", marginBottom: 24 }}>
        <PromoteurPageHero
          badge="Promoteur · Programmation"
          title="Programmation du projet"
          metaLines={[
            { text: "Définissez votre programme et vérifiez la viabilité avant de passer en faisabilité." },
            ...(!terrain.pluDisponible ? [{ text: "⚠️ PLU non encore chargé — simulation provisoire basée sur valeurs par défaut." }] : []),
          ]}
          statCards={calculs.caTotal > 0 ? [
            { label: "Marge brute", value: `${calculs.tauxMarge.toFixed(1)} %`, tone: "indigo" as const },
            { label: "CA total",    value: `${Math.round(calculs.caTotal / 1000)} k€`, tone: "emerald" as const },
          ] : undefined}
          actions={
            <HeroPrimaryButton onClick={handleSaveForBilan}>
              {savedForBilan ? "✓ Envoyé au bilan" : "Valider & envoyer au bilan"}
            </HeroPrimaryButton>
          }
        />
      </div>

      {/* ── Contenu contraint ── */}
      <div style={{ padding: "0 28px 32px", maxWidth: 1120, margin: "0 auto" }}>

        {/* ── Ligne 1 : Terrain + Programme ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>

          <SectionCard title="Terrain analysé">
            <FieldRow label="Numéro de parcelle" value={terrain.adresse || "—"} />
            <FieldRow label="Commune"      value={terrain.commune ? `${terrain.commune}${terrain.codePostal ? ` (${terrain.codePostal})` : ""}` : "—"} />
            <FieldRow label="Type de bien" value={terrain.typeBien || "—"} />
            <FieldRow label="Surface terrain" value={terrain.surfaceM2 > 0 ? `${fmt(terrain.surfaceM2)} m²` : "—"} />
            <FieldRow label="Prix vendeur"    value={terrain.prixVendeur > 0 ? fmtEur(terrain.prixVendeur) : "—"} />
            <FieldRow label="Prix terrain au m²" value={terrain.surfaceM2 > 0 && terrain.prixVendeur > 0 ? `${fmt(Math.round(terrain.prixVendeur / terrain.surfaceM2))} €/m²` : "—"} />

            {terrain.pluDisponible ? (
              <>
                <SubHeading label="Règles PLU" />
                <FieldRow label="Zone" value={plu.zone || "—"} />
                {plu.description ? <div style={{ fontSize: 12, color: "#6B7280", padding: "2px 0 8px", fontStyle: "italic" }}>{plu.description}</div> : null}
                {(plu.hauteurEgoutM != null || plu.hauteurEgoutFromNote != null) && <FieldRow label="Hauteur max. (égout)" value={`${plu.hauteurEgoutM ?? plu.hauteurEgoutFromNote} m`} />}
                {plu.hauteurFaitageM != null && <FieldRow label="Hauteur faîtage" value={`${plu.hauteurFaitageM} m`} />}
                {plu.hauteurEgoutM == null && plu.hauteurEgoutFromNote == null && plu.hauteurFaitageM == null && plu.hauteurMaxM > 0 && <FieldRow label="Hauteur max." value={`${plu.hauteurMaxM} m`} />}
                <FieldRow label="Emprise au sol (CES)" value={plu.empriseMaxPct > 0 ? `${plu.empriseMaxPct} %` : "—"} note={plu.empriseNote ?? (plu.empriseMaxPct === 0 ? "Pas de règle" : undefined)} />
                {plu.reculVoirie != null && <FieldRow label="Recul voirie" value={`${plu.reculVoirie} m`} note={plu.reculVoirieNote ?? undefined} />}
                {plu.reculLimites != null && <FieldRow label="Recul limites" value={`${plu.reculLimites} m`} note={plu.reculLimitesNote ?? undefined} />}
                <FieldRow label="Stationnement" value={`${plu.parkingParLogement} pl/logt`} />
                {plu.pleineTerreMinPct != null && <FieldRow label="Pleine terre min." value={`${plu.pleineTerreMinPct} %`} note={plu.pleineTerreNote ?? undefined} />}
                {plu.espaceVertMinPct > 0 && plu.pleineTerreMinPct == null && <FieldRow label="Espaces verts min." value={`${plu.espaceVertMinPct} %`} />}
                <FieldRow label="COS" value={plu.coefficientOccupSol != null ? String(plu.coefficientOccupSol) : "—"} note={plu.cosNote ?? (plu.coefficientOccupSol == null ? "Pas de COS" : undefined)} />
                {plu.extra.map(e => <FieldRow key={e.label} label={e.label} value={e.value ?? "—"} note={e.note ?? undefined} />)}
              </>
            ) : (
              <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 8, background: "#F9FAFB", border: "1px dashed #D1D5DB", fontSize: 13, color: "#9CA3AF", textAlign: "center" }}>
                📋 PLU non encore chargé — simulation provisoire.
              </div>
            )}
          </SectionCard>

          <SectionCard title="Programme immobilier">
            <SelectInput<TypeProjet> label="Type de projet" value={typeProjet} onChange={setTypeProjet} options={TYPE_PROJET_OPTIONS} />
            <SelectInput<string> label="Nombre de niveaux" value={String(niveaux)} onChange={(v) => setNiveaux(Number(v))} options={NIVEAUX_OPTIONS} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" }}>
              <NumberInput label="Emprise au sol projetée" value={empriseSol} onChange={setEmpriseSol} unit="m²" min={0} />
            </div>

            <SubHeading label="Répartition typologies" />
            <p style={{ margin: "0 0 8px", fontSize: 11, color: "#9CA3AF" }}>Renseignez le nombre de logements et la surface habitable par type.</p>

            <div style={{ border: "1px solid #E5E7EB", borderRadius: 8, overflow: "hidden", marginBottom: 8 }}>
              <div style={{ display: "grid", gridTemplateColumns: "56px 1fr 1fr 72px", background: "#F5F3FF", padding: "7px 12px", fontSize: 11, fontWeight: 700, color: "#7C3AED", textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>
                <span>Type</span><span>Nb logements</span><span>Surface (m²)</span><span style={{ textAlign: "right" as const }}>SDP</span>
              </div>
              {([
                { key: "T1" as const, nb: nbT1, setNb: setNbT1, surf: surfT1, setSurf: setSurfT1 },
                { key: "T2" as const, nb: nbT2, setNb: setNbT2, surf: surfT2, setSurf: setSurfT2 },
                { key: "T3" as const, nb: nbT3, setNb: setNbT3, surf: surfT3, setSurf: setSurfT3 },
                { key: "T4" as const, nb: nbT4, setNb: setNbT4, surf: surfT4, setSurf: setSurfT4 },
                { key: "T5" as const, nb: nbT5, setNb: setNbT5, surf: surfT5, setSurf: setSurfT5 },
              ] as const).map(({ key, nb, setNb, surf, setSurf }, i) => {
                const sdp = nb * surf; const isActive = nb > 0;
                return (
                  <div key={key} style={{ display: "grid", gridTemplateColumns: "56px 1fr 1fr 72px", alignItems: "center", padding: "6px 12px", borderTop: i > 0 ? "1px solid #F3F4F6" : undefined, background: isActive ? "#FDFCFF" : "white" }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: isActive ? "#7C3AED" : "#9CA3AF" }}>{key}</span>
                    <div style={{ paddingRight: 10 }}>
                      <input type="number" value={nb} min={0} onChange={e => setNb(Number(e.target.value))} placeholder="0"
                        style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: `1px solid ${isActive ? "#C4B5FD" : "#E5E7EB"}`, fontSize: 13, color: "#111827", outline: "none", background: isActive ? "#F5F3FF" : "#FAFAFA", fontFamily: "inherit", boxSizing: "border-box" as const }}
                        onFocus={e => (e.currentTarget.style.borderColor = "#7C3AED")} onBlur={e => (e.currentTarget.style.borderColor = isActive ? "#C4B5FD" : "#E5E7EB")} />
                    </div>
                    <div style={{ paddingRight: 10, display: "flex", alignItems: "center", gap: 6 }}>
                      <input type="number" value={surf} min={10} step={1} onChange={e => setSurf(Number(e.target.value))}
                        style={{ flex: 1, padding: "5px 8px", borderRadius: 6, border: `1px solid ${isActive ? "#C4B5FD" : "#E5E7EB"}`, fontSize: 13, color: "#111827", outline: "none", background: isActive ? "#F5F3FF" : "#FAFAFA", fontFamily: "inherit", boxSizing: "border-box" as const }}
                        onFocus={e => (e.currentTarget.style.borderColor = "#7C3AED")} onBlur={e => (e.currentTarget.style.borderColor = isActive ? "#C4B5FD" : "#E5E7EB")} />
                      <span style={{ fontSize: 11, color: "#9CA3AF", flexShrink: 0 }}>m²</span>
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 600, color: isActive ? "#5B21B6" : "#D1D5DB", textAlign: "right" as const }}>{isActive ? `${Math.round(sdp)} m²` : "—"}</span>
                  </div>
                );
              })}
              <div style={{ display: "grid", gridTemplateColumns: "56px 1fr 1fr 72px", alignItems: "center", padding: "8px 12px", background: "#EDE9FE", borderTop: "2px solid #DDD6FE" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#6D28D9" }}>Total</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>{nbLogements} lgt.</span>
                <span style={{ fontSize: 11, color: "#7C3AED" }}>{nbLogements > 0 ? `moy. ${(calculs.sdpLogement / nbLogements).toFixed(0)} m²` : "—"}</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: "#5B21B6", textAlign: "right" as const }}>{Math.round(calculs.sdpLogement)} m²</span>
              </div>
            </div>

            {showCommerce && (<><SubHeading label="Commerce" /><NumberInput label="Surface commerce" value={surfaceCommerce} onChange={setSurfaceCommerce} unit="m²" min={0} /></>)}

            <SubHeading label="Équipements" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" }}>
              <NumberInput label="Parkings prévus" value={nbParkings}   onChange={setNbParkings}   min={0} />
              <NumberInput label="Espaces verts"   value={espacesVerts} onChange={setEspacesVerts} unit="m²" min={0} />
            </div>
          </SectionCard>
        </div>

        {/* ── Ligne 2 : Hypothèses + KPIs ── */}
        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 20, marginBottom: 20 }}>
          <SectionCard title="Hypothèses économiques">
            <NumberInput label="Prix vente logement"     value={prixVenteLog}  onChange={setPrixVenteLog}  unit="€/m²" min={1_000} step={50} />
            {showCommerce && <NumberInput label="Prix vente commerce"   value={prixVenteCom}  onChange={setPrixVenteCom}  unit="€/m²" min={500}   step={50} />}
            <NumberInput label="Coût constr. logement"   value={coutConstrLog} onChange={setCoutConstrLog} unit="€/m²" min={500}   step={50} />
            {showCommerce && <NumberInput label="Coût constr. commerce" value={coutConstrCom} onChange={setCoutConstrCom} unit="€/m²" min={400}   step={50} />}
            <NumberInput label="Frais annexes (honoraires, notaire…)" value={fraisPct}      onChange={setFraisPct}      unit="%" min={1}  max={30} step={0.5} />
            <NumberInput label="Marge cible"             value={margeCiblePct} onChange={setMargeCiblePct} unit="%" min={0}  max={40} step={0.5} />
          </SectionCard>

          <SectionCard title="Résultats calculés">
            <SubHeading label="Surfaces & foncier" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
              <KpiCard label="SDP logements"  value={`${fmt(Math.round(calculs.sdpLogement))} m²`} sub={nbLogements > 0 ? `moy. ${(calculs.sdpLogement / nbLogements).toFixed(0)} m²/lgt` : undefined} />
              {showCommerce && <KpiCard label="SDP commerce" value={`${fmt(Math.round(calculs.sdpCommerce))} m²`} />}
              <KpiCard label="SDP totale"     value={`${fmt(Math.round(calculs.sdpTotale))} m²`} accent />
              <KpiCard label="Hauteur estimée" value={`${calculs.hauteurEstimeeM.toFixed(1)} m`} sub={`${niveaux} niveaux`} />
              <KpiCard label="Prix terrain / m²" value={terrain.surfaceM2 > 0 && terrain.prixVendeur > 0 ? `${fmt(Math.round(calculs.prixTerrainM2))} €/m²` : "—"} />
              <KpiCard label="Charge foncière / m² SDP" value={calculs.sdpTotale > 0 && terrain.prixVendeur > 0 ? `${fmt(Math.round(calculs.chargeFonciere))} €/m²` : "—"} />
            </div>
            <SubHeading label="Chiffre d'affaires" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 16 }}>
              <KpiCard label="CA logements" value={fmtEur(calculs.caLogement)} />
              {showCommerce && <KpiCard label="CA commerce" value={fmtEur(calculs.caCommerce)} />}
              <KpiCard label="CA total" value={fmtEur(calculs.caTotal)} accent />
            </div>
            <SubHeading label="Coûts & marge" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
              <KpiCard label="Coût travaux"      value={fmtEur(calculs.coutTravaux)} />
              <KpiCard label="Frais annexes"     value={fmtEur(calculs.fraisAnnexes)} sub={`${fraisPct}%`} />
              <KpiCard label="Coût total projet" value={fmtEur(calculs.coutTotal)} />
              <KpiCard label="Marge brute"       value={fmtEur(calculs.margeBrute)} accent={calculs.margeBrute > 0} />
              <KpiCard label="Taux de marge"     value={fmtPct(calculs.tauxMarge)} sub={`Cible : ${fmtPct(margeCiblePct)}`} accent={calculs.tauxMarge >= margeCiblePct && calculs.tauxMarge > 0} />
            </div>
          </SectionCard>
        </div>

        {/* ── Contrôle PLU ── */}
        <SectionCard title="Contrôle PLU" style={{ marginBottom: 20 }}>
          {!terrain.pluDisponible ? (
            <div style={{ padding: "20px", textAlign: "center", color: "#9CA3AF", fontSize: 14, background: "#F9FAFB", borderRadius: 8 }}>
              📋 PLU non chargé — le contrôle réglementaire sera disponible après chargement du PLU.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#F9FAFB" }}>
                  <th style={thStyle}>Critère PLU</th>
                  <th style={thStyle}>Valeur projet</th>
                  <th style={thStyle}>Règle PLU</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Statut</th>
                </tr>
              </thead>
              <tbody>
                {pluChecks.map((check, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    <td style={tdStyle}>{check.critere}</td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{check.valeurProjet}</td>
                    <td style={{ ...tdStyle, color: "#6B7280" }}>{check.valeurPLU}</td>
                    <td style={{ ...tdStyle, textAlign: "center" }}><StatusBadge status={check.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>

        {/* ── Conclusion ── */}
        <SectionCard title="Conclusion & viabilité" style={{ marginBottom: 20 }}>
          <ConclusionCard status={viabilite} reasons={reasons} />
          <p style={{ margin: "14px 0 0", fontSize: 12, color: "#9CA3AF" }}>
            * Simulation provisoire — les résultats définitifs seront disponibles après bilan promoteur et validation PLU complète.
          </p>
        </SectionCard>

        {/* ── Footer envoi ── */}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={handleSaveForBilan}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "12px 24px", borderRadius: 10, border: "none",
              fontSize: 14, fontWeight: 700, cursor: "pointer",
              background: savedForBilan
                ? "linear-gradient(135deg, #10b981 0%, #059669 100%)"
                : "linear-gradient(135deg, #7c6fcd 0%, #5247b8 100%)",
              color: "white",
            }}
          >
            {savedForBilan
              ? <><CheckCircle size={16} />Programme envoyé au bilan</>
              : <><Target size={16} />Valider & envoyer au bilan</>
            }
          </button>
        </div>

      </div>
    </div>
  );
}

// ─── Styles statiques ─────────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 700,
  color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.04em",
  borderBottom: "2px solid #E5E7EB",
};
const tdStyle: React.CSSProperties = {
  padding: "11px 14px", color: "#111827",
};