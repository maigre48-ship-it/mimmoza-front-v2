/**
 * LOT INT-07 — Les 6 directions artistiques (un `StyleDefinition` par StyleId).
 *
 * Conventions :
 * - Palette 60 / 30 / 10 : `dominante` (fond : grands meubles de rangement, literie), `secondaire` (contrepoint :
 *   bois, assises), `accent` (touches). Les trois teintes d'un style sont à plus de 70 en distance RVB l'une de
 *   l'autre (tolérance de regroupement de STY-01 : 60), pour que le critique les distingue toujours.
 * - Matériaux : UNIQUEMENT des ids de la bibliothèque PBR du Studio (./bibliotheque-studio.ts). Quand le besoin
 *   n'existe pas, le plus proche existant est retenu et le besoin est noté dans `manque` (agrégé dans `manques`).
 *   Dans le Studio, la couleur d'un matériau texturé vient de sa carte : un « tissu bleu » rendu avec
 *   av-tissu-interieur (lin) sera rendu lin — c'est précisément ce que `manques` signale.
 * - Familles (`PlacementFinish.material`) : 'bois', 'laque', 'tissu', 'metal', 'ceramique'. Chaque style n'en
 *   emploie que 3 hors pièces d'eau (STY-03) ; la céramique sanitaire est la seule famille ajoutée en pièce d'eau.
 * - Les teintes, essences et associations sont des choix de direction artistique Mimmoza (hypothèse 2026),
 *   pas des données de fabricant.
 */
import type { FurnitureCategory, Gamme, StyleId } from '../types';
import type { CouleurNommee, OptionFinition, Revetement, StyleDefinition, Tier, VarianteGamme } from './types';

// ───────────────────────────── Aides ─────────────────────────────

type Opt = Omit<OptionFinition, 'tier'>;
type Nature = 'caisson' | 'textile' | 'assise' | 'luminaire' | 'plante';
type Nuancier = Record<Nature, Partial<Record<Tier, Opt>>> & { sanitaire: Opt; electromenager: Opt };
type Pref = Array<[Nature, Tier]> | 'sanitaire' | 'electromenager';

const D: Tier = 'dominante', S: Tier = 'secondaire', A: Tier = 'accent';

const rev = (materialId: string, label: string, woodSpecies: string | null = null, manque?: string): Revetement =>
  ({ materialId, label, woodSpecies, ...(manque ? { manque } : {}) });
const opt = (material: string, materialId: string, label: string, manque?: string, color?: string): Opt =>
  ({ material, materialId, label, ...(manque ? { manque } : {}), ...(color ? { color } : {}) });
const coul = (nom: string, hex: string, part: number): CouleurNommee => ({ nom, hex, part });

/** Préférences par défaut : [nature, rang] de la préférée à la moins préférée. */
const PREFS: Record<FurnitureCategory, Pref> = {
  lit: [['textile', D], ['caisson', S], ['textile', A]],
  chevet: [['caisson', S], ['caisson', D], ['caisson', A]],
  armoire: [['caisson', D], ['caisson', S]],
  dressing: [['caisson', D], ['caisson', S]],
  commode: [['caisson', D], ['caisson', S], ['caisson', A]],
  canape: [['textile', S], ['textile', A], ['textile', D]],
  fauteuil: [['textile', A], ['textile', S], ['textile', D]],
  table_basse: [['caisson', S], ['caisson', A], ['caisson', D]],
  meuble_tv: [['caisson', S], ['caisson', D], ['caisson', A]],
  table_repas: [['caisson', S], ['caisson', D]],
  chaise: [['assise', S], ['assise', A], ['assise', D]],
  bureau: [['caisson', S], ['caisson', D]],
  chaise_bureau: [['assise', A], ['assise', S], ['assise', D]],
  bibliotheque: [['caisson', D], ['caisson', S], ['caisson', A]],
  cuisine_lineaire: [['caisson', D], ['caisson', S], ['caisson', A]],
  ilot: [['caisson', S], ['caisson', D], ['caisson', A]],
  meuble_vasque: [['caisson', S], ['caisson', D]],
  meuble_entree: [['caisson', D], ['caisson', S]],
  banc: [['caisson', S], ['caisson', D]],
  tapis: [['textile', S], ['textile', D], ['textile', A]],
  luminaire_sol: [['luminaire', A], ['luminaire', S], ['luminaire', D]],
  plante: [['plante', A], ['plante', S], ['plante', D]],
  refrigerateur: 'electromenager', lave_vaisselle: 'electromenager', lave_linge: 'electromenager',
  douche: 'sanitaire', baignoire: 'sanitaire', wc: 'sanitaire', lave_mains: 'sanitaire',
};

/** Céramique sanitaire : commune à tous les styles (blanc émaillé, hors palette). */
const SANITAIRE = opt('ceramique', 'av-bois-peint-blanc', 'céramique émaillée blanche',
  'céramique sanitaire émaillée blanche (WC, vasque, receveur, baignoire) — repli av-bois-peint-blanc', '#F4F4F2');
