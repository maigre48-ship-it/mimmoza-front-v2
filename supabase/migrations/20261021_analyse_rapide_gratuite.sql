-- =============================================================================
-- Audit du 21/10/2026 — P0 n°3 : analyse rapide, produit d'appel gratuit
-- =============================================================================
--
-- Avant : l'analyse rapide exigeait une session ET débitait 10 jetons depuis
-- le navigateur (spend_credits, montant choisi par le client). Un compte neuf
-- (0 jeton) ne pouvait donc rien essayer, et un échec du moteur après le débit
-- n'était jamais remboursé.
--
-- Après :
--   · tout compte dispose de 3 analyses rapides GRATUITES par mois civil
--     (consume_free_quick_analysis) ;
--   · au-delà, débit de 10 jetons, MONTANT FIXÉ PAR LE SERVEUR
--     (debit_quick_analysis) — le client ne choisit plus le prix ;
--   · chaque consommation crée un « ticket » ; si l'analyse échoue, le front
--     appelle refund_quick_analysis(ticket) qui rend l'analyse gratuite ou les
--     jetons. Remboursement possible une seule fois, dans les 15 minutes, et au
--     plus 10 fois par 24 h et par compte (anti-abus) ;
--   · confirm_quick_analysis(ticket) clôt le ticket après un succès (plus de
--     remboursement possible).
--
-- Rejouable : create table if not exists, create or replace, drop policy if exists.
-- =============================================================================


-- ── Tables ──────────────────────────────────────────────────────────────────

-- Compteur mensuel des analyses gratuites consommées.
create table if not exists public.free_quick_analysis_usage (
  user_id    uuid not null references auth.users(id) on delete cascade,
  mois       date not null,                  -- premier jour du mois (UTC)
  nb         integer not null default 0 check (nb >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, mois)
);

comment on table public.free_quick_analysis_usage is
  'Analyses rapides gratuites consommées par compte et par mois (quota : 3). Écrite uniquement par les RPC security definer.';

-- Tickets de consommation (gratuit ou jetons), pour le remboursement en cas d'échec.
create table if not exists public.quick_analysis_tickets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  source      text not null check (source in ('gratuit', 'jetons', 'admin')),
  montant     integer not null default 0 check (montant >= 0),  -- jetons débités
  statut      text not null default 'en_cours' check (statut in ('en_cours', 'termine', 'rembourse')),
  libelle     text,
  created_at  timestamptz not null default now(),
  closed_at   timestamptz
);

create index if not exists quick_analysis_tickets_user_idx
  on public.quick_analysis_tickets (user_id, created_at desc);

comment on table public.quick_analysis_tickets is
  'Une ligne par analyse rapide lancée. Permet de rembourser une analyse échouée (refund_quick_analysis).';

-- RLS : lecture de ses propres lignes, aucune écriture directe.
alter table public.free_quick_analysis_usage enable row level security;
alter table public.quick_analysis_tickets   enable row level security;

drop policy if exists "lecture de son quota d'analyses gratuites" on public.free_quick_analysis_usage;
create policy "lecture de son quota d'analyses gratuites"
  on public.free_quick_analysis_usage for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "lecture de ses tickets d'analyse rapide" on public.quick_analysis_tickets;
create policy "lecture de ses tickets d'analyse rapide"
  on public.quick_analysis_tickets for select
  to authenticated
  using (user_id = auth.uid());

revoke all on public.free_quick_analysis_usage from anon;
revoke all on public.quick_analysis_tickets   from anon;
revoke insert, update, delete on public.free_quick_analysis_usage from authenticated;
revoke insert, update, delete on public.quick_analysis_tickets   from authenticated;
grant select on public.free_quick_analysis_usage to authenticated;
grant select on public.quick_analysis_tickets   to authenticated;


-- ── 1. Quota gratuit ────────────────────────────────────────────────────────
-- Retour : {"accorde": bool, "restantes": int, "quota": 3, "ticket": uuid|null}
create or replace function public.consume_free_quick_analysis()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user   uuid := auth.uid();
  v_quota  constant integer := 3;   -- = ANALYSES_RAPIDES_GRATUITES_MOIS (src/lib/billing/grille.ts)
  v_mois   date := date_trunc('month', now() at time zone 'utc')::date;
  v_nb     integer;
  v_ticket uuid;
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  insert into free_quick_analysis_usage (user_id, mois, nb)
  values (v_user, v_mois, 0)
  on conflict (user_id, mois) do nothing;

  select nb into v_nb
  from free_quick_analysis_usage
  where user_id = v_user and mois = v_mois
  for update;

  if v_nb >= v_quota then
    return jsonb_build_object('accorde', false, 'restantes', 0, 'quota', v_quota, 'ticket', null);
  end if;

  update free_quick_analysis_usage
  set nb = nb + 1, updated_at = now()
  where user_id = v_user and mois = v_mois;

  insert into quick_analysis_tickets (user_id, source, montant, libelle)
  values (v_user, 'gratuit', 0, 'Analyse rapide gratuite')
  returning id into v_ticket;

  return jsonb_build_object(
    'accorde', true,
    'restantes', v_quota - (v_nb + 1),
    'quota', v_quota,
    'ticket', v_ticket
  );
end;
$function$;


