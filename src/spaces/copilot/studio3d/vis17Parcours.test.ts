// node --test src/spaces/copilot/studio3d/vis17Parcours.test.ts
// LOT VIS-17 — parcours guidé côté ÉCRAN (20/11/2026) :
//   · sources assemblées depuis l'état réel (3D préparée du fil, mission, rendus, brief projet, habillage validé) ;
//   · UNE carte « Votre parcours » par conversation, ancrée sous la dernière réponse qui touche au parcours ;
//   · rendu des composants (panneau Espace 3D et carte du chat) : étapes numérotées, étape courante, actions.
// Cas réel : conversation f9fa5476… (Ascain) — 3D préparée 7b3a3a3b (résumé RÉEL), mission 51029769 terminée.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { ancreCarteParcours, assemblerSourcesEcran, instantaneDepuisSources, type EntreeEcran } from './parcoursEcran.ts';
import { calculerParcours, messageValidationApercu, prochaineEtape } from '../../../lib/studio/parcours.ts';
import { assemblerBriefProjet } from '../../../lib/studio/briefProjet.ts';
import { etatInitial, lireDemandeBrief, messageBrief } from './briefCreatif.ts';

const CONV = 'f9fa5476-11db-4eda-8692-2051aa13b653';
const PREP = '7b3a3a3b-7409-46a7-8f7e-816bf185bddd';
const APERCU = '44444444-4444-4444-8444-444444444444';
/** Sortie de studio_preparer_3d telle que le fil la garde (data.volume = résumé RÉEL de la préparation 7b3a3a3b). */
const sortiePrep = { status: 'ok', source: 'MimmozIA · Studio 3D', data: {
  preparation_id: PREP, conception_id: '9c4bee57-0000-4000-8000-000000000000', idu: '64065000AI0001', commune: 'Ascain',
  volume: { batiments: 3, gabarit: 'R+1', niveaux: 2, sdp_estimee_m2: 960, logements_places: 12, logements_vises: 12, controles: [], alertes: [] },
} };
type M = EntreeEcran['messages'][number];
const msg = (id: string, role: 'user' | 'assistant', text: string, toolCalls: M['toolCalls'] = []): M => ({ id, role, text, toolCalls, status: 'complete' });
const filAscain: M[] = [
  msg('u1', 'user', 'Lance une conception sur AI0001 + AI0002 à Ascain, petit collectif R+2'),
  msg('a1', 'assistant', 'Voici le devis de la mission.', [{ name: 'proposer_mission', status: 'success', output: { status: 'ok' } }]),
  msg('u2', 'user', 'Prépare le pack plaquette de ce projet (visuels de commercialisation), à partir de la 3D de la conception.'),
  msg('a2', 'assistant', 'La 3D est préparée.', [{ name: 'studio_preparer_3d', status: 'success', output: sortiePrep }]),
];
const entree = (extra: Partial<EntreeEcran> = {}): EntreeEcran => ({
  messages: filAscain, conversationId: CONV, typeChoisi: null,
  missions: [{ id: '51029769-0641-4773-bb8d-cf43f2cc8802', type: 'conception', statut: 'terminee', conversation_id: CONV, cree_le: '2026-11-20T05:20:08Z',
    criteres: { idu: '64065000AI0001', commune: 'Ascain', parcel_ids: ['64065000AI0001', '64065000AI0002'], programme: 'petit collectif R+2' } }],
  travaux: [], parcelle: null, brief: null, film: null, visite: null, ...extra,
});

test('cas réel Ascain vu de l’écran : 1–3 faits avec leurs résumés, prochaine étape Style & façades', () => {
  const s = assemblerSourcesEcran(entree());
  assert.equal(s.type, 'image');
  assert.equal(s.terrain, '64065000AI0001 · Ascain');
  assert.equal(s.conception?.statut, 'terminee');
  assert.equal(s.volume.resume, '3 bâtiments en R+1 · ≈ 960 m² de surface de plancher (estimée) · 12 logements placés sur 12 visés');
  const p = calculerParcours(s);
  assert.deepEqual(p.etapes.slice(0, 4).map((e) => e.statut), ['fait', 'fait', 'fait', 'a_faire']);
  assert.equal(prochaineEtape(p)?.titre, 'Style & façades');
  // Mission d'une AUTRE conversation : ignorée.
  const autre = assemblerSourcesEcran(entree({ messages: [], missions: [{ id: 'x', type: 'conception', statut: 'terminee', conversation_id: 'autre' }] }));
  assert.equal(autre.conception, null);
});

