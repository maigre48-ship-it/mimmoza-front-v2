import { test } from 'node:test';
import assert from 'node:assert/strict';
import { echecsRemplaces } from './HistoriqueRendus.tsx';
import type { TravailStudio } from '../../../lib/studio/travauxLogique.ts';

const t = (id: string, type: string, statut: string, cree_le: string) => ({ id, type, statut, cree_le, options: {}, resultat: null }) as unknown as TravailStudio;

test('un échec suivi d’un rendu réussi du même type est remplacé', () => {
  const m = echecsRemplaces([t('a', 'film', 'echec', '2026-11-26T08:04:00Z'), t('b', 'film', 'termine', '2026-11-26T08:45:00Z')]);
  assert.equal(m.get('a'), '2026-11-26T08:45:00Z');
});
test('un rendu en cours après l’échec le remplace aussi', () => {
  assert.ok(echecsRemplaces([t('a', 'film', 'echec', '2026-11-26T08:04:00Z'), t('b', 'film', 'en_cours', '2026-11-26T08:45:00Z')]).has('a'));
});
test('un échec suivi d’un autre échec, ou d’un rendu d’un autre type, reste affiché', () => {
  const m = echecsRemplaces([t('a', 'film', 'echec', '2026-11-26T08:04:00Z'), t('b', 'film', 'echec', '2026-11-26T08:45:00Z'), t('c', 'image', 'termine', '2026-11-26T09:00:00Z')]);
  assert.equal(m.has('a'), false); assert.equal(m.has('b'), false);
});
test('un rendu réussi AVANT l’échec ne le remplace pas', () => {
  assert.equal(echecsRemplaces([t('a', 'film', 'termine', '2026-11-26T08:00:00Z'), t('b', 'film', 'echec', '2026-11-26T08:45:00Z')]).has('b'), false);
});
