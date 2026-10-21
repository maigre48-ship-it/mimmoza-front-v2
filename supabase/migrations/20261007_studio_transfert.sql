-- CH2 — Transfert vers MimmozIA Studio : photos de façade, plans (images, PDF) joints dans le tchat Mimmoza.
-- Bucket PRIVÉ, 20 Mo par fichier ; chacun ne voit, n'ajoute et ne supprime que <auth.uid()>/…
-- Le studio les reçoit par adresses SIGNÉES (1 h). Déjà appliqué le 07/10/2026 (via SQL direct) : rejouable.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('studio-transfert', 'studio-transfert', false, 20971520, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

drop policy if exists "transfert_select_proprietaire" on storage.objects;
create policy "transfert_select_proprietaire" on storage.objects for select to authenticated
  using (bucket_id = 'studio-transfert' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "transfert_insert_proprietaire" on storage.objects;
create policy "transfert_insert_proprietaire" on storage.objects for insert to authenticated
  with check (bucket_id = 'studio-transfert' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "transfert_delete_proprietaire" on storage.objects;
create policy "transfert_delete_proprietaire" on storage.objects for delete to authenticated
  using (bucket_id = 'studio-transfert' and (storage.foldername(name))[1] = auth.uid()::text);
