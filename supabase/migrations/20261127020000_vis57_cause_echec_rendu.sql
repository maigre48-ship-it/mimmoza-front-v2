-- =============================================================================
-- VIS-57 (27/11/2026) — CAUSE RÉELLE D'UN RENDU EN ÉCHEC, lisible par SON propriétaire.
--
-- NON APPLIQUÉE par l'agent : à faire valider et appliquer par Albé. Sans elle, tout fonctionne : le site remplace déjà
-- les messages génériques « Vérifiez la description du bâtiment » par une phrase qui n'accuse pas la description
-- (src/lib/studio/causeEchecRendu.ts) ; avec elle, la carte du chat affiche en plus la cause PRÉCISE (projet non publié
-- vers Unreal, storyboard vide, plans refusés, arrêt de l'étape scène…).
--
-- Constat : la machine de rendu écrit la cause technique dans public.client_errors (VIS-28 : context.job_id,
-- message « worker_<étape> — <première ligne du détail> ») ; cette table n'est lisible que par les administrateurs.
--
-- Contenu : une fonction SECURITY DEFINER qui renvoie la PREMIÈRE LIGNE du détail du dernier échec d'UN travail, et
-- seulement si l'appelant en est le propriétaire (studio_jobs.user_id = auth.uid()). Aucune autre colonne, aucune
-- donnée d'un autre utilisateur. Aucune table créée ni modifiée. REJOUABLE (create or replace).
-- =============================================================================

begin;

create or replace function public.studio_job_cause_echec(p_job_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select left(split_part(coalesce(e.message, ''), E'\n', 1), 400)
    from public.client_errors e
    join public.studio_jobs j on j.id = p_job_id
   where j.user_id = auth.uid()
     and j.statut = 'echec'
     and e.context->>'job_id' = p_job_id::text
   order by e.created_at desc
   limit 1;
$$;

revoke all on function public.studio_job_cause_echec(uuid) from public, anon;
grant execute on function public.studio_job_cause_echec(uuid) to authenticated, service_role;

comment on function public.studio_job_cause_echec(uuid) is
  'VIS-57 — première ligne de la cause technique du dernier échec d''un rendu (client_errors), pour son propriétaire seulement.';

commit;
