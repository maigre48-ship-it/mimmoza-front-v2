import { supabase } from "../../../lib/supabase";
import type {
  AdminCompany,
  AdminPlanType,
  AdminQuote,
  AdminSubscription,
  AdminTokenLedger,
  AdminUser,
  AdminUserStatus,
  CompanyStatus,
  QuoteStatus,
} from "../types/admin.types";

export type AdminSettings = {
  investorTokens10PriceHt: number;
  investorTokens20PriceHt: number;
  investorStarterPriceHt: number;
  investorProPriceHt: number;
  iaCostPerAnalysisHt: number;
  adminNotes: string;
};

const DEFAULT_SETTINGS: AdminSettings = {
  investorTokens10PriceHt: 9.9,
  investorTokens20PriceHt: 16.9,
  investorStarterPriceHt: 39.9,
  investorProPriceHt: 74.99,
  iaCostPerAnalysisHt: 0.03,
  adminNotes: "Mode live Supabase",
};

type AdminUserRow = {
  id: string;
  full_name: string;
  email: string;
  role: AdminUser["role"];
  status: AdminUserStatus;
  plan: AdminPlanType;
  tokens_remaining: number;
  monthly_quota: number | null;
  created_at: string;
  company_name: string | null;
};

type AdminSubscriptionRow = {
  id: string;
  user_id: string;
  plan: AdminPlanType;
  amount_ht_eur: number;
  interval: "month" | "one-shot" | "custom";
  status: "active" | "pending" | "canceled";
  quota_included: number | null;
  renewal_date: string | null;
  created_at: string;
};

type AdminTokenLedgerRow = {
  id: string;
  user_id: string;
  type: AdminTokenLedger["type"];
  delta: number;
  label: string;
  created_at: string;
};

type AdminQuoteRow = {
  id: string;
  company_name: string;
  contact_name: string;
  email: string;
  segment: AdminQuote["segment"];
  status: QuoteStatus;
  estimated_amount_ht: number;
  notes: string;
  created_at: string;
};

type AdminCompanyRow = {
  id: string;
  name: string;
  segment: AdminCompany["segment"];
  status: CompanyStatus;
  users_count: number;
  active_plan: AdminPlanType;
  mrr_ht: number;
  owner_name: string;
};

type AdminSettingsRow = {
  id: boolean;
  investor_tokens10_price_ht: number;
  investor_tokens20_price_ht: number;
  investor_starter_price_ht: number;
  investor_pro_price_ht: number;
  ia_cost_per_analysis_ht: number;
  admin_notes: string;
};

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function toAdminUser(row: AdminUserRow): AdminUser {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    status: row.status,
    plan: row.plan,
    tokensRemaining: row.tokens_remaining,
    monthlyQuota: row.monthly_quota,
    createdAt: row.created_at,
    companyName: row.company_name ?? undefined,
  };
}

function toAdminSubscription(row: AdminSubscriptionRow): AdminSubscription {
  return {
    id: row.id,
    userId: row.user_id,
    plan: row.plan,
    amountHtEur: row.amount_ht_eur,
    interval: row.interval,
    status: row.status,
    quotaIncluded: row.quota_included,
    renewalDate: row.renewal_date,
  };
}

function toAdminTokenLedger(row: AdminTokenLedgerRow): AdminTokenLedger {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    delta: row.delta,
    label: row.label,
    createdAt: row.created_at,
  };
}

