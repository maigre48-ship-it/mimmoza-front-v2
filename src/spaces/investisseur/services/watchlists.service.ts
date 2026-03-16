import { supabase } from "@/lib/supabase";

export type UserWatchlist = {
  id: string;
  user_id: string;
  watchlist_name: string;
  city: string | null;
  zip_code: string | null;
  property_type: string | null;
  is_active: boolean;
};

export type CreateUserWatchlistInput = {
  watchlist_name: string;
  city: string;
  zip_code: string;
  property_type?: string | null;
};

export async function getUserWatchlists(): Promise<UserWatchlist[]> {
  const { data, error } = await supabase
    .from("user_watchlists")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("watchlists error", error);
    return [];
  }

  return data as UserWatchlist[];
}

export async function createUserWatchlist(
  input: CreateUserWatchlistInput
): Promise<{ ok: boolean; error?: string }> {
  const cleanName = input.watchlist_name.trim();
  const cleanCity = input.city.trim();
  const cleanZipCode = input.zip_code.trim();
  const cleanPropertyType = input.property_type?.trim() || null;

  if (!cleanName || !cleanCity || !cleanZipCode) {
    return {
      ok: false,
      error: "Le nom, la ville et le code postal sont obligatoires.",
    };
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    console.error("create watchlist auth error", authError);
    return {
      ok: false,
      error: "Utilisateur non connecté.",
    };
  }

  const { error } = await supabase.from("user_watchlists").insert({
    user_id: user.id,
    watchlist_name: cleanName,
    city: cleanCity,
    zip_code: cleanZipCode,
    property_type: cleanPropertyType,
    is_active: true,
  });

  if (error) {
    console.error("create watchlist error", error);
    return {
      ok: false,
      error: "Impossible de créer la zone surveillée.",
    };
  }

  return { ok: true };
}

export async function toggleWatchlistActive(
  id: string,
  isActive: boolean
): Promise<void> {
  const { error } = await supabase
    .from("user_watchlists")
    .update({ is_active: !isActive })
    .eq("id", id);

  if (error) {
    console.error("toggle watchlist error", error);
  }
}

export async function deleteWatchlist(id: string): Promise<void> {
  const { error } = await supabase
    .from("user_watchlists")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("delete watchlist error", error);
  }
}