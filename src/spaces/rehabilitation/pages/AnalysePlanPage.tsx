// ─────────────────────────────────────────────────────────────────────────────
// AnalysePlanPage.tsx — « Analyse du plan » (espace Réhabilitation)
//
// LOT F5 (17/11/2026) : la transcription du plan par un modèle de langage (gpt-4o vision, fonctions
// `analyze-rehab-plan` et `transcribe-rehab-plan`, 3 + 5 jetons) est RETIRÉE — elle pouvait inventer des cotes et des
// surfaces. Le plan est désormais lu par le Studio (lecture de plan déterministe : DXF, PDF, PNG, JPEG), dans le
// navigateur, sans jeton : recalage sur l'emprise du bâtiment existant, statut de chaque valeur, questions fermées sur
// ce qui reste incertain. Cette page :
//   1. contrôle le fichier et le dépose EN MÉMOIRE de l'onglet (aucun envoi, aucun stockage) ;
//   2. ouvre Mimmo, qui transmet le plan au Studio intégré (« Plan de l'existant › Importer un plan ») ;
//   3. affiche le dernier relevé VALIDÉ dans le Studio (pièces, surfaces avec statuts, baies) et le donne au copilote.
// ─────────────────────────────────────────────────────────────────────────────

import { CheckCircle2, FileText, Info, ScanLine, Upload, X } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { userStorage } from "@/lib/storage/userScopedStorage";
import { setActiveCopilotContext } from "@/spaces/copilot/store/activeCopilotContext.store";
import {
  ACCEPTE_PLAN_EXISTANT, contexteCopilotReleve, controlerFichierPlan, deposerPlanEnAttente, LIBELLE_SOURCE_RELEVE, LIBELLE_STATUT,
  lignesReleve, MENTION_LECTURE_LOCALE, oublierPlanEnAttente, planEnAttente, releveMemorise,
} from "@/spaces/copilot/studio3d/planExistantStudio";

const ACCENT = "#f97316";
const ACCENT_LIGHT = "#fff7ed";
const GRAD = "linear-gradient(135deg, #ea580c 0%, #fb923c 100%)";

const fr = (v: number, d = 2): string => v.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: d });

function formatOctets(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = "" }) => (
  <div className={`bg-white rounded-2xl border border-slate-200 shadow-sm ${className}`}>{children}</div>
);

