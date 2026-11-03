import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerChoixLiaison, confirmerLiaison, type DepotLiaison } from './liaisonEtude.ts';
import { projetConception } from './projetConception.ts';
import { adresseStudioIntegre } from '../../studio3d/projetChat.ts';
import type { Conception } from './conceptionLogique.ts';
const id = '12345678-1234-1234-1234-123456789abc';
const etudes = [{ id, title: 'Étude choisie' }];
const depot = (overrides: Partial<DepotLiaison> = {}): DepotLiaison => ({ lister: async () => etudes, lire: async () => id, enregistrer: async () => {}, ...overrides });
test('relit uniquement la liaison explicite persistée', async () => {
  assert.deepEqual(await chargerChoixLiaison('c1', depot()), { etudes, etudeId: id });
  assert.equal((await chargerChoixLiaison('c2', depot({ lire: async () => null }))).etudeId, null);
});
test('refuse une liaison inaccessible et propage une migration absente', async () => {
  await assert.rejects(chargerChoixLiaison('c1', depot({ lister: async () => [] })), /accessible/);
  await assert.rejects(chargerChoixLiaison('c1', depot({ lire: async () => { throw new Error('migration absente'); } })), /migration absente/);
});
test('enregistre avant autoriser ouverture, y compris suppression explicite', async () => {
  const appels: unknown[] = []; let finir!: () => void;
  const attente = new Promise<void>(r => { finir = r; });
  const d = depot({ enregistrer: async (c, e) => { appels.push([c,e]); await attente; } });
  let ouvert = false;
  const confirmation = confirmerLiaison('c1', id, etudes, d).then(e => { ouvert = true; return e; });
  await Promise.resolve(); assert.equal(ouvert, false); finir();
  assert.equal(await confirmation, id); assert.deepEqual(appels, [['c1',id]]);
  assert.equal(await confirmerLiaison('c1', null, etudes, depot({ enregistrer: async (_, e) => { assert.equal(e, null); } })), null);
});
test('refuse identifiant hors liste et échec sauvegarde sans ouvrir', async () => {
  let ecrit = false;
  await assert.rejects(confirmerLiaison('c1', 'autre', etudes, depot({ enregistrer: async () => { ecrit = true; } })), /accessible/);
  assert.equal(ecrit, false);
  await assert.rejects(confirmerLiaison('c1', id, etudes, depot({ enregistrer: async () => { throw new Error('refus RLS'); } })), /RLS/);
});
const c = { id: 'conception-1', idu: '93048000AJ0209', commune: 'Commune', parcelle: { idu: '93048000AJ0209', geometrie: { type: 'Polygon', coordinates: [[[2,48],[2.001,48],[2.001,48.001],[2,48.001],[2,48]]] }, surface_m2: 1000, source: 'cadastre' } } as unknown as Conception;
test('projet et URL portent la même étude choisie, absence reste null', () => {
  const r = projetConception(c, '12345678-1234-1234-1234-123456789def', 'https://mimmoza.test', 'https://mimmoza.test/chat', id);
  assert.ok(r.ok); if (!r.ok) return;
  assert.equal(r.projet.etudeId, id);
  assert.equal(new URL(adresseStudioIntegre('https://mimmoza.test/studio/', r.projet.projetId, 'session', id)).searchParams.get('etude'), id);
  const sans = projetConception(c, '12345678-1234-1234-1234-123456789def', 'https://mimmoza.test', 'https://mimmoza.test/chat');
  assert.ok(sans.ok); if (sans.ok) assert.equal(sans.projet.etudeId, null);
});

test('sauvegarde puis relit le changement explicite A vers B', async () => {
  const b = '22345678-1234-1234-1234-123456789abc'; let persiste: string | null = id;
  const liste = [...etudes, { id: b, title: 'Étude B' }];
  const d = depot({ lister: async () => liste, lire: async () => persiste, enregistrer: async (_, e) => { persiste = e; } });
  assert.equal((await chargerChoixLiaison('c1', d)).etudeId, id);
  await confirmerLiaison('c1', b, liste, d);
  assert.equal((await chargerChoixLiaison('c1', d)).etudeId, b);
});
test('refuse étude explicite invalide et conserve parcelle pendant changement de liaison', () => {
  assert.equal(projetConception(c, '12345678-1234-1234-1234-123456789def', 'https://mimmoza.test', 'https://mimmoza.test/chat', 'invalide').ok, false);
  const r = projetConception(c, '12345678-1234-1234-1234-123456789def', 'https://mimmoza.test', 'https://mimmoza.test/chat', id);
  const sans = projetConception(c, '12345678-1234-1234-1234-123456789def', 'https://mimmoza.test', 'https://mimmoza.test/chat');
  assert.ok(r.ok && sans.ok);
  if (r.ok && sans.ok) {
    assert.equal(r.projet.site.parcelles.length, 1);
    assert.deepEqual(r.projet.site.parcelles[0].geometrie?.coordinates, c.parcelle!.geometrie.coordinates);
    assert.deepEqual(r.projet.site.parcelles, sans.projet.site.parcelles);
  }
});

test('étude archivée : jamais proposée ni acceptée, liaison archivée signalée sans présélection', async () => {
  const archivee = '32345678-1234-1234-1234-123456789abc';
  const liste = [...etudes, { id: archivee, title: 'Ancienne', archivee: true }];
  const r = await chargerChoixLiaison('c1', depot({ lister: async () => liste, lire: async () => archivee }));
  assert.equal(r.etudeId, null); assert.match(r.avertissement ?? '', /archivée/);
  assert.deepEqual(r.etudes.map(e => e.id), [id]);
  let ecrit = false;
  await assert.rejects(confirmerLiaison('c1', archivee, liste, depot({ enregistrer: async () => { ecrit = true; } })), /accessible/);
  assert.equal(ecrit, false);
});
