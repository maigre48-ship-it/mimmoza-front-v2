# Contrat commun — « Film ou visite en 3 clics » + photoréalisme total (26/10/2026)

Décisions du fondateur (Albé) :
1. **3 clics depuis Mimmoza** : (1) le projet est décrit dans la conversation Mimmo (fiche « Espace 3D » remplie), (2) clic « Film » ou « Visite 360° », (3) clic « Lancer » sur une seule feuille d'options pré-remplie. Le Studio travaille en coulisses ; l'utilisateur ne l'ouvre pas. Résultat : notification + lien.
2. **Visite virtuelle = visite 360° dans le navigateur** : panoramas équirectangulaires calculés en qualité photo (Unreal, rendu final), navigation de point en point par des repères cliquables, lien partageable, fonctionne sur téléphone.
3. **Photoréalisme TOTAL** : chaque élément visible (bâtiment, matières, vitrages, sol, ciel, végétation, voitures, personnes, mobilier intérieur et extérieur, mobilier urbain, voisinage) doit être photoréaliste. **Un élément qui n'a pas d'asset certifié photoréaliste est OMIS et signalé**, jamais montré en qualité dégradée (règle déjà posée pour la végétation, étendue à tout).
4. Budget assets « raisonnable » : personnes MetaHuman (gratuites), Poly Haven (CC0), Fab gratuit, puis quelques packs payants ciblés — **aucun achat sans liste chiffrée validée par Albé**.
5. Rendu exécuté sur le PC du fondateur (HP Omen 16, Windows, Unreal 5.7) jusqu'à la première vente ; machine distante ensuite. Le code doit rester agnostique (détection à l'exécution).

## Dépôts
- Front : `C:\Users\maigr\Dev\mimmoza-front-v2` (shell appareil : `~/mnt/Dev/mimmoza-front-v2`), branche `correctifs-audit-20261021`. Supabase prod `fwvrqngbafqdaekbdfnm`.
- Studio : `C:\Users\maigr\Dev\mimmozia-studio` (`~/mnt/Dev/mimmozia-studio`), branche `refonte/interface-colonnes`. Lire `CLAUDE.md` et `AGENTS.md` du studio AVANT toute modification (règles d'architecture : Blender/bpy uniquement dans `src/adapters/blender/`, protocole MIMMOZIA_OK/MIMMOZIA_ERROR, etc.). Code Unreal Python dans `unreal/` (paquet `unreal/mimmozia/`, entrées `*_entry.py`, film automatique `film_auto.py`, `film_auto_entry.py`, schéma `film-quality.v1.schema.json`).

## File de travaux (Supabase) — interface partagée
Table `public.studio_jobs` (migration écrite par l'agent FRONT, NON appliquée ; le coordinateur l'applique après accord) :
- `id uuid pk default gen_random_uuid()`, `user_id uuid not null references auth.users on delete cascade`, `conversation_id text`,
- `type text check in ('film','visite360')`,
- `statut text check in ('en_attente','en_cours','termine','echec','annule') default 'en_attente'`,
- `progression int 0..100 default 0`, `etape text` (libellé humain : « Préparation de la scène », « Rendu 12/40 »…),
- `fiche jsonb not null` (JarvisDraft validé + terrain confirmé, tel que produit par `src/spaces/copilot/studio3d/` du front),
- `options jsonb not null default '{}'` — film : `{duree_s: 30|60|90, ambiance: 'jour'|'fin_de_journee'|'nuit', format: '16:9'|'9:16', interieurs: bool, musique: bool}` ; visite360 : `{ambiance, interieurs: bool, resolution: '6k'|'8k'}`,
- `resultat jsonb` — film : `{video_path, poster_path, duree_s, avertissements[] }` ; visite360 : `{visite_id, manifest_path, panoramas: n, avertissements[]}` (chemins dans le stockage, voir plus bas),
- `elements_omis jsonb default '[]'` — liste `{categorie, raison}` des éléments retirés faute d'asset photoréaliste (affichée à l'utilisateur),
- `erreur text`, `worker_id text`, `cree_le, maj_le, demarre_le, termine_le timestamptz`.
RLS : l'utilisateur lit et annule SES travaux, crée un travail pour lui-même (statut forcé à en_attente, champs serveur protégés) ; écriture des champs de suivi réservée au service_role (worker).
RPC worker (service_role) : `studio_job_prendre(p_worker text, p_types text[]) returns studio_jobs` (FOR UPDATE SKIP LOCKED, passe en_cours), `studio_job_avancer(p_id uuid, p_progression int, p_etape text)`, `studio_job_terminer(p_id uuid, p_resultat jsonb, p_elements_omis jsonb)`, `studio_job_echouer(p_id uuid, p_erreur text)`. Plafond : 2 travaux actifs par utilisateur.

## Stockage
- Bucket privé `studio-rendus` : `<user_id>/<job_id>/film.mp4`, `poster.jpg` ; lecture par URL signée (propriétaire).
- Bucket public `visites` : `<visite_id>/manifest.json`, `<visite_id>/pano-<n>.jpg` (+ tuiles éventuelles), `visite_id` = UUID aléatoire non devinable. Page publique `/visite/:visiteId` du front.

## Manifeste de visite 360° (`manifest.json`, version 1)
```json
{
  "version": 1,
  "titre": "string",
  "depart": "pano-id",
  "panoramas": [
    {"id": "sejour", "titre": "Séjour", "image": "pano-sejour.jpg", "largeur": 8192, "hauteur": 4096,
     "cap_initial_deg": 0, "niveau": 0, "position_m": [x, y, z],
     "liens": [{"vers": "cuisine", "cap_deg": 75, "inclinaison_deg": -10, "libelle": "Cuisine"}]}
  ],
  "plan": {"image": "plan-niveau-0.png", "niveaux": [0, 1]} ,
  "mentions": ["Images de synthèse non contractuelles"],
  "elements_omis": [{"categorie": "voitures", "raison": "aucun asset photoréaliste installé"}]
}
```

## Règles de travail (tous les agents)
- Écrire le code et les tests ; les rendus Unreal/Blender ne peuvent PAS tourner depuis le shell de l'appareil (VM Linux) : fournir des scripts `.bat`/`.ps1` que le fondateur lancera, et des tests unitaires Python/TS qui tournent sans Unreal (les tests existants du studio montrent comment simuler `unreal`).
- Fichiers souvent en CRLF : éditer en Python avec `newline=''`. Jamais de suppression de fichier (interdit sur l'appareil). ~170 s max par commande shell.
- PAS de git add/commit/push, PAS de migration appliquée, PAS de déploiement, PAS d'achat.
- Ne jamais inventer de données, de prix d'asset non vérifiés, de témoignages. Textes en français naturel.
- Rapport final : fichiers créés/modifiés, ce qui est testé, ce qui ne l'est pas, ce que le fondateur doit lancer, écarts au contrat.
