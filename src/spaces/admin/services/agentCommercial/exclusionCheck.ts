// src/spaces/admin/services/agentCommercial/exclusionCheck.ts
// ─────────────────────────────────────────────────────────────────────────────
// Module RÉUTILISABLE de vérification d'exclusion. Central : il resservira aux
// phases 5 (génération IA) et 6 (envoi Gmail) — aucun message ne doit être généré
// ni envoyé vers une adresse/domaine/SIREN présent ici.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from "@/lib/supabase";

/** Normalise un email : trim + minuscules, ou null si vide. */
export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const t = email.trim().toLowerCase();
  return t.length > 0 ? t : null;
}

/** Extrait le domaine d'un email normalisé, ou null. */
export function domainOfEmail(email: string | null | undefined): string | null {
  const e = normalizeEmail(email);
  if (!e) return null;
  const at = e.lastIndexOf("@");
  if (at < 0 || at === e.length - 1) return null;
  return e.slice(at + 1);
}

/** Normalise un domaine : trim + minuscules, retire un éventuel « @ » de tête. */
export function normalizeDomain(domain: string | null | undefined): string | null {
  if (!domain) return null;
  const t = domain.trim().toLowerCase().replace(/^@/, "");
  return t.length > 0 ? t : null;
}

/** Normalise un SIREN : ne garde que les chiffres, ou null. */
export function normalizeSiren(siren: string | null | undefined): string | null {
  if (!siren) return null;
  const t = siren.replace(/\D/g, "");
  return t.length > 0 ? t : null;
}

export interface ExclusionIndex {
  emails: Set<string>;
  domains: Set<string>;
  sirens: Set<string>;
}

export type ExclusionReason = "email" | "domain" | "siren";

export interface ExclusionMatch {
  excluded: boolean;
  reason?: ExclusionReason;
}

/**
 * Charge une seule fois l'ensemble des exclusions sous forme d'index en mémoire.
 * À utiliser pour vérifier un lot (ex. import CSV) sans requête par ligne.
 */
export async function loadExclusionIndex(): Promise<ExclusionIndex> {
  const { data, error } = await supabase
    .from("commercial_exclusions")
    .select("email, domain, siren");

  if (error) throw new Error(error.message);

  const emails = new Set<string>();
  const domains = new Set<string>();
  const sirens = new Set<string>();

  for (const row of (data ?? []) as Array<{
    email: string | null;
    domain: string | null;
    siren: string | null;
  }>) {
    const e = normalizeEmail(row.email);
    if (e) emails.add(e);
    const d = normalizeDomain(row.domain);
    if (d) domains.add(d);
    const s = normalizeSiren(row.siren);
    if (s) sirens.add(s);
  }

  return { emails, domains, sirens };
}

/** Vérifie une entrée contre un index déjà chargé (email → domaine → SIREN). */
export function matchExclusion(
  index: ExclusionIndex,
  input: { email?: string | null; siren?: string | null },
): ExclusionMatch {
  const email = normalizeEmail(input.email);
  if (email && index.emails.has(email)) return { excluded: true, reason: "email" };

  const domain = domainOfEmail(input.email);
  if (domain && index.domains.has(domain)) return { excluded: true, reason: "domain" };

  const siren = normalizeSiren(input.siren);
  if (siren && index.sirens.has(siren)) return { excluded: true, reason: "siren" };

  return { excluded: false };
}

/** Vérifie une seule entrée (charge l'index à la volée). */
export async function isExcluded(input: {
  email?: string | null;
  siren?: string | null;
}): Promise<ExclusionMatch> {
  const index = await loadExclusionIndex();
  return matchExclusion(index, input);
}

const EXCLUSION_REASON_LABELS: Record<ExclusionReason, string> = {
  email: "email exclu",
  domain: "domaine exclu",
  siren: "SIREN exclu",
};

export function exclusionReasonLabel(reason: ExclusionReason): string {
  return EXCLUSION_REASON_LABELS[reason];
}
