// src/spaces/marchand/scoring/smartScoreInvestisseur.ts

import type {
  InvestisseurSnapshot,
  SmartScoreResult,
  SmartScorePillar,
  MissingDataItem,
  Grade,
  Verdict,
} from "../store/investisseurSnapshot.store";

// ─── Grade / Verdict mapping ─────────────────────────────────────────

function gradeFromScore(score: number): Grade {
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= 60) return "C";
  if (score >= 50) return "D";
  return "E";
}

function verdictFromScore(score: number): Verdict {
  if (score >= 70) return "GO";
  if (score >= 55) return "GO_AVEC_RESERVES";
  return "NO_GO";
}

// ─── Pillar scorers ──────────────────────────────────────────────────

function scoreBienEtat(snap: InvestisseurSnapshot): SmartScorePillar {
  const d = snap.propertyDraft;
  const a = snap.assumptions;
  let score = 10; // base neutral
  const max = 20;
  const details: string[] = [];

  // Condition
  if (d.condition === "neuf") {
    score += 4;
    details.push("Bien neuf (+4)");
  } else if (d.condition === "bon") {
    score += 3;
    details.push("Bon état (+3)");
  } else if (d.condition === "a_renover") {
    score += 1;
    details.push("À rénover (+1)");
  } else if (d.condition === "a_rehabiliter") {
    score += 0;
    details.push("À réhabiliter (0)");
  }

  // DPE
  if (d.dpe) {
    const dpeScores: Record<string, number> = {
      A: 4,
      B: 3,
      C: 2,
      D: 1,
      E: 0,
      F: -1,
      G: -2,
      NC: 0,
    };
    const dpeBonus = dpeScores[d.dpe] ?? 0;
    score += dpeBonus;
    details.push(`DPE ${d.dpe} (${dpeBonus >= 0 ? "+" : ""}${dpeBonus})`);

    // Passoire énergétique with audit planned → partial recovery
    if ((d.dpe === "F" || d.dpe === "G") && a.auditEnergetiquePrevu === "fait") {
      score += 1;
      details.push("Audit énergétique réalisé (+1)");
    }
  }

  // Travaux ratio (travaux / prix)
  if (d.priceAsked && d.priceAsked > 0 && a.travauxBudget !== undefined) {
    const ratio = a.travauxBudget / d.priceAsked;
    if (ratio <= 0.05) {
      score += 2;
      details.push(`Travaux ≤5% du prix (+2)`);
    } else if (ratio <= 0.15) {
      score += 1;
      details.push(`Travaux ≤15% du prix (+1)`);
    } else if (ratio > 0.3) {
      score -= 1;
      details.push(`Travaux >30% du prix (-1)`);
    }
  }

  /* ────────────────────────────────────────────────────────────────
   * Étage / Ascenseur / Commerces / Transport
   * Champs optionnels sur propertyDraft, injectés par le Sourcing
   * adapter. Gardés par des checks != null pour ne pas casser
   * les callers existants qui ne les fournissent pas.
   * ──────────────────────────────────────────────────────────────── */
  const floor: number | undefined = (d as any).floor;
  const elevator: boolean | undefined = (d as any).elevator;
  const commerces: boolean | undefined = (d as any).commerces;
  const transport: boolean | undefined = (d as any).transport;

  console.log("[SmartScore] scoreBienEtat quality:", { floor, elevator, commerces, transport });

  // ── PATCH B – Nouvelle grille étage/ascenseur ─────────────────
  if (floor != null) {
    if (elevator === false) {
      // Sans ascenseur → pénalités croissantes
      if (floor >= 10) {
        score -= 6;
        details.push(`Étage ${floor} SANS ascenseur → pénalité très forte (-6)`);
      } else if (floor >= 7) {
        score -= 5;
        details.push(`Étage ${floor} SANS ascenseur → pénalité forte (-5)`);
      } else if (floor >= 5) {
        score -= 4;
        details.push(`Étage ${floor} SANS ascenseur → pénalité (-4)`);
      } else if (floor >= 3) {
        score -= 2;
        details.push(`Étage ${floor} sans ascenseur → pénalité (-2)`);
      } else if (floor === 0) {
        score -= 1;
        details.push("RDC → léger malus (-1, vis-à-vis/bruit)");
      }
      // floor 1-2 sans ascenseur → neutre (pas de malus ni bonus)
    } else if (elevator === true) {
      // Avec ascenseur
      if (floor === 0) {
        score -= 1;
        details.push("RDC → léger malus (-1, vis-à-vis/bruit)");
      } else if (floor >= 8) {
        score -= 1;
        details.push(`Étage ${floor} élevé même avec ascenseur → léger malus (-1)`);
      } else if (floor >= 3) {
        score += 1;
        details.push(`Étage ${floor} avec ascenseur → bon (+1)`);
      }
      // floor 1-2 avec ascenseur → neutre
    } else {
      // elevator undefined → on ne sait pas, juste RDC malus
      if (floor === 0) {
        score -= 1;
        details.push("RDC → léger malus (-1, vis-à-vis/bruit)");
      }
    }
  }

  // ── PATCH B – Commerces & Transport (bonus renforcé) ──────────
  if (commerces != null) {
    if (commerces) {
      score += 2;
      details.push("Commerces à proximité (+2)");
    } else {
      score -= 1;
      details.push("Pas de commerces proches (-1)");
    }
  }

  if (transport != null) {
    if (transport) {
      score += 2;
      details.push("Transport à proximité (+2)");
    } else {
      score -= 1;
      details.push("Pas de transport proche (-1)");
    }
  }

  return {
    key: "bien_etat",
    label: "Bien / État",
    score: clamp(score, 0, max),
    max,
    details,
  };
}

