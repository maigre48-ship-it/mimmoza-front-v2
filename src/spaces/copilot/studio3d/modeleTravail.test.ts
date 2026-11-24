// npx tsx --test src/spaces/copilot/studio3d/modeleTravail.test.ts
// VIS-26 lot D — l'aperçu et les images lancés depuis l'Espace 3D (FilmVisitePanel) emportent le bâtiment DESSINÉ en
// vigueur, dans `fiche.modele_batiment`, sous la forme lue par la machine de rendu (worker/src/modeleBatiment.ts::
// lireModeleFiche : { v: 1, empreinte mb1-…, modele relu en STRICT, notes }), ramené à la hauteur de la 3D préparée.
import assert from 'node:assert/strict';
import test from 'node:test';
import { construireTravail, optionsParDefaut } from '../../../lib/studio/travauxLogique.ts';
import { empreinteModele, validerModele, type ModeleBatiment } from '../../../lib/studio/modeleBatiment.ts';
import { EXEMPLE_MAISON_BASQUE } from '../../../lib/studio/modeleBatimentExemples.ts';
import { messageReproduireModele } from '../../../lib/studio/modeleBatimentMessage.ts';
import { ficheModeleBatiment } from '../../../lib/studio/modeleBatimentFiche.ts';
import { modeleCourant } from './modeleBatimentChat.ts';
import { NOTE_COMPOSITION, NOTE_EXTENSION, NOTE_HAUTEUR_INCONNUE, niveauxDeLaFiche, REFS_CATALOGUE_SITE, travailAvecModele } from './modeleTravail.ts';

const CONV = '7c0f0000-0000-4000-8000-0000000000aa';
function valide(brut: unknown): ModeleBatiment {
  const v = validerModele(brut);
  if (!v.ok) throw new Error(v.erreur);
  return v.modele;
}
/** Maison basque dessinée à R+5 (6 niveaux) ; la 3D préparée n'en retient que 2 (R+1). */
const DESSIN = valide({ ...EXEMPLE_MAISON_BASQUE, volumes: EXEMPLE_MAISON_BASQUE.volumes.map((v) => (v.id === 'principal' ? { ...v, niveaux: 6 } : v)) });
const DRAFT = { version: 1, objectif: 'Crée un bâtiment R+1 de 12 m sur 10 m', localisation: '12 rue des Lilas, Nanterre', programme: '1 maison', dimensions: '12 m sur 10 m', style: null, contraintes: null, questions: [], pieces: [] };
const CHARGE = { format: 'mimmoza-projet', version: 2, projetId: 'chat-7c0f', batiments: [], programme: { commandeArchitecture: 'Crée une maison R+1 de 12 m sur 10 m.' } };

function travail(type: 'image' | 'film' | 'visite360', charge: unknown = CHARGE, options: unknown = optionsParDefaut(type)) {
  const t = construireTravail(type, DRAFT, CONV, charge, options);
  if (!t.ok) throw new Error(t.erreur);
  return t.valeur;
}

test('aperçu / images : le dessin part dans fiche.modele_batiment, ramené à la hauteur de la 3D préparée', () => {
  for (const type of ['image', 'film', 'visite360'] as const) {
    const avant = travail(type);
    const r = travailAvecModele(avant, DESSIN);
    const mb = (r.travail.fiche as unknown as { modele_batiment: { v: number; empreinte: string; modele: ModeleBatiment; notes?: string[] } }).modele_batiment;
    assert.ok(mb, type);
    assert.equal(mb.v, 1);
    assert.equal(mb.empreinte, empreinteModele(DESSIN), 'empreinte du dessin d’origine (comme le chat)');
    assert.match(mb.empreinte, /^mb1-[0-9a-f]{8}$/, 'forme acceptée par lireModeleFiche');
    assert.ok(mb.modele.volumes.every((v) => v.niveaux <= 2), JSON.stringify(mb.modele.volumes.map((v) => v.niveaux)));
    assert.ok(mb.notes?.some((n) => /ramené de 6 à 2/.test(n)), JSON.stringify(mb.notes));
    // La machine de rendu relit le modèle en STRICT (contrat identique octet pour octet dans le Studio).
    assert.ok(validerModele(mb.modele, { strict: true }).ok, 'modèle relu en strict');
    // Le reste du travail est inchangé (options, charge, type) — rien ne change au prix.
    assert.deepEqual(r.travail.options, avant.options);
    assert.equal(r.travail.fiche.charge, avant.fiche.charge);
    assert.equal(r.note, null);
    assert.ok(JSON.stringify(r.travail.fiche).length < 2_000_000, 'contrainte de la table studio_jobs (fiche ≤ 2 Mo)');
  }
});

