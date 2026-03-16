import { supabase } from "../../../lib/supabase";

export async function isCurrentUserAdmin(): Promise<boolean> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) return false;

  const { data, error } = await supabase.rpc("is_current_user_admin");

  if (error) {
    console.error("[adminAccess] is_current_user_admin failed:", error);
    return false;
  }

  return data === true;
}

export async function requireAdmin(): Promise<{
  ok: boolean;
  reason?: "not_authenticated" | "not_admin";
}> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { ok: false, reason: "not_authenticated" };
  }

  const isAdmin = await isCurrentUserAdmin();

  if (!isAdmin) {
    return { ok: false, reason: "not_admin" };
  }

  return { ok: true };
}