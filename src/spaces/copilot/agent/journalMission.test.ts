// node --test src/spaces/copilot/agent/journalMission.test.ts
// LOT C3 — panneau des missions : le plan (journal, genre « plan ») s'affichait dans une colonne de 96 px.
// Cause : le texte d'une ligne de journal est rendu en Markdown et contient des <li> ; le sélecteur descendant
// « .mzag-journal li » leur appliquait la grille « 96px 1fr » de la ligne de journal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { htmlLisible } from '../utils/lisibilite.ts';
import { markdownToSafeHtml } from '../utils/exportCopilotPdf.ts';

const css = readFileSync(new URL('./agent.css', import.meta.url), 'utf8');

test('le plan d’une mission est bien rendu avec des <li> imbriqués dans la ligne de journal', () => {
  // Format écrit par le serveur (agent/mission.ts, traiterEnVol) : « Plan :\n1. …\n2. … ».
  const html = htmlLisible('Plan :\n1. Identifier la parcelle 93048000AS0249\n2. Lire le règlement de la zone UC91Jb2\n3. Établir le programme', markdownToSafeHtml);
  assert.equal((html.match(/<li\b/g) ?? []).length, 3);
});

test('la grille du journal ne vise que les lignes du journal, pas les listes de leur texte', () => {
  assert.equal(/\.mzag-journal\s+li\b/.test(css), false, 'sélecteur descendant « .mzag-journal li » encore présent');
  const regles = css.match(/\.mzag-journal\s*>\s*li\s*\{[^}]*\}/g) ?? [];
  assert.equal(regles.length, 2);
  assert.match(regles[0], /grid-template-columns:\s*96px minmax\(0, 1fr\)/);
});
