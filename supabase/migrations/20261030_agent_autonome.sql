-- =============================================================================
-- 30/10/2026 — MimmozIA « agent immobilier autonome » : base de données
-- =============================================================================
-- Contrat : CONTRAT_AGENT_AUTONOME.md, section 1 (fait foi).
--
-- Contenu
--   1. user_ai_preferences : réglages de la veille proactive (+ protection du
--      compteur de consommation, que l'utilisateur ne peut pas remettre à zéro).
--   2. Tables : agent_missions, agent_mission_journal, agent_memoire_projet,
--      agent_actions_externes, agent_briefings (RLS partout, lecture par le
--      propriétaire uniquement ; aucune écriture directe par le navigateur sauf
--      l'édition / suppression de SA mémoire).
--   3. Déclencheurs : plafond de 3 missions actives, états finaux non
--      ressuscitables, actions externes créées UNIQUEMENT en brouillon et
--      validées UNIQUEMENT par leur propriétaire, « envoye » seulement depuis
--      « valide », texte figé une fois validé.
--   4. Fonctions du moteur (service_role) : prendre (5 max, tourniquet,
--      attente > 72 h à clore), reserver (revérifie la veille proactive),
--      debiter (idempotent par étape, état sauvé dans la même transaction, table
--      agent_mission_debits), journaliser, cloturer, regler, memoire_ecrire,
--      proactif_etat.
--   5. Fonctions de l'utilisateur (authenticated, auth.uid()) : valider_devis,
--      repondre, annuler, preferences_proactif, action_valider, action_refuser,
--      briefing_marquer_lu.
--   6. Temps réel + tâches planifiées (pg_cron + pg_net + clé dans Vault).
--
-- Facturation — vérification de copilot_settle_credits (prod, lue le 30/10/2026)
--   v_final := greatest(coalesce(p_final_amount, v_reserved), 1);
--   v_delta := v_reserved - v_final;   → crédite v_delta au solde.
--   · final < réservé : rembourse bien réservé − final. CORRECT.
--   · final > réservé : v_delta négatif → débite le COMPLÉMENT sans vérifier le
--     solde (le solde peut devenir négatif). Pour une mission c'est interdit
--     (« jamais facturé au-delà de la réserve »).
--   · final = 0 : facture quand même 1 jeton (plancher greatest(…, 1)).
--   Correction retenue SANS toucher la fonction partagée avec le chat :
--   agent_mission_regler(p_id) règle la mission de façon atomique avec
--   final = least(jetons_consommes, jetons_reserves) (jamais au-delà de la
--   réserve, garanti aussi par agent_mission_debiter et par une contrainte), et
--   appelle copilot_refund_credits quand final = 0 (aucun jeton facturé).
--   Le moteur DOIT régler par agent_mission_regler, pas par settleCredits.
--
-- Réservation longue durée — vérifié le 30/10/2026 : aucun nettoyage n'expire
--   copilot_reservations (aucune tâche cron, aucune fonction SQL, et le chat ne
--   rembourse que SA propre réservation dans son catch). Une mission de
--   plusieurs heures garde donc sa réserve. Ses réservations portent la raison
--   « mission:<id> » : tout nettoyage futur des réservations orphelines DOIT
--   exclure  reason like 'mission:%'  (c'est agent_mission_regler qui les solde).
--
-- Clé service_role des tâches planifiées : lue dans Vault sous le nom
--   « agent_service_role_key » (Vault est vide aujourd'hui ; les crons existants
--   envoient la clé anon en clair, ce qui ne suffit pas pour la route interne
--   mission_tick réservée au service_role). Tant que le secret n'existe pas, la
--   tâche tourne mais n'envoie AUCUN appel (la requête ne renvoie aucune ligne).
--
-- REJOUABLE : create … if not exists, create or replace, déclencheurs,
-- politiques et contraintes créés seulement s'ils n'existent pas,
-- cron.schedule remplace une tâche de même nom. Aucun DELETE. Un seul DROP :
-- « drop function if exists » de l'ancienne surcharge à 3 paramètres de
-- agent_mission_debiter (jamais appliquée en prod ; évite l'ambiguïté).
--
-- Ordre : la migration 20261031_agent_courriers_bucket.sql (bucket privé des
-- courriers PDF, agent PROACTIF) est indépendante et s'applique après celle-ci.
-- =============================================================================


-- ── 0. « L'appel vient-il du serveur ? » ────────────────────────────────────
-- Test écrit EN LIGNE dans chaque déclencheur :
--     current_user in ('service_role', 'postgres', 'supabase_admin')
-- service_role = Edge Functions ; postgres / supabase_admin = propriétaire des
-- fonctions security definer (les RPC font alors leurs propres contrôles).
-- Volontairement PAS de fonction utilitaire : un déclencheur security invoker
-- l'appellerait avec les droits de l'utilisateur (« permission denied »).


-- ── 1. user_ai_preferences : veille proactive ───────────────────────────────
alter table public.user_ai_preferences add column if not exists proactif_actif boolean not null default false;
alter table public.user_ai_preferences add column if not exists budget_proactif_mensuel integer not null default 0;
alter table public.user_ai_preferences add column if not exists proactif_consomme_mois integer not null default 0;
alter table public.user_ai_preferences add column if not exists proactif_mois date;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.user_ai_preferences'::regclass
                    and conname = 'user_ai_preferences_budget_proactif_borne') then
    alter table public.user_ai_preferences
      add constraint user_ai_preferences_budget_proactif_borne
      check (budget_proactif_mensuel between 0 and 20000);
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.user_ai_preferences'::regclass
                    and conname = 'user_ai_preferences_proactif_consomme_positif') then
    alter table public.user_ai_preferences
      add constraint user_ai_preferences_proactif_consomme_positif
      check (proactif_consomme_mois >= 0);
  end if;
end $$;

-- La politique uap_update_own laisse l'utilisateur modifier sa ligne : sans ce
-- déclencheur il pourrait remettre son compteur de consommation à zéro.
create or replace function public._agent_preferences_proteger()
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
    new.proactif_consomme_mois := 0;
    new.proactif_mois := null;
  else
    new.proactif_consomme_mois := old.proactif_consomme_mois;
    new.proactif_mois := old.proactif_mois;
  end if;
  return new;
end;
$$;
revoke execute on function public._agent_preferences_proteger() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.user_ai_preferences'::regclass
                    and tgname = 'user_ai_preferences_agent_proteger') then
    create trigger user_ai_preferences_agent_proteger
      before insert or update on public.user_ai_preferences
      for each row execute function public._agent_preferences_proteger();
  end if;
end $$;

-- Sans ceci, DELETE puis INSERT de sa ligne remettrait le compteur à zéro
-- (l'INSERT le force à 0). On refuse donc la suppression par l'utilisateur
-- tant que le compteur du mois en cours n'est pas nul. purge_my_ai_memory()
-- n'est pas concernée (elle ne vide que user_events). La suppression du compte
-- (cascade depuis auth.users) passe : elle s'exécute avec les droits du
-- propriétaire de la table.
create or replace function public._agent_preferences_suppression()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin')
     and old.proactif_consomme_mois > 0
     and old.proactif_mois = date_trunc('month', now())::date then
    raise exception 'Réglages non supprimables ce mois-ci : la veille proactive a déjà consommé des jetons. Désactivez-la plutôt.'
      using errcode = '42501', hint = 'agent_preferences_suppression';
  end if;
  return old;
end;
$$;
revoke execute on function public._agent_preferences_suppression() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.user_ai_preferences'::regclass
                    and tgname = 'user_ai_preferences_agent_suppression') then
    create trigger user_ai_preferences_agent_suppression
      before delete on public.user_ai_preferences
      for each row execute function public._agent_preferences_suppression();
  end if;
end $$;


-- ── 2. Tables ───────────────────────────────────────────────────────────────
create table if not exists public.agent_missions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users (id) on delete cascade,
  projet_id             uuid references public.projects (id) on delete set null,
  conversation_id       uuid,
  origine               text not null default 'chat' check (origine in ('chat', 'proactif')),
  type                  text not null check (type in ('prospection_fonciere', 'faisabilite', 'etude_marche', 'veille', 'libre')),
  objectif              text not null check (char_length(objectif) between 1 and 2000),
  criteres              jsonb not null default '{}'::jsonb check (jsonb_typeof(criteres) = 'object'),
  statut                text not null default 'devis'
                        check (statut in ('devis', 'en_attente', 'en_cours', 'attente_utilisateur',
                                          'terminee', 'budget_atteint', 'echec', 'annulee')),
  devis                 jsonb check (devis is null or jsonb_typeof(devis) = 'object'),
  reservation_id        uuid,
  jetons_reserves       integer not null default 0 check (jetons_reserves >= 0),
  jetons_consommes      integer not null default 0 check (jetons_consommes >= 0),
  -- Ajout au contrat : dépassement absorbé par Mimmoza (jamais facturé).
  jetons_perte_absorbee integer not null default 0 check (jetons_perte_absorbee >= 0),
  etapes_faites         integer not null default 0 check (etapes_faites >= 0),
  etapes_max            integer not null default 40 check (etapes_max between 1 and 40),
  etat                  jsonb not null default '{}'::jsonb
                        check (jsonb_typeof(etat) = 'object' and octet_length(etat::text) < 524288),
  question_en_attente   text check (question_en_attente is null or char_length(question_en_attente) <= 4000),
  -- Ajout au contrat : début de l'attente d'une réponse (clôture auto après 72 h).
  attente_depuis        timestamptz,
  rapport               jsonb check (rapport is null or jsonb_typeof(rapport) = 'object'),
  erreur                text check (erreur is null or char_length(erreur) <= 2000),
  bail_jusqu_a          timestamptz,
  -- Ajouts au contrat : poste qui tient le bail, date du règlement des crédits.
  worker                text,
  regle_le              timestamptz,
  cree_le               timestamptz not null default now(),
  maj_le                timestamptz not null default now(),
  demarre_le            timestamptz,
  termine_le            timestamptz,
  constraint agent_missions_conso_sous_reserve
    check (jetons_consommes <= jetons_reserves or statut = 'devis')
);

