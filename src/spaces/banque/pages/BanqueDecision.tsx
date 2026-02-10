/**
 * BanqueDecision.tsx (exemple d'intégration)
 * ────────────────────────────────────────────────────────────────────
 * Page "Comité / Décision" de l'espace Banque.
 *
 * Pattern appliqué :
 *   ✅ useBanqueSnapshot()        → lecture réactive
 *   ✅ buildCommitteePayload()    → agrégation AUTOMATIQUE de toutes les données
 *   ✅ patchCommittee()           → persistance snapshot
 *   ❌ recalcul local des risques → tout vient du snapshot
 * ────────────────────────────────────────────────────────────────────
 */

import { useState, useCallback } from "react";
import {
  useBanqueSnapshot,
  patchCommittee,
  buildCommitteePayload,
  type CommitteeTone,
  type CommitteeDecision,
} from "../shared";

const TONE_OPTIONS: { value: CommitteeTone; label: string }[] = [
  { value: "banque", label: "Banque — Comité crédit" },
  { value: "investisseur", label: "Investisseur — Mémo investissement" },
  { value: "technique", label: "Technique — Note de faisabilité" },
];

const DECISION_OPTIONS: { value: CommitteeDecision; label: string; color: string }[] = [
  { value: "favorable", label: "Favorable", color: "bg-green-100 text-green-800" },
  { value: "favorable_sous_reserves", label: "Favorable sous réserves", color: "bg-yellow-100 text-yellow-800" },
  { value: "ajourné", label: "Ajourné", color: "bg-gray-100 text-gray-800" },
  { value: "défavorable", label: "Défavorable", color: "bg-red-100 text-red-800" },
];

const BanqueDecision = () => {
  const {
    snap,
    dossier,
    dossierId,
    committee,
    completeness,
    riskSummary,
    marketSummary,
    guaranteesSummary,
  } = useBanqueSnapshot();

  // ─── UI state only ───
  const [tone, setTone] = useState<CommitteeTone>(committee?.tone ?? "banque");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedNote, setGeneratedNote] = useState<string | null>(
    committee?.noteMarkdown ?? null
  );

  // ─── Générer la note comité via Edge Function ───
  const handleGenerate = useCallback(async () => {
    if (!dossierId || !dossier) return;

    // buildCommitteePayload agrège TOUT automatiquement
    const payload = buildCommitteePayload(snap, tone);
    if (!payload) return;

    setIsGenerating(true);
    try {
      // ══════════════════════════════════════════════════════════════
      // ICI : appel Edge Function (ex: supabase.functions.invoke)
      // Le payload contient déjà tout : risques, marché, garanties, docs, score
      // ══════════════════════════════════════════════════════════════
      console.log("[Decision] Sending to Edge Function:", payload);

      // Mock — remplacer par ton vrai appel
      await new Promise((r) => setTimeout(r, 2000));
      const noteMarkdown = `# Note comité — ${dossier.nom}\n\n## Résumé\nDossier analysé avec score de complétude ${completeness.percent}%.`;

      setGeneratedNote(noteMarkdown);

      // Persist
      patchCommittee(dossierId, {
        tone,
        noteMarkdown,
        lastGeneratedAt: new Date().toISOString(),
      });
    } catch (e: any) {
      console.error("[Decision] generation failed", e);
    } finally {
      setIsGenerating(false);
    }
  }, [dossierId, dossier, snap, tone, completeness]);

  // ─── Enregistrer la décision ───
  const handleDecision = useCallback(
    (decision: CommitteeDecision) => {
      if (!dossierId) return;
      patchCommittee(dossierId, { decision });
    },
    [dossierId]
  );

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Comité & Décision</h1>

      {/* Panneau récapitulatif — données auto-dérivées du snapshot */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 bg-gray-50 rounded-lg">
          <p className="text-xs text-gray-500 uppercase">Complétude</p>
          <p className="text-2xl font-bold">{completeness.percent}%</p>
          {completeness.missingBuckets.length > 0 && (
            <p className="text-sm text-amber-600 mt-1">
              Manquant : {completeness.missingBuckets.join(", ")}
            </p>
          )}
        </div>
        <div className="p-4 bg-gray-50 rounded-lg">
          <p className="text-xs text-gray-500 uppercase">Risques</p>
          <p className="text-lg font-semibold">
            {riskSummary?.verdict ?? "Non analysé"}
          </p>
          {riskSummary && (
            <p className="text-sm text-gray-600">
              {riskSummary.presentCount} présent(s), {riskSummary.unknownCount} inconnu(s)
            </p>
          )}
        </div>
        <div className="p-4 bg-gray-50 rounded-lg">
          <p className="text-xs text-gray-500 uppercase">Garanties</p>
          <p className="text-lg font-semibold">
            {guaranteesSummary
              ? `${guaranteesSummary.obtainedCount}/${guaranteesSummary.requestedCount}`
              : "Non renseigné"}
          </p>
          {guaranteesSummary && (
            <p className="text-sm text-gray-600">LTV : {guaranteesSummary.ltv}</p>
          )}
        </div>
      </div>

      {/* Sélection du ton + génération */}
      <div className="flex items-center gap-4">
        <select
          value={tone}
          onChange={(e) => setTone(e.target.value as CommitteeTone)}
          className="border rounded-lg px-3 py-2"
        >
          {TONE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button
          onClick={handleGenerate}
          disabled={isGenerating || !dossierId}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {isGenerating ? "Génération…" : "Générer la note comité"}
        </button>
      </div>

      {/* Note générée */}
      {generatedNote && (
        <div className="p-6 bg-white border rounded-lg prose max-w-none">
          <pre className="whitespace-pre-wrap text-sm">{generatedNote}</pre>
        </div>
      )}

      {/* Décision */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Décision du comité</h2>
        <div className="flex gap-3">
          {DECISION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => handleDecision(opt.value)}
              className={`px-4 py-2 rounded-lg border-2 font-medium ${
                committee?.decision === opt.value
                  ? `${opt.color} border-current`
                  : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {committee?.decision && (
          <p className="text-sm text-gray-500 mt-2">
            Décision enregistrée : {committee.decision} · {committee.updatedAt
              ? new Date(committee.updatedAt).toLocaleString("fr-FR")
              : "—"}
          </p>
        )}
      </div>
    </div>
  );
};

export default BanqueDecision;