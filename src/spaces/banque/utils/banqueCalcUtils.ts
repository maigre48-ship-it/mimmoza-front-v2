// ============================================================================
// banqueCalcUtils.ts — Shared calculation engine for Banque space
//
// Single source of truth for:
//   - Ratio garanties / prêt
//   - SmartScore pillar breakdown (5 pillars, max 100)
//   - Full analysis (alertes + score + niveau + label)
//   - Structured report object generation
//
// Used by: AnalysePage, ComitePage
// ============================================================================

// ── Types ──

export type Niveau = "Faible" | "Modéré" | "Élevé" | "Critique";
export type Label = "A" | "B" | "C" | "D" | "E";

export interface PillarResult {
  key: string;
  label: string;
  points: number;
  max: number;
  reasons: string[];
  actions: string[];
}

export interface SmartScoreBreakdown {
  score: number;
  grade: Label;
  pillars: PillarResult[];
  drivers: { up: string[]; down: string[] };
  recommendations: string[];
}

export interface AnalysisResult {
  score: number;
  niveau: Niveau;
  label: Label;
  alertes: string[];
  calculatedAt: string;
  garantieRatio: number | null;
  smartscore: SmartScoreBreakdown;
}

export interface ReportEmprunteur {
  type: "personne_physique" | "personne_morale" | "inconnu";
  identite: string;
  details: Record<string, string>;
}

export interface ReportGarantieItem {
  type: string;
  description: string;
  valeur: number | null;
  rang?: number;
}

export interface ReportDocItem {
  nom: string;
  type: string;
  statut: string;
  commentaire?: string;
}

export interface StructuredReport {
  generatedAt: string;
  meta: { dossierLabel: string; dossierId: string; statut: string };
  emprunteur: ReportEmprunteur;
  projet: {
    montant: number | null;
    duree: number | null;
    typePret: string;
    typePretLabel: string;
    adresse: string;
    notes: string;
  };
  risk: {
    score: number;
    grade: Label;
    niveau: Niveau;
    computedAt: string | null;
    alertes: string[];
  };
  garanties: {
    total: number;
    couverture: number;
    ratio: number | null;
    items: ReportGarantieItem[];
    commentaire: string;
  };
  documents: {
    total: number;
    completeness: number;
    items: ReportDocItem[];
  };
  smartscore: SmartScoreBreakdown;
}

// ═══════════════════════════════════════════════════════════════════
// 1. RATIO GARANTIES / PRÊT (single source of truth)
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute the guarantee-to-loan ratio from raw dossier data.
 * Always computes fresh from couvertureTotale / montantDemande.
 * Returns null if data is insufficient, otherwise percentage (e.g. 120 for 120%).
 */
export function computeGarantieRatio(dossier: any): number | null {
  const montant = dossier?.origination?.montantDemande;
  const couverture = dossier?.garanties?.couvertureTotale;
  if (!montant || montant <= 0 || !couverture || couverture <= 0) return null;
  return Math.round((couverture / montant) * 100);
}

// ═══════════════════════════════════════════════════════════════════
// 2. SMARTSCORE PILLAR BREAKDOWN
// ═══════════════════════════════════════════════════════════════════

const PRET_TYPE_LABELS: Record<string, string> = {
  promotion: "Promotion immobilière",
  logement: "Logement",
  marchand: "Marchand de biens",
  investissement: "Investissement locatif",
  rehabilitation: "Réhabilitation",
  autre: "Autre",
};

