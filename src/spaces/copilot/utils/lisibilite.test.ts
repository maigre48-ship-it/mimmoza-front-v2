// src/spaces/copilot/utils/lisibilite.test.ts — LOT F1 (lisibilité des réponses).
// node --test (npm test) : fonctions pures, rendu Markdown sûr du projet.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { markdownToSafeHtml } from './exportCopilotPdf.ts';
import {
  CLASSE_REPONSE_DABORD, htmlLisible, marquerReponseDabord, mettreEnForme, regrouperParagraphes, scinderObjectif,
} from './lisibilite.ts';
import { construireModeleRapport } from '../agent/rapport/rapportModele.ts';
import { mettreEnForme as mettreEnFormeServeur } from '../../../../supabase/functions/_shared/texte/miseEnForme.ts';

const OBJECTIF =
  "Conception complète d'un programme de 40 logements. La mission doit : (1) vérifier le gabarit de rue UC 10-1 (prospect) ; " +
  '(2) appliquer les hauteurs du secteur graphique n° 1 ; (3) calculer les reculs obligatoires (art. UC 6, p. 109) ; ' +
  '(4) vérifier l\'emprise ; (5) respecter la pleine terre ; (6) dimensionner le stationnement ; (7) appliquer la mixité sociale ; ' +
  '(8) contrôler les destinations ; (9) estimer la SDP ; (10) produire la typologie ; (11) chiffrer au 09/12/2025 ; ' +
  'et (12) vérifier la compatibilité du programme avec la charge foncière de 3 821 404 €.';

test('front et serveur : la MÊME fonction mettreEnForme (import partagé, aucune copie)', () => {
  assert.equal(mettreEnForme, mettreEnFormeServeur);
  const src = readFileSync(new URL('./lisibilite.ts', import.meta.url), 'utf8');
  assert.match(src, /from '\.\.\/\.\.\/\.\.\/\.\.\/supabase\/functions\/_shared\/texte\/miseEnForme\.ts'/);
  assert.doesNotMatch(src, /function mettreEnForme/, 'pas de copie locale à synchroniser');
});

test('ancienne mission stockée en un seul bloc : rendue en liste numérotée, une ligne par point', () => {
  const html = htmlLisible(OBJECTIF, markdownToSafeHtml);
  assert.match(html, /^<p style="[^"]*">Conception complète d&#39;un programme de 40 logements\. La mission doit :<\/p><ol /);
  assert.equal((html.match(/<li /g) ?? []).length, 12);
  assert.match(html, /<li style="margin:2px 0;">vérifier le gabarit de rue UC 10-1 \(prospect\)<\/li>/);
  assert.match(html, /3 821 404 €\.<\/li><\/ol>$/);
  assert.doesNotMatch(html, /\(1\)|\(12\)/);
});

test('rendu sûr : aucun HTML brut réintroduit, même dans une énumération', () => {
  const html = htmlLisible('Étapes : (1) <script>alert(1)</script> ; (2) <img src=x onerror=alert(1)> ; (3) fin.', markdownToSafeHtml);
  assert.doesNotMatch(html, /<script|<img/);
  assert.match(html, /&lt;script&gt;/);
  assert.equal((html.match(/<li /g) ?? []).length, 3);
});

test('liste numérotée qui ne commence pas à 1 : le numéro écrit est conservé (plus de « 1. 1. 1. »)', () => {
  const html = markdownToSafeHtml('1. Premier\n\nTexte entre deux.\n\n2. Deuxième');
  assert.match(html, /<ol style=/);
  assert.match(html, /<ol start="2" style=/);
});

test('réponse d\'abord : premier paragraphe court suivi d\'une liste → mis en évidence', () => {
  const md = 'Oui, la parcelle est constructible en zone UC.\n\n## Ce qui pèse\n\n- Hauteur limitée à R+4\n- Emprise 50 %';
  const html = htmlLisible(md, markdownToSafeHtml, { reponseDabord: true });
  assert.ok(html.startsWith(`<p class="${CLASSE_REPONSE_DABORD}" style="`), html.slice(0, 80));
  assert.equal(html.split(CLASSE_REPONSE_DABORD).length, 2, 'un seul paragraphe mis en évidence');
});

