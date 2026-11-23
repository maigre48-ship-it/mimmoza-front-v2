// node --test src/spaces/copilot/studio3d/vis18bParcours.test.ts
// LOT VIS-18b (20/11/2026) — parcours complet : fond de l'image dans l'étape 6, gamme / cible sans étude (étapes 4 / 5),
// aperçu de film et de visite (étape 7), point d'accroche du témoin personnalisé (VIS-18a).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { assemblerSourcesEcran, instantaneDepuisSources, type EntreeEcran } from './parcoursEcran.ts';
import {
  calculerParcours, CIBLES_PARCOURS, fondDuParcours, GAMMES_PARCOURS, lireInstantaneParcours, lireReglageProjet, messageValidationApercu,
  prochaineEtape, sourcesDeLInstantane, sourcesVides, travailParcours, type SourcesParcours,
} from '../../../lib/studio/parcours.ts';
import { contourDeParcelle, devisDeLEtape, devisImageEnAttente, fondDuChoix, messageFondParcours, resumeFond } from './reglagesParcoursLogique.ts';
import { dureeEstimeeApercu, resumeOptions, validerOptions } from '../../../lib/studio/travauxLogique.ts';
import { lireTemoinPersonnalise } from './temoinStudio.ts';

const CONV = 'f9fa5476-11db-4eda-8692-2051aa13b653';
const UID = '0b0b0b0b-1111-4111-8111-111111111111';
const PHOTO = { chemin: `${UID}/2c2c2c2c-2222-4222-8222-222222222222.jpg`, octets: 2_000_000, point_de_vue: { lon: -1.62, lat: 43.31, cap_deg: 90 } };
const FILM_AP = '55555555-5555-4555-8555-555555555555';
const VISITE_AP = '66666666-6666-4666-8666-666666666666';
const sortiePrep = { status: 'ok', data: { preparation_id: '7b3a3a3b-7409-46a7-8f7e-816bf185bddd', conception_id: '9c4bee57-0000-4000-8000-000000000000', idu: '64065000AI0001', commune: 'Ascain',
  volume: { batiments: 3, gabarit: 'R+1', niveaux: 2, sdp_estimee_m2: 960, logements_places: 12, logements_vises: 12, controles: [], alertes: [] } } };
type M = EntreeEcran['messages'][number];
const msg = (id: string, role: 'user' | 'assistant', text: string, toolCalls: M['toolCalls'] = []): M => ({ id, role, text, toolCalls, status: 'complete' });
const fil: M[] = [
  msg('u1', 'user', 'Prépare la 3D de mon projet.'),
  msg('a1', 'assistant', 'La 3D est préparée.', [{ name: 'studio_preparer_3d', status: 'success', output: sortiePrep }]),
];
const entree = (extra: Partial<EntreeEcran> = {}): EntreeEcran => ({
  messages: fil, conversationId: CONV, typeChoisi: null,
  missions: [{ id: 'm', type: 'conception', statut: 'terminee', conversation_id: CONV, cree_le: '2026-11-20T05:00:00Z', criteres: { idu: '64065000AI0001' } }],
  travaux: [], parcelle: null, brief: null, film: null, visite: null, ...extra,
});
const devisImage = (fond: string) => ({ name: 'studio_lancer_rendu', status: 'success', output: { status: 'confirmation_requise', data: {
  type: 'image', options: { vues: ['trois_quarts_gauche'], ...(fond === 'etude' ? {} : { fond }) },
  fond_image: { choisi: fond, couverture: { couverte: true, photos: 3, rayon_m: 60, licence: 'Licence Ouverte 2.0' }, contour: [[-1.62, 43.31], [-1.619, 43.31], [-1.619, 43.311], [-1.62, 43.311]] } } } });

