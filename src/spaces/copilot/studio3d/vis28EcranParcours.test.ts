// npx tsx --test src/spaces/copilot/studio3d/vis28EcranParcours.test.ts
// VIS-28 (24/11/2026) — capture d'Albé, parcours « Visite 360° » :
//   1. en-tête de l'Espace 3D : coche BLANCHE sur les pastilles des étapes faites, numéro + libellé court sous chaque
//      pastille ;
//   2. étape 6/7/8 : l'écran s'ouvre DIRECTEMENT sur la feuille du type du parcours (pas de nouveau choix
//      « Film, visite 360° ou image ») — à l'arrivée, au clic d'une pastille, au clic d'une étape du chat ;
//   3. « Déjà réalisés » : seulement les rendus du type du parcours (« Autres rendus (n) » pour les autres) ; échec →
//      UN bouton « Relancer » ;
//   4. contraste ≥ 4.5:1 des couleurs d'étape (texte blanc sur couleur, texte coloré sur blanc / fond teinté).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { calculerParcours, COULEURS_ETAPE, LIBELLES_COURTS_ETAPE, sourcesVides, type SourcesParcours, type TypeParcours } from '../../../lib/studio/parcours.ts';
import type { TravailStudio } from '../../../lib/studio/travauxLogique.ts';
import { feuilleDeLEtape, rendusDuType, TRAVAIL_DU_PARCOURS } from './renduParcours.ts';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, '../../../..');
const APERCU = '11111111-1111-4111-8111-111111111111';

/** Parcours de la capture : terrain, programme, volume et style faits, intérieurs facultatifs ; type au choix. */
function sources(type: TypeParcours, extra: Partial<SourcesParcours> = {}): SourcesParcours {
  return {
    ...sourcesVides(type),
    terrain: 'AI0001 + AI0002 (2 349 m²) · Ascain',
    conception: { statut: 'terminee', resume: '12 logements · 3 bâtiments · R+1' },
    volume: { pret: true, resume: '3 bâtiments, R+1, 12 logements placés' },
    habillage: { resume: 'Enduit clair, menuiseries anthracite', attenduParMimmo: false },
    ...extra,
  };
}

async function charger<T>(fichier: string, nom: string): Promise<T> {
  const require = createRequire(import.meta.url);
  const esbuild = require('esbuild') as typeof import('esbuild');
  const r = esbuild.buildSync({
    entryPoints: [path.join(ICI, fichier)], bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic',
    external: ['react', 'react-dom', 'react/jsx-runtime', 'lucide-react'], loader: { '.css': 'empty' }, logLevel: 'silent',
  });
  const dossier = path.join(RACINE, 'node_modules', '.cache', 'vis28');
  mkdirSync(dossier, { recursive: true });
  const sortie = path.join(dossier, `${nom}.mjs`);
  writeFileSync(sortie, r.outputFiles[0].text);
  return await import(pathToFileURL(sortie).href) as T;
}
const texte = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, '’').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ');

