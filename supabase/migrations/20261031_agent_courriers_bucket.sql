-- supabase/migrations/20261031_agent_courriers_bucket.sql
-- Agent autonome (§4) — bucket PRIVÉ des courriers PDF générés par
-- agent-action-envoyer-v1. Chemin des objets : <user_id>/<action_id>.pdf
-- Écriture : uniquement la fonction (service_role, qui contourne la RLS).
-- Lecture : le propriétaire peut lister / signer ses propres fichiers ; aucun accès public.
-- Idempotent. Aucune suppression.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('agent-courriers', 'agent-courriers', false, 5242880, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'storage' and tablename = 'objects'
                    and policyname = 'agent_courriers_lecture_proprietaire') then
    create policy agent_courriers_lecture_proprietaire on storage.objects
      for select to authenticated
      using (bucket_id = 'agent-courriers' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
end $$;
