-- =============================================================================
-- Audit du 21/10/2026 — P1 n°7 : vues en security_invoker, vues admin fermées
-- =============================================================================
--
-- Le problème
-- -----------
-- Les ~130 vues de 20260831_baseline_vues.sql sont créées SANS
-- `security_invoker` : elles s'exécutent avec les droits de leur propriétaire
-- (postgres) et TRAVERSENT la RLS des tables de base. Le lot 6 du 04/08/2026
-- les a fermées à `anon` mais les a accordées à `authenticated` : tout compte
-- connecté peut donc lire, via ces vues, les lignes des AUTRES utilisateurs
-- (veilles, alertes, sourcing, solde de jetons copilote, facturation…).
--
-- Ce que fait cette migration (rejouable)
-- ---------------------------------------
-- 1. Vues d'ADMINISTRATION (agrégats sur tous les comptes) :
--      admin_top_clients, admin_user_billing_summary, copilot_credits_balance
--    → SELECT retiré à public / anon / authenticated, laissé à service_role.
--    → admin_top_clients reste lisible par l'interface d'administration via
--      la fonction admin_top_clients_list() (garde is_current_user_admin()).
--
-- 2. Toutes les autres vues du schéma public (hors vues système PostGIS et
--    vues matérialisées, pour lesquelles l'option n'existe pas) :
--      alter view … set (security_invoker = on)
--    MAIS seulement si c'est SANS RISQUE DE CASSE, vérifié pour chaque vue :
--    chaque table/vue dont elle dépend doit
--      · être lisible par `authenticated` (GRANT SELECT), et
--      · ne pas avoir de RLS, ou avoir au moins une politique SELECT/ALL
--        applicable à `authenticated` (ou à public).
--    Sinon, la vue passerait en invoker et renverrait 0 ligne aux
--    utilisateurs (référentiels DVF / PLU avec RLS sans politique, par
--    exemple) : elle est alors LAISSÉE EN L'ÉTAT et signalée (NOTICE
--    « À TRAITER »). Ces vues-là nécessitent une politique SELECT sur leurs
--    tables de base, à décider au cas par cas.
--
-- Lancer le fichier dans l'éditeur SQL affiche, ligne par ligne, le
-- traitement appliqué à chaque vue (onglet « Messages » / NOTICE).
-- =============================================================================


-- ── 1. Vues d'administration ────────────────────────────────────────────────
do $$
declare
  v text;
begin
  foreach v in array array['admin_top_clients', 'admin_user_billing_summary', 'copilot_credits_balance']
  loop
    if to_regclass('public.' || v) is null then
      raise notice 'admin : % absente, rien à faire', v;
      continue;
    end if;
    execute format('revoke all on public.%I from public, anon, authenticated', v);
    execute format('grant select on public.%I to service_role', v);
    raise notice 'admin : % → lecture réservée à service_role', v;
  end loop;
end
$$;

-- Accès de l'interface d'administration à admin_top_clients (src/lib/billing/adminAnalytics.ts).
do $$
begin
  if to_regclass('public.admin_top_clients') is null then
    raise notice 'admin_top_clients_list non créée : vue absente';
    return;
  end if;

  execute $f$
    create or replace function public.admin_top_clients_list(p_limit integer default 10)
    returns setof public.admin_top_clients
    language plpgsql
    stable
    security definer
    set search_path to 'public'
    as $body$
    begin
      if not coalesce(public.is_current_user_admin(), false) then
        raise exception 'FORBIDDEN_ADMIN_ONLY';
      end if;
      return query
        select * from public.admin_top_clients
        order by total_paid_cents desc nulls last
        limit least(greatest(coalesce(p_limit, 10), 1), 500);
    end;
    $body$
  $f$;

  execute 'revoke execute on function public.admin_top_clients_list(integer) from public, anon';
  execute 'grant execute on function public.admin_top_clients_list(integer) to authenticated, service_role';
end
$$;


-- ── 2. security_invoker sur les vues destinées aux utilisateurs ─────────────
do $$
declare
  vue record;
  dep record;
  sure boolean;
  raison text;
  nb_ok int := 0;
  nb_skip int := 0;
  exclues text[] := array[
    'geography_columns', 'geometry_columns',                                   -- PostGIS (système)
    'admin_top_clients', 'admin_user_billing_summary', 'copilot_credits_balance' -- traitées en 1.
  ];
begin
  for vue in
    select c.oid, c.relname,
           coalesce((select option_value from pg_options_to_table(c.reloptions)
                     where option_name = 'security_invoker'), 'off') as invoker
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'v'
      and not (c.relname = any (exclues))
    order by c.relname
  loop
    if vue.invoker in ('on', 'true') then
      raise notice 'OK (déjà invoker) : %', vue.relname;
      continue;
    end if;

    sure := true;
    raison := null;

    -- Relations dont dépend la vue (tables, vues, vues matérialisées).
    for dep in
      select distinct d.refobjid as oid, rc.relname, rc.relkind, rc.relrowsecurity, rn.nspname
      from pg_rewrite r
      join pg_depend d on d.classid = 'pg_rewrite'::regclass and d.objid = r.oid
                       and d.refclassid = 'pg_class'::regclass
      join pg_class rc on rc.oid = d.refobjid
      join pg_namespace rn on rn.oid = rc.relnamespace
      where r.ev_class = vue.oid
        and d.refobjid <> vue.oid
        and rc.relkind in ('r', 'p', 'v', 'm', 'f')
    loop
      if not has_table_privilege('authenticated', dep.oid, 'SELECT') then
        sure := false;
        raison := format('%I.%I non lisible par authenticated', dep.nspname, dep.relname);
        exit;
      end if;
      if dep.relkind in ('r', 'p') and dep.relrowsecurity and not exists (
        select 1 from pg_policies p
        where p.schemaname = dep.nspname and p.tablename = dep.relname
          and p.cmd in ('SELECT', 'ALL')
          and (p.roles && array['authenticated', 'public']::name[])
      ) then
        sure := false;
        raison := format('%I.%I a la RLS sans politique SELECT pour authenticated', dep.nspname, dep.relname);
        exit;
      end if;
    end loop;

    if sure then
      execute format('alter view public.%I set (security_invoker = on)', vue.relname);
      nb_ok := nb_ok + 1;
      raise notice 'INVOKER : %', vue.relname;
    else
      nb_skip := nb_skip + 1;
      raise notice 'À TRAITER (laissée en definer) : % — %', vue.relname, raison;
    end if;
  end loop;

  raise notice 'Bilan : % vue(s) passée(s) en security_invoker, % laissée(s) en l''état (à traiter).', nb_ok, nb_skip;
end
$$;


-- =============================================================================
-- VÉRIFICATION (après application)
-- =============================================================================
-- Vues encore en mode « propriétaire » et lisibles par authenticated :
--
-- select c.relname,
--        coalesce((select option_value from pg_options_to_table(c.reloptions)
--                  where option_name = 'security_invoker'), 'off') as security_invoker,
--        has_table_privilege('anon', c.oid, 'SELECT')          as anon,
--        has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated
-- from pg_class c join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public' and c.relkind in ('v', 'm')
-- order by 2, 1;
--
-- Pages à retester (lecture de vues côté navigateur) :
--   /veille/marche, /promoteur/veille (v_market_active_listings),
--   /apporteur (v_apporteur_deals_pool), veille investisseur
--   (veille_user_summary), MimmozIA « apprentissage » (v_user_profile),
--   taux macro (macro_rates_latest), admin (admin_top_clients_list).
-- =============================================================================