function toAdminQuote(row: AdminQuoteRow): AdminQuote {
  return {
    id: row.id,
    companyName: row.company_name,
    contactName: row.contact_name,
    email: row.email,
    segment: row.segment,
    status: row.status,
    estimatedAmountHt: row.estimated_amount_ht,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

function toAdminCompany(row: AdminCompanyRow): AdminCompany {
  return {
    id: row.id,
    name: row.name,
    segment: row.segment,
    status: row.status,
    usersCount: row.users_count,
    activePlan: row.active_plan,
    mrrHt: row.mrr_ht,
    ownerName: row.owner_name,
  };
}

function toAdminSettings(row: AdminSettingsRow): AdminSettings {
  return {
    investorTokens10PriceHt: row.investor_tokens10_price_ht,
    investorTokens20PriceHt: row.investor_tokens20_price_ht,
    investorStarterPriceHt: row.investor_starter_price_ht,
    investorProPriceHt: row.investor_pro_price_ht,
    iaCostPerAnalysisHt: row.ia_cost_per_analysis_ht,
    adminNotes: row.admin_notes,
  };
}

function fromAdminSettings(settings: AdminSettings): Omit<AdminSettingsRow, "id"> {
  return {
    investor_tokens10_price_ht: settings.investorTokens10PriceHt,
    investor_tokens20_price_ht: settings.investorTokens20PriceHt,
    investor_starter_price_ht: settings.investorStarterPriceHt,
    investor_pro_price_ht: settings.investorProPriceHt,
    ia_cost_per_analysis_ht: settings.iaCostPerAnalysisHt,
    admin_notes: settings.adminNotes,
  };
}

function getPlanMeta(plan: AdminPlanType): {
  amountHtEur: number;
  interval: "month" | "one-shot" | "custom";
  quotaIncluded: number | null;
  subscriptionStatus: "active" | "pending" | "canceled";
} {
  switch (plan) {
    case "tokens-10":
      return {
        amountHtEur: 9.9,
        interval: "one-shot",
        quotaIncluded: 10,
        subscriptionStatus: "active",
      };
    case "tokens-20":
      return {
        amountHtEur: 16.9,
        interval: "one-shot",
        quotaIncluded: 20,
        subscriptionStatus: "active",
      };
    case "starter":
      return {
        amountHtEur: 39.9,
        interval: "month",
        quotaIncluded: 50,
        subscriptionStatus: "active",
      };
    case "pro":
      return {
        amountHtEur: 74.99,
        interval: "month",
        quotaIncluded: 200,
        subscriptionStatus: "active",
      };
    case "promoteur-starter":
      return {
        amountHtEur: 149,
        interval: "month",
        quotaIncluded: null,
        subscriptionStatus: "active",
      };
    case "promoteur-pro":
      return {
        amountHtEur: 299,
        interval: "month",
        quotaIncluded: null,
        subscriptionStatus: "active",
      };
    case "promoteur-enterprise":
      return {
        amountHtEur: 799,
        interval: "custom",
        quotaIncluded: null,
        subscriptionStatus: "active",
      };
    case "financeur-pro":
      return {
        amountHtEur: 299,
        interval: "month",
        quotaIncluded: null,
        subscriptionStatus: "active",
      };
    case "financeur-equipe":
      return {
        amountHtEur: 699,
        interval: "month",
        quotaIncluded: null,
        subscriptionStatus: "active",
      };
    case "financeur-enterprise":
      return {
        amountHtEur: 1499,
        interval: "custom",
        quotaIncluded: null,
        subscriptionStatus: "active",
      };
    case "custom":
      return {
        amountHtEur: 0,
        interval: "custom",
        quotaIncluded: null,
        subscriptionStatus: "pending",
      };
    case "none":
    default:
      return {
        amountHtEur: 0,
        interval: "custom",
        quotaIncluded: null,
        subscriptionStatus: "canceled",
      };
  }
}

function nextRenewalDate(): string {
  const now = new Date();
  now.setMonth(now.getMonth() + 1);
  return now.toISOString().slice(0, 10);
}

function roleFromPlan(plan: AdminPlanType): AdminUser["role"] {
  if (String(plan).startsWith("promoteur")) return "promoteur";
  if (String(plan).startsWith("financeur")) return "financeur";
  return "investisseur";
}

export async function resetAdminStorage(): Promise<void> {
  await supabase.from("admin_token_ledger").delete().neq("id", "");
  await supabase.from("admin_subscriptions").delete().neq("id", "");
  await supabase.from("admin_quotes").delete().neq("id", "");
  await supabase.from("admin_companies").delete().neq("id", "");
  await supabase.from("admin_users").delete().neq("id", "");
}

export async function initAdminStorage(): Promise<void> {
  const { data } = await supabase
    .from("admin_settings")
    .select("id")
    .eq("id", true)
    .maybeSingle();

  if (!data) {
    await supabase.from("admin_settings").upsert({
      id: true,
      ...fromAdminSettings(DEFAULT_SETTINGS),
    });
  }
}

export async function getAdminUsers(): Promise<AdminUser[]> {
  await initAdminStorage();

  const { data, error } = await supabase
    .from("admin_users")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data as AdminUserRow[]).map(toAdminUser);
}

export async function saveAdminUsers(users: AdminUser[]): Promise<void> {
  const payload: AdminUserRow[] = users.map((user) => ({
    id: user.id,
    full_name: user.fullName,
    email: user.email,
    role: user.role,
    status: user.status,
    plan: user.plan,
    tokens_remaining: user.tokensRemaining,
    monthly_quota: user.monthlyQuota,
    created_at: user.createdAt,
    company_name: user.companyName ?? null,
  }));

  const { error } = await supabase.from("admin_users").upsert(payload);
  if (error) throw error;
}

export async function getAdminSubscriptions(): Promise<AdminSubscription[]> {
  await initAdminStorage();

  const { data, error } = await supabase
    .from("admin_subscriptions")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data as AdminSubscriptionRow[]).map(toAdminSubscription);
}