const ELECTRO_BLANC = opt('laque', 'av-bois-peint-blanc', 'électroménager blanc (tôle laquée)',
  'tôle d\'acier laquée blanche d\'électroménager — repli av-bois-peint-blanc', '#F1F1EF');
const ELECTRO_INOX = opt('metal', 'av-metal-interieur', 'électroménager inox brossé', undefined, '#8E9297');

const SANS_ACCENT: Gamme[] = ['economique'];
const accentRoles = (g: Gamme): VarianteGamme['murAccentRoles'] =>
  SANS_ACCENT.includes(g) ? [] : g === 'standard' ? ['sejour', 'sejour_cuisine'] : ['sejour', 'sejour_cuisine', 'chambre_parentale'];

interface Cfg {
  id: StyleId; nom: string; description: string;
  palette: Record<Tier, CouleurNommee>;
  familles: string[];
  murs: StyleDefinition['murs'];
  bois: StyleDefinition['bois'];
  metal: StyleDefinition['metal'];
  nuancier: Nuancier;
  overrides?: Partial<Record<FurnitureCategory, Pref>>;
  lumiereK: number;
  sols: Record<Gamme, VarianteGamme['sols']>;
  bois_qualite: (g: Gamme) => string;
  textile_qualite: (g: Gamme) => string;
  autresManques?: string[];
}

function defStyle(c: Cfg): StyleDefinition {
  const mobilier = {} as Record<FurnitureCategory, OptionFinition[]>;
  for (const cat of Object.keys(PREFS) as FurnitureCategory[]) {
    const pref = c.overrides?.[cat] ?? PREFS[cat];
    if (pref === 'sanitaire' || pref === 'electromenager') { mobilier[cat] = [{ tier: D, ...c.nuancier[pref] }]; continue; }
    const vus = new Set<string>();
    const opts: OptionFinition[] = [];
    for (const [nature, tier] of pref) {
      const o = c.nuancier[nature][tier];
      if (!o) continue;
      const cle = `${tier}|${o.material}|${o.materialId}|${o.label}`;
      if (vus.has(cle)) continue;
      vus.add(cle);
      opts.push({ tier, ...o });
    }
    if (!opts.length) throw new Error(`style ${c.id} : aucune finition pour ${cat}`);
    mobilier[cat] = opts;
  }
  const gammes = {} as Record<Gamme, VarianteGamme>;
  for (const g of ['economique', 'standard', 'premium'] as Gamme[]) {
    gammes[g] = { sols: c.sols[g], qualiteBois: c.bois_qualite(g), qualiteTextile: c.textile_qualite(g), murAccentRoles: accentRoles(g) };
  }
  const manques = [...new Set([
    ...Object.values(mobilier).flat().map((o) => o.manque),
    ...Object.values(gammes).flatMap((v) => [v.sols.sec.manque, v.sols.humide.manque, v.sols.exterieur.manque]),
    c.murs.dominante.manque, c.murs.accent.manque, c.murs.humide.manque, c.metal.manque,
    ...(c.autresManques ?? []),
  ].filter((m): m is string => !!m))];
  return {
    id: c.id, nom: c.nom, description: c.description, palette: c.palette, familles: c.familles, murs: c.murs,
    bois: c.bois, metal: c.metal, mobilier, lumiereK: c.lumiereK, gammes, manques,
  };
}

const qualiteBois = (essence: string) => (g: Gamme) =>
  g === 'economique' ? `panneau mélaminé décor ${essence}` : g === 'standard' ? `placage ${essence}` : `${essence} massif`;
const qualiteTextile = (eco: string, std: string, prem: string) => (g: Gamme) => (g === 'economique' ? eco : g === 'standard' ? std : prem);

// Repères communs.
const TISSU = 'av-tissu-interieur';
const BOIS_MOBILIER = 'av-bois-interieur';
const LAQUE_BLANCHE = 'av-bois-peint-blanc';
const FAIENCE = rev('av-mur-faience', 'faïence blanche (zones d\'eau)');
const STRATIFIE_CHENE = rev('av-parquet-clair', 'sol stratifié décor chêne', 'chene', 'sol stratifié décor chêne — repli av-parquet-clair (parquet)');

// ───────────────────────────── 1. Contemporain ─────────────────────────────

