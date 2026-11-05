// supabase/functions/_shared/texte/miseEnForme.test.ts — LOT F1 (lisibilité).
// Logique pure, sans réseau. Le fichier tourne sous les DEUX lanceurs :
//   deno test supabase/functions/_shared/texte/miseEnForme.test.ts
//   node --experimental-strip-types --test supabase/functions/_shared/texte/miseEnForme.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { mettreEnForme } from './miseEnForme.ts';

/** Mots du texte, sans marqueurs de liste ni séparateurs (« ; », « , », « et », « ou »). */
function mots(t: string): string[] {
  return t
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:-\s|\d{1,2}\.\s)/, ''))
    .join(' ')
    .replace(/(?<=^|\s)(?:\(\d{1,2}\)|\d{1,2}[.)])(?=\s)/g, ' ')
    .replace(/[;,]/g, ' ')
    .split(/\s+/)
    .filter((m) => m && !/^(?:et|ou)$/i.test(m));
}

const EXEMPLE_REEL =
  "Conception complète d'un programme de 40 logements collectifs sur la parcelle 92064000AB0123 (Saint-Cloud, zone UC). " +
  'La mission doit : (1) vérifier le gabarit de rue UC 10-1 (largeur de voie, prospect H ≤ L + 4 m) ; ' +
  "(2) appliquer les hauteurs du secteur graphique n° 1 (R+4, 15 m à l'égout) ; " +
  '(3) calculer les reculs obligatoires (art. UC 6 et UC 7, p. 109) ; (4) vérifier l\'emprise au sol maximale de 50 % ; ' +
  '(5) respecter 30 % de pleine terre ; (6) dimensionner le stationnement (1,2 place par logement) ; ' +
  '(7) appliquer la servitude de mixité sociale de 30 % ; (8) contrôler la conformité des destinations ; ' +
  '(9) estimer la SDP et la SHAB ; (10) produire un programme typologique ; (11) chiffrer le coût travaux au 09/12/2025 ; ' +
  'et (12) vérifier la compatibilité du programme avec la charge foncière de 3 821 404 €. Le rapport sera remis sous 48 h.';

const PLAN = 'Plan : 1. **Récupérer la parcelle** et son contour 2. **Lire le règlement** de la zone UC 3. **Calculer** les règles 4. **Rédiger** le rapport';

const QUESTION =
  'Le chapitre de la zone UC couvre les pages 102 à 118. Lequel faut-il lire (pages 102 à 111) ? Articles repérés : ' +
  'ARTICLE UC 1 – Occupations interdites (p. 102) ; ARTICLE UC 2 – Occupations soumises à conditions (p. 103) ; ' +
  'ARTICLE UC 9 – Emprise au sol (p. 109) ; ARTICLE UC 10 – Hauteur (p. 110).';

const BIEN_FORME = [
  '## Ce qu\'il faut retenir',
  'La parcelle est constructible en zone UC, sous réserve de la hauteur (art. UC 10, p. 110).',
  '',
  '- Surface : 1 250 m² ; emprise 50 %',
  '- Charge foncière : 3 821 404 € (au 09/12/2025)',
  '',
  '1. Vérifier le gabarit',
  '2. Lire le règlement',
  '',
  '| Source | Valeur |',
  '| --- | --- |',
  '| DVF | 5 000 €/m² ; 120 ventes ; médiane |',
  '',
  '> Avertissement : (1) donnée communale ; (2) à vérifier',
  '',
  '**1. Signal d\'inondation à lever en priorité.** Un signal communal est relevé ; il faut le lever.',
  '',
  '```ts',
  'const plan = "(1) a ; (2) b ; (3) c";',
  '```',
  'À faire valider par un professionnel.',
].join('\n');

test('exemple réel : objectif de mission (1) … (12) → une ligne par point, numéros conservés', () => {
  const r = mettreEnForme(EXEMPLE_REEL);
  const lignes = r.split('\n');
  assert.equal(lignes[0], "Conception complète d'un programme de 40 logements collectifs sur la parcelle 92064000AB0123 (Saint-Cloud, zone UC). La mission doit :");
  assert.equal(lignes[1], '1. vérifier le gabarit de rue UC 10-1 (largeur de voie, prospect H ≤ L + 4 m)');
  assert.equal(lignes[3], '3. calculer les reculs obligatoires (art. UC 6 et UC 7, p. 109)');
  assert.equal(lignes[11], '11. chiffrer le coût travaux au 09/12/2025');
  assert.equal(lignes[12], '12. vérifier la compatibilité du programme avec la charge foncière de 3 821 404 €.');
  assert.equal(lignes[13], 'Le rapport sera remis sous 48 h.');
  assert.equal(lignes.length, 14);
  assert.deepEqual(mots(r), mots(EXEMPLE_REEL));
});

