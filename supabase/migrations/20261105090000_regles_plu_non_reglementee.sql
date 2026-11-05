-- =============================================================================
-- Correctif lot Q1 : une règle PLU « non réglementée » est valide sans valeur
-- =============================================================================
-- Depuis le lot Q1 (commit 0897cc78, copilot-chat v276), une règle comme
-- « UC 9 : il n'est pas fixé de règle » est enregistrée avec
--   nature = 'non_reglementee', statut = 'confirme', valeur = null, article cité.
-- Le contrôle agent_conceptions_regles_plu_check (20261031_agent_conception.sql)
-- refusait toute règle non « manquant » sans valeur → la mise à jour de
-- agent_conceptions échouait (constaté en prod le 05/11/2026, mission AE0414).
--
-- Seul changement : une valeur nulle est admise pour statut 'confirme' ou
-- 'estime' UNIQUEMENT si nature = 'non_reglementee' ET un article est cité.
-- Champs optionnels du lot Q1 contrôlés en type : nature, secteur,
-- valeurs_par_secteur (tableau), renvoi_document_graphique, regle_relative,
-- toiture, mesure_retenue. Tout le reste est inchangé.
-- Réversible : réappliquer la fonction de 20261031_agent_conception.sql.
-- =============================================================================

create or replace function public.agent_conception_regles_valides(p jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case when p is null or jsonb_typeof(p) <> 'array' then false else (
     (select count(*) = count(distinct e->>'cle') from jsonb_array_elements(p) e)
     and not exists (
       select 1
         from jsonb_array_elements(p) e
        where jsonb_typeof(e) <> 'object'
           or coalesce(e->>'cle', '') not in ('hauteur_max_m', 'niveaux_max', 'emprise_sol_max_pct',
                                              'recul_voie_m', 'recul_limites_m', 'recul_limites_formule',
                                              'pleine_terre_min_pct', 'stationnement_par_logement',
                                              'mixite_sociale_pct')
           or coalesce(e->>'statut', '') not in ('confirme', 'estime', 'manquant')
           or coalesce(jsonb_typeof(e->'source'), '') <> 'string'
           or btrim(e->>'source') = ''
           or coalesce(jsonb_typeof(e->'unite'), '') <> 'string'
           or not (e ? 'valeur')
           or jsonb_typeof(e->'valeur') not in ('number', 'string', 'null')
           or (e->>'statut' = 'manquant' and jsonb_typeof(e->'valeur') <> 'null')
           or (e->>'statut' <> 'manquant' and jsonb_typeof(e->'valeur') = 'null'
               and not (coalesce(e->>'nature', '') = 'non_reglementee'
                        and coalesce(jsonb_typeof(e->'article'), '') = 'string'
                        and btrim(coalesce(e->>'article', '')) <> ''))
           or (e ? 'article' and jsonb_typeof(e->'article') <> 'string')
           or (e ? 'texte' and jsonb_typeof(e->'texte') <> 'string')
           or (e ? 'nature' and coalesce(e->>'nature', '') not in ('chiffree', 'non_reglementee', 'par_secteur'))
           or (e ? 'secteur' and jsonb_typeof(e->'secteur') not in ('string', 'null'))
           or (e ? 'valeurs_par_secteur' and jsonb_typeof(e->'valeurs_par_secteur') <> 'array')
           or (e ? 'renvoi_document_graphique' and jsonb_typeof(e->'renvoi_document_graphique') not in ('string', 'null', 'boolean'))
           or (e ? 'regle_relative' and jsonb_typeof(e->'regle_relative') not in ('string', 'null'))
           or (e ? 'toiture' and jsonb_typeof(e->'toiture') not in ('string', 'null'))
           or (e ? 'mesure_retenue' and jsonb_typeof(e->'mesure_retenue') not in ('string', 'null'))
     )) end
$$;
revoke execute on function public.agent_conception_regles_valides(jsonb) from public, anon;
grant execute on function public.agent_conception_regles_valides(jsonb) to authenticated, service_role;
