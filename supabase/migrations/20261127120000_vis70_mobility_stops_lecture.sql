-- VIS-70 (27/11/2026) — NON APPLIQUÉE (Supabase en lecture seule pour l'agent). À relire puis appliquer par Albé.
-- Constat : public.mobility_stops a la RLS active sans aucune politique ; mobility_nearby_stops et
-- mobility_deduplicate_by_mode sont SECURITY INVOKER : un compte connecté reçoit donc 0 gare.
-- La page Quartier du site lit les gares par cette RPC ; l'outil Edge du chat (clé service) n'est pas concerné.
-- Données publiques (SNCF / IDFM, ODbL) : lecture seule pour les comptes connectés, comme gtfs_stops et bpe_equipements.
create policy mobility_stops_read_auth on public.mobility_stops
  for select to authenticated using (true);
