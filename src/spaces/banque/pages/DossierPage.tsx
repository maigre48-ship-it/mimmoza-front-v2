// ============================================================================
// DossierPage.tsx — /banque/dossier/:id
// Page unifiée : Données emprunteur & projet + Garanties + Documents
// Règle : 1 dossier → 1 analyse → 1 rapport → 1 décision
// ⚠️ Aucune barre de navigation workflow ici (BanqueLayout s'en charge).
// ✅ REFACTOR: Option B credit sections (Budget, Revenus, Bien/État,
//    Calendrier, Ratios) moved here from AnalysePage — these are INPUT data.
// ✅ REFACTOR v2: "Données du projet" fusionné dans BudgetSection
//    pour supprimer le doublon montant/durée.
// ✅ REDESIGN: Financeur visual tokens applied (GRAD_FIN / ACCENT_FIN).
// ============================================================================

import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useBanqueDossierContext } from "../hooks/useBanqueDossierContext";
import { upsertDossier, addEvent } from "../store/banqueSnapshot.store";
import GarantiesSection from "../components/GarantiesSection";
import DocumentsSection from "../components/DocumentsSection";
import BudgetSection from "../components/analyse/BudgetSection";
import RevenusSection from "../components/analyse/RevenusSection";
import BienEtatSection from "../components/analyse/BienEtatSection";
import CalendrierSection from "../components/analyse/CalendrierSection";
import RatiosPanel from "../components/analyse/RatiosPanel";

import type { ProjectFields } from "../components/analyse/BudgetSection";

// ── Design tokens Financeur ──
const GRAD_FIN = "linear-gradient(90deg, #26a69a 0%, #80cbc4 100%)";
const ACCENT_FIN = "#1a7a50";

// ── Types emprunteur ──

type EmprunteurType = "personne_physique" | "personne_morale";

interface EmprunteurPhysique {
  type: "personne_physique";
  prenom: string;
  nom: string;
  dateNaissance?: string;
  nationalite?: string;
  adresse?: string;
  email?: string;
  telephone?: string;
}

interface EmprunteurMorale {
  type: "personne_morale";
  raisonSociale: string;
  formeJuridique: string;
  sirenSiret: string;
  adresseSiege?: string;
  representantLegal?: string;
  email?: string;
  telephone?: string;
}

type Emprunteur = EmprunteurPhysique | EmprunteurMorale;

function emptyPhysique(): EmprunteurPhysique {
  return { type: "personne_physique", prenom: "", nom: "" };
}
function emptyMorale(): EmprunteurMorale {
  return { type: "personne_morale", raisonSociale: "", formeJuridique: "", sirenSiret: "" };
}

// ── Internal tabs ──

