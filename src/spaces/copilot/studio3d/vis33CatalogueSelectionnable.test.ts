// npx tsx --test src/spaces/copilot/studio3d/vis33CatalogueSelectionnable.test.ts
// VIS-33 (24/11/2026) — « Sur cette page je ne vois pas tout et surtout je ne peux pas choisir ce que je prends. »
//   1. vignettes honnêtes : une pastille unie dit pourquoi elle n'a pas de photo (jamais « Aperçu indicatif » sous
//      « Texture photo validée ») ; toute photo citée existe ;
//   2. « Choisir pour… » : parties compatibles = celles de la carte d'habillage (matieresParPartie) ; voirie et abords
//      « choisis automatiquement selon le quartier » (pas de faux bouton) ;
//   3. « Ma sélection » partagée par conversation (selectionCatalogue.ts) : brouillon → « Utiliser dans mon projet » →
//      la carte d'habillage l'applique (mêmes garde-fous qu'un clic) ; un choix de la carte revient dans la page ;
//   4. page (rendu statique) : bandeau, boutons, libellés ; lien du chat avec ?conversation=.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { CATALOGUE_EXTERIEUR, MENTIONS_APERCU } from './catalogueExterieur.ts';
import { PARTIES_MATIERE, etatInitial, type DemandeBrief, type LimitesBrief } from './briefCreatif.ts';
import { candidatesDeLaPartie } from './matieresParPartie.ts';
import { matiereChoisie, traduireMatiere } from './matieresCatalogue.ts';
import {
  SELECTION_VIDE, adresseCatalogueConversation, aEnvoyer, appliquerProjetAEtat, choisirDansPage, choixEnVigueur, cleSelection,
  conversationDepuisAdresse, envoyerAuProjet, lignesSelection, lireSelection, lireSelectionBrute, memesChoix, projetDepuisEtat, retirerDansPage,
  type ResoudreMatiere,
} from './selectionCatalogue.ts';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, '../../../..');
const LIMITES = { balcons: true, ailes: false, batiments: 1 } as LimitesBrief;
const D = { ambiances: ['jour', 'fin_de_journee'], limites: LIMITES } as unknown as Pick<DemandeBrief, 'ambiances' | 'limites'>;
const entree = (ref: string) => { const e = CATALOGUE_EXTERIEUR.find((x) => x.refStudio === ref); assert.ok(e, ref); return e; };
const resoudre: ResoudreMatiere = (p, ref) => {
  const e = candidatesDeLaPartie(p).find((x) => x.refStudio === ref);
  return e ? { matiere: matiereChoisie(p, e), champs: traduireMatiere(p, e).champs } : null;
};

// ── 1. Vignettes ─────────────────────────────────────────────────────────────
test('vignettes : une pastille dit pourquoi elle n’a pas de photo ; « Texture photo validée » n’est jamais sous « couleur seule, pas de photo »', () => {
  for (const e of CATALOGUE_EXTERIEUR) {
    assert.notEqual(e.apercu.mention, 'Aperçu indicatif', `${e.id} : ancienne étiquette`);
    if (e.apercu.type === 'teinte' && e.nature === 'matiere' && /Texture photo validée/.test(e.noteRendu)) {
      assert.equal(e.apercu.mention, MENTIONS_APERCU.aExtraire, `${e.id} : texture photo connue → « photo pas encore extraite », pas « pas de photo »`);
    }
  }
  // Les matières de voirie de la capture d'Albé : photo, ou « pas encore extraite » (disque D: non lu) — jamais « pas de photo ».
  for (const ref of ['qm-enrobe', 'qm-enrobe-clair', 'qm-pave-granit', 'qm-pave-place', 'qm-bordure-granit', 'qm-trottoir-beton', 'qm-dalle-beton']) {
    const m = entree(ref).apercu.mention;
    assert.ok(m === MENTIONS_APERCU.texture || m === MENTIONS_APERCU.aExtraire, `${ref} : ${m}`);
  }
  assert.equal(entree('qm-marquage-blanc').apercu.type, 'texture');
});