const CONTEMPORAIN = defStyle({
  id: 'contemporain', nom: 'Contemporain',
  description: 'Lignes épurées, fond blanc mat, chêne naturel en contrepoint, touches anthracite ; sobre et lumineux.',
  palette: { dominante: coul('Blanc mat', '#ECEBE7', 0.6), secondaire: coul('Chêne naturel', '#B08A5E', 0.3), accent: coul('Anthracite', '#3A3D40', 0.1) },
  familles: ['laque', 'bois', 'tissu'],
  murs: {
    dominante: rev('av-mur-peint-blanc-pur', 'peinture mate blanc pur'),
    accent: rev('av-mur-peint-anthracite', 'peinture mate anthracite (mur TV)'),
    humide: FAIENCE,
  },
  bois: { principale: 'chene', compatibles: ['noyer'] },
  metal: { nom: 'noir mat', materialId: 'av-acier-noir', hex: '#2A2C2F' },
  nuancier: {
    caisson: {
      dominante: opt('laque', LAQUE_BLANCHE, 'laque mate blanche', 'laque mate blanche pour mobilier — repli av-bois-peint-blanc (menuiserie peinte)'),
      secondaire: opt('bois', BOIS_MOBILIER, 'chêne naturel', 'placage chêne naturel pour mobilier — repli av-bois-interieur (bois générique)'),
      accent: opt('laque', 'av-mur-peint-anthracite', 'laque mate anthracite', 'laque mate anthracite pour mobilier — repli av-mur-peint-anthracite (peinture murale)'),
    },
    textile: {
      dominante: opt('tissu', TISSU, 'tissu blanc cassé', 'tissu d\'ameublement blanc cassé — repli av-tissu-interieur (lin)'),
      secondaire: opt('tissu', TISSU, 'tissu chiné camel', 'tissu d\'ameublement camel — repli av-tissu-interieur (lin)'),
      accent: opt('tissu', TISSU, 'tissu anthracite', 'tissu d\'ameublement anthracite — repli av-tissu-interieur (lin)'),
    },
    assise: {
      dominante: opt('laque', LAQUE_BLANCHE, 'coque laquée blanche', 'laque mate blanche pour mobilier — repli av-bois-peint-blanc (menuiserie peinte)'),
      secondaire: opt('bois', BOIS_MOBILIER, 'chêne naturel', 'placage chêne naturel pour mobilier — repli av-bois-interieur (bois générique)'),
      accent: opt('laque', 'av-mur-peint-anthracite', 'métal laqué anthracite', 'laque mate anthracite pour mobilier — repli av-mur-peint-anthracite (peinture murale)'),
    },
    luminaire: {
      accent: opt('laque', 'av-mur-peint-anthracite', 'pied métal laqué anthracite', 'laque mate anthracite pour mobilier — repli av-mur-peint-anthracite (peinture murale)'),
      secondaire: opt('bois', BOIS_MOBILIER, 'pied chêne', 'placage chêne naturel pour mobilier — repli av-bois-interieur (bois générique)'),
      dominante: opt('laque', LAQUE_BLANCHE, 'métal laqué blanc', 'laque mate blanche pour mobilier — repli av-bois-peint-blanc (menuiserie peinte)'),
    },
    plante: {
      accent: opt('laque', 'av-mur-peint-anthracite', 'pot laqué anthracite', 'laque mate anthracite pour mobilier — repli av-mur-peint-anthracite (peinture murale)'),
      secondaire: opt('bois', BOIS_MOBILIER, 'cache-pot chêne', 'placage chêne naturel pour mobilier — repli av-bois-interieur (bois générique)'),
      dominante: opt('laque', LAQUE_BLANCHE, 'pot laqué blanc', 'laque mate blanche pour mobilier — repli av-bois-peint-blanc (menuiserie peinte)'),
    },
    sanitaire: SANITAIRE, electromenager: ELECTRO_BLANC,
  },
  lumiereK: 3000,
  sols: {
    economique: { sec: STRATIFIE_CHENE, humide: rev('av-carrelage', 'carrelage grès cérame gris clair 45 × 45'), exterieur: rev('av-beton-sol', 'dalle béton balayée') },
    standard: { sec: rev('av-parquet-clair', 'parquet contrecollé chêne clair', 'chene'), humide: rev('av-carrelage-grand-format', 'grès cérame grand format 60 × 60'), exterieur: rev('av-pierre-sol', 'dalles sur plots', null, 'dalles de grès cérame extérieur sur plots — repli av-pierre-sol (pierre naturelle)') },
    premium: { sec: rev('av-parquet', 'parquet chêne massif huilé', 'chene'), humide: rev('av-carrelage-grand-format', 'grès cérame grand format rectifié'), exterieur: rev('av-terrasse-bois', 'platelage bois') },
  },
  bois_qualite: qualiteBois('chêne'),
  textile_qualite: qualiteTextile('polyester tissé', 'coton et lin mélangés', 'lin et laine bouclette'),
});

// ───────────────────────────── 2. Scandinave ─────────────────────────────

