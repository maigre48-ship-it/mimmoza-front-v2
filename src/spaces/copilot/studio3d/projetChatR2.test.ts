// R2 — transfert tchat → Studio au format v2 : construction, aller-retour sans perte,
// migration depuis la v1, N bâtiments, relief différé, révision, message de fermeture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decoderProjet, encoderProjet, migrerV1versV2, versChargeV1 } from '../../promoteur/shared/echangeStudio/mimmozaProjetV2.ts';
import {
  adresseStudioIntegre, chargeV1Chat, etudeDuChat, construireProjetChat, lireFermetureStudio, messageRelief, prochaineRevision, projetIdChat,
  type EntreeProjetChat,
} from './projetChat.ts';

const CONV = '3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f';
const SESSION = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const parcelle = { type: 'Feature', properties: { idu: '64065000AI0001', code_insee: '64065', contenance: 812 },
  geometry: { type: 'Polygon', coordinates: [[[-1.4750, 43.4920], [-1.4744, 43.4920], [-1.4744, 43.4925], [-1.4750, 43.4925], [-1.4750, 43.4920]]] } };
const relief = {
  provider: 'IGN_ALTI', renderBounds: [-1.4755, 43.4917, -1.4739, 43.4928] as [number, number, number, number],
  parcelBounds: [-1.4750, 43.4920, -1.4744, 43.4925] as [number, number, number, number],
  grid: { n: 3, z: [[12.1, 12.4, 12.9], [12.3, 12.7, 13.2], [12.6, 13.0, 13.5]] }, altitudeMin: 12.1, altitudeMax: 13.5, penteMoyenne: 4.2,
};
const composition = ['A', 'B', 'C', 'D', 'E'].map((l, i) => ({ name: `Bâtiment ${l}`, commande: `Crée un bâtiment R+${String(i + 1)} de 20 m sur 12 m.`, centreZ: -40 + i * 20 }));

function entree(partiel: Partial<EntreeProjetChat> = {}): EntreeProjetChat {
  return {
    conversationId: CONV, sessionId: SESSION, origine: 'https://mimmoza.vercel.app', retourUrl: `https://mimmoza.vercel.app/mimmozia?conversation=${CONV}`,
    revision: 3, horodatage: '2026-10-16T10:00:00.000Z',
    parcelles: [{ id: '64065000AI0001', feature: parcelle }], communeInsee: '64065', adresse: '12 rue de la Gare 64100 Bayonne',
    pointAdresse: { lat: 43.4921, lon: -1.4747 }, relief,
    implantation: { lon: -1.4747, lat: 43.49225, orientationDeg: 12, entryOffsetM: 0.3 },
    accesses: [{ kind: 'pieton', lon: -1.4747, lat: 43.4920 }],
    brief: 'Dossier 3D confirmé avec Mimmo.\nprogramme : 24 logements', commandeArchitecture: null,
    compositionArchitecture: composition, volumeAiles: null,
    plans: [{ url: 'https://x.supabase.co/storage/v1/object/sign/studio-transfert/u/s/plan.pdf?token=t', nom: 'plan.pdf' }],
    ...partiel,
  };
}

test('R2 identifiant de projet commun front/Studio, stable par conversation', () => {
  assert.equal(projetIdChat(CONV), `mzchat-${CONV}`);
  assert.equal(projetIdChat(CONV), projetIdChat(CONV));
});

test('R2 projet v2 du tchat : validé, session de retour, révision, 5 bâtiments', () => {
  const r = construireProjetChat(entree());
  assert.ok(r.ok, r.ok ? '' : r.erreur);
  if (!r.ok) return;
  assert.equal(r.projet.format, 'mimmoza-projet-v2');
  assert.equal(r.projet.projetId, `mzchat-${CONV}`);
  assert.equal(r.projet.revision, 3);
  assert.equal(r.projet.origine, 'mimmoza-front');
  assert.deepEqual(r.projet.session, { id: SESSION, conversationId: CONV, retourOrigine: 'https://mimmoza.vercel.app', retourUrl: `https://mimmoza.vercel.app/mimmozia?conversation=${CONV}` });
  assert.equal(r.projet.extensionsV1.compositionArchitecture?.length, 5);
  assert.equal(r.projet.site.relief?.grille.n, 3);
  assert.deepEqual(r.projet.extensionsV1.implantation, { lon: -1.4747, lat: 43.49225, orientationDeg: 12, entryOffsetM: 0.3 });
});

test('R2 aller-retour sans perte : v2 encodé → décodé → charge v1 identique à la charge du tchat', () => {
  const e = entree();
  const r = construireProjetChat(e);
  assert.ok(r.ok);
  if (!r.ok) return;
  const lu = decoderProjet(encoderProjet(r.projet));
  assert.ok(lu.ok);
  if (!lu.ok) return;
  assert.deepEqual(lu.projet, r.projet);
  const v1 = versChargeV1(lu.projet);
  const attendu = chargeV1Chat(e);
  // Le contrat ne garde de chaque parcelle que l'identifiant et la géométrie (Studio recalcule surfaces et limites).
  const sansProprietes = (l: unknown) => (l as { id: string; feature: { geometry: unknown } }[]).map((p) => ({ id: p.id, geometrie: p.feature.geometry }));
  assert.deepEqual(sansProprietes(v1.parcels), sansProprietes(attendu.parcels));
  for (const cle of ['terrainData', 'implantation', 'accesses', 'compositionArchitecture', 'brief', 'plans', 'communeInsee', 'adresse', 'pointAdresse', 'bridgeSessionId', 'conversationId', 'openerOrigin']) {
    assert.deepEqual(v1[cle], attendu[cle], `champ ${cle}`);
  }
  // Les parcelles reviennent en Feature : la géométrie est intacte.
  assert.deepEqual((v1.parcels as { feature: { geometry: unknown } }[])[0]!.feature.geometry, parcelle.geometry);
});

