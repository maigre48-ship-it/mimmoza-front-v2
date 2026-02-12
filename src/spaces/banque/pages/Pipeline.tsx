// FILE: src/spaces/banque/pages/Pipeline.tsx

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  readBanqueSnapshot,
  upsertDossier,
  removeDossier,
} from "../store/banqueSnapshot.store";

function makeId() {
  return `DOSS-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}-${Date.now()
    .toString()
    .slice(-4)}`;
}

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

const LS_ACTIVE_DOSSIER_ID = "mimmoza.banque.active_dossier_id";

function setActiveDossierId(id: string | null) {
  try {
    if (!id) localStorage.removeItem(LS_ACTIVE_DOSSIER_ID);
    else localStorage.setItem(LS_ACTIVE_DOSSIER_ID, id);
  } catch {
    // ignore
  }
}

export default function Pipeline() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  // ✅ IMPORTANT: ne pas figer le snapshot au montage
  // sinon création / update dossier ne se reflète pas.
  const snap = readBanqueSnapshot();
  const active = (snap as any)?.dossier ?? null;

  const dossiers = useMemo(() => {
    const list = active ? [active] : [];
    const q = query.trim().toLowerCase();
    if (!q) return list;

    return list.filter((d: any) => {
      const a = (d.nom || "").toLowerCase();
      const b = (d.sponsor || "").toLowerCase();
      return a.includes(q) || b.includes(q);
    });
  }, [active, query]);

  const goToDocuments = (id: string) => {
    setActiveDossierId(id);
    navigate(`/banque/documents/${id}`);
  };

  const goToRisque = (id: string) => {
    setActiveDossierId(id);
    navigate(`/banque/analyse/${id}`);
  };

  const createNewDossier = () => {
    const nom = (window.prompt("Nom du dossier ?", "Nouveau dossier") || "").trim();
    if (!nom) return;

    const sponsor = (window.prompt("Sponsor (promoteur / client) ?", "") || "").trim();

    const typeRaw = (window.prompt('Type de projet ? "promotion" / "marchand" / "baseline"', "baseline") || "")
      .trim()
      .toLowerCase();

    const projectType =
      typeRaw === "promotion" || typeRaw === "marchand" || typeRaw === "baseline" ? typeRaw : "baseline";

    const montantRaw = (window.prompt("Montant demandé (€) ?", "0") || "").replace(/\s/g, "");
    const montant = Number(montantRaw) || 0;

    const id = makeId();
    const ts = new Date().toISOString();

    upsertDossier({
      id,
      nom,
      sponsor,
      montant,
      projectType,
      statut: "BROUILLON",
      dates: {
        creation: ts,
        derniereMaj: ts,
      },
    } as any);

    setActiveDossierId(id);

    // ✅ navigation cohérente vers le dossier
    goToDocuments(id);
  };

  // ✅ NEW: delete dossier (avec confirmation) + gestion dossier actif
  const deleteDossier = (id: string) => {
    const d = dossiers.find((x: any) => x?.id === id) ?? active;
    const label = d?.nom ? `“${d.nom}”` : id;

    const ok = window.confirm(`Supprimer le dossier ${label} ?\n\nCette action est irréversible.`);
    if (!ok) return;

    // Si le dossier supprimé est le dossier actif, on vide l'active id local + navigation pipeline
    const isActive = active?.id === id;

    removeDossier(id);

    if (isActive) {
      setActiveDossierId(null);
      // on reste/retourne sur pipeline
      navigate(`/banque/pipeline`);
    }
  };

  return (
    <div className="p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold mb-2">Dossiers (Pipeline)</h1>
          <p className="text-slate-500">
            Créez un dossier puis ouvrez Documents / Garanties / Analyse / Comité avec le même ID.
          </p>
        </div>

        <button
          type="button"
          onClick={createNewDossier}
          className="px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800"
        >
          + Nouveau dossier
        </button>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher (nom ou sponsor)…"
          className="w-full max-w-md px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-300"
        />
        <div className="text-sm text-slate-500 whitespace-nowrap">{dossiers.length} dossier(s)</div>
      </div>

      {dossiers.length === 0 ? (
        <div className="mt-10 border border-dashed border-slate-300 rounded-xl p-10 text-center">
          <p className="text-slate-600 mb-4">Aucun dossier. Créez votre premier dossier pour démarrer.</p>
          <button
            type="button"
            onClick={createNewDossier}
            className="px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800"
          >
            Créer mon premier dossier
          </button>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {dossiers.map((d: any) => (
            <div
              key={d.id}
              className="text-left p-5 rounded-xl border border-slate-200 hover:border-slate-300 hover:shadow-sm bg-white"
              title="Ouvrir le dossier"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-slate-900">{d.nom || "(Sans nom)"}</div>
                  <div className="text-sm text-slate-500">{d.sponsor || "Sponsor non renseigné"}</div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-700">
                    {d.projectType || "baseline"}
                  </div>

                  {/* ✅ NEW: delete button */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      deleteDossier(d.id);
                    }}
                    className="text-xs px-2 py-1 rounded-lg border border-red-200 text-red-700 hover:bg-red-50"
                    title="Supprimer le dossier"
                  >
                    Supprimer
                  </button>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-slate-500">Montant</div>
                  <div className="font-medium">{fmtEur(d.montant || 0)}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Dernière MAJ</div>
                  <div className="font-medium">
                    {d.dates?.derniereMaj ? new Date(d.dates.derniereMaj).toLocaleDateString("fr-FR") : "—"}
                  </div>
                </div>
              </div>

              <div className="mt-4 text-xs text-slate-500">
                ID: <span className="font-mono">{d.id}</span>
              </div>

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => goToDocuments(d.id)}
                  className="px-3 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800 text-sm"
                >
                  Ouvrir Documents
                </button>
                <button
                  type="button"
                  onClick={() => goToRisque(d.id)}
                  className="px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm"
                >
                  Ouvrir Risque
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
