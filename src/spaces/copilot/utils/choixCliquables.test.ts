// LOT CHOIX-CLIQUABLES — réponses cliquables aux questions à choix de Mimmo (logique pure).
// Texte de référence : la question d'habillage de la capture du 06/11/2026, convertie en bloc.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  basculerAToi, basculerOption, composerReponse, etatVide, fusionnerSaisie, lireBlocChoix,
  reponsesDepuisTexte, sansBlocsChoix, situationChoix, validerBlocChoix, CHOIX_OPTIONS_MAX, CHOIX_QUESTIONS_MAX,
  type BlocChoix,
} from './choixCliquables.ts';
import { markdownToSafeHtml } from './exportCopilotPdf.ts';
import { parseReportText } from '../exports/responseExportModel.ts';

const HABILLAGE = {
  v: 1,
  questions: [
    { id: 'facade', libelle: 'Façade', options: ['Enduit clair', 'Enduit blanc', 'Brique', 'Pierre', 'Béton', 'Bardage bois', 'Verre'], defaut: 'Enduit clair' },
    { id: 'balcons', libelle: 'Balcons', options: ['Balcons', 'Balcons filants', 'Loggias', 'Aucun'], defaut: 'Balcons' },
    { id: 'rdc', libelle: 'RDC', options: ['Logements', 'Commerces', 'Hall'], defaut: 'Logements' },
    { id: 'ambiance', libelle: 'Ambiance', options: ['Jour', 'Fin de journée', 'Nuit'], defaut: 'Jour' },
    { id: 'attique', libelle: 'Attique', options: ['Oui', 'Non'], defaut: 'Non' },
  ],
  libre: true,
  a_toi_de_choisir: true,
};
const TEXTE = [
  'Pour le rendu, quelques choix d’habillage :',
  '',
  '- **Façade** : enduit clair, enduit blanc, brique, pierre, béton, bardage bois ou verre ?',
  '- **Balcons** : balcons, balcons filants, loggias ou aucun ?',
  '- **RDC** : logements, commerces ou hall ?',
  '- **Ambiance** : jour, fin de journée ou nuit ?',
  '- **Attique** : oui ou non ?',
  '',
  'Dites-moi vos préférences — ou « à toi de choisir ».',
  '',
  '```mimmoza-choix',
  JSON.stringify(HABILLAGE),
  '```',
].join('\n');

const bloc = (): BlocChoix => {
  const b = lireBlocChoix(TEXTE).bloc;
  assert.ok(b);
  return b;
};

test('lecture : bloc de la question d’habillage du 06/11 → 5 questions, texte visible sans le bloc', () => {
  const { visible, bloc: b } = lireBlocChoix(TEXTE);
  assert.ok(b);
  assert.equal(b.questions.length, 5);
  assert.deepEqual(b.questions.map((q) => q.id), ['facade', 'balcons', 'rdc', 'ambiance', 'attique']);
  assert.deepEqual(b.questions[0].defaut, ['Enduit clair']);
  assert.equal(b.questions[0].multiple, false);
  assert.equal(b.libre, true);
  assert.equal(b.aToiDeChoisir, true);
  assert.doesNotMatch(visible, /mimmoza-choix|"questions"/);
  assert.match(visible, /Dites-moi vos préférences/);
});

test('lecture : texte sans bloc inchangé ; CRLF accepté ; dernier bloc valide retenu', () => {
  assert.deepEqual(lireBlocChoix('Bonjour'), { visible: 'Bonjour', bloc: null });
  const crlf = 'Question ?\r\n```mimmoza-choix\r\n{"questions":[{"libelle":"Choix","options":["A","B"]}]}\r\n```';
  const r = lireBlocChoix(crlf);
  assert.equal(r.bloc?.questions[0].id, 'q1');
  assert.equal(r.visible, 'Question ?');
  const deux = '```mimmoza-choix\n{"questions":[{"libelle":"Un","options":["A","B"]}]}\n```\ntexte\n```mimmoza-choix\n{"questions":[{"libelle":"Deux","options":["C","D"]}]}\n```';
  assert.equal(lireBlocChoix(deux).bloc?.questions[0].libelle, 'Deux');
  assert.equal(lireBlocChoix(deux).visible, 'texte');
});

test('tolérance : bloc invalide ignoré, le texte reste ; bloc inachevé (streaming) masqué', () => {
  const invalide = 'Texte lisible.\n```mimmoza-choix\n{"questions": [ oups\n```';
  assert.deepEqual(lireBlocChoix(invalide), { visible: 'Texte lisible.', bloc: null });
  const ouvert = 'Texte en cours\n```mimmoza-choix\n{"questions":[{"libelle":"Fa';
  assert.deepEqual(lireBlocChoix(ouvert), { visible: 'Texte en cours', bloc: null });
  assert.equal(sansBlocsChoix(TEXTE).includes('```'), false);
});

