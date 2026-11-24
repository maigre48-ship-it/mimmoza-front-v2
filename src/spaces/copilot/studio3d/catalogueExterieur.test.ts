// VIS-24 — Catalogue extérieur : forme du module généré, parité avec le brief du chat (code réel de
// briefCreatif.ts), recherche et adresse de la page, et — quand le dépôt du Studio est présent à côté du
// site — fraîcheur du module : la génération est rejouée sur les sources réelles et doit redonner
// exactement le fichier (sinon : node scripts/generer-catalogue-exterieur.mjs ..\mimmozia-studio).
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CATALOGUE_EXTERIEUR, FAMILLES_EXTERIEUR, LIBELLES_CHAT, LIBELLES_RENDU, MENTIONS_APERCU, ROUTE_CATALOGUE_EXTERIEUR,
  adresseCatalogueExterieur, compterCatalogue, entreesDeLaFamille, entreesDuChoix, filtreDepuisAdresse, filtrerCatalogue, normaliserTexte,
} from './catalogueExterieur.ts';
import {
  AMBIANCES, ATTIQUES, BALCONS, BIENTOT, COULEUR_MENUISERIES, COULEUR_TOITURE, FACADES, GARDE_CORPS, MATIERE_FACADE, MATIERE_TEINTE,
  MENUISERIES, OUVERTURES, RDCS, SOUBASSEMENTS, STYLES, TOITURES,
} from './briefCreatif.ts';

const ICI = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(ICI, '..', '..', '..', '..');
const STUDIO = resolve(process.env.MIMMOZIA_STUDIO ?? join(SITE, '..', 'mimmozia-studio'));
const HEX = /^#[0-9a-f]{6}$/;