const SCANDINAVE = defStyle({
  id: 'scandinave', nom: 'Scandinave',
  description: 'Clair et chaleureux : blanc chaud, frêne blond, textiles naturels, touches de bleu gris.',
  palette: { dominante: coul('Blanc chaud', '#F2EADB', 0.6), secondaire: coul('Frêne blond', '#D2B48C', 0.3), accent: coul('Bleu gris', '#7F94A3', 0.1) },
  familles: ['bois', 'laque', 'tissu'],
  murs: {
    dominante: rev('av-mur-peint-blanc-chaud', 'peinture mate blanc chaud'),
    accent: rev('av-mur-peint-bleu-gris', 'peinture mate bleu gris'),
    humide: FAIENCE,
  },
  bois: { principale: 'frene', compatibles: ['chene'] },
  metal: { nom: 'noir mat', materialId: 'av-acier-noir', hex: '#2A2C2F' },
  nuancier: {
    caisson: {
      dominante: opt('laque', LAQUE_BLANCHE, 'laque mate blanc chaud', 'laque mate blanche pour mobilier — repli av-bois-peint-blanc (menuiserie peinte)'),
      secondaire: opt('bois', BOIS_MOBILIER, 'frêne blond', 'placage frêne blond pour mobilier — repli av-bois-interieur (bois générique, plus foncé)'),
      accent: opt('laque', 'av-mur-peint-bleu-gris', 'laque mate bleu gris', 'laque mate bleu gris pour mobilier — repli av-mur-peint-bleu-gris (peinture murale)'),
    },
    textile: {
      dominante: opt('tissu', TISSU, 'lin blanc', 'lin blanc lavé — repli av-tissu-interieur (lin naturel)'),
      secondaire: opt('tissu', TISSU, 'laine naturelle beige', 'laine bouillie beige — repli av-tissu-interieur (lin)'),
      accent: opt('tissu', TISSU, 'tissu bleu gris', 'tissu d\'ameublement bleu gris — repli av-tissu-interieur (lin)'),
    },
    assise: {
      secondaire: opt('bois', BOIS_MOBILIER, 'frêne blond', 'placage frêne blond pour mobilier — repli av-bois-interieur (bois générique, plus foncé)'),
      accent: opt('laque', 'av-mur-peint-bleu-gris', 'laque mate bleu gris', 'laque mate bleu gris pour mobilier — repli av-mur-peint-bleu-gris (peinture murale)'),
      dominante: opt('laque', LAQUE_BLANCHE, 'coque laquée blanche', 'laque mate blanche pour mobilier — repli av-bois-peint-blanc (menuiserie peinte)'),
    },
    luminaire: {
      secondaire: opt('bois', BOIS_MOBILIER, 'pied frêne, abat-jour lin', 'placage frêne blond pour mobilier — repli av-bois-interieur (bois générique, plus foncé)'),
      accent: opt('laque', 'av-mur-peint-bleu-gris', 'métal laqué bleu gris', 'laque mate bleu gris pour mobilier — repli av-mur-peint-bleu-gris (peinture murale)'),
      dominante: opt('laque', LAQUE_BLANCHE, 'métal laqué blanc', 'laque mate blanche pour mobilier — repli av-bois-peint-blanc (menuiserie peinte)'),
    },
    plante: {
      accent: opt('laque', 'av-mur-peint-bleu-gris', 'pot laqué bleu gris', 'laque mate bleu gris pour mobilier — repli av-mur-peint-bleu-gris (peinture murale)'),
      secondaire: opt('bois', BOIS_MOBILIER, 'cache-pot frêne', 'placage frêne blond pour mobilier — repli av-bois-interieur (bois générique, plus foncé)'),
      dominante: opt('laque', LAQUE_BLANCHE, 'pot laqué blanc', 'laque mate blanche pour mobilier — repli av-bois-peint-blanc (menuiserie peinte)'),
    },
    sanitaire: SANITAIRE, electromenager: ELECTRO_BLANC,
  },
  overrides: { luminaire_sol: [['luminaire', S], ['luminaire', A], ['luminaire', D]] },
  lumiereK: 2700,
  sols: {
    economique: { sec: STRATIFIE_CHENE, humide: rev('av-carrelage', 'carrelage grès cérame clair'), exterieur: rev('av-beton-sol', 'dalle béton balayée') },
    standard: { sec: rev('av-parquet-clair', 'parquet contrecollé chêne blond', 'chene'), humide: rev('av-carrelage', 'carrelage grès cérame clair mat'), exterieur: rev('av-terrasse-bois', 'platelage pin traité') },
    premium: { sec: rev('av-parquet-clair', 'parquet chêne massif huilé blanc', 'chene'), humide: rev('av-carrelage-grand-format', 'grès cérame grand format clair'), exterieur: rev('av-terrasse-bois', 'platelage bois') },
  },
  bois_qualite: qualiteBois('frêne'),
  textile_qualite: qualiteTextile('coton', 'lin et laine', 'lin lavé et laine bouillie'),
});

// ───────────────────────────── 3. Industriel ─────────────────────────────