test('plan du journal « 1. **…** 2. **…** » en un seul paragraphe → liste numérotée', () => {
  assert.equal(mettreEnForme(PLAN), [
    'Plan :', '1. **Récupérer la parcelle** et son contour', '2. **Lire le règlement** de la zone UC',
    '3. **Calculer** les règles', '4. **Rédiger** le rapport',
  ].join('\n'));
});

test('question de mission « Articles repérés : A ; B ; C » → liste à tirets, pages intactes', () => {
  assert.equal(mettreEnForme(QUESTION), [
    'Le chapitre de la zone UC couvre les pages 102 à 118. Lequel faut-il lire (pages 102 à 111) ? Articles repérés :',
    '- ARTICLE UC 1 – Occupations interdites (p. 102)',
    '- ARTICLE UC 2 – Occupations soumises à conditions (p. 103)',
    '- ARTICLE UC 9 – Emprise au sol (p. 109)',
    '- ARTICLE UC 10 – Hauteur (p. 110).',
  ].join('\n'));
});

test('style « 1) … 2) … 3) »', () => {
  assert.equal(mettreEnForme('Trois points : 1) le zonage 2) les risques 3) le marché.'),
    'Trois points :\n1. le zonage\n2. les risques\n3. le marché.');
});

test('ligne qui commence par « 1. » et enchaîne « 2. », « 3. »', () => {
  assert.equal(mettreEnForme('1. Cadrer la demande. 2. Rechercher les parcelles. 3. Rédiger.'),
    '1. Cadrer la demande.\n2. Rechercher les parcelles.\n3. Rédiger.');
});

test('identité : un texte déjà bien formé (titres, listes, tableau, citation, format imposé, code) est inchangé', () => {
  assert.equal(mettreEnForme(BIEN_FORME), BIEN_FORME);
});

test('non-casse : nombres décimaux et heures', () => {
  const t = 'Hauteur 12,5 m, coefficient 0.35 et 1.2 ; ouverture à 10:30 ; taux 3.5 %.';
  assert.equal(mettreEnForme(t), t);
});

test('non-casse : dates (09/12/2025) et articles (« UC 10-1 », « art. UC 9 »)', () => {
  const t = "Arrêté du 09/12/2025 : l'art. UC 9 et la règle UC 10-1 s'appliquent ; voir aussi l'art. 2. Le recul est de 4 m.";
  assert.equal(mettreEnForme(t), t);
});

test('non-casse : « article 1. Le … article 2. La … » n\'est pas une liste', () => {
  const t = "Selon l'article 1. Le règlement précise à l'article 2. La hauteur est de 12,5 m. Niveau 3. Fin.";
  assert.equal(mettreEnForme(t), t);
});

test('non-casse : pages « (p. 1) ; (p. 2) » dans une liste à points-virgules', () => {
  const t = 'Pièces du dossier à relire en priorité : règlement écrit de la zone (p. 1) ; plan de zonage du secteur (p. 2) ; annexes sanitaires (p. 3)';
  assert.equal(mettreEnForme(t), [
    'Pièces du dossier à relire en priorité :',
    '- règlement écrit de la zone (p. 1)', '- plan de zonage du secteur (p. 2)', '- annexes sanitaires (p. 3)',
  ].join('\n'));
});

test('non-casse : montants (« 3 821 404 € ») dans une énumération', () => {
  const r = mettreEnForme('Bilan : (1) CA de 12 450 000 € HT ; (2) charge foncière de 3 821 404 € ; (3) marge de 8,5 %.');
  assert.equal(r, 'Bilan :\n1. CA de 12 450 000 € HT\n2. charge foncière de 3 821 404 €\n3. marge de 8,5 %.');
});

test('code : blocs ``` et `code` en ligne jamais découpés', () => {
  const t = 'Exemple `1. a 2. b 3. c` à recopier.\n```\nLa mission doit : (1) a ; (2) b\n```';
  assert.equal(mettreEnForme(t), t);
  const u = 'Appeler : (1) `get_zonage_plu(1. x 2. y)` ; (2) `rechercher_parcelles`';
  assert.equal(mettreEnForme(u), 'Appeler :\n1. `get_zonage_plu(1. x 2. y)`\n2. `rechercher_parcelles`');
});