comment on table public.agent_missions is
  'Missions longues de l''agent MimmozIA (contrat CONTRAT_AGENT_AUTONOME.md §1). Écriture : moteur (service_role) et RPC uniquement.';

create index if not exists agent_missions_user_cree_idx on public.agent_missions (user_id, cree_le desc);
create index if not exists agent_missions_a_traiter_idx on public.agent_missions (maj_le)
  where statut in ('en_attente', 'en_cours', 'attente_utilisateur') or (reservation_id is not null and regle_le is null);
create index if not exists agent_missions_projet_idx on public.agent_missions (projet_id) where projet_id is not null;

create table if not exists public.agent_mission_journal (
  id          bigserial primary key,
  mission_id  uuid not null references public.agent_missions (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  n           integer not null,
  genre       text not null check (genre in ('plan', 'pensee', 'outil', 'resultat', 'question', 'reponse',
                                             'memoire', 'action', 'erreur', 'fin')),
  outil       text check (outil is null or char_length(outil) <= 100),
  entree      jsonb check (entree is null or octet_length(entree::text) <= 65536),
  resume      text check (resume is null or char_length(resume) <= 1000),
  jetons      integer not null default 0 check (jetons >= 0),
  cree_le     timestamptz not null default now(),
  constraint agent_mission_journal_n_unique unique (mission_id, n)
);
create index if not exists agent_mission_journal_user_idx on public.agent_mission_journal (user_id, cree_le desc);

-- Débits par étape : (mission_id, n) unique → un débit rejoué (moteur coupé
-- après le commit, étape relancée) n'est jamais compté deux fois.
create table if not exists public.agent_mission_debits (
  mission_id  uuid not null references public.agent_missions (id) on delete cascade,
  n           integer not null check (n >= 0),
  jetons      integer not null check (jetons >= 0),
  cree_le     timestamptz not null default now(),
  primary key (mission_id, n)
);

create table if not exists public.agent_memoire_projet (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  projet_id   uuid references public.projects (id) on delete cascade,
  mission_id  uuid references public.agent_missions (id) on delete set null,
  genre       text not null check (genre in ('fait', 'hypothese', 'decision', 'preference', 'document', 'contact')),
  cle         text check (cle is null or cle ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
  contenu     text not null check (char_length(contenu) between 1 and 4000),
  source      text check (source is null or char_length(source) <= 100),
  confiance   text not null default 'estime' check (confiance in ('confirme', 'estime', 'a_verifier')),
  epingle     boolean not null default false,
  cree_le     timestamptz not null default now(),
  maj_le      timestamptz not null default now()
);
-- Unicité (user_id, projet_id, cle) quand cle est renseignée ; projet absent = mémoire générale.
create unique index if not exists agent_memoire_projet_cle_unique
  on public.agent_memoire_projet (user_id, coalesce(projet_id, '00000000-0000-0000-0000-000000000000'::uuid), cle)
  where cle is not null;
create index if not exists agent_memoire_projet_lecture_idx
  on public.agent_memoire_projet (user_id, projet_id, epingle desc, maj_le desc);

create table if not exists public.agent_actions_externes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  mission_id   uuid references public.agent_missions (id) on delete set null,
  projet_id    uuid references public.projects (id) on delete set null,
  canal        text not null check (canal in ('email', 'courrier')),
  destinataire jsonb not null check (
                 jsonb_typeof(destinataire) = 'object'
                 and coalesce(destinataire->>'qualite', 'autre') in ('proprietaire', 'mairie', 'notaire', 'agence', 'autre')),
  objet        text not null check (char_length(objet) between 1 and 300),
  corps        text not null check (char_length(corps) between 1 and 20000),
  pieces       jsonb not null default '[]'::jsonb check (jsonb_typeof(pieces) = 'array'),
  statut       text not null default 'brouillon' check (statut in ('brouillon', 'valide', 'envoye', 'refuse', 'echec')),
  valide_le    timestamptz,
  envoye_le    timestamptz,
  erreur       text check (erreur is null or char_length(erreur) <= 2000),
  cree_le      timestamptz not null default now()
);
create index if not exists agent_actions_externes_user_idx on public.agent_actions_externes (user_id, statut, cree_le desc);
create index if not exists agent_actions_externes_mission_idx on public.agent_actions_externes (mission_id) where mission_id is not null;

create table if not exists public.agent_briefings (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  cree_le     timestamptz not null default now(),
  titre       text not null check (char_length(titre) between 1 and 300),
  resume      text check (resume is null or char_length(resume) <= 4000),
  elements    jsonb not null default '[]'::jsonb check (jsonb_typeof(elements) = 'array'),
  lu          boolean not null default false,
  mission_id  uuid references public.agent_missions (id) on delete set null,
  -- Un seul briefing par mission (plusieurs NULL permis : briefings sans mission).
  constraint agent_briefings_mission_unique unique (mission_id)
);
create index if not exists agent_briefings_user_idx on public.agent_briefings (user_id, lu, cree_le desc);

alter table public.agent_missions          enable row level security;
alter table public.agent_mission_journal   enable row level security;
alter table public.agent_mission_debits    enable row level security;   -- aucune politique : serveur seul
alter table public.agent_memoire_projet    enable row level security;
alter table public.agent_actions_externes  enable row level security;
alter table public.agent_briefings         enable row level security;


-- ── 3. Déclencheurs ─────────────────────────────────────────────────────────
-- 3a. Missions : champs serveur à la création, états finaux définitifs, maj_le.
create or replace function public._agent_missions_proteger()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.statut not in ('devis', 'en_attente') then
      raise exception 'Une mission se crée en devis (ou en attente pour la veille proactive).'
        using errcode = '22023';
    end if;
    new.reservation_id        := null;
    new.jetons_reserves       := 0;
    new.jetons_consommes      := 0;
    new.jetons_perte_absorbee := 0;
    new.etapes_faites         := 0;
    new.bail_jusqu_a          := null;
    new.worker                := null;
    new.regle_le              := null;
    new.rapport               := null;
    new.erreur                := null;
    new.attente_depuis        := null;
    new.cree_le               := now();
    new.maj_le                := now();
    new.demarre_le            := null;
    new.termine_le            := null;
    return new;
  end if;

  new.maj_le  := now();
  new.id      := old.id;
  new.user_id := old.user_id;
  new.cree_le := old.cree_le;
  if old.statut in ('terminee', 'budget_atteint', 'echec', 'annulee') and new.statut <> old.statut then
    raise exception 'Mission déjà close (%) : son statut ne change plus.', old.statut
      using errcode = '22023', hint = 'agent_mission_close';
  end if;
  -- Une réservation posée ne se remplace pas ; un règlement ne s'annule pas.
  if old.reservation_id is not null and new.reservation_id is distinct from old.reservation_id then
    raise exception 'La réservation d''une mission ne se remplace pas.' using errcode = '22023';
  end if;
  if new.statut = 'attente_utilisateur' then
    -- entrée dans l'attente : horodatée ; ensuite conservée (le serveur peut la corriger).
    new.attente_depuis := case when old.statut = 'attente_utilisateur'
                               then coalesce(new.attente_depuis, old.attente_depuis) else now() end;
  else
    new.attente_depuis := null;
  end if;
  if old.regle_le is not null then
    new.regle_le         := old.regle_le;
    new.jetons_consommes := old.jetons_consommes;
    new.jetons_reserves  := old.jetons_reserves;
  end if;
  return new;
end;
$$;
revoke execute on function public._agent_missions_proteger() from public, anon, authenticated;

-- 3b. Plafond : 3 missions actives par utilisateur.
create or replace function public._agent_missions_plafond()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actives integer;
begin
  if new.statut not in ('en_attente', 'en_cours', 'attente_utilisateur') then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.statut in ('en_attente', 'en_cours', 'attente_utilisateur') then
    return new;   -- déjà comptée
  end if;
  -- Verrou par utilisateur : deux validations simultanées ne passent pas le plafond.
  perform pg_advisory_xact_lock(hashtextextended('agent_missions:' || new.user_id::text, 0));
  select count(*) into v_actives
    from public.agent_missions
   where user_id = new.user_id
     and statut in ('en_attente', 'en_cours', 'attente_utilisateur')
     and id <> new.id;
  if v_actives >= 3 then
    raise exception 'Vous avez déjà 3 missions en cours. Attendez qu''une se termine ou annulez-en une.'
      using errcode = 'P0001', hint = 'agent_missions_plafond';
  end if;
  return new;
end;
$$;
revoke execute on function public._agent_missions_plafond() from public, anon, authenticated;

-- 3c. Mémoire : maj_le, champs d'identité figés ; une modification par
--     l'utilisateur marque la source « utilisateur ».
create or replace function public._agent_memoire_proteger()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.cree_le := now();
    new.maj_le  := now();
    return new;
  end if;
  new.maj_le  := now();
  new.id      := old.id;
  new.user_id := old.user_id;
  new.cree_le := old.cree_le;
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    new.projet_id  := old.projet_id;
    new.mission_id := old.mission_id;
    new.cle        := old.cle;
    new.genre      := old.genre;
    if new.contenu is distinct from old.contenu then
      new.source := 'utilisateur';
    else
      new.source := old.source;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public._agent_memoire_proteger() from public, anon, authenticated;

-- 3d. Actions externes : la règle d'or « rien ne part sans l'utilisateur ».
--   · création (quel que soit l'appelant, moteur compris) : statut FORCÉ à
--     brouillon, dates et erreur remises à zéro ;
--   · brouillon|echec → valide, brouillon|echec|valide → refuse : seulement si
--     auth.uid() = propriétaire (RPC agent_action_valider / agent_action_refuser) ;
--   · valide → envoye|echec : serveur (agent-action-envoyer-v1) ; envoye est
--     définitif (idempotence : une action envoyée ne repart jamais) ;
--   · le texte (canal, destinataire, objet, corps, pièces) est figé dès que
--     l'action est validée, envoyée ou refusée : ce qui part est ce qui a été validé.
create or replace function public._agent_actions_proteger()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_proprietaire boolean;
begin
  if tg_op = 'INSERT' then
    if new.mission_id is not null and not exists (
         select 1 from public.agent_missions m where m.id = new.mission_id and m.user_id = new.user_id) then
      raise exception 'Mission et utilisateur ne correspondent pas.' using errcode = '22023';
    end if;
    new.statut    := 'brouillon';
    new.valide_le := null;
    new.envoye_le := null;
    new.erreur    := null;
    new.cree_le   := now();
    return new;
  end if;

  new.id         := old.id;
  new.user_id    := old.user_id;
  new.mission_id := old.mission_id;
  new.cree_le    := old.cree_le;

  if old.statut in ('valide', 'envoye', 'refuse')
     and (new.canal, new.destinataire, new.objet, new.corps, new.pieces)
         is distinct from (old.canal, old.destinataire, old.objet, old.corps, old.pieces) then
    raise exception 'Une action validée, envoyée ou refusée ne se modifie plus.'
      using errcode = '22023', hint = 'agent_action_figee';
  end if;

  if new.statut = old.statut then
    new.valide_le := old.valide_le;
    new.envoye_le := old.envoye_le;
    return new;
  end if;

  -- Propriétaire connecté, passant par une RPC utilisateur (jamais la clé service_role).
  v_proprietaire := auth.uid() is not null and auth.uid() = old.user_id and current_user <> 'service_role';

  if old.statut in ('brouillon', 'echec') and new.statut = 'valide' and v_proprietaire then
    new.valide_le := now();
    new.envoye_le := null;
    new.erreur    := null;
  elsif old.statut in ('brouillon', 'echec', 'valide') and new.statut = 'refuse' and v_proprietaire then
    new.valide_le := old.valide_le;
    new.envoye_le := null;
  elsif old.statut = 'valide' and new.statut = 'envoye' and current_user in ('service_role', 'postgres', 'supabase_admin') then
    new.valide_le := old.valide_le;
    new.envoye_le := now();
    new.erreur    := null;
  elsif old.statut = 'valide' and new.statut = 'echec' and current_user in ('service_role', 'postgres', 'supabase_admin') then
    new.valide_le := old.valide_le;
    new.envoye_le := null;
  else
    raise exception 'Passage de « % » à « % » interdit.', old.statut, new.statut
      using errcode = '42501', hint = 'agent_action_transition';
  end if;
  return new;
end;
$$;
revoke execute on function public._agent_actions_proteger() from public, anon, authenticated;

-- 3e. Veille coupée (proactif_actif → false) ou apprentissage coupé
--     (learning_enabled → false, y compris par l'upsert de setLearningEnabled) :
--     les missions proactives non closes sont annulées ; le moteur règle
--     (rembourse) au tick suivant.
create or replace function public._agent_preferences_annuler_proactif()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if (old.proactif_actif and not new.proactif_actif)
     or (old.learning_enabled and not new.learning_enabled) then
    for v_id in
      update public.agent_missions
         set statut = 'annulee', question_en_attente = null, termine_le = now()
       where user_id = new.user_id and origine = 'proactif'
         and statut in ('devis', 'en_attente', 'en_cours', 'attente_utilisateur')
      returning id
    loop
      perform public.agent_mission_journaliser(v_id, 'fin', null, null,
                'Veille proactive désactivée : mission annulée, le non-consommé sera remboursé.', 0);
    end loop;
  end if;
  return new;
end;
$$;
revoke execute on function public._agent_preferences_annuler_proactif() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.user_ai_preferences'::regclass
                    and tgname = 'user_ai_preferences_agent_annuler_proactif') then
    create trigger user_ai_preferences_agent_annuler_proactif
      after update of proactif_actif, learning_enabled on public.user_ai_preferences
      for each row execute function public._agent_preferences_annuler_proactif();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.agent_missions'::regclass
                    and tgname = 'agent_missions_a_proteger') then
    create trigger agent_missions_a_proteger
      before insert or update on public.agent_missions
      for each row execute function public._agent_missions_proteger();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.agent_missions'::regclass
                    and tgname = 'agent_missions_b_plafond') then
    create trigger agent_missions_b_plafond
      before insert or update of statut on public.agent_missions
      for each row execute function public._agent_missions_plafond();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.agent_memoire_projet'::regclass
                    and tgname = 'agent_memoire_projet_a_proteger') then
    create trigger agent_memoire_projet_a_proteger
      before insert or update on public.agent_memoire_projet
      for each row execute function public._agent_memoire_proteger();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.agent_actions_externes'::regclass
                    and tgname = 'agent_actions_externes_a_proteger') then
    create trigger agent_actions_externes_a_proteger
      before insert or update on public.agent_actions_externes
      for each row execute function public._agent_actions_proteger();
  end if;