test('brief projet de l’étude : habillage mémorisé, vues choisies, gamme et typologie du logement témoin', () => {
  const brief = assemblerBriefProjet({
    etudeId: 'etude-vis17', precedent: null, style: null, maintenant: '2026-11-20T07:00:00.000Z', dates: { habillage: '2026-11-20T07:00:00.000Z' },
    programme: { batiments: [{ niveaux: 2, typologies: { T2: 4, T3: 8 }, surfaces: {} }] },
    habillage: { facade: 'brique', teinte: 'claire', menuiseries: 'anthracite', garde_corps: 'verre' },
    reglages: { gamme: 'premium', vues: ['trois_quarts_gauche', 'aerienne', 'sejour'], ambiance: 'fin_de_journee', saison: 'printemps' },
  });
  const s = assemblerSourcesEcran(entree({ brief }));
  assert.match(s.habillage.resume ?? '', /Brique claire/i);
  assert.deepEqual(s.rendu.vues, ['trois_quarts_gauche', 'aerienne', 'sejour']);
  assert.equal(s.rendu.vuesChoisies, true); assert.equal(s.rendu.etudeRattachee, true);
  assert.deepEqual(s.interieurs, { gamme: 'premium', typologie: 'T3' });
  const p = calculerParcours(s);
  assert.deepEqual(p.etapes.slice(3, 6).map((e) => e.statut), ['fait', 'fait', 'fait']);
  assert.match(p.etapes[4].resume, /Logement témoin T3, gamme premium/);
  assert.equal(p.etapes[5].action.cible, 'reglages-rendu');
  assert.equal(prochaineEtape(p)?.titre, 'Aperçu');
  // Ce qui part au serveur : seulement la part de l'écran.
  const i = instantaneDepuisSources(s, null);
  assert.deepEqual(Object.keys(i).sort(), ['film', 'habillage', 'interieurs', 'rendu', 'type', 'visite']);
});

test('habillage : demandé par Mimmo → « en cours » ; validé dans le fil (bloc mimmoza-brief) → « fait » avec son résumé', () => {
  const demande = { name: 'studio_lancer_rendu', status: 'success', output: { status: 'partial', data: {
    brief_requis: true, type: 'image', carte: 'brief_creatif', champs: { ambiance: { valeurs: ['jour', 'fin_de_journee'] } }, limites: { batiments: 3, balcons: true } } } };
  const fil = [...filAscain, msg('a3', 'assistant', 'Choisissez l’habillage.', [demande])];
  const attente = calculerParcours(assemblerSourcesEcran(entree({ messages: fil }))).etapes[3];
  assert.equal(attente.statut, 'en_cours');
  assert.match(attente.raison ?? '', /attend votre habillage/);
  const d = lireDemandeBrief(demande)!;
  const valide = [...fil, msg('u4', 'user', messageBrief(etatInitial(d), d, true))];
  const fait = calculerParcours(assemblerSourcesEcran(entree({ messages: valide }))).etapes[3];
  assert.equal(fait.statut, 'fait');
  assert.ok(fait.resume.length > 10, fait.resume);
});

test('rendus et aperçu validé : relus de la base et des messages', () => {
  const travaux = [{ id: APERCU, conversation_id: CONV, type: 'image', statut: 'termine', options: { vues: ['aerienne'], qualite: 'apercu' }, resultat: { images: [{}] }, cree_le: '2026-11-20T08:00:00Z' }];
  const avant = calculerParcours(assemblerSourcesEcran(entree({ travaux })));
  assert.equal(avant.etapes[6].statut, 'en_cours');
  assert.equal(avant.etapes[6].action.libelle, 'Voir et valider');
  const apres = calculerParcours(assemblerSourcesEcran(entree({ travaux, messages: [...filAscain, msg('u3', 'user', messageValidationApercu(APERCU, 'image'))] })));
  assert.equal(apres.etapes[6].statut, 'fait');
  assert.equal(apres.etapes[7].statut, 'a_faire');
});

test('type de parcours : choisi dans le sélecteur, sinon déduit du dernier message ; réglages du film', () => {
  assert.equal(assemblerSourcesEcran(entree({ messages: [...filAscain, msg('u3', 'user', 'Et un film de 30 secondes ?')] })).type, 'film');
  const s = assemblerSourcesEcran(entree({ typeChoisi: 'visite', visite: { interieurs: true, resolution: '6k', ambiance: 'jour' } }));
  assert.equal(s.type, 'visite');
  assert.equal(calculerParcours(s).etapes[5].titre, 'Pièces & points de vue');
  assert.equal(calculerParcours(s).etapes[5].statut, 'fait');
});

