// node --test src/spaces/copilot/studio3d/vis20ParcoursChat.test.ts
// VIS-20 (23/11/2026) — « Le parcours ne quitte jamais le chat » : aucune action du parcours ne navigue hors de la page
// MimmozIA ; étape 1 (adresse / parcelles, carte → assiette) et étape 2 (programme) envoient le bon message à Mimmo.
// Cas réel : conversation a7cca310… (Ascain, AI0001 + AI0002) — l'étape 1 a mené à /promoteur/foncier (action_creer_operation).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { calculerParcours, sourcesVides, TYPES_PARCOURS, type CibleParcours, type SourcesParcours } from '../../../lib/studio/parcours.ts';
import {
  basculerParcelleAssiette, lireSaisieTerrain, lireTypologies, messageAssietteCarte, messageProgrammeParcours, messageTerrainParcours,
  programmeDeLaDemande, requeteCarte, resumeAssiette, type ParcelleCarte,
} from '../../../lib/studio/parcoursTerrain.ts';
import { estPageMimmozIA, messageSansNavigation, navigationPermise } from '../actions/resterDansLeChat.ts';

/** Cibles traitées DANS la page (CopilotChat.actionHabituelle / JarvisDraftPanel) : chat, panneau, Studio intégré. */
const CIBLES_DANS_LA_PAGE: ReadonlySet<CibleParcours> = new Set<CibleParcours>([
  'chat', 'terrain', 'programme', 'dimensions', 'studio-batiment', 'habillage', 'studio-interieur', 'reglages-rendu',
  'feuille-image', 'feuille-film', 'feuille-visite', 'apercu', 'final', 'resultats',
]);

function etats(): SourcesParcours[] {
  const v = sourcesVides();
  const t = 'AI0001 + AI0002 · Ascain';
  return [
    v,
    { ...v, terrain: t },
    { ...v, terrain: t, conception: { statut: 'devis', resume: null } },
    { ...v, terrain: t, conception: { statut: 'en_cours', resume: null } },
    { ...v, terrain: t, conception: { statut: 'echec', resume: null } },
    { ...v, terrain: t, conception: { statut: 'terminee', resume: '12 logements' }, volume: { pret: true, resume: 'R+1' } },
  ];
}

test('aucune action du parcours (toutes étapes, tous types, tous états) ne mène hors de la page', () => {
  for (const type of TYPES_PARCOURS) {
    for (const s of etats()) {
      for (const e of calculerParcours({ ...s, type }).etapes) {
        for (const a of [e.action, e.actionSecondaire].filter(Boolean)) {
          assert.ok(CIBLES_DANS_LA_PAGE.has(a!.cible), `${type}/${e.cle} : cible ${a!.cible}`);
          assert.doesNotMatch(a!.message ?? '', /\/promoteur|\/studio|https?:/, `${type}/${e.cle} : message`);
        }
      }
    }
  }
});