// ── 1. En-tête de l'Espace 3D ───────────────────────────────────────────────
test('en-tête : coche BLANCHE (trait explicite) sur chaque pastille faite, numéro + libellé court sous chaque pastille', async () => {
  const m = await charger<typeof import('./ParcoursGuide.tsx')>('ParcoursGuide.tsx', 'ParcoursGuide');
  const { createElement: h } = await import('react');
  const { renderToStaticMarkup: rendre } = await import('react-dom/server');
  const p = calculerParcours(sources('visite'));
  const html = rendre(h(m.ParcoursPanneau, { parcours: p }));
  const faites = p.etapes.filter((e) => e.statut === 'fait').length;
  assert.ok(faites >= 4, 'terrain, programme, volume, style faits');
  // Chaque pastille faite porte un svg à trait blanc (indépendant de `color`, que le dossier force en `inherit`).
  const pastillesFaites = html.match(/mz-parcours__pastille is-fait"[^>]*><svg[^>]*>/g) ?? [];
  assert.equal(pastillesFaites.length, faites);
  for (const s of pastillesFaites) assert.match(s, /stroke="#ffffff"/);
  // Libellés : 8 pastilles, chacune avec son numéro et un libellé court ; « 6 Pièces » pour la visite.
  const libelles = [...html.matchAll(/mz-parcours__onglet-libelle"[^>]*><b>(\d)<\/b> ([^<]+)<\/span>/g)].map((x) => `${x[1]} ${x[2]}`);
  assert.deepEqual(libelles, ['1 Terrain', '2 Prog.', '3 Volume', '4 Style', '5 Intér.', '6 Pièces', '7 Aperçu', '8 Final']);
  // Infobulle complète gardée (titre + statut).
  assert.match(html, /title="6\. Pièces &amp; points de vue — À faire"/);
  // Film / Images : libellé de l'étape 6 adapté.
  assert.match(rendre(h(m.ParcoursPanneau, { parcours: calculerParcours(sources('film')) })), /<b>6<\/b> Scénario/);
  assert.match(rendre(h(m.ParcoursPanneau, { parcours: calculerParcours(sources('image')) })), /<b>6<\/b> Vues/);
  // Toujours aucune commande du parcours dans l'en-tête.
  assert.doesNotMatch(html, /mz-parcours__action/);
});

test('CSS : couleurs verrouillées malgré `.jarvis-dossier * { color: inherit !important }`', () => {
  const css = readFileSync(path.join(ICI, 'ParcoursGuide.css'), 'utf8');
  const dossier = readFileSync(path.join(ICI, 'JarvisDraftPanel.css'), 'utf8');
  assert.match(dossier, /\.jarvis-dossier \* \{ color: inherit !important;/, 'la cause existe toujours : la parade reste nécessaire');
  assert.match(css, /\.mz-parcours \.mz-parcours__pastille\.is-fait svg[^{]*\{ stroke: #ffffff !important; \}/);
  assert.match(css, /\.mz-parcours \.mz-parcours__pastille\.is-fait \*[^{]*\{ color: #ffffff !important; \}/);
  assert.match(css, /\.mz-parcours \.mz-parcours__titre \{ color: color-mix\(in srgb, var\(--etape\) 82%, #000000\) !important; \}/);
  assert.match(css, /\.mz-parcours \.mz-parcours__onglet-libelle \{ color: #475569 !important; \}/);
  assert.doesNotMatch(css, /color: #94a3b8/, 'gris trop clair (2.6:1) retiré');
});

// ── 4. Contraste ────────────────────────────────────────────────────────────
const rvb = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const lum = (c: number[]) => { const [r, g, b] = c.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contraste = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const melange = (a: number[], part: number, b: number[]) => a.map((v, i) => Math.round(v * part + b[i] * (1 - part)));
const BLANC = [255, 255, 255];
const NOIR = [0, 0, 0];

test('contraste ≥ 4.5:1 pour chaque couleur d’étape (boutons, badges, titres, libellés)', () => {
  for (const [cle, c] of Object.entries(COULEURS_ETAPE)) {
    const couleur = rvb(c);
    const sombre = melange(couleur, 0.82, NOIR); // texte coloré (titre, pastille à faire, bouton secondaire, libellé actif)
    assert.ok(contraste(BLANC, couleur) >= 4.5, `${cle} : texte blanc sur ${c} (${contraste(BLANC, couleur).toFixed(2)})`);
    assert.ok(contraste(sombre, BLANC) >= 4.5, `${cle} : texte sur blanc`);
    assert.ok(contraste(sombre, melange(couleur, 0.10, BLANC)) >= 4.5, `${cle} : texte sur fond teinté de l’étape courante / survol`);
    assert.ok(contraste(BLANC, melange(couleur, 0.85, NOIR)) >= 4.5, `${cle} : bouton principal survolé`);
    assert.ok(contraste(melange(couleur, 0.60, rvb('#475569')), BLANC) >= 4.5, `${cle} : titre d’étape bloquée`);
  }
  // Badges de statut et textes gris.
  assert.ok(contraste(rvb('#166534'), rvb('#dcfce7')) >= 4.5, 'badge « Fait »');
  assert.ok(contraste(rvb('#475569'), rvb('#f1f5f9')) >= 4.5, 'badges « Facultative » / « Bloquée »');
  assert.ok(contraste(rvb('#64748b'), BLANC) >= 4.5, 'résumé d’étape bloquée');
  assert.ok(contraste(rvb('#475569'), rvb('#f8fafc')) >= 4.5, 'libellé de pastille');
});

// ── 2. Ouverture directe de la feuille du type ──────────────────────────────
test('feuilleDeLEtape : étape 6 → feuille du type (visite : Pièces & points de vue), 7 → aperçu, 8 → final', () => {
  for (const type of ['image', 'film', 'visite'] as const) {
    const p = calculerParcours(sources(type));
    const etape6 = p.etapes.find((e) => e.numero === 6)!;
    assert.deepEqual(feuilleDeLEtape(type, etape6), { feuille: TRAVAIL_DU_PARCOURS[type] }, `${type} : étape 6`);
    assert.deepEqual(feuilleDeLEtape(type, p.etapes.find((e) => e.cle === 'apercu')), { feuille: TRAVAIL_DU_PARCOURS[type], qualite: 'apercu' });
    // Final bloqué tant que l'aperçu n'est pas validé : pas de feuille (pas de lancement concurrent).
    assert.equal(feuilleDeLEtape(type, p.etapes.find((e) => e.cle === 'final')), null);
    // Étapes hors rendu : rien.
    assert.equal(feuilleDeLEtape(type, p.etapes.find((e) => e.cle === 'style')), null);
  }
  assert.equal(TRAVAIL_DU_PARCOURS.visite, 'visite360');
  const pv = calculerParcours(sources('visite'));
  assert.equal(pv.etapes.find((e) => e.numero === 6)?.titre, 'Pièces & points de vue');
  // Aperçu validé → étape 8 « Lancer » ouvre la feuille finale ; aperçu prêt non validé → rendus à revoir (pas de feuille).
  const apercu = { id: APERCU, type: 'visite360' as const, statut: 'termine', qualite: 'apercu' as const, cree_le: '2026-11-24T08:00:00Z', vues: [], nbImages: 0, livraison: false };
  const valide = calculerParcours(sources('visite', { visite: { interieurs: true, resolution: '6k', ambiance: 'jour' }, travaux: [apercu], apercuValide: APERCU }));
  assert.deepEqual(feuilleDeLEtape('visite', valide.etapes.find((e) => e.cle === 'final')), { feuille: 'visite360', qualite: 'finale' });
  const pret = calculerParcours(sources('visite', { visite: { interieurs: true, resolution: '6k', ambiance: 'jour' }, travaux: [apercu] }));
  assert.equal(feuilleDeLEtape('visite', pret.etapes.find((e) => e.cle === 'apercu')), null);
});

test('câblage : l’Espace 3D passe le type et la feuille de l’étape affichée ; l’écran ne repropose pas le choix du type', () => {
  const panneau = readFileSync(path.join(ICI, 'JarvisDraftPanel.tsx'), 'utf8');
  // Étape affichée = étape cliquée dans le chat, pastille de l'en-tête, ou étape courante par défaut (etapeActive).
  assert.match(panneau, /const etapeRendu = parcours && etapeActive && RENDUS\.includes\(etapeActive\)/);
  assert.match(panneau, /feuille: feuilleDeLEtape\(parcours\.type, etapeRendu\)/);
  assert.match(panneau, /parcoursRendu=\{parcoursRendu\}/);
  const ecran = readFileSync(path.join(ICI, 'FilmVisitePanel.tsx'), 'utf8');
  assert.match(ecran, /\{!typeParcours && <div className="mzia-rendu__choix">/, 'trois cartes seulement sans parcours');
  assert.match(ecran, /useEffect\(\(\) => \{\n\s+const f = parcoursRendu\?\.feuille;[\s\S]{0,300}ouvrirFeuille\(f\.feuille\);/);
  assert.match(ecran, /\}, \[cleParcours\]\);/);
  // Relance : même fonction de lancement, mêmes options, aucun appel de facturation.
  assert.match(ecran, /const relancer = \(t: TravailStudio\) => \{ void lancerTravail\(t\.type, t\.options, t\.id\); \};/);
  assert.doesNotMatch(ecran, /settle|debiter|copilot_settle_credits/);
});

// ── 3. Déjà réalisés ────────────────────────────────────────────────────────
const travail = (o: Partial<TravailStudio> & Pick<TravailStudio, 'id' | 'type' | 'statut'>): TravailStudio => ({
  conversation_id: 'c', progression: 0, etape: null, options: {}, resultat: null, elements_omis: [], erreur: null,
  cree_le: '2026-11-24T08:00:00Z', maj_le: '2026-11-24T08:00:00Z', demarre_le: null, termine_le: null, ...o,
});

test('« Déjà réalisés » : rendus du type du parcours seulement, « Autres rendus (n) » discret, « Relancer » sur un échec', async () => {
  const m = await charger<typeof import('./HistoriqueRendus.tsx')>('HistoriqueRendus.tsx', 'HistoriqueRendus');
  const { createElement: h } = await import('react');
  const { renderToStaticMarkup: rendre } = await import('react-dom/server');
  const film = travail({ id: 'f1', type: 'film', statut: 'echec', erreur: 'machine de rendu indisponible', options: { duree_s: 60, ambiance: 'jour', format: '16:9', interieurs: true, musique: true } });
  const visiteKo = travail({ id: 'v1', type: 'visite360', statut: 'echec', erreur: 'délai dépassé', options: { ambiance: 'jour', interieurs: true, resolution: '6k', qualite: 'apercu' } });
  const visiteOk = travail({ id: 'v2', type: 'visite360', statut: 'termine', resultat: { visite_id: 'vis-1' } as never });
  assert.deepEqual(rendusDuType([film, visiteKo, visiteOk], 'visite360'), { duType: [visiteKo, visiteOk], autres: [film] });
  assert.deepEqual(rendusDuType([film], null), { duType: [film], autres: [] });
  const relances: string[] = [];
  const actions = { onVoirFilm: () => undefined, onVoirImage: () => undefined, onCopierLien: () => undefined, onRelancer: (t: TravailStudio) => { relances.push(t.id); } };
  const html = rendre(h(m.HistoriqueRendus, { travaux: [film, visiteKo, visiteOk], type: 'visite360', ...actions }));
  const t = texte(html);
  assert.match(t, /Déjà réalisés/);
  assert.equal((html.match(/<b>Visite 360°<\/b>/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<b>Film<\/b>/, 'le film en échec n’est pas dans l’écran Visite 360°');
  assert.match(html, /class="mzia-rendu__autres" aria-expanded="false">Autres rendus \(1\)<\/button>/);
  // Échec : message gardé + UN bouton « Relancer ».
  assert.match(t, /La préparation n’a pas abouti : délai dépassé/);
  assert.equal((html.match(/<\/svg> Relancer<\/button>/g) ?? []).length, 1);
  assert.match(html, /aria-label="Relancer — Visite 360°"/);
  assert.match(t, /Ouvrir la visite/);
  // Sans parcours : tout est listé (comme avant), le film en échec a son « Relancer ».
  const libre = rendre(h(m.HistoriqueRendus, { travaux: [film, visiteKo], type: null, ...actions }));
  assert.match(libre, /<b>Film<\/b>/);
  assert.doesNotMatch(libre, /Autres rendus/);
  assert.equal((libre.match(/<\/svg> Relancer<\/button>/g) ?? []).length, 2);
  // Relance en cours : bouton désactivé (pas de double lancement).
  const enCours = rendre(h(m.HistoriqueRendus, { travaux: [visiteKo], type: 'visite360', ...actions, relance: 'v1' }));
  assert.match(enCours, /disabled=""[^>]*aria-label="Relancer — Visite 360°"|aria-label="Relancer — Visite 360°"[^>]*disabled=""/);
  assert.match(texte(enCours), /Relance…/);
  // Sans action de relance (file indisponible) : pas de bouton.
  assert.doesNotMatch(rendre(h(m.HistoriqueRendus, { travaux: [visiteKo], type: 'visite360', onVoirFilm: () => undefined, onVoirImage: () => undefined, onCopierLien: () => undefined })), /Relancer/);
  // Rien à montrer : rien.
  assert.equal(rendre(h(m.HistoriqueRendus, { travaux: [], type: 'visite360', ...actions })), '');
  // Libellés courts : ≤ 9 caractères (une seule ligne de 8 pastilles).
  for (const l of Object.values(LIBELLES_COURTS_ETAPE)) assert.ok(l.length <= 9, l);
});
