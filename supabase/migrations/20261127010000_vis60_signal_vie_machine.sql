-- =============================================================================
-- VIS-60 (27/11/2026) — SIGNAL DE VIE de la machine de rendu (worker MimmozIA Studio).
--
-- NON APPLIQUÉE par l'agent : à faire valider et appliquer par Albé.
-- Ordre conseillé : 1) cette migration ; 2) worker : brancher worker/src/signalVie.ts (voir son en-tête) ;
-- 3) site : BandeauMachineRendu (lit studio_machine_etat()). Sans elle, tout fonctionne comme avant : le site retombe
-- sur l'état DÉDUIT de la file (dernière écriture de studio_jobs) et le dit (« état déduit »).
--
-- Constat (lu le 26/11/2026 sur fwvrqngbafqdaekbdfnm) : aucune table de présence ; le worker n'écrit dans la base QUE
-- pendant un travail (studio_job_avancer, battement de 240 s). Au repos, le site ne peut pas distinguer « machine
-- allumée sans travail » de « machine éteinte depuis 3 jours » (etatMachine() de copilot-chat le dit en clair).
--
-- Contenu :
--   1. table public.studio_machines (une ligne par worker_id ; aucune donnée d'utilisateur ; RLS sans politique :
--      illisible par anon / authenticated, écrite seulement par la fonction ci-dessous) ;
--   2. public.studio_machine_signaler(...) : appelée par le worker (clé service_role) toutes les 60 s, AU REPOS COMME
--      PENDANT UN RENDU ; upsert ; ne touche jamais studio_jobs ni la facturation ;
--   3. public.studio_machine_etat() : état AGRÉGÉ et anonyme (dernier signal de la machine la plus récente, état,
--      diagnostic court) lisible par authenticated — aucun identifiant de travail ni d'utilisateur renvoyé.
-- REJOUABLE (if not exists / create or replace). Aucune ligne existante modifiée.
-- =============================================================================

begin;

create table if not exists public.studio_machines (
  worker_id     text primary key check (length(worker_id) between 1 and 120),
  vu_le         timestamptz not null default now(),
  demarre_le    timestamptz not null default now(),
  etat          text not null default 'pret' check (etat in ('pret', 'occupe', 'arret_demande', 'degrade')),
  version       text check (version is null or length(version) <= 60),
  -- Diagnostic court (booléens et textes bornés, AUCUN secret) : { unreal: bool, disque_assets: bool, raison: text }.
  diagnostic    jsonb not null default '{}'::jsonb check (pg_column_size(diagnostic) <= 4096)
);

alter table public.studio_machines enable row level security;
-- Aucune politique : seules les fonctions SECURITY DEFINER ci-dessous lisent / écrivent.
revoke all on public.studio_machines from anon, authenticated;

create or replace function public.studio_machine_signaler(
  p_worker text, p_etat text, p_version text default null, p_diagnostic jsonb default '{}'::jsonb, p_demarre_le timestamptz default null
) returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_etat text := case when p_etat in ('pret', 'occupe', 'arret_demande', 'degrade') then p_etat else 'pret' end;
  v_diag jsonb := case when jsonb_typeof(p_diagnostic) = 'object' and pg_column_size(p_diagnostic) <= 4096 then p_diagnostic else '{}'::jsonb end;
  v_vu timestamptz := now();
begin
  if p_worker is null or length(p_worker) not between 1 and 120 then
    raise exception 'WORKER_ID_INVALIDE';
  end if;
  insert into public.studio_machines as m (worker_id, vu_le, demarre_le, etat, version, diagnostic)
  values (p_worker, v_vu, coalesce(p_demarre_le, v_vu), v_etat, left(p_version, 60), v_diag)
  on conflict (worker_id) do update
     set vu_le = excluded.vu_le,
         -- un redémarrage du worker (nouvelle date de démarrage) remplace l'ancienne ; sinon on garde la première.
         demarre_le = coalesce(p_demarre_le, m.demarre_le),
         etat = excluded.etat,
         version = excluded.version,
         diagnostic = excluded.diagnostic;
  return v_vu;
end;
$$;

revoke all on function public.studio_machine_signaler(text, text, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.studio_machine_signaler(text, text, text, jsonb, timestamptz) to service_role;

-- État agrégé, anonyme : la machine qui a signalé le plus récemment (une seule machine aujourd'hui).
-- `maintenant` est renvoyé par la base : le site calcule la durée « hors ligne depuis » sur l'horloge du SERVEUR
-- (l'horloge du navigateur du client peut être fausse de plusieurs minutes).
create or replace function public.studio_machine_etat()
returns table (vu_le timestamptz, demarre_le timestamptz, etat text, diagnostic jsonb, maintenant timestamptz, machines integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.vu_le, m.demarre_le, m.etat,
         jsonb_strip_nulls(jsonb_build_object(
           'unreal', m.diagnostic->'unreal',
           'disque_assets', m.diagnostic->'disque_assets',
           'raison', left(m.diagnostic->>'raison', 200))),
         now(), (select count(*)::integer from public.studio_machines)
    from public.studio_machines m
   order by m.vu_le desc
   limit 1;
$$;

revoke all on function public.studio_machine_etat() from public, anon;
grant execute on function public.studio_machine_etat() to authenticated, service_role;

commit;

-- Vérification après application (lecture seule) :
--   select * from public.studio_machine_etat();      -- vide tant que le worker n'a pas été rebranché
--   select worker_id, vu_le, etat from public.studio_machines;
