// npx tsx --test src/spaces/copilot/studio3d/vis31CatalogueMatieres.test.ts
// VIS-31 (24/11/2026) — « Je n'ai pas pu chercher les textures sur la page avec toutes les textures. »
//   1. la page /mimmozia/catalogue-exterieur : route, garde, adresse Vercel, rendu statique, recherche (accents, casse,
//      pluriel), champ de recherche NON lié à l'adresse (cause du bug : transition de React Router) ;
//   2. « Toutes les matières » dans la carte d'habillage (étape 4) : matières rendues par partie, traduction honnête
//      (exacte / approchée / aucune), refus, message envoyé accepté tel quel par le serveur (validerBrief réel) ;
//   3. teinte « enduit clair » : blanc cassé lumineux côté brief.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { CATALOGUE_EXTERIEUR, filtrerCatalogue } from './catalogueExterieur.ts';
import {
  CHOIX_DEFAUT, MATIERE_FACADE, PARTIES_MATIERE, TRANSMETTRE_REFERENCES_CATALOGUE, choisir, choisirMatiereCatalogue, messageBrief,
  phraseMatieresCatalogue, type EtatBrief, type LimitesBrief,
} from './briefCreatif.ts';
import { matiereChoisie, matieresDeLaPartie, traduireMatiere } from './matieresCatalogue.ts';
import { briefDuMessage } from '../../../../supabase/functions/copilot-chat/agent/studio.ts';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, '../../../..');
const lire = (f: string) => readFileSync(path.join(RACINE, f), 'utf8');
const entree = (ref: string) => { const e = CATALOGUE_EXTERIEUR.find((x) => x.refStudio === ref); assert.ok(e, ref); return e; };
const LIMITES: LimitesBrief = { balcons: true, ailes: false, batiments: 1 } as LimitesBrief;
const D = { ambiances: ['jour', 'fin_de_journee'] as const, limites: LIMITES } as unknown as Parameters<typeof choisir>[3];

async function charger<T>(fichier: string, nom: string): Promise<T> {
  const require = createRequire(import.meta.url);
  const esbuild = require('esbuild') as typeof import('esbuild');
  const r = esbuild.buildSync({
    entryPoints: [path.join(ICI, fichier)], bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic',
    external: ['react', 'react-dom', 'react/jsx-runtime', 'react-router-dom', 'react-router', 'lucide-react'], loader: { '.css': 'empty' }, logLevel: 'silent',
  });
  const dossier = path.join(RACINE, 'node_modules', '.cache', 'vis31');
  mkdirSync(dossier, { recursive: true });
  const sortie = path.join(dossier, `${nom}.mjs`);
  writeFileSync(sortie, r.outputFiles[0].text);
  return await import(pathToFileURL(sortie).href) as T;
}
const texte = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, '’').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ');

// ── 1. La page ───────────────────────────────────────────────────────────────
test('route : /mimmozia/catalogue-exterieur atteint la page (ni /mimmozia, ni la 404), derrière la garde de session', async () => {
  const app = lire('src/App.tsx');
  const garde = app.indexOf('<Route element={<PrivateRoute />}>');
  const route = app.indexOf('<Route path="/mimmozia/catalogue-exterieur" element={<PageCatalogueExterieur />} />');
  assert.ok(garde > 0 && route > garde && route < app.indexOf('</Route>', garde), 'route déclarée dans la première garde');
  const { matchRoutes } = await import('react-router');
  const routes = [{ path: '/mimmozia' }, { path: '/mimmozia/catalogue-exterieur' }, { path: '*' }];
  assert.equal(matchRoutes(routes, '/mimmozia/catalogue-exterieur?q=brique')?.[0].route.path, '/mimmozia/catalogue-exterieur');
  assert.equal(matchRoutes(routes, '/mimmozia')?.[0].route.path, '/mimmozia');
  // Vercel : la page est servie par index.html (pas l'API, pas le Studio).
  const vercel = JSON.parse(lire('vercel.json')) as { rewrites: { source: string; destination: string }[] };
  const spa = vercel.rewrites.find((r) => r.destination === '/index.html');
  assert.ok(spa);
  assert.ok(new RegExp(`^${spa.source.replace('/((?!', '/(?:(?!').replace(').*)', ').*)')}$`).test('/mimmozia/catalogue-exterieur'));
  // Nouvel onglet (noopener) : la session Supabase est dans localStorage (stockage par défaut), partagé entre onglets.
  assert.doesNotMatch(lire('src/lib/supabaseClient.ts'), /storage\s*:\s*(?:window\.)?sessionStorage/);
});