const INDUSTRIEL = defStyle({
  id: 'industriel', nom: 'Industriel',
  description: 'Esprit loft : gris béton, acier, chêne fumé, noir acier en accent, brique apparente en mur d\'accent.',
  palette: { dominante: coul('Gris béton', '#A9A8A4', 0.6), secondaire: coul('Chêne fumé', '#6B4A2F', 0.3), accent: coul('Noir acier', '#232426', 0.1) },
  familles: ['metal', 'bois', 'tissu'],
  murs: {
    dominante: rev('av-mur-peint-gris-perle', 'peinture mate gris perle'),
    accent: rev('av-mur-brique', 'brique apparente'),
    humide: rev('av-mur-faience', 'carreaux blancs (zones d\'eau)', null, 'carreau métro biseauté blanc — repli av-mur-faience (carreaux carrés 15 cm)'),
  },
  bois: { principale: 'chene', compatibles: ['pin'] },
  metal: { nom: 'acier noir', materialId: 'av-acier-noir', hex: '#2A2C2F' },
  nuancier: {
    caisson: {
      dominante: opt('metal', 'av-metal-interieur', 'acier brossé gris'),
      secondaire: opt('bois', BOIS_MOBILIER, 'chêne fumé', 'placage chêne fumé (teinte foncée) pour mobilier — repli av-bois-interieur (bois générique, plus clair)'),
      accent: opt('metal', 'av-acier-noir', 'acier noir'),
    },
    textile: {
      dominante: opt('tissu', TISSU, 'tissu gris chiné', 'tissu d\'ameublement gris chiné — repli av-tissu-interieur (lin)'),
      secondaire: opt('tissu', TISSU, 'tissu enduit aspect cuir brun', 'cuir cognac / tissu enduit aspect cuir — repli av-tissu-interieur (lin)'),
      accent: opt('tissu', TISSU, 'tissu noir', 'tissu d\'ameublement noir — repli av-tissu-interieur (lin)'),
    },
    assise: {
      accent: opt('metal', 'av-acier-noir', 'acier noir'),
      secondaire: opt('bois', BOIS_MOBILIER, 'chêne fumé', 'placage chêne fumé (teinte foncée) pour mobilier — repli av-bois-interieur (bois générique, plus clair)'),
      dominante: opt('metal', 'av-metal-interieur', 'acier brossé gris'),
    },
    luminaire: {
      accent: opt('metal', 'av-acier-noir', 'lampadaire acier noir'),
      secondaire: opt('bois', BOIS_MOBILIER, 'trépied chêne fumé', 'placage chêne fumé (teinte foncée) pour mobilier — repli av-bois-interieur (bois générique, plus clair)'),
      dominante: opt('metal', 'av-metal-interieur', 'lampadaire acier brossé'),
    },
    plante: {
      accent: opt('metal', 'av-acier-noir', 'pot acier noir'),
      secondaire: opt('bois', BOIS_MOBILIER, 'caisse bois fumé', 'placage chêne fumé (teinte foncée) pour mobilier — repli av-bois-interieur (bois générique, plus clair)'),
      dominante: opt('metal', 'av-metal-interieur', 'pot zinc'),
    },
    sanitaire: SANITAIRE, electromenager: ELECTRO_INOX,
  },
  overrides: {
    cuisine_lineaire: [['caisson', S], ['caisson', A], ['caisson', D]],
    bibliotheque: [['caisson', A], ['caisson', D], ['caisson', S]],
    chaise: [['assise', A], ['assise', S], ['assise', D]],
  },
  lumiereK: 2700,
  sols: {
    economique: { sec: rev('av-beton-cire', 'sol vinyle aspect béton', null, 'sol vinyle / stratifié aspect béton — repli av-beton-cire'), humide: rev('av-carrelage', 'carrelage grès cérame gris'), exterieur: rev('av-beton-sol', 'dalle béton balayée') },
    standard: { sec: rev('av-parquet', 'parquet contrecollé chêne huilé', 'chene'), humide: rev('av-carrelage', 'carrelage grès cérame gris'), exterieur: rev('av-beton-sol', 'dalle béton lissée') },
    premium: { sec: rev('av-beton-cire', 'béton ciré coulé'), humide: rev('av-carrelage-grand-format', 'grès cérame grand format'), exterieur: rev('av-terrasse-bois', 'platelage bois') },
  },
  bois_qualite: qualiteBois('chêne fumé'),
  textile_qualite: qualiteTextile('polyester enduit', 'tissu enduit et coton', 'cuir pleine fleur et laine'),
});

// ───────────────────────────── 4. Japandi ─────────────────────────────

