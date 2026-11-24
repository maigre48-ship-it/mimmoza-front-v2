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

VIS-33 (24/11) — « je ne vois pas tout » : la plupart des matières de voirie et des enduits (acg-asphalt033,
acg-tiles038, acg-plaster003, grass001…) ne sont PAS dans les .zip : elles vivent dans
`mimmozia-studio/assets/materials/<jeu>/` (convention acquise `color.jpg`, ou `<jeu>_basecolor.jpg`), que ce script
ne lisait pas. Ces dossiers sont des JONCTIONS vers le SSD D: (D:\Mimmoza-assets\...) : lancer le script sous Windows,
disque D: branché. Les jeux `gen-*` (textures dessinées par programme) n'ont pas de photo : jamais de vignette.

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
INTERIEUR = re.compile(r'^(fabric|leather|tiles|woodfloor|marble014|carpet)', re.I)
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


def jeux_de_voirie() -> set:
    """VIS-33 : jeux des matières de rue (dalles acg-tiles038 / acg-tiles143…) — exemptés du filtre « intérieur »."""
    with open(os.path.join(STUDIO, 'src/core/quartier/materiaux/catalogue.ts'), encoding='utf-8') as f:
        return {re.sub(r'^acg-(4k-)?', '', n.lower()) for n in re.findall(r"jeu: '([a-z0-9-]+)'", f.read(), re.I)}


VOIRIE = jeux_de_voirie()


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


def textures_des_materiaux() -> None:
    """VIS-33 : jeux de `assets/materials/<jeu>/` (acg-…, acg-4k-…, ambientCG) — carte de couleur réelle."""
    racine = os.path.join(STUDIO, 'assets', 'materials')
    dossier = os.path.join(SORTIE, 'textures')
    os.makedirs(dossier, exist_ok=True)
    illisibles = []
    # Les jeux 2K (acg-…) passent avant les 4K (acg-4k-…) : même photo, lecture plus rapide.
    for d in sorted(os.listdir(racine), key=lambda n: (n.startswith('acg-4k-'), n)):
        jeu = re.sub(r'^acg-(4k-)?', '', d.lower())
        if d.startswith('gen-') or d.startswith('.') or (INTERIEUR.match(jeu) and jeu not in VOIRIE) or jeu not in UTILES:
            continue
        cible = os.path.join(dossier, jeu + '.jpg')
        if os.path.exists(cible):
            continue
        try:
            noms = os.listdir(os.path.join(racine, d))
        except OSError:
            illisibles.append(d)
            continue
        couleur = [n for n in noms if n.lower() in ('color.jpg', f'{d.lower()}_basecolor.jpg') or n.lower().endswith(('_color.jpg', '_basecolor.jpg'))]
        if not couleur:
            print('sans carte de couleur :', d)
            continue
        img = Image.open(os.path.join(racine, d, couleur[0]))
        img.draft('RGB', (TAILLE * 2, TAILLE * 2))
        vignette(img).save(cible, 'JPEG', quality=82, optimize=True)
        print('texture (assets/materials)', jeu)
    if illisibles:
        print(f'ILLISIBLES ({len(illisibles)}) — jonctions vers le disque D: non branché ? :', ', '.join(illisibles))


if __name__ == '__main__':
    textures()
    if DEBUT == 0:
        textures_du_site()
        textures_des_materiaux()
        elements()
