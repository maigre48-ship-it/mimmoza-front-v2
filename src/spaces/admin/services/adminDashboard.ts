import { supabase } from "../../../lib/supabase";

export type AdminDashboardMetrics = {
  activeAdmins: number;
  organisations: number;
  organisationMembers: number;
  activeCreditAccounts: number;
  totalCreditsAvailable: number;
  consumedCredits: number;
  lowCreditAccounts: number;
  analysesCount: number;
  analysesSuccessCount: number;
  analysesErrorCount: number;
  banqueDossiersCount: number;
  banqueDossiersVigilanceCount: number;
  activeCreditPacks: number;
  estimatedPackCatalogValueEur: number;
};

export type AdminDashboardUserRow = {
  id: string;
  email: string;
  isActive: boolean;
  createdAt: string | null;
};

export type AdminDashboardOrganisationRow = {
  id: string;
  name: string;
  slug: string | null;
  planCode: string | null;
  createdAt: string | null;
  membersCount: number;
};

export type AdminDashboardAnalysisRow = {
  id: string;
  city: string | null;
  propertyType: string | null;
  planAtAnalysis: string | null;
  status: string | null;
  creditsUsed: number;
  createdAt: string | null;
};

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export async function getAdminDashboardMetrics(): Promise<AdminDashboardMetrics> {
  const { data, error } = await supabase.rpc("admin_dashboard_metrics");

  if (error) {
    throw new Error(`admin_dashboard_metrics: ${error.message}`);
  }

  const row = (data ?? {}) as Record<string, unknown>;

  return {
    activeAdmins: asNumber(row.activeAdmins),
    organisations: asNumber(row.organisations),
    organisationMembers: asNumber(row.organisationMembers),
    activeCreditAccounts: asNumber(row.activeCreditAccounts),
    totalCreditsAvailable: asNumber(row.totalCreditsAvailable),
    consumedCredits: asNumber(row.consumedCredits),
    lowCreditAccounts: asNumber(row.lowCreditAccounts),
    analysesCount: asNumber(row.analysesCount),
    analysesSuccessCount: asNumber(row.analysesSuccessCount),
    analysesErrorCount: asNumber(row.analysesErrorCount),
    banqueDossiersCount: asNumber(row.banqueDossiersCount),
    banqueDossiersVigilanceCount: asNumber(row.banqueDossiersVigilanceCount),
    activeCreditPacks: asNumber(row.activeCreditPacks),
    estimatedPackCatalogValueEur: asNumber(row.estimatedPackCatalogValueEur),
  };
}

export async function getAdminDashboardUsers(): Promise<AdminDashboardUserRow[]> {
  const { data, error } = await supabase.rpc("admin_dashboard_users");

  if (error) {
    throw new Error(`admin_dashboard_users: ${error.message}`);
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id ?? ""),
    email: String(row.email ?? "—"),
    isActive: row.is_active === true,
    createdAt: typeof row.created_at === "string" ? row.created_at : null,
  }));
}

export async function getAdminDashboardOrganisations(): Promise<AdminDashboardOrganisationRow[]> {
  const { data, error } = await supabase.rpc("admin_dashboard_organisations");

  if (error) {
    throw new Error(`admin_dashboard_organisations: ${error.message}`);
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id ?? ""),
    name: String(row.name ?? "Organisation"),
    slug: typeof row.slug === "string" ? row.slug : null,
    planCode: typeof row.plan_code === "string" ? row.plan_code : null,
    createdAt: typeof row.created_at === "string" ? row.created_at : null,
    membersCount: asNumber(row.members_count),
  }));
}

export async function getRecentAnalyses(): Promise<AdminDashboardAnalysisRow[]> {
  const { data, error } = await supabase.rpc("admin_dashboard_recent_analyses");

  if (error) {
    throw new Error(`admin_dashboard_recent_analyses: ${error.message}`);
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id ?? ""),
    city: typeof row.city === "string" ? row.city : null,
    propertyType: typeof row.property_type === "string" ? row.property_type : null,
    planAtAnalysis:
      typeof row.plan_at_analysis === "string" ? row.plan_at_analysis : null,
    status: typeof row.status === "string" ? row.status : null,
    creditsUsed: asNumber(row.credits_used),
    createdAt: typeof row.created_at === "string" ? row.created_at : null,
  }));
}