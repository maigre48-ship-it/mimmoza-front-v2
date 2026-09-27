import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizePacket, validateAiResult, PROJECT_KEYS } from './validation.ts';

const rawPacket = () => ({ parcelId: '64065000AI0002', communeInsee: '64065', terrainM2: 1500, pluZone: 'U', dataDate: '2026-09-27',
  sectors: PROJECT_KEYS.map((key) => ({ key, label: key, eligible: key === 'logement', targetHypothesis: 'Cible à vérifier', programmeHint: 'Programme à tester', missing: ['PLU'],
    facts: key === 'logement' ? [{ id: 'logement:1', label: 'Transactions DVF', value: '34', scope: 'Commune 64065', source: 'DVF', sourceUrl: 'https://www.data.gouv.fr/datasets/demandes-de-valeurs-foncieres', direct: true }] : [] })) });

test('le serveur valide la parcelle et reconstruit lui-même l’éligibilité', () => {
  const raw = rawPacket();
  raw.sectors[1].eligible = true;
  const packet = sanitizePacket(raw);
  assert.ok(packet);
  assert.equal(packet.sectors[1].eligible, false);
  raw.communeInsee = '64122';
  assert.equal(sanitizePacket(raw), null);
});

test('la sortie IA doit citer un fait existant et un secteur admissible', () => {
  const packet = sanitizePacket(rawPacket())!;
  const valid = { status: 'piste_prioritaire', projectKey: 'logement', target: 'Ménages locaux', programme: 'Logements à tester',
    rationale: 'Transactions constatées dans la commune, sous réserve de typologies adaptées.', evidenceIds: ['logement:1'],
    alternatives: [{ key: 'hotel', reason: 'Marché hôtelier à documenter.' }], conditions: ['Vérifier le PLU et le bilan prudent.'] };
  assert.equal(validateAiResult(valid, packet)?.projectKey, 'logement');
  assert.equal(validateAiResult({ ...valid, evidenceIds: ['inconnue:9'] }, packet), null);
  assert.equal(validateAiResult({ ...valid, projectKey: 'clinique' }, packet), null);
  const otherPacket = sanitizePacket({ ...rawPacket(), sectors: rawPacket().sectors.map((sector) =>
    sector.key === 'hotel' ? { ...sector, facts: [{ id: 'hotel:1', label: 'Nuitées', value: '100', scope: 'Département', source: 'INSEE', direct: true }] } : sector) })!;
  assert.equal(validateAiResult({ ...valid, evidenceIds: ['hotel:1'] }, otherPacket), null);
  const housingWithContext = sanitizePacket({ ...rawPacket(), sectors: rawPacket().sectors.map((sector) => sector.key === 'logement'
    ? { ...sector, facts: [...sector.facts, { id: 'logement:2', label: 'Prix médian', value: '4300', scope: 'Commune', source: 'DVF', direct: false }] }
    : sector) })!;
  assert.equal(validateAiResult({ ...valid, evidenceIds: ['logement:2'] }, housingWithContext), null);
});

test('aucune priorité est une réponse valide quand les marchés ne sont pas comparables', () => {
  const packet = sanitizePacket(rawPacket())!;
  const result = validateAiResult({ status: 'aucune_priorite', projectKey: null, rationale: 'Données insuffisantes.',
    target: '', programme: '', evidenceIds: [], alternatives: [], conditions: ['Marché local à mesurer.'] }, packet);
  assert.equal(result?.status, 'aucune_priorite');
});