test('réponse d\'abord : premier paragraphe après le titre « Ce qu\'il faut retenir »', () => {
  const md = "## Ce qu'il faut retenir\nLa parcelle est constructible sous réserve de la hauteur.\n\n## Ce qui pèse sur la décision\n\nTexte.";
  const html = htmlLisible(md, markdownToSafeHtml, { reponseDabord: true });
  assert.match(html, /^<h2[^>]*>Ce qu&#39;il faut retenir<\/h2><p class="mz-reponse-dabord"/);
});

test('réponse d\'abord : pas de mise en évidence si le texte commence par une liste, un tableau, est seul ou trop long', () => {
  for (const md of ['- a\n- b', '| A | B |\n| --- | --- |\n| 1 | 2 |', 'Une seule phrase.', `${'Très long. '.repeat(80)}\n\n- suite`]) {
    const html = htmlLisible(md, markdownToSafeHtml, { reponseDabord: true });
    assert.doesNotMatch(html, /mz-reponse-dabord/, md.slice(0, 30));
  }
  assert.match(marquerReponseDabord(markdownToSafeHtml('Une seule phrase.'), { exigerSuite: false }), /mz-reponse-dabord/);
});

test('htmlLisible : texte vide ou absent → chaîne vide ; sans option, identique au rendu du texte remis en forme', () => {
  assert.equal(htmlLisible('', markdownToSafeHtml), '');
  assert.equal(htmlLisible(null, markdownToSafeHtml), '');
  const md = '## Titre\n\n- a\n- b';
  assert.equal(htmlLisible(md, markdownToSafeHtml), markdownToSafeHtml(md));
});

test('scinderObjectif : titre + 12 points ; objectif sans liste = titre seul ; liste seule = titre vide', () => {
  const o = scinderObjectif(OBJECTIF);
  assert.equal(o.titre, "Conception complète d'un programme de 40 logements. La mission doit :");
  assert.equal(o.nbPoints, 12);
  assert.ok(o.detail!.startsWith('1. vérifier le gabarit de rue UC 10-1 (prospect)\n2. appliquer'));
  assert.deepEqual(scinderObjectif('Terrains 2 000 m² zone U à Rennes'), { titre: 'Terrains 2 000 m² zone U à Rennes', detail: null, nbPoints: 0 });
  assert.deepEqual(scinderObjectif('- lire\n- chiffrer'), { titre: '', detail: '- lire\n- chiffrer', nbPoints: 2 });
  assert.deepEqual(scinderObjectif(null), { titre: '', detail: null, nbPoints: 0 });
});

test('regrouperParagraphes : introduction + lignes de liste = un bloc ; prose inchangée', () => {
  assert.deepEqual(regrouperParagraphes(['Deux terrains retenus.', 'Points à lever :', '- hauteur', '- recul', 'À faire valider par un professionnel.']),
    ['Deux terrains retenus.', 'Points à lever :\n- hauteur\n- recul', 'À faire valider par un professionnel.']);
  assert.deepEqual(regrouperParagraphes(['A.', 'B.']), ['A.', 'B.']);
  assert.deepEqual(regrouperParagraphes(['1. un', '2. deux']), ['1. un\n2. deux']);
});

test('synthèse du rapport : énumération en ligne → une ligne de liste par paragraphe (exports), regroupée à l\'écran', () => {
  const m = construireModeleRapport(
    { id: 'm1', objectif: 'Prospection', type: 'prospection_fonciere', cree_le: '2026-11-01T10:00:00Z', termine_le: null, jetons_consommes: 10 } as never,
    { version: 2, titre: 'Rennes', synthese: 'Deux terrains retenus. Il reste : (1) lire le PLU ; (2) chiffrer la charge foncière ; (3) contacter la mairie. À faire valider par un professionnel.' },
  )!;
  assert.deepEqual(m.synthese, [
    'Deux terrains retenus. Il reste :', '1. lire le PLU', '2. chiffrer la charge foncière', '3. contacter la mairie.',
    'À faire valider par un professionnel.',
  ]);
  assert.deepEqual(regrouperParagraphes(m.synthese), [
    'Deux terrains retenus. Il reste :\n1. lire le PLU\n2. chiffrer la charge foncière\n3. contacter la mairie.',
    'À faire valider par un professionnel.',
  ]);
  // Synthèse en prose (sans énumération) : découpage d'origine inchangé.
  const p = construireModeleRapport({ id: 'm2', objectif: 'x', type: 'libre', cree_le: null, termine_le: null, jetons_consommes: 0 } as never,
    { version: 2, titre: 'T', synthese: 'Une. Deux. Trois. Quatre.' })!;
  assert.deepEqual(p.synthese, ['Une. Deux. Trois.', 'Quatre.']);
});
