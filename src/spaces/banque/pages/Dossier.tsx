// src/spaces/banque/pages/Dossier.tsx
import { useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
// ✅ BANQUE TOOL RISQUES — ajout import Flame pour l'icône outil rouge
import { AlertTriangle, ShieldCheck, FileText, Gavel, Clock, Euro, Flame } from "lucide-react";

import { readBanqueSnapshot } from "../store/banqueSnapshot.store";

const LS_ACTIVE_DOSSIER_ID = "mimmoza.banque.active_dossier_id";

function fmtEur(n: number) {
  try {
    return (n || 0).toLocaleString("fr-FR", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    });
  } catch {
    return `${n || 0} €`;
  }
}

function fmtDate(d?: string) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("fr-FR");
  } catch {
    return "—";
  }
}

export default function BanqueDossier() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  // Persiste le dossier actif pour AppShell
  useEffect(() => {
    if (!id) return;
    try {
      localStorage.setItem(LS_ACTIVE_DOSSIER_ID, id);
    } catch {
      // ignore
    }
  }, [id]);

  const dossier = useMemo(() => {
    const snap: any = readBanqueSnapshot();

    // V1: souvent snap.dossier = dossier actif
    if (snap?.dossier?.id === id) return snap.dossier;

    // V2 possible: dossiersById
    if (snap?.dossiersById && id && snap.dossiersById[id]) return snap.dossiersById[id];

    // Fallback: parfois liste
    if (Array.isArray(snap?.dossiers)) {
      const found = snap.dossiers.find((d: any) => d?.id === id);
      if (found) return found;
    }

    return null;
  }, [id]);

  if (!id) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-bold text-slate-900">Dossier</h1>
        <p className="text-slate-500 mt-2">ID manquant.</p>
      </div>
    );
  }

  if (!dossier) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-bold text-slate-900">Dossier</h1>
        <p className="text-slate-500 mt-2">
          Dossier introuvable pour l'ID <span className="font-mono">{id}</span>.
        </p>
        <button
          type="button"
          onClick={() => navigate("/banque/dossiers")}
          className="mt-4 px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800"
        >
          Revenir aux dossiers
        </button>
      </div>
    );
  }

  const nom = dossier.nom || "Dossier";
  const sponsor = dossier.sponsor || "Sponsor non renseigné";
  const montant = dossier.montant ?? 0;
  const statut = dossier.statut || "—";
  const creation = fmtDate(dossier?.dates?.creation);
  const maj = fmtDate(dossier?.dates?.derniereMaj);

  const Card = ({
    title,
    subtitle,
    icon: Icon,
    onClick,
    variant,
  }: {
    title: string;
    subtitle: string;
    icon: any;
    onClick: () => void;
    variant?: "danger";
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={[
        "text-left p-5 rounded-xl border hover:shadow-sm transition",
        variant === "danger"
          ? "border-red-200 hover:border-red-300 bg-red-50"
          : "border-slate-200 hover:border-slate-300 bg-white",
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        <div
          className={[
            "h-10 w-10 rounded-xl flex items-center justify-center",
            variant === "danger" ? "bg-red-600 text-white" : "bg-slate-900 text-white",
          ].join(" ")}
        >
          <Icon size={18} />
        </div>
        <div className="flex-1">
          <div className={variant === "danger" ? "font-semibold text-red-900" : "font-semibold text-slate-900"}>
            {title}
          </div>
          <div className={variant === "danger" ? "text-sm text-red-600 mt-1" : "text-sm text-slate-500 mt-1"}>
            {subtitle}
          </div>
        </div>
      </div>
    </button>
  );

  return (
    <div className="p-8">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{nom}</h1>
          <p className="text-slate-500 mt-1">{sponsor}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-700">
              Statut: {statut}
            </span>
            <span className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-700">
              Créé: {creation}
            </span>
            <span className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-700">
              MAJ: {maj}
            </span>
            <span className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-700 font-mono">
              {id}
            </span>
          </div>
        </div>

        <div className="text-right">
          <div className="text-xs text-slate-500">Montant</div>
          <div className="text-2xl font-bold text-slate-900">{fmtEur(montant)}</div>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card
          title="Analyse de risque"
          subtitle="Scoring, points faibles, recommandation"
          icon={AlertTriangle}
          onClick={() => navigate(`/banque/analyse/${id}`)}
        />
        <Card
          title="Garanties"
          subtitle="Sûretés, LTV, couverture"
          icon={ShieldCheck}
          onClick={() => navigate(`/banque/garanties/${id}`)}
        />
        <Card
          title="Documents"
          subtitle="Checklist documentaire du dossier"
          icon={FileText}
          onClick={() => navigate(`/banque/documents/${id}`)}
        />
        <Card
          title="Comité"
          subtitle="Décision, avis, pièces comité"
          icon={Gavel}
          onClick={() => navigate(`/banque/comite/${id}`)}
        />
      </div>

      {/* ✅ BANQUE TOOL RISQUES — CTA vers l'outil rouge "Étude de risques" */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card
          title="Étude de risques (outil)"
          subtitle="Risques réglementaires, environnementaux, géotechniques"
          icon={Flame}
          onClick={() => navigate(`/banque/outil-risques/${id}`)}
          variant="danger"
        />
      </div>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-5 rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center gap-2 text-slate-700">
            <Euro size={16} />
            <span className="font-medium">Montant demandé</span>
          </div>
          <div className="mt-2 text-xl font-semibold">{fmtEur(montant)}</div>
          <div className="mt-1 text-sm text-slate-500">À renseigner / synchroniser avec Origination.</div>
        </div>

        <div className="p-5 rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center gap-2 text-slate-700">
            <Clock size={16} />
            <span className="font-medium">Dernière mise à jour</span>
          </div>
          <div className="mt-2 text-xl font-semibold">{maj}</div>
          <div className="mt-1 text-sm text-slate-500">Historique et audit trail à venir.</div>
        </div>

        <div className="p-5 rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center gap-2 text-slate-700">
            <FileText size={16} />
            <span className="font-medium">Complétude</span>
          </div>
          <div className="mt-2 text-xl font-semibold">—</div>
          <div className="mt-1 text-sm text-slate-500">On branchera plus tard sur documents/garanties/analyse.</div>
        </div>
      </div>
    </div>
  );
}