end $$;


-- ── Politiques RLS et droits ────────────────────────────────────────────────
-- Les privilèges par défaut de Supabase donnent TOUT à anon et authenticated
-- sur les nouvelles tables : on les retire, puis on accorde le strict nécessaire.
revoke all on table public.agent_missions, public.agent_mission_journal, public.agent_memoire_projet,
                    public.agent_actions_externes, public.agent_briefings, public.agent_mission_debits
  from public, anon, authenticated;
revoke all on sequence public.agent_mission_journal_id_seq from public, anon, authenticated;

grant select on public.agent_missions, public.agent_mission_journal, public.agent_actions_externes,
                public.agent_briefings, public.agent_memoire_projet to authenticated;
grant update (contenu, epingle, confiance) on public.agent_memoire_projet to authenticated;
grant delete on public.agent_memoire_projet to authenticated;

grant all on public.agent_missions, public.agent_mission_journal, public.agent_memoire_projet,
             public.agent_actions_externes, public.agent_briefings, public.agent_mission_debits to service_role;
grant usage, select on sequence public.agent_mission_journal_id_seq to service_role;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'agent_missions'
                    and policyname = 'agent_missions_select_proprietaire') then
    create policy agent_missions_select_proprietaire on public.agent_missions
      for select to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'agent_mission_journal'
                    and policyname = 'agent_mission_journal_select_proprietaire') then
    create policy agent_mission_journal_select_proprietaire on public.agent_mission_journal
      for select to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'agent_memoire_projet'
                    and policyname = 'agent_memoire_projet_select_proprietaire') then
    create policy agent_memoire_projet_select_proprietaire on public.agent_memoire_projet
      for select to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'agent_memoire_projet'
                    and policyname = 'agent_memoire_projet_update_proprietaire') then
    create policy agent_memoire_projet_update_proprietaire on public.agent_memoire_projet
      for update to authenticated
      using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'agent_memoire_projet'
                    and policyname = 'agent_memoire_projet_delete_proprietaire') then
    create policy agent_memoire_projet_delete_proprietaire on public.agent_memoire_projet
      for delete to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'agent_actions_externes'
                    and policyname = 'agent_actions_externes_select_proprietaire') then
    create policy agent_actions_externes_select_proprietaire on public.agent_actions_externes
      for select to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'agent_briefings'
                    and policyname = 'agent_briefings_select_proprietaire') then
    create policy agent_briefings_select_proprietaire on public.agent_briefings
      for select to authenticated using (user_id = (select auth.uid()));
  end if;
