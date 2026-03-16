import { supabase } from "./supabase";

export type AdminCheckResult = {
  isAdmin: boolean;
  userId: string | null;
  email: string | null;
  hasFullAccess: boolean;
  bypassSubscription: boolean;
  bypassTokens: boolean;
  bypassLimits: boolean;
};

export async function getCurrentAdminStatus(): Promise<AdminCheckResult> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return {
      isAdmin: false,
      userId: null,
      email: null,
      hasFullAccess: false,
      bypassSubscription: false,
      bypassTokens: false,
      bypassLimits: false,
    };
  }

  const { data, error } = await supabase
    .from("admin_users")
    .select("user_id, email, is_active")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  const isAdmin = Boolean(!error && data);

  return {
    isAdmin,
    userId: user.id,
    email: user.email ?? null,
    hasFullAccess: isAdmin,
    bypassSubscription: isAdmin,
    bypassTokens: isAdmin,
    bypassLimits: isAdmin,
  };
}

export async function isCurrentUserAdmin(): Promise<boolean> {
  const status = await getCurrentAdminStatus();
  return status.isAdmin;
}