function scoreMarche(snap: InvestisseurSnapshot): SmartScorePillar {
  const max = 20;
  const details: string[] = [];
  const market = snap.enriched.market;

  // ── PATCH A – market absent → score dégradé 8/20 + warning ────
  if (!market) {
    details.push("Données marché non disponibles → score dégradé (8/20)");
    details.push("⚠ DVF indisponible → impossible de valider le prix");
    return { key: "marche", label: "Marché", score: 8, max, details };
  }

  // ── PATCH A – Score initial à 0, centré sur 10 après calcul ───
  let bonus = 0;

  // DVF comparison
  if (
    market.prixM2Median &&
    snap.propertyDraft.priceAsked &&
    snap.propertyDraft.surfaceHabitable
  ) {
    const prixM2 =
      snap.propertyDraft.priceAsked / snap.propertyDraft.surfaceHabitable;
    const deltaPct = (prixM2 / market.prixM2Median - 1) * 100;

    const nbComp = (market as any).nbComparables as number | undefined;

    // ── Details DVF obligatoires ────────────────────────────────
    details.push(
      `Prix/m² bien : ${Math.round(prixM2).toLocaleString("fr-FR")} €/m²`,
    );
    details.push(
      `Médiane DVF : ${Math.round(market.prixM2Median).toLocaleString("fr-FR")} €/m²${
        nbComp != null ? ` (n=${nbComp})` : ""
      }`,
    );
    details.push(
      `Décote/Surcote : ${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)} %`,
    );

    console.log("[SmartScore] DVF compare:", {
      prixM2: Math.round(prixM2),
      dvfMedian: Math.round(market.prixM2Median),
      deltaPct: deltaPct.toFixed(1),
      nbComp,
    });

    // ── Nouvelle grille deltaPct → bonus ────────────────────────
    let rawBonus = 0;
    if (deltaPct <= -20) {
      rawBonus = 8;
      details.push(`Décote > 20% → fort bonus (+8)`);
    } else if (deltaPct <= -10) {
      rawBonus = 5;
      details.push(`Décote 10-20% → bon bonus (+5)`);
    } else if (deltaPct <= -5) {
      rawBonus = 3;
      details.push(`Décote 5-10% → bonus (+3)`);
    } else if (deltaPct <= 5) {
      rawBonus = 0;
      details.push(`Prix dans la médiane (±5%) → neutre`);
    } else if (deltaPct <= 10) {
      rawBonus = -3;
      details.push(`Surcote 5-10% → malus (-3)`);
    } else if (deltaPct <= 20) {
      rawBonus = -6;
      details.push(`Surcote 10-20% → forte pénalité (-6)`);
    } else {
      rawBonus = -8;
      details.push(`Surcote > 20% → très forte pénalité (-8)`);
    }

    // ── Atténuation si peu de comparables ───────────────────────
    if (nbComp != null && nbComp < 5) {
      rawBonus = Math.round(rawBonus * 0.5);
      details.push(`Peu de comparables (${nbComp}) → bonus/malus atténué ×0.5`);
    }

    bonus += rawBonus;
  } else {
    // market existe mais données insuffisantes pour comparer
    details.push("Données DVF partielles → comparaison impossible, score neutre");
  }

  // Tendance
  if (market.tendance === "hausse") {
    bonus += 3;
    details.push("Marché en hausse (+3)");
  } else if (market.tendance === "baisse") {
    bonus -= 2;
    details.push("Marché en baisse (-2)");
  }

  // Score final = 10 (centre) + bonus, clampé [0, 20]
  const score = clamp(10 + bonus, 0, max);

  return {
    key: "marche",
    label: "Marché",
    score,
    max,
    details,
  };
}