export async function saveAdminSubscriptions(
  subscriptions: AdminSubscription[]
): Promise<void> {
  const payload: AdminSubscriptionRow[] = subscriptions.map((sub) => ({
    id: sub.id,
    user_id: sub.userId,
    plan: sub.plan,
    amount_ht_eur: sub.amountHtEur,
    interval: sub.interval,
    status: sub.status,
    quota_included: sub.quotaIncluded,
    renewal_date: sub.renewalDate,
    created_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from("admin_subscriptions").upsert(payload);
  if (error) throw error;
}

export async function getAdminTokenLedger(): Promise<AdminTokenLedger[]> {
  await initAdminStorage();

  const { data, error } = await supabase
    .from("admin_token_ledger")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data as AdminTokenLedgerRow[]).map(toAdminTokenLedger);
}

export async function saveAdminTokenLedger(entries: AdminTokenLedger[]): Promise<void> {
  const payload: AdminTokenLedgerRow[] = entries.map((entry) => ({
    id: entry.id,
    user_id: entry.userId,
    type: entry.type,
    delta: entry.delta,
    label: entry.label,
    created_at: entry.createdAt,
  }));

  const { error } = await supabase.from("admin_token_ledger").upsert(payload);
  if (error) throw error;
}

export async function getAdminQuotes(): Promise<AdminQuote[]> {
  await initAdminStorage();

  const { data, error } = await supabase
    .from("admin_quotes")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data as AdminQuoteRow[]).map(toAdminQuote);
}

export async function saveAdminQuotes(quotes: AdminQuote[]): Promise<void> {
  const payload: AdminQuoteRow[] = quotes.map((quote) => ({
    id: quote.id,
    company_name: quote.companyName,
    contact_name: quote.contactName,
    email: quote.email,
    segment: quote.segment,
    status: quote.status,
    estimated_amount_ht: quote.estimatedAmountHt,
    notes: quote.notes,
    created_at: quote.createdAt,
  }));

  const { error } = await supabase.from("admin_quotes").upsert(payload);
  if (error) throw error;
}

export async function getAdminCompanies(): Promise<AdminCompany[]> {
  await initAdminStorage();

  const { data, error } = await supabase
    .from("admin_companies")
    .select("*");

  if (error) throw error;
  return (data as AdminCompanyRow[]).map(toAdminCompany);
}

export async function saveAdminCompanies(companies: AdminCompany[]): Promise<void> {
  const payload: AdminCompanyRow[] = companies.map((company) => ({
    id: company.id,
    name: company.name,
    segment: company.segment,
    status: company.status,
    users_count: company.usersCount,
    active_plan: company.activePlan,
    mrr_ht: company.mrrHt,
    owner_name: company.ownerName,
  }));

  const { error } = await supabase.from("admin_companies").upsert(payload);
  if (error) throw error;
}

export async function getAdminSettings(): Promise<AdminSettings> {
  await initAdminStorage();

  const { data, error } = await supabase
    .from("admin_settings")
    .select("*")
    .eq("id", true)
    .maybeSingle();

  if (error) throw error;
  if (!data) return DEFAULT_SETTINGS;

  return toAdminSettings(data as AdminSettingsRow);
}

export async function saveAdminSettings(settings: AdminSettings): Promise<void> {
  const { error } = await supabase.from("admin_settings").upsert({
    id: true,
    ...fromAdminSettings(settings),
  });

  if (error) throw error;
}

export async function updateAdminUserStatus(
  userId: string,
  status: AdminUserStatus
): Promise<AdminUser[]> {
  const { error: userError } = await supabase
    .from("admin_users")
    .update({ status })
    .eq("id", userId);

  if (userError) throw userError;

  const subscriptionStatus: "active" | "pending" | "canceled" =
    status === "suspendu"
      ? "canceled"
      : status === "essai"
        ? "pending"
        : "active";

  const { error: subError } = await supabase
    .from("admin_subscriptions")
    .update({ status: subscriptionStatus })
    .eq("user_id", userId);

  if (subError) throw subError;

  return getAdminUsers();
}

export async function addAdminUserTokens(
  userId: string,
  amount: number
): Promise<AdminUser[]> {
  const users = await getAdminUsers();
  const target = users.find((user) => user.id === userId);
  if (!target) return users;

  const nextBalance = Math.max(0, target.tokensRemaining + amount);

  const { error: updateError } = await supabase
    .from("admin_users")
    .update({ tokens_remaining: nextBalance })
    .eq("id", userId);

  if (updateError) throw updateError;

  const { error: ledgerError } = await supabase.from("admin_token_ledger").insert({
    id: createId("tok_manual"),
    user_id: userId,
    type: "adjustment",
    delta: amount,
    label: `Ajustement admin (${amount > 0 ? "+" : ""}${amount})`,
    created_at: new Date().toISOString(),
  });

  if (ledgerError) throw ledgerError;

  return getAdminUsers();
}

export async function consumeAdminUserTokens(
  userId: string,
  amount: number
): Promise<AdminUser[]> {
  return addAdminUserTokens(userId, -Math.abs(amount));
}

export async function updateAdminUserPlan(
  userId: string,
  plan: AdminPlanType
): Promise<AdminUser[]> {
  const meta = getPlanMeta(plan);
  const users = await getAdminUsers();
  const target = users.find((user) => user.id === userId);
  if (!target) return users;

  const nextUser: Partial<AdminUserRow> = {
    plan,
    role: roleFromPlan(plan),
    monthly_quota: meta.quotaIncluded,
    tokens_remaining:
      meta.quotaIncluded !== null ? meta.quotaIncluded : target.tokensRemaining,
    status: plan === "none" ? "résilié" : "actif",
  };

  const { error: userError } = await supabase
    .from("admin_users")
    .update(nextUser)
    .eq("id", userId);

  if (userError) throw userError;

  const { error: deleteSubError } = await supabase
    .from("admin_subscriptions")
    .delete()
    .eq("user_id", userId);

  if (deleteSubError) throw deleteSubError;

  if (plan !== "none") {
    const { error: insertSubError } = await supabase
      .from("admin_subscriptions")
      .insert({
        id: createId("sub"),
        user_id: userId,
        plan,
        amount_ht_eur: meta.amountHtEur,
        interval: meta.interval,
        status: meta.subscriptionStatus,
        quota_included: meta.quotaIncluded,
        renewal_date: meta.interval === "month" ? nextRenewalDate() : null,
        created_at: new Date().toISOString(),
      });

    if (insertSubError) throw insertSubError;
  }

  if (meta.quotaIncluded && meta.quotaIncluded > 0) {
    const { error: ledgerError } = await supabase
      .from("admin_token_ledger")
      .insert({
        id: createId("tok_plan"),
        user_id: userId,
        type: "purchase",
        delta: meta.quotaIncluded,
        label: `Attribution plan ${plan}`,
        created_at: new Date().toISOString(),
      });

    if (ledgerError) throw ledgerError;
  }

  return getAdminUsers();
}

export async function updateAdminQuoteStatus(
  quoteId: string,
  status: QuoteStatus
): Promise<AdminQuote[]> {
  const { error } = await supabase
    .from("admin_quotes")
    .update({ status })
    .eq("id", quoteId);

  if (error) throw error;
  return getAdminQuotes();
}

function companyPlanFromSegment(segment: AdminQuote["segment"]): AdminPlanType {
  switch (segment) {
    case "promoteur":
      return "promoteur-pro";
    case "financeur":
      return "financeur-equipe";
    case "investisseur":
    default:
      return "pro";
  }
}

export async function convertQuoteToClient(quoteId: string): Promise<void> {
  const quotes = await getAdminQuotes();
  const quote = quotes.find((item) => item.id === quoteId);
  if (!quote) return;

  const plan = companyPlanFromSegment(quote.segment);
  const subMeta = getPlanMeta(plan);

  const companyId = createId("co");
  const userId = createId("u");
  const nowIso = new Date().toISOString();

  const { error: companyError } = await supabase.from("admin_companies").insert({
    id: companyId,
    name: quote.companyName,
    segment: quote.segment,
    status: "client",
    users_count: 1,
    active_plan: plan,
    mrr_ht: quote.estimatedAmountHt,
    owner_name: quote.contactName,
  });

  if (companyError) throw companyError;

  const { error: userError } = await supabase.from("admin_users").insert({
    id: userId,
    full_name: quote.contactName,
    email: quote.email,
    role: roleFromPlan(plan),
    status: "actif",
    plan,
    tokens_remaining: plan === "pro" ? 200 : 0,
    monthly_quota: plan === "pro" ? 200 : null,
    created_at: nowIso,
    company_name: quote.companyName,
  });

  if (userError) throw userError;

  const { error: subError } = await supabase.from("admin_subscriptions").insert({
    id: createId("sub"),
    user_id: userId,
    plan,
    amount_ht_eur: quote.estimatedAmountHt,
    interval: subMeta.interval,
    status: "active",
    quota_included: subMeta.quotaIncluded,
    renewal_date: subMeta.interval === "month" ? nextRenewalDate() : null,
    created_at: nowIso,
  });

  if (subError) throw subError;

  const { error: quoteError } = await supabase
    .from("admin_quotes")
    .update({ status: "gagné" })
    .eq("id", quoteId);

  if (quoteError) throw quoteError;

  if (plan === "pro") {
    const { error: ledgerError } = await supabase.from("admin_token_ledger").insert({
      id: createId("tok_convert"),
      user_id: userId,
      type: "purchase",
      delta: 200,
      label: `Conversion devis ${quote.companyName}`,
      created_at: nowIso,
    });

    if (ledgerError) throw ledgerError;
  }
}

export async function createAdminQuote(input: {
  companyName: string;
  contactName: string;
  email: string;
  segment: AdminQuote["segment"];
  estimatedAmountHt: number;
  notes: string;
}): Promise<AdminQuote[]> {
  const { error } = await supabase.from("admin_quotes").insert({
    id: createId("quo"),
    company_name: input.companyName,
    contact_name: input.contactName,
    email: input.email,
    segment: input.segment,
    status: "nouveau",
    estimated_amount_ht: input.estimatedAmountHt,
    notes: input.notes,
    created_at: new Date().toISOString(),
  });

  if (error) throw error;
  return getAdminQuotes();
}

export async function updateAdminCompanyStatus(
  companyId: string,
  status: CompanyStatus
): Promise<AdminCompany[]> {
  const { error } = await supabase
    .from("admin_companies")
    .update({ status })
    .eq("id", companyId);

  if (error) throw error;
  return getAdminCompanies();
}

export async function getAdminMetrics(): Promise<{
  activeUsers: number;
  trialUsers: number;
  suspendedUsers: number;
  activeSubscriptions: number;
  mrr: number;
  lowTokenUsers: number;
  wonQuotes: number;
  lostQuotes: number;
  openQuotes: number;
  monthlyTokenConsumption: number;
  estimatedIaCost: number;
}> {
  const [users, subscriptions, quotes, tokenLedger, settings] = await Promise.all([
    getAdminUsers(),
    getAdminSubscriptions(),
    getAdminQuotes(),
    getAdminTokenLedger(),
    getAdminSettings(),
  ]);

  const activeUsers = users.filter((u) => u.status === "actif").length;
  const trialUsers = users.filter((u) => u.status === "essai").length;
  const suspendedUsers = users.filter((u) => u.status === "suspendu").length;

  const activeSubscriptions = subscriptions.filter((s) => s.status === "active");
  const mrr = activeSubscriptions
    .filter((s) => s.interval === "month")
    .reduce((acc, s) => acc + s.amountHtEur, 0);

  const lowTokenUsers = users.filter(
    (u) => (u.monthlyQuota ?? 0) > 0 && u.tokensRemaining <= 10
  ).length;

  const wonQuotes = quotes.filter((q) => q.status === "gagné").length;
  const lostQuotes = quotes.filter((q) => q.status === "perdu").length;
  const openQuotes = quotes.filter((q) =>
    ["nouveau", "qualifié", "devis-envoyé", "négociation"].includes(q.status)
  ).length;

  const monthlyTokenConsumption = Math.abs(
    tokenLedger
      .filter((entry) => entry.type === "consumption")
      .reduce((acc, entry) => acc + entry.delta, 0)
  );

  const estimatedIaCost = monthlyTokenConsumption * settings.iaCostPerAnalysisHt;

  return {
    activeUsers,
    trialUsers,
    suspendedUsers,
    activeSubscriptions: activeSubscriptions.length,
    mrr,
    lowTokenUsers,
    wonQuotes,
    lostQuotes,
    openQuotes,
    monthlyTokenConsumption,
    estimatedIaCost,
  };
}