const JAPANDI = defStyle({
  id: 'japandi', nom: 'Japandi',
  description: 'Fusion japonaise et scandinave : chêne clair dominant, lin écru, lignes basses, touches noir encre.',
  palette: { dominante: coul('Chêne clair', '#C9A97E', 0.6), secondaire: coul('Lin écru', '#E8E0D0', 0.3), accent: coul('Noir encre', '#2B2A28', 0.1) },
  familles: ['bois', 'tissu', 'laque'],
  murs: {
    dominante: rev('av-mur-peint-blanc-chaud', 'peinture mate blanc chaud'),
    accent: rev('av-mur-peint-grege', 'peinture mate grège'),
    humide: rev('av-mur-faience', 'faïence (zones d\'eau)', null, 'carreau zellige / grès émaillé écru — repli av-mur-faience (faïence blanche)'),
  },
  bois: { principale: 'chene', compatibles: ['frene'] },
  metal: { nom: 'noir mat', materialId: 'av-acier-noir', hex: '#2A2C2F' },
  nuancier: {
    caisson: {
      dominante: opt('bois', BOIS_MOBILIER, 'chêne clair', 'placage chêne clair pour mobilier — repli av-bois-interieur (bois générique, plus foncé)'),
      secondaire: opt('laque', LAQUE_BLANCHE, 'laque mate écrue', 'laque mate écrue pour mobilier — repli av-bois-peint-blanc (menuiserie peinte blanc cassé)'),
      accent: opt('laque', 'av-mur-peint-anthracite', 'laque mate noir encre', 'laque mate noire pour mobilier — repli av-mur-peint-anthracite (peinture murale)'),
    },
    textile: {
      dominante: opt('tissu', TISSU, 'lin naturel'),
      secondaire: opt('tissu', TISSU, 'lin écru', 'lin écru lavé — repli av-tissu-interieur (lin naturel)'),
      accent: opt('tissu', TISSU, 'lin charbon', 'lin teint charbon — repli av-tissu-interieur (lin naturel)'),
    },
    assise: {
      dominante: opt('bois', BOIS_MOBILIER, 'chêne clair', 'placage chêne clair pour mobilier — repli av-bois-interieur (bois générique, plus foncé)'),
      accent: opt('laque', 'av-mur-peint-anthracite', 'bois laqué noir encre', 'laque mate noire pour mobilier — repli av-mur-peint-anthracite (peinture murale)'),
      secondaire: opt('tissu', TISSU, 'assise lin écru', 'lin écru lavé — repli av-tissu-interieur (lin naturel)'),
    },
    luminaire: {
      accent: opt('laque', 'av-mur-peint-anthracite', 'pied laqué noir, abat-jour papier', 'laque mate noire pour mobilier — repli av-mur-peint-anthracite (peinture murale)'),
      dominante: opt('bois', BOIS_MOBILIER, 'pied chêne clair', 'placage chêne clair pour mobilier — repli av-bois-interieur (bois générique, plus foncé)'),
      secondaire: opt('tissu', TISSU, 'lanterne lin écru', 'lin écru lavé — repli av-tissu-interieur (lin naturel)'),
    },
    plante: {
      accent: opt('laque', 'av-mur-peint-anthracite', 'pot laqué noir', 'laque mate noire pour mobilier — repli av-mur-peint-anthracite (peinture murale)'),
      dominante: opt('bois', BOIS_MOBILIER, 'cache-pot chêne clair', 'placage chêne clair pour mobilier — repli av-bois-interieur (bois générique, plus foncé)'),
      secondaire: opt('laque', LAQUE_BLANCHE, 'pot laqué écru', 'laque mate écrue pour mobilier — repli av-bois-peint-blanc (menuiserie peinte blanc cassé)'),
    },
    sanitaire: SANITAIRE, electromenager: ELECTRO_BLANC,
  },
  overrides: {
    lit: [['caisson', D], ['textile', S], ['textile', A]],
    canape: [['textile', S], ['textile', D], ['textile', A]],
  },
  lumiereK: 2700,
  sols: {
    economique: { sec: STRATIFIE_CHENE, humide: rev('av-carrelage', 'carrelage grès cérame clair'), exterieur: rev('av-beton-sol', 'dalle béton balayée') },
    standard: { sec: rev('av-parquet-clair', 'parquet contrecollé chêne clair', 'chene'), humide: rev('av-carrelage-grand-format', 'grès cérame effet pierre beige'), exterieur: rev('av-terrasse-bois', 'platelage bois') },
    premium: { sec: rev('av-parquet-clair', 'parquet chêne massif clair huilé', 'chene'), humide: rev('av-carrelage-grand-format', 'grès cérame grand format effet pierre'), exterieur: rev('av-terrasse-bois', 'platelage bois') },
  },
  bois_qualite: qualiteBois('chêne clair'),
  textile_qualite: qualiteTextile('coton', 'lin naturel', 'lin lavé épais'),
  autresManques: ['papier washi (abat-jour) — non modélisé, aucun matériau translucide papier'],
});

// ───────────────────────────── 5. Classique chic ─────────────────────────────

