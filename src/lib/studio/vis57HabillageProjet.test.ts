// npx tsx --test src/lib/studio/vis57HabillageProjet.test.ts
// VIS-57 — « Habiller le projet » (traces → état, garde, rappel, fiche), aménagement extérieur partagé par le Studio,
// barre de progression (étape, %, temps restant estimé), vraie cause d'un échec.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  amenagementTransportable, CLE_AMENAGEMENT_PARTAGE, DEFINITIONS_THEMES, ficheAvecHabillage, gardeHabillage, habillageComplet, habillageDesTraces,
  lireAmenagementPartage, lireDemandeHabillage, messageHabillageTermine, paramsTraceHabillage, rappelHabillage, resumeAmenagement, themesManquants,
} from './habillageProjet.ts';
import { dureeCourte, etapeEnClair, vueProgression } from './progressionRendu.ts';
import { causeEchecRendu, nettoyerDetail } from './causeEchecRendu.ts';
import { phraseSuivi } from './travauxLogique.ts';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, '../../..');
const AM = {
  format: 'mimmozia.amenagement-exterieur', version: 1, pris: true, densite: null, contexteHorsParcelle: true, parcelleRef: [], compteur: 2,
  elements: [{ id: 'a', famille: 'arbre', modele: 'x', hauteurM: 5 }, { id: 'b', famille: 'arbre', modele: 'x', hauteurM: 5 }, { id: 'c', famille: 'allee', modele: 'y', hauteurM: 0 }],
};
const le = (m: number) => new Date(Date.UTC(2026, 10, 26, 22, m)).toISOString();

// ── 1. Habiller le projet ──────────────────────────────────────────────────
test('traces → état : le choix le plus récent de chaque thème l’emporte (ordre quelconque) ; traces étrangères ignorées', () => {
  const traces = [
    paramsTraceHabillage('exterieur', 'delegue', { le: le(5) }),
    { origine: 'studio', type: 'compte-rendu' },
    paramsTraceHabillage('exterieur', 'choisi', { amenagement: AM, le: le(2) }),
    paramsTraceHabillage('matieres', 'choisi', { resume: 'enduit clair', le: le(1) }),
    { origine: 'mimmoza-habillage', type: 'habillage-projet', theme: 'inconnu', mode: 'choisi', le: le(9) },
  ];
  const h = habillageDesTraces(traces);
  assert.equal(h.themes.exterieur?.mode, 'delegue');
  assert.equal(h.amenagement, null, 'extérieurs délégués après coup : plus d’aménagement transmis');
  assert.deepEqual(themesManquants(h), ['deco']);
  assert.equal(habillageComplet(h), false);
  const h2 = habillageDesTraces([...traces, paramsTraceHabillage('deco', 'delegue', { le: le(6) }), paramsTraceHabillage('exterieur', 'choisi', { amenagement: AM, le: le(7) })]);
  assert.equal(habillageComplet(h2), true);
  assert.deepEqual(h2.amenagement, AM);
});

test('garde : un thème manquant → sortie partielle (aucun devis) ; tout choisi → null', () => {
  const g = gardeHabillage(habillageDesTraces([]), 'image');
  assert.ok(g && g.status === 'partial');
  assert.equal(g!.data.habillage_requis, true); assert.equal(g!.data.carte, 'habillage_projet');
  assert.match(g!.message, /AUCUN DEVIS/);
  const tout = habillageDesTraces((['matieres', 'deco', 'exterieur'] as const).map((t, i) => paramsTraceHabillage(t, 'delegue', { le: le(i) })));
  assert.equal(gardeHabillage(tout, 'visite360'), null);
  // La carte du chat lit cette sortie (et seulement celle-là).
  assert.deepEqual(lireDemandeHabillage({ name: 'studio_lancer_rendu', status: 'done', output: g }), { type: 'image' });
  assert.equal(lireDemandeHabillage({ name: 'studio_lancer_rendu', status: 'running', output: g }), null);
  assert.equal(lireDemandeHabillage({ name: 'autre', output: g }), null);
  assert.match(messageHabillageTermine('visite360'), /établis le devis pour la visite 360°/);
});