// ── 1. Fond de l'image dans l'étape 6 ────────────────────────────────────────
test('fond : choisi dans l’étape 6 (mémoire), prime sur le dernier devis ; résumé d’une ligne ; réglage « fond » proposé', () => {
  const sans = calculerParcours(assemblerSourcesEcran(entree())).etapes[5];
  assert.equal(sans.reglage, 'fond');
  assert.doesNotMatch(sans.resume, /fond/);
  const devis = [...fil, msg('a2', 'assistant', 'Voici le devis.', [devisImage('etude')])];
  assert.match(calculerParcours(assemblerSourcesEcran(entree({ messages: devis }))).etapes[5].resume, /fond d’étude/);
  const rue = assemblerSourcesEcran(entree({ messages: devis, fond: fondDuChoix('photo_rue') }));
  assert.equal(rue.rendu.fond, 'photo_rue');
  assert.match(calculerParcours(rue).etapes[5].resume, /photo de la rue/);
  // Film / visite : pas de fond (étape 6 = scénario / pièces).
  assert.equal(calculerParcours(assemblerSourcesEcran(entree({ typeChoisi: 'film' }))).etapes[5].reglage, undefined);
  assert.equal(resumeFond(null), 'Fond : étude seule (par défaut) — ou photo de la rue, ou votre photo.');
  assert.equal(resumeFond({ fond: 'photo_client', photo_client: PHOTO }), 'Fond : votre photo du trottoir.');
});

test('fond : envoyé au serveur dans l’instantané (options complètes), relu avec les règles de la base', () => {
  const s = assemblerSourcesEcran(entree({ fond: fondDuChoix('photo_client', PHOTO) }));
  const i = instantaneDepuisSources(s, null, fondDuChoix('photo_client', PHOTO));
  assert.deepEqual(i.rendu.fond, { fond: 'photo_client', photo_client: PHOTO });
  const brut = JSON.parse(JSON.stringify(i)) as unknown;
  assert.deepEqual(fondDuParcours(brut), { fond: 'photo_client', photo_client: PHOTO });
  assert.equal(sourcesDeLInstantane(lireInstantaneParcours(brut), 'image').rendu.fond, 'photo_client');
  // Hors format → écarté (jamais deviné) ; étude seule → {} (valeur par défaut).
  assert.equal(fondDuParcours({ rendu: { fond: { fond: 'photo_client', photo_client: { chemin: '../../etc/passwd', octets: 1 } } } }), null);
  assert.equal(fondDuParcours({ rendu: { fond: { fond: 'satellite' } } }), null);
  assert.equal(fondDuParcours({ rendu: { fond: { fond: 'photo_rue', calage_client: {} } } }), null);
  assert.deepEqual(fondDuParcours({ rendu: { fond: {} } }), {});
  assert.equal(fondDuParcours({ rendu: {} }), null);
  // Sans fond : instantané identique à VIS-17 (aucune clé ajoutée).
  assert.deepEqual(Object.keys(instantaneDepuisSources(assemblerSourcesEcran(entree()), null).rendu).sort(), ['ambiance', 'etudeRattachee', 'saison', 'vues', 'vuesChoisies']);
});

test('fond : devis d’image en attente → nouveau devis demandé ; sinon simple mémoire ; tuiles sur le devis ou la parcelle', () => {
  const enAttente = [...fil, msg('a2', 'assistant', 'Voici le devis.', [devisImage('etude')])];
  assert.equal(devisImageEnAttente(enAttente), true);
  assert.equal(devisImageEnAttente([...enAttente, msg('u3', 'user', 'ok')]), false);
  assert.equal(devisImageEnAttente(fil), false);
  assert.match(messageFondParcours({ fond: 'photo_rue' }), /^Fond de l’image : Photo de la rue \(Panoramax \/ IGN\) — choisi dans le parcours/);
  const d = devisDeLEtape(enAttente, { fond: 'photo_rue' }, null);
  assert.equal(d.choisi, 'photo_rue'); assert.equal(d.contour?.length, 4);
  const parcelle = { geometry: { type: 'MultiPolygon', coordinates: [[[[-1.62, 43.31], [-1.619, 43.31], [-1.619, 43.311], [-1.62, 43.31]]]] } };
  const contour = contourDeParcelle(parcelle);
  assert.equal(contour?.length, 3);
  const vide = devisDeLEtape(fil, null, contour);
  assert.equal(vide.choisi, 'etude'); assert.equal(vide.couverture, null); assert.equal(vide.contour, contour);
  assert.deepEqual(fondDuChoix('etude'), {});
  assert.deepEqual(fondDuChoix('photo_client', null), {});
});