export function computeSmartScorePillars(dossier: any): SmartScoreBreakdown {
  const pillars: PillarResult[] = [];
  const driversUp: string[] = [];
  const driversDown: string[] = [];
  const recommendations: string[] = [];

  // ── Pillar 1: Documentation (max 25) ──
  {
    const items = dossier?.documents?.items ?? [];
    const total = items.length;
    const valides = items.filter((d: any) => d.statut === "valide" || d.statut === "recu").length;
    const refuses = items.filter((d: any) => d.statut === "refuse").length;
    const reasons: string[] = [];
    const actions: string[] = [];
    let pts = 0;

    if (total === 0) {
      pts = 0;
      reasons.push("Aucun document fourni");
      actions.push("Ajouter les pièces justificatives requises (Kbis, bilans, permis…)");
      driversDown.push("Dossier documentaire vide");
    } else {
      const completude = Math.round((valides / total) * 100);
      pts = Math.round((valides / total) * 25);
      if (completude === 100) {
        reasons.push(`${total} document(s), tous validés ou reçus`);
        driversUp.push("Dossier documentaire complet");
      } else {
        reasons.push(`Complétude ${completude}% (${valides}/${total} validés/reçus)`);
        if (refuses > 0) {
          reasons.push(`${refuses} document(s) refusé(s)`);
          actions.push("Corriger et retransmettre les documents refusés");
          driversDown.push(`${refuses} document(s) refusé(s)`);
        }
        if (total - valides - refuses > 0) {
          actions.push("Compléter les documents en attente");
        }
      }
    }
    pillars.push({ key: "documentation", label: "Documentation", points: pts, max: 25, reasons, actions });
  }

  // ── Pillar 2: Garanties & Sûretés (max 25) ──
  {
    const ratio = computeGarantieRatio(dossier);
    const nbGar = dossier?.garanties?.items?.length ?? 0;
    const reasons: string[] = [];
    const actions: string[] = [];
    let pts = 0;

    if (nbGar === 0) {
      pts = 0;
      reasons.push("Aucune garantie enregistrée");
      actions.push("Constituer au minimum une sûreté réelle (hypothèque) ou personnelle (caution)");
      driversDown.push("Absence totale de garanties");
    } else if (ratio === null) {
      pts = 5;
      reasons.push(`${nbGar} garantie(s) mais montant du prêt non renseigné — ratio incalculable`);
      actions.push("Renseigner le montant du prêt pour calculer le ratio de couverture");
    } else {
      reasons.push(`Ratio garanties/prêt : ${ratio}%`);
      if (ratio >= 120) {
        pts = 25;
        reasons.push("Couverture excellente (≥ 120%)");
        driversUp.push(`Ratio de couverture solide (${ratio}%)`);
      } else if (ratio >= 100) {
        pts = 20;
        reasons.push("Couverture suffisante (≥ 100%)");
        driversUp.push("Garanties couvrant le prêt");
      } else if (ratio >= 70) {
        pts = 13;
        reasons.push("Couverture partielle (70–99%)");
        actions.push("Renforcer les garanties pour atteindre 100% de couverture");
        driversDown.push(`Ratio de couverture insuffisant (${ratio}%)`);
      } else if (ratio >= 50) {
        pts = 8;
        reasons.push("Couverture faible (50–69%)");
        actions.push("Garanties complémentaires nécessaires — risque élevé en cas de défaut");
        driversDown.push(`Couverture très faible (${ratio}%)`);
      } else {
        pts = 3;
        reasons.push(`Couverture critique (${ratio}% < 50%)`);
        actions.push("Exiger des garanties complémentaires avant tout engagement");
        driversDown.push(`Couverture critique (${ratio}%)`);
      }
    }
    pillars.push({ key: "garanties", label: "Garanties & Sûretés", points: pts, max: 25, reasons, actions });
  }

  // ── Pillar 3: Identification emprunteur (max 20) ──
  {
    const emp = dossier?.emprunteur;
    const reasons: string[] = [];
    const actions: string[] = [];
    let pts = 0;

    if (!emp?.type) {
      pts = 0;
      reasons.push("Emprunteur non renseigné");
      actions.push("Saisir les données d'identification de l'emprunteur");
      driversDown.push("Identification emprunteur manquante");
    } else if (emp.type === "personne_physique") {
      reasons.push("Personne physique");
      const hasId = !!(emp.prenom && emp.nom);
      const hasContact = !!(emp.email || emp.telephone);
      const hasExtra = !!(emp.dateNaissance && emp.adresse);
      if (hasId) { pts += 8; reasons.push("Identité complète"); }
      else { actions.push("Compléter prénom et nom"); }
      if (hasContact) { pts += 6; reasons.push("Coordonnées renseignées"); }
      else { actions.push("Ajouter email ou téléphone"); }
      if (hasExtra) { pts += 6; reasons.push("Informations complémentaires fournies"); driversUp.push("Emprunteur bien identifié"); }
      else { actions.push("Compléter date de naissance et adresse"); }
    } else if (emp.type === "personne_morale") {
      reasons.push("Personne morale");
      const hasRs = !!emp.raisonSociale;
      const hasSiren = !!emp.sirenSiret;
      const hasForme = !!emp.formeJuridique;
      const hasContact = !!(emp.email || emp.telephone);
      if (hasRs) { pts += 5; reasons.push("Raison sociale renseignée"); }
      else { actions.push("Saisir la raison sociale"); }
      if (hasSiren) { pts += 5; reasons.push("SIREN/SIRET fourni"); }
      else { actions.push("Fournir le numéro SIREN/SIRET"); driversDown.push("SIREN/SIRET manquant"); }
      if (hasForme) { pts += 5; reasons.push(`Forme juridique : ${emp.formeJuridique}`); }
      else { actions.push("Préciser la forme juridique"); }
      if (hasContact) { pts += 5; reasons.push("Coordonnées disponibles"); driversUp.push("Société bien identifiée"); }
      else { actions.push("Ajouter des coordonnées de contact"); }
    }
    pillars.push({ key: "emprunteur", label: "Identification emprunteur", points: pts, max: 20, reasons, actions });
  }

  // ── Pillar 4: Données projet (max 15) ──
  {
    const orig = dossier?.origination;
    const reasons: string[] = [];
    const actions: string[] = [];
    let pts = 0;

    if (!orig) {
      reasons.push("Aucune donnée de projet");
      actions.push("Renseigner les informations du projet (montant, durée, type de prêt)");
      driversDown.push("Données projet absentes");
    } else {
      if (orig.montantDemande && orig.montantDemande > 0) {
        pts += 4;
        reasons.push(`Montant : ${(orig.montantDemande / 1e6).toFixed(2)} M€`);
      } else { actions.push("Renseigner le montant du prêt"); }

      if (orig.duree && orig.duree > 0) {
        pts += 4;
        reasons.push(`Durée : ${orig.duree} mois`);
      } else { actions.push("Renseigner la durée du prêt"); }

      const tp = orig.typePret;
      if (tp && tp !== "autre" && tp !== "") {
        pts += 4;
        reasons.push(`Type : ${PRET_TYPE_LABELS[tp] ?? tp}`);
      } else {
        pts += 1;
        reasons.push("Type de prêt non qualifié");
        actions.push("Préciser le type de prêt");
      }

      if (orig.adresseProjet) {
        pts += 3;
        reasons.push("Adresse projet renseignée");
      } else { actions.push("Ajouter l'adresse du projet"); }
    }
    pillars.push({ key: "projet", label: "Données projet", points: pts, max: 15, reasons, actions });
  }

  // ── Pillar 5: Profil financier (max 15) ──
  {
    const montant = dossier?.origination?.montantDemande ?? 0;
    const duree = dossier?.origination?.duree ?? 0;
    const reasons: string[] = [];
    const actions: string[] = [];
    let pts = 15; // Start at max, deduct for red flags

    if (montant > 500_000 && duree > 0 && duree < 12) {
      pts -= 8;
      reasons.push(`Montant élevé (${(montant / 1e6).toFixed(2)} M€) avec durée courte (${duree} mois)`);
      actions.push("Évaluer le risque de tension de trésorerie — envisager un allongement");
      driversDown.push("Profil montant/durée à risque");
    } else if (montant > 0 && duree > 0) {
      reasons.push("Profil montant/durée cohérent");
      driversUp.push("Profil financier équilibré");
    }

    if (montant <= 0 && duree <= 0) {
      pts = 0;
      reasons.push("Données financières absentes");
      actions.push("Renseigner montant et durée");
    } else if (montant <= 0 || duree <= 0) {
      pts = Math.max(0, pts - 5);
      reasons.push("Données financières incomplètes");
    }

    pillars.push({ key: "financier", label: "Profil financier", points: Math.max(0, pts), max: 15, reasons, actions });
  }

  // ── Total score ──
  const score = pillars.reduce((sum, p) => sum + p.points, 0);
  const grade: Label =
    score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : score >= 40 ? "D" : "E";

  // ── Recommendations (aggregated from pillar actions, prioritized) ──
  const allActions = pillars
    .sort((a, b) => (a.points / a.max) - (b.points / b.max))
    .flatMap((p) => p.actions);
  // Deduplicate and take top 5
  const seen = new Set<string>();
  for (const a of allActions) {
    if (!seen.has(a)) { seen.add(a); recommendations.push(a); }
    if (recommendations.length >= 5) break;
  }

  return { score, grade, pillars, drivers: { up: driversUp, down: driversDown }, recommendations };
}