test('liste courte « A ; B ; C » laissée en ligne', () => {
  const t = 'Prix : 5 000 €/m² ; 120 ventes ; DVF.';
  assert.equal(mettreEnForme(t), t);
});

test('un seul marqueur, ou une suite qui ne commence pas à 1 : inchangé', () => {
  for (const t of ['Voir la note (1) en bas de page.', 'Reprendre au point (2) puis (3) demain.', 'Le R+1. Ensuite le R+2.']) {
    assert.equal(mettreEnForme(t), t);
  }
});

test('URL et deux-points sans espace : inchangés', () => {
  const t = 'Source : https://www.geoportail-urbanisme.gouv.fr/a;b?x=1 ; consultée le 09/12/2025 ; page 3 du règlement de zone.';
  assert.equal(mettreEnForme(t), [
    'Source :', '- https://www.geoportail-urbanisme.gouv.fr/a;b?x=1', '- consultée le 09/12/2025', '- page 3 du règlement de zone.',
  ].join('\n'));
  const h = 'Réunion à 10:30 ; puis 11:00 ; puis 14:15 ; salle du conseil municipal de la commune, entrée principale.';
  assert.equal(mettreEnForme(h), h);
});

test('texte après la liste : renvoyé en paragraphe, mots identiques', () => {
  const t = 'Je propose : 1. **Cadrer** le programme 2. **Repérer** les parcelles 3. **Chiffrer** les finalistes. Ensuite, le rapport. Merci.';
  const r = mettreEnForme(t);
  assert.equal(r, 'Je propose :\n1. **Cadrer** le programme\n2. **Repérer** les parcelles\n3. **Chiffrer** les finalistes.\nEnsuite, le rapport. Merci.');
  assert.deepEqual(mots(r), mots(t));
});

test('fins de ligne CRLF conservées, lignes vides conservées', () => {
  const t = 'Titre\r\n\r\nLa mission doit : (1) lire ; (2) calculer ; (3) conclure.\r\nFin.';
  assert.equal(mettreEnForme(t), 'Titre\r\n\r\nLa mission doit :\r\n1. lire\r\n2. calculer\r\n3. conclure.\r\nFin.');
});

test('entrées vides ou non textuelles renvoyées telles quelles', () => {
  assert.equal(mettreEnForme(''), '');
  assert.equal(mettreEnForme(null as unknown as string), null);
  assert.equal(mettreEnForme('   '), '   ');
});

test('idempotence : mettreEnForme(mettreEnForme(x)) === mettreEnForme(x) sur tout le corpus', () => {
  const corpus = [
    EXEMPLE_REEL, PLAN, QUESTION, BIEN_FORME,
    'x (1) y 1. a 2. b (2) z',
    'Étapes : 1. lire (1) a (2) b 2. calculer 3. conclure',
    'Liste : a ; b (c ; d) ; e ; f ; g ; h ; i ; j ; k ; l ; m ; n ; o ; p ; q ; r ; s ; t ; u ; v ; w',
    'Points : (1) un ; (2) deux, (3) trois ; et (4) quatre. Puis : alpha ; bêta ; gamma ; delta ; epsilon ; zêta ; êta ; thêta.',
  ];
  for (const x of corpus) {
    const une = mettreEnForme(x);
    assert.equal(mettreEnForme(une), une, `non idempotent sur : ${x.slice(0, 60)}`);
    assert.deepEqual(mots(une), mots(x), `mots modifiés sur : ${x.slice(0, 60)}`);
  }
});

// Lot A (point 3) : phrase RÉELLE de la synthèse de conception du 05/11/2026 (AE0414) — aucune coupure
// après « art. » ni dans une parenthèse : mettreEnForme la renvoie STRICTEMENT identique.
test('lot A : synthèse « … (art. UC 6-1), reculs latéraux … (art. UC 13-1) » inchangée', () => {
  const s = '… hauteur acrotère 28 m (secteur 1, art. UC 10), recul voie 0 ou 4 m au choix du constructeur (art. UC 6-1), reculs latéraux … (art. UC 13-1)';
  assert.equal(mettreEnForme(s), s);
  assert.equal(mettreEnForme(`${s}. Suite à confirmer.`), `${s}. Suite à confirmer.`);
});
