import type { BanqueAlert, BanqueProject } from "../types/banque.types";
import { getAllProjects, setAlerts } from "../banqueSnapshot.store";
import { computeSmartScore } from "./banqueSmartscore";

function generateId(): string {
  return `alert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const THRESHOLDS = { scoreDrop: 40, completudeLow: 2, delaiMois: 6, risqueEleveScore: 35, docMinimum: 1 };

export function computeAlerts(projects?: BanqueProject[]): BanqueAlert[] {
  const allProjects = projects ?? getAllProjects();
  const alerts: BanqueAlert[] = [];
  const nowMs = Date.now();

  for (const project of allProjects) {
    if (project.statut === "archive") continue;
    const score = computeSmartScore(project);

    if (score.global < THRESHOLDS.scoreDrop) {
      alerts.push({ id: generateId(), projectId: project.id, projectName: project.title, type: "score_drop", message: `SmartScore critique : ${score.global}/100`, severity: "critical", createdAt: new Date().toISOString(), dismissed: false });
    }
    if (project.snapshot.sections.length < THRESHOLDS.completudeLow) {
      alerts.push({ id: generateId(), projectId: project.id, projectName: project.title, type: "completude_low", message: `Seulement ${project.snapshot.sections.length} section(s) de données — dossier incomplet`, severity: "warning", createdAt: new Date().toISOString(), dismissed: false });
    }
    const diffMonths = (nowMs - new Date(project.createdAt).getTime()) / (1000 * 60 * 60 * 24 * 30);
    if (diffMonths > THRESHOLDS.delaiMois) {
      alerts.push({ id: generateId(), projectId: project.id, projectName: project.title, type: "delai_depasse", message: `Dossier ouvert depuis ${Math.round(diffMonths)} mois`, severity: diffMonths > 12 ? "critical" : "warning", createdAt: new Date().toISOString(), dismissed: false });
    }
    const risquesSub = score.subscores.find((s) => s.key === "risques");
    if (risquesSub && risquesSub.value < THRESHOLDS.risqueEleveScore) {
      alerts.push({ id: generateId(), projectId: project.id, projectName: project.title, type: "risque_eleve", message: `Sous-score risques très bas : ${risquesSub.value}/100`, severity: "critical", createdAt: new Date().toISOString(), dismissed: false });
    }
    if (project.pieces.length < THRESHOLDS.docMinimum) {
      alerts.push({ id: generateId(), projectId: project.id, projectName: project.title, type: "doc_manquant", message: "Aucune pièce jointe — documents requis", severity: "warning", createdAt: new Date().toISOString(), dismissed: false });
    }
  }

  setAlerts(alerts);
  return alerts;
}