function scoreRisques(snap: InvestisseurSnapshot): SmartScorePillar {
  const max = 20;
  const details: string[] = [];
  const risques = snap.enriched.risques;

  if (!risques) {
    details.push("Données risques non disponibles → neutre (14/20)");
    return { key: "risques", label: "Risques", score: 14, max, details };
  }

  let score = 16; // start optimistic

  // Count risk flags
  const riskFlags = [
    risques.inondation,
    risques.seisme,
    risques.argiles,
    risques.radon,
    risques.pollution,
  ].filter(Boolean);

  if (riskFlags.length === 0) {
    score += 2;
    details.push("Aucun risque majeur identifié (+2)");
  } else if (riskFlags.length <= 2) {
    score -= 2;
    details.push(`${riskFlags.length} risque(s) identifié(s) (-2)`);
  } else {
    score -= 6;
    details.push(`${riskFlags.length} risques majeurs identifiés (-6)`);
  }

  return {
    key: "risques",
    label: "Risques",
    score: clamp(score, 0, max),
    max,
    details,
  };
}

function scoreRentabilite(snap: InvestisseurSnapshot): SmartScorePillar {
  const max = 25;
  const details: string[] = [];
  const d = snap.propertyDraft;
  const a = snap.assumptions;

  // Need price for any calc
  if (!d.priceAsked || d.priceAsked <= 0) {
    details.push("Prix d'achat manquant → neutre (12/25)");
    return {
      key: "rentabilite",
      label: "Rentabilité",
      score: 12,
      max,
      details,
    };
  }

  const totalInvest =
    d.priceAsked +
    (a.travauxBudget ?? 0) +
    (a.budgetRenovationEnergetique ?? 0);
  let score = 12;

  // ── Revente strategy: use prixReventeCible or margeCiblePct ──
  if (a.strategie === "revente") {
    let margeNette: number | undefined;

    if (a.prixReventeCible && a.prixReventeCible > 0) {
      margeNette = ((a.prixReventeCible - totalInvest) / totalInvest) * 100;
      details.push(
        `Marge revente estimée : ${margeNette.toFixed(1)}% (sur invest total ${totalInvest.toLocaleString("fr-FR")} €)`
      );
    } else if (a.margeCiblePct && a.margeCiblePct > 0) {
      margeNette = a.margeCiblePct;
      details.push(`Marge cible déclarée : ${margeNette}%`);
    }

    if (margeNette !== undefined) {
      if (margeNette >= 25) {
        score = 23;
        details.push("Excellente marge ≥25% (+)");
      } else if (margeNette >= 15) {
        score = 19;
        details.push("Bonne marge ≥15% (+)");
      } else if (margeNette >= 8) {
        score = 14;
        details.push("Marge correcte ≥8%");
      } else if (margeNette >= 0) {
        score = 9;
        details.push("Marge faible <8%");
      } else {
        score = 4;
        details.push("Marge négative (-)");
      }
    } else {
      details.push(
        "Revente : données insuffisantes pour calcul précis → neutre"
      );
    }
  }

  // ── Location / Patrimonial: rendement ──
  if (a.loyerMensuelCible && a.loyerMensuelCible > 0) {
    const loyerAnnuel = a.loyerMensuelCible * 12;
    const chargesAnnuelles =
      (d.chargesMensuelles ?? 0) * 12 + (d.taxeFonciere ?? 0);
    const loyerNet = loyerAnnuel - chargesAnnuelles;
    const rendementBrut = (loyerAnnuel / totalInvest) * 100;
    const rendementNet = (loyerNet / totalInvest) * 100;

    details.push(`Rendement brut : ${rendementBrut.toFixed(1)}%`);
    details.push(`Rendement net : ${rendementNet.toFixed(1)}%`);

    if (rendementNet >= 8) {
      score = 23;
      details.push("Excellent rendement net ≥8% (+)");
    } else if (rendementNet >= 6) {
      score = 20;
      details.push("Très bon rendement net ≥6% (+)");
    } else if (rendementNet >= 4) {
      score = 16;
      details.push("Rendement net correct ≥4%");
    } else if (rendementNet >= 2) {
      score = 12;
      details.push("Rendement net faible ≥2%");
    } else {
      score = 6;
      details.push("Rendement net très faible <2% (-)");
    }
  }

  return {
    key: "rentabilite",
    label: "Rentabilité",
    score: clamp(score, 0, max),
    max,
    details,
  };
}

