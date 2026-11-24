// scripts/generer-catalogue-exterieur.mjs
// =============================================================================
// VIS-24 — Génère src/spaces/copilot/studio3d/catalogueExterieur.ts : le catalogue des
// matières et des éléments 3D d'EXTÉRIEUR, avec pour chacun un statut honnête
// (proposé dans le chat / visible dans le Studio / repris dans les images rendues).
//
// Rien n'est deviné : chaque entrée vient d'un fichier réel, relu à chaque génération.
//   Studio (mimmozia-studio) :
//     src/core/materials/archvizLibrary.ts     matières av-* (nom, teinte, jeu de textures, table LEGACY_TO_ARCHVIZ)
//     src/core/materials/premiumLibrary.ts     matières nobles pm-*
//     src/core/materials/regionalLibrary.ts    matières régionales rg-*
//     src/core/quartier/materiaux/catalogue.ts matières de rue et de quartier qm-*
//     src/core/architecture/types.ts           formes de toit, fenêtres, balcons, garde-corps, entrées, reliefs
//     assets/archviz/manifest.json             modèles 3D de végétation visibles dans le Studio
//     assets/photorealisme.json                registre « photoréaliste ou rien » : ce qui a le droit d'apparaître
//                                              dans une image rendue (verdict oui / partiel / non / à valider)
//     unreal/mimmozia/build_level.py, materiaux_contemporains.py, src/core/extension/cloture3d.ts
//   Site (mimmoza-front-v2) :
//     src/spaces/copilot/studio3d/briefCreatif.ts   ce que le chat propose (et ce qu'il annonce « bientôt »)
//     public/catalogue-exterieur/                   vignettes réelles (scripts/vignettes-catalogue-exterieur.py)
//
// RÈGLE DU STATUT « rendu » (celle de la garde du Studio, docs/photorealisme/GARDE.md) :
//   - une matière est jugée par sa fiche du registre ; si la fiche dit « jugée par ses textures », par la fiche de
//     la texture attendue ; façades, toits, fenêtres, garde-corps et sols sont ESSENTIELS : jamais retirés d'une
//     image, donc au pire « repris avec réserve » (teinte unie ou texture non validée) ;
//   - un objet (arbre, banc, voiture…) sans fiche certifiée est MASQUÉ des images : « pas encore rendu ».
//
// Usage (PowerShell, depuis mimmoza-front-v2) :
//     node scripts/generer-catalogue-exterieur.mjs ..\mimmozia-studio
// Le test src/spaces/copilot/studio3d/catalogueExterieur.test.ts rejoue cette génération quand le Studio est
// présent à côté du site, et échoue si le module n'est plus à jour.
// =============================================================================
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
export const SITE_DEFAUT = resolve(ICI, '..');
export const STUDIO_DEFAUT = resolve(SITE_DEFAUT, '..', 'mimmozia-studio');
export const MODULE = 'src/spaces/copilot/studio3d/catalogueExterieur.ts';

export const FAMILLES = [
  { id: 'facades', libelle: 'Façades', description: 'Enduits, briques, pierres, bétons, bardages et styles de façade.' },
  { id: 'toitures', libelle: 'Toitures', description: 'Formes de toit et matières de couverture : tuiles, ardoise, zinc, terrasse.' },
  { id: 'menuiseries', libelle: 'Fenêtres, portes et vitrages', description: 'Types de fenêtres, cadres, verres, portes et entrées.' },
  { id: 'balcons', libelle: 'Balcons, loggias et garde-corps', description: 'Balcons, loggias, garde-corps et reliefs de façade.' },
  { id: 'sols', libelle: 'Sols, voirie et eau', description: 'Terrasses, allées, trottoirs, chaussée, pelouse, eau.' },
  { id: 'clotures', libelle: 'Clôtures', description: 'Murets, grilles et portails.' },
  { id: 'vegetation', libelle: 'Végétation', description: 'Arbres, arbustes, fleurs, pelouse en 3D.' },
  { id: 'mobilier', libelle: 'Mobilier de terrasse et de rue', description: 'Tables, chaises, bancs, jardinières, lampadaires.' },
  { id: 'vie', libelle: 'Voitures et personnages', description: 'Ce qui donne de la vie à une image.' },
  { id: 'ciel', libelle: 'Ciel, lumière et voisinage', description: 'Ambiances lumineuses, ciels, horizon et bâtiments voisins.' },
];

const lire = (racine, rel) => readFileSync(join(racine, rel), 'utf8');
/** Apostrophe typographique dans les textes montrés à l'écran. */
const typo = (t) => t.replace(/'/g, '’');
/** Noms du Studio précisés pour la page (homonymes d'un élément). */
const NOMS_AV = { 'av-garde-corps-verre': 'Verre des garde-corps' };
const premierePhrase = (t) => { const m = /^(.*?[.!?])(\s|$)/.exec(t.trim()); return (m ? m[1] : t.trim()).replace(/\s+/g, ' '); };

/** Joker « * » façon fnmatch, casse ignorée (comme unreal/mimmozia/photorealisme.py). */
function correspond(motif, chemin) {
  const re = new RegExp('^' + motif.toLowerCase().split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return re.test(chemin.toLowerCase());
}

// ── Lecture des sources du Studio ─────────────────────────────────────────────
function lireArchviz(studio) {
  const src = lire(studio, 'src/core/materials/archvizLibrary.ts');
  const parId = new Map();
  for (const m of src.matchAll(/mat\(\{ id: '([^']+)', name: '([^']+)', category: '([^']+)', baseColor: '(#[0-9a-fA-F]{6})'(.*?)\}\),?\r?\n/g)) {
    const [, id, nom, categorie, couleur, reste] = m;
    const jeu = /textureSet: \w+\('([^']+)'/.exec(reste)?.[1] ?? null;
    const description = /description: '([^']*)'/.exec(reste)?.[1] ?? '';
    const vu = parId.get(id);
    if (!vu || (!vu.jeu && jeu)) parId.set(id, { id, nom, categorie, couleur: couleur.toLowerCase(), jeu, description });
  }
  const heritage = {};
  const bloc = /LEGACY_TO_ARCHVIZ[^=]*=\s*\{([\s\S]*?)\n\};/.exec(src)?.[1] ?? '';
  for (const m of bloc.matchAll(/^\s*'?([a-z0-9-]+)'?: '(av-[a-z0-9-]+)'/gm)) heritage[m[1]] = m[2];
  if (parId.size < 40 || Object.keys(heritage).length < 20) throw new Error('archvizLibrary.ts : lecture incomplète (format changé ?)');
  return { matieres: [...parId.values()], heritage };
}

function lireBlocs(studio, rel, prefixe) {
  const src = lire(studio, rel);
  const morceaux = src.split(new RegExp(`id: '(?=${prefixe}-)`)).slice(1);
  return morceaux.map((bloc) => {
    const id = /^([a-z0-9-]+)'/.exec(bloc)?.[1];
    const nom = /name: '([^']+)'/.exec(bloc)?.[1];
    const couleur = /baseColor: '(#[0-9a-fA-F]{6})'/.exec(bloc)?.[1]?.toLowerCase();
    return { id, nom, couleur };
  }).filter((m) => m.id && m.nom && m.couleur);
}

/** Matières qm-* PROPRES au quartier (les autres sont des jumelles d'une matière av-*, lues dans `jumelles`). */
const QM_PROPRES = ['qm-enduit-perle', 'qm-enduit-gris', 'qm-brique-orangee', 'qm-pierre-gres', 'qm-pierre-moellon',
  'qm-enrobe', 'qm-enrobe-clair', 'qm-pave-granit', 'qm-pave-place', 'qm-marquage-blanc', 'qm-bordure-granit', 'qm-trottoir-beton',
  'qm-dalle-beton', 'qm-dalle-pierre', 'qm-stabilise', 'qm-piste-cyclable', 'qm-evergreen', 'qm-paillage', 'qm-eau'];
const QM_JUMELLES_DITES = { 'qm-brique-rouge': 'av-brique-rouge', 'qm-brique-claire': 'av-brique-claire', 'qm-pierre-calcaire': 'av-pierre-calcaire', 'qm-tuile-terre-cuite': 'av-tuiles-terre-cuite' };

