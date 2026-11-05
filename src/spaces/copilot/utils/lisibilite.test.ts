// src/spaces/copilot/utils/lisibilite.test.ts — LOT F1 (lisibilité des réponses).
// node --test (npm test) : fonctions pures, rendu Markdown sûr du projet.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { markdownToSafeHtml } from './exportCopilotPdf.ts';
import {
  CLASSE_REPONSE_DABORD, htmlLisible, marquerReponseDabord, mettreEnForme, regrouperParagraphes, scinderObjectif,
  phrasesLisibles, recollerCoupures,
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

// ── Lot A (point 3) : synthèse coupée au milieu d'une parenthèse ────────────────────────────────
// Phrase RÉELLE de la synthèse de la mission de conception du 05/11/2026 (parcelle 92050000AE0414),
// telle que relevée (« … » = passages non relevés).
const SYNTHESE_AE0414 =
  '… hauteur acrotère 28 m (secteur 1, art. UC 10), recul voie 0 ou 4 m au choix du constructeur (art. UC 6-1), reculs latéraux … (art. UC 13-1)';
const sansCoupure = (b: string) => !/\((?:art|p|cf)\.\s*$/.test(b) && (b.match(/\(/g) ?? []).length === (b.match(/\)/g) ?? []).length;

test('lot A : phrasesLisibles ne coupe jamais après « art. », « p. », « cf. », « n° », « env. », « ex. » ni dans une parenthèse', () => {
  assert.deepEqual(phrasesLisibles(SYNTHESE_AE0414), [SYNTHESE_AE0414]);
  assert.deepEqual(phrasesLisibles(`${SYNTHESE_AE0414}. Programme à confirmer.`), [`${SYNTHESE_AE0414}.`, 'Programme à confirmer.']);
  assert.deepEqual(phrasesLisibles('Voir cf. Annexe. Surface env. 3 651 m², ex. Lot 2, n° 4. Fin (voir p. 12. Suite) ici.'),
    ['Voir cf. Annexe.', 'Surface env. 3 651 m², ex. Lot 2, n° 4.', 'Fin (voir p. 12. Suite) ici.']);
  // Sauts voulus conservés (comportement historique) : « Une. Deux. Trois. Quatre. ».
  assert.deepEqual(phrasesLisibles('Une. Deux. Trois. Quatre.'), ['Une.', 'Deux.', 'Trois.', 'Quatre.']);
  // Nombre décimal et extension : jamais une fin de phrase ; rien n'est perdu.
  assert.deepEqual(phrasesLisibles('Recul 1.5 m (fichier reglement.pdf). Suite.'), ['Recul 1.5 m (fichier reglement.pdf).', 'Suite.']);
});

test('lot A : rapport déjà construit avec la coupure « (art.\\n\\nUC 6-1) » → recollé à l’écran, texte strictement identique', () => {
  // Paragraphes tels qu'affichés par le rapport du 05/11/2026.
  const stockes = [
    '… hauteur acrotère 28 m (secteur 1, art. UC 10), recul voie 0 ou 4 m au choix du constructeur (art.',
    'UC 6-1), reculs latéraux … (art.',
    'UC 13-1)',
  ];
  const blocs = regrouperParagraphes(stockes);
  assert.deepEqual(blocs, [SYNTHESE_AE0414]);
  assert.ok(blocs.every(sansCoupure));
  // Rendu : un seul paragraphe, aucun saut à l'intérieur de « (art. UC 6-1) ».
  const html = htmlLisible(blocs[0], markdownToSafeHtml);
  assert.equal((html.match(/<p /g) ?? []).length, 1);
  assert.match(html, /\(art\. UC 6-1\)/);
  // Les vrais paragraphes et les listes ne sont pas recollés.
  assert.deepEqual(recollerCoupures(['Une phrase (art. UC 9).', 'Autre paragraphe.']), ['Une phrase (art. UC 9).', 'Autre paragraphe.']);
  assert.deepEqual(recollerCoupures(['Liste (voir :', '- point']), ['Liste (voir :', '- point']);
});

test('lot A : synthèse réelle passée par construireModeleRapport → blocs sans coupure, mots identiques', () => {
  const texte = `${SYNTHESE_AE0414}. Programme de 40 logements à confirmer. Plan : à choisir. Contrôle à faire.`;
  const m = construireModeleRapport(
    { id: 'm3', objectif: 'Conception', type: 'conception', cree_le: null, termine_le: null, jetons_consommes: 0 } as never,
    { version: 2, titre: 'AE0414', synthese: texte },
  )!;
  const blocs = regrouperParagraphes(m.synthese);
  assert.ok(blocs.every(sansCoupure), JSON.stringify(blocs));
  assert.equal(blocs.join(' '), texte, 'sortie strictement identique hormis les sauts de paragraphe');
  // Correctif décrit pour rapportModele.paragrapher (hors périmètre du lot) : phrasesLisibles groupées par 3.
  const phrases = phrasesLisibles(texte);
  const paragraphes: string[] = [];
  for (let i = 0; i < phrases.length; i += 3) paragraphes.push(phrases.slice(i, i + 3).join(' '));
  assert.deepEqual(paragraphes, [`${SYNTHESE_AE0414}. Programme de 40 logements à confirmer. Plan : à choisir.`, 'Contrôle à faire.']);
  // Correctif appliqué dans rapportModele.paragrapher (consolidation A + E0 + E1) : plus aucune coupure après « (art. ».
  assert.ok(!m.synthese.some((p) => /\(art\.$/.test(p)), JSON.stringify(m.synthese));
});
