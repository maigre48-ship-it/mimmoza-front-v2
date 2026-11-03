import assert from 'node:assert/strict';
import test from 'node:test';
import { cleChoixManuel, contexteVolume, parcellesCitees, programmeDepuisTexte, programmeDuContexte, recommandationDuMessage, selectionDossier, type MessageContexte } from './contexteVolume.ts';
import type { ParcelleRetenue } from './parcelleConfirmee.ts';

const CONV = 'conv-nanterre';
const N0606 = '920500000N0606', AE0376 = '92050000AE0376', AN0412 = '92050000AN0412', AT0204 = '92050000AT0204';
let n = 0;
const user = (text: string): MessageContexte => ({ id: `u${n++}`, role: 'user', text, createdAt: '2026-11-02T09:00:00Z', toolCalls: [] });
const assistant = (text: string, toolCalls: MessageContexte['toolCalls'] = [], id = `a${n++}`): MessageContexte => ({ id, role: 'assistant', text, createdAt: '2026-11-02T10:00:00Z', toolCalls });
const stockage = (valeurs: Record<string, string>) => ({ getItem: (cle: string) => valeurs[cle] ?? null });

/** Étude d'une parcelle (get_etude_parcelle) avec la zone au point. */
const etude = (idu: string, zone: string, surface: number, lat = 48.89, lon = 2.2) => ({ name: 'get_etude_parcelle', status: 'success', input: { cadastral_ref: idu }, output: { data: {
  parcelle: { idu, lat, lon, surface_m2: surface },
  urbanisme_point: { couches: [{ couche: 'zone-urba', statut: 'interrogee', elements: [{ libelle: zone }] }] },
  evidences: [{ id: 'reglement_plu', label: 'Règlement PLU', status: 'unavailable', scope: 'point', source: 'GPU' }] } } });

/** Conversation réelle (Nanterre) : classement N0606, AE0376, AN0412, AT0204 ; études dans cet ordre ; synthèse qui recommande AE0376. */
function nanterre(): MessageContexte[] {
  return [
    user('Trouve-moi les 4 meilleurs terrains à Nanterre pour 40 logements sociaux'),
    assistant('Voici les terrains classés.', [{ name: 'rechercher_parcelles', status: 'success', output: { status: 'ok', data: { parcelles: [
      { idu: N0606, surface_m2: 5210, zone: 'UC', centroide: [2.201, 48.891] },
      { idu: AE0376, surface_m2: 2870, zone: 'UA', centroide: [2.205, 48.893] },
      { idu: AN0412, surface_m2: 3940, zone: 'UBb', centroide: [2.21, 48.88] },
      { idu: AT0204, surface_m2: 2400, zone: 'UB', centroide: [2.22, 48.885] },
    ] } } }]),
    assistant('Étude N0606.', [etude(N0606, 'UC', 5210)]),
    assistant('Étude AE0376.', [etude(AE0376, 'UA', 2870)]),
    assistant('Étude AT0204.', [etude(AT0204, 'UB', 2400)]),
    assistant('Dossier AN0412.', [
      { name: 'get_parcelle_depuis_adresse', status: 'success', output: { data: { adresse: { libelle: '1 rue X 92000 Nanterre', lat: 48.88, lon: 2.21 }, parcelle: { idu: AN0412, contenance_m2: 3940 } } } },
      etude(AN0412, 'UBb', 3940, 48.88, 2.21),
    ], 'm-dossier'),
    assistant('Synthèse des quatre terrains.\n1. N0606 : grande parcelle mais zone UC contrainte.\n2. AN0412 : PPRI au point, à vérifier.\n**La parcelle AE0376 (2 870 m², zone UA) présente le profil le plus net** pour 40 logements sociaux. AT0204 est à écarter.'),
  ];
}

test('Nanterre : la parcelle RECOMMANDÉE par Mimmo (AE0376) l’emporte sur le dernier dossier (AN0412) et sur la 1re du classement', () => {
  const c = contexteVolume({ messages: nanterre(), conversationId: CONV, fiche: null, retenue: null, stockage: null });
  assert.equal(c.parcelle.type, 'candidate');
  if (c.parcelle.type !== 'candidate') return;
  assert.equal(c.parcelle.candidate.idu, AE0376);
  assert.equal(c.parcelle.raison, 'recommandee');
  assert.match(c.parcelle.detail ?? '', /profil le plus net/);
  assert.deepEqual(c.parcelle.candidate.point, { lon: 2.205, lat: 48.893 });
  assert.equal(c.zone, 'UA');
  assert.deepEqual(c.candidates.map(x => x.idu), [N0606, AE0376, AN0412, AT0204]);
  assert.equal(c.programme.logements, 40);
});

