-- ============================================================================
-- 20260716_promoteur_backfill_project_unlocks.sql
-- Modèle A (1 jeton = 1 étude) — BACKFILL des études promoteur existantes.
--
-- ############################################################################
-- ##  DÉJÀ APPLIQUÉ EN BASE LE 2026-07-16 — NE PAS REJOUER.                  ##
-- ##  - Diagnostic Partie A : AUCUN trigger de débit, AUCUNE contrainte CHECK##
-- ##    sur unlocked_at. Le débit vit dans le CORPS de la RPC unlock_project ##
-- ##    (pas dans un trigger) → un INSERT direct ne débite rien.             ##
-- ##  - Variante retenue : B2 (unlocked_at = now() + interval '10 years'),   ##
-- ##    marquée ledger_id = 'backfill_modele_a'.                             ##
-- ##  - Résultat : 11 lignes insérées → 13 études / 0 sans unlock.           ##
-- ##  - Nettoyage : l'ancienne RPC unlock_project 3-params (sans             ##
-- ##    p_validity_days) a été supprimée ; seule la 4-params subsiste        ##
-- ##    (celle qu'appelle src/lib/billing/projectUnlock.ts).                 ##
-- ##  Fichier conservé pour historique. Les PARTIES A/B ci-dessous NE        ##
-- ##  DOIVENT PLUS être exécutées.                                           ##
-- ############################################################################
--
-- Motif : le passage au Modèle A fait tester isProjectUnlocked() en fail-closed
-- dans AppShell.handleProtectedNavigate. Les études créées AVANT ce passage n'ont
-- aucune ligne dans project_unlocks → elles deviennent inaccessibles, et la modale
-- de déblocage étant devenue du code mort, il n'existe plus de chemin pour les
-- ouvrir. Ce script leur offre un déverrouillage rétroactif (AUCUN débit de jeton).
--
-- Périmètre : toutes les lignes de promoteur_studies. Idempotent.
-- Date : 2026-07-16. À exécuter manuellement dans le SQL Editor du Dashboard.
--
-- ⚠️ IMPORTANT — je n'ai pas d'accès à la base : le schéma ci-dessous est
-- reconstruit depuis le code (src/lib/billing/projectUnlock.ts). EXÉCUTE D'ABORD
-- la PARTIE A (diagnostic). Si un trigger de DÉBIT existe sur project_unlocks,
-- ARRÊTE-TOI et préviens — l'insert direct ne doit rien débiter.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- PARTIE A — DIAGNOSTIC (lecture seule, à exécuter et LIRE avant la PARTIE B)
-- ────────────────────────────────────────────────────────────────────────────

-- A.1 — Colonnes réelles de project_unlocks (vérifier : user_id, space,
--       project_id, unlocked_at ; noter les NOT NULL sans default).
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'project_unlocks'
order by ordinal_position;

-- A.2 — Triggers sur project_unlocks. Si l'un d'eux débite des jetons
--       (credit_accounts / token_ledger / spend / decrement…), NE PAS lancer la
--       PARTIE B et me prévenir.
select tgname as trigger_name, pg_get_triggerdef(t.oid) as definition
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
where c.relname = 'project_unlocks' and not t.tgisinternal;

-- A.3 — Aperçu : combien d'études seraient backfillées (avant/après).
select
  (select count(*) from public.promoteur_studies) as total_studies,
  (select count(*) from public.promoteur_studies s
     where not exists (
       select 1 from public.project_unlocks u
       where u.space = 'promoteur' and u.project_id = s.id and u.user_id = s.user_id
     )) as studies_a_backfiller;


-- ────────────────────────────────────────────────────────────────────────────
-- PARTIE B — BACKFILL (à exécuter SEULEMENT si la PARTIE A ne révèle aucun
--            trigger de débit et confirme les colonnes user_id/space/project_id/
--            unlocked_at). N'utilise QUE des colonnes confirmées par le code ;
--            label / ledger_id sont laissés à leur défaut (NULL) — migration
--            offerte, pas un achat, donc pas de ledger_id.
-- ────────────────────────────────────────────────────────────────────────────

insert into public.project_unlocks (user_id, space, project_id, unlocked_at)
select s.user_id, 'promoteur', s.id, now()
from public.promoteur_studies s
where not exists (
  select 1 from public.project_unlocks u
  where u.space = 'promoteur'
    and u.project_id = s.id
    and u.user_id = s.user_id
);

-- Contrôle post-backfill : plus aucune étude sans déverrouillage.
select count(*) as studies_sans_unlock
from public.promoteur_studies s
where not exists (
  select 1 from public.project_unlocks u
  where u.space = 'promoteur' and u.project_id = s.id and u.user_id = s.user_id
);


-- ────────────────────────────────────────────────────────────────────────────
-- NOTE — durée de validité
-- unlocked_at est posé à now() : la longévité effective de ce backfill dépend de
-- la fenêtre de validité utilisée par isProjectUnlocked (aujourd'hui 30 jours via
-- paywallConfig). Si la validité reste à 30 jours, ces études ré-expireront 30
-- jours après l'exécution de ce script. Cf. arbitrage « validityDays » en cours.
-- ────────────────────────────────────────────────────────────────────────────

-- ROLLBACK (retire UNIQUEMENT les déverrouillages posés par ce backfill :
-- ceux sans ledger_id, donc non issus d'un achat). À adapter si nécessaire.
-- delete from public.project_unlocks
-- where space = 'promoteur'
--   and ledger_id is null
--   and project_id in (select id from public.promoteur_studies);