end $$;


-- ── 4. Fonctions du moteur (service_role) ───────────────────────────────────
-- Journal : numérotation n atomique (verrou sur la mission).
create or replace function public.agent_mission_journaliser(
  p_id     uuid,
  p_genre  text,
  p_outil  text default null,
  p_entree jsonb default null,
  p_resume text default null,
  p_jetons integer default 0
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
  v_n    integer;
  v_id   bigint;
begin
  select user_id into v_user from public.agent_missions where id = p_id for update;
  if v_user is null then
    raise exception 'MISSION_INTROUVABLE' using errcode = 'P0002';
  end if;
  select coalesce(max(n), 0) + 1 into v_n from public.agent_mission_journal where mission_id = p_id;
  insert into public.agent_mission_journal (mission_id, user_id, n, genre, outil, entree, resume, jetons)
  values (p_id, v_user, v_n, p_genre, left(p_outil, 100), p_entree, left(p_resume, 1000),
          greatest(coalesce(p_jetons, 0), 0))
  returning id into v_id;
  return v_id;
end;
$$;

-- Prend jusqu'à 5 missions à traiter dont le bail est libre ou expiré :
--   · à clore/régler d'abord : missions closes pas encore réglées (annulées par
--     l'utilisateur, ou moteur coupé entre clôture et règlement) → le moteur
--     appelle agent_mission_regler ; et missions en attente_utilisateur depuis
--     plus de 72 h → le moteur les clôt en « terminee » avec un rapport partiel
--     « sans réponse », puis règle ;
--   · puis en_attente (à réserver) et en_cours (à faire avancer), MÉLANGÉES,
--     par maj_le le plus ancien : chaque prise pose un bail donc touche maj_le,
--     la mission passe en fin de file → tourniquet, pas de famine.
-- Les autres missions attente_utilisateur dorment (agent_mission_repondre les réveille).
-- Le moteur décide quoi faire d'après le statut de chaque ligne renvoyée.
create or replace function public.agent_mission_prendre(p_worker text, p_lease_s integer default 120)
returns setof public.agent_missions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with c as (
    select m.id
      from public.agent_missions m
     where (m.statut in ('en_attente', 'en_cours')
            or (m.statut = 'attente_utilisateur' and m.attente_depuis < now() - interval '72 hours')
            or (m.statut in ('terminee', 'budget_atteint', 'echec', 'annulee')
                and m.reservation_id is not null and m.regle_le is null))
       and (m.bail_jusqu_a is null or m.bail_jusqu_a < now())
     order by case when m.statut in ('en_attente', 'en_cours') then 1 else 0 end,
              m.maj_le
     limit 5
     for update skip locked
  )
  update public.agent_missions m
     set bail_jusqu_a = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_s, 120), 900))),
         worker = left(p_worker, 100)
    from c
   where m.id = c.id
  returning m.*;