test('rappel : une ligne par thème, accords justes, aménagement résumé ; fiche du travail', () => {
  const h = habillageDesTraces([
    paramsTraceHabillage('matieres', 'choisi', { resume: 'enduit clair · toit-terrasse', le: le(1) }),
    paramsTraceHabillage('deco', 'choisi', { resume: 'déco posée pièce par pièce', le: le(2) }),
    paramsTraceHabillage('exterieur', 'choisi', { amenagement: AM, le: le(3) }),
  ]);
  const r = rappelHabillage(h);
  assert.equal(r.length, 3);
  assert.match(r[0]!, /^Matières : choisies par vous dans le Studio — enduit clair/);
  assert.match(r[1]!, /^Déco des pièces : choisie par vous/);
  assert.match(r[2]!, /2 arbres, 1 allée, posés tels quels/);
  const f = ficheAvecHabillage({ version: 1 }, h) as Record<string, any>;
  assert.deepEqual(f.amenagement_exterieur, AM, 'les plantations partent avec le travail');
  assert.equal(f.habillage_projet.rappel.length, 3);
  assert.deepEqual(ficheAvecHabillage({ version: 1 }, habillageDesTraces([])), { version: 1 }, 'rien choisi : fiche inchangée');
  // Commandes du Studio de la délégation : celles du registre (pont VIS-45 / VIS-53 / VIS-54).
  assert.equal(DEFINITIONS_THEMES.deco.commandeMimmo?.id, 'interieur-decorer');
  assert.equal(DEFINITIONS_THEMES.exterieur.commandeMimmo?.id, 'exterieur-mimmo-plante');
  const pont = readFileSync(path.join(RACINE, 'src/spaces/promoteur/shared/echangeStudio/pontCommandesStudio.ts'), 'utf8');
  assert.match(pont, /id: 'interieur-decorer'/); assert.match(pont, /id: 'exterieur-mimmo-plante'/);
});

