-- ENV1 — Photos 360° du terrain (fonds d'environnement pour MimmozIA Studio).
-- Bucket PRIVÉ ; chaque utilisateur ne voit, n'ajoute et ne supprime que ses
-- propres fichiers, rangés sous « <auth.uid()>/<étude>/<fichier> ».
-- Le studio les reçoit par adresses SIGNÉES (1 h), jamais par lien public.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('environnement-360', 'environnement-360', false, 62914560, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

drop policy if exists "env360_select_proprietaire" on storage.objects;
create policy "env360_select_proprietaire" on storage.objects
  for select to authenticated
  using (bucket_id = 'environnement-360' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "env360_insert_proprietaire" on storage.objects;
create policy "env360_insert_proprietaire" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'environnement-360' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "env360_delete_proprietaire" on storage.objects;
create policy "env360_delete_proprietaire" on storage.objects
  for delete to authenticated
  using (bucket_id = 'environnement-360' and (storage.foldername(name))[1] = auth.uid()::text);