test('IDU cité par l’utilisateur dans son dernier message qui en cite un : il prime sur la recommandation', () => {
  const c = contexteVolume({ messages: [...nanterre(), user('Et sur la AT 204, ça donnerait quoi ?')], conversationId: CONV, fiche: null, retenue: null, stockage: null });
  assert.equal(c.parcelle.type === 'candidate' && c.parcelle.candidate.idu, AT0204);
  assert.equal(c.parcelle.type === 'candidate' && c.parcelle.raison, 'citee-utilisateur');
  const complet = contexteVolume({ messages: [...nanterre(), user('Prends plutôt 92050 000 AN 0412')], conversationId: CONV, fiche: null, retenue: null, stockage: null });
  assert.equal(complet.parcelle.type === 'candidate' && complet.parcelle.candidate.idu, AN0412);
  // Deux parcelles citées : ambigu, on passe au signal suivant (la recommandation).
  const deux = contexteVolume({ messages: [...nanterre(), user('Compare AT0204 et AN0412')], conversationId: CONV, fiche: null, retenue: null, stockage: null });
  assert.equal(deux.parcelle.type === 'candidate' && deux.parcelle.raison, 'recommandee');
});

test('choix manuel mémorisé (stockage scopé utilisateur) : prime sur la conversation, pas sur une parcelle confirmée', () => {
  const manuel = stockage({ [cleChoixManuel(CONV)]: N0606 });
  const c = contexteVolume({ messages: [...nanterre(), user('Et la AT0204 ?')], conversationId: CONV, fiche: null, retenue: null, stockage: null, stockageUtilisateur: manuel });
  assert.equal(c.parcelle.type === 'candidate' && c.parcelle.candidate.idu, N0606);
  assert.equal(c.parcelle.type === 'candidate' && c.parcelle.raison, 'manuel');
  assert.equal(c.zone, 'UC');
  const retenue: ParcelleRetenue = {
    parcel: { type: 'Feature', properties: { idu: AN0412 }, geometry: { type: 'Polygon', coordinates: [[[2.21, 48.88], [2.211, 48.88], [2.211, 48.881], [2.21, 48.88]]] } },
    point: { lat: 48.8805, lon: 2.2105 }, adresse: 'Adresse confirmée', retenueLe: '2026-11-02T11:00:00Z',
  };
  const confirmee = contexteVolume({ messages: nanterre(), conversationId: CONV, fiche: null, retenue, stockage: null, stockageUtilisateur: manuel });
  assert.equal(confirmee.parcelle.type, 'confirmee');
  assert.equal(confirmee.parcelle.type === 'confirmee' && confirmee.parcelle.idu, AN0412);
  assert.equal(confirmee.zone, 'UBb');
  assert.equal(confirmee.adresse, 'Adresse confirmée');
});

test('sans recommandation : la mieux classée parmi les étudiées ; sans classement : le dernier dossier', () => {
  const sansSynthese = nanterre().slice(0, -1);
  const c = contexteVolume({ messages: sansSynthese, conversationId: CONV, fiche: null, retenue: null, stockage: null });
  assert.equal(c.parcelle.type === 'candidate' && c.parcelle.candidate.idu, N0606);
  assert.equal(c.parcelle.type === 'candidate' && c.parcelle.raison, 'classement');
  const dossierSeul = [user('Immeuble social de 40 logements'), nanterre()[5]];
  const d = contexteVolume({ messages: dossierSeul, conversationId: CONV, fiche: null, retenue: null, stockage: null });
  assert.equal(d.parcelle.type === 'candidate' && d.parcelle.raison, 'dernier-dossier');
  assert.equal(d.parcelle.type === 'candidate' && d.parcelle.candidate.idu, AN0412);
  assert.equal(d.adresse, '1 rue X 92000 Nanterre');
  assert.equal(d.pluManquant, true);
  assert.equal(contexteVolume({ messages: [user('Bonjour')], conversationId: CONV, fiche: null, retenue: null, stockage: null }).parcelle.type, 'aucune');
});

