// npx tsx --test src/spaces/copilot/studio3d/vis34ProjetEnVigueur.test.ts
// =============================================================================
// VIS-34 — LE PROJET EN VIGUEUR vu de l'ÉCRAN (cas réel du 24/11 : Ascain AI0002, « Maison hexagonale avec tourelle et
// garage » dessinée pour un programme de 12 logements). Part de la ligne `studio_preparations` telle que le serveur
// l'écrit (entree.projet_en_vigueur + resume.projet_en_vigueur ; le serveur est testé par
// supabase/functions/copilot-chat/agent/vis34-projet-en-vigueur.test.ts) et vérifie la chaîne de l'écran :
//   ligne relue → carte « 3D préparée » → parcours (étapes 2 et 3) → carte du dessin (étiquettes vraies) → compléments du
//   Studio → fiche d'un rendu lancé depuis l'Espace 3D : MÊME empreinte, même nom, portée respectée.
// =============================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { empreinteModele, validerModele, type ModeleBatiment } from '../../../lib/studio/modeleBatiment.ts';
import {
  blocChoixPortee, complementsDessin, contradictionProgramme, creerProjetEnVigueur, lireProjetEnVigueur, lirePortee, metreDessin, OPTION_PORTEE_BATIMENT,
  OPTION_PORTEE_PROJET, placeDuDessin, porteeDuMessage, resumerProjetEnVigueur, type PorteeDessin,
} from '../../../lib/studio/projetEnVigueur.ts';
import { ficheModeleBatiment } from '../../../lib/studio/modeleBatimentFiche.ts';
import { calculerParcours } from '../../../lib/studio/parcours.ts';
import { basculerOption, composerReponse, etatVide, lireBlocChoix } from '../utils/choixCliquables.ts';
import { assemblerSourcesEcran } from './parcoursEcran.ts';
import { lignesCarte, referenceDepuisLigne } from './preparationStudio.ts';
import { groupesListe, libellePortee, phrasePortee } from './modeleBatimentChat.ts';
import { REFS_CATALOGUE_SITE, travailAvecModele } from './modeleTravail.ts';

const FX = JSON.parse(readFileSync(new URL('../../../lib/studio/__fixtures__/vis34-ascain-ai0002.json', import.meta.url), 'utf8'));
const CONV = '0113d281-835a-43af-9442-da7d4608c0a7';
const NOM = 'Maison hexagonale avec tourelle et garage';
const v = validerModele(FX.dessin.modele, { refsConnues: REFS_CATALOGUE_SITE });
assert.ok(v.ok, 'dessin du cas réel lisible');
const DESSIN: ModeleBatiment = (v as { modele: ModeleBatiment }).modele;
const E = empreinteModele(DESSIN);

/** Ligne studio_preparations comme le serveur l'écrit (résumé du moteur + projet en vigueur). */
function ligne(portee: PorteeDessin, batimentsPrepares: number) {
  const contradiction = portee === 'projet' ? contradictionProgramme(DESSIN, { logements: 12, libelle: '12 logements' }) : null;
  const projet = creerProjetEnVigueur(DESSIN, { portee, porteeChoisie: portee === 'batiment', questionPosee: true, contradiction, conversationId: CONV });
  return {
    id: '115bd8de-2261-4998-bc48-a0a43eb0f418', conception_id: 'd10c05ed-4baa-4a75-a016-2463ee035186', idu: '64065000AI0002', commune: 'Ascain',
    entree: { commune: 'Ascain', projet_en_vigueur: projet },
    resume: { batiments: batimentsPrepares, gabarit: 'R+1', sdp_estimee_m2: batimentsPrepares * 320, logements_places: batimentsPrepares * 4, logements_vises: 12, alertes: [],
      projet_en_vigueur: resumerProjetEnVigueur(projet, { batimentsPrepares, batimentsMoteur: 3 }) },
  };
}
const MISSION = { id: '7072412f-288a-4205-b882-773558073e81', type: 'conception', statut: 'terminee', conversation_id: CONV, criteres: { parcel_ids: ['64065000AI0002'], programme: '12 logements collectifs' } };
const parcoursDe = (l: ReturnType<typeof ligne> | null) => calculerParcours(assemblerSourcesEcran({
  messages: [], conversationId: CONV, typeChoisi: 'image', missions: [MISSION as never], travaux: [], parcelle: '64065000AI0002 · Ascain', brief: null, film: null, visite: null,
  preparationRef: l ? referenceDepuisLigne(l) : null,
}));
const etape = (p: ReturnType<typeof parcoursDe>, cle: string) => p.etapes.find((e) => e.cle === cle)!;