const TABS = [
  { key: "emprunteur", label: "Données emprunteur & projet" },
  { key: "garanties",  label: "Garanties & Sûretés" },
  { key: "documents",  label: "Documents" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

// ── Helpers ──

const FORMES_JURIDIQUES = [
  "SAS", "SARL", "SCI", "SA", "EURL", "SNC", "Association", "Autre",
];

// ── Component ──

export default function DossierPage() {
  const { dossierId, dossier, refresh } = useBanqueDossierContext();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabKey>("emprunteur");

  // ── Project fields (now managed here, rendered via BudgetSection) ──
  const [nom, setNom]                     = useState("");
  const [montantDemande, setMontantDemande] = useState<number | "">("");
  const [duree, setDuree]                 = useState<number | "">("");
  const [typePret, setTypePret]           = useState("promotion");
  const [notes, setNotes]                 = useState("");

  // ── Project location fields ──
  const [adresseProjet, setAdresseProjet] = useState("");
  const [codePostalProjet, setCodePostalProjet]       = useState("");
  const [communeProjet, setCommuneProjet]             = useState("");
  const [communeInseeProjet, setCommuneInseeProjet]   = useState("");
  const [departementProjet, setDepartementProjet]     = useState("");
  const [parcelleCadastrale, setParcelleCadastrale]   = useState("");
  const [sectionCadastrale, setSectionCadastrale]     = useState("");
  const [prefixeCadastral, setPrefixeCadastral]       = useState("");
  const [latProjet, setLatProjet]                     = useState("");
  const [lngProjet, setLngProjet]                     = useState("");

  // ── Emprunteur fields ──
  const [emprunteur, setEmprunteur] = useState<Emprunteur>(emptyPhysique());

  const [saved, setSaved] = useState(false);

  // ── Hydrate from dossier ──
  useEffect(() => {
    if (!dossier) return;
    setNom(dossier.nom ?? "");
    setMontantDemande(dossier.origination?.montantDemande ?? "");
    setDuree(dossier.origination?.duree ?? "");
    setTypePret(dossier.origination?.typePret ?? "promotion");
    setAdresseProjet(dossier.origination?.adresseProjet ?? "");
    setNotes(dossier.origination?.notes ?? "");

    // Project location
    const o = dossier.origination;
    setCodePostalProjet(o?.codePostalProjet ?? o?.codePostal ?? "");
    setCommuneProjet(o?.communeProjet ?? o?.commune ?? "");
    setCommuneInseeProjet(o?.communeInseeProjet ?? "");
    setDepartementProjet(o?.departementProjet ?? "");
    setParcelleCadastrale(o?.parcelleCadastrale ?? "");
    setSectionCadastrale(o?.sectionCadastrale ?? "");
    setPrefixeCadastral(o?.prefixeCadastral ?? "");
    setLatProjet(o?.latProjet != null ? String(o.latProjet) : "");
    setLngProjet(o?.lngProjet != null ? String(o.lngProjet) : "");

    // Emprunteur
    if (dossier.emprunteur?.type) {
      setEmprunteur(dossier.emprunteur as Emprunteur);
    } else if (dossier.sponsor) {
      setEmprunteur({ ...emptyMorale(), raisonSociale: dossier.sponsor });
    } else {
      setEmprunteur(emptyPhysique());
    }
  }, [dossier?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Emprunteur helpers ──

  const switchEmprunteurType = (t: EmprunteurType) => {
    if (t === emprunteur.type) return;
    setEmprunteur(t === "personne_physique" ? emptyPhysique() : emptyMorale());
    setSaved(false);
  };

  const patchEmprunteur = <K extends keyof Emprunteur>(key: K, value: Emprunteur[K]) => {
    setEmprunteur((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  // ── Auto-derive département from CP ──
  const handleCpChange = useCallback((value: string) => {
    setCodePostalProjet(value);
    setSaved(false);
    if (value.length >= 2) {
      if (value.startsWith("20") && value.length >= 3) {
        const cp3 = value.substring(0, 3);
        setDepartementProjet(Number(cp3) >= 201 && Number(cp3) <= 209 ? "2A" : "2B");
      } else {
        setDepartementProjet(value.substring(0, 2));
      }
    }
  }, []);

  // ── Project fields object for BudgetSection ──
  const projectFields: ProjectFields = useMemo(
    () => ({ nom, typePret, montantDemande, duree, notes }),
    [nom, typePret, montantDemande, duree, notes]
  );

  const handleProjectChange = useCallback(
    (next: ProjectFields) => {
      setNom(next.nom);
      setTypePret(next.typePret);
      setMontantDemande(next.montantDemande);
      setDuree(next.duree);
      setNotes(next.notes);
      setSaved(false);
    },
    []
  );

  // ── Save ──

  const handleSave = () => {
    if (!dossierId) return;

    const sponsor =
      emprunteur.type === "personne_morale"
        ? (emprunteur as EmprunteurMorale).raisonSociale
        : `${(emprunteur as EmprunteurPhysique).prenom} ${(emprunteur as EmprunteurPhysique).nom}`.trim();

    upsertDossier({
      id: dossierId,
      nom: nom || "Dossier sans nom",
      sponsor,
      emprunteur,
      origination: {
        montantDemande: montantDemande || undefined,
        duree: duree || undefined,
        typePret,
        adresseProjet,
        notes,
        // Project location fields
        codePostalProjet: codePostalProjet || undefined,
        communeProjet: communeProjet || undefined,
        communeInseeProjet: communeInseeProjet || undefined,
        departementProjet: departementProjet || undefined,
        parcelleCadastrale: parcelleCadastrale || undefined,
        sectionCadastrale: sectionCadastrale || undefined,
        prefixeCadastral: prefixeCadastral || undefined,
        latProjet: latProjet ? Number(latProjet) : undefined,
        lngProjet: lngProjet ? Number(lngProjet) : undefined,
        // Keep legacy fields in sync for backward compat
        codePostal: codePostalProjet || undefined,
        commune: communeProjet || undefined,
      },
      updatedAt: new Date().toISOString(),
    } as any);

    addEvent({
      type: "dossier_updated",
      dossierId,
      message: `Dossier mis à jour — ${nom || dossierId}`,
    });

    console.log("[DossierPage] ✅ Saved:", {
      dossierId,
      location: {
        adresse: adresseProjet,
        cp: codePostalProjet,
        commune: communeProjet,
        insee: communeInseeProjet,
        dept: departementProjet,
        parcelle: parcelleCadastrale,
      },
    });

    refresh();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // ── Option B: credit section handlers ──

  const existingAnalyse = (dossier as any)?.analyse ?? {};

  const handleBudgetChange = useCallback(
    (next: any) => {
      if (!dossierId) return;
      upsertDossier({
        id: dossierId,
        analyse: { ...((dossier as any)?.analyse ?? {}), budget: next },
      } as any);
      refresh();
    },
    [dossierId, dossier, refresh]
  );

  const handleRevenusChange = useCallback(
    (next: any) => {
      if (!dossierId) return;
      upsertDossier({
        id: dossierId,
        analyse: { ...((dossier as any)?.analyse ?? {}), revenus: next },
      } as any);
      refresh();
    },
    [dossierId, dossier, refresh]
  );

  const handleBienChange = useCallback(
    (next: any) => {
      if (!dossierId) return;
      upsertDossier({
        id: dossierId,
        analyse: { ...((dossier as any)?.analyse ?? {}), bien: next },
      } as any);
      refresh();
    },
    [dossierId, dossier, refresh]
  );

  const handleCalendrierChange = useCallback(
    (next: any) => {
      if (!dossierId) return;
      upsertDossier({
        id: dossierId,
        analyse: { ...((dossier as any)?.analyse ?? {}), calendrier: next },
      } as any);
      refresh();
    },
    [dossierId, dossier, refresh]
  );

  // ── Completeness indicator for location ──
  const locFieldsCount = [adresseProjet, codePostalProjet, communeProjet, communeInseeProjet].filter(Boolean).length;
  const locComplete = locFieldsCount >= 3;

  // ── No dossier guard ──

  if (!dossierId) {
    return (
      <div className="max-w-4xl mx-auto">
        {/* ── Header banner (guard state) ── */}
        <div style={{
          background: GRAD_FIN,
          borderRadius: 14,
          padding: "20px 24px",
          marginBottom: 20,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
        }}>
          <div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", marginBottom: 6 }}>
              Financeur › Dossier
            </div>
            <div style={{ fontSize: 22, fontWeight: 600, color: "white", marginBottom: 4 }}>
              Dossier
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)" }}>
              Aucun dossier sélectionné
            </div>
          </div>
        </div>

        <div
          className="rounded-xl p-12 text-center"
          style={{ border: "2px dashed #c0e8d4" }}
        >
          <p className="text-slate-500 mb-4">Aucun dossier sélectionné.</p>
          <button
            onClick={() => navigate("/banque/dossiers")}
            style={{
              padding: "9px 18px",
              borderRadius: 10,
              border: "none",
              background: GRAD_FIN,
              color: "white",
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Voir le pipeline
          </button>
        </div>
      </div>
    );
  }

  // ── Render ──

  return (
    <div className="max-w-4xl mx-auto">

      {/* ── Header banner ── */}
      <div style={{
        background: GRAD_FIN,
        borderRadius: 14,
        padding: "20px 24px",
        marginBottom: 20,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 16,
      }}>
        <div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", marginBottom: 6 }}>
            Financeur › Dossier
          </div>
          <div style={{ fontSize: 22, fontWeight: 600, color: "white", marginBottom: 4 }}>
            {dossier?.nom || "Dossier"}
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)", display: "flex", alignItems: "center", gap: 10 }}>
            <span>{dossierId}</span>
            {dossier?.statut && (
              <span style={{
                fontSize: 10,
                padding: "2px 8px",
                borderRadius: 5,
                background: "rgba(255,255,255,0.20)",
                color: "white",
                fontWeight: 600,
              }}>
                {dossier.statut}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => navigate(`/banque/analyse/${dossierId}`)}
          style={{
            padding: "9px 18px",
            borderRadius: 10,
            border: "none",
            background: "white",
            color: ACCENT_FIN,
            fontWeight: 600,
            fontSize: 13,
            cursor: "pointer",
            flexShrink: 0,
            marginTop: 4,
          }}
        >
          Passer à l'analyse →
        </button>
      </div>

      {/* Internal section tabs */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, borderBottom: "1px solid #e2e8f0", marginBottom: 24 }}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: "10px 16px",
              fontSize: 14,
              fontWeight: 500,
              borderRadius: "8px 8px 0 0",
              border: "none",
              cursor: "pointer",
              transition: "all 0.15s",
              ...(activeTab === tab.key
                ? {
                    background: GRAD_FIN,
                    color: "white",
                  }
                : {
                    background: "transparent",
                    color: "#64748b",
                  }),
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════
          TAB: Données emprunteur & projet
         ════════════════════════════════════════════ */}
      {activeTab === "emprunteur" && (
        <div className="space-y-6">
          <h2 className="text-lg font-bold text-slate-900">Données emprunteur &amp; projet</h2>

          {/* ── Emprunteur type selector ── */}
          <div
            className="bg-white p-5"
            style={{ borderRadius: 14, border: "1px solid #c0e8d4" }}
          >
            <label className="block text-xs font-semibold text-slate-600 mb-3 uppercase tracking-wide">
              Type d'emprunteur
            </label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => switchEmprunteurType("personne_physique")}
                style={{
                  flex: 1,
                  borderRadius: 10,
                  padding: "12px 16px",
                  fontSize: 14,
                  fontWeight: 500,
                  border: "none",
                  cursor: "pointer",
                  transition: "all 0.15s",
                  ...(emprunteur.type === "personne_physique"
                    ? { background: GRAD_FIN, color: "white" }
                    : { background: "#f8fafc", color: "#475569", border: "1px solid #c0e8d4" }),
                }}
              >
                Personne physique
              </button>
              <button
                type="button"
                onClick={() => switchEmprunteurType("personne_morale")}
                style={{
                  flex: 1,
                  borderRadius: 10,
                  padding: "12px 16px",
                  fontSize: 14,
                  fontWeight: 500,
                  border: "none",
                  cursor: "pointer",
                  transition: "all 0.15s",
                  ...(emprunteur.type === "personne_morale"
                    ? { background: GRAD_FIN, color: "white" }
                    : { background: "#f8fafc", color: "#475569", border: "1px solid #c0e8d4" }),
                }}
              >
                Personne morale (Société / Association)
              </button>
            </div>
          </div>

          {/* ── Emprunteur fields: Personne physique ── */}
          {emprunteur.type === "personne_physique" && (
            <div
              className="bg-white p-5 space-y-4"
              style={{ borderRadius: 14, border: "1px solid #c0e8d4" }}
            >
              <h3 className="text-sm font-semibold" style={{ color: ACCENT_FIN }}>
                Identité de l'emprunteur
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Prénom *" value={(emprunteur as EmprunteurPhysique).prenom}
                  onChange={(v) => patchEmprunteur("prenom" as any, v)} />
                <Field label="Nom *" value={(emprunteur as EmprunteurPhysique).nom}
                  onChange={(v) => patchEmprunteur("nom" as any, v)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Date de naissance" type="date"
                  value={(emprunteur as EmprunteurPhysique).dateNaissance ?? ""}
                  onChange={(v) => patchEmprunteur("dateNaissance" as any, v || undefined)} />
                <Field label="Nationalité"
                  value={(emprunteur as EmprunteurPhysique).nationalite ?? ""}
                  onChange={(v) => patchEmprunteur("nationalite" as any, v || undefined)} />
              </div>
              <Field label="Adresse"
                value={(emprunteur as EmprunteurPhysique).adresse ?? ""}
                onChange={(v) => patchEmprunteur("adresse" as any, v || undefined)} />
              <div className="grid grid-cols-2 gap-4">
                <Field label="Email" type="email"
                  value={(emprunteur as EmprunteurPhysique).email ?? ""}
                  onChange={(v) => patchEmprunteur("email" as any, v || undefined)} />
                <Field label="Téléphone" type="tel"
                  value={(emprunteur as EmprunteurPhysique).telephone ?? ""}
                  onChange={(v) => patchEmprunteur("telephone" as any, v || undefined)} />
              </div>
            </div>
          )}

          {/* ── Emprunteur fields: Personne morale ── */}
          {emprunteur.type === "personne_morale" && (
            <div
              className="bg-white p-5 space-y-4"
              style={{ borderRadius: 14, border: "1px solid #c0e8d4" }}
            >
              <h3 className="text-sm font-semibold" style={{ color: ACCENT_FIN }}>
                Informations de la structure
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Raison sociale *"
                  value={(emprunteur as EmprunteurMorale).raisonSociale}
                  onChange={(v) => patchEmprunteur("raisonSociale" as any, v)} />
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Forme juridique *</label>
                  <select
                    value={(emprunteur as EmprunteurMorale).formeJuridique}
                    onChange={(e) => patchEmprunteur("formeJuridique" as any, e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400/30"
                  >
                    <option value="">Sélectionner…</option>
                    {FORMES_JURIDIQUES.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="SIREN / SIRET *"
                  value={(emprunteur as EmprunteurMorale).sirenSiret}
                  onChange={(v) => patchEmprunteur("sirenSiret" as any, v)}
                  placeholder="123 456 789 00012" />
                <Field label="Représentant légal"
                  value={(emprunteur as EmprunteurMorale).representantLegal ?? ""}
                  onChange={(v) => patchEmprunteur("representantLegal" as any, v || undefined)}
                  placeholder="Prénom Nom" />
              </div>
              <Field label="Adresse siège"
                value={(emprunteur as EmprunteurMorale).adresseSiege ?? ""}
                onChange={(v) => patchEmprunteur("adresseSiege" as any, v || undefined)} />
              <div className="grid grid-cols-2 gap-4">
                <Field label="Email" type="email"
                  value={(emprunteur as EmprunteurMorale).email ?? ""}
                  onChange={(v) => patchEmprunteur("email" as any, v || undefined)} />
                <Field label="Téléphone" type="tel"
                  value={(emprunteur as EmprunteurMorale).telephone ?? ""}
                  onChange={(v) => patchEmprunteur("telephone" as any, v || undefined)} />
              </div>
            </div>
          )}

          {/* ── Localisation du projet ── */}
          <div
            className="bg-white p-5 space-y-4"
            style={{ borderRadius: 14, border: "1px solid #c0e8d4" }}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: ACCENT_FIN }}>
                📍 Localisation du projet
              </h3>
              {locComplete ? (
                <span style={{
                  fontSize: 10,
                  padding: "3px 8px",
                  borderRadius: 5,
                  background: "rgba(38,166,154,0.10)",
                  color: ACCENT_FIN,
                  fontWeight: 600,
                }}>
                  {locFieldsCount}/4
                </span>
              ) : (
                <span style={{
                  fontSize: 10,
                  padding: "3px 8px",
                  borderRadius: 5,
                  background: "#fef3c7",
                  color: "#92400e",
                  fontWeight: 600,
                }}>
                  Incomplet
                </span>
              )}
            </div>

            <p className="text-xs text-slate-500">
              Ces champs alimentent l'enrichissement géographique (DVF, INSEE, Géorisques, BAN…).
              Renseignez au minimum l'adresse, le code postal et la commune.
            </p>

            {/* Adresse projet */}
            <Field label="Adresse du projet" value={adresseProjet}
              onChange={(v) => { setAdresseProjet(v); setSaved(false); }}
              placeholder="6 parc de la Bérengère, 92210 Saint-Cloud" />

            {/* CP / Commune / INSEE / Département */}
            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Code postal</label>
                <input
                  value={codePostalProjet}
                  onChange={(e) => handleCpChange(e.target.value)}
                  placeholder="92210"
                  maxLength={5}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400/30"
                />
              </div>
              <Field label="Commune" value={communeProjet}
                onChange={(v) => { setCommuneProjet(v); setSaved(false); }}
                placeholder="Saint-Cloud" />
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Code INSEE</label>
                <input
                  value={communeInseeProjet}
                  onChange={(e) => { setCommuneInseeProjet(e.target.value); setSaved(false); }}
                  placeholder="92064"
                  maxLength={5}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400/30"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Département</label>
                <input
                  value={departementProjet}
                  onChange={(e) => { setDepartementProjet(e.target.value); setSaved(false); }}
                  placeholder="92"
                  maxLength={3}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-400/30"
                />
              </div>
            </div>

            {/* Parcelle / Section / Préfixe */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Parcelle cadastrale</label>
                <input
                  value={parcelleCadastrale}
                  onChange={(e) => { setParcelleCadastrale(e.target.value.toUpperCase()); setSaved(false); }}
                  placeholder="000 AB 0123"
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-400/30"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Section cadastrale</label>
                <input
                  value={sectionCadastrale}
                  onChange={(e) => { setSectionCadastrale(e.target.value.toUpperCase()); setSaved(false); }}
                  placeholder="AB"
                  maxLength={4}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-400/30"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Préfixe cadastral</label>
                <input
                  value={prefixeCadastral}
                  onChange={(e) => { setPrefixeCadastral(e.target.value); setSaved(false); }}
                  placeholder="000"
                  maxLength={3}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-400/30"
                />
              </div>
            </div>

            {/* Lat / Lng */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Latitude</label>
                <input
                  value={latProjet}
                  onChange={(e) => { setLatProjet(e.target.value); setSaved(false); }}
                  placeholder="48.8448"
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-400/30"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Longitude</label>
                <input
                  value={lngProjet}
                  onChange={(e) => { setLngProjet(e.target.value); setSaved(false); }}
                  placeholder="2.2157"
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-400/30"
                />
              </div>
            </div>
          </div>

          {/* ════════════════════════════════════════════════════════════
              SECTIONS CRÉDIT — Projet+Budget (unifié), Revenus, Bien, Calendrier
              Sauvegarde automatique dans dossier.analyse via upsertDossier
             ════════════════════════════════════════════════════════════ */}
          <div className="border-t pt-6 space-y-5" style={{ borderColor: "#c0e8d4" }}>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Données financières du crédit</h2>
              <p className="text-xs text-slate-500 mt-1">
                Ces données alimentent le calcul des ratios (LTV, DSCR, DSTI) et le SmartScore.
                Elles sont sauvegardées automatiquement à chaque modification.
              </p>
            </div>

            <BudgetSection
              value={existingAnalyse?.budget ?? {}}
              onChange={handleBudgetChange}
              project={projectFields}
              onProjectChange={handleProjectChange}
            />

            <RevenusSection
              value={existingAnalyse?.revenus ?? {}}
              onChange={handleRevenusChange}
            />

            <BienEtatSection
              value={existingAnalyse?.bien ?? {}}
              onChange={handleBienChange}
            />

            <CalendrierSection
              value={existingAnalyse?.calendrier ?? {}}
              onChange={handleCalendrierChange}
            />

            <RatiosPanel
              montantPret={Number(montantDemande) || 0}
              duree={Number(duree) || 240}
              garanties={(dossier as any)?.garanties ?? {}}
              budget={existingAnalyse?.budget ?? {}}
              revenus={existingAnalyse?.revenus ?? {}}
              bien={existingAnalyse?.bien ?? {}}
            />
          </div>

          {/* ── Bouton Enregistrer (tout en bas) ── */}
          <div className="flex flex-col items-end gap-2 pt-2">
            <button
              onClick={handleSave}
              style={{
                padding: "9px 24px",
                borderRadius: 10,
                border: "none",
                background: GRAD_FIN,
                color: "white",
                fontWeight: 600,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              Enregistrer
            </button>
            {saved && (
              <span style={{ fontSize: 14, color: "#16a34a", fontWeight: 500 }}>
                ✓ Sauvegardé
              </span>
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════
          TAB: Garanties
         ════════════════════════════════════════════ */}
      {activeTab === "garanties" && (
        <GarantiesSection dossierId={dossierId} dossier={dossier} refresh={refresh} />
      )}

      {/* ════════════════════════════════════════════
          TAB: Documents
         ════════════════════════════════════════════ */}
      {activeTab === "documents" && (
        <DocumentsSection dossierId={dossierId} dossier={dossier} refresh={refresh} />
      )}
    </div>
  );
}

// ── Reusable field component (internal) ──

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400/30"
      />
    </div>
  );
}