test('carte du Dossier de décision : une parcelle choisie = choisie dans la conversation ; plusieurs = candidates', () => {
  const cle = `mimmoza.parcel-dossier.v1.${CONV}.m-dossier`;
  const msgs = [user('Immeuble social de 40 logements'), nanterre()[5]];
  const une = contexteVolume({ messages: msgs, conversationId: CONV, fiche: null, retenue: null, stockage: stockage({ [cle]: JSON.stringify({ selected: [{ id: '92050000AN0413', areaM2: 812 }] }) }) });
  assert.equal(une.parcelle.type === 'candidate' && une.parcelle.raison, 'carte-dossier');
  assert.equal(une.parcelle.type === 'candidate' && une.parcelle.candidate.idu, '92050000AN0413');
  const deux = contexteVolume({ messages: msgs, conversationId: CONV, fiche: null, retenue: null, stockage: stockage({ [cle]: JSON.stringify({ selected: [{ id: AN0412 }, { id: '92050000AN0413' }] }) }) });
  assert.equal(deux.parcelle.type === 'candidate' && deux.parcelle.raison, 'dernier-dossier');
  assert.equal(deux.candidates.length, 2);
  assert.deepEqual(selectionDossier(CONV, 'm-dossier', stockage({ [cle]: '{pas du json' })), []);
});

test('lecture des citations et des recommandations', () => {
  const ids = [N0606, AE0376, AN0412];
  assert.deepEqual(parcellesCitees('Je préfère N0606, pas AE 376.', ids), [N0606, AE0376]);
  assert.deepEqual(parcellesCitees('Immeuble R+3, T3 de 65 m²', ids), []);
  assert.equal(recommandationDuMessage(assistant('Je recommande AN0412 en premier.'), ids)?.idu, AN0412);
  assert.equal(recommandationDuMessage(assistant('Je ne recommande pas AN0412.'), ids), null);
  assert.equal(recommandationDuMessage(assistant('AE0376 en premier, N0606 en second.'), ids), null);
  const structure = assistant('Rapport.', [{ name: 'rapport_terrain', status: 'success', input: { idu: N0606, commune: 'Nanterre', verdict: 'prioritaire' } }]);
  assert.equal(recommandationDuMessage(structure, ids)?.idu, N0606);
});

test('règles PLU de la conversation filtrées sur la zone de la parcelle affichée', () => {
  const msgs = [...nanterre(), assistant('Règles.', [
    { name: 'get_parcel_plu', status: 'success', input: { cadastral_ref: N0606 }, output: { source: 'plu-parser (Mimmoza)', data: { zone_code: 'UC', regles: { hauteur_max_m: 21 } } } },
    { name: 'get_parcel_plu', status: 'success', input: { cadastral_ref: AE0376 }, output: { source: 'plu-parser (Mimmoza)', data: { zone_code: 'UA', regles: { hauteur_max_m: 16, emprise_sol_max_ratio: 0.6 } } } },
  ])];
  // Le dernier message assistant n'est pas une synthèse : la recommandation précédente reste lue.
  const c = contexteVolume({ messages: msgs, conversationId: CONV, fiche: null, retenue: null, stockage: null });
  assert.equal(c.parcelle.type === 'candidate' && c.parcelle.candidate.idu, AE0376);
  assert.deepEqual(c.regles.regles.map(r => [r.cle, r.valeur]), [['hauteur_max_m', 16], ['emprise_max_ratio', 0.6]]);
  assert.ok(c.regles.nonAppliquees.some(l => /zone UC/.test(l)));
});

test('programme : texte, fiche, limites', () => {
  assert.deepEqual(programmeDepuisTexte('je veux un immeuble social de 40 logements'), { logements: 40, libelle: '40 logements sociaux' });
  assert.deepEqual(programmeDepuisTexte('Projet de vingt appartements'), { logements: 20, libelle: '20 appartements' });
  assert.equal(programmeDepuisTexte('40 logements maximum selon l’OAP'), null);
  const fiche = { version: 1 as const, objectif: 'Immeuble', programme: '24 logements', localisation: null, dimensions: null, style: null, contraintes: null, questions: [], pieces: [] };
  assert.equal(programmeDuContexte([user('Fais 30 logements')], fiche).logements, 24);
  assert.equal(programmeDuContexte([user('Fais 30 logements')], null).origine, 'conversation');
});