// ── 2. Parties compatibles ───────────────────────────────────────────────────
test('« Choisir pour… » : parties compatibles = règle de la carte ; voirie sans bouton', () => {
  const parties = (ref: string) => PARTIES_MATIERE.filter((p) => candidatesDeLaPartie(p).some((e) => e.refStudio === ref));
  assert.ok(parties('av-brique-rouge').includes('facade'));
  assert.ok(parties('av-brique-rouge').includes('soubassement'));
  assert.deepEqual(parties('av-zinc-anthracite'), ['toiture']);
  assert.deepEqual(parties('av-aluminium-bronze'), ['menuiseries']);
  assert.deepEqual(parties('av-garde-corps-verre'), ['garde_corps']);
  for (const ref of ['qm-enrobe', 'qm-trottoir-beton', 'qm-bordure-granit', 'qm-pave-place', 'av-asphalte']) assert.deepEqual(parties(ref), [], `${ref} : pas de partie du bâtiment`);
  const src = readFileSync(path.join(ICI, 'PageCatalogueExterieur.tsx'), 'utf8');
  assert.match(src, /Choisi automatiquement selon le quartier\./);
});

// ── 3. Sélection partagée ────────────────────────────────────────────────────
test('sélection : brouillon de la page → « Utiliser dans mon projet » → projet ; retrait ; lecture tolérante', () => {
  let s = choisirDansPage(SELECTION_VIDE, 'facade', { ref: 'av-brique-claire', nom: 'Brique claire' });
  s = choisirDansPage(s, 'toiture', { ref: 'av-zinc-anthracite', nom: 'Zinc anthracite' });
  assert.ok(aEnvoyer(s));
  assert.deepEqual(lignesSelection(s).map((l) => [l.partie, l.etat]), [['facade', 'a_envoyer'], ['toiture', 'a_envoyer']]);
  s = envoyerAuProjet(s);
  assert.ok(!aEnvoyer(s));
  assert.equal(s.projet.facade?.ref, 'av-brique-claire');
  assert.deepEqual(lignesSelection(s).map((l) => l.etat), ['projet', 'projet']);
  // Retrait d'un choix du projet : demandé, puis envoyé.
  s = retirerDansPage(s, 'toiture');
  assert.deepEqual(lignesSelection(s).find((l) => l.partie === 'toiture')?.etat, 'retrait_a_envoyer');
  assert.equal(choixEnVigueur(s, 'toiture'), null);
  s = envoyerAuProjet(s);
  assert.equal(s.projet.toiture, undefined);
  // Re-choisir ce qui est déjà dans le projet n'est pas « à envoyer ».
  assert.ok(!aEnvoyer(choisirDansPage(s, 'facade', { ref: 'av-brique-claire', nom: 'Brique claire' })));
  // Annuler un brouillon.
  assert.ok(!aEnvoyer(retirerDansPage(choisirDansPage(s, 'soubassement', { ref: 'av-beton-brut', nom: 'Béton brut' }), 'soubassement')));
  // Lecture : JSON abîmé, partie inconnue, référence absurde → ignorés.
  assert.deepEqual(lireSelectionBrute('{pas du json'), SELECTION_VIDE);
  const lu = lireSelectionBrute(JSON.stringify({ projet: { facade: { ref: 'av-brique-claire', nom: 'B' }, cuisine: { ref: 'x', nom: 'x' }, toiture: { ref: '', nom: '' } }, brouillon: { soubassement: null } }));
  assert.deepEqual(Object.keys(lu.projet), ['facade']);
  assert.deepEqual(lu.brouillon, {}, 'retrait d’une partie absente du projet : sans objet');
  // Sans navigateur : rien ne casse.
  assert.deepEqual(lireSelection('abc'), SELECTION_VIDE);
  assert.notEqual(cleSelection('abc'), cleSelection(null));
});