test('forme : identifiants uniques, familles connues, textes et sources présents', () => {
  const ids = new Set<string>();
  const familles = new Set(FAMILLES_EXTERIEUR.map((f) => f.id));
  for (const e of CATALOGUE_EXTERIEUR) {
    assert.ok(!ids.has(e.id), `identifiant en double : ${e.id}`);
    ids.add(e.id);
    assert.ok(familles.has(e.famille), `${e.id} : famille inconnue`);
    for (const champ of ['nom', 'description', 'application', 'noteRendu'] as const) assert.ok(e[champ].trim().length > 2, `${e.id} : ${champ} vide`);
    assert.ok(e.sources.length > 0, `${e.id} : aucune source`);
    assert.ok(e.rendu in LIBELLES_RENDU && e.chat in LIBELLES_CHAT, `${e.id} : statut inconnu`);
    assert.match(e.apercu.couleur, HEX, `${e.id} : teinte`);
    assert.ok(!/'/.test(e.nom), `${e.id} : apostrophe droite dans le nom`);
  }
  assert.ok(CATALOGUE_EXTERIEUR.length >= 200, 'catalogue anormalement court');
  for (const f of FAMILLES_EXTERIEUR) assert.ok(entreesDeLaFamille(f.id).length > 0, `famille vide : ${f.id}`);
});

test('honnêteté : un choix du chat a ses choix ; « bientôt » n’est jamais dit rendu ; une vignette est un vrai fichier', () => {
  for (const e of CATALOGUE_EXTERIEUR) {
    assert.equal(e.chat === 'propose', e.choixBrief.length > 0, `${e.id} : chat « ${e.chat} » et ${e.choixBrief.length} choix`);
    if (e.chat === 'bientot') assert.equal(e.rendu, 'non', `${e.id} : annoncé « bientôt » mais dit rendu`);
    if (e.apercu.type === 'teinte') {
      assert.equal(e.apercu.image, null, `${e.id} : une pastille n’a pas d’image`);
      // VIS-33 : une pastille dit POURQUOI elle n'a pas de photo (plus jamais « Aperçu indicatif » sous « Texture photo validée »).
      const pastilles: readonly string[] = [MENTIONS_APERCU.couleur, MENTIONS_APERCU.dessinee, MENTIONS_APERCU.aExtraire, MENTIONS_APERCU.schema];
      assert.ok(pastilles.includes(e.apercu.mention), `${e.id} : une pastille doit dire qu’elle n’est pas une photo (${e.apercu.mention})`);
      assert.equal(e.apercu.mention === MENTIONS_APERCU.schema, e.nature === 'element', `${e.id} : schéma ⇔ élément`);
    } else {
      assert.ok(e.apercu.image?.startsWith('/catalogue-exterieur/'), `${e.id} : image hors du dossier du catalogue`);
      assert.ok(existsSync(join(SITE, 'public', e.apercu.image ?? '')), `${e.id} : image absente de public/ (${e.apercu.image})`);
      assert.equal(e.apercu.mention, e.apercu.type === 'texture' ? MENTIONS_APERCU.texture : MENTIONS_APERCU.modele);
      assert.equal(e.apercu.type === 'texture', e.nature === 'matiere', `${e.id} : texture ⇔ matière`);
    }
  }
});

test('décompte : les totaux se recoupent', () => {
  const d = compterCatalogue();
  assert.equal(d.total, CATALOGUE_EXTERIEUR.length);
  assert.equal(d.matieres + d.elements, d.total);
  assert.equal(d.rendu.oui + d.rendu.reserve + d.rendu.non, d.total);
  assert.equal(FAMILLES_EXTERIEUR.reduce((n, f) => n + entreesDeLaFamille(f.id).length, 0), d.total);
  assert.equal(d.chat, CATALOGUE_EXTERIEUR.filter((e) => e.chat === 'propose').length);
});

test('parité avec le brief du chat : chaque option proposée mène à au moins une entrée « au choix dans le chat »', () => {
  const listes: readonly (readonly [string, readonly { valeur: string | boolean; disponible: boolean }[], readonly string[]])[] = [
    ['facade', FACADES, []], ['toiture', TOITURES, []], ['menuiseries', MENUISERIES, []], ['garde_corps', GARDE_CORPS, []], ['ouvertures', OUVERTURES, []],
    ['balcons', BALCONS, ['aucun']], ['soubassement', SOUBASSEMENTS, ['aucun']], ['attique', ATTIQUES, ['false']], ['rdc', RDCS, ['logements']],
    ['ambiance', AMBIANCES, []], ['style', STYLES, []],
  ];
  for (const [champ, options, sansObjet] of listes) for (const o of options) {
    const valeur = String(o.valeur);
    if (!o.disponible || sansObjet.includes(valeur)) continue;
    const trouvees = entreesDuChoix(champ, valeur);
    assert.ok(trouvees.length > 0, `${champ}=${valeur} : aucune entrée du catalogue`);
    for (const e of trouvees) assert.equal(e.chat, 'propose');
  }
  for (const [facade, teintes] of Object.entries(MATIERE_TEINTE)) for (const teinte of Object.keys(teintes ?? {}))
    assert.equal(entreesDuChoix('teinte', `${facade}:${teinte}`).length, 1, `teinte ${facade}:${teinte}`);
});

test('parité avec le brief du chat : ce qui est annoncé « bientôt » l’est aussi dans le catalogue', () => {
  const bientot = CATALOGUE_EXTERIEUR.filter((e) => e.chat === 'bientot');
  const noms = bientot.map((e) => normaliserTexte(e.nom));
  for (const s of STYLES) if (!s.disponible) assert.ok(noms.some((n) => n.includes(normaliserTexte(s.libelle))), `style ${s.libelle}`);
  for (const r of RDCS) if (!r.disponible) assert.ok(noms.some((n) => n.includes(normaliserTexte(r.libelle))), `rez-de-chaussée ${r.libelle}`);
  for (const b of BIENTOT) for (const option of b.options) assert.ok(noms.some((n) => n.includes(normaliserTexte(option))), `« ${option} » (${b.titre})`);
  const attendus = STYLES.filter((s) => !s.disponible).length + RDCS.filter((r) => !r.disponible).length + BIENTOT.reduce((n, b) => n + b.options.length, 0);
  assert.equal(bientot.length, attendus, 'une entrée « bientôt » du catalogue n’est annoncée nulle part dans le brief');
});

test('teintes : le catalogue reprend la teinte du Studio, la même que l’aperçu du brief', () => {
  // VIS-32 : le Studio a repris l'« enduit clair » du brief (#ebe4d6, av-enduit-beige et enduit-beige) — l'écart VIS-31
  // (#d9c9ab) a disparu, plus aucune exception. Un écart futur s'ajoute ici, avec sa raison.
  const ECARTS_CONNUS: Readonly<Record<string, string>> = {};
  for (const [facade, m] of Object.entries(MATIERE_FACADE)) {
    const [e] = entreesDuChoix('facade', facade);
    assert.ok(e, `façade ${facade}`);
    if (facade in ECARTS_CONNUS) { assert.equal(e.apercu.couleur, ECARTS_CONNUS[facade]); assert.notEqual(m.couleur, e.apercu.couleur, `l’écart ${facade} a disparu : retirer l’exception`); }
    else assert.equal(e.apercu.couleur, m.couleur, `teinte de la façade ${facade}`);
  }
  for (const [valeur, couleur] of Object.entries(COULEUR_MENUISERIES)) {
    const e = entreesDuChoix('menuiseries', valeur).find((x) => x.nature === 'matiere');
    assert.equal(e?.apercu.couleur, couleur, `menuiseries ${valeur}`);
  }
  for (const valeur of ['vegetalisee', 'deux_pans_tuiles', 'deux_pans_ardoise', 'deux_pans_zinc'] as const) {
    const e = entreesDuChoix('toiture', valeur).find((x) => x.nature === 'matiere');
    assert.equal(e?.apercu.couleur, COULEUR_TOITURE[valeur], `toiture ${valeur}`);
  }
});

test('recherche et filtres', () => {
  const briques = filtrerCatalogue({ texte: 'brique' });
  assert.ok(briques.length >= 4);
  assert.ok(briques.some((e) => e.refStudio === 'av-brique-rouge'));
  assert.ok(filtrerCatalogue({ texte: 'VEGETALISE' }).some((e) => e.nom.includes('végétalisé')), 'accents et casse ignorés');
  assert.ok(filtrerCatalogue({ texte: 'd’eau' }).length > 0 && filtrerCatalogue({ texte: "d'eau" }).length > 0, 'apostrophes');
  assert.deepEqual(filtrerCatalogue({ texte: 'zzzz-introuvable' }), []);
  assert.ok(filtrerCatalogue({ famille: 'toitures', chat: 'propose' }).every((e) => e.famille === 'toitures' && e.chat === 'propose'));
  assert.ok(filtrerCatalogue({ rendu: 'non', studio: true }).every((e) => e.rendu === 'non' && e.studio));
  assert.equal(filtrerCatalogue({}).length, CATALOGUE_EXTERIEUR.length);
  assert.equal(filtrerCatalogue({ texte: '   ' }).length, CATALOGUE_EXTERIEUR.length);
});

test('adresse de la page : aller-retour du filtre, valeurs inconnues ignorées', () => {
  assert.equal(adresseCatalogueExterieur(), ROUTE_CATALOGUE_EXTERIEUR);
  assert.equal(ROUTE_CATALOGUE_EXTERIEUR, '/mimmozia/catalogue-exterieur');
  const adresse = adresseCatalogueExterieur({ famille: 'toitures', rendu: 'reserve', chat: 'propose', studio: true, texte: ' tuile ' });
  assert.equal(adresse, '/mimmozia/catalogue-exterieur?famille=toitures&rendu=reserve&chat=1&studio=1&q=tuile');
  assert.deepEqual(filtreDepuisAdresse(adresse.split('?')[1] ?? ''), { famille: 'toitures', rendu: 'reserve', chat: 'propose', studio: true, texte: 'tuile' });
  assert.deepEqual(filtreDepuisAdresse('famille=cuisine&rendu=peut-etre&chat=0'), { famille: null, rendu: null, chat: null, studio: null, texte: '' });
  assert.equal(filtrerCatalogue(filtreDepuisAdresse('')).length, CATALOGUE_EXTERIEUR.length);
});

test('fraîcheur : le module est identique à ce que le script génère depuis les sources du Studio', async (t) => {
  if (!existsSync(join(STUDIO, 'assets', 'photorealisme.json'))) { t.skip(`dépôt du Studio absent (${STUDIO}) : fraîcheur non vérifiée`); return; }
  const script: string = pathToFileURL(join(SITE, 'scripts', 'generer-catalogue-exterieur.mjs')).href;
  const generateur = await import(script);
  const attendu: string = generateur.ecrireModule(generateur.construire(STUDIO, SITE));
  const actuel = readFileSync(join(SITE, generateur.MODULE), 'utf8');
  const net = (s: string): string => s.replace(/\r\n/g, '\n');
  assert.ok(net(actuel) === net(attendu), 'catalogueExterieur.ts n’est plus à jour : relancer node scripts/generer-catalogue-exterieur.mjs ..\\mimmozia-studio');
});
