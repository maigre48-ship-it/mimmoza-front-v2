// node --test src/spaces/copilot/studio3d/vis23EtapeDemandee.test.ts
// VIS-23 — « Personnaliser l'intérieur (Studio) » : en plus de la mémoire des colonnes, le site dépose une DEMANDE
// datée (clé mimmozia.ui.etape-demandee : etape, sous, at) que le Studio lit au chargement — sinon il ouvrait toujours
// « Terrain » à l'arrivée du projet. Contrôle sur la source (le module importe l'alias « @ », non résolu hors Vite).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./parcours.store.ts', import.meta.url), 'utf8');

test('preparerEtapeStudio dépose la demande datée, dans le même bloc protégé que la mémoire des colonnes', () => {
  assert.match(source, /export const CLE_ETAPE_DEMANDEE_STUDIO = 'mimmozia\.ui\.etape-demandee';/);
  const corps = source.slice(source.indexOf('export function preparerEtapeStudio'));
  const essai = corps.slice(corps.indexOf('try {'), corps.indexOf('} catch'));
  assert.match(essai, /setItem\(CLE_COLONNES_STUDIO,/);
  assert.match(essai, /setItem\(CLE_ETAPE_DEMANDEE_STUDIO, JSON\.stringify\(\{ etape, sous, at: Date\.now\(\) \}\)\)/);
});
