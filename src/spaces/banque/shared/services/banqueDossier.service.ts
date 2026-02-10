import type { BanqueProject, BanqueDossierGenerated, DossierTone } from "../types/banque.types";
import { updateProject, addHistoryEntry } from "../banqueSnapshot.store";

const EDGE_FUNCTION_URL =
  import.meta.env.VITE_SUPABASE_URL
    ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/banque-dossier-generate-v1`
    : "http://localhost:54321/functions/v1/banque-dossier-generate-v1";

const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

export async function generateDossier(
  project: BanqueProject,
  tone: DossierTone
): Promise<BanqueDossierGenerated> {
  const payload = {
    tone,
    project: { id: project.id, title: project.title, address: project.address, sponsor: project.sponsor, montant: project.montant, statut: project.statut },
    projectSnapshot: project.snapshot,
    smartscoreDetails: project.smartscore,
    riskSummary: project.snapshot.sections.find((s) => s.key === "risks")?.data ?? null,
    marketSummary: project.snapshot.sections.find((s) => s.key === "market")?.data ?? null,
  };

  const res = await fetch(EDGE_FUNCTION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON_KEY}` },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Edge function error (${res.status}): ${errorText}`);
  }

  const dossier: BanqueDossierGenerated = await res.json();
  updateProject(project.id, { dossierGenerated: dossier });
  addHistoryEntry(project.id, "Dossier IA généré", `Ton: ${tone}`);
  return dossier;
}

export function generateDossierLocal(
  project: BanqueProject,
  tone: DossierTone
): BanqueDossierGenerated {
  const toneText = tone === "prudent" ? "conservatrice et vigilante" : tone === "offensif" ? "optimiste et orientée action" : "équilibrée et factuelle";

  const dossier: BanqueDossierGenerated = {
    meta: { tone, created_at: new Date().toISOString(), model: "local-fallback" },
    executive_summary: {
      recommendation: tone === "prudent" ? "Vigilance accrue recommandée" : tone === "offensif" ? "Dossier prometteur, engagement rapide conseillé" : "Dossier recevable sous conditions standards",
      rationale: `Analyse ${toneText} du projet ${project.title}. Montant: ${(project.montant / 1e6).toFixed(1)}M€. Promoteur: ${project.sponsor}.`,
      key_numbers: [
        `Montant: ${(project.montant / 1e6).toFixed(1)}M€`,
        `SmartScore: ${project.smartscore?.global ?? "N/A"}/100`,
        `Sections données: ${project.snapshot.sections.length}`,
        `Pièces jointes: ${project.pieces.length}`,
      ],
    },
    project_overview: { title: project.title, address: project.address, sponsor: project.sponsor, montant: project.montant },
    market: project.snapshot.sections.find((s) => s.key === "market")?.data ?? { note: "Données marché non disponibles" },
    risks: {
      global_level: project.smartscore && project.smartscore.global >= 60 ? "modéré" : "élevé",
      items: [
        { label: "Complétude dossier", level: project.pieces.length >= 3 ? "faible" : "élevé", detail: `${project.pieces.length} pièce(s) jointe(s)` },
        { label: "Données marché", level: project.snapshot.sections.some((s) => s.key === "market") ? "faible" : "élevé", detail: "Analyse de marché" },
      ],
    },
    regulation: project.snapshot.sections.find((s) => s.key === "regulation")?.data ?? { note: "Données réglementaires non disponibles" },
    financials: project.snapshot.sections.find((s) => s.key === "financials")?.data ?? { note: "Données financières non disponibles" },
    decision: {
      proposed_decision: tone === "prudent" ? "GO sous conditions strictes" : tone === "offensif" ? "GO" : "GO sous conditions",
      conditions: ["Obtention permis de construire purgé", "Pré-commercialisation ≥ 50%", "Garantie financière d'achèvement"],
      next_steps: ["Compléter les pièces manquantes", "Présentation en comité crédit", "Signature protocole de financement"],
    },
    annexes: {
      sources: ["Snapshot projet Mimmoza", "SmartScore Banque v1", "Données DVF / INSEE (si disponibles)"],
      assumptions: ["Taux de pré-commercialisation estimé", "Conditions de marché stables à horizon 18 mois"],
    },
  };

  updateProject(project.id, { dossierGenerated: dossier });
  addHistoryEntry(project.id, "Dossier généré (local)", `Ton: ${tone}`);
  return dossier;
}