test('validation bornée : questions, options, longueurs, doublons, version', () => {
  const q = (o: Record<string, unknown> = {}) => ({ libelle: 'Façade', options: ['A', 'B'], ...o });
  assert.ok(validerBlocChoix({ questions: [q()] }));
  assert.equal(validerBlocChoix({ questions: [] }), null);
  assert.equal(validerBlocChoix({ questions: Array.from({ length: CHOIX_QUESTIONS_MAX + 1 }, (_, i) => q({ libelle: `Q${i}` })) }), null);
  assert.ok(validerBlocChoix({ questions: Array.from({ length: CHOIX_QUESTIONS_MAX }, (_, i) => q({ libelle: `Q${i}` })) }));
  assert.equal(validerBlocChoix({ questions: [q({ options: ['A'] })] }), null, 'une seule option');
  assert.equal(validerBlocChoix({ questions: [q({ options: Array.from({ length: CHOIX_OPTIONS_MAX + 1 }, (_, i) => `O${i}`) })] }), null);
  assert.equal(validerBlocChoix({ questions: [q({ options: ['A', 'x'.repeat(61)] })] }), null, 'option > 60 caractères');
  assert.ok(validerBlocChoix({ questions: [q({ options: ['A', 'x'.repeat(60)] })] }));
  assert.equal(validerBlocChoix({ questions: [q({ options: ['Brique', 'brique'] })] }), null, 'options en double');
  assert.equal(validerBlocChoix({ questions: [q({ options: ['A · B', 'C'] })] }), null, 'séparateur réservé');
  assert.equal(validerBlocChoix({ questions: [q(), q()] }), null, 'libellés en double');
  assert.equal(validerBlocChoix({ questions: [q({ id: 'a b' })] }), null, 'id invalide');
  assert.equal(validerBlocChoix({ questions: [q({ id: 'x' }), q({ id: 'x', libelle: 'Autre' })] }), null, 'ids en double');
  assert.equal(validerBlocChoix({ questions: [q({ libelle: '' })] }), null);
  assert.equal(validerBlocChoix({ questions: [q({ libelle: 'x'.repeat(61) })] }), null);
  assert.equal(validerBlocChoix({ v: 2, questions: [q()] }), null, 'version inconnue');
  assert.equal(validerBlocChoix([q()]), null);
  // Champs facultatifs invalides : valeur par défaut, le bloc reste.
  const b = validerBlocChoix({ questions: [q({ defaut: 'Z', multiple: 'oui' })], libre: 'non', a_toi_de_choisir: 1 });
  assert.deepEqual(b, { questions: [{ id: 'q1', libelle: 'Façade', options: ['A', 'B'], multiple: false, defaut: [] }], libre: true, aToiDeChoisir: false });
  assert.deepEqual(validerBlocChoix({ questions: [q({ multiple: true, defaut: ['b', 'A'] })] })?.questions[0].defaut, ['A', 'B']);
  assert.deepEqual(validerBlocChoix({ questions: [q({ defaut: ['A', 'B'] })] })?.questions[0].defaut, ['A'], 'choix unique : une suggestion');
});

test('sélection : choix unique (remplace, re-clic désélectionne) et multiple (bascule, ordre du bloc)', () => {
  const b = validerBlocChoix({ questions: [
    { id: 'facade', libelle: 'Façade', options: ['Enduit clair', 'Brique', 'Pierre'] },
    { id: 'usages', libelle: 'Usages du RDC', options: ['Commerces', 'Hall', 'Logements'], multiple: true },
  ] })!;
  let e = etatVide();
  e = basculerOption(e, b, 'facade', 'Brique');
  e = basculerOption(e, b, 'facade', 'Pierre');
  assert.deepEqual(e.selections.facade, ['Pierre']);
  e = basculerOption(e, b, 'facade', 'Pierre');
  assert.equal(e.selections.facade, undefined);
  e = basculerOption(e, b, 'usages', 'Logements');
  e = basculerOption(e, b, 'usages', 'Commerces');
  assert.deepEqual(e.selections.usages, ['Commerces', 'Logements']);
  e = basculerOption(e, b, 'usages', 'Logements');
  assert.deepEqual(e.selections.usages, ['Commerces']);
  assert.equal(basculerOption(e, b, 'inconnue', 'X'), e);
  assert.equal(basculerOption(e, b, 'facade', 'Granit'), e);
});