test('même règle que le chat : fiche identique à celle de ficheModeleBatiment (règle partagée avec l’Edge)', () => {
  const r = travailAvecModele(travail('image'), DESSIN);
  assert.deepEqual((r.travail.fiche as unknown as { modele_batiment: unknown }).modele_batiment, ficheModeleBatiment(DESSIN, 2, REFS_CATALOGUE_SITE));
  assert.ok(REFS_CATALOGUE_SITE.length > 50 && REFS_CATALOGUE_SITE.every((x) => /^(?:av|qm)-/.test(x)));
});

test('dessin en vigueur : dernier « Reproduire en 3D » ; habillage choisi ensuite → plus de dessin, travail inchangé', () => {
  const carte = (m: ModeleBatiment, id: string) => ({ id, role: 'assistant', text: 'Voici votre bâtiment.', toolCalls: [{ name: 'studio_dessiner_batiment', status: 'done', output: { status: 'ok', data: { carte: 'modele', empreinte: empreinteModele(m), corrections: [], modele: m } } }] });
  const retouche = valide({ ...DESSIN, volumes: DESSIN.volumes.map((v) => (v.id === 'garage' ? { ...v, niveaux: 1 } : v)), nom: 'Maison retouchée' });
  const messages = [
    carte(DESSIN, 'a1'), { id: 'u1', role: 'user', text: messageReproduireModele(DESSIN, empreinteModele(DESSIN)) },
    carte(retouche, 'a2'), { id: 'u2', role: 'user', text: messageReproduireModele(retouche, empreinteModele(retouche)) },
  ];
  const r = travailAvecModele(travail('image'), modeleCourant(messages));
  assert.equal((r.travail.fiche as unknown as { modele_batiment: { empreinte: string } }).modele_batiment.empreinte, empreinteModele(retouche));
  const ensuite = [...messages, { id: 'u3', role: 'user', text: 'Habillage choisi\n\n```mimmoza-brief\n{"v":1,"brief":{}}\n```' }];
  const avant = travail('image');
  const sans = travailAvecModele(avant, modeleCourant(ensuite));
  assert.equal(sans.travail, avant, 'aucun dessin : travail rendu tel quel');
  assert.ok(!('modele_batiment' in sans.travail.fiche));
});

test('cas sans dessin, dits : extension conservée, composition de bâtiments ; plusieurs bâtiments → joint (la machine le dit)', () => {
  const ext = travailAvecModele(travail('image', CHARGE, { ...optionsParDefaut('image'), existant: 'conserver' }), DESSIN);
  assert.ok(!('modele_batiment' in ext.travail.fiche));
  assert.equal(ext.note, NOTE_EXTENSION);
  const compo = travailAvecModele(travail('image', { ...CHARGE, extensionsV1: { compositionArchitecture: [{ name: 'A', commande: 'Crée un bâtiment R+3', centreZ: 0 }] } }), DESSIN);
  assert.ok(!('modele_batiment' in compo.travail.fiche));
  assert.equal(compo.note, NOTE_COMPOSITION);
  const multi = travailAvecModele(travail('image', { ...CHARGE, batiments: [{ id: 'b1' }, { id: 'b2' }] }), DESSIN);
  assert.ok('modele_batiment' in multi.travail.fiche, 'joint : le worker dit « seul son habillage est appliqué »');
});

test('hauteur de la 3D préparée : fiche « R+N », sinon commande ; illisible → dessin à sa hauteur et c’est dit', () => {
  assert.equal(niveauxDeLaFiche(DRAFT, CHARGE), 2);
  assert.equal(niveauxDeLaFiche({ ...DRAFT, objectif: 'Une maison', dimensions: null }, { programme: { commandeArchitecture: 'Crée un immeuble R+3' } }), 4);
  assert.equal(niveauxDeLaFiche({ ...DRAFT, objectif: 'Une maison', dimensions: null }, {}), null);
  const r = travailAvecModele(travail('image', CHARGE), DESSIN);
  assert.equal(r.note, null);
  const inconnu = travailAvecModele({ ...travail('image', { projetId: 'x' }), fiche: { ...travail('image').fiche, draft: { ...DRAFT, objectif: 'Une maison', dimensions: null }, charge: { projetId: 'x' } } } as never, DESSIN);
  assert.equal((inconnu as { note: string }).note, NOTE_HAUTEUR_INCONNUE);
});
