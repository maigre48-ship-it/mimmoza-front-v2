#!/usr/bin/env python3
"""VIS-24 — Vignettes du catalogue extérieur (page /mimmozia/catalogue-exterieur).

Fabrique de PETITES images (256 px) à partir de fichiers RÉELS du Studio, sans rien inventer :
  - textures : carte de couleur des jeux ambientCG (CC0) rangés dans `mimmozia-studio/textures/*.zip`
    -> public/catalogue-exterieur/textures/<jeu>.jpg   (ex. bricks101.jpg), complétées par les jeux
    ambientCG déjà servis par le site (public/textures/) ;
  - modèles 3D : vignettes du catalogue du Studio `mimmozia-studio/assets/archviz/vignettes/`
    (végétation, plantes en pot, bancs) -> public/catalogue-exterieur/elements/<nom>.jpg.
Seuls les jeux cités par une matière du Studio reçoivent une vignette ; les jeux d'intérieur (tissus, cuirs,
carrelages, parquets) sont ignorés.

Usage (PowerShell, depuis mimmoza-front-v2) :
    python scripts/vignettes-catalogue-exterieur.py ..\mimmozia-studio
    python scripts/vignettes-catalogue-exterieur.py ..\mimmozia-studio 0 15     # par tranche (début, fin)
Puis régénérer le module : node scripts/generer-catalogue-exterieur.mjs ..\mimmozia-studio
Nécessite Pillow (pip install pillow). Les fichiers déjà présents ne sont pas refaits.
"""
import io, os, re, sys, zipfile
from PIL import Image

ICI = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(ICI)
STUDIO = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(SITE, '..', 'mimmozia-studio'))
DEBUT = int(sys.argv[2]) if len(sys.argv) > 2 else 0
FIN = int(sys.argv[3]) if len(sys.argv) > 3 else 10 ** 6
SORTIE = os.path.join(SITE, 'public', 'catalogue-exterieur')
INTERIEUR = re.compile(r'^(fabric|leather|tiles|woodfloor|marble014)', re.I)
ELEMENTS = re.compile(r'(tree|shrub|flower|grass|plant|sapling|searsia|bench)', re.I)
TAILLE = 256


def jeux_utiles() -> set:
    """Jeux de textures réellement cités par les matières du Studio (seuls ceux-là reçoivent une vignette)."""
    noms = set()
    for rel, motif in (('src/core/materials/archvizLibrary.ts', r"(?:ambientCgSet|acgAcquisSet|cartesVoirie|cartesInterieures)\('([a-z0-9-]+)'"),
                       ('src/core/quartier/materiaux/catalogue.ts', r"jeu: '([a-z0-9-]+)'"),
                       ('assets/photorealisme.json', r"cartes ([a-z0-9-]+)"),
                       ('unreal/mimmozia/materiaux_contemporains.py', r"\b((?:wood|planks|marble|concrete|bricks)[0-9]+[a-z]?)\b")):
        with open(os.path.join(STUDIO, rel), encoding='utf-8') as f:
            noms.update(m.lower() for m in re.findall(motif, f.read(), re.I))
    return {re.sub(r'^acg-(4k-)?', '', n) for n in noms}


UTILES = jeux_utiles()


def vignette(img: Image.Image) -> Image.Image:
    img = img.convert('RGBA')
    fond = Image.new('RGBA', img.size, (244, 246, 249, 255))
    fond.alpha_composite(img)
    img = fond.convert('RGB')
    c = min(img.size)
    g, h = (img.width - c) // 2, (img.height - c) // 2
    return img.crop((g, h, g + c, h + c)).resize((TAILLE, TAILLE), Image.LANCZOS)


def textures() -> None:
    dossier = os.path.join(SORTIE, 'textures')
    os.makedirs(dossier, exist_ok=True)
    zips = sorted(f for f in os.listdir(os.path.join(STUDIO, 'textures')) if f.lower().endswith('.zip'))
    zips = [z for z in zips if not INTERIEUR.match(z) and z.split('_')[0].lower() in UTILES]
    for z in zips[DEBUT:FIN]:
        jeu = z.split('_')[0].lower()
        cible = os.path.join(dossier, jeu + '.jpg')
        if os.path.exists(cible):
            continue
        with zipfile.ZipFile(os.path.join(STUDIO, 'textures', z)) as archive:
            couleur = [n for n in archive.namelist() if n.lower().endswith('_color.jpg')]
            if not couleur:
                print('sans carte de couleur :', z)
                continue
            img = Image.open(io.BytesIO(archive.read(couleur[0])))
            img.draft('RGB', (TAILLE * 2, TAILLE * 2))
            vignette(img).save(cible, 'JPEG', quality=82, optimize=True)
            print('texture', jeu)


def textures_du_site() -> None:
    """Jeux ambientCG déjà servis par le site (public/textures/**/<Jeu>_2K-JPG_Color.jpg), s'ils manquent encore."""
    dossier = os.path.join(SORTIE, 'textures')
    for racine, _, fichiers in os.walk(os.path.join(SITE, 'public', 'textures')):
        for f in fichiers:
            if not f.lower().endswith('_color.jpg') or INTERIEUR.match(f) or f.split('_')[0].lower() not in UTILES:
                continue
            cible = os.path.join(dossier, f.split('_')[0].lower() + '.jpg')
            if os.path.exists(cible):
                continue
            img = Image.open(os.path.join(racine, f))
            img.draft('RGB', (TAILLE * 2, TAILLE * 2))
            vignette(img).save(cible, 'JPEG', quality=82, optimize=True)
            print('texture (site)', f.split('_')[0].lower())


def elements() -> None:
    source = os.path.join(STUDIO, 'assets', 'archviz', 'vignettes')
    dossier = os.path.join(SORTIE, 'elements')
    os.makedirs(dossier, exist_ok=True)
    for f in sorted(os.listdir(source)):
        if not ELEMENTS.search(f) or f.startswith(('bedside', 'desk')):
            continue
        cible = os.path.join(dossier, os.path.splitext(f)[0] + '.jpg')
        if os.path.exists(cible):
            continue
        vignette(Image.open(os.path.join(source, f))).save(cible, 'JPEG', quality=84, optimize=True)
        print('element', f)


if __name__ == '__main__':
    textures()
    if DEBUT == 0:
        textures_du_site()
        elements()