// ═══════════════════════════════════════════════════════════════════
// 3. FULL ANALYSIS (replaces naive "100 - n*8")
// ═══════════════════════════════════════════════════════════════════

export function computeFullAnalysis(dossier: any): AnalysisResult {
  const ss = computeSmartScorePillars(dossier);
  const ratio = computeGarantieRatio(dossier);

  // Build human-readable alertes from pillar reasons + actions
  const alertes: string[] = [];

  // Documentation alerts
  const docPillar = ss.pillars.find((p) => p.key === "documentation")!;
  if (docPillar.points === 0) {
    alertes.push("Aucun document fourni — dossier incomplet");
  } else if (docPillar.points < docPillar.max) {
    docPillar.reasons.filter((r) => r.includes("Complétude") || r.includes("refusé")).forEach((r) => alertes.push(r));
  }

  // Garantie alerts
  const garPillar = ss.pillars.find((p) => p.key === "garanties")!;
  if (garPillar.points === 0) {
    alertes.push("Aucune garantie enregistrée — risque de perte totale");
  } else if (ratio !== null && ratio < 100) {
    alertes.push(`Ratio garanties/prêt insuffisant : ${ratio}% (< 100%)`);
  }

  // Emprunteur alerts
  const empPillar = ss.pillars.find((p) => p.key === "emprunteur")!;
  if (empPillar.points === 0) {
    alertes.push("Données emprunteur manquantes — identification incomplète");
  } else if (empPillar.points < empPillar.max * 0.6) {
    empPillar.actions.forEach((a) => alertes.push(a));
  }

  // Projet alerts
  const projPillar = ss.pillars.find((p) => p.key === "projet")!;
  if (projPillar.points === 0) {
    alertes.push("Données projet absentes");
  }

  // Financial alerts
  const finPillar = ss.pillars.find((p) => p.key === "financier")!;
  if (finPillar.points < finPillar.max * 0.5) {
    finPillar.reasons.filter((r) => r.includes("élevé") || r.includes("absentes") || r.includes("incomplètes")).forEach((r) => alertes.push(r));
  }

  const score = ss.score;
  const niveau: Niveau =
    score >= 80 ? "Faible" : score >= 60 ? "Modéré" : score >= 40 ? "Élevé" : "Critique";

  return {
    score,
    niveau,
    label: ss.grade,
    alertes,
    calculatedAt: new Date().toISOString(),
    garantieRatio: ratio,
    smartscore: ss,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 4. STRUCTURED REPORT GENERATION
// ═══════════════════════════════════════════════════════════════════

export function generateStructuredReport(
  dossier: any,
  snap: any,
): StructuredReport {
  const analysis: AnalysisResult | null = dossier?.analysis ?? null;
  const ss = analysis?.smartscore ?? computeSmartScorePillars(dossier);
  const ratio = computeGarantieRatio(dossier);

  // ── Emprunteur ──
  const emp = dossier?.emprunteur;
  let emprunteur: ReportEmprunteur;
  if (!emp?.type) {
    emprunteur = {
      type: "inconnu",
      identite: dossier?.sponsor || "Non renseigné",
      details: {},
    };
  } else if (emp.type === "personne_physique") {
    emprunteur = {
      type: "personne_physique",
      identite: `${emp.prenom ?? ""} ${emp.nom ?? ""}`.trim() || "Non renseigné",
      details: {
        ...(emp.dateNaissance ? { "Date de naissance": emp.dateNaissance } : {}),
        ...(emp.nationalite ? { Nationalité: emp.nationalite } : {}),
        ...(emp.adresse ? { Adresse: emp.adresse } : {}),
        ...(emp.email ? { Email: emp.email } : {}),
        ...(emp.telephone ? { Téléphone: emp.telephone } : {}),
      },
    };
  } else {
    emprunteur = {
      type: "personne_morale",
      identite: emp.raisonSociale || "Non renseigné",
      details: {
        ...(emp.formeJuridique ? { "Forme juridique": emp.formeJuridique } : {}),
        ...(emp.sirenSiret ? { "SIREN/SIRET": emp.sirenSiret } : {}),
        ...(emp.representantLegal ? { "Représentant légal": emp.representantLegal } : {}),
        ...(emp.adresseSiege ? { Siège: emp.adresseSiege } : {}),
        ...(emp.email ? { Email: emp.email } : {}),
        ...(emp.telephone ? { Téléphone: emp.telephone } : {}),
      },
    };
  }

  // ── Projet ──
  const orig = dossier?.origination;
  const typePret = orig?.typePret ?? "";

  // ── Garanties ──
  const garItems = (dossier?.garanties?.items ?? []).map((g: any) => ({
    type: g.type ?? "autre",
    description: g.description || "Sans description",
    valeur: g.valeurEstimee ?? null,
    rang: g.rang,
  }));

  // ── Documents ──
  const docItems = (dossier?.documents?.items ?? []).map((d: any) => ({
    nom: d.nom || "Sans nom",
    type: d.type ?? "autre",
    statut: d.statut ?? "attendu",
    commentaire: d.commentaire,
  }));

  return {
    generatedAt: new Date().toISOString(),
    meta: {
      dossierLabel: dossier?.nom || "Sans nom",
      dossierId: dossier?.id || "—",
      statut: dossier?.statut || "BROUILLON",
    },
    emprunteur,
    projet: {
      montant: orig?.montantDemande ?? null,
      duree: orig?.duree ?? null,
      typePret,
      typePretLabel: PRET_TYPE_LABELS[typePret] ?? typePret ?? "Non renseigné",
      adresse: orig?.adresseProjet ?? "",
      notes: orig?.notes ?? "",
    },
    risk: {
      score: analysis?.score ?? ss.score,
      grade: analysis?.label ?? ss.grade,
      niveau: analysis?.niveau ?? (ss.score >= 80 ? "Faible" : ss.score >= 60 ? "Modéré" : ss.score >= 40 ? "Élevé" : "Critique"),
      computedAt: analysis?.calculatedAt ?? null,
      alertes: analysis?.alertes ?? [],
    },
    garanties: {
      total: garItems.length,
      couverture: dossier?.garanties?.couvertureTotale ?? 0,
      ratio,
      items: garItems,
      commentaire: dossier?.garanties?.commentaire ?? "",
    },
    documents: {
      total: docItems.length,
      completeness: dossier?.documents?.completude ?? 0,
      items: docItems,
    },
    smartscore: ss,
  };
}