// ── 2. Gamme et cible sans étude ─────────────────────────────────────────────
test('gamme / cible sans étude : réglages dans les étapes 4 / 5, mémorisés, libellés Standard / Confort / Premium', () => {
  const p0 = calculerParcours(assemblerSourcesEcran(entree()));
  assert.equal(p0.etapes[3].reglage, 'cible');
  assert.equal(p0.etapes[4].reglage, 'gamme');
  assert.equal(p0.etapes[4].actionSecondaire, undefined);
  const s = assemblerSourcesEcran(entree({ projet: { gamme: 'standard', cible: 'Familles' } }));
  assert.deepEqual(s.interieurs, { gamme: 'standard', typologie: null, cible: 'Familles', origine: 'conversation' });
  const p = calculerParcours(s);
  assert.equal(p.etapes[4].statut, 'fait');
  assert.match(p.etapes[4].resume, /gamme confort/);
  assert.match(p.etapes[3].resume, /pour : familles/);
  assert.deepEqual(GAMMES_PARCOURS.map((g) => [g.valeur, g.libelle]), [['entree', 'Standard'], ['standard', 'Confort'], ['premium', 'Premium']]);
  assert.deepEqual(CIBLES_PARCOURS, ['Primo-accédants', 'Familles', 'Investisseurs', 'Seniors']);
  // Lecture défensive de la mémoire : hors liste → écarté.
  assert.deepEqual(lireReglageProjet({ gamme: 'luxe', cible: 'Pirates' }), { gamme: null, cible: null });
  assert.deepEqual(lireReglageProjet({ gamme: 'premium', cible: 'Seniors' }), { gamme: 'premium', cible: 'Seniors' });
  // L'instantané les porte (le bloc « PARCOURS » du serveur voit l'étape 5 faite).
  const i = lireInstantaneParcours(JSON.parse(JSON.stringify(instantaneDepuisSources(s, null))));
  assert.equal(calculerParcours(sourcesDeLInstantane(i, 'image')).etapes[4].statut, 'fait');
});

test('gamme / cible : les cibles sont reconnues par le worker (mêmes motifs que interieursImage.ts cibleDuBrief)', () => {
  // Copie des motifs du worker (mimmozia-studio worker/src/interieursImage.ts, VIS-05) : aucune cible « non reconnue ».
  const motif = (c: string) => { const s = c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); return /primo|premier achat|jeune actif/.test(s) ? 'primo_accedant' : /invest|locati|defisc|pinel|lmnp/.test(s) ? 'investisseur_locatif' : /senior|retrait|age/.test(s) ? 'senior' : /famil|enfant/.test(s) ? 'famille' : null; };
  assert.deepEqual(CIBLES_PARCOURS.map(motif), ['primo_accedant', 'famille', 'investisseur_locatif', 'senior']);
});

test('gamme / cible : avec une étude, rien ne change (accès « Gamme » vers le brief de l’étude, pas de petit réglage)', () => {
  const avecEtude: SourcesParcours = { ...sourcesVides('image'), terrain: 'x', conception: { statut: 'terminee', resume: null }, volume: { pret: true, resume: null },
    rendu: { ...sourcesVides().rendu, etudeRattachee: true }, interieurs: { gamme: 'premium', typologie: 'T3' } };
  const p = calculerParcours(avecEtude);
  assert.equal(p.etapes[3].reglage, undefined);
  assert.equal(p.etapes[4].reglage, undefined);
  assert.equal(p.etapes[4].actionSecondaire?.cible, 'reglages-rendu');
  assert.match(p.etapes[4].resume, /Logement témoin T3, gamme premium/);
});

// ── 3. Aperçu de film et de visite ───────────────────────────────────────────
test('aperçu du film : travail film qualite « apercu » → à valider → validé ; film final débloqué ; un aperçu d’image ne compte pas', () => {
  const film = { duree_s: 60, format: '16:9', musique: true, interieurs: false, ambiance: 'jour' };
  const base = entree({ typeChoisi: 'film', film });
  const p0 = calculerParcours(assemblerSourcesEcran(base));
  assert.match(p0.etapes[6].resume, /Film court en basse définition/);
  assert.equal(p0.etapes[7].statut, 'bloquee');
  const imageAp = { id: '44444444-4444-4444-8444-444444444444', type: 'image', statut: 'termine', options: { vues: ['face'], qualite: 'apercu' }, resultat: { images: [{}] }, cree_le: '2026-11-20T08:00:00Z' };
  assert.equal(calculerParcours(assemblerSourcesEcran({ ...base, travaux: [imageAp] })).etapes[6].statut, 'a_faire');
  const filmAp = { id: FILM_AP, type: 'film', statut: 'termine', options: { ...film, qualite: 'apercu' }, resultat: { video_path: 'x' }, cree_le: '2026-11-20T09:00:00Z' };
  const p1 = calculerParcours(assemblerSourcesEcran({ ...base, travaux: [filmAp] }));
  assert.equal(p1.etapes[6].statut, 'en_cours'); assert.equal(p1.etapes[6].action.libelle, 'Voir et valider');
  // L'aperçu n'est PAS un film final.
  assert.equal(p1.etapes[7].statut, 'bloquee');
  const valide = { ...base, travaux: [filmAp], messages: [...fil, msg('u3', 'user', messageValidationApercu(FILM_AP, 'film'))] };
  const p2 = calculerParcours(assemblerSourcesEcran(valide));
  assert.equal(p2.etapes[6].statut, 'fait'); assert.equal(p2.etapes[6].resume, 'Aperçu du film validé.');
  assert.equal(p2.etapes[7].statut, 'a_faire');
  assert.notEqual(prochaineEtape(p2)?.cle, 'apercu');
});