function scoreDonnees(
  snap: InvestisseurSnapshot,
  missingData: MissingDataItem[]
): SmartScorePillar {
  const max = 15;
  const details: string[] = [];

  const blockers = missingData.filter((m) => m.severity === "blocker").length;
  const warns = missingData.filter((m) => m.severity === "warn").length;

  let score = max;

  if (blockers > 0) {
    score -= blockers * 4;
    details.push(
      `${blockers} donnée(s) bloquante(s) (-${blockers * 4})`
    );
  }
  if (warns > 0) {
    score -= warns * 2;
    details.push(`${warns} donnée(s) manquante(s) (-${warns * 2})`);
  }

  if (score === max) {
    details.push("Toutes les données clés sont renseignées");
  }

  return {
    key: "donnees",
    label: "Complétude",
    score: clamp(score, 0, max),
    max,
    details,
  };
}

// ─── Missing data detection ──────────────────────────────────────────

function detectMissingData(snap: InvestisseurSnapshot): MissingDataItem[] {
  const missing: MissingDataItem[] = [];
  const d = snap.propertyDraft;
  const a = snap.assumptions;

  if (!d.address && !(d.lat && d.lng)) {
    missing.push({
      key: "address",
      label: "Adresse ou coordonnées",
      severity: "blocker",
    });
  }
  if (!d.surfaceHabitable) {
    missing.push({
      key: "surfaceHabitable",
      label: "Surface habitable",
      severity: "blocker",
    });
  }
  if (!d.priceAsked) {
    missing.push({
      key: "priceAsked",
      label: "Prix demandé",
      severity: "blocker",
    });
  }
  if (!d.propertyType) {
    missing.push({
      key: "propertyType",
      label: "Type de bien",
      severity: "warn",
    });
  }
  if (!d.condition) {
    missing.push({
      key: "condition",
      label: "État du bien",
      severity: "warn",
    });
  }
  if (!d.dpe) {
    missing.push({ key: "dpe", label: "DPE", severity: "info" });
  }
  if (!a.strategie) {
    missing.push({
      key: "strategie",
      label: "Stratégie d'investissement",
      severity: "warn",
    });
  }
  if (
    (a.strategie === "location" || a.strategie === "patrimonial") &&
    !a.loyerMensuelCible
  ) {
    missing.push({
      key: "loyerMensuelCible",
      label: "Loyer mensuel cible",
      severity: "warn",
    });
  }
  if (
    a.strategie === "revente" &&
    !a.prixReventeCible &&
    !a.margeCiblePct
  ) {
    missing.push({
      key: "reventeObjectif",
      label: "Objectif de revente (marge ou prix cible)",
      severity: "warn",
    });
  }
  if (!snap.enriched.market) {
    missing.push({
      key: "market",
      label: "Données marché (enrichissement)",
      severity: "info",
    });
  }
  if (!snap.enriched.risques) {
    missing.push({
      key: "risques",
      label: "Données risques (enrichissement)",
      severity: "info",
    });
  }

  return missing;
}

// ─── Main export ─────────────────────────────────────────────────────

export function computeSmartScoreInvestisseur(
  snapshot: InvestisseurSnapshot
): { smartscore: SmartScoreResult; missingData: MissingDataItem[] } {
  const missingData = detectMissingData(snapshot);

  const pillars: SmartScorePillar[] = [
    scoreBienEtat(snapshot),
    scoreMarche(snapshot),
    scoreRisques(snapshot),
    scoreRentabilite(snapshot),
    scoreDonnees(snapshot, missingData),
  ];

  const totalScore = pillars.reduce((sum, p) => sum + p.score, 0);
  const totalMax = pillars.reduce((sum, p) => sum + p.max, 0);

  // Normalize to 0-100
  const normalized =
    totalMax > 0 ? Math.round((totalScore / totalMax) * 100) : 0;

  const smartscore: SmartScoreResult = {
    score: normalized,
    grade: gradeFromScore(normalized),
    verdict: verdictFromScore(normalized),
    pillars,
  };

  return { smartscore, missingData };
}

// ─── Utility ─────────────────────────────────────────────────────────

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}