test('métré du dessin réel : 3 volumes, R+1 (tourelle), emprise et plancher approchés', () => {
  const x = metreDessin(DESSIN);
  assert.equal(x.volumes, 3); assert.equal(x.niveaux, 2);
  assert.ok(x.empriseM2 > 130 && x.empriseM2 < 160, String(x.empriseM2));   // hexagone ≈ 94 + garage 42 + tourelle ≈ 12
  assert.ok(x.plancherM2 > x.empriseM2, 'la tourelle a deux niveaux');
  assert.ok(x.hauteurM > 5);
});

test('BOUT EN BOUT (écran) — portée « projet » : ligne → carte → parcours → compléments Studio → fiche : même empreinte, même nom', () => {
  const l = ligne('projet', 1);
  // Ligne relue sans confiance.
  const pv = lireProjetEnVigueur(l.entree, CONV)!;
  assert.equal(pv.empreinte, E); assert.equal(pv.nom, NOM); assert.equal(pv.portee, 'projet');
  const ref = referenceDepuisLigne(l)!;
  assert.equal(ref.projet!.empreinte, E);
  // Carte « 3D préparée » : le dessin, pas « 1 bâtiment en R+1 · 4 logements placés sur 12 visés ».
  const carte = lignesCarte(ref);
  assert.match(carte[0], new RegExp(NOM)); assert.match(carte[1], /3 volumes · R\+1/); assert.match(carte[2], /remplace tout ce qui était préparé/);
  assert.ok(!carte.some((c) => /logements placés/.test(c)), carte.join(' | '));
  // Parcours : étapes 2 et 3.
  const p = parcoursDe(l);
  assert.equal(etape(p, 'conception').statut, 'fait'); assert.equal(etape(p, 'volume').statut, 'fait');
  assert.match(etape(p, 'conception').resume, /^Projet dessiné : « Maison hexagonale avec tourelle et garage »/);
  assert.match(etape(p, 'conception').resume, /maison individuelle.*12 logements.*Programme à mettre à jour/);
  assert.match(etape(p, 'volume').resume, /^Bâtiment dessiné « Maison hexagonale avec tourelle et garage » · 3 volumes · R\+1/);
  assert.ok(!/12 logements collectifs\./.test(etape(p, 'volume').resume));
  // Sans dessin, rien ne change (non-régression) : le programme de la mission, les bâtiments du moteur.
  const sans = parcoursDe({ ...l, entree: { commune: 'Ascain' }, resume: { ...l.resume, batiments: 3, projet_en_vigueur: undefined } } as never);
  assert.match(etape(sans, 'conception').resume, /Programme demandé : 12 logements collectifs/);
  assert.match(etape(sans, 'volume').resume, /3 bâtiments en R\+1/);
  // Compléments du Studio.
  const c = complementsDessin(pv);
  assert.deepEqual(Object.keys(c).sort(), ['empreinteModele', 'modeleBatiment', 'portee']);
  assert.equal(c.empreinteModele, E); assert.equal(c.portee, 'projet'); assert.equal(c.modeleBatiment.nom, NOM); assert.equal(empreinteModele(c.modeleBatiment), E);
  // Fiche d'un rendu lancé depuis l'Espace 3D.
  const t = travailAvecModele({ type: 'image', fiche: { draft: { objectif: 'Crée un bâtiment R+1', dimensions: '12 m sur 10 m', programme: 'maison' }, charge: {} }, options: {} }, pv.modele, pv.portee);
  const mb = (t.travail.fiche as unknown as { modele_batiment: { empreinte: string; portee: string; modele: ModeleBatiment } }).modele_batiment;
  assert.equal(mb.empreinte, E); assert.equal(mb.portee, 'projet'); assert.equal(mb.modele.nom, NOM);
  // Sans portée donnée (ancien appel) : champ absent = « projet » pour la machine de rendu ; forme d'avant inchangée.
  assert.ok(!('portee' in ficheModeleBatiment(DESSIN, 2, REFS_CATALOGUE_SITE)));
  assert.equal(lirePortee(undefined), 'projet'); assert.equal(lirePortee('batiment'), 'batiment'); assert.equal(lirePortee('autre'), 'projet');
});

test('portée « batiment » : dite partout, transmise telle quelle', () => {
  const l = ligne('batiment', 3);
  const pv = lireProjetEnVigueur(l.entree, CONV)!;
  assert.equal(pv.portee, 'batiment'); assert.equal(pv.portee_choisie, true);
  const ref = referenceDepuisLigne(l)!;
  assert.match(lignesCarte(ref)[2], /un seul des 3 bâtiments préparés/);
  const p = parcoursDe(l);
  assert.match(etape(p, 'volume').resume, /à la place d’un des 3 bâtiments/);
  assert.match(etape(p, 'conception').resume, /Programme demandé : 12 logements collectifs\. · un bâtiment dessiné/);
  assert.ok(!/Programme à mettre à jour/.test(etape(p, 'conception').resume), 'un bâtiment parmi d’autres ne contredit pas le programme');
  assert.equal(complementsDessin(pv).portee, 'batiment');
  const t = travailAvecModele({ type: 'film', fiche: { draft: null, charge: { batiments: [{}, {}, {}] } }, options: {} }, pv.modele, pv.portee);
  assert.equal(t.modeleBatiment!.portee, 'batiment'); assert.equal(t.modeleBatiment!.empreinte, E);
});