// ── 2. Aménagement extérieur partagé par le Studio ─────────────────────────
test('aménagement partagé (même clé que le Studio) : lu pour le BON projet seulement, forme contrôlée', () => {
  assert.equal(CLE_AMENAGEMENT_PARTAGE, 'mimmoza.studio.amenagement-exterieur');
  const st = new Map<string, string>();
  const s = { getItem: (k: string) => st.get(k) ?? null };
  st.set(`${CLE_AMENAGEMENT_PARTAGE}.mzchat-A`, JSON.stringify({ v: 1, projetId: 'mzchat-A', amenagement: AM, le: le(0) }));
  assert.equal(lireAmenagementPartage(s, 'mzchat-A')?.elements, 3);
  assert.equal(lireAmenagementPartage(s, 'mzchat-B'), null, 'autre projet : rien');
  st.set(`${CLE_AMENAGEMENT_PARTAGE}.mzchat-C`, JSON.stringify({ v: 1, projetId: 'mzchat-A', amenagement: AM }));
  assert.equal(lireAmenagementPartage(s, 'mzchat-C'), null, 'projet de la valeur ≠ clé : refusé');
  st.set(`${CLE_AMENAGEMENT_PARTAGE}.mzchat-D`, '{pas du json');
  assert.equal(lireAmenagementPartage(s, 'mzchat-D'), null);
  assert.equal(lireAmenagementPartage(null, 'mzchat-A'), null);
  assert.equal(amenagementTransportable({ ...AM, format: 'autre' }).ok, false);
  assert.equal(amenagementTransportable({ ...AM, elements: new Array(601).fill(AM.elements[0]) }).ok, false);
  assert.equal(resumeAmenagement(null), 'aucun élément placé');
  // Le Studio publie sous la même clé (copie du contrat).
  const studio = path.resolve(RACINE, '../mimmozia-studio/src/ui/exterieur/partageExterieur.ts');
  try { assert.match(readFileSync(studio, 'utf8'), /CLE_AMENAGEMENT_PARTAGE = 'mimmoza\.studio\.amenagement-exterieur'/); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
});

test('lancement depuis l’Espace 3D : la fiche du travail porte l’habillage et l’aménagement ; bouton grisé tant que tout n’est pas choisi', () => {
  const panneau = readFileSync(path.join(RACINE, 'src/spaces/copilot/studio3d/FilmVisitePanel.tsx'), 'utf8');
  assert.match(panneau, /fiche: ficheAvecHabillage\(avecDessin\.travail\.fiche, habillage\)/);
  assert.match(panneau, /disabled=\{lancement \|\| terrainManquant \|\| !habillageComplet\(habillage\)\}/);
  const carte = readFileSync(path.join(RACINE, 'src/spaces/copilot/studio3d/CarteScenarioFilm.tsx'), 'utf8');
  assert.match(carte, /if \(!onSend \|\| envoi \|\| !etat\.ok \|\| !habille\) return;/);
  assert.match(carte, /<CarteHabillageProjet messageId=\{messageId\} type="film" integree \/>/);
});

test('CSS : couleurs verrouillées malgré `.jarvis-dossier * { color: inherit !important }` ; boutons actifs bleu clair', () => {
  for (const f of ['CarteHabillageProjet.css', 'BarreProgressionRendu.css']) {
    const css = readFileSync(path.join(RACINE, 'src/spaces/copilot/studio3d', f), 'utf8');
    for (const regle of css.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => /(^|[\s{;])color:/.test(l))) {
      assert.match(regle, /\.jarvis-dossier /, `${f} : sélecteur préfixé — ${regle.slice(0, 60)}`);
      assert.match(regle, /(^|[\s{;])color: #[0-9a-f]{6} !important/, `${f} : couleur en !important — ${regle.slice(0, 60)}`);
    }
  }
  const hab = readFileSync(path.join(RACINE, 'src/spaces/copilot/studio3d/CarteHabillageProjet.css'), 'utf8');
  assert.match(hab, /\.mz-hab__btn\.is-actif[^{]*\{ background: #dbeafe;[^}]*color: #1e3a8a !important/);
  assert.match(hab, /\.mz-hab__btn\.is-principal[^{]*\{ background: #dbeafe;[^}]*color: #1e3a8a !important/);
});

// ── 3. Barre de progression ────────────────────────────────────────────────
test('progression : en attente sans pourcentage ; en cours : étape, %, temps restant estimé (extrapolation) ; silence → pas d’estimation', () => {
  const t0 = Date.parse('2026-11-27T10:00:00Z');
  const a = vueProgression({ statut: 'en_attente', progression: 0, etape: null }, t0);
  assert.deepEqual([a.visible, a.pourcentage, a.etape, a.reste], [true, null, 'En file d’attente', null]);
  const c = vueProgression({ statut: 'en_cours', progression: 25, etape: 'Rendu du film', demarre_le: '2026-11-27T09:50:00Z', maj_le: '2026-11-27T09:59:00Z' }, t0);
  assert.equal(c.pourcentage, 25); assert.equal(c.etape, 'Rendu du film');
  assert.equal(c.reste, 'environ 30 min restantes (estimation)', '10 min pour 25 % → 30 min pour les 75 % restants');
  assert.match(c.texte, /Rendu du film — 25 %/);
  const muet = vueProgression({ statut: 'en_cours', progression: 25, etape: 'Rendu du film', demarre_le: '2026-11-27T09:00:00Z', maj_le: '2026-11-27T09:30:00Z' }, t0);
  assert.equal(muet.reste, null, 'plus de nouvelles depuis 30 min : aucune estimation');
  assert.equal(vueProgression({ statut: 'en_cours', progression: 1, etape: '', demarre_le: '2026-11-27T09:50:00Z' }, t0).reste, null, 'moins de 3 % : non calculable');
  assert.equal(vueProgression({ statut: 'en_cours', progression: 40, etape: 'x', demarre_le: null }, t0).reste, null, 'démarrage inconnu');
  assert.equal(vueProgression({ statut: 'en_cours', progression: 250, etape: 'x' }, t0).pourcentage, 100);
  assert.equal(vueProgression({ statut: 'termine', progression: 100, etape: 'x' }, t0).visible, false);
  assert.equal(etapeEnClair('  rendu_des_panoramas 2/6 ', 'en_cours'), 'Rendu des panoramas 2/6');
  assert.equal(etapeEnClair(null, 'en_cours'), 'Préparation');
  assert.deepEqual([dureeCourte(45_000), dureeCourte(12 * 60_000), dureeCourte(65 * 60_000)], ['45 s', '12 min', '1 h 05']);
});

// ── 4. Textes trompeurs ────────────────────────────────────────────────────
const M_FILM = 'Le projet n’a pas pu être mis en scène pour le film (aucun plan de caméra exploitable). Vérifiez la description du bâtiment dans la conversation.';
const M_SCENE = 'Le projet n’a pas pu être construit à partir de la fiche. Vérifiez la description du bâtiment dans la conversation.';

test('échec : « Vérifiez la description du bâtiment » remplacé par la VRAIE cause (détail connu) ou une phrase qui n’accuse pas la description', () => {
  const nonPublie = causeEchecRendu({ erreur: M_FILM, type: 'film', detail: 'worker_film — code 1 · REFUS : le projet n’est pas publié (publiez d’abord)' });
  assert.equal(nonPublie.corrigee, true);
  assert.match(nonPublie.phrase, /pas été publié vers le moteur de rendu/);
  assert.doesNotMatch(nonPublie.phrase, /V[ée]rifiez la description/);
  assert.match(causeEchecRendu({ erreur: M_FILM, type: 'film', detail: 'code 1 · REFUS : storyboard vide' }).phrase, /storyboard vide/);
  assert.match(causeEchecRendu({ erreur: M_FILM, type: 'film', detail: 'code 1 · REFUS : plans refusés : p3 caméra hors parcelle' }).phrase, /refusés par le contrôle automatique \(plans refusés : p3/);
  assert.match(causeEchecRendu({ erreur: M_SCENE, type: 'image', etape: 'Préparation de la scène', detail: 'worker_scene — scène : code 3 — [scene] …' }).phrase, /s’est arrêtée sur la machine de rendu \(code 3/);
  const sans = causeEchecRendu({ erreur: M_SCENE, type: 'image', etape: 'Préparation de la scène' });
  assert.match(sans.phrase, /n’a pas pu construire la scène 3D du projet \(étape « Préparation de la scène »\)/);
  assert.match(sans.phrase, /Rien n’indique que la description du bâtiment soit en cause\. Vous pouvez relancer\.$/);
  // Un message déjà précis est gardé tel quel.
  const precis = 'La machine de rendu était occupée par un autre rendu. Relancez la demande dans quelques minutes.';
  assert.deepEqual([causeEchecRendu({ erreur: precis }).phrase, causeEchecRendu({ erreur: precis }).corrigee], [precis, false]);
  // Chemins et identifiants jamais montrés.
  assert.equal(nettoyerDetail('worker_scene — échec C:\\Mimmoza\\worker\\x.json pour aa000000-0000-4000-8000-000000000001 /home/u/a/b'), 'échec … pour # …');
});

test('phraseSuivi (cartes du chat, Dossier 3D, parcours) : la vraie cause, jamais le message trompeur', () => {
  const t = { type: 'film' as const, statut: 'echec' as const, etape: 'Rendu du film', progression: 35, erreur: M_FILM };
  assert.doesNotMatch(phraseSuivi(t), /V[ée]rifiez la description/);
  assert.match(phraseSuivi(t, 'code 1 · REFUS : storyboard vide'), /storyboard vide/);
  assert.equal(phraseSuivi({ ...t, erreur: 'Le service de rendu est momentanément indisponible.' }), 'La préparation n’a pas abouti : Le service de rendu est momentanément indisponible.');
});
