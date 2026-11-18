-- LOT G4 (17/11/2026) — plans de l'extension livrés avec l'image.
-- La machine de rendu dépose, à côté de l'image d'un projet d'extension, dans le seau PRIVÉ `studio-rendus` :
--   <user_id>/<job_id>/plans-extension.pdf          (application/pdf)
--   <user_id>/<job_id>/plans-extension-dxf.zip      (application/zip)
--   <user_id>/<job_id>/plans-extension-apercu.png   (image/png, déjà accepté)
-- Le seau n'accepte aujourd'hui que vidéo, images et JSON : sans cette migration, le PDF et le zip sont refusés
-- (la machine de rendu le dit dans `resultat.extension.plans` : « non_envoye », la carte n'affiche aucun lien).
-- Rien d'autre ne change : seau privé, politiques de lecture par propriétaire inchangées. Idempotente.
update storage.buckets
set allowed_mime_types = (
  select array(select distinct t from unnest(coalesce(allowed_mime_types, array[]::text[]) || array['application/pdf', 'application/zip']) as t order by t)
)
where id = 'studio-rendus';