const CLASSIQUE_CHIC = defStyle({
  id: 'classique_chic', nom: 'Classique chic',
  description: 'Élégance haussmannienne revisitée : blanc crème, noyer, velours bleu nuit, laiton ; parquet bâtons rompus.',
  palette: { dominante: coul('Blanc crème', '#EFE8DA', 0.6), secondaire: coul('Noyer', '#6A4A35', 0.3), accent: coul('Bleu nuit', '#26354D', 0.1) },
  familles: ['laque', 'bois', 'tissu'],
  murs: {
    dominante: rev('av-mur-peint-blanc-chaud', 'peinture mate blanc crème'),
    accent: rev('av-mur-papier-peint', 'papier peint rayé ton sur ton'),
    humide: FAIENCE,
  },
  bois: { principale: 'noyer', compatibles: ['chene'] },
  metal: { nom: 'laiton brossé', materialId: 'av-aluminium-bronze', hex: '#B08D57', manque: 'laiton brossé (poignées, piètements, luminaires) — repli av-aluminium-bronze' },
  nuancier: {
    caisson: {
      dominante: opt('laque', LAQUE_BLANCHE, 'laque crème moulurée', 'laque satinée crème pour mobilier mouluré — repli av-bois-peint-blanc (menuiserie peinte)'),
      secondaire: opt('bois', BOIS_MOBILIER, 'noyer', 'placage noyer pour mobilier — repli av-bois-interieur (bois générique, plus clair)'),
      accent: opt('laque', 'av-mur-peint-bleu-nuit', 'laque bleu nuit', 'laque satinée bleu nuit pour mobilier — repli av-mur-peint-bleu-nuit (peinture murale)'),
    },
    textile: {
      dominante: opt('tissu', TISSU, 'lin crème', 'lin crème — repli av-tissu-interieur (lin naturel)'),
      secondaire: opt('tissu', TISSU, 'velours brun', 'velours d\'ameublement brun — repli av-tissu-interieur (lin)'),
      accent: opt('tissu', TISSU, 'velours bleu nuit', 'velours d\'ameublement bleu nuit — repli av-tissu-interieur (lin)'),
    },
    assise: {
      secondaire: opt('bois', BOIS_MOBILIER, 'noyer', 'placage noyer pour mobilier — repli av-bois-interieur (bois générique, plus clair)'),
      accent: opt('tissu', TISSU, 'assise velours bleu nuit', 'velours d\'ameublement bleu nuit — repli av-tissu-interieur (lin)'),
      dominante: opt('laque', LAQUE_BLANCHE, 'chaise médaillon laquée crème', 'laque satinée crème pour mobilier mouluré — repli av-bois-peint-blanc (menuiserie peinte)'),
    },
    luminaire: {
      secondaire: opt('bois', BOIS_MOBILIER, 'pied noyer tourné', 'placage noyer pour mobilier — repli av-bois-interieur (bois générique, plus clair)'),
      accent: opt('laque', 'av-mur-peint-bleu-nuit', 'pied laqué bleu nuit', 'laque satinée bleu nuit pour mobilier — repli av-mur-peint-bleu-nuit (peinture murale)'),
      dominante: opt('laque', LAQUE_BLANCHE, 'pied laqué crème', 'laque satinée crème pour mobilier mouluré — repli av-bois-peint-blanc (menuiserie peinte)'),
    },
    plante: {
      accent: opt('laque', 'av-mur-peint-bleu-nuit', 'cache-pot laqué bleu nuit', 'laque satinée bleu nuit pour mobilier — repli av-mur-peint-bleu-nuit (peinture murale)'),
      dominante: opt('laque', LAQUE_BLANCHE, 'cache-pot laqué crème', 'laque satinée crème pour mobilier mouluré — repli av-bois-peint-blanc (menuiserie peinte)'),
      secondaire: opt('bois', BOIS_MOBILIER, 'cache-pot noyer', 'placage noyer pour mobilier — repli av-bois-interieur (bois générique, plus clair)'),
    },
    sanitaire: SANITAIRE, electromenager: ELECTRO_BLANC,
  },
  overrides: {
    canape: [['textile', A], ['textile', D], ['textile', S]],
    fauteuil: [['textile', A], ['textile', D], ['textile', S]],
    luminaire_sol: [['luminaire', S], ['luminaire', A], ['luminaire', D]],
  },
  lumiereK: 2700,
  sols: {
    economique: { sec: STRATIFIE_CHENE, humide: rev('av-carrelage', 'carrelage grès cérame clair'), exterieur: rev('av-beton-sol', 'dalle béton balayée') },
    standard: { sec: rev('av-parquet-batons-rompus', 'parquet contrecollé chêne bâtons rompus', 'chene'), humide: rev('av-carrelage-grand-format', 'grès cérame grand format effet pierre'), exterieur: rev('av-pierre-sol', 'dalles de pierre') },
    premium: { sec: rev('av-parquet-batons-rompus', 'parquet chêne massif bâtons rompus', 'chene'), humide: rev('av-carrelage-grand-format', 'grès cérame effet marbre', null, 'marbre blanc veiné poli (sol et plan de vasque) — repli av-carrelage-grand-format (effet pierre beige)'), exterieur: rev('av-pierre-sol', 'dalles de pierre naturelle') },
  },
  bois_qualite: qualiteBois('noyer'),
  textile_qualite: qualiteTextile('velours polyester', 'velours de coton', 'velours de soie et lin'),
  autresManques: ['moulures et boiseries murales (staff, cimaises) — non couvertes par la bibliothèque'],
});

// ───────────────────────────── 6. Méditerranéen ─────────────────────────────