function lireQuartier(studio, archviz) {
  const src = lire(studio, 'src/core/quartier/materiaux/catalogue.ts');
  const teinteAv = (id) => archviz.matieres.find((m) => m.id === id)?.couleur ?? null;
  const propres = QM_PROPRES.map((id) => {
    const i = src.indexOf(`id: '${id}'`);
    if (i < 0) throw new Error(`catalogue de quartier : ${id} introuvable`);
    const suite = src.slice(i + 10);
    const fin = suite.search(/id: 'qm-/);
    const bloc = src.slice(i, i + 10 + (fin < 0 ? 700 : Math.min(fin, 900)));
    const nom = /nom: (?:'([^']+)'|"([^"]+)")/.exec(bloc);
    const lit = /couleur: '(#[0-9a-fA-F]{6})'/.exec(bloc)?.[1] ?? null;
    const viaAv = /couleur: bibliotheque\('(av-[a-z0-9-]+)'\)/.exec(bloc)?.[1] ?? /base: '(av-[a-z0-9-]+)'/.exec(bloc)?.[1] ?? null;
    const emplacements = [...(/emplacements: \[([^\]]*)\]/.exec(bloc)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    return { id, nom: nom?.[1] ?? nom?.[2] ?? id, couleur: (lit ?? (viaAv ? teinteAv(viaAv) : null) ?? '#6f8fa6').toLowerCase(), emplacements };
  });
  const jumelles = { ...QM_JUMELLES_DITES };
  for (const m of src.matchAll(/derive\(\{ id: '(qm-[a-z0-9-]+)', nom: (?:'[^']*'|"[^"]*"), base: '(av-[a-z0-9-]+)'/g)) if (!QM_PROPRES.includes(m[1])) jumelles[m[1]] = m[2];
  return { propres, jumelles };
}

// ── Lecture du brief du chat (site) ───────────────────────────────────────────
function lireBrief(site) {
  const src = lire(site, 'src/spaces/copilot/studio3d/briefCreatif.ts');
  const liste = (nom) => {
    const bloc = new RegExp(`export const ${nom}: readonly OptionBrief<[^>]+>\\[\\] = \\[([\\s\\S]*?)\\n\\];`).exec(src)?.[1];
    if (bloc == null) throw new Error(`briefCreatif.ts : liste ${nom} introuvable`);
    const options = [...bloc.matchAll(/\{ valeur: ('([^']*)'|true|false), libelle: '([^']*)', detail: '([^']*)', disponible: (true|false)/g)]
      .map((m) => ({ valeur: m[2] ?? m[1], libelle: m[3], detail: m[4], disponible: m[5] === 'true' }));
    if (!options.length) throw new Error(`briefCreatif.ts : liste ${nom} vide`);
    return options;
  };
  const objet = (nom) => new RegExp(`export const ${nom}[^=]*= \\{([\\s\\S]*?)\\n\\};`).exec(src)?.[1] ?? '';
  const facadeVers = {};
  for (const m of objet('MATIERE_FACADE').matchAll(/^\s*([a-z_]+): \{ materiau: '([a-z0-9-]+) →/gm)) facadeVers[m[1]] = m[2];
  const teinteVers = [];
  for (const m of objet('MATIERE_TEINTE').matchAll(/^\s*([a-z_]+): \{ ([a-z]+): \{ materiau: '([a-z0-9-]+) →/gm)) teinteVers.push({ facade: m[1], teinte: m[2], heritage: m[3] });
  const bientot = [];
  const blocBientot = /export const BIENTOT[^=]*= \[([\s\S]*?)\n\];/.exec(src)?.[1] ?? '';
  for (const m of blocBientot.matchAll(/titre: '([^']*)', options: \[([^\]]*)\]/g)) bientot.push({ titre: m[1], options: [...m[2].matchAll(/'([^']*)'/g)].map((x) => x[1]) });
  return {
    styles: liste('STYLES'), facades: liste('FACADES'), ouvertures: liste('OUVERTURES'), balcons: liste('BALCONS'), attiques: liste('ATTIQUES'),
    rdcs: liste('RDCS'), ambiances: liste('AMBIANCES'), toitures: liste('TOITURES'), teintes: liste('TEINTES'), gardeCorps: liste('GARDE_CORPS'),
    menuiseries: liste('MENUISERIES'), soubassements: liste('SOUBASSEMENTS'), facadeVers, teinteVers, bientot,
  };
}

// ── Tables de correspondance brief → Studio (prouvées par les fichiers cités) ──
/** Toiture du brief → couverture du Studio (copilot-chat/agent/studio.ts, commentaire de BRIEF_TOITURES ; briefCreatif.ts, COULEUR_TOITURE). */
const TOITURE_MATIERE = { vegetalisee: 'toiture-vegetalisee', deux_pans_tuiles: 'tuile-rouge', deux_pans_ardoise: 'ardoise', deux_pans_zinc: 'zinc' };
/** Menuiseries du brief → cadre du Studio (briefCreatif.ts, COULEUR_MENUISERIES). */
const MENUISERIE_MATIERE = { gris: 'av-aluminium-gris', anthracite: 'av-aluminium-noir', blanc: 'av-aluminium-blanc', bronze: 'av-aluminium-bronze' };
/** Soubassement du brief → matière du Studio (briefCreatif.ts, COULEUR_SOUBASSEMENT). */
const SOUBASSEMENT_MATIERE = { pierre: 'pierre-claire-contemp', beton: 'beton-brut', brique: 'brique-rouge' };

// ── Rangement des matières par famille, et où elles s'appliquent ──────────────
function familleAv(m) {
  if (m.categorie === 'façade') return ['facades', 'Murs de façade'];
  if (m.categorie === 'toiture') return m.id === 'av-chene-porte' ? ['menuiseries', 'Portes d’entrée'] : ['toitures', /rive|bois-exterieur/.test(m.id) ? 'Bords de toit (rives)' : 'Couverture du toit'];
  if (m.categorie === 'sol extérieur') return ['sols', 'Sols extérieurs : terrasses, allées, jardin, rue'];
  if (m.categorie === 'végétation') return ['vegetation', 'Feuillages simplifiés de la vue 3D du Studio'];
  if (m.id === 'av-garde-corps-verre') return ['balcons', 'Garde-corps vitrés'];
  if (/^av-verre/.test(m.id)) return ['menuiseries', 'Vitrages'];
  if (/^av-aluminium/.test(m.id)) return ['menuiseries', 'Cadres des fenêtres et des portes'];
  if (/^av-acier/.test(m.id)) return ['balcons', 'Garde-corps et serrurerie'];
  if (m.id === 'av-persienne-metal') return ['menuiseries', 'Volets'];
  return ['menuiseries', 'Menuiseries en bois peint'];
}
const EMPLACEMENTS = { chaussee_enrobe: 'chaussée', chaussee_pave: 'chaussée pavée', marquage: 'marquages au sol', bordure_granit: 'bordures de trottoir', trottoir_beton: 'trottoirs',
  trottoir_dalle: 'trottoirs dallés', place_pave: 'places', place_stabilise: 'places et allées', piste_cyclable: 'pistes cyclables', stationnement_evergreen: 'places de stationnement',
  massif_paille: 'massifs plantés', eau: 'bassins et plans d’eau', facade_principal: 'façade principale', facade_secondaire: 'façade secondaire', soubassement: 'soubassement' };

// ── Noms français des fiches du registre (objets) ─────────────────────────────
const formes = (prefixe, ls, fam, nom, desc, vignette = null) => Object.fromEntries(ls.map((l) => [`${prefixe}-${l}`, [fam, `${nom} — forme ${l.toUpperCase()}`, desc, vignette]]));
const TAILLES = { small: 'petit', medium: 'moyen', large: 'grand' };
const parTaille = (prefixe, fam, nom, desc) => Object.fromEntries(Object.entries(TAILLES).map(([k, v]) => [`${prefixe}-${k}`, [fam, `${nom} — ${v}`, desc, null]]));
/** id du registre → [famille, nom, description, vignette du Studio ou null]. */
const OBJETS = {
  'struct.tuiles-3d': ['toitures', 'Tuiles modélisées en relief', 'Chaque tuile est un vrai volume, posé sur les toits en pente.', null],
  'struct.toit-joints': ['toitures', 'Joints et larmiers de toiture', 'Petits détails de couverture ajoutés au rendu.', null],
  'struct.portes-3d': ['menuiseries', 'Portes modélisées', 'Portes en volume, avec leurs matières.', null],
  'sol.terrain': ['sols', 'Terrain de la parcelle', 'Le sol du terrain, à ses dimensions réelles.', null],
  'mat.eau-piscine': ['sols', 'Eau de piscine', 'Surface d’eau pour piscines et bassins.', null],
  'sol.lointain': ['ciel', 'Sol lointain et horizon', 'Le sol qui prolonge la scène jusqu’à l’horizon.', null],
  'ciel.fond-panorama': ['ciel', 'Ciel photographié (panorama)', 'Vrai ciel photographié, utilisé en fond.', null],
  'ciel.sphere-moteur': ['ciel', 'Ciel par défaut du moteur', 'Ciel d’origine du moteur de rendu.', null],
  'ciel.hdri-qwantani-mid-morning-16k': ['ciel', 'Ciel très haute définition — matin', 'Ciel photographié en très haute définition.', null],
  'ciel.hdri-kloofendal-48d-16k': ['ciel', 'Ciel très haute définition — nuageux', 'Ciel photographié en très haute définition.', null],
  'ciel.hdri-qwantani-dusk-1-16k': ['ciel', 'Ciel très haute définition — crépuscule', 'Ciel photographié en très haute définition.', null],
  'vois.ign': ['ciel', 'Bâtiments voisins (volumes simples)', 'Voisinage réel repris des données publiques, en volumes simples.', null],
  'vois.contexte': ['ciel', 'Bâtiments de contexte (illustratifs)', 'Volumes d’ambiance autour du projet.', null],
  'pelouse.touffes-u03': ['vegetation', 'Pelouse en brins d’herbe', 'Herbe en relief, brin par brin.', null],
  'veg.grass-medium-01': ['vegetation', 'Touffe d’herbe n° 1', 'Touffe d’herbe photographiée.', 'grass-medium-01-2k'],
  'ph.grass-medium-02': ['vegetation', 'Touffe d’herbe n° 2', 'Touffe d’herbe photographiée.', 'grass-medium-02-2k'],
  'fab.megascans-wild-grass': ['vegetation', 'Herbe sauvage', 'Herbe scannée, très détaillée.', null],
  'veg.grimpante-proc': ['vegetation', 'Plante grimpante (lierre)', 'Lierre qui grimpe sur les façades.', null],
  'veg.island-tree-01': ['vegetation', 'Arbre feuillu n° 1', 'Arbre photographié, feuillage dense.', 'island-tree-01-2k'],
  'veg.island-tree-02': ['vegetation', 'Arbre feuillu n° 2', 'Arbre photographié, feuillage dense.', 'island-tree-02-2k'],
  'veg.island-tree-03': ['vegetation', 'Arbre feuillu n° 3', 'Arbre photographié, feuillage dense.', null],
  'veg.jacaranda': ['vegetation', 'Jacaranda', 'Arbre à fleurs, plutôt exotique.', null],
  'veg.tree-small-02': ['vegetation', 'Petit arbre', 'Arbre de petite taille.', 'tree-small-02-2k'],
  ...parTaille('veg.searsia-burchellii', 'vegetation', 'Arbre Searsia', 'Petit arbre de climat sec.'),
  'ph.pine-tree-01': ['vegetation', 'Pin', 'Conifère adulte.', null],
  'ph.fir-sapling-medium': ['vegetation', 'Jeune sapin', 'Petit conifère.', null],
  'ph.tree-stump-01': ['vegetation', 'Souche d’arbre', 'Souche pour les jardins naturels.', null],
  'fab.megaplants-european-beech': ['vegetation', 'Hêtre d’Europe', 'Grand arbre de nos régions, très détaillé.', null],
  'fab.megaplants-norway-maple': ['vegetation', 'Érable plane', 'Grand arbre de nos régions, très détaillé.', null],
  'fab.megaplants-silver-birch': ['vegetation', 'Bouleau', 'Arbre de nos régions, très détaillé.', null],
  'fab.megaplants-european-hornbeam': ['vegetation', 'Charme', 'Arbre de nos régions, souvent taillé en haie.', null],
  ...parTaille('veg.didelta-spinosa', 'vegetation', 'Arbuste Didelta', 'Arbuste bas et touffu.'),
  ...formes('veg.searsia-lucida', ['a', 'b', 'c', 'd', 'e', 'f', 'g'], 'vegetation', 'Arbuste Searsia', 'Arbuste persistant.', 'searsia-lucida-2k'),
  ...formes('veg.shrub-02', ['a', 'b', 'c', 'd'], 'vegetation', 'Arbuste de massif', 'Arbuste de massif.'),
  'veg.gv-free-shrubs': ['vegetation', 'Lot d’arbustes animés par le vent', 'Lot d’arbustes venu d’une bibliothèque de jeu.', null],
  'ph.shrub-01': ['vegetation', 'Arbuste n° 1', 'Arbuste photographié.', 'shrub-01-2k'],
  'ph.shrub-03': ['vegetation', 'Arbuste n° 3', 'Arbuste photographié.', 'shrub-03-2k'],
  'ph.shrub-04': ['vegetation', 'Arbuste n° 4', 'Arbuste photographié.', 'shrub-04-2k'],
  'veg.fern-02': ['vegetation', 'Fougère', 'Plante basse de sous-bois.', null],
  'veg.weed-plant-02': ['vegetation', 'Herbe folle', 'Plante basse spontanée.', null],
  'veg.celandine-01': ['vegetation', 'Ficaire (fleur jaune)', 'Petite fleur jaune de printemps.', null],
  'veg.flower-gazania': ['vegetation', 'Gazania (fleur orange)', 'Fleur de massif.', 'flower-gazania-2k'],
  'veg.flower-heliophila': ['vegetation', 'Héliophila (fleur bleue)', 'Fleur de massif.', null],
  'veg.periwinkle-plant': ['vegetation', 'Pervenche', 'Couvre-sol fleuri.', 'periwinkle-plant-2k'],
  'ph.dandelion-01': ['vegetation', 'Pissenlit', 'Petite fleur de pelouse.', null],
  'ph.moss-01': ['vegetation', 'Mousse', 'Tapis de mousse.', null],
  'mob.banc-lattes-bois-metal': ['mobilier', 'Banc à lattes, bois et métal', 'Banc public dessiné par le Studio.', null],
  'mob.banc-bois-massif': ['mobilier', 'Banc en bois massif', 'Banc dessiné par le Studio.', 'bench-bois-massif'],
  'mob.banc-assis-debout': ['mobilier', 'Appui assis-debout', 'Appui de rue dessiné par le Studio.', null],
  'mob.potelet': ['mobilier', 'Potelet', 'Potelet de trottoir dessiné par le Studio.', null],
  'mob.arceau-velo': ['mobilier', 'Arceau à vélos', 'Arceau dessiné par le Studio.', null],
  'mob.corbeille-urbaine': ['mobilier', 'Corbeille de rue', 'Corbeille dessinée par le Studio.', null],
  'mob.jardiniere-bois': ['mobilier', 'Jardinière en bois', 'Jardinière dessinée par le Studio.', null],
  'mob.parasol-terrasse': ['mobilier', 'Parasol de terrasse', 'Parasol dessiné par le Studio.', null],
  'mob.abribus-simple': ['mobilier', 'Abribus', 'Abribus dessiné par le Studio.', null],
  'mob.table-haute-ronde': ['mobilier', 'Table haute ronde', 'Table en bois photographiée.', null],
  'mob.lampadaire-urbain-01': ['mobilier', 'Lampadaire de rue', 'Lampadaire photographié.', null],
  'mob.lampadaire-bas-02': ['mobilier', 'Lampadaire bas', 'Lampadaire bas photographié.', null],
  'mob.poubelles-metal': ['mobilier', 'Poubelles en métal', 'Poubelles photographiées.', null],
  'mob.jardiniere-01': ['mobilier', 'Jardinière n° 1', 'Jardinière photographiée.', null],
  'mob.jardiniere-02': ['mobilier', 'Jardinière n° 2', 'Jardinière photographiée.', null],
  'mob.jardiniere-03': ['mobilier', 'Jardinière n° 3', 'Jardinière photographiée.', null],
  'mob.borne-incendie': ['mobilier', 'Borne incendie', 'Borne photographiée.', null],
  'mob.chaise-cafe-monobloc': ['mobilier', 'Chaise de café', 'Chaise de terrasse photographiée.', null],
  'mob.table-cafe-ronde': ['mobilier', 'Table de café ronde', 'Table de terrasse photographiée.', null],
  'mob.terrasse-coffee-table-round-01': ['mobilier', 'Table basse ronde', 'Table basse de terrasse.', null],
  'mob.terrasse-gallinera-chair': ['mobilier', 'Chaise de terrasse', 'Chaise en bois et cannage.', null],
  'mob.terrasse-gallinera-table': ['mobilier', 'Table de terrasse', 'Table assortie à la chaise de terrasse.', null],
  'mob.terrasse-mid-century-lounge-chair': ['mobilier', 'Fauteuil lounge', 'Fauteuil bas de terrasse.', null],
  'mob.terrasse-painted-wooden-bench': ['mobilier', 'Banc en bois peint', 'Banc de jardin.', 'bench-painted-wooden-polyhaven'],
  'mob.terrasse-round-wooden-table-01': ['mobilier', 'Table ronde en bois', 'Table de terrasse en bois.', null],
  'urb.banc-modulaire': ['mobilier', 'Banc modulaire', 'Assise de rue en plusieurs modules.', null],
  'urb.table-pique-nique': ['mobilier', 'Table de pique-nique', 'Table et bancs en bois.', null],
  'urb.table-chaises-exterieur': ['mobilier', 'Table et chaises d’extérieur', 'Ensemble table et chaises.', null],
  'urb.plante-en-pot-01': ['mobilier', 'Plante en pot n° 1', 'Plante en pot photographiée.', 'plant-potted-polyhaven-01'],
  'urb.plante-en-pot-02': ['mobilier', 'Plante en pot n° 2', 'Plante en pot photographiée.', 'plant-potted-polyhaven-02'],
  'urb.plante-en-pot-04': ['mobilier', 'Plante en pot n° 4', 'Plante en pot photographiée.', 'plant-potted-polyhaven-04'],
  'veh.vehicle-variety-2': ['vie', 'Voitures (lot de jeu vidéo)', 'Voitures venues d’une bibliothèque de jeu.', null],
  'fab.city-sample-vehicles': ['vie', 'Voitures (lot de 13 modèles)', 'Voitures détaillées, d’allure américaine.', null],
  'pers.rp-dennis-posed-004': ['vie', 'Personnage en pose n° 1', 'Personne scannée, en pose.', null],
  'pers.rp-fabienne-percy-posed-001': ['vie', 'Personnage en pose n° 2', 'Personne scannée, en pose.', null],
  'pers.rp-mei-posed-001': ['vie', 'Personnage en pose n° 3', 'Personne scannée, en pose.', null],
  'pers.rp-posed-00178-29': ['vie', 'Personnage (ancien modèle)', 'Ancien modèle de personnage.', null],
  'fab.renderpeople-scanned-3d-people': ['vie', 'Personnages scannés (lot)', 'Lot de personnes scannées.', null],
  'fab.metahumans': ['vie', 'Personnages très détaillés', 'Personnages numériques très réalistes.', null],
};
/** Fiches du registre volontairement absentes de la page (génériques, doublons ou intérieur). */
export const FICHES_ECARTEES = {
  'struct.geometrie-generee': 'générique : la géométrie du bâtiment, jugée matière par matière',
  'mat.pbr-paquet': 'générique', 'mat.av-generique': 'générique', 'mat.verre-maitre': 'générique', 'mat.maitre-standard-nu': 'générique',
  'mat.repli-gris': 'matériau de secours du moteur', 'struct.portes-studio': 'portes intérieures',
  'deco.potted-plant-01': 'doublon de urb.plante-en-pot-01', 'deco.potted-plant-02': 'doublon de urb.plante-en-pot-02', 'deco.potted-plant-04': 'doublon de urb.plante-en-pot-04',
  'deco.modular-street-seating': 'doublon de urb.banc-modulaire', 'deco.outdoor-table-chair-set-01': 'doublon de urb.table-chaises-exterieur', 'deco.wooden-picnic-table': 'doublon de urb.table-pique-nique',
};
/** Modèles de végétation du Studio (assets/archviz/manifest.json) → fiche du registre correspondante. */
const ARCHVIZ_VERS_REGISTRE = { 'island-tree-01-2k': 'veg.island-tree-01', 'island-tree-02-2k': 'veg.island-tree-02', 'tree-small-02-2k': 'veg.tree-small-02',
  'searsia-lucida-2k': 'veg.searsia-lucida-a', 'shrub-01-2k': 'ph.shrub-01', 'shrub-03-2k': 'ph.shrub-03', 'shrub-04-2k': 'ph.shrub-04', 'flower-gazania-2k': 'veg.flower-gazania',
  'periwinkle-plant-2k': 'veg.periwinkle-plant', 'grass-medium-01-2k': 'veg.grass-medium-01', 'grass-medium-02-2k': 'ph.grass-medium-02' };
/** Modèles de végétation du Studio sans fiche au registre. */
const ARCHVIZ_SEULS = { 'fir-tree-01-2k': 'Sapin', 'pine-sapling-small-2k': 'Jeune pin', 'nettle-plant-2k': 'Ortie', 'shrub-sorrel-01-2k': 'Arbuste oseille', 'grass-bermuda-01-2k': 'Gazon ras' };
/** Fiches d'objets que le Studio montre aussi dans sa vue 3D (en plus des modèles ci-dessus). */
const OBJETS_DU_STUDIO = ['sol.terrain', 'struct.portes-3d'];

const TEINTE_FAMILLE = { toitures: '#8c5a44', menuiseries: '#6b7785', balcons: '#7d8794', clotures: '#4a4f57', vegetation: '#5a7d3c', mobilier: '#a07c52', vie: '#6c7a92', ciel: '#9cc3e6', sols: '#9a9488', facades: '#cfc7b6' };

// ── Construction ──────────────────────────────────────────────────────────────
export function construire(studio = STUDIO_DEFAUT, site = SITE_DEFAUT) {
  const archviz = lireArchviz(studio);
  const quartier = lireQuartier(studio, archviz);
  const premium = lireBlocs(studio, 'src/core/materials/premiumLibrary.ts', 'pm');
  const regional = lireBlocs(studio, 'src/core/materials/regionalLibrary.ts', 'rg');
  const registre = JSON.parse(lire(studio, 'assets/photorealisme.json'));
  const fiches = new Map(registre.elements.map((e) => [e.id, e]));
  const essentielle = new Map(registre.categories.map((c) => [c.id, c.essentielle]));
  const manifest = JSON.parse(lire(studio, 'assets/archviz/manifest.json')).assets;
  const brief = lireBrief(site);
  const prouve = (racine, rel, motif) => { if (!lire(racine, rel).includes(motif)) throw new Error(`preuve absente : « ${motif} » dans ${rel}`); return rel; };

  const image = (dossier, nom) => (nom && existsSync(join(site, 'public', 'catalogue-exterieur', dossier, `${nom}.jpg`)) ? `/catalogue-exterieur/${dossier}/${nom}.jpg` : null);
  const apercuMatiere = (couleur, jeu) => {
    const img = jeu ? image('textures', jeu.replace(/^acg-(4k-)?/, '')) : null;
    return img ? { type: 'texture', couleur, image: img, mention: 'Photo de la texture' } : { type: 'teinte', couleur, image: null, mention: 'Aperçu indicatif' };
  };
  const apercuObjet = (famille, vignette) => {
    const img = image('elements', vignette);
    return img ? { type: 'modele', couleur: TEINTE_FAMILLE[famille], image: img, mention: 'Vignette du modèle 3D' } : { type: 'teinte', couleur: TEINTE_FAMILLE[famille], image: null, mention: 'Aperçu indicatif' };
  };

  // Choix du brief par matière av-*.
  const choixParAv = new Map();
  const ajouterChoix = (av, champ, o) => { if (!av || !o) return; choixParAv.set(av, [...(choixParAv.get(av) ?? []), { champ, valeur: String(o.valeur), libelle: o.libelle }]); };
  const versAv = (heritage) => (heritage == null ? null : heritage.startsWith('av-') ? heritage : archviz.heritage[heritage] ?? null);
  for (const o of brief.facades) {
    const av = versAv(brief.facadeVers[o.valeur]);
    if (!av) throw new Error(`brief : la façade « ${o.valeur} » ne mène à aucune matière du Studio`);
    ajouterChoix(av, 'facade', o);
  }
  for (const t of brief.teinteVers) {
    const f = brief.facades.find((o) => o.valeur === t.facade); const te = brief.teintes.find((o) => o.valeur === t.teinte);
    if (f && te) ajouterChoix(versAv(t.heritage), 'teinte', { valeur: `${t.facade}:${t.teinte}`, libelle: `${f.libelle}, teinte ${te.libelle.toLowerCase()}` });
  }
  for (const o of brief.toitures) ajouterChoix(versAv(TOITURE_MATIERE[o.valeur]), 'toiture', o);
  for (const o of brief.menuiseries) ajouterChoix(MENUISERIE_MATIERE[o.valeur], 'menuiseries', o);
  for (const o of brief.soubassements) ajouterChoix(versAv(SOUBASSEMENT_MATIERE[o.valeur]), 'soubassement', { ...o, libelle: `Soubassement ${o.libelle.toLowerCase()}` });

  // Verdict d'une matière : la règle de la garde.
  const fichesMatiere = registre.elements.filter((e) => e.type === 'materiau' && Array.isArray(e.motifs));
  const ficheDeLInstance = (instance) => {
    const chemin = `/game/mimmozia/materials/instances/${instance}`;
    let meilleure = null; let score = -1;
    for (const e of fichesMatiere) for (const m of e.motifs) if (correspond(m, chemin)) { const s = m.replace(/\*/g, '').length; if (s > score) { score = s; meilleure = e; } }
    return meilleure;
  };
  const GENERIQUES = ['mat.av-generique', 'mat.pbr-paquet', 'mat.maitre-standard-nu'];
  const renduMatiere = (instance, jeuDeclare) => {
    const fiche = ficheDeLInstance(instance);
    const jeu = /cartes ([a-z0-9-]+)/.exec(fiche?.source ?? '')?.[1] ?? jeuDeclare;
    const ref = fiche && !GENERIQUES.includes(fiche.id) ? fiche.id : null;
    if (fiche && !fiche.verdictParTextures) {
      if (fiche.verdict === 'oui') return { rendu: 'oui', note: 'Matière unie validée pour les images.', ref, jeu };
      if (fiche.verdict === 'partiel') return { rendu: 'reserve', note: 'Validée avec réserve pour les images.', ref, jeu };
      return { rendu: 'reserve', note: 'Apparaît dans les images, mais pas encore validée.', ref, jeu };
    }
    if (!jeu) return { rendu: 'reserve', note: 'Apparaît dans les images en teinte unie : pas encore validée (ni texture photo, ni fiche propre).', ref, jeu };
    const tex = fiches.get(`tex.${jeu}`);
    const refFinale = ref ?? tex?.id ?? null;
    if (tex?.verdict === 'oui') return { rendu: 'oui', note: 'Texture photo validée pour les images.', ref: refFinale, jeu };
    if (tex?.verdict === 'partiel') return { rendu: 'reserve', note: 'Texture photo validée, un peu floue en très gros plan.', ref: refFinale, jeu };
    if (tex?.verdict === 'non') return { rendu: 'reserve', note: 'Apparaît dans les images, mais sa texture est dessinée par programme (ce n’est pas une photo) : non validée.', ref: refFinale, jeu };
    return { rendu: 'reserve', note: 'Apparaît dans les images, mais sa texture n’est pas encore validée.', ref: refFinale, jeu };
  };

  const entrees = [];
  const pousser = (e) => entrees.push({ choixBrief: [], refStudio: null, refRegistre: null, ...e });
  const SRC_AV = 'mimmozia-studio/src/core/materials/archvizLibrary.ts';
  const SRC_REG = 'mimmozia-studio/assets/photorealisme.json';
  const SRC_BRIEF = 'mimmoza-front-v2/src/spaces/copilot/studio3d/briefCreatif.ts';

  // 1. Matières av-* d'extérieur.
  for (const m of archviz.matieres) {
    if (m.categorie === 'intérieur') continue;
    const [famille, application] = familleAv(m);
    const choix = choixParAv.get(m.id) ?? [];
    const r = m.categorie === 'végétation'
      ? { rendu: 'non', note: 'Sert à la vue 3D du Studio. Dans les images, la végétation vient de modèles 3D photographiés.', ref: null, jeu: m.jeu }
      : renduMatiere(`mi_${m.id.replace(/-/g, '_')}`, m.jeu);
    pousser({ id: `mat:${m.id}`, famille, nature: 'matiere', nom: NOMS_AV[m.id] ?? typo(m.nom), description: typo(premierePhrase(m.description || `${m.nom}.`)), application,
      apercu: apercuMatiere(m.couleur, r.jeu ?? m.jeu), chat: choix.length ? 'propose' : 'non', choixBrief: choix, studio: true, rendu: r.rendu, noteRendu: r.note,
      refStudio: m.id, refRegistre: r.ref, sources: [SRC_AV, ...(r.ref ? [SRC_REG] : []), ...(choix.length ? [SRC_BRIEF] : [])] });
  }
  for (const av of choixParAv.keys()) if (!entrees.some((e) => e.refStudio === av)) throw new Error(`brief : la matière ${av} n’existe pas dans la bibliothèque du Studio`);

  // 2. Matières de rue et de quartier qm-*.
  for (const q of quartier.propres) {
    const famille = q.emplacements.some((e) => e.startsWith('facade') || e === 'soubassement') ? 'facades' : 'sols';
    let r = renduMatiere(`mi_${q.id.replace(/-/g, '_')}`, null);
    if (q.id === 'qm-eau') { const f = fiches.get('mat.qm-eau'); r = { rendu: f?.certifie ? 'oui' : 'non', note: f?.certifie ? 'Validée pour les images.' : 'Pas encore validée : l’eau est masquée des images.', ref: f ? f.id : null, jeu: null }; }
    pousser({ id: `mat:${q.id}`, famille, nature: 'matiere', nom: typo(q.nom), description: famille === 'sols' ? 'Matière des rues et des abords du quartier.' : 'Matière de façade des bâtiments de quartier.',
      application: `Quartier : ${q.emplacements.map((e) => EMPLACEMENTS[e] ?? e).join(', ') || 'abords'}`, apercu: apercuMatiere(q.couleur, r.jeu), chat: 'non', studio: true,
      rendu: r.rendu, noteRendu: r.note, refStudio: q.id, refRegistre: r.ref, sources: ['mimmozia-studio/src/core/quartier/materiaux/catalogue.ts', ...(r.ref ? [SRC_REG] : [])] });
  }

  // 3. Matières nobles et régionales (présentes dans le Studio, sans fiche de validation propre).
  const NOTE_SANS_FICHE = 'Disponible dans le Studio. Apparaîtrait dans une image si on la choisit, mais elle n’a pas encore été validée.';
  for (const [liste, rel, gamme] of [[premium, 'premiumLibrary.ts', 'Matière noble'], [regional, 'regionalLibrary.ts', 'Matière régionale']]) {
    if (liste.length < 10) throw new Error(`${rel} : lecture incomplète (format changé ?)`);
    for (const m of liste) {
      const famille = /tuile|ardoise|zinc|cuivre/i.test(m.nom) ? 'toitures' : /balcon/i.test(m.nom) ? 'balcons' : /^(pm-aluminium|pm-verre)$/.test(m.id) ? 'menuiseries' : 'facades';
      const homonyme = archviz.matieres.some((a) => a.nom === m.nom) || (gamme === 'Matière régionale' && premium.some((a) => a.nom === m.nom));
      pousser({ id: `mat:${m.id}`, famille, nature: 'matiere', nom: typo(homonyme ? `${m.nom} (${gamme === 'Matière noble' ? 'finition noble' : 'régionale'})` : m.nom), description: `${gamme} de la bibliothèque du Studio.`,
        application: famille === 'toitures' ? 'Couverture et zinguerie' : famille === 'balcons' ? 'Balcons et galeries en bois' : famille === 'menuiseries' ? 'Fenêtres et vitrages' : 'Murs de façade',
        apercu: apercuMatiere(m.couleur, null), chat: 'non', studio: true, rendu: 'reserve', noteRendu: NOTE_SANS_FICHE, refStudio: m.id, sources: [`mimmozia-studio/src/core/materials/${rel}`] });
    }
  }

  // 4. Matières des bâtiments contemporains de quartier (posées au rendu).
  const RELC = 'unreal/mimmozia/materiaux_contemporains.py';
  for (const [cle, nom, desc, couleur, jeu] of [
    ['bois_lames', 'Lames de bois (bardage, brise-soleil, pergolas)', 'Lames de bois des bâtiments contemporains.', '#7a5b38', 'wood046'],
    ['pierre_panneau', 'Pierre calcaire en grands panneaux', 'Parement de pierre à joints creux.', '#cbc2ae', 'marble012'],
    ['brique_sombre', 'Plaquettes de brique anthracite', 'Brique sombre des soubassements contemporains.', '#3f3b3a', 'acg-4k-bricks015'],
    ['composite', 'Panneaux d’aluminium laqué anthracite', 'Cadres, bavettes et habillages métalliques.', '#383e42', null],
    ['marbre', 'Marbre sombre veiné', 'Parement grand format de la villa contemporaine.', '#3a3a3c', 'marble006'],
    ['beton_banche', 'Béton banché', 'Béton coulé en place, avec la trace des banches.', '#a4a29d', 'concrete047a'],
  ]) {
    prouve(studio, RELC, `\`\`${cle}\`\``);
    const tex = jeu ? fiches.get(`tex.${jeu}`) : null;
    const rendu = tex?.verdict === 'oui' ? 'oui' : 'reserve';
    pousser({ id: `mat:contemporain-${cle.replace(/_/g, '-')}`, famille: 'facades', nature: 'matiere', nom, description: desc, application: 'Bâtiments contemporains de quartier',
      apercu: apercuMatiere(couleur, jeu), chat: 'non', studio: true, rendu, refStudio: cle, refRegistre: tex?.id ?? null,
      noteRendu: rendu === 'oui' ? 'Texture photo validée pour les images.' : jeu ? 'Apparaît dans les images, mais sa texture n’est pas encore validée.' : 'Apparaît dans les images en teinte unie.',
      sources: [`mimmozia-studio/${RELC}`, ...(tex ? [SRC_REG] : [])] });
  }

  // 5. Éléments d'architecture (formes), prouvés par le type du Studio ou par le brief.
  const TYPES = 'src/core/architecture/types.ts';
  const typeStudio = (valeur) => `mimmozia-studio/${prouve(studio, TYPES, `'${valeur}'`)}`;
  const opt = (liste, valeur) => { const o = liste.find((x) => String(x.valeur) === valeur); if (!o) throw new Error(`brief : valeur ${valeur} absente`); return o; };
  const OUI_CHAT = 'Choisi dans le chat, dessiné par le Studio et repris dans les images.';
  const STUDIO_SEUL = 'Dessiné par le Studio et envoyé tel quel au rendu. Non proposé dans le chat ; pas encore vérifié sur une image livrée.';
  const element = (id, famille, nom, description, application, extra) => pousser({ id: `elt:${id}`, famille, nature: 'element', nom, description, application,
    apercu: { type: 'teinte', couleur: TEINTE_FAMILLE[famille], image: null, mention: 'Aperçu indicatif' }, chat: 'non', studio: true, rendu: 'reserve', noteRendu: STUDIO_SEUL, sources: [], ...extra });
  const duChat = (champ, liste, valeurs, ref = null) => {
    const choix = valeurs.map((v) => { const o = opt(liste, v); if (!o.disponible) throw new Error(`brief : ${champ}=${v} n’est plus disponible — revoir son statut`); return { champ, valeur: v, libelle: o.libelle }; });
    return { chat: 'propose', choixBrief: choix, rendu: 'oui', noteRendu: OUI_CHAT, refStudio: ref, sources: [SRC_BRIEF, ...(ref ? [typeStudio(ref)] : [])] };
  };
  const duStudio = (ref) => ({ refStudio: ref, sources: [typeStudio(ref)] });
  const bientot = (titre, option, studioVisible, extra = {}) => {
    const b = brief.bientot.find((x) => x.titre === titre);
    if (!b || !b.options.includes(option)) throw new Error(`brief : « ${option} » n’est plus annoncé « bientôt » (${titre})`);
    return { chat: 'bientot', studio: studioVisible, rendu: 'non', noteRendu: 'Annoncé « bientôt » dans le chat : pas encore rendu.', sources: [SRC_BRIEF], ...extra };
  };

  const DESC_STYLE = { contemporain: 'Volumes nets, fenêtres régulières : le dessin de base du Studio.', haussmannien: 'Pierre de taille, balcons filants, toit à la Mansart.', art_deco: 'Verticalité marquée, bandeaux, couronnement en gradins.' };
  for (const s of brief.styles) element(`style-${s.valeur.replace(/_/g, '-')}`, 'facades', `Style ${s.libelle.toLowerCase()}`, DESC_STYLE[s.valeur] ?? s.detail, 'Tout le bâtiment',
    s.disponible ? { chat: 'propose', choixBrief: [{ champ: 'style', valeur: s.valeur, libelle: s.libelle }], rendu: 'oui', noteRendu: 'C’est le dessin appliqué à chaque projet.', sources: [SRC_BRIEF] }
      : { chat: 'bientot', studio: false, rendu: 'non', noteRendu: 'Annoncé « bientôt » dans le chat : prévu, mais pas encore appliqué ni rendu.', sources: [SRC_BRIEF] });
  element('soubassement', 'facades', 'Soubassement (bandeau de 60 cm)', 'Bandeau en pied de façade, en pierre, béton ou brique.', 'Pied de façade', duChat('soubassement', brief.soubassements, ['pierre', 'beton', 'brique']));

  element('toit-terrasse', 'toitures', 'Toit-terrasse', 'Toit plat bordé d’un petit mur (acrotère).', 'Dernier niveau', duChat('toiture', brief.toitures, ['terrasse'], 'flat-parapet'));
  element('toit-vegetalise', 'toitures', 'Toit-terrasse végétalisé', 'Terrasse plantée de sedum.', 'Dernier niveau', duChat('toiture', brief.toitures, ['vegetalisee'], 'flat-green'));
  element('toit-deux-pans', 'toitures', 'Toit à deux pans', 'Deux versants à 35°, en tuiles, ardoise ou zinc.', 'Dernier niveau', duChat('toiture', brief.toitures, ['deux_pans_tuiles', 'deux_pans_ardoise', 'deux_pans_zinc'], 'gable'));
  element('attique', 'toitures', 'Attique (dernier étage en retrait)', 'Un étage en retrait ajouté au sommet.', 'Dernier niveau', duChat('attique', brief.attiques, ['true'], 'attic-flat'));
  element('toit-quatre-pans', 'toitures', 'Toit à quatre pans', 'Quatre versants qui se rejoignent au faîtage.', 'Dernier niveau', duStudio('hip'));
  element('toit-un-pan', 'toitures', 'Toit à un pan', 'Un seul versant incliné.', 'Dernier niveau', duStudio('monopitch'));
  element('toit-mansart', 'toitures', 'Toit à la Mansart', 'Toit brisé, typique des immeubles haussmanniens.', 'Dernier niveau', duStudio('mansard'));
  element('toit-sheds', 'toitures', 'Toit en dents de scie (sheds)', 'Suite de petits versants, façon atelier.', 'Dernier niveau', duStudio('sheds'));
  element('toit-ailes', 'toitures', 'Toits des bâtiments en L, en T ou en U', 'Les versants de chaque aile se rejoignent proprement (noues et arêtiers calculés).', 'Bâtiments à plusieurs ailes',
    { refStudio: 'RoofGenerator', sources: [`mimmozia-studio/${prouve(studio, 'src/core/architecture/RoofGenerator.ts', 'noues et arêtiers calculés')}`] });

  element('fenetres-verticales', 'menuiseries', 'Fenêtres verticales', 'Fenêtres hautes et étroites.', 'Toutes les façades', duChat('ouvertures', brief.ouvertures, ['fenetres_verticales'], 'vertical'));
  element('baies-vitrees', 'menuiseries', 'Baies vitrées', 'Grandes baies du sol au plafond.', 'Toutes les façades', duChat('ouvertures', brief.ouvertures, ['baies_vitrees'], 'bay'));
  element('fenetres-bandeau', 'menuiseries', 'Fenêtres en bandeau', 'Fenêtres larges et basses.', 'Toutes les façades', duChat('ouvertures', brief.ouvertures, ['fenetres_horizontales'], 'horizontal'));
  element('vitrines', 'menuiseries', 'Vitrines de commerces', 'Grandes vitrines au rez-de-chaussée.', 'Rez-de-chaussée', duChat('rdc', brief.rdcs, ['commerces']));
  element('fenetre-simple', 'menuiseries', 'Fenêtre simple', 'Fenêtre à un vantail.', 'Façades', duStudio('simple'));
  element('fenetre-double', 'menuiseries', 'Fenêtre double', 'Fenêtre à deux vantaux.', 'Façades', duStudio('double'));
  element('porte-fenetre', 'menuiseries', 'Porte-fenêtre', 'Fenêtre qui descend jusqu’au sol.', 'Façades, balcons', duStudio('french'));
  element('mur-rideau', 'menuiseries', 'Mur-rideau', 'Façade entièrement vitrée, d’un plancher à l’autre.', 'Façades vitrées', duStudio('curtain-wall'));
  element('entree-a-fleur', 'menuiseries', 'Entrée à fleur de façade', 'Porte d’entrée dans le plan de la façade.', 'Rez-de-chaussée', duStudio('flush'));
  if (opt(brief.rdcs, 'hall').disponible) throw new Error('brief : le hall d’entrée est devenu disponible — revoir son statut');
  element('hall', 'menuiseries', 'Hall d’entrée', 'Hall vitré au rez-de-chaussée.', 'Rez-de-chaussée', { chat: 'bientot', studio: false, rendu: 'non', noteRendu: 'Annoncé « bientôt » dans le chat : pas encore dessiné.', sources: [SRC_BRIEF] });
  for (const [id, ref, nom, option, desc] of [['entree-renfoncee', 'recessed', 'Entrée renfoncée', 'Renfoncée', 'Porte d’entrée en retrait de la façade.'], ['porche', 'porch', 'Porche', 'Porche', 'Entrée abritée sous un porche.'], ['auvent', 'canopy', 'Auvent', 'Auvent', 'Petite avancée au-dessus de l’entrée.']])
    element(id, 'menuiseries', nom, desc, 'Rez-de-chaussée', bientot('Entrée de l’immeuble', option, true, { refStudio: ref, sources: [SRC_BRIEF, typeStudio(ref)], noteRendu: 'Annoncé « bientôt » dans le chat. Le Studio sait la dessiner, mais elle n’est pas encore rendue.' }));
  element('volets', 'menuiseries', 'Volets', 'Volets battants ou coulissants.', 'Fenêtres', bientot('Volets ou brise-soleil', 'Volets', false, { noteRendu: 'Annoncé « bientôt » dans le chat : le Studio ne les dessine pas encore.' }));
  element('brise-soleil', 'menuiseries', 'Brise-soleil', 'Lames qui protègent du soleil.', 'Fenêtres', bientot('Volets ou brise-soleil', 'Brise-soleil', false, { noteRendu: 'Annoncé « bientôt » dans le chat : le Studio ne les dessine pas encore.' }));

  element('balcons', 'balcons', 'Balcons', 'Un balcon par fenêtre, sauf aux angles.', 'Façades', duChat('balcons', brief.balcons, ['balcons'], 'individual'));
  element('balcons-filants', 'balcons', 'Balcons filants', 'Un balcon continu sur toute la façade.', 'Façades', duChat('balcons', brief.balcons, ['balcons_filants'], 'running'));
  element('loggias', 'balcons', 'Loggias', 'Terrasses creusées dans la façade.', 'Façades', duChat('balcons', brief.balcons, ['loggias'], 'loggia'));
  element('garde-corps-metal', 'balcons', 'Garde-corps en métal', 'Barreaux verticaux en acier.', 'Balcons, loggias', duChat('garde_corps', brief.gardeCorps, ['metal'], 'metal'));
  element('garde-corps-verre', 'balcons', 'Garde-corps en verre', 'Vitrage clair.', 'Balcons, loggias', duChat('garde_corps', brief.gardeCorps, ['verre'], 'glass'));
  element('garde-corps-plein', 'balcons', 'Garde-corps plein', 'Petit mur plein (allège).', 'Balcons, loggias', duChat('garde_corps', brief.gardeCorps, ['plein'], 'solid'));
  element('avant-corps', 'balcons', 'Avant-corps', 'Partie de façade qui avance.', 'Façades', duStudio('avant-corps'));
  element('bow-window', 'balcons', 'Bow-window', 'Fenêtre en saillie.', 'Façades', duStudio('bow-window'));
  element('renfoncement', 'balcons', 'Renfoncement', 'Partie de façade en retrait.', 'Façades', duStudio('renfoncement'));

  // Clôtures : dans le décor du rendu, sans fiche au registre (la garde masque ce qu'elle ne connaît pas).
  const BL = 'unreal/mimmozia/build_level.py';
  if (registre.politique.inconnu !== 'omettre') throw new Error('registre : la politique « inconnu » a changé — revoir le statut des clôtures');
  if (registre.elements.some((e) => /cl[oô]ture|portail/i.test(JSON.stringify([e.id, e.acteurs ?? [], e.motifs ?? []])))) throw new Error('registre : une fiche de clôture existe désormais — revoir leur statut');
  const NOTE_CLOTURE = 'Dessinée dans le décor de rendu, mais sans fiche de validation : la règle « photoréaliste ou rien » la masque des images.';
  for (const [id, nom, desc, motif] of [['cloture-rue', 'Clôture sur rue : muret et grille', 'Muret enduit surmonté d’une grille à barreaux.', 'muret enduit 40 cm'],
    ['cloture-barreaudage', 'Clôture à barreaux', 'Grille à barreaux sur les limites du terrain.', 'barreaudage seul'], ['portail', 'Portail à deux vantaux', 'Portail à barreaux entre deux piliers.', 'portail à deux vantaux']])
    element(id, 'clotures', nom, desc, 'Limites du terrain', { studio: false, rendu: 'non', noteRendu: NOTE_CLOTURE, sources: [`mimmozia-studio/${prouve(studio, BL, motif)}`] });
  element('cloture-photo', 'clotures', 'Clôture existante refaite d’après la photo', 'La grille visible sur une photo de rue est reconstruite en 3D à ses mesures.', 'Photomontages d’extension de maison',
    { studio: false, rendu: 'reserve', noteRendu: 'Utilisée seulement dans les photomontages (maison existante), pas dans les images de projets neufs.', sources: [`mimmozia-studio/${prouve(studio, 'src/core/extension/cloture3d.ts', 'CLÔTURE REMODÉLISÉE EN 3D')}`] });

  // Ambiances lumineuses du brief.
  prouve(studio, 'docs/vis/COORDINATION.md', 'nuit hors périmètre image');
  for (const a of brief.ambiances) element(`ambiance-${a.valeur.replace(/_/g, '-')}`, 'ciel', `Lumière : ${a.libelle.toLowerCase()}`, a.detail, 'Toute l’image',
    { chat: 'propose', choixBrief: [{ champ: 'ambiance', valeur: a.valeur, libelle: a.libelle }], rendu: a.valeur === 'nuit' ? 'reserve' : 'oui', sources: [SRC_BRIEF, ...(a.valeur === 'nuit' ? ['mimmozia-studio/docs/vis/COORDINATION.md'] : [])],
      noteRendu: a.valeur === 'nuit' ? 'Disponible pour le film et la visite ; pas encore pour les images fixes.' : 'Choisie dans le chat et reprise dans les images.' });

  // 6. Objets du registre (végétation, mobilier, voitures, personnages, ciel…).
  const studioParFiche = new Map(Object.entries(ARCHVIZ_VERS_REGISTRE).map(([a, f]) => [f, a]));
  const idsManifest = new Set(manifest.map((a) => a.id));
  for (const a of [...Object.keys(ARCHVIZ_VERS_REGISTRE), ...Object.keys(ARCHVIZ_SEULS)]) if (!idsManifest.has(a)) throw new Error(`Studio : modèle ${a} absent de assets/archviz/manifest.json`);
  const exterieures = registre.elements.filter((e) => !e.categorie.startsWith('interieur') && e.categorie !== 'technique' && e.type !== 'texture');
  for (const e of exterieures) {
    if (e.id.startsWith('mat.qm-')) { const qm = e.id.slice(4); if (!QM_PROPRES.includes(qm) && !quartier.jumelles[qm]) throw new Error(`registre : ${e.id} n’est rattachée à aucune matière du catalogue`); continue; }
    if (FICHES_ECARTEES[e.id]) continue;
    const o = OBJETS[e.id];
    if (!o) throw new Error(`registre : la fiche extérieure ${e.id} n’a pas de nom dans le catalogue (OBJETS) — l’ajouter, ou l’écarter (FICHES_ECARTEES)`);
    const [famille, nom, description, vignette] = o;
    const ess = essentielle.get(e.categorie) === true;
    const rendu = e.verdict === 'oui' ? 'oui' : e.verdict === 'partiel' ? 'reserve' : ess ? 'reserve' : 'non';
    const note = e.verdict === 'oui' ? 'Validé pour les images.' : e.verdict === 'partiel' ? 'Validé avec réserve : moins net en très gros plan.'
      : ess ? (e.verdict === 'non' ? 'Refusé à la validation : s’il se retrouve dans une image, celle-ci est signalée.' : 'Pas encore validé : s’il est utilisé, l’image est signalée.')
        : e.verdict === 'non' ? 'Écarté : pas assez réaliste, il est masqué des images.' : 'En attente de validation : masqué des images pour l’instant.';
    const dansStudio = studioParFiche.has(e.id) || OBJETS_DU_STUDIO.includes(e.id);
    pousser({ id: `obj:${e.id}`, famille, nature: 'element', nom, description, application: registre.categories.find((c) => c.id === e.categorie)?.libelle ?? e.categorie,
      apercu: apercuObjet(famille, vignette), chat: 'non', studio: dansStudio, rendu, noteRendu: note, refStudio: studioParFiche.get(e.id) ?? null, refRegistre: e.id,
      sources: [SRC_REG, ...(studioParFiche.has(e.id) ? ['mimmozia-studio/assets/archviz/manifest.json'] : [])] });
  }
  for (const id of Object.keys(OBJETS)) if (!fiches.has(id)) throw new Error(`catalogue : ${id} n’existe plus dans le registre`);

  // 7. Végétation visible dans le Studio seulement (pas de fiche au registre → masquée des images).
  for (const [a, nom] of Object.entries(ARCHVIZ_SEULS)) pousser({ id: `obj:studio.${a}`, famille: 'vegetation', nature: 'element', nom, description: 'Modèle de végétation de la bibliothèque du Studio.',
    application: 'Jardins et abords, dans le Studio', apercu: apercuObjet('vegetation', a), chat: 'non', studio: true, rendu: 'non',
    noteRendu: 'Visible dans le Studio, mais sans fiche de validation : masqué des images.', refStudio: a, sources: ['mimmozia-studio/assets/archviz/manifest.json'] });

  const ordre = new Map(FAMILLES.map((f, i) => [f.id, i]));
  const rangChat = { propose: 0, non: 1, bientot: 2 };
  const rangRendu = { oui: 0, reserve: 1, non: 2 };
  const trie = entrees.map((e, i) => [e, i]).sort(([a, i], [b, j]) => ordre.get(a.famille) - ordre.get(b.famille) || rangChat[a.chat] - rangChat[b.chat]
    || (a.nature === b.nature ? 0 : a.nature === 'matiere' ? -1 : 1) || rangRendu[a.rendu] - rangRendu[b.rendu] || i - j).map(([e]) => e);
  const ids = new Set();
  for (const e of trie) { if (ids.has(e.id)) throw new Error(`identifiant en double : ${e.id}`); ids.add(e.id); }
  const textures = registre.elements.filter((e) => e.type === 'texture' && !e.categorie.startsWith('interieur'));
  return { entrees: trie, misAJourRegistre: registre.misAJourLe, textures: { total: textures.length, certifiees: textures.filter((t) => t.certifie).length } };
}

// ── Écriture du module ────────────────────────────────────────────────────────
export function ecrireModule({ entrees, misAJourRegistre }) {
  const q = (v) => JSON.stringify(v);
  const ligne = (e) => `  { id: ${q(e.id)}, famille: ${q(e.famille)}, nature: ${q(e.nature)}, nom: ${q(e.nom)}, description: ${q(e.description)}, application: ${q(e.application)},\n    apercu: ${q(e.apercu)}, chat: ${q(e.chat)}, choixBrief: ${q(e.choixBrief)}, studio: ${q(e.studio)}, rendu: ${q(e.rendu)},\n    noteRendu: ${q(e.noteRendu)}, refStudio: ${q(e.refStudio)}, refRegistre: ${q(e.refRegistre)}, sources: ${q(e.sources)} },`;
  return `// ${MODULE}
// =============================================================================
// VIS-24 — CATALOGUE EXTÉRIEUR : matières et éléments 3D d'extérieur, avec un statut honnête.
// FICHIER GÉNÉRÉ par scripts/generer-catalogue-exterieur.mjs — ne pas le modifier à la main :
//     node scripts/generer-catalogue-exterieur.mjs ..\\mimmozia-studio
// Sources relues à chaque génération (détail dans l'en-tête du script) : bibliothèques de matières du Studio,
// types d'architecture du Studio, registre photoréalisme du ${misAJourRegistre} (assets/photorealisme.json),
// brief du chat (briefCreatif.ts). Module PUR : aucune dépendance (ni React, ni I/O).
//
// Lecture des trois statuts d'une entrée :
//   chat   : 'propose' = au choix dans le chat ; 'bientot' = annoncé « bientôt » ; 'non' = pas proposé dans le chat ;
//   studio : vrai = visible dans le Studio 3D ;
//   rendu  : 'oui' = repris dans les images rendues ; 'reserve' = repris avec une réserve (voir noteRendu) ;
//            'non' = pas encore rendu (masqué des images, ou pas encore dessiné).
// =============================================================================

export type FamilleExterieur = ${FAMILLES.map((f) => q(f.id)).join(' | ')};
export type NatureEntree = 'matiere' | 'element';
export type StatutChat = 'propose' | 'bientot' | 'non';
export type StatutRendu = 'oui' | 'reserve' | 'non';

export interface ApercuEntree {
  /** 'texture' = photo de la vraie texture ; 'modele' = vignette du vrai modèle 3D ; 'teinte' = simple pastille de couleur (aperçu indicatif). */
  readonly type: 'texture' | 'modele' | 'teinte';
  /** Teinte déclarée par le Studio (matières) ou teinte neutre de la famille (éléments). */
  readonly couleur: string;
  /** Adresse d'une image servie par le site (public/catalogue-exterieur/), ou null. */
  readonly image: string | null;
  readonly mention: string;
}

export interface ChoixBriefCatalogue {
  /** Champ du brief d'habillage (briefCreatif.ts) : facade, teinte, toiture, menuiseries, garde_corps, balcons, ouvertures, soubassement, attique, rdc, ambiance, style. */
  readonly champ: string;
  /** Valeur du champ ; pour « teinte », la forme est « facade:teinte » (ex. « brique:claire »). */
  readonly valeur: string;
  readonly libelle: string;
}

export interface EntreeCatalogueExterieur {
  readonly id: string;
  readonly famille: FamilleExterieur;
  readonly nature: NatureEntree;
  readonly nom: string;
  readonly description: string;
  /** Où ça s'applique, en clair. */
  readonly application: string;
  readonly apercu: ApercuEntree;
  readonly chat: StatutChat;
  /** Choix du brief du chat qui mènent à cette entrée (vide si le chat ne la propose pas). */
  readonly choixBrief: readonly ChoixBriefCatalogue[];
  readonly studio: boolean;
  readonly rendu: StatutRendu;
  /** Une phrase simple qui explique le statut de rendu. */
  readonly noteRendu: string;
  /** Identifiant technique côté Studio (av-…, qm-…, type de toit, modèle 3D…), ou null. */
  readonly refStudio: string | null;
  /** Fiche du registre photoréalisme qui justifie le statut de rendu, ou null. */
  readonly refRegistre: string | null;
  /** Fichiers qui prouvent l'entrée. */
  readonly sources: readonly string[];
}

export interface FamilleCatalogue { readonly id: FamilleExterieur; readonly libelle: string; readonly description: string }

export const DATE_REGISTRE_PHOTOREALISME = ${q(misAJourRegistre)};

export const FAMILLES_EXTERIEUR: readonly FamilleCatalogue[] = [
${FAMILLES.map((f) => `  { id: ${q(f.id)}, libelle: ${q(f.libelle)}, description: ${q(f.description)} },`).join('\n')}
];

export const LIBELLES_RENDU: Readonly<Record<StatutRendu, { readonly libelle: string; readonly explication: string }>> = {
  oui: { libelle: 'Repris dans les images', explication: 'Validé : il apparaît tel quel dans les images rendues.' },
  reserve: { libelle: 'Repris avec réserve', explication: 'Il apparaît dans les images, avec une limite expliquée sur sa fiche (teinte unie, texture non validée, gros plan…).' },
  non: { libelle: 'Pas encore rendu', explication: 'Il existe, mais il n’apparaît pas encore dans les images : pas encore validé, écarté, ou pas encore dessiné.' },
};
export const LIBELLES_CHAT: Readonly<Record<StatutChat, { readonly libelle: string; readonly explication: string }>> = {
  propose: { libelle: 'Au choix dans le chat', explication: 'Vous pouvez le demander à l’étape « Style et habillage ».' },
  bientot: { libelle: 'Bientôt dans le chat', explication: 'Annoncé dans le chat, pas encore disponible.' },
  non: { libelle: 'Pas dans le chat', explication: 'Il existe dans le Studio ou dans le décor, sans choix dans le chat pour l’instant.' },
};
export const LIBELLE_STUDIO = { libelle: 'Visible dans le Studio', explication: 'Vous pouvez le voir dans le Studio 3D.' } as const;

export const CATALOGUE_EXTERIEUR: readonly EntreeCatalogueExterieur[] = [
${entrees.map(ligne).join('\n')}
];

// ── Aides (pures) ─────────────────────────────────────────────────────────────
export interface FiltreCatalogue {
  readonly famille?: FamilleExterieur | null;
  readonly rendu?: StatutRendu | null;
  readonly chat?: StatutChat | null;
  readonly studio?: boolean | null;
  readonly texte?: string | null;
}

/** Minuscules sans accents, pour la recherche. */
export const normaliserTexte = (t: string): string => t.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/[’']/g, ' ').toLowerCase().trim();

/**
 * VIS-31 — mots de la recherche : sans accents ni casse, coupés sur tout ce qui n'est ni lettre ni chiffre
 * (« garde-corps », « d’eau »). Un mot cherché doit COMMENCER un mot de l'entrée (« arbre » ne trouve plus « marbre »),
 * au singulier (« tuiles » trouve « tuile »).
 */
export const motsRecherche = (t: string): string[] => normaliserTexte(t).split(/[^a-z0-9]+/).filter(Boolean);
const singulier = (m: string): string => (m.length > 3 && /[sx]$/.test(m) ? m.slice(0, -1) : m);

export function filtrerCatalogue(filtre: FiltreCatalogue, entrees: readonly EntreeCatalogueExterieur[] = CATALOGUE_EXTERIEUR): EntreeCatalogueExterieur[] {
  const mots = motsRecherche(filtre.texte ?? '').map(singulier);
  return entrees.filter((e) => {
    if (filtre.famille && e.famille !== filtre.famille) return false;
    if (filtre.rendu && e.rendu !== filtre.rendu) return false;
    if (filtre.chat && e.chat !== filtre.chat) return false;
    if (filtre.studio != null && e.studio !== filtre.studio) return false;
    if (!mots.length) return true;
    const foin = motsRecherche([e.nom, e.description, e.application, ...e.choixBrief.map((c) => c.libelle)].join(' '));
    return mots.every((m) => foin.some((f) => f.startsWith(m)));
  });
}

export const entreesDeLaFamille = (famille: FamilleExterieur): EntreeCatalogueExterieur[] => CATALOGUE_EXTERIEUR.filter((e) => e.famille === famille);

/** Entrées auxquelles mène un choix du brief (ex. champ 'facade', valeur 'brique'). */
export const entreesDuChoix = (champ: string, valeur: string): EntreeCatalogueExterieur[] =>
  CATALOGUE_EXTERIEUR.filter((e) => e.choixBrief.some((c) => c.champ === champ && c.valeur === valeur));

// ── Adresse de la page (ouverte dans un nouvel onglet) ─────────────────────────
export const ROUTE_CATALOGUE_EXTERIEUR = '/mimmozia/catalogue-exterieur';

const estFamille = (v: string | null): v is FamilleExterieur => FAMILLES_EXTERIEUR.some((f) => f.id === v);
const estRendu = (v: string | null): v is StatutRendu => v === 'oui' || v === 'reserve' || v === 'non';

/** Adresse de la page, éventuellement déjà filtrée (ex. { famille: 'toitures' }). */
export function adresseCatalogueExterieur(filtre: FiltreCatalogue = {}): string {
  const p = new URLSearchParams();
  if (filtre.famille) p.set('famille', filtre.famille);
  if (filtre.rendu) p.set('rendu', filtre.rendu);
  if (filtre.chat === 'propose') p.set('chat', '1');
  if (filtre.studio === true) p.set('studio', '1');
  if (filtre.texte && filtre.texte.trim()) p.set('q', filtre.texte.trim());
  const s = p.toString();
  return s ? \`\${ROUTE_CATALOGUE_EXTERIEUR}?\${s}\` : ROUTE_CATALOGUE_EXTERIEUR;
}

/** Filtre lu dans la partie « ?… » de l'adresse ; les valeurs inconnues sont ignorées. */
export function filtreDepuisAdresse(recherche: string): FiltreCatalogue {
  const p = new URLSearchParams(recherche);
  const famille = p.get('famille'); const rendu = p.get('rendu');
  return {
    famille: estFamille(famille) ? famille : null,
    rendu: estRendu(rendu) ? rendu : null,
    chat: p.get('chat') === '1' ? 'propose' : null,
    studio: p.get('studio') === '1' ? true : null,
    texte: p.get('q') ?? '',
  };
}

export interface DecompteCatalogue {
  readonly total: number; readonly matieres: number; readonly elements: number;
  readonly chat: number; readonly bientot: number; readonly studio: number;
  readonly rendu: Readonly<Record<StatutRendu, number>>;
}

export function compterCatalogue(entrees: readonly EntreeCatalogueExterieur[] = CATALOGUE_EXTERIEUR): DecompteCatalogue {
  const rendu = { oui: 0, reserve: 0, non: 0 };
  let matieres = 0; let chat = 0; let bientot = 0; let studio = 0;
  for (const e of entrees) {
    rendu[e.rendu] += 1;
    if (e.nature === 'matiere') matieres += 1;
    if (e.chat === 'propose') chat += 1;
    if (e.chat === 'bientot') bientot += 1;
    if (e.studio) studio += 1;
  }
  return { total: entrees.length, matieres, elements: entrees.length - matieres, chat, bientot, studio, rendu };
}
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const studio = resolve(process.argv[2] ?? STUDIO_DEFAUT);
  if (!existsSync(join(studio, 'assets', 'photorealisme.json'))) {
    console.error(`Studio introuvable : ${studio}\nUsage : node scripts/generer-catalogue-exterieur.mjs <chemin de mimmozia-studio>`);
    process.exit(1);
  }
  const r = construire(studio, SITE_DEFAUT);
  writeFileSync(join(SITE_DEFAUT, MODULE), ecrireModule(r), 'utf8');
  const parFamille = FAMILLES.map((f) => `${f.libelle} ${r.entrees.filter((e) => e.famille === f.id).length}`).join(' · ');
  console.log(`${MODULE} : ${r.entrees.length} entrées (${parFamille}).`);
  console.log(`Textures d’extérieur au registre : ${r.textures.total} (dont ${r.textures.certifiees} validées).`);
}
