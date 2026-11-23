// npx tsx --test src/spaces/copilot/studio3d/descriptionBatimentChat.test.ts
// VIS-22 — carte « Votre bâtiment » : lecture sans confiance de la sortie de l'outil, modifications de la carte,
// bilan affiché, description en vigueur dans la conversation (même règle que le serveur), état « envoyée ».
import assert from 'node:assert/strict';
import test from 'node:test';
import { messageReproduire, OUTIL_DECRIRE_BATIMENT, validerDescription, type DescriptionBatiment } from '../../../lib/studio/descriptionBatiment.ts';
import {
  ajouterElement, descriptionCourante, envoyeeApres, lireCarteBatiment, modifierDescription, phraseBilan, resumeBilan, retirerElement,
} from './descriptionBatimentChat.ts';

function decrit(brut: unknown): DescriptionBatiment {
  const v = validerDescription(brut);
  if (!v.ok) throw new Error(v.erreur);
  return v.valeur;
}
const BASQUE = decrit({
  type: 'maison', niveaux: 2, style: 'basque', toiture: { forme: 'deux_pans', couverture: 'tuiles' }, facade: { materiau: 'enduit_blanc' },
  ouvertures: { volets: 'battants', couleurVolets: 'rouge' }, balcons: { type: 'balcons_filants' },
  elements: [{ type: 'colombages', couleur: 'rouge' }, { type: 'garage_accole', cote: 'gauche' }], incertains: ['niveaux', 'volets'],
});
const sortie = (description: unknown, extra: Record<string, unknown> = {}) => ({ status: 'ok', data: { carte: 'batiment', description, corrections: ['niveaux ramenés à 30'], ...extra } });

test('lecture de la sortie de l’outil : description revalidée en mode strict, sinon aucune carte', () => {
  const c = lireCarteBatiment({ name: OUTIL_DECRIRE_BATIMENT, status: 'done', output: sortie(BASQUE) });
  assert.ok(c);
  assert.deepEqual(c.description, BASQUE);
  assert.deepEqual(c.corrections, ['niveaux ramenés à 30']);
  assert.equal(c.mentionPhoto, null);
  const photo = lireCarteBatiment({ name: OUTIL_DECRIRE_BATIMENT, output: sortie({ ...BASQUE, origine: 'photo' }) });
  assert.match(photo?.mentionPhoto ?? '', /référence de style/);
  assert.equal(lireCarteBatiment({ name: 'studio_preparer_3d', output: sortie(BASQUE) }), null, 'autre outil');
  assert.equal(lireCarteBatiment({ name: OUTIL_DECRIRE_BATIMENT, status: 'running', output: sortie(BASQUE) }), null, 'appel en cours');
  assert.equal(lireCarteBatiment({ name: OUTIL_DECRIRE_BATIMENT, output: { status: 'error', message: 'x' } }), null);
  assert.equal(lireCarteBatiment({ name: OUTIL_DECRIRE_BATIMENT, output: sortie({ ...BASQUE, style: 'gothique' }) }), null, 'valeur hors liste : aucune carte');
  assert.equal(lireCarteBatiment({ name: OUTIL_DECRIRE_BATIMENT, output: sortie({ ...BASQUE, attique: true }) }), null, 'description incohérente : aucune carte');
  assert.equal(lireCarteBatiment({ name: OUTIL_DECRIRE_BATIMENT, output: null }), null);
});

test('modifier un point : cohérences rétablies, le point réglé n’est plus « à vérifier »', () => {
  const plat = modifierDescription(BASQUE, { toiture: { forme: 'terrasse', couverture: 'tuiles' } });
  assert.deepEqual(plat.description.toiture, { forme: 'terrasse', couverture: null });
  assert.deepEqual(plat.notes, []);
  const pente = modifierDescription(plat.description, { toiture: { forme: 'quatre_pans', couverture: null } });
  assert.deepEqual(pente.description.toiture, { forme: 'quatre_pans', couverture: 'tuiles' }, 'tuiles proposées');
  const attique = modifierDescription(BASQUE, { attique: true });
  assert.equal(attique.description.attique, false, 'attique impossible avec un toit en pente');
  assert.equal(attique.notes.length, 1);
  const niveaux = modifierDescription(BASQUE, { niveaux: 3 });
  assert.deepEqual(niveaux.description.incertains, ['volets']);
  const volets = modifierDescription(BASQUE, { ouvertures: { ...BASQUE.ouvertures, volets: 'aucun' } });
  assert.equal(volets.description.ouvertures.couleurVolets, null);
  assert.deepEqual(volets.description.incertains, ['niveaux']);
  const commerces = modifierDescription(decrit({ soubassement: 'pierre' }), { rdc: 'commerces' });
  assert.equal(commerces.description.soubassement, 'aucun');
  for (const m of [plat, pente, attique, niveaux, volets, commerces]) assert.equal(validerDescription(m.description, true).ok, true, 'toujours envoyable');
});

test('éléments remarquables : ajouter, retirer, sans doublon', () => {
  const sans = retirerElement(BASQUE, 1).description;
  assert.deepEqual(sans.elements.map((e) => e.type), ['colombages']);
  const avec = ajouterElement(sans, 'cheminee').description;
  assert.deepEqual(avec.elements.map((e) => e.type), ['colombages', 'cheminee']);
  assert.equal(ajouterElement(avec, 'cheminee').description, avec, 'pas de doublon');
  assert.equal(ajouterElement(avec, 'autre').description, avec, '« autre » ne s’ajoute pas sans précision');
});

test('bilan affiché : comptes et phrase de pied de carte', () => {
  const r = resumeBilan(BASQUE);
  assert.equal(r.nonReproduits, 1, 'le garage accolé');
  assert.equal(r.aVerifier, 2);
  assert.equal(r.reproduits + r.approches + r.nonReproduits, r.lignes.length);
  assert.equal(phraseBilan(r), `${r.reproduits} points repris · 1 pas encore reproduit`);
  assert.equal(phraseBilan(resumeBilan(decrit({}))), '13 points repris');
});

test('conversation : description en vigueur = celle du dernier message d’habillage ; carte « envoyée »', () => {
  const m = messageReproduire(BASQUE);
  const panneau = 'Habillage choisi.\n\n```mimmoza-brief\n{"v":1,"brief":{"facade":"brique"}}\n```';
  const fil = [
    { id: 'u1', role: 'user', text: 'Dessine une maison basque R+1' },
    { id: 'a1', role: 'assistant', text: 'Voici ce que j’ai compris.' },
    { id: 'u2', role: 'user', text: m },
    { id: 'a2', role: 'assistant', text: 'La 3D est préparée.' },
  ];
  assert.deepEqual(descriptionCourante(fil), BASQUE);
  assert.equal(descriptionCourante(fil.slice(0, 2)), null);
  assert.equal(descriptionCourante([...fil, { id: 'u3', role: 'user', text: panneau }]), null, 'un habillage choisi ensuite remplace la description');
  assert.deepEqual(descriptionCourante([...fil, { id: 'u3', role: 'user', text: 'merci' }]), BASQUE);
  assert.deepEqual(envoyeeApres(fil, 'a1'), BASQUE);
  assert.equal(envoyeeApres(fil, 'a2'), null);
  assert.equal(envoyeeApres(fil, 'inconnu'), null);
});
