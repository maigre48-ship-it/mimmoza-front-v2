-- =============================================================================
-- SEC-1 — Restreindre copilot_settle_credits au service_role
-- =============================================================================
--
-- Pourquoi
-- --------
-- public.copilot_settle_credits est SECURITY DEFINER et reçoit l'utilisateur
-- (p_user_id) et le montant final (p_final_amount) en paramètres, sans garde
-- interne. Elle était exécutable par PUBLIC, anon et authenticated : un
-- utilisateur connecté pouvait régler sa propre réservation à 1 jeton (et
-- récupérer la différence).
--
-- Seul appelant légitime : l'Edge Function copilot-chat, via getAdmin()
-- (client créé avec SUPABASE_SECRET_KEYS / SUPABASE_SERVICE_ROLE_KEY).
-- Aucun appel depuis src/** (navigateur) ni depuis une autre fonction SQL.
--
-- Rejouable. Appliquée le 16/10/2026 (apply_migration, inscrite à l'historique).
-- =============================================================================

revoke execute on function public.copilot_settle_credits(uuid, uuid, uuid, jsonb, integer)
  from public, anon, authenticated;

grant execute on function public.copilot_settle_credits(uuid, uuid, uuid, jsonb, integer)
  to service_role;
