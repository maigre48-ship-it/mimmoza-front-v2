// ============================================================================
// DossierPage.tsx — /banque/dossier/:id
// Page unifiée : Données emprunteur & projet + Garanties + Documents
// Règle : 1 dossier → 1 analyse → 1 rapport → 1 décision
// ⚠️ Aucune barre de navigation workflow ici (BanqueLayout s'en charge).
// ============================================================================

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useBanqueDossierContext } from "../hooks/useBanqueDossierContext";
import { upsertDossier, addEvent } from "../store/banqueSnapshot.store";
import GarantiesSection from "../components/GarantiesSection";
import DocumentsSection from "../components/DocumentsSection";

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

// ✅ ACTION 1 — "Logement" ajouté juste après "Promotion immobilière"
const PRET_TYPES = [
  { value: "promotion",       label: "Promotion immobilière" },
  { value: "logement",        label: "Logement" },
  { value: "marchand",        label: "Marchand de biens" },
  { value: "investissement",  label: "Investissement locatif" },
  { value: "rehabilitation",  label: "Réhabilitation" },
  { value: "autre",           label: "Autre" },
];

// ── Component ──

export default function DossierPage() {
  const { dossierId, dossier, refresh } = useBanqueDossierContext();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabKey>("emprunteur");

  // ── Project fields ──
  const [nom, setNom]                     = useState("");
  const [montantDemande, setMontantDemande] = useState<number | "">("");
  const [duree, setDuree]                 = useState<number | "">("");
  const [typePret, setTypePret]           = useState("promotion");
  const [adresseProjet, setAdresseProjet] = useState("");
  const [notes, setNotes]                 = useState("");

  // ── Emprunteur fields ──
  const [emprunteur, setEmprunteur] = useState<Emprunteur>(emptyPhysique());

  const [saved, setSaved] = useState(false);

  // Hydrate from dossier on load / switch
  useEffect(() => {
    if (!dossier) return;
    setNom(dossier.nom ?? "");
    setMontantDemande(dossier.origination?.montantDemande ?? "");
    setDuree(dossier.origination?.duree ?? "");
    setTypePret(dossier.origination?.typePret ?? "promotion");
    setAdresseProjet(dossier.origination?.adresseProjet ?? "");
    setNotes(dossier.origination?.notes ?? "");
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
      },
    } as any);

    addEvent({
      type: "dossier_updated",
      dossierId,
      message: `Dossier mis à jour — ${nom || dossierId}`,
    });
    refresh();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // ── No dossier guard ──

  if (!dossierId) {
    return (
      <div className="max-w-4xl mx-auto">
        <h1 className="text-xl font-bold text-slate-900 mb-4">Dossier</h1>
        <div className="rounded-xl border-2 border-dashed border-slate-200 p-12 text-center">
          <p className="text-slate-500 mb-4">Aucun dossier sélectionné.</p>
          <button
            onClick={() => navigate("/banque/dossiers")}
            className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
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
      {/* Page header (no workflow nav — BanqueLayout handles that) */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">
          {dossier?.nom || "Dossier"}{" "}
          <span className="text-sm font-normal text-slate-400 ml-2">{dossierId}</span>
        </h1>
        {dossier?.statut && (
          <span className="inline-block mt-1 text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-600">
            {dossier.statut}
          </span>
        )}
      </div>

      {/* Internal section tabs (not workflow steps!) */}
      <div className="flex items-center gap-1 border-b border-slate-200 mb-6">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={[
              "px-4 py-2.5 text-sm font-medium border-b-2 transition-all duration-150 -mb-px",
              activeTab === tab.key
                ? "border-slate-900 text-slate-900"
                : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300",
            ].join(" ")}
          >
            {tab.label}
          </button>
        ))}

        <div className="flex-1" />

        <button
          type="button"
          onClick={() => navigate(`/banque/analyse/${dossierId}`)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium text-indigo-600 hover:bg-indigo-50 transition-all duration-150"
        >
          Passer à l'analyse →
        </button>
      </div>

      {/* ════════════════════════════════════════════
          TAB: Données emprunteur & projet
         ════════════════════════════════════════════ */}
      {activeTab === "emprunteur" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">Données emprunteur &amp; projet</h2>
            {saved && <span className="text-sm text-green-600 font-medium">✓ Sauvegardé</span>}
          </div>

          {/* ── Emprunteur type selector ── */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <label className="block text-xs font-semibold text-slate-600 mb-3 uppercase tracking-wide">
              Type d'emprunteur
            </label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => switchEmprunteurType("personne_physique")}
                className={[
                  "flex-1 rounded-lg border-2 px-4 py-3 text-sm font-medium text-center transition-all duration-150",
                  emprunteur.type === "personne_physique"
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 text-slate-600 hover:border-slate-400",
                ].join(" ")}
              >
                Personne physique
              </button>
              <button
                type="button"
                onClick={() => switchEmprunteurType("personne_morale")}
                className={[
                  "flex-1 rounded-lg border-2 px-4 py-3 text-sm font-medium text-center transition-all duration-150",
                  emprunteur.type === "personne_morale"
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 text-slate-600 hover:border-slate-400",
                ].join(" ")}
              >
                Personne morale (Société / Association)
              </button>
            </div>
          </div>

          {/* ── Emprunteur fields: Personne physique ── */}
          {emprunteur.type === "personne_physique" && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
              <h3 className="text-sm font-semibold text-slate-700">Identité de l'emprunteur</h3>
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
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
              <h3 className="text-sm font-semibold text-slate-700">Informations de la structure</h3>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Raison sociale *"
                  value={(emprunteur as EmprunteurMorale).raisonSociale}
                  onChange={(v) => patchEmprunteur("raisonSociale" as any, v)} />
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Forme juridique *</label>
                  <select
                    value={(emprunteur as EmprunteurMorale).formeJuridique}
                    onChange={(e) => patchEmprunteur("formeJuridique" as any, e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10"
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

          {/* ── Project fields ── */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            <h3 className="text-sm font-semibold text-slate-700">Données du projet</h3>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Nom du projet" value={nom}
                onChange={setNom} placeholder="Résidence Les Tilleuls" />
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Type de prêt</label>
                <select
                  value={typePret}
                  onChange={(e) => setTypePret(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                >
                  {PRET_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Montant demandé (€)" type="number"
                value={montantDemande === "" ? "" : String(montantDemande)}
                onChange={(v) => setMontantDemande(v ? Number(v) : "")}
                placeholder="5 000 000" />
              <Field label="Durée (mois)" type="number"
                value={duree === "" ? "" : String(duree)}
                onChange={(v) => setDuree(v ? Number(v) : "")}
                placeholder="24" />
            </div>

            <Field label="Adresse du projet" value={adresseProjet}
              onChange={setAdresseProjet} placeholder="12 rue de la Paix, 75002 Paris" />

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => { setNotes(e.target.value); setSaved(false); }}
                rows={3}
                placeholder="Contexte, historique, éléments clés…"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleSave}
              className="rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-slate-800 transition-colors"
            >
              Enregistrer
            </button>
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
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10"
      />
    </div>
  );
}