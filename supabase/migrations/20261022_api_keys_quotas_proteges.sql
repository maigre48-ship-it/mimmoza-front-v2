-- =============================================================================
-- 22/10/2026 — Clés API : quotas protégés + remise à zéro mensuelle
-- =============================================================================
-- Faille corrigée : un utilisateur connecté pouvait, depuis le navigateur,
-- modifier SES clés (RLS « chacun les siennes ») y compris plan, requests_limit
-- et requests_count — donc s'offrir un quota illimité et gratuit :
--   update api_keys set requests_limit = 999999999 where id = '<sa clé>';
--
-- 1. Déclencheur : hors service_role / postgres, à la création la clé prend
--    toujours le plan « starter », son quota et un compteur à 0 ; à la
--    modification, plan / requests_limit / requests_count / user_id / secret_hash
--    restent inchangés (seuls name et revoked_at restent modifiables).
-- 2. Remise à zéro mensuelle des compteurs (le libellé « ce mois » de l'interface
--    était faux : rien ne remettait le compteur à zéro, une clé épuisée l'était
--    pour toujours) + tâche pg_cron le 1er de chaque mois à 00:05 UTC.
-- REJOUABLE : create or replace, déclencheur créé seulement s'il n'existe pas,
-- tâche cron programmée seulement si absente. Aucun DROP, aucun REVOKE ALL.
-- =============================================================================

create or replace function public._api_keys_proteger_quotas()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.plan           := 'starter';
    new.requests_limit := 10000;
    new.requests_count := 0;
    return new;
  end if;

  new.user_id        := old.user_id;
  new.secret_hash    := old.secret_hash;
  new.prefix         := old.prefix;
  new.env            := old.env;
  new.plan           := old.plan;
  new.requests_limit := old.requests_limit;
  new.requests_count := old.requests_count;
  return new;
end;
$$;

comment on function public._api_keys_proteger_quotas() is
  'Empêche un utilisateur de modifier plan, quota ou compteur de ses clés API (seul le serveur le peut).';

do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.api_keys'::regclass
                    and tgname = 'api_keys_proteger_quotas') then
    create trigger api_keys_proteger_quotas
      before insert or update on public.api_keys
      for each row execute function public._api_keys_proteger_quotas();
  end if;
end $$;

-- ── Remise à zéro mensuelle ─────────────────────────────────────────────────
create or replace function public.api_keys_remise_a_zero_mensuelle()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  update public.api_keys
     set requests_count = 0
   where revoked_at is null
     and requests_count <> 0;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.api_keys_remise_a_zero_mensuelle() from public, anon, authenticated;
grant execute on function public.api_keys_remise_a_zero_mensuelle() to service_role;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'api-keys-remise-a-zero-mensuelle') then
    perform cron.schedule('api-keys-remise-a-zero-mensuelle', '5 0 1 * *',
                          $cron$select public.api_keys_remise_a_zero_mensuelle()$cron$);
  end if;
end $$;