test('aperçu de la visite : même règle ; travaux film / visite lus avec leur qualité', () => {
  assert.equal(travailParcours({ id: VISITE_AP, type: 'visite360', statut: 'en_cours', options: { qualite: 'apercu' } })?.qualite, 'apercu');
  assert.equal(travailParcours({ id: VISITE_AP, type: 'visite360', statut: 'en_cours', options: { resolution: '6k' } })?.qualite, 'finale');
  const visite = { interieurs: true, resolution: '6k', ambiance: 'jour' };
  const enCalcul = { id: VISITE_AP, type: 'visite360', statut: 'en_cours', options: { ...visite, qualite: 'apercu' }, resultat: null, cree_le: '2026-11-20T09:00:00Z' };
  const p = calculerParcours(assemblerSourcesEcran(entree({ typeChoisi: 'visite', visite, travaux: [enCalcul] })));
  assert.equal(p.etapes[6].statut, 'en_cours'); assert.match(p.etapes[6].resume, /en calcul/);
  assert.equal(p.etapes[7].statut, 'bloquee');
});

test('aperçu film / visite côté site : options (qualite « apercu » gardée, « finale » non recopiée), résumé, durée', () => {
  const f = validerOptions('film', { duree_s: 30, qualite: 'apercu' });
  assert.deepEqual(f, { ok: true, valeur: { ...(validerOptions('film', { duree_s: 30 }) as { valeur: object }).valeur, qualite: 'apercu' } });
  assert.deepEqual(validerOptions('film', { qualite: 'finale' }), validerOptions('film', {}));
  assert.deepEqual(validerOptions('visite360', { qualite: 'apercu' }), { ok: true, valeur: { ambiance: 'jour', interieurs: true, resolution: '6k', qualite: 'apercu' } });
  assert.equal(validerOptions('visite360', { qualite: 'brouillon' }).ok, false);
  assert.match(resumeOptions('film', { duree_s: 30, musique: true, qualite: 'apercu' }), /^30 s · en journée · paysage · intérieurs · aperçu$/);
  assert.match(resumeOptions('visite360', { qualite: 'apercu' }), /aperçu 3K/);
  assert.equal(resumeOptions('film', { duree_s: 30, qualite: 'finale' }), resumeOptions('film', { duree_s: 30 }));
  assert.doesNotMatch(resumeOptions('film', { duree_s: 30 }), /aperçu/);
  assert.match(dureeEstimeeApercu('film'), /30 min à 1 h 30/);
  assert.match(dureeEstimeeApercu('visite360'), /30 min à 2 h/);
});

// ── 4. Témoin personnalisé (VIS-18a) : point d'accroche ──────────────────────
test('témoin personnalisé dans le Studio : l’étape « Intérieurs » est faite avec son résumé, même sans gamme', () => {
  const s = assemblerSourcesEcran(entree());
  const avec = calculerParcours({ ...s, temoinStudio: { fait: true, resume: 'T3 A204 · séjour scandinave · 18 meubles' } }).etapes[4];
  assert.equal(avec.statut, 'fait'); assert.equal(avec.raison, null);
  assert.match(avec.resume, /^Logement témoin personnalisé dans le Studio : T3 A204/);
  assert.equal(avec.action.libelle, 'Modifier');
  assert.equal(calculerParcours({ ...s, temoinStudio: { fait: false, resume: null } }).etapes[4].statut, 'a_faire');
  // Branché sur la lecture RÉELLE de VIS-18a : rien de personnalisé → étape inchangée ; écran → sources.
  assert.equal(calculerParcours(assemblerSourcesEcran(entree({ temoinStudio: lireTemoinPersonnalise(null) }))).etapes[4].statut, 'a_faire');
  assert.equal(calculerParcours(assemblerSourcesEcran(entree({ temoinStudio: { fait: true, resume: 'T3 A204' } }))).etapes[4].statut, 'fait');
});