end;
$$;

-- Prolonge le bail d'une mission tenue par ce worker (false si perdu).
create or replace function public.agent_mission_prolonger_bail(p_id uuid, p_worker text, p_lease_s integer default 120)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.agent_missions
     set bail_jusqu_a = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_s, 120), 900)))
   where id = p_id and worker = left(p_worker, 100) and bail_jusqu_a is not null;
  return found;
end;
$$;

-- Réserve devis.jetons_max (via copilot_reserve_credits, raison « mission:<id> »)
-- et passe en_attente → en_cours DANS LA MÊME TRANSACTION : aucune réservation
-- orpheline possible si la fonction Edge est coupée. Solde insuffisant →
-- statut echec « solde insuffisant », rien n'est débité.
create or replace function public.agent_mission_reserver(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m        public.agent_missions;
  v_max    integer;
  v_res    uuid;
  v_solde  integer;
  v_etat   jsonb;
  v_engage integer;
  v_raison text;
begin
  select * into m from public.agent_missions where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'raison', 'introuvable');
  end if;
  if m.statut <> 'en_attente' or m.reservation_id is not null then
    return jsonb_build_object('ok', false, 'raison', 'statut', 'statut', m.statut,
                              'reservation_id', m.reservation_id, 'jetons_reserves', m.jetons_reserves);
  end if;

  v_max := case when jsonb_typeof(m.devis->'jetons_max') = 'number'
                then floor((m.devis->>'jetons_max')::numeric)::integer end;
  if v_max is null or v_max <= 0 then
    update public.agent_missions
       set statut = 'echec', erreur = 'devis invalide', termine_le = now(), bail_jusqu_a = null
     where id = p_id;
    perform public.agent_mission_journaliser(p_id, 'erreur', 'facturation', null,
              'Mission arrêtée : le devis est invalide. Aucun jeton n''a été débité.', 0);
    return jsonb_build_object('ok', false, 'raison', 'devis_invalide');
  end if;

  -- Mission proactive : la veille doit être toujours active, l'apprentissage
  -- autorisé, et le budget du mois couvrir le maximum du devis (consommé du mois
  -- + réserves des autres missions proactives non réglées déduits).
  if m.origine = 'proactif' then
    v_etat := public.agent_proactif_etat(m.user_id);
    select coalesce(sum(o.jetons_reserves), 0) into v_engage
      from public.agent_missions o
     where o.user_id = m.user_id and o.origine = 'proactif' and o.id <> p_id
       and o.reservation_id is not null and o.regle_le is null;
    if not coalesce((v_etat->>'actif')::boolean, false) or not coalesce((v_etat->>'learning_enabled')::boolean, false) then
      v_raison := 'proactif_desactive';
    elsif coalesce((v_etat->>'restant')::integer, 0) - v_engage < v_max then
      v_raison := 'budget_proactif_epuise';
    end if;
    if v_raison is not null then
      update public.agent_missions
         set statut = 'annulee', erreur = v_raison, termine_le = now(), bail_jusqu_a = null
       where id = p_id;
      perform public.agent_mission_journaliser(p_id, 'fin', 'facturation', null,
                case v_raison when 'proactif_desactive'
                  then 'Veille proactive désactivée : mission annulée, aucun jeton réservé.'
                  else 'Budget mensuel de veille insuffisant : mission annulée, aucun jeton réservé.' end, 0);
      return jsonb_build_object('ok', false, 'raison', v_raison);
    end if;
  end if;

  begin
    select r.reservation_id, r.remaining_balance into v_res, v_solde
      from public.copilot_reserve_credits(m.user_id, v_max, 'mission:' || p_id::text, m.conversation_id) r;
  exception when others then
    if sqlerrm = 'INSUFFICIENT_CREDITS' then
      update public.agent_missions
         set statut = 'echec', erreur = 'solde insuffisant', termine_le = now(), bail_jusqu_a = null
       where id = p_id;
      perform public.agent_mission_journaliser(p_id, 'erreur', 'facturation', null,
                'Mission non lancée : solde de jetons insuffisant. Aucun jeton n''a été débité.', 0);
      return jsonb_build_object('ok', false, 'raison', 'solde_insuffisant');
    end if;
    raise;
  end;

  update public.agent_missions
     set statut = 'en_cours', reservation_id = v_res, jetons_reserves = v_max,
         demarre_le = coalesce(demarre_le, now())
   where id = p_id;
  return jsonb_build_object('ok', true, 'reservation_id', v_res, 'jetons_reserves', v_max,
                            'solde_restant', v_solde);
end;
$$;

-- Débit au fil de l'eau, IDEMPOTENT par étape, état sauvé dans la même
-- transaction.
--   · (p_id, p_n) déjà débité → rien n'est redébité ni réécrit ; renvoie
--     deja_debite = true avec les mêmes champs (reste, peut_continuer…).
--   · p_etat non null → etat = p_etat dans la même transaction ; s'il n'est pas
--     un objet JSON ou dépasse 512 Ko → {ok:false, raison:'etat_trop_gros'} et
--     RIEN n'est débité.
--   · débit plafonné à la réserve : l'excédent est absorbé par Mimmoza
--     (journalisé, jamais facturé).
--   · peut_continuer = mission toujours en cours ET reste >= pire cas de l'étape
--     suivante ET etapes_faites < etapes_max.
-- L'ancienne surcharge à 3 paramètres est supprimée (ambiguïté).
drop function if exists public.agent_mission_debiter(uuid, integer, integer);

