// src/spaces/marchand/services/enrichRisksToDueDiligence.service.ts
/**
 * enrichRisksToDueDiligence.service.ts
 *
 * Lit le snapshot Marchand (deal actif), appelle l'Edge Function
 * marchand-risques-v1, puis écrit 4 items « Risques externes »
 * dans le store DD.
 */

import { supabase } from "@/lib/supabaseClient";
import { ensureActiveDeal } from "../shared/marchandSnapshot.store";
import {
  upsertItemsForDossier,
  type DueDiligenceItem,
  type DDStatus,
} from "../shared/dueDiligence.store";

// ─── Helpers ────────────────────────────────────────────────────────

function clampStatus(s: DDStatus | string | null | undefined): DDStatus {
  const v = String(s ?? "").toUpperCase();
  if (v === "OK") return "OK";
  if (v === "WARNING") return "WARNING";
  if (v === "CRITICAL") return "CRITICAL";
  if (v === "MISSING") return "MISSING";
  return "MISSING";
}

/**
 * Déduit un statut DD à partir:
 * - d'une sévérité (low/moderate/high/critical/unknown)
 * - ou d'un label FR (faible/modéré/élevé/critique)
 * - ou d'un score_impact (pénalité 0..100, plus haut = pire)
 */
function severityToStatus(
  severity: string | null | undefined,
  scoreImpact?: number | null
): DDStatus {
  const s = (severity ?? "").toLowerCase();

  if (!s) {
    if (typeof scoreImpact === "number" && Number.isFinite(scoreImpact)) {
      if (scoreImpact >= 25) return "CRITICAL";
      if (scoreImpact >= 10) return "WARNING";
      return "OK";
    }
    return "MISSING";
  }

  if (s.includes("unknown") || s.includes("inconnu")) return "MISSING";

  if (s.includes("low") || s.includes("faible") || s.includes("absent"))
    return "OK";
  if (s.includes("moderate") || s.includes("mod") || s.includes("moyen"))
    return "WARNING";
  if (s.includes("high") || s.includes("eleve") || s.includes("fort"))
    return "CRITICAL";
  if (s.includes("critical") || s.includes("crit")) return "CRITICAL";

  // fallback via impact si dispo
  if (typeof scoreImpact === "number" && Number.isFinite(scoreImpact)) {
    if (scoreImpact >= 25) return "CRITICAL";
    if (scoreImpact >= 10) return "WARNING";
    return "OK";
  }

  return "MISSING";
}

/** Tronque un tableau de strings en un commentaire concis. */
function joinRationale(arr: string[] | undefined, fallback: string): string {
  if (!arr || arr.length === 0) return fallback;
  return arr.slice(0, 3).join(" · ");
}

function includesAny(hay: string, needles: string[]) {
  const s = hay.toLowerCase();
  return needles.some((n) => s.includes(n));
}

type GeoRiskItem = {
  key?: string;
  label?: string;
  severity?: string;
  score_impact?: number;
  confidence?: number;
  evidence?: string[];
  raw?: unknown;
};

// ─── Service principal ──────────────────────────────────────────────