// ── Rendu : réglages dans le panneau (esbuild → react-dom/server ; réseau et photo remplacés) ─────
const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, '../../../..');
async function charger() {
  const require = createRequire(import.meta.url);
  const esbuild = require('esbuild') as typeof import('esbuild');
  const souches = { name: 'souches', setup(b: { onResolve: Function; onLoad: Function }) {
    b.onResolve({ filter: /lib\/studio\/travaux$|\/PhotoClientRue$/ }, (a: { path: string }) => ({ path: a.path, namespace: 'souche' }));
    b.onLoad({ filter: /.*/, namespace: 'souche' }, () => ({ contents: 'export const demanderCouverturePhotoRue = async () => ({ ok: false, raison: "x" }); export const PhotoClientRue = () => null;', loader: 'js' }));
  } };
  const r = esbuild.buildSync === undefined ? null : await esbuild.build({
    stdin: { contents: "export * from './ParcoursGuide.tsx'; export * from './ReglagesParcours.tsx';", resolveDir: ICI, loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', alias: { '@': path.join(RACINE, 'src') },
    external: ['react', 'react-dom', 'react/jsx-runtime', 'lucide-react'], loader: { '.css': 'empty' }, logLevel: 'silent', plugins: [souches as never],
  });
  const dossier = path.join(RACINE, 'node_modules', '.cache', 'vis18b');
  mkdirSync(dossier, { recursive: true });
  const fichier = path.join(dossier, 'Reglages.mjs');
  writeFileSync(fichier, r!.outputFiles[0].text);
  const m = await import(pathToFileURL(fichier).href) as typeof import('./ParcoursGuide.tsx') & typeof import('./ReglagesParcours.tsx');
  const react = await import('react');
  const serveur = await import('react-dom/server');
  return { m, h: react.createElement, rendre: serveur.renderToStaticMarkup };
}
const texte = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, '’').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

test('carte du chat (23/11 : seule à porter les réglages) : cible (étape 4), gamme (étape 5) et fond (étape 6) réglables dans l’étape, valeurs mémorisées affichées', async () => {
  const stock = new Map<string, string>([[`mimmoza.parcours.${CONV}`, JSON.stringify({ projet: { gamme: 'standard', cible: 'Seniors' }, fond: { fond: 'photo_rue' } })]]);
  (globalThis as { window?: unknown }).window = { localStorage: { getItem: (k: string) => stock.get(k) ?? null, setItem: (k: string, v: string) => stock.set(k, v) }, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } };
  try {
    const { m, h, rendre } = await charger();
    const s = assemblerSourcesEcran(entree({ projet: { gamme: 'standard', cible: 'Seniors' }, fond: { fond: 'photo_rue' } }));
    const p = calculerParcours(s);
    const html = rendre(h(m.CarteParcours, { parcours: p, onAction: () => undefined, reglage: (e) => m.reglageDeLEtape(e, { conversationId: CONV, messages: fil }) }));
    assert.equal((rendre(h(m.ParcoursPanneau, { parcours: p })).match(/<button/g) ?? []).length, 0, 'récapitulatif de l’Espace 3D : aucun réglage, aucun bouton');
    const t = texte(html);
    assert.match(t, /Pour qui : Primo-accédants Familles Investisseurs Seniors/);
    assert.match(t, /Gamme : Standard Confort Premium/);
    assert.match(html, /aria-pressed="true"[^>]*>Confort</);
    assert.match(html, /aria-pressed="true"[^>]*>Seniors</);
    assert.match(t, /Fond : photo de la rue \(panoramax \/ ign\)\./);
    assert.match(t, /Votre photo du trottoir/);
    assert.match(t, /Étude seule/);
    assert.match(t, /Vérifier les photos de rue disponibles|confirmez d’abord la parcelle/);
    assert.doesNotMatch(t, /studio_|qualite|apercu\b/);
  } finally { delete (globalThis as { window?: unknown }).window; }
});