test('carte : le projet partagé s’applique avec les garde-fous de la carte ; un refus est rendu ; la carte réécrit son état', () => {
  const etat = etatInitial({ actuel: null, ambiances: ['jour', 'fin_de_journee'], limites: LIMITES } as never);
  const r = appliquerProjetAEtat(etat, { facade: { ref: 'av-brique-claire', nom: 'Brique claire' }, toiture: { ref: 'av-zinc-anthracite', nom: 'Zinc anthracite' } }, resoudre, D);
  assert.deepEqual(r.refus, {});
  assert.equal(r.etat.choix.facade, 'brique');
  assert.equal(r.etat.choix.teinte, 'claire');
  assert.equal(r.etat.choix.toiture, 'deux_pans_zinc');
  assert.equal(r.etat.matieres?.facade?.ref, 'av-brique-claire');
  const projet = projetDepuisEtat(r.etat)!;
  assert.ok(memesChoix(projet, { facade: { ref: 'av-brique-claire', nom: '' }, toiture: { ref: 'av-zinc-anthracite', nom: '' } }));
  // Retrait côté page → retiré de la carte.
  const r2 = appliquerProjetAEtat(r.etat, { facade: projet.facade! }, resoudre, D);
  assert.equal(r2.etat.matieres?.toiture, undefined);
  assert.equal(r2.etat.matieres?.facade?.ref, 'av-brique-claire');
  // Garde-fou : toit à deux pans sur un bâtiment à ailes → refus dit, rien ne change.
  const ailes = { ...D, limites: { ...LIMITES, ailes: true } } as typeof D;
  const r3 = appliquerProjetAEtat(etat, { toiture: { ref: 'av-zinc-anthracite', nom: 'Zinc anthracite' } }, resoudre, ailes);
  assert.ok(r3.refus.toiture && r3.refus.toiture.length > 5, JSON.stringify(r3.refus));
  assert.equal(r3.etat.matieres?.toiture, undefined);
  // Référence inconnue (voirie) → refus nommé.
  const r4 = appliquerProjetAEtat(etat, { facade: { ref: 'qm-enrobe', nom: 'Enrobé' } }, resoudre, D);
  assert.match(r4.refus.facade ?? '', /Enrobé/);
  // Matière relue d'un brief, pas encore résolue → la carte n'écrit rien (null).
  assert.equal(projetDepuisEtat({ matieres: { facade: { ref: 'av-brique-claire', nom: 'av-brique-claire', rendu: 'oui', noteRendu: '', exacte: true, rendueComme: null, aResoudre: true } } }), null);
});

test('adresse : le chat ouvre la page avec la conversation ; la page la relit (et refuse le reste)', () => {
  assert.equal(adresseCatalogueConversation('c-123_AB'), '/mimmozia/catalogue-exterieur?conversation=c-123_AB');
  assert.equal(adresseCatalogueConversation(null), '/mimmozia/catalogue-exterieur');
  assert.equal(conversationDepuisAdresse('?conversation=c-123_AB&famille=sols'), 'c-123_AB');
  assert.equal(conversationDepuisAdresse('?conversation=<script>'), null);
  assert.equal(conversationDepuisAdresse('?famille=sols'), null);
  const chat = readFileSync(path.join(RACINE, 'src/spaces/copilot/components/CopilotChat.tsx'), 'utf8');
  assert.match(chat, /window\.open\(adresseCatalogueConversation\(currentConversationId \?\? null\), '_blank', 'noopener'\)/);
  const carte = readFileSync(path.join(ICI, 'CarteBriefCreatif.tsx'), 'utf8');
  assert.match(carte, /useSynchroSelectionCarte\(conversationId, etat, setEtat, demande\)/);
});

// ── 4. Page (rendu statique) ─────────────────────────────────────────────────
async function chargerPage(): Promise<{ default: () => unknown }> {
  const require = createRequire(import.meta.url);
  const esbuild = require('esbuild') as typeof import('esbuild');
  const r = esbuild.buildSync({
    entryPoints: [path.join(ICI, 'PageCatalogueExterieur.tsx')], bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic',
    external: ['react', 'react-dom', 'react/jsx-runtime', 'react-router-dom', 'react-router', 'lucide-react'], loader: { '.css': 'empty' }, logLevel: 'silent',
  });
  const dossier = path.join(RACINE, 'node_modules', '.cache', 'vis33');
  mkdirSync(dossier, { recursive: true });
  const sortie = path.join(dossier, 'PageCatalogueExterieur.mjs');
  writeFileSync(sortie, r.outputFiles[0].text);
  return await import(pathToFileURL(sortie).href) as { default: () => unknown };
}
const texte = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, '’').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ');