test('les composants du parcours ne contiennent aucune navigation (navigate, Link, location, href interne)', () => {
  const fichiers = ['ParcoursGuide.tsx', 'EtapesTerrainProgramme.tsx', 'ReglagesParcours.tsx', 'parcoursEcran.ts', 'useParcours.ts'];
  for (const f of fichiers) {
    const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /useNavigate|navigate\(|<Link\b|location\.(assign|replace|href\s*=)|window\.open\(|href=["'{`]\/(promoteur|studio)/, f);
  }
  // Panneau Espace 3D : la seule navigation de page reste celle d'avant (aucune vers /promoteur dans les étapes).
  const panneau = readFileSync(new URL('./JarvisDraftPanel.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(panneau, /useNavigate|location\.assign|href=["'{`]\/promoteur/);
});

test('étape 1 : cible « terrain » (champ + carte du panneau), jamais un message « aide-moi à choisir »', () => {
  const p = calculerParcours(sourcesVides());
  assert.equal(p.etapes[0].action.cible, 'terrain');
  assert.equal(p.etapes[0].action.libelle, 'Choisir');
  assert.equal(p.etapes[0].reglage, 'terrain');
  const fait = calculerParcours({ ...sourcesVides(), terrain: 'AI0001 · Ascain' }).etapes[0];
  assert.equal(fait.action.cible, 'terrain'); assert.equal(fait.action.libelle, 'Modifier'); assert.equal(fait.reglage, 'terrain');
});

test('étape 2 : programme dans l’étape (lancer / modifier), devis et suivi par message à Mimmo', () => {
  const c = (statut: string | null) => calculerParcours({ ...sourcesVides(), terrain: 'AI0001', conception: statut ? { statut, resume: null } : null }).etapes[1];
  assert.equal(c(null).action.cible, 'programme'); assert.equal(c(null).action.libelle, 'Lancer'); assert.equal(c(null).reglage, 'programme');
  assert.equal(c('echec').action.cible, 'programme');
  assert.equal(c('devis').action.cible, 'chat'); assert.equal(c('devis').action.libelle, 'Valider'); assert.equal(c('devis').reglage, undefined);
  assert.equal(c('en_cours').action.cible, 'chat'); assert.equal(c('en_cours').reglage, undefined);
  assert.equal(c('terminee').action.cible, 'programme'); assert.equal(c('terminee').action.libelle, 'Modifier');
  // Étape bloquée (pas de terrain) : pas de champ.
  assert.equal(calculerParcours(sourcesVides()).etapes[1].statut, 'bloquee');
});

test('étape 1 : la saisie envoie le bon message (assiette, parcelle seule, adresse)', () => {
  assert.equal(messageTerrainParcours('je choisis la parcelle 64065000AI0001 et 2'),
    'Mon terrain : parcelles 64065000AI0001 et 64065000AI0002 (assiette de 2 parcelles). Retrouve-les, fais-moi confirmer ce terrain, puis enchaîne ici, dans le chat, sur l’étape 2 — Programme & conception.');
  assert.equal(messageTerrainParcours('64065000AI0001'),
    'Mon terrain : parcelle 64065000AI0001. Retrouve-la, fais-moi confirmer ce terrain, puis enchaîne ici, dans le chat, sur l’étape 2 — Programme & conception.');
  assert.match(messageTerrainParcours('12 rue du Port, 64310 Ascain') ?? '', /^Mon terrain se trouve à cette adresse : 12 rue du Port, 64310 Ascain\. Trouve la ou les parcelles/);
  assert.equal(messageTerrainParcours('  '), null);
  assert.deepEqual(lireSaisieTerrain('AI0001 + AI0002').parcelles, ['AI0001', 'AI0002']);
  assert.deepEqual(lireSaisieTerrain('section AI n°12, 13').parcelles, ['AI0012', 'AI0013']);
  assert.deepEqual(lireSaisieTerrain('64065000AI0001, 64065000AI0001').parcelles, ['64065000AI0001']);
  assert.deepEqual(lireSaisieTerrain('le 12 avenue de la gare').parcelles, []);
});

test('carte : centrage sur un IDU complet ou une adresse, rien pour une parcelle sans commune', () => {
  assert.deepEqual(requeteCarte('64065000AI0001 et 2'), { genre: 'idu', insee: '64065', section: 'AI', numero: '0001' });
  assert.deepEqual(requeteCarte('Ascain'), { genre: 'adresse', q: 'Ascain' });
  assert.equal(requeteCarte('AI0001'), null);
});

test('sélection multiple sur la carte → assiette (bascule, surface totale, message de confirmation)', () => {
  let sel: ParcelleCarte[] = [];
  sel = basculerParcelleAssiette(sel, { id: '64065000ai0001', surface_m2: 1234.4 });
  sel = basculerParcelleAssiette(sel, { id: '64065000AI0002', surface_m2: 1115 });
  assert.deepEqual(sel, [{ id: '64065000AI0001', surface_m2: 1234 }, { id: '64065000AI0002', surface_m2: 1115 }]);
  const r = resumeAssiette(sel);
  assert.equal(r.surface_m2, 2349);
  assert.match(r.libelle, /^AI0001 \+ AI0002 · 2\s349 m² \(assiette de 2 parcelles\)$/);
  assert.match(messageAssietteCarte(sel) ?? '', /^Je confirme mon terrain, choisi sur la carte : assiette de 2 parcelles — 64065000AI0001 \(1\s234 m²\) et 64065000AI0002 \(1\s115 m²\), 2\s349 m² cadastraux au total\. Retiens ce terrain pour le projet, puis enchaîne ici, dans le chat, sur l’étape 2/);
  // Second clic : retirée ; une surface inconnue → total inconnu (jamais inventé).
  sel = basculerParcelleAssiette(sel, { id: '64065000AI0002', surface_m2: null });
  assert.deepEqual(sel.map((p) => p.id), ['64065000AI0001']);
  assert.match(messageAssietteCarte(sel) ?? '', /^Je confirme mon terrain, choisi sur la carte : parcelle 64065000AI0001 \(1\s234 m²\)\./);
  assert.equal(resumeAssiette([...sel, { id: 'X', surface_m2: null }]).surface_m2, null);
  assert.equal(messageAssietteCarte([]), null);
});

test('étape 2 : programme pré-rempli depuis la demande et message de mission', () => {
  assert.deepEqual(programmeDeLaDemande(['Je veux un R+4 de 28 logements T1/T3']), { logements: 28, niveaux: 5, typologies: ['T1', 'T3'] });
  assert.deepEqual(programmeDeLaDemande(['12 logements sur 2 niveaux', 'finalement 3 étages']), { logements: 12, niveaux: 4, typologies: [] });
  assert.deepEqual(lireTypologies('t2, T3 / T2'), ['T2', 'T3']);
  assert.equal(messageProgrammeParcours({ logements: 28, niveaux: 5, typologies: ['T1', 'T3'] }),
    'Étape 2 — Programme & conception : propose-moi ici, dans le chat, la mission de conception sur mon terrain avec ce programme : 28 logements, R+4 (5 niveaux), typologies T1 et T3.');
  assert.match(messageProgrammeParcours({ logements: null, niveaux: null, typologies: [] }), /avec le programme que tu connais/);
});

test('cartes d’action de Mimmo : sur MimmozIA, aucune navigation vers Foncier / Programmation, ni création d’opération', () => {
  assert.ok(estPageMimmozIA('/mimmozia')); assert.ok(estPageMimmozIA('/accueil')); assert.ok(!estPageMimmozIA('/promoteur/foncier'));
  assert.equal(navigationPermise('create_operation', '/promoteur/foncier', '/mimmozia'), false);
  assert.equal(navigationPermise('run_step', '/promoteur/programmation?study=x&autorun=1', '/mimmozia'), false);
  assert.equal(navigationPermise('open_page', '/promoteur/foncier?study=x', '/mimmozia'), false);
  assert.equal(navigationPermise('open_page', '/promoteur/implantation-2d', '/accueil'), false);
  assert.equal(navigationPermise('open_page', '/veille/marche', '/mimmozia'), true);
  // Ailleurs (drawer sur une page promoteur) : comportement d'avant.
  assert.equal(navigationPermise('create_operation', '/promoteur/foncier', '/promoteur/marche'), true);
  assert.equal(navigationPermise('open_page', undefined, '/promoteur/marche'), false);
  assert.equal(messageSansNavigation('Opération « X » créée.'), 'Opération « X » créée. On continue ici, dans le chat.');
});

// ── Rendu (esbuild + react-dom/server, comme vis18bParcours) ────────────────────────────────────────────────────
const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, '../../../..');
async function charger() {
  const require = createRequire(import.meta.url);
  const esbuild = require('esbuild') as typeof import('esbuild');
  const souches = { name: 'souches', setup(b: { onResolve: Function; onLoad: Function }) {
    b.onResolve({ filter: /lib\/studio\/travaux$|\/PhotoClientRue$/ }, (a: { path: string }) => ({ path: a.path, namespace: 'souche' }));
    b.onLoad({ filter: /.*/, namespace: 'souche' }, () => ({ contents: 'export const demanderCouverturePhotoRue = async () => ({ ok: false, raison: "x" }); export const PhotoClientRue = () => null;', loader: 'js' }));
  } };
  const r = await esbuild.build({
    stdin: { contents: "export * from './ParcoursGuide.tsx'; export * from './ReglagesParcours.tsx';", resolveDir: ICI, loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', alias: { '@': path.join(RACINE, 'src') },
    external: ['react', 'react-dom', 'react/jsx-runtime', 'lucide-react'], loader: { '.css': 'empty' }, logLevel: 'silent', plugins: [souches as never],
  });
  const dossier = path.join(RACINE, 'node_modules', '.cache', 'vis20');
  mkdirSync(dossier, { recursive: true });
  const fichier = path.join(dossier, 'Etapes.mjs');
  writeFileSync(fichier, r.outputFiles[0].text);
  const m = await import(pathToFileURL(fichier).href) as typeof import('./ParcoursGuide.tsx') & typeof import('./ReglagesParcours.tsx');
  const react = await import('react');
  const serveur = await import('react-dom/server');
  return { m, h: react.createElement, rendre: serveur.renderToStaticMarkup };
}
const texte = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, '’').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

test('rendu : étape 1 dans le panneau ET dans la carte du chat (champ, carte) ; étape 2 pré-remplie depuis la demande', async () => {
  (globalThis as { window?: unknown }).window = { localStorage: { getItem: () => null, setItem() {} }, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } };
  try {
    const { m, h, rendre } = await charger();
    const fil = [{ id: 'u1', role: 'user', text: 'Je veux un R+4 de 28 logements T1/T3 à Ascain' }];
    const vide = calculerParcours(sourcesVides());
    const panneau = texte(rendre(h(m.ParcoursPanneau, { parcours: vide, onAction: () => undefined, reglage: (e) => m.reglageDeLEtape(e, { conversationId: null, messages: fil as never, onSend: () => undefined }) })));
    assert.match(panneau, /Envoyer à Mimmo/);
    assert.match(panneau, /Choisir sur la carte/);
    assert.match(panneau, /Plusieurs parcelles = une assiette/);
    const chat = rendre(h(m.CarteParcours, { parcours: vide, onAction: () => undefined, reglage: (e) => m.reglageDeLEtape(e, { conversationId: 'c', messages: fil as never, onSend: () => undefined, dansLeChat: true, onOuvrirCarte: () => undefined }) }));
    assert.match(chat, /aria-label="Adresse ou numéro\(s\) de parcelle\(s\) du terrain"/);
    assert.doesNotMatch(chat, /href=/);
    const etape2 = calculerParcours({ ...sourcesVides(), terrain: 'AI0001 + AI0002 · Ascain' });
    const html2 = rendre(h(m.CarteParcours, { parcours: etape2, onAction: () => undefined, reglage: (e) => m.reglageDeLEtape(e, { conversationId: 'c', messages: fil as never, onSend: () => undefined, dansLeChat: true }) }));
    assert.match(html2, /value="28"/);
    assert.match(html2, /value="5"/);
    assert.match(html2, /value="T1, T3"/);
    assert.match(texte(html2), /Proposer la mission/);
    // Terrain déjà choisi : dans le panneau, le champ reste replié derrière « Changer de terrain ».
    const replie = texte(rendre(h(m.ParcoursPanneau, { parcours: etape2, onAction: () => undefined, reglage: (e) => m.reglageDeLEtape(e, { conversationId: 'c', messages: fil as never, onSend: () => undefined }) })));
    assert.match(replie, /Changer de terrain/);
  } finally { delete (globalThis as { window?: unknown }).window; }
});