create or replace function public.agent_mission_debiter(
  p_id                uuid,
  p_n                 integer,
  p_jetons            integer,
  p_pire_cas_suivant  integer,
  p_etat              jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m        public.agent_missions;
  v_deja   boolean;
  v_conso  integer;
  v_perte  integer := 0;
  v_reste  integer;
  v_peut   boolean;
begin
  if p_n is null or p_n < 0 then
    raise exception 'p_n doit être >= 0' using errcode = '22023';
  end if;
  if p_jetons is null or p_jetons < 0 then
    raise exception 'p_jetons doit être >= 0' using errcode = '22023';
  end if;
  if p_pire_cas_suivant is null or p_pire_cas_suivant < 0 then
    raise exception 'p_pire_cas_suivant doit être >= 0' using errcode = '22023';
  end if;

  select * into m from public.agent_missions where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'raison', 'introuvable', 'reste', 0, 'peut_continuer', false);
  end if;

  v_deja := exists (select 1 from public.agent_mission_debits where mission_id = p_id and n = p_n);

  if not v_deja then
    if m.reservation_id is null or m.regle_le is not null then
      return jsonb_build_object('ok', false, 'raison', 'non_reservee_ou_reglee', 'statut', m.statut,
                                'reste', 0, 'peut_continuer', false);
    end if;
    if p_etat is not null and (jsonb_typeof(p_etat) <> 'object' or octet_length(p_etat::text) >= 524288) then
      return jsonb_build_object('ok', false, 'raison', 'etat_trop_gros',
                                'reste', m.jetons_reserves - m.jetons_consommes, 'peut_continuer', false,
                                'jetons_consommes', m.jetons_consommes, 'jetons_reserves', m.jetons_reserves,
                                'etapes_faites', m.etapes_faites, 'etapes_max', m.etapes_max, 'statut', m.statut);
    end if;

    v_conso := least(m.jetons_consommes::bigint + p_jetons, m.jetons_reserves)::integer;
    v_perte := greatest(m.jetons_consommes::bigint + p_jetons - m.jetons_reserves, 0)::integer;

    insert into public.agent_mission_debits (mission_id, n, jetons) values (p_id, p_n, p_jetons);

    update public.agent_missions
       set jetons_consommes      = v_conso,
           jetons_perte_absorbee = jetons_perte_absorbee + v_perte,
           etapes_faites         = etapes_faites + 1,
           etat                  = coalesce(p_etat, etat)
     where id = p_id
    returning * into m;

    if v_perte > 0 then
      perform public.agent_mission_journaliser(p_id, 'erreur', 'facturation',
                jsonb_build_object('perte_absorbee', v_perte, 'n', p_n),
                format('Dépassement de %s jetons au-delà de la réserve : absorbé par Mimmoza, non facturé.', v_perte), 0);
    end if;
  end if;

  v_reste := m.jetons_reserves - m.jetons_consommes;
  v_peut  := m.statut = 'en_cours' and m.regle_le is null
             and v_reste >= p_pire_cas_suivant and m.etapes_faites < m.etapes_max;
  return jsonb_build_object('ok', true, 'deja_debite', v_deja, 'reste', v_reste, 'peut_continuer', v_peut,
                            'jetons_consommes', m.jetons_consommes, 'jetons_reserves', m.jetons_reserves,
                            'etapes_faites', m.etapes_faites, 'etapes_max', m.etapes_max,
                            'perte_absorbee', v_perte, 'statut', m.statut);
end;
$$;

-- Clôture : fixe le statut final (si la mission a été annulée entre-temps, le
-- statut « annulee » est conservé mais le rapport partiel est enregistré).
-- NE RÈGLE PAS les crédits : appeler ensuite agent_mission_regler(p_id).
create or replace function public.agent_mission_cloturer(p_id uuid, p_statut text, p_rapport jsonb, p_erreur text)
returns public.agent_missions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.agent_missions;
begin
  if p_statut is null or p_statut not in ('terminee', 'budget_atteint', 'echec', 'annulee') then
    raise exception 'Statut final invalide : %', p_statut using errcode = '22023';
  end if;
  if p_rapport is not null and jsonb_typeof(p_rapport) <> 'object' then
    raise exception 'Le rapport doit être un objet JSON.' using errcode = '22023';
  end if;

  select * into m from public.agent_missions where id = p_id for update;
  if not found then
    raise exception 'MISSION_INTROUVABLE' using errcode = 'P0002';
  end if;

  update public.agent_missions
     set statut = case when m.statut in ('terminee', 'budget_atteint', 'echec', 'annulee') then m.statut else p_statut end,
         rapport = coalesce(p_rapport, rapport),
         erreur = coalesce(left(p_erreur, 2000), erreur),
         question_en_attente = null,
         termine_le = coalesce(termine_le, now()),
         bail_jusqu_a = null
   where id = p_id
  returning * into m;

  perform public.agent_mission_journaliser(p_id, 'fin', null, null,
            case m.statut
              when 'terminee'       then 'Mission terminée.'
              when 'budget_atteint' then 'Budget de la mission atteint : rapport partiel.'
              when 'echec'          then 'Mission arrêtée sur une erreur.'
              else                       'Mission annulée.'
            end, 0);
  return m;
end;
$$;

-- Règlement atomique d'une mission close (correction de la facturation, voir
-- l'en-tête) : facture least(consommé, réservé), rembourse le reste, jamais de
-- plancher à 1 jeton, jamais de complément au-delà de la réserve. Idempotent.
-- Pour une mission proactive, ajoute le montant facturé au compteur mensuel.
create or replace function public.agent_mission_regler(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m           public.agent_missions;
  v_reserve   integer;
  v_final     integer;
  v_mois      date := date_trunc('month', now())::date;
begin
  select * into m from public.agent_missions where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'raison', 'introuvable');
  end if;
  if m.regle_le is not null or m.reservation_id is null then
    return jsonb_build_object('ok', true, 'deja_regle', true, 'jetons_factures', m.jetons_consommes);
  end if;
  if m.statut not in ('terminee', 'budget_atteint', 'echec', 'annulee') then
    return jsonb_build_object('ok', false, 'raison', 'mission_active', 'statut', m.statut);
  end if;

  select amount into v_reserve
    from public.copilot_reservations
   where id = m.reservation_id and user_id = m.user_id and status = 'reserved'
   for update;

  v_final := least(m.jetons_consommes, m.jetons_reserves, coalesce(v_reserve, m.jetons_reserves));

  if v_reserve is not null then
    if v_final <= 0 then
      perform public.copilot_refund_credits(m.user_id, m.reservation_id,
                'Remboursement mission agent (aucun jeton consommé)');
    else
      perform public.copilot_settle_credits(m.user_id, m.reservation_id, null,
                jsonb_build_object('mission_id', p_id, 'origine', m.origine), v_final);
    end if;
  end if;

  update public.agent_missions set regle_le = now() where id = p_id;

  if m.origine = 'proactif' and v_final > 0 then
    update public.user_ai_preferences
       set proactif_consomme_mois = case when proactif_mois = v_mois then proactif_consomme_mois else 0 end + v_final,
           proactif_mois = v_mois
     where user_id = m.user_id;
  end if;

  return jsonb_build_object('ok', true, 'deja_regle', v_reserve is null,
                            'jetons_factures', v_final,
                            'jetons_rembourses', coalesce(v_reserve, 0) - case when v_reserve is null then 0 else v_final end);
end;
$$;