test('R2 migration depuis la v1 (ancien `#parcelles=`) : rien de perdu, N bâtiments acceptés par le contrat', () => {
  const ancienne = chargeV1Chat(entree());
  const m = migrerV1versV2(ancienne, { projetId: 'mz-v1-test', etudeId: null, horodatage: '2026-10-16T10:00:00.000Z' });
  assert.ok(m.ok, m.ok ? '' : m.erreur);
  if (!m.ok) return;
  assert.equal(m.migreDepuisV1, true);
  assert.equal(m.projet.extensionsV1.compositionArchitecture?.length, 5);
  assert.deepEqual(versChargeV1(m.projet).compositionArchitecture, ancienne.compositionArchitecture);
});

test('R2 composition : 8 bâtiments acceptés, 9 refusés explicitement (jamais tronqués en silence)', () => {
  const huit = Array.from({ length: 8 }, (_, i) => ({ name: `B${String(i)}`, commande: 'Crée un bâtiment R+1 de 10 m sur 10 m.', centreZ: i * 15 - 50 }));
  assert.equal(construireProjetChat(entree({ compositionArchitecture: huit })).ok, true);
  const neuf = [...huit, { name: 'B9', commande: 'Crée un bâtiment R+1.', centreZ: 80 }];
  const r = construireProjetChat(entree({ compositionArchitecture: neuf }));
  assert.equal(r.ok, false);
});

test('R2 relief différé : sans relief, ni grille ni implantation dans le projet ; elles suivent dans le message de relief', () => {
  const r = construireProjetChat(entree({ relief: null }));
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.projet.site.relief, null);
  assert.equal(r.projet.extensionsV1.implantation, null);
  assert.equal(r.projet.acces.length, 0);
  const m = messageRelief(SESSION, { ok: true, terrain: relief }, { lon: -1.4747, lat: 43.49225, orientationDeg: 12, entryOffsetM: 0.3 });
  assert.equal(m.type, 'mimmoza-relief-v1');
  assert.equal(m.etat, 'mesure');
  assert.deepEqual(m.terrainData, relief);
  assert.deepEqual(messageRelief(SESSION, { ok: false, message: 'délai dépassé' }), { type: 'mimmoza-relief-v1', sessionId: SESSION, etat: 'indisponible', raison: 'délai dépassé' });
});

test('R2 adresse de Studio intégré : projet annoncé en paramètre, projet transmis par poignée de main', () => {
  const u = new URL(adresseStudioIntegre('https://mimmoza.vercel.app/studio', `mzchat-${CONV}`, SESSION));
  assert.equal(u.pathname, '/studio/');
  assert.equal(u.searchParams.get('mzprojet'), `mzchat-${CONV}`);
  assert.equal(u.hash, `#projet-attente=${SESSION}`);
});

test('R2 révision croissante par conversation', () => {
  const m = new Map<string, string>();
  const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
  assert.equal(prochaineRevision(CONV, st), 1);
  assert.equal(prochaineRevision(CONV, st), 2);
  assert.equal(prochaineRevision('autre', st), 1);
  assert.equal(prochaineRevision(CONV, null), 1);
});

test('R2 message « Retour au projet / Bilan » de Studio intégré', () => {
  assert.equal(lireFermetureStudio({ type: 'mimmoza-studio-fermer-v1', vers: 'projet' }), 'projet');
  assert.equal(lireFermetureStudio({ type: 'mimmoza-studio-fermer-v1', vers: 'bilan' }), 'bilan');
  assert.equal(lireFermetureStudio({ type: 'autre' }), null);
  assert.equal(lireFermetureStudio(null), null);
});

test('R2 étude rattachée : figée par conversation, transmise dans le projet et dans ?etude=', () => {
  const m = new Map<string, string>();
  const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
  assert.equal(etudeDuChat(CONV, null, st), null);
  assert.equal(etudeDuChat(CONV, 'etude-42', st), 'etude-42');
  assert.equal(etudeDuChat(CONV, 'etude-autre', st), 'etude-42');
  const r = construireProjetChat(entree({ etudeId: 'etude-42' }));
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.projet.etudeId, 'etude-42');
  const u = new URL(adresseStudioIntegre('https://m.app/studio/', 'mzchat-x', SESSION, 'etude-42'));
  assert.equal(u.searchParams.get('etude'), 'etude-42');
  assert.equal(new URL(adresseStudioIntegre('https://m.app/studio/', 'mzchat-x', SESSION, 'a b')).searchParams.get('etude'), null);
});
