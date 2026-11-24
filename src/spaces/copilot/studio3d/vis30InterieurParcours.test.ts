// node --test : npx tsx --test src/spaces/copilot/studio3d/vis30InterieurParcours.test.ts
// VIS-30 (24/11/2026) — l'aménagement intérieur DANS le parcours, visiblement : l'étape 5 dit ce qu'on y fait
// (« Meublez le logement témoin : plan, meubles, sols et murs »), UN bouton « Aménager le logement » (carte du chat ET
// écran de l'étape 5 de l'Espace 3D : même action), aperçu du témoin dans l'Espace 3D ; vue intérieure → étape requise.
// Chaîne vérifiée maillon par maillon : bouton → EVENEMENT_PARCOURS_STUDIO → MimmozIAPage (preparerEtapeStudio puis
// voirEn3D) → onglet « mimmoza-studio » → le Studio lit la demande (tests/vis30ArriveeInterieur.test.ts côté Studio).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { calculerParcours, sourcesVides, type SourcesParcours } from '../../../lib/studio/parcours.ts';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, '../../../..');
const lire = (rel: string) => readFileSync(path.join(ICI, rel), 'utf8');
const etape5 = (s: SourcesParcours) => calculerParcours(s).etapes.find((e) => e.cle === 'interieurs')!;
const image = (vues: string[]): SourcesParcours => {
  const s = sourcesVides('image');
  return { ...s, rendu: { ...s.rendu, vues: vues as never, vuesChoisies: true } };
};

test('étape 5 : dit ce qu’on y fait, UN bouton « Aménager le logement » vers la page du Studio', () => {
  const e = etape5(image(['trois_quarts_gauche']));
  assert.equal(e.statut, 'facultative');
  assert.match(e.resume, /^Meublez le logement témoin : plan, meubles, sols et murs\./);
  assert.deepEqual(e.action, { cible: 'studio-interieur', libelle: 'Aménager le logement' });
  assert.equal(e.carteDansLeFil, undefined);
});

test('vue intérieure demandée (séjour, chambre…) : l’étape 5 n’est plus facultative (interieurRequis)', () => {
  for (const v of ['sejour', 'chambre', 'vue_baie', 'hall']) assert.equal(etape5(image(['trois_quarts_gauche', v])).statut, 'a_faire', v);
  assert.equal(etape5(sourcesVides('image')).statut, 'a_faire', 'pack plaquette par défaut : il contient le séjour');
  const film = sourcesVides('film');
  assert.equal(etape5({ ...film, film: { duree_s: 30, format: '16:9', musique: false, interieurs: false, ambiance: null } }).statut, 'facultative');
  assert.equal(etape5({ ...film, film: { duree_s: 30, format: '16:9', musique: false, interieurs: true, ambiance: null } }).statut, 'a_faire');
  assert.match(etape5(image(['sejour'])).resume, /Mimmo le meuble selon la gamme/);
});

test('aperçu du témoin (Espace 3D) : proposé par Mimmo sans personnalisation ; sinon SON résumé (style, meubles) et la gamme', () => {
  const auto = etape5(image(['sejour'])).apercu!;
  assert.equal(auto.titre, 'Logement témoin proposé par Mimmo');
  assert.match(auto.lignes.join(' | '), /meuble selon la gamme.*Gamme standard \(par défaut\).*Vue intérieure prévue/);
  const s = image(['sejour']);
  const perso = etape5({ ...s, interieurs: { gamme: 'premium', typologie: 'T3', cible: null, origine: 'conversation' },
    temoinStudio: { fait: true, resume: 'T3 A204 · séjour scandinave · parquet · 18 meubles' } });
  assert.equal(perso.statut, 'fait');
  assert.equal(perso.apercu!.titre, 'Logement témoin personnalisé');
  assert.equal(perso.apercu!.lignes[0], 'T3 A204 · séjour scandinave · parquet · 18 meubles');
  assert.match(perso.apercu!.lignes[1], /^Gamme premium · T3$/);
});

test('Espace 3D, écran de l’étape 5 : aperçu + le MÊME bouton (onParcours = actionnerParcours de la carte du chat)', () => {
  const panneau = lire('JarvisDraftPanel.tsx');
  assert.match(panneau, /parcours, onParcours, commandeParcours/);
  assert.match(panneau, /onClick=\{\(\) => onParcours\(etapeTemoin, etapeTemoin\.action\)\}>\{etapeTemoin\.action\.libelle\}/);
  assert.doesNotMatch(panneau, /se personnalise dans le Studio : bouton « Personnaliser l’intérieur »/);
  const chat = readFileSync(path.join(ICI, '../components/CopilotChat.tsx'), 'utf8');
  assert.match(chat, /onParcours=\{actionnerParcours\}/);
  // studio-interieur → Studio, étape « amenagement », sous-onglet « interieur » (événement écouté par MimmozIAPage).
  assert.match(chat, /\{ etape: 'amenagement', sous: 'interieur', repondre: setNoticeParcours \}/);
  assert.match(chat, /window\.dispatchEvent\(new CustomEvent\(EVENEMENT_PARCOURS_STUDIO, \{ detail: demande \}\)\)/);
  const page = readFileSync(path.join(ICI, '../MimmozIAPage.tsx'), 'utf8');
  const surStudio = page.slice(page.indexOf('const surStudio = (e: Event)'));
  assert.ok(surStudio.indexOf('preparerEtapeStudio(d.etape, d.sous)') < surStudio.indexOf('voirEn3D('), 'demande déposée AVANT l’ouverture de l’onglet');
  assert.match(lire('StudioIntegre.tsx'), /const NOM_ONGLET_STUDIO = "mimmoza-studio";/);
});

test('rendu de la carte du chat : l’étape 5 FACULTATIVE porte bien son bouton « Aménager le logement »', async () => {
  const require = createRequire(import.meta.url);
  const esbuild = require('esbuild') as typeof import('esbuild');
  const r = await esbuild.build({
    stdin: { contents: "export * from './ParcoursGuide.tsx';", resolveDir: ICI, loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', alias: { '@': path.join(RACINE, 'src') },
    external: ['react', 'react-dom', 'react/jsx-runtime', 'lucide-react'], loader: { '.css': 'empty' }, logLevel: 'silent',
  });
  const dossier = path.join(RACINE, 'node_modules', '.cache', 'vis30');
  mkdirSync(dossier, { recursive: true });
  const fichier = path.join(dossier, 'Parcours.mjs');
  writeFileSync(fichier, r.outputFiles[0].text);
  const m = await import(pathToFileURL(fichier).href) as typeof import('./ParcoursGuide.tsx');
  const { createElement: h } = await import('react');
  const { renderToStaticMarkup: rendre } = await import('react-dom/server');
  const p = calculerParcours(image(['trois_quarts_gauche']));
  const recus: string[] = [];
  const html = rendre(h(m.CarteParcours, { parcours: p, onAction: (_e, a) => { recus.push(a.cible); } }));
  assert.match(html, /aria-label="Étape 5 — Intérieurs : Aménager le logement"/);
  assert.match(html, /Meublez le logement témoin : plan, meubles, sols et murs/);
  assert.equal((html.match(/>Aménager le logement</g) ?? []).length, 1, 'un seul bouton d’aménagement');
});