export const AnalysePlanPage: React.FC = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fichier, setFichier] = useState<{ nom: string; taille: number } | null>(() => {
    const p = planEnAttente(Date.now());
    return p ? { nom: p.nom, taille: p.taille } : null;
  });
  const [erreur, setErreur] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const releve = useMemo(() => releveMemorise(userStorage), []);

  // Le dernier relevé validé alimente le copilote de cette page (mêmes champs que l'ancienne analyse).
  useEffect(() => {
    if (!releve) return;
    setActiveCopilotContext({
      vertical: "generique",
      pageContext: { pathname: "/rehabilitation/analyse-plan", space: "rehabilitation", tab: "analyse-plan" },
      pageSnapshot: contexteCopilotReleve(releve.synthese),
    });
  }, [releve]);

  const prendreFichier = useCallback(async (f: File) => {
    setErreur(null);
    const c = controlerFichierPlan({ nom: f.name, type: f.type, taille: f.size });
    if (!c.ok) { setErreur(c.raison); return; }
    const octets = await f.arrayBuffer();
    const d = deposerPlanEnAttente({ nom: f.name, type: c.type, taille: f.size, octets, provenance: "rehabilitation", deposeLeMs: Date.now() });
    if (!d.ok) { setErreur(d.raison); return; }
    setFichier({ nom: f.name, taille: f.size });
  }, []);

  const retirer = () => { oublierPlanEnAttente(); setFichier(null); setErreur(null); };

  const s = releve?.synthese ?? null;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: GRAD }}>
          <ScanLine className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Analyse du plan</h1>
          <p className="text-sm text-slate-500">Lecture du plan de l’existant par le Studio : murs, baies, pièces et surfaces, chacun avec son statut.</p>
        </div>
      </div>

      <Card className="p-5">
        <div className="flex gap-3 items-start">
          <Info className="w-4 h-4 mt-0.5 shrink-0" style={{ color: ACCENT }} />
          <div className="text-sm text-slate-600 flex flex-col gap-2">
            <p>{MENTION_LECTURE_LOCALE}</p>
            <p>Le Studio cale le plan sur l’emprise du bâtiment existant de la parcelle : il faut donc un projet ouvert avec Mimmo
              (pour l’instant, une maison conservée dans le parcours « agrandir ma maison »). Rien n’est inventé : une cote illisible
              reste « à confirmer », une pièce sans nom reste sans nom.</p>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <p className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2"><FileText className="w-4 h-4" style={{ color: ACCENT }} /> Plan à lire</p>
        {fichier ? (
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
            <FileText className="w-5 h-5 text-slate-400" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-800 truncate">{fichier.nom}</p>
              <p className="text-xs text-slate-400">{formatOctets(fichier.taille)} — gardé dans cet onglet seulement (rien n’est envoyé avant l’ouverture du Studio)</p>
            </div>
            <button type="button" onClick={retirer} aria-label="Retirer le plan" className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50">
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => fileInputRef.current?.click()}
            onDrop={(e) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) void prendreFichier(f); }}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)}
            className="w-full rounded-xl border-2 border-dashed p-10 flex flex-col items-center gap-3 cursor-pointer"
            style={{ borderColor: isDragging ? ACCENT : "#e2e8f0", background: isDragging ? ACCENT_LIGHT : "#f8fafc" }}>
            <Upload className="w-6 h-6" style={{ color: isDragging ? ACCENT : "#94a3b8" }} />
            <p className="text-sm font-semibold text-slate-700">Déposer un plan ici, ou cliquer pour parcourir</p>
            <p className="text-xs text-slate-400">DXF, PDF, PNG ou JPEG — 20 Mo au plus</p>
          </button>
        )}
        <input ref={fileInputRef} type="file" accept={ACCEPTE_PLAN_EXISTANT} className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void prendreFichier(f); e.target.value = ""; }} />
        {erreur && <p role="alert" className="mt-3 text-sm text-red-600">{erreur}</p>}
        <div className="flex justify-end mt-4">
          <button type="button" disabled={!fichier} onClick={() => navigate("/mimmozia?plan-existant=1")}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 22px", borderRadius: 12, border: "none", color: "white", fontWeight: 700, fontSize: 14, background: fichier ? GRAD : "#cbd5e1", cursor: fichier ? "pointer" : "not-allowed" }}>
            <ScanLine className="w-4 h-4" /> Lire ce plan dans le Studio · gratuit
          </button>
        </div>
      </Card>

      <Card className="p-6">
        <p className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" style={{ color: ACCENT }} /> Dernier relevé validé</p>
        {!s ? (
          <p className="text-sm text-slate-500">Aucun relevé validé pour l’instant. Quand vous posez le relevé dans le Studio (questions répondues), il apparaît ici et sert au copilote (surfaces, devis de rénovation).</p>
        ) : (
          <div className="flex flex-col gap-3 text-sm text-slate-700" data-testid="releve-valide">
            {lignesReleve(s).map((l) => <p key={l}>{l}</p>)}
            {s.pieces.length > 0 && (
              <table className="w-full text-left text-sm">
                <thead><tr className="text-xs uppercase text-slate-400"><th className="py-1">Pièce</th><th>Niveau</th><th>Surface</th><th>Statut</th></tr></thead>
                <tbody>
                  {s.pieces.map((p, i) => (
                    <tr key={`${p.niveau}-${i}`} className="border-t border-slate-100">
                      <td className="py-1">{p.nom ?? <em>nom à confirmer</em>}</td>
                      <td>{p.niveau}</td>
                      <td>{fr(p.surfaceM2)} m²</td>
                      <td>{LIBELLE_STATUT[p.statutSurface]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {s.baies.length > 0 && (
              <details>
                <summary className="cursor-pointer">Baies relevées ({s.baies.length})</summary>
                <ul className="list-disc pl-5">
                  {s.baies.map((b, i) => (
                    <li key={i}>{b.type}, façade {b.cote + 1}, niveau {b.niveau} — largeur {b.largeurM !== null ? `${fr(b.largeurM)} m (${LIBELLE_STATUT[b.statutLargeur!]})` : "inconnue"}, hauteur {b.hauteurM !== null ? `${fr(b.hauteurM)} m (${LIBELLE_STATUT[b.statutHauteur!]})` : "inconnue"}</li>
                  ))}
                </ul>
              </details>
            )}
            {s.avertissements.length > 0 && <ul className="list-disc pl-5 text-amber-700">{s.avertissements.map((a) => <li key={a}>{a}</li>)}</ul>}
            {s.ecartes.length > 0 && <ul className="list-disc pl-5 text-slate-500">{s.ecartes.map((a) => <li key={a}>{a}</li>)}</ul>}
            <p className="text-xs text-slate-400">Source : {LIBELLE_SOURCE_RELEVE[s.source]}. Reçu le {new Date(s.recuLeMs).toLocaleString("fr-FR")}. À faire valider par un professionnel.</p>
          </div>
        )}
      </Card>
    </div>
  );
};

export default AnalysePlanPage;