test('carte du dessin : « Dans la 3D et les images » seulement si ce dessin EST le projet en vigueur', () => {
  const g = groupesListe(DESSIN);
  const ref = referenceDepuisLigne(ligne('projet', 1))!;
  // Ce dessin est le projet : c'est vrai.
  assert.equal(placeDuDessin(E, ref.projet), 'projet');
  assert.equal(libellePortee('images', 'projet'), 'Dans la 3D et les images');
  assert.match(phrasePortee(g, 'projet'), /^\d+ parties dans la 3D et les images/);
  // Pas encore envoyé à la 3D (aucun projet en vigueur) ou autre dessin en vigueur : c'est une prévision.
  assert.equal(placeDuDessin(E, null), 'pas_en_vigueur'); assert.equal(placeDuDessin('mb1-0badcafe', ref.projet), 'pas_en_vigueur');
  assert.equal(libellePortee('images', 'pas_en_vigueur'), 'Prévu : 3D et images');
  assert.equal(libellePortee('aucune', 'pas_en_vigueur'), 'Noté, pas dessiné');
  assert.match(phrasePortee(g, 'pas_en_vigueur'), /^\d+ parties prévues pour la 3D et les images/);
  assert.ok(!/dans la 3D et les images/.test(phrasePortee(g, 'pas_en_vigueur')));
  // Un seul bâtiment du projet.
  assert.equal(placeDuDessin(E, referenceDepuisLigne(ligne('batiment', 3))!.projet), 'batiment');
});

test('question de portée : bloc valide pour les boutons, réponse relue, jamais confondue avec une autre demande', () => {
  const lu = lireBlocChoix(`Par défaut, ce dessin remplace tout le projet. Est-ce bien cela ?\n\n${blocChoixPortee()}`);
  assert.ok(lu.bloc, 'bloc accepté par le validateur des choix cliquables');
  assert.ok(!lu.visible.includes('mimmoza-choix'));
  const q = lu.bloc!.questions[0];
  assert.deepEqual(q.options, [OPTION_PORTEE_PROJET, OPTION_PORTEE_BATIMENT]); assert.deepEqual(q.defaut, [OPTION_PORTEE_PROJET]); assert.equal(q.multiple, false);
  for (const [option, attendu] of [[OPTION_PORTEE_PROJET, 'projet'], [OPTION_PORTEE_BATIMENT, 'batiment']] as const) {
    assert.equal(porteeDuMessage(composerReponse(lu.bloc!, basculerOption(etatVide(), lu.bloc!, q.id, option))), attendu);
  }
  assert.equal(porteeDuMessage('Le dessin remplace tout le projet'), 'projet');
  assert.equal(porteeDuMessage('il ne remplace qu’un seul bâtiment'), 'batiment');
  for (const autre of ['Ajoute une lucarne', 'Remplace le toit par de l’ardoise', 'Prépare la 3D de mon projet', 'Dessine une maison hexagonale', '', null, 'x```mimmoza-brief\n{}\n```']) {
    assert.equal(porteeDuMessage(autre), null, String(autre));
  }
});

test('contradiction avec le programme : dite seulement quand elle existe', () => {
  assert.match(contradictionProgramme(DESSIN, { logements: 12, libelle: '12 logements' })!, /maison individuelle.*12 logements/);
  assert.equal(contradictionProgramme(DESSIN, { logements: 1 }), null);
  assert.equal(contradictionProgramme(DESSIN, null), null);
  assert.equal(contradictionProgramme({ ...DESSIN, type: 'collectif' }, { logements: 12 }), null);
  assert.match(contradictionProgramme({ ...DESSIN, type: 'collectif' }, { logements: 1 })!, /immeuble collectif/);
});

test('une ligne relue pour une autre conversation, ou abîmée, ne donne jamais de dessin', () => {
  const l = ligne('projet', 1);
  assert.equal(lireProjetEnVigueur(l.entree, 'c7e0e9e1-76e5-4219-b4d3-acc8b6e859dc'), null);
  assert.equal(lireProjetEnVigueur({ projet_en_vigueur: { ...l.entree.projet_en_vigueur, empreinte: 'mb1-deadbeef' } }, CONV), null);
  assert.equal(referenceDepuisLigne({ ...l, resume: { ...l.resume, projet_en_vigueur: { v: 2 } } })!.projet, null);
});