test('UNE carte « Votre parcours » : sous la dernière réponse qui touche au parcours, jamais pour une conversation sans visuel', () => {
  const s = assemblerSourcesEcran(entree());
  assert.equal(ancreCarteParcours(filAscain, s), 'a2');
  const suite = [...filAscain, msg('u3', 'user', 'Quel est le prix moyen au m² à Ascain ?'), msg('a3', 'assistant', 'Environ 5 000 €/m².')];
  assert.equal(ancreCarteParcours(suite, s), 'a2'); // la carte ne se duplique pas et ne suit pas une question hors sujet
  const encore = [...suite, msg('u4', 'user', 'Ok, je veux faire les images'), msg('a4', 'assistant', 'Étape 4 — Style & façades.')];
  assert.equal(ancreCarteParcours(encore, s), 'a4'); // mise à jour en place : une seule carte, déplacée sous la dernière réponse
  const dvf = [msg('u1', 'user', 'Prix au m² à Sare ?'), msg('a1', 'assistant', '4 200 €/m².')];
  assert.equal(ancreCarteParcours(dvf, assemblerSourcesEcran(entree({ messages: dvf, missions: [] }))), null);
  // Conception terminée sans autre signal : la carte apparaît sous la dernière réponse.
  assert.equal(ancreCarteParcours(dvf, assemblerSourcesEcran(entree({ messages: dvf }))), 'a1');
});

// ── Rendu des composants (esbuild → react-dom/server) ───────────────────────
const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, '../../../..');
async function chargerComposants() {
  const require = createRequire(import.meta.url);
  const esbuild = require('esbuild') as typeof import('esbuild');
  const r = esbuild.buildSync({
    entryPoints: [path.join(ICI, 'ParcoursGuide.tsx')], bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic',
    external: ['react', 'react-dom', 'react/jsx-runtime', 'lucide-react'], loader: { '.css': 'empty' }, logLevel: 'silent',
  });
  const dossier = path.join(RACINE, 'node_modules', '.cache', 'vis17');
  mkdirSync(dossier, { recursive: true });
  const fichier = path.join(dossier, 'ParcoursGuide.mjs');
  writeFileSync(fichier, r.outputFiles[0].text);
  const m = await import(pathToFileURL(fichier).href) as typeof import('./ParcoursGuide.tsx');
  const react = await import('react');
  const serveur = await import('react-dom/server');
  return { m, h: react.createElement, rendre: serveur.renderToStaticMarkup };
}
const texte = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, '’').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ');

test('panneau Espace 3D : 8 étapes numérotées, courante mise en avant, actions des outils existants, sélecteur', async () => {
  const { m, h, rendre } = await chargerComposants();
  const p = calculerParcours(assemblerSourcesEcran(entree()));
  const html = rendre(h(m.ParcoursPanneau, { parcours: p, onAction: () => undefined, onType: () => undefined }));
  const t = texte(html);
  for (const titre of ['1. Terrain', '2. Programme & conception', '3. Volume 3D', '4. Style & façades', '5. Intérieurs', '6. Vues & ambiance', '7. Aperçu', '8. Images finales & livraison']) assert.ok(t.includes(titre), titre);
  assert.match(t, /3 étapes sur 8 · prochaine : 4\. Style & façades/);
  assert.equal((html.match(/aria-current="step"/g) ?? []).length, 1);
  assert.match(html, /is-style[^"]*|mz-parcours__etape is-a_faire is-courante/);
  assert.match(t, /Voir \/ ajuster/); // étape 3 faite : ajuster le volume
  assert.match(t, /Ouvrir dans le Studio/);
  assert.match(t, /Validez d’abord l’aperçu\. → étape 7/);
  assert.match(html, /role="radio" aria-checked="true"[^>]*>Images/);
  assert.doesNotMatch(t, /studio_|preparation_id|mimmoza-/); // pas de jargon technique
});

test('carte du chat : compacte, prochaine étape en bouton principal, lien vers le détail', async () => {
  const { m, h, rendre } = await chargerComposants();
  const p = calculerParcours(assemblerSourcesEcran(entree()));
  const html = rendre(h(m.CarteParcours, { parcours: p, onAction: () => undefined, onType: () => undefined, onDetail: () => undefined }));
  const t = texte(html);
  assert.match(t, /Votre parcours · Images/);
  assert.match(t, /3 sur 8 étapes faites/);
  assert.match(t, /Prochaine étape : 4\. Style & façades/);
  assert.match(html, /class="is-primaire"[^>]*>Choisir/);
  assert.match(t, /Voir le détail dans l’Espace 3D/);
  assert.equal((html.match(/<li>/g) ?? []).length, 8);
  const fini = calculerParcours({ ...assemblerSourcesEcran(entree()), habillage: { resume: 'Brique', attenduParMimmo: false }, interieurs: { gamme: 'standard', typologie: null },
    rendu: { vues: ['aerienne'], vuesChoisies: true, ambiance: null, saison: null, fond: null, etudeRattachee: false },
    travaux: [{ id: APERCU, type: 'image', statut: 'termine', qualite: 'apercu', cree_le: '2026-11-20T08:00:00Z', vues: ['aerienne'], nbImages: 1, livraison: false },
      { id: 'f', type: 'image', statut: 'termine', qualite: 'finale', cree_le: '2026-11-20T09:00:00Z', vues: ['aerienne'], nbImages: 1, livraison: true }], apercuValide: APERCU });
  assert.match(texte(rendre(h(m.CarteParcours, { parcours: fini, onAction: () => undefined }))), /Toutes les étapes sont faites/);
});