test('recherche : brique, enduit, tuile, bois, verre, haie — accents, majuscules et pluriel indifférents', () => {
  for (const [mot, attendu] of [['brique', 'av-brique-rouge'], ['enduit', 'av-enduit-blanc'], ['tuile', 'av-tuiles-terre-cuite'], ['bois', 'av-bardage-bois-brun'], ['verre', 'av-verre-clair']] as const) {
    for (const variante of [mot, mot.toUpperCase(), `${mot[0].toUpperCase()}${mot.slice(1)}s`, ` ${mot} `]) {
      const r = filtrerCatalogue({ texte: variante });
      assert.ok(r.some((e) => e.refStudio === attendu), `« ${variante} » doit trouver ${attendu}`);
    }
  }
  assert.ok(filtrerCatalogue({ texte: 'haie' }).length >= 5, 'haies / arbustes');
  assert.deepEqual(filtrerCatalogue({ texte: 'BÉTON' }).map((e) => e.id), filtrerCatalogue({ texte: 'beton' }).map((e) => e.id));
  assert.ok(filtrerCatalogue({ texte: 'Béton' }).length >= 5);
  assert.ok(filtrerCatalogue({ texte: 'tuiles canal' }).some((e) => e.refStudio === 'pm-tuile-canal'), 'plusieurs mots, pluriel');
  assert.ok(!filtrerCatalogue({ texte: 'arbre' }).some((e) => /marbre/i.test(e.nom)), '« arbre » ne trouve plus le marbre');
  // Olivier : absent du catalogue extérieur à ce jour (dit, pas inventé).
  assert.equal(filtrerCatalogue({ texte: 'olivier' }).length, 0);
});