test('composition : ligne lisible dans l’ordre des questions ; « À toi de choisir »', () => {
  const b = bloc();
  let e = etatVide();
  assert.equal(composerReponse(b, e), '');
  e = basculerOption(e, b, 'balcons', 'Loggias');
  e = basculerOption(e, b, 'facade', 'Brique');
  assert.equal(composerReponse(b, e), 'Façade : Brique · Balcons : Loggias');
  e = basculerAToi(e);
  assert.equal(composerReponse(b, e), 'Façade : Brique · Balcons : Loggias · Pour le reste : à toi de choisir');
  assert.equal(composerReponse(b, basculerAToi(etatVide())), 'À toi de choisir.');
  for (const [id, o] of [['rdc', 'Commerces'], ['ambiance', 'Nuit'], ['attique', 'Oui']] as const) e = basculerOption(e, b, id, o);
  assert.equal(composerReponse(b, e), 'Façade : Brique · Balcons : Loggias · RDC : Commerces · Ambiance : Nuit · Attique : Oui', 'tout choisi : pas de « pour le reste »');
});

test('champ de saisie : la ligne remplace la précédente, les détails tapés sont conservés', () => {
  assert.equal(fusionnerSaisie('', '', 'Façade : Brique'), 'Façade : Brique');
  assert.equal(fusionnerSaisie('Façade : Brique', 'Façade : Brique', 'Façade : Pierre'), 'Façade : Pierre');
  assert.equal(fusionnerSaisie('Façade : Brique\nbrique rouge svp', 'Façade : Brique', 'Façade : Brique · Attique : Oui'), 'Façade : Brique · Attique : Oui\nbrique rouge svp');
  assert.equal(fusionnerSaisie('Je préfère du clair', '', 'Façade : Enduit clair'), 'Façade : Enduit clair\nJe préfère du clair', 'texte tapé avant le premier clic : gardé, après la ligne');
  assert.equal(fusionnerSaisie('Façade : Brique\nbrique rouge', 'Façade : Brique', ''), 'brique rouge', 'tout désélectionné : la ligne s’efface');
  assert.equal(fusionnerSaisie('Façade : Brique', 'Façade : Brique', ''), '');
  assert.equal(fusionnerSaisie('ligne modifiée à la main', 'Façade : Brique', 'Façade : Pierre'), 'Façade : Pierre\nligne modifiée à la main');
  assert.equal(fusionnerSaisie('rien', '', ''), 'rien');
});

test('réponse figée : retrouvée depuis le message envoyé (ligne composée + détails, accents, casse)', () => {
  const b = bloc();
  let e = etatVide();
  for (const [id, o] of [['facade', 'Brique'], ['balcons', 'Balcons filants'], ['ambiance', 'Fin de journée']] as const) e = basculerOption(e, b, id, o);
  e = basculerAToi(e);
  const envoye = `${composerReponse(b, e)}\nbrique rouge orangé, pas trop sombre`;
  const r = reponsesDepuisTexte(b, envoye);
  assert.deepEqual(r.selections, { facade: ['Brique'], balcons: ['Balcons filants'], ambiance: ['Fin de journée'] });
  assert.equal(r.aToi, true);
  assert.deepEqual(reponsesDepuisTexte(b, 'facade : PIERRE\nAttique : non').selections, { facade: ['Pierre'], attique: ['Non'] });
  assert.deepEqual(reponsesDepuisTexte(b, 'Balcons : balcons').selections, { balcons: ['Balcons'] }, '« Balcons » seul ne vaut pas « Balcons filants »');
  assert.deepEqual(reponsesDepuisTexte(b, 'je ne sais pas encore'), { selections: {}, aToi: false });
  assert.deepEqual(reponsesDepuisTexte(b, ''), { selections: {}, aToi: false });
});

test('situation : actives seulement sur le dernier message (Mimmo, complet) ; réponse suivante retrouvée', () => {
  const fil = [
    { id: 'u1', role: 'user', text: 'Prépare la 3D et un film' },
    { id: 'a1', role: 'assistant', text: TEXTE, status: 'complete' },
  ];
  assert.deepEqual(situationChoix(fil, 'a1'), { actif: true, reponse: null });
  assert.deepEqual(situationChoix([...fil.slice(0, 1), { ...fil[1], status: 'streaming' }], 'a1'), { actif: false, reponse: null });
  const suite = [...fil, { id: 'u2', role: 'user', text: 'Façade : Brique' }, { id: 'a2', role: 'assistant', text: 'ok', status: 'complete' }];
  assert.deepEqual(situationChoix(suite, 'a1'), { actif: false, reponse: 'Façade : Brique' });
  assert.deepEqual(situationChoix(suite, 'absent'), { actif: false, reponse: null });
});

test('exports : ni le PDF ni Word/Excel/PowerPoint n’impriment le bloc brut', () => {
  const html = markdownToSafeHtml(TEXTE);
  assert.doesNotMatch(html, /mimmoza-choix|&quot;questions&quot;|"questions"/);
  assert.match(html, /Dites-moi vos préférences/);
  const blocs = parseReportText(TEXTE);
  assert.ok(blocs.length > 0);
  assert.ok(blocs.every((x) => !('text' in x) || !/mimmoza-choix|"questions"/.test(x.text)));
});