test('page : « Ma sélection », « Choisir pour… », « Choisi automatiquement selon le quartier », bouton selon la conversation', async () => {
  const m = await chargerPage();
  const { createElement: h } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { MemoryRouter } = await import('react-router');
  const seule = texte(renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/mimmozia/catalogue-exterieur'] }, h(m.default as never))));
  assert.match(seule, /Ma sélection/);
  assert.match(seule, /Ouvrez un projet dans le chat pour utiliser ces matières/);
  assert.match(seule, /Choisir pour…/);
  assert.match(seule, /Choisir pour : toiture/);
  assert.match(seule, /Choisi automatiquement selon le quartier\./);
  assert.match(seule, /256 entrées/);
  assert.doesNotMatch(seule, /Aperçu indicatif/);
  const projet = texte(renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/mimmozia/catalogue-exterieur?conversation=c-1'] }, h(m.default as never))));
  assert.match(projet, /Utiliser dans mon projet/);
  assert.doesNotMatch(projet, /Ouvrez un projet dans le chat/);
  // Lisibilité : sélection en bleu clair, comme le sélecteur du parcours ; fond explicite.
  const css = readFileSync(path.join(ICI, 'PageCatalogueExterieur.css'), 'utf8');
  assert.match(css, /\.mz-catext__choisie \{[^}]*background: #dbeafe;[^}]*color: #1e3a8a;/);
  assert.match(css, /\.mz-catext \{ background: #f9fafb; \}/);
});

test('page dans un vrai DOM (jsdom, si disponible) : choisir → « Utiliser dans mon projet » → stocké ; un choix de la carte revient dans « Ma sélection »', async (t) => {
  const chemin = process.env.JSDOM_PATH ?? path.join(process.env.HOME ?? '', 'ordre4', 'jsd', 'node_modules', 'jsdom');
  const { existsSync } = await import('node:fs');
  if (!existsSync(chemin)) { t.skip(`jsdom absent (${chemin})`); return; }
  const require = createRequire(import.meta.url);
  const { JSDOM } = require(chemin) as { JSDOM: new (h: string, o: object) => { window: Window & typeof globalThis } };
  const dom = new JSDOM('<!doctype html><div id="r"></div>', { url: 'https://mimmoza.test/mimmozia/catalogue-exterieur?conversation=conv-vis33', pretendToBeVisual: true });
  const g = globalThis as Record<string, unknown>;
  for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Node', 'localStorage', /* Event : celui de Node, requis par BroadcastChannel */ 'requestAnimationFrame', 'cancelAnimationFrame']) {
    try { g[k] = (dom.window as unknown as Record<string, unknown>)[k]; } catch { /* lecture seule */ }
  }
  const m = await chargerPage();
  const { createElement: h } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const { BrowserRouter, Routes, Route } = await import('react-router');
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const doc = dom.window.document;
  const racine = createRoot(doc.getElementById('r')!);
  await act(async () => { racine.render(h(BrowserRouter, null, h(Routes, null, h(Route, { path: '/mimmozia/catalogue-exterieur', element: h(m.default as never) })))); });
  const carte = (nom: string) => [...doc.querySelectorAll('article')].find((a) => a.querySelector('h3')?.textContent === nom)!;
  const cliquer = async (el: Element | null | undefined) => { assert.ok(el); await act(async () => { (el as HTMLElement).click(); }); };
  const bandeau = () => doc.querySelector('.mz-catext__selection')?.textContent ?? '';
  // Brique rouge → « Choisir pour… » → Façade.
  const brique = carte('Brique rouge');
  await cliquer([...brique.querySelectorAll('button')].find((b) => b.textContent === 'Choisir pour…'));
  await cliquer([...brique.querySelectorAll('.mz-catext__parties button')].find((b) => /^Façade/.test(b.textContent ?? '')));
  assert.match(bandeau(), /FaçadeBrique rougeÀ envoyer/);
  assert.match(carte('Brique rouge').querySelector('.mz-catext__choisie')?.textContent ?? '', /Choisie pour : façade/);
  await cliquer([...doc.querySelectorAll('.mz-catext__utiliser')][0]);
  assert.match(bandeau(), /FaçadeBrique rougeDans le projet/);
  assert.match(bandeau(), /revenez à l’onglet du chat/);
  const stocke = JSON.parse(dom.window.localStorage.getItem(cleSelection('conv-vis33')) ?? '{}');
  assert.equal(stocke.projet?.facade?.ref, 'av-brique-rouge');
  // La carte d'habillage (autre composant / autre onglet) choisit une toiture : elle apparaît dans « Ma sélection ».
  const { ecrireSelection } = await import('./selectionCatalogue.ts');
  await act(async () => {
    ecrireSelection('conv-vis33', { ...lireSelectionBrute(dom.window.localStorage.getItem(cleSelection('conv-vis33'))), projet: { ...stocke.projet, toiture: { ref: 'av-zinc-anthracite', nom: 'Zinc anthracite' } } }, 'carte-test');
    await new Promise((r) => setTimeout(r, 80));
  });
  assert.match(bandeau(), /ToitureZinc anthraciteDans le projet/);
  await act(async () => { racine.unmount(); });
});
