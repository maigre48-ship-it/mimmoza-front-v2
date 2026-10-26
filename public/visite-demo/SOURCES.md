# Visite de démonstration (/visite/demo ou ?demo=1)

Panoramas : photographies HDRI de Poly Haven, licence CC0 (domaine public, usage commercial libre,
aucune attribution requise), converties localement d'EXR 4k en JPEG (courbe sRGB, 4096×2048 + aperçu 1024×512) :

- `pano-clairiere.jpg` ← `forest_grove_4k.exr` — https://polyhaven.com/a/forest_grove
- `pano-sous-bois.jpg` ← `forest_slope_4k.exr` — https://polyhaven.com/a/forest_slope

Sources locales : `mimmozia-studio/assets/hdri/candidats/` (téléchargées par `scripts/download-hdri-candidates.mjs`).
Commande : `ffmpeg -apply_trc iec61966_2_1 -i <hdri>_4k.exr -vf scale=4096:2048:flags=lanczos -q:v 6 pano-<id>.jpg`.
Plan : `plan-niveau-0.png` (PNG : le bucket public des visites ne reçoit aucun SVG ; `plan-niveau-0.svg`, ancien, n'est plus référencé). Le plan et les positions sont fictifs : ils servent seulement à tester la page sans rendu Unreal.