-- Mémoire : écriture par le moteur (upsert sur (user, projet, cle) quand cle est fournie).
create or replace function public.agent_memoire_ecrire(
  p_user_id    uuid,
  p_projet_id  uuid,
  p_mission_id uuid,
  p_genre      text,
  p_cle        text,
  p_contenu    text,
  p_source     text,
  p_confiance  text default 'estime',
  p_epingle    boolean default false
)
returns public.agent_memoire_projet
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ligne public.agent_memoire_projet;
  v_cle   text := nullif(trim(p_cle), '');
begin
  if v_cle is not null then
    select * into v_ligne from public.agent_memoire_projet
     where user_id = p_user_id
       and coalesce(projet_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = coalesce(p_projet_id, '00000000-0000-0000-0000-000000000000'::uuid)
       and cle = v_cle
     for update;
    if found then
      update public.agent_memoire_projet
         set genre = p_genre, contenu = p_contenu, source = left(p_source, 100),
             confiance = coalesce(p_confiance, 'estime'),
             epingle = epingle or coalesce(p_epingle, false),
             mission_id = coalesce(p_mission_id, mission_id)
       where id = v_ligne.id
      returning * into v_ligne;
      return v_ligne;
    end if;
  end if;
  insert into public.agent_memoire_projet (user_id, projet_id, mission_id, genre, cle, contenu, source, confiance, epingle)
  values (p_user_id, p_projet_id, p_mission_id, p_genre, v_cle, p_contenu, left(p_source, 100),
          coalesce(p_confiance, 'estime'), coalesce(p_epingle, false))
  returning * into v_ligne;
  return v_ligne;
end;
$$;

-- Veille proactive : état et budget restant du mois (remise à zéro au changement de mois).
create or replace function public.agent_proactif_etat(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p      public.user_ai_preferences;
  v_mois date := date_trunc('month', now())::date;
begin
  update public.user_ai_preferences
     set proactif_consomme_mois = 0, proactif_mois = v_mois
   where user_id = p_user_id and proactif_mois is distinct from v_mois;
  select * into p from public.user_ai_preferences where user_id = p_user_id;
  if not found then
    return jsonb_build_object('actif', false, 'learning_enabled', true, 'budget_mensuel', 0,
                              'consomme_mois', 0, 'restant', 0);
  end if;
  return jsonb_build_object('actif', p.proactif_actif, 'learning_enabled', p.learning_enabled,
                            'budget_mensuel', p.budget_proactif_mensuel,
                            'consomme_mois', p.proactif_consomme_mois,
                            'restant', greatest(p.budget_proactif_mensuel - p.proactif_consomme_mois, 0));
end;
$$;

revoke execute on function public.agent_mission_journaliser(uuid, text, text, jsonb, text, integer) from public, anon, authenticated;
revoke execute on function public.agent_mission_prendre(text, integer) from public, anon, authenticated;
revoke execute on function public.agent_mission_prolonger_bail(uuid, text, integer) from public, anon, authenticated;
revoke execute on function public.agent_mission_reserver(uuid) from public, anon, authenticated;
revoke execute on function public.agent_mission_debiter(uuid, integer, integer, integer, jsonb) from public, anon, authenticated;
revoke execute on function public.agent_mission_cloturer(uuid, text, jsonb, text) from public, anon, authenticated;
revoke execute on function public.agent_mission_regler(uuid) from public, anon, authenticated;
revoke execute on function public.agent_memoire_ecrire(uuid, uuid, uuid, text, text, text, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.agent_proactif_etat(uuid) from public, anon, authenticated;
grant execute on function public.agent_mission_journaliser(uuid, text, text, jsonb, text, integer) to service_role;
grant execute on function public.agent_mission_prendre(text, integer) to service_role;
grant execute on function public.agent_mission_prolonger_bail(uuid, text, integer) to service_role;
grant execute on function public.agent_mission_reserver(uuid) to service_role;
grant execute on function public.agent_mission_debiter(uuid, integer, integer, integer, jsonb) to service_role;
grant execute on function public.agent_mission_cloturer(uuid, text, jsonb, text) to service_role;
grant execute on function public.agent_mission_regler(uuid) to service_role;
grant execute on function public.agent_memoire_ecrire(uuid, uuid, uuid, text, text, text, text, text, boolean) to service_role;
grant execute on function public.agent_proactif_etat(uuid) to service_role;


-- ── 5. Fonctions de l'utilisateur (authenticated) ───────────────────────────
-- Lance la mission : devis → en_attente (le moteur réserve au tick suivant).
-- Refuse tout de suite si le solde ne couvre pas le maximum du devis.
create or replace function public.agent_mission_valider_devis(p_id uuid)
returns public.agent_missions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  m       public.agent_missions;
  v_max   integer;
  v_solde integer;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  select * into m from public.agent_missions where id = p_id and user_id = v_uid for update;
  if not found then
    raise exception 'MISSION_INTROUVABLE' using errcode = 'P0002';
  end if;
  if m.statut <> 'devis' then
    raise exception 'Cette mission a déjà été lancée ou close.' using errcode = '22023', hint = 'agent_mission_statut';
  end if;
  v_max := case when jsonb_typeof(m.devis->'jetons_max') = 'number'
                then floor((m.devis->>'jetons_max')::numeric)::integer end;
  if v_max is null or v_max <= 0 then
    raise exception 'Le devis de cette mission est incomplet.' using errcode = '22023', hint = 'agent_devis_invalide';
  end if;
  if (m.devis->>'expire_le') is not null and now() > (m.devis->>'expire_le')::timestamptz then
    raise exception 'Devis expiré : demandez-en un nouveau.' using errcode = '22023', hint = 'agent_devis_expire';
  end if;
  select current_credits into v_solde from public.credit_accounts where user_id = v_uid;
  if coalesce(v_solde, 0) < v_max then
    raise exception 'Solde insuffisant : il faut % jetons disponibles pour lancer cette mission.', v_max
      using errcode = 'P0001', hint = 'agent_solde_insuffisant';
  end if;
  update public.agent_missions set statut = 'en_attente' where id = p_id returning * into m;
  return m;
end;
$$;

-- Réponse à la question posée par l'agent : attente_utilisateur → en_cours.
create or replace function public.agent_mission_repondre(p_id uuid, p_reponse text)
returns public.agent_missions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  m     public.agent_missions;
  v_rep text := trim(coalesce(p_reponse, ''));
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if v_rep = '' or char_length(v_rep) > 4000 then
    raise exception 'La réponse doit faire entre 1 et 4 000 caractères.' using errcode = '22023';
  end if;
  select * into m from public.agent_missions where id = p_id and user_id = v_uid for update;
  if not found then
    raise exception 'MISSION_INTROUVABLE' using errcode = 'P0002';
  end if;
  if m.statut <> 'attente_utilisateur' then
    raise exception 'Cette mission n''attend pas de réponse.' using errcode = '22023', hint = 'agent_mission_statut';
  end if;
  perform public.agent_mission_journaliser(p_id, 'reponse', null,
            jsonb_build_object('question', m.question_en_attente, 'reponse', v_rep), left(v_rep, 1000), 0);
  update public.agent_missions
     set statut = 'en_cours',
         question_en_attente = null,
         etat = etat || jsonb_build_object('derniere_reponse',
                  jsonb_build_object('question', m.question_en_attente, 'reponse', v_rep, 'le', now())),
         bail_jusqu_a = null
   where id = p_id
  returning * into m;
  return m;
end;
$$;

-- Annulation : le moteur règle (rembourse le non-consommé) au tick suivant.
-- Le bail en cours est conservé : le règlement attend la fin de l'étape en vol.
create or replace function public.agent_mission_annuler(p_id uuid)
returns public.agent_missions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  m     public.agent_missions;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  select * into m from public.agent_missions where id = p_id and user_id = v_uid for update;
  if not found then
    raise exception 'MISSION_INTROUVABLE' using errcode = 'P0002';
  end if;
  if m.statut not in ('devis', 'en_attente', 'en_cours', 'attente_utilisateur') then
    return m;   -- déjà close : rien à faire (idempotent)
  end if;
  update public.agent_missions
     set statut = 'annulee', question_en_attente = null, termine_le = now()
   where id = p_id
  returning * into m;
  perform public.agent_mission_journaliser(p_id, 'fin', null, null, 'Mission annulée à votre demande.', 0);
  return m;
end;
$$;

-- Réglages de la veille proactive (budget borné 0..20 000 jetons/mois).
create or replace function public.agent_preferences_proactif(p_actif boolean, p_budget integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if p_budget is null or p_budget < 0 or p_budget > 20000 then
    raise exception 'Le budget mensuel doit être compris entre 0 et 20 000 jetons.' using errcode = '22023';
  end if;
  insert into public.user_ai_preferences (user_id, proactif_actif, budget_proactif_mensuel)
  values (v_uid, coalesce(p_actif, false), p_budget)
  on conflict (user_id) do update
     set proactif_actif = excluded.proactif_actif,
         budget_proactif_mensuel = excluded.budget_proactif_mensuel,
         updated_at = now();
  return public.agent_proactif_etat(v_uid);
end;
$$;

-- Validation d'une action externe par son propriétaire (texte modifiable).
create or replace function public.agent_action_valider(p_id uuid, p_objet text default null, p_corps text default null)
returns public.agent_actions_externes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  a     public.agent_actions_externes;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  select * into a from public.agent_actions_externes where id = p_id and user_id = v_uid for update;
  if not found then
    raise exception 'ACTION_INTROUVABLE' using errcode = 'P0002';
  end if;
  if a.statut = 'valide' and p_objet is null and p_corps is null then
    return a;   -- double clic : idempotent
  end if;
  if a.statut not in ('brouillon', 'echec') then
    raise exception 'Cette action est déjà %.', a.statut using errcode = '22023', hint = 'agent_action_statut';
  end if;
  update public.agent_actions_externes
     set objet  = coalesce(nullif(trim(p_objet), ''), objet),
         corps  = coalesce(nullif(trim(p_corps), ''), corps),
         statut = 'valide'
   where id = p_id
  returning * into a;
  return a;
end;
$$;

create or replace function public.agent_action_refuser(p_id uuid)
returns public.agent_actions_externes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  a     public.agent_actions_externes;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  select * into a from public.agent_actions_externes where id = p_id and user_id = v_uid for update;
  if not found then
    raise exception 'ACTION_INTROUVABLE' using errcode = 'P0002';
  end if;
  if a.statut = 'refuse' then
    return a;
  end if;
  if a.statut not in ('brouillon', 'echec', 'valide') then
    raise exception 'Cette action est déjà %.', a.statut using errcode = '22023', hint = 'agent_action_statut';
  end if;
  update public.agent_actions_externes set statut = 'refuse' where id = p_id returning * into a;
  return a;
end;
$$;

create or replace function public.agent_briefing_marquer_lu(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  update public.agent_briefings set lu = true where id = p_id and user_id = auth.uid();
  return found;
end;
$$;

revoke execute on function public.agent_mission_valider_devis(uuid) from public, anon;
revoke execute on function public.agent_mission_repondre(uuid, text) from public, anon;
revoke execute on function public.agent_mission_annuler(uuid) from public, anon;
revoke execute on function public.agent_preferences_proactif(boolean, integer) from public, anon;
revoke execute on function public.agent_action_valider(uuid, text, text) from public, anon;
revoke execute on function public.agent_action_refuser(uuid) from public, anon;
revoke execute on function public.agent_briefing_marquer_lu(uuid) from public, anon;
grant execute on function public.agent_mission_valider_devis(uuid) to authenticated, service_role;
grant execute on function public.agent_mission_repondre(uuid, text) to authenticated, service_role;
grant execute on function public.agent_mission_annuler(uuid) to authenticated, service_role;
grant execute on function public.agent_preferences_proactif(boolean, integer) to authenticated, service_role;
grant execute on function public.agent_action_valider(uuid, text, text) to authenticated, service_role;
grant execute on function public.agent_action_refuser(uuid) to authenticated, service_role;
grant execute on function public.agent_briefing_marquer_lu(uuid) to authenticated, service_role;


-- ── 6a. Temps réel (si la publication existe) ───────────────────────────────
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['agent_missions', 'agent_mission_journal', 'agent_actions_externes', 'agent_briefings'] loop
      if not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;


-- ── 6b. Tâches planifiées ───────────────────────────────────────────────────
-- Même motif que les crons existants (net.http_post, url, headers
-- jsonb_build_object Content-Type + Authorization, body, timeout_milliseconds),
-- mais la clé est la clé service_role lue dans Vault (« agent_service_role_key »).
-- Sans ce secret, la requête ne renvoie aucune ligne : aucun appel n'est fait.
-- Horaires pg_cron en UTC. Veille à 08:13 UTC (9 h 13 / 10 h 13 à Paris), APRÈS
-- opportunity-watch-daily (06:00) et ao-watch-daily (07:17) dont elle relit
-- les détections. Nom de tâche conservé : « agent-proactif-nuit ».
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron')
     and exists (select 1 from pg_namespace where nspname = 'net')
     and exists (select 1 from pg_namespace where nspname = 'vault') then
    perform cron.schedule('agent-missions-tick', '* * * * *', $cmd$
  select net.http_post(
    url     := 'https://fwvrqngbafqdaekbdfnm.supabase.co/functions/v1/copilot-chat',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || s.decrypted_secret
    ),
    body := '{"interne":"mission_tick"}'::jsonb,
    timeout_milliseconds := 150000
  )
  from vault.decrypted_secrets s
  where s.name = 'agent_service_role_key';
  $cmd$);
    perform cron.schedule('agent-proactif-nuit', '13 8 * * *', $cmd$
  select net.http_post(
    url     := 'https://fwvrqngbafqdaekbdfnm.supabase.co/functions/v1/agent-proactif-v1',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || s.decrypted_secret
    ),
    body := '{"interne":"proactif_nuit"}'::jsonb,
    timeout_milliseconds := 150000
  )
  from vault.decrypted_secrets s
  where s.name = 'agent_service_role_key';
  $cmd$);
  else
    raise notice 'pg_cron, pg_net ou Vault absent : tâches agent-missions-tick et agent-proactif-nuit NON planifiées.';
  end if;
end $$;