test('page : le champ de recherche vit dans un état local (plus lié à l’adresse mise à jour en transition)', () => {
  const src = readFileSync(path.join(ICI, 'PageCatalogueExterieur.tsx'), 'utf8');
  assert.match(src, /value=\{saisie\}/);
  assert.match(src, /onChange=\{\(ev\) => setSaisie\(ev\.target\.value\)\}/);
  assert.doesNotMatch(src, /value=\{filtre\.texte/, 'la cause du bug : champ contrôlé par ?q= (transition de React Router 7)');
  assert.match(src, /useDeferredValue\(saisie\)/);
  // Le CSS de la page ne cache pas le champ et ne se met pas sous l'en-tête collant du site.
  const css = readFileSync(path.join(ICI, 'PageCatalogueExterieur.css'), 'utf8');
  assert.doesNotMatch(css, /\.mz-catext__recherche[^{]*\{[^}]*(?:display:\s*none|visibility:\s*hidden|opacity:\s*0)/);
  // VIS-33 : seul le bandeau « Ma sélection » colle, et SOUS l'en-tête collant du site (hauteur mesurée par la page).
  assert.doesNotMatch(css, /position:\s*fixed/, 'aucun bloc fixe');
  const collants = [...css.matchAll(/([^{}]+)\{[^}]*position:\s*sticky[^}]*\}/g)];
  assert.deepEqual(collants.map((m) => m[1].trim().split('\n').pop()!.trim()), ['.mz-catext__selection'], 'aucun autre bloc collant');
  assert.match(collants[0][0], /top:\s*var\(--mz-entete-site/, 'le bandeau colle sous l’en-tête du site, pas dessous');
});

test('page : rendu statique (adresse ?q=tuile) — champ rempli, résultats, compte, renvoi vers l’étape 4', async () => {
  const m = await charger<{ default: () => unknown }>('PageCatalogueExterieur.tsx', 'PageCatalogueExterieur');
  const { createElement: h } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { MemoryRouter } = await import('react-router');
  const html = renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/mimmozia/catalogue-exterieur?q=Tuiles'] }, h(m.default as never)));
  assert.match(html, /<input type="search"[^>]*value="Tuiles"/);
  const t = texte(html);
  assert.match(t, /\d+ entrées? sur 256/);
  assert.match(t, /Tuile canal/);
  assert.doesNotMatch(t, /Rien ne correspond/);
  assert.match(t, /étape 4 « Style & façades »/);
  const vide = texte(renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/mimmozia/catalogue-exterieur'] }, h(m.default as never))));
  assert.match(vide, /256 entrées/);
});

test('page : frappe rapide dans un vrai DOM (jsdom, si disponible) — aucune lettre perdue', async (t) => {
  const chemin = process.env.JSDOM_PATH ?? path.join(process.env.HOME ?? '', 'ordre4', 'jsd', 'node_modules', 'jsdom');
  if (!existsSync(chemin)) { t.skip(`jsdom absent (${chemin}) : preuve dans _to_delete/vis31/preuve-saisie.txt`); return; }
  const require = createRequire(import.meta.url);
  const { JSDOM } = require(chemin) as { JSDOM: new (h: string, o: object) => { window: Window & typeof globalThis } };
  const dom = new JSDOM('<!doctype html><div id="r"></div>', { url: 'https://mimmoza.test/mimmozia/catalogue-exterieur', pretendToBeVisual: true });
  const g = globalThis as Record<string, unknown>;
  for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Node', 'Event', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    try { g[k] = (dom.window as unknown as Record<string, unknown>)[k]; } catch { /* lecture seule */ }
  }
  const m = await charger<{ default: () => unknown }>('PageCatalogueExterieur.tsx', 'PageCatalogueExterieurDom');
  const { createElement: h } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { BrowserRouter, Routes, Route } = await import('react-router');
  const racine = createRoot(dom.window.document.getElementById('r')!);
  racine.render(h(BrowserRouter, null, h(Routes, null, h(Route, { path: '/mimmozia/catalogue-exterieur', element: h(m.default as never) }))));
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  await pause(200);
  const champ = dom.window.document.querySelector('input[type=search]') as HTMLInputElement;
  const poser = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!;
  for (const c of 'brique') {
    poser.call(champ, champ.value + c);
    champ.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.ok(champ.value.endsWith(c), `lettre « ${c} » gardée immédiatement (champ : « ${champ.value} »)`);
  }
  await pause(600);
  assert.equal(champ.value, 'brique');
  assert.equal(dom.window.location.search, '?q=brique');
  assert.match(dom.window.document.querySelector('.mz-catext__compte')?.textContent ?? '', /^\d+ entrées? sur 256$/);
  racine.unmount();
});

// ── 2. Toutes les matières dans la carte d'habillage ───────────────────────────
test('« Toutes les matières » : bien plus que les choix fermés, seulement des matières rendues, « avec réserve » gardé', () => {
  const distinctes = new Set<string>();
  const minimum = { facade: 40, soubassement: 15, menuiseries: 5, garde_corps: 3, toiture: 8 } as const;
  for (const p of PARTIES_MATIERE) {
    const l = matieresDeLaPartie(p);
    assert.ok(l.length >= minimum[p], `${p} : ${l.length}`);
    for (const e of l) {
      distinctes.add(e.id);
      assert.notEqual(e.rendu, 'non', `${e.id} : non rendue`);
      assert.equal(e.nature, 'matiere');
      assert.equal(matiereChoisie(p, e).rendu, e.rendu === 'oui' ? 'oui' : 'reserve');
    }
  }
  assert.ok(distinctes.size >= 60, `matières distinctes : ${distinctes.size}`);
});

test('traduction : exacte quand le catalogue la relie au brief, approchée sinon, « aucune » dite', () => {
  assert.deepEqual(traduireMatiere('facade', entree('av-brique-claire')), { traduction: 'exacte', champs: { facade: 'brique', teinte: 'claire' }, rendueComme: 'Brique claire' });
  assert.deepEqual(traduireMatiere('facade', entree('av-enduit-blanc')).champs, { facade: 'enduit_blanc', teinte: 'naturelle' });
  assert.equal(traduireMatiere('menuiseries', entree('av-aluminium-bronze')).traduction, 'exacte');
  assert.deepEqual(traduireMatiere('toiture', entree('av-zinc-anthracite')).champs, { toiture: 'deux_pans_zinc' });
  const taille = traduireMatiere('facade', entree('av-pierre-de-taille'));
  assert.equal(taille.traduction, 'approchee');
  assert.deepEqual(taille.champs, { facade: 'pierre', teinte: 'naturelle' });
  assert.deepEqual(traduireMatiere('toiture', entree('pm-tuile-canal')).champs, { toiture: 'deux_pans_tuiles' });
  assert.equal(traduireMatiere('facade', entree('av-zinc-facade')).traduction, 'aucune');
  assert.equal(traduireMatiere('garde_corps', entree('av-garde-corps-verre')).champs.garde_corps, 'verre');
});

test('choix : valeurs fermées appliquées, matière gardée et dite (avec réserve), bloc accepté tel quel par le serveur', () => {
  const e0: EtatBrief = { choix: { ...CHOIX_DEFAUT }, touches: [] };
  const taille = entree('av-pierre-de-taille');
  const r = choisirMatiereCatalogue(e0, 'facade', matiereChoisie('facade', taille), traduireMatiere('facade', taille).champs, D);
  assert.equal(r.refus, null);
  assert.equal(r.etat.choix.facade, 'pierre');
  assert.ok(r.etat.touches.includes('facade'));
  assert.equal(r.etat.matieres?.facade?.ref, 'av-pierre-de-taille');
  const zinc = entree('av-zinc-anthracite');
  const r2 = choisirMatiereCatalogue(r.etat, 'toiture', matiereChoisie('toiture', zinc), traduireMatiere('toiture', zinc).champs, D);
  assert.equal(r2.etat.choix.toiture, 'deux_pans_zinc');
  const phrase = phraseMatieresCatalogue(r2.etat) ?? '';
  // VIS-32 : la référence exacte part dans le brief → « rendue telle quelle » (valeur fermée « pierre » gardée en repli).
  assert.match(phrase, /façade « Pierre de taille » \(rendue telle quelle, avec réserve\)/);
  assert.match(phrase, /toiture « Zinc anthracite » \(rendue telle quelle, avec réserve\)/);
  const msg = messageBrief(r2.etat, { type: 'image', limites: LIMITES } as never);
  assert.ok(msg.includes(phrase));
  // VIS-32 : le bloc porte les références exactes ; le serveur (code réel) les accepte par sa liste blanche.
  assert.equal(TRANSMETTRE_REFERENCES_CATALOGUE, true);
  assert.match(msg.split('```')[1], /"matieres":\{"facade":"av-pierre-de-taille","toiture":"av-zinc-anthracite"\}/);
  const lu = briefDuMessage(msg);
  assert.ok(lu?.ok, JSON.stringify(lu));
  assert.deepEqual(lu.ok && lu.valeur.brief?.matieres, { facade: 'av-pierre-de-taille', toiture: 'av-zinc-anthracite' });
  assert.equal(lu.ok && lu.valeur.brief?.facade, 'pierre');
  assert.equal(lu.ok && lu.valeur.brief?.toiture, 'deux_pans_zinc');
  // Un clic sur une valeur de la carte remplace la matière du catalogue de la même partie (et seulement elle).
  const r3 = choisir(r2.etat, 'facade', 'brique', D);
  assert.equal(r3.matieres?.facade, undefined);
  assert.equal(r3.matieres?.toiture?.ref, 'av-zinc-anthracite');
});

test('refus : toit à deux pans d’un bâtiment à ailes, garde-corps sans balcon — rien ne change, la raison est rendue', () => {
  const e0: EtatBrief = { choix: { ...CHOIX_DEFAUT }, touches: [] };
  const ailes = { ...D, limites: { ...LIMITES, ailes: true } } as typeof D;
  const tuile = entree('av-tuiles-terre-cuite');
  const r = choisirMatiereCatalogue(e0, 'toiture', matiereChoisie('toiture', tuile), traduireMatiere('toiture', tuile).champs, ailes);
  assert.ok(r.refus);
  assert.equal(r.etat, e0);
  const sansBalcon: EtatBrief = { choix: { ...CHOIX_DEFAUT, balcons: 'aucun' }, touches: ['balcons'] };
  const bois = entree('rg-bois-balcon');
  const r2 = choisirMatiereCatalogue(sansBalcon, 'garde_corps', matiereChoisie('garde_corps', bois), traduireMatiere('garde_corps', bois).champs, D);
  assert.ok(r2.refus);
});

test('grille « Toutes les matières » : rendu statique honnête (avec réserve, approchée, pas d’équivalent), recherche locale', async () => {
  const m = await charger<{ default: (p: object) => unknown }>('ChoixMatiereCatalogue.tsx', 'ChoixMatiereCatalogue');
  const { createElement: h } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const html = renderToStaticMarkup(h(m.default as never, { partie: 'facade', etat: { choix: { ...CHOIX_DEFAUT }, touches: [] }, demande: D, onChoisir: () => {}, onFermer: () => {} }));
  const t = texte(html);
  assert.match(t, /Toutes les matières · façade/);
  assert.match(t, new RegExp(`${matieresDeLaPartie('facade').length} matières rendues`));
  assert.match(t, /Avec réserve/);
  assert.match(t, /Rendue telle quelle dans les images/);
  // VIS-32 : les matières transmises (av-, pm-, rg-) sont rendues telles quelles ; les qm- (moteur de quartier) restent approchées.
  assert.match(t, /Moellons de grès Repris dans les images Rendue pour l’instant comme « Pierre claire »/);
  assert.match(t, /Pierre de taille Avec réserve Rendue telle quelle dans les images/);
  assert.match(t, /Panneaux métalliques Repris dans les images Rendue telle quelle dans les images/);
  assert.match(t, /Utiliser pour la façade/);
  assert.match(html, /<input type="search"/);
  const toits = texte(renderToStaticMarkup(h(m.default as never, { partie: 'toiture', etat: { choix: { ...CHOIX_DEFAUT }, touches: [] }, demande: { ...D, limites: { ...LIMITES, ailes: true } }, onChoisir: () => {}, onFermer: () => {} })));
  assert.match(toits, /Indisponible ici/, 'toit à deux pans refusé pour un bâtiment à ailes, dit sur la carte');
});

// ── 3. Teinte « enduit clair » ──────────────────────────────────────────────────
test('enduit clair : blanc cassé lumineux (plus clair que l’ancien crème #e2d9c6 et que le beige du Studio #d9c9ab), distinct de l’enduit blanc', () => {
  const lum = (hex: string) => { const n = Number.parseInt(hex.slice(1), 16); return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255); };
  const c = MATIERE_FACADE.enduit_clair.couleur;
  assert.equal(c, '#ebe4d6');
  assert.ok(lum(c) > lum('#e2d9c6') && lum(c) > lum('#d9c9ab'));
  assert.notEqual(c, MATIERE_FACADE.enduit_blanc.couleur);
  const n = Number.parseInt(c.slice(1), 16);
  assert.ok(((n >> 16) & 255) > (n & 255), 'légèrement chaud (rouge > bleu)');
});