const MEDITERRANEEN = defStyle({
  id: 'mediterraneen', nom: 'Méditerranéen',
  description: 'Lumière du Sud : blanc chaux, bois clair, lin, bleu égéen en accent, terre cuite au sol et en mur d\'accent.',
  palette: { dominante: coul('Blanc chaux', '#F0ECE3', 0.6), secondaire: coul('Bois clair', '#C4A27A', 0.3), accent: coul('Bleu égéen', '#2F5D8A', 0.1) },
  familles: ['bois', 'tissu', 'laque'],
  murs: {
    dominante: rev('av-mur-enduit-chaux', 'enduit à la chaux blanc'),
    accent: rev('av-mur-peint-terracotta', 'peinture mate terracotta'),
    humide: rev('av-mur-faience', 'faïence (zones d\'eau)', null, 'zellige émaillé (bleu ou blanc) — repli av-mur-faience (faïence blanche)'),
  },
  bois: { principale: 'chene', compatibles: ['pin'] },
  metal: { nom: 'fer forgé noir', materialId: 'av-acier-noir', hex: '#2A2C2F' },
  nuancier: {
    caisson: {
      dominante: opt('laque', LAQUE_BLANCHE, 'bois peint blanc chaux', 'peinture mate blanc chaux pour mobilier — repli av-bois-peint-blanc (menuiserie peinte)'),
      secondaire: opt('bois', BOIS_MOBILIER, 'chêne clair brossé', 'placage chêne clair brossé pour mobilier — repli av-bois-interieur (bois générique, plus foncé)'),
      accent: opt('laque', 'av-mur-peint-bleu-nuit', 'bois peint bleu égéen', 'peinture / laque bleu égéen pour mobilier — repli av-mur-peint-bleu-nuit (peinture murale plus sombre)'),
    },
    textile: {
      dominante: opt('tissu', TISSU, 'lin blanc', 'lin blanc lavé — repli av-tissu-interieur (lin naturel)'),
      secondaire: opt('tissu', TISSU, 'lin naturel'),
      accent: opt('tissu', TISSU, 'coton bleu égéen', 'coton tissé bleu égéen — repli av-tissu-interieur (lin)'),
    },
    assise: {
      secondaire: opt('bois', BOIS_MOBILIER, 'chaise bois et paille', 'cannage / paille / rotin — repli av-bois-interieur (bois générique)'),
      accent: opt('laque', 'av-mur-peint-bleu-nuit', 'bois peint bleu égéen', 'peinture / laque bleu égéen pour mobilier — repli av-mur-peint-bleu-nuit (peinture murale plus sombre)'),
      dominante: opt('laque', LAQUE_BLANCHE, 'bois peint blanc chaux', 'peinture mate blanc chaux pour mobilier — repli av-bois-peint-blanc (menuiserie peinte)'),
    },
    luminaire: {
      secondaire: opt('bois', BOIS_MOBILIER, 'lampadaire bois clair, abat-jour lin', 'placage chêne clair brossé pour mobilier — repli av-bois-interieur (bois générique, plus foncé)'),
      accent: opt('laque', 'av-mur-peint-bleu-nuit', 'pied peint bleu égéen', 'peinture / laque bleu égéen pour mobilier — repli av-mur-peint-bleu-nuit (peinture murale plus sombre)'),
      dominante: opt('laque', LAQUE_BLANCHE, 'pied peint blanc chaux', 'peinture mate blanc chaux pour mobilier — repli av-bois-peint-blanc (menuiserie peinte)'),
    },
    plante: {
      accent: opt('laque', 'av-mur-peint-bleu-nuit', 'pot émaillé bleu', 'pot en terre cuite émaillée bleue — repli av-mur-peint-bleu-nuit'),
      secondaire: opt('bois', BOIS_MOBILIER, 'cache-pot bois clair', 'placage chêne clair brossé pour mobilier — repli av-bois-interieur (bois générique, plus foncé)'),
      dominante: opt('laque', LAQUE_BLANCHE, 'pot chaulé blanc', 'peinture mate blanc chaux pour mobilier — repli av-bois-peint-blanc (menuiserie peinte)'),
    },
    sanitaire: SANITAIRE, electromenager: ELECTRO_BLANC,
  },
  overrides: { luminaire_sol: [['luminaire', S], ['luminaire', A], ['luminaire', D]] },
  lumiereK: 3000,
  sols: {
    economique: { sec: rev('av-carrelage-grand-format', 'grès cérame effet pierre beige'), humide: rev('av-carrelage', 'carrelage grès cérame clair'), exterieur: rev('av-pierre-sol', 'dalles effet pierre', null, 'dalles de grès cérame extérieur effet pierre — repli av-pierre-sol (pierre naturelle)') },
    standard: { sec: rev('av-carrelage-grand-format', 'grès cérame grand format effet pierre beige'), humide: rev('av-carrelage', 'carrelage grès cérame clair mat'), exterieur: rev('av-pierre-sol', 'dalles de pierre') },
    premium: { sec: rev('av-tomettes', 'tomettes hexagonales en terre cuite'), humide: rev('av-carrelage-grand-format', 'grès cérame grand format effet pierre', null, 'zellige au sol des pièces d\'eau — repli av-carrelage-grand-format'), exterieur: rev('av-pierre-sol', 'dalles de pierre naturelle') },
  },
  bois_qualite: qualiteBois('chêne clair'),
  textile_qualite: qualiteTextile('coton', 'lin naturel', 'lin lavé épais'),
  autresManques: ['bois d\'olivier (petit mobilier, plateaux) — non couvert : chêne clair retenu'],
});

export const STYLES: Record<StyleId, StyleDefinition> = {
  contemporain: CONTEMPORAIN,
  scandinave: SCANDINAVE,
  industriel: INDUSTRIEL,
  japandi: JAPANDI,
  classique_chic: CLASSIQUE_CHIC,
  mediterraneen: MEDITERRANEEN,
};

export const STYLE_IDS: StyleId[] = ['contemporain', 'scandinave', 'industriel', 'japandi', 'classique_chic', 'mediterraneen'];

export function getStyle(id: StyleId): StyleDefinition {
  return STYLES[id];
}