-- ── 2. Débit en jetons (montant fixé par le serveur) ────────────────────────
-- Retour : {"ticket": uuid, "nouveau_solde": int, "montant": int}
create or replace function public.debit_quick_analysis(p_libelle text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user    uuid := auth.uid();
  v_montant constant integer := 10;   -- = ACTION_COSTS.analyse_rapide (src/lib/billing/actionCosts.ts)
  v_balance integer;
  v_ticket  uuid;
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select current_credits into v_balance
  from credit_accounts
  where user_id = v_user
  for update;

  if v_balance is null then
    raise exception 'NO_ACCOUNT';
  end if;

  -- Administrateur actif : rien n'est prélevé (même règle que spend_credits).
  if exists (select 1 from admin_users where user_id = v_user and is_active = true) then
    insert into quick_analysis_tickets (user_id, source, montant, libelle)
    values (v_user, 'admin', 0, left(coalesce(p_libelle, 'Analyse rapide'), 300))
    returning id into v_ticket;
    return jsonb_build_object('ticket', v_ticket, 'nouveau_solde', v_balance, 'montant', 0);
  end if;

  if v_balance < v_montant then
    raise exception 'NO_TOKENS';
  end if;

  update credit_accounts
  set current_credits = current_credits - v_montant
  where user_id = v_user;

  insert into credit_transactions (user_id, type, amount, description)
  values (v_user, 'quick_analysis', -v_montant, left(coalesce(p_libelle, 'Analyse rapide'), 300));

  insert into quick_analysis_tickets (user_id, source, montant, libelle)
  values (v_user, 'jetons', v_montant, left(coalesce(p_libelle, 'Analyse rapide'), 300))
  returning id into v_ticket;

  return jsonb_build_object('ticket', v_ticket, 'nouveau_solde', v_balance - v_montant, 'montant', v_montant);
end;
$function$;


-- ── 3. Remboursement d'une analyse échouée ──────────────────────────────────
-- Retour : {"rembourse": bool, "raison": text|null}
create or replace function public.refund_quick_analysis(p_ticket uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  t      quick_analysis_tickets%rowtype;
  v_nb_24h integer;
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select * into t
  from quick_analysis_tickets
  where id = p_ticket and user_id = v_user
  for update;

  if not found then
    return jsonb_build_object('rembourse', false, 'raison', 'TICKET_INCONNU');
  end if;
  if t.statut <> 'en_cours' then
    return jsonb_build_object('rembourse', false, 'raison', 'DEJA_CLOS');
  end if;
  if t.created_at < now() - interval '15 minutes' then
    return jsonb_build_object('rembourse', false, 'raison', 'DELAI_DEPASSE');
  end if;

  select count(*) into v_nb_24h
  from quick_analysis_tickets
  where user_id = v_user and statut = 'rembourse' and closed_at > now() - interval '24 hours';
  if v_nb_24h >= 10 then
    return jsonb_build_object('rembourse', false, 'raison', 'TROP_DE_REMBOURSEMENTS');
  end if;

  if t.source = 'gratuit' then
    update free_quick_analysis_usage
    set nb = greatest(nb - 1, 0), updated_at = now()
    where user_id = v_user
      and mois = date_trunc('month', t.created_at at time zone 'utc')::date;
  elsif t.source = 'jetons' and t.montant > 0 then
    update credit_accounts
    set current_credits = current_credits + t.montant
    where user_id = v_user;

    insert into credit_transactions (user_id, type, amount, description)
    values (v_user, 'quick_analysis_refund', t.montant, 'Remboursement : analyse rapide échouée');
  end if;

  update quick_analysis_tickets
  set statut = 'rembourse', closed_at = now()
  where id = t.id;

  return jsonb_build_object('rembourse', true, 'raison', null);
end;
$function$;


-- ── 4. Clôture après succès ─────────────────────────────────────────────────
create or replace function public.confirm_quick_analysis(p_ticket uuid)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  update quick_analysis_tickets
  set statut = 'termine', closed_at = now()
  where id = p_ticket and user_id = auth.uid() and statut = 'en_cours';
$function$;


-- ── Droits : jamais anon ────────────────────────────────────────────────────
revoke execute on function public.consume_free_quick_analysis()       from public, anon;
revoke execute on function public.debit_quick_analysis(text)          from public, anon;
revoke execute on function public.refund_quick_analysis(uuid)         from public, anon;
revoke execute on function public.confirm_quick_analysis(uuid)        from public, anon;
grant  execute on function public.consume_free_quick_analysis()       to authenticated, service_role;
grant  execute on function public.debit_quick_analysis(text)          to authenticated, service_role;
grant  execute on function public.refund_quick_analysis(uuid)         to authenticated, service_role;
grant  execute on function public.confirm_quick_analysis(uuid)        to authenticated, service_role;


-- =============================================================================
-- VÉRIFICATION (après application)
-- =============================================================================
-- select * from public.free_quick_analysis_usage order by updated_at desc limit 20;
-- select source, statut, count(*) from public.quick_analysis_tickets group by 1, 2;
-- select p.proname,
--        has_function_privilege('anon', p.oid, 'execute') as anon,
--        has_function_privilege('authenticated', p.oid, 'execute') as authenticated
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname like '%quick_analysis%';
-- =============================================================================