export async function enrichRisksToDueDiligence(): Promise<{
  ok: boolean;
  error?: string;
}> {
  try {
    // 1) Deal actif
    const deal = ensureActiveDeal();
    if (!deal) {
      return { ok: false, error: "Aucun deal actif dans le snapshot Marchand." };
    }

    const { address, city, zipCode } = deal;

    // dealAny: si tu ajoutes lat/lng plus tard au deal, on les supporte
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dealAny = deal as Record<string, any>;
    const lat: number | undefined =
      dealAny.lat ?? dealAny.latitude ?? dealAny.LAT ?? undefined;
    const lng: number | undefined =
      dealAny.lng ?? dealAny.lon ?? dealAny.longitude ?? dealAny.LNG ?? undefined;

    if (!address && (lat == null || lng == null)) {
      return {
        ok: false,
        error: "Adresse ou coordonnées manquantes sur le deal actif.",
      };
    }

    // 2) Body
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: Record<string, any> = {};
    if (address) body.adresse = address; // ⚠️ l'EF marchand-risques-v1 attend "adresse" (comme banque-risques-v1)
    if (lat != null && lng != null) {
      body.lat = lat;
      body.lng = lng;
    }

    // (optionnel) utile pour debug côté EF
    if (city) body.city = city;
    if (zipCode) body.zipCode = zipCode;

    // 3) Appel EF
    const { data, error } = await supabase.functions.invoke(
      "marchand-risques-v1",
      { body }
    );

    if (error) {
      return { ok: false, error: `Edge Function error: ${error.message}` };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp = (data ?? null) as Record<string, any> | null;
    if (!resp) {
      return { ok: false, error: "Réponse vide de marchand-risques-v1." };
    }

    // 4) Parsing robuste (supporte plusieurs formats)
    // Format recommandé: { ok:true, risks: { scoring: { items, rationale, ... }, ... } }
    const risksObj = (resp.risks ?? resp.risksWithScore ?? resp) as any;

    const scoring = risksObj?.scoring ?? resp.scoring ?? null;
    const rationale: string[] =
      (scoring?.rationale as string[]) ??
      (risksObj?.scoring?.rationale as string[]) ??
      [];

    // Items géorisques scorés
    const items: GeoRiskItem[] =
      (scoring?.items as GeoRiskItem[]) ??
      (risksObj?.scoring?.items as GeoRiskItem[]) ??
      // fallback si jamais l'EF renvoie directement un tableau
      ((Array.isArray(resp.risks) ? resp.risks : []) as GeoRiskItem[]);

    // Utilitaires pour détecter inondation / sismique
    const textAll = JSON.stringify(risksObj ?? resp).toLowerCase();

    const itemByKey = (k: string) =>
      items.find((it) => String(it.key ?? "").toLowerCase() === k.toLowerCase());

    const itPpr = itemByKey("ppr");
    const itRisques = itemByKey("risques");
    const itCatnat = itemByKey("catnat");
    const itRadon = itemByKey("radon");

    // Inondation: prioriser PPR + indices dans "risques"
    const floodEvidence =
      (itPpr?.evidence ?? []).join(" ") +
      " " +
      (itRisques?.evidence ?? []).join(" ") +
      " " +
      textAll;

    const floodDetected = includesAny(floodEvidence, [
      "inond",
      "submersion",
      "crue",
      "ppri",
    ]);

    // Sismique: indices textuels (GeoRisques "risques" peut contenir sism)
    const seismicDetected = includesAny(textAll, ["sism", "seisme", "seismic"]);

    const now = new Date().toISOString();
    const dossierId = deal.id;

    // 5) Construire les items DD « Risques externes »
    // NB: On évite d'inventer ce qu'on ne mesure pas (nuisances/quartier)
    const inondationStatus: DDStatus = floodDetected
      ? "WARNING"
      : severityToStatus(itPpr?.severity ?? itRisques?.severity, itPpr?.score_impact);

    const sismiqueStatus: DDStatus = seismicDetected ? "WARNING" : "MISSING";

    const itemsDd: DueDiligenceItem[] = [
      {
        id: "risque_inondation",
        category: "risques_externes",
        label: "Risque inondation",
        status: inondationStatus,
        value: floodDetected
          ? "Indice détecté"
          : (itPpr?.label ?? itRisques?.label ?? null),
        comment: floodDetected
          ? `Indice inondation/PPR détecté. ${joinRationale(
              rationale,
              "Vérifier PPR / Géorisques."
            )}`
          : joinRationale(
              rationale,
              "Aucun indice explicite — vérifier PPR / Géorisques."
            ),
        updatedAt: now,
      },
      {
        id: "risque_sismique",
        category: "risques_externes",
        label: "Risque sismique",
        status: sismiqueStatus,
        value: seismicDetected ? "Indice détecté" : null,
        comment: seismicDetected
          ? "Mention sismicité détectée dans les données Géorisques (à confirmer)."
          : "Information non fournie dans les données analysées.",
        updatedAt: now,
      },
      {
        id: "nuisances",
        category: "risques_externes",
        label: "Nuisances",
        status: "MISSING",
        value: null,
        comment:
          "Information non fournie dans les données analysées (bruit/axes/ICPE non couverts par cet endpoint).",
        updatedAt: now,
      },
      {
        id: "quartier",
        category: "risques_externes",
        label: "Quartier (env. industriel)",
        status: "MISSING",
        value: null,
        comment: joinRationale(
          rationale,
          "Information non fournie dans les données analysées."
        ),
        updatedAt: now,
      },
    ].map((it) => ({ ...it, status: clampStatus(it.status) }));

    // 6) Persister store DD
    upsertItemsForDossier(dossierId, itemsDd);

    // Debug utile
    console.log("[enrichRisksToDueDiligence] ok", {
      dossierId,
      hasScoring: Boolean(scoring),
      itemsCount: items.length,
      keys: items.map((x) => x.key).filter(Boolean),
      floodDetected,
      seismicDetected,
    });

    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[enrichRisksToDueDiligence]", msg);
    return { ok: false, error: msg };
  }
}
