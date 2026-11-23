// npx tsx --test src/lib/studio/descriptionBatiment.test.ts
// VIS-22 — contrat « description du bâtiment » : validation sans confiance, bornes, cohérences, traductions
// (forme / niveaux, brief d'habillage, clauses du Studio), bilan « reproduit / approché / pas encore », bloc du message.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bilanRendu, clausesCompletes, clausesHabillageAvecDescription, clausesStudio, commandeAvecDescription, DESCRIPTION_BLOC_LANGUE,
  descriptionDuMessage, messageReproduire, nonReproduits, phraseDescription, sansBlocDescription, validerDescription, versBrief, versForme,
  type DescriptionBatiment,
} from './descriptionBatiment.ts';

/** « une maison basque R+1 avec toit deux pans en tuiles, colombages rouges, balcon filant au 1er, garage accolé à gauche ». */
const MAISON_BASQUE = {
  origine: 'texte', type: 'maison', niveaux: 2, style: 'basque',
  toiture: { forme: 'deux_pans', couverture: 'tuiles' },
  facade: { materiau: 'enduit_blanc' },
  ouvertures: { type: 'fenetres_verticales', volets: 'battants', couleurVolets: 'rouge' },
  balcons: { type: 'balcons_filants', gardeCorps: 'plein' },
  elements: [{ type: 'colombages', couleur: 'rouge' }, { type: 'garage_accole', cote: 'gauche' }],
};
/** « un petit collectif R+2 en L, toiture-terrasse, loggias, bardage bois ». */
const COLLECTIF_L = {
  origine: 'texte', type: 'collectif', forme: 'l', niveaux: 3,
  toiture: { forme: 'terrasse' }, facade: { materiau: 'bardage_bois' }, balcons: { type: 'loggias' },
};

function ok(brut: unknown, strict = false): { valeur: DescriptionBatiment; corrections: string[] } {
  const v = validerDescription(brut, strict);
  assert.equal(v.ok, true, v.ok ? '' : v.erreur);
  if (!v.ok) throw new Error(v.erreur);
  return v;
}

test('validation : la maison basque de l’exemple est comprise sans correction', () => {
  const { valeur: d, corrections } = ok(MAISON_BASQUE);
  assert.deepEqual(corrections, []);
  assert.equal(d.v, 1);
  assert.equal(d.type, 'maison');
  assert.equal(d.niveaux, 2);
  assert.equal(d.style, 'basque');
  assert.deepEqual(d.toiture, { forme: 'deux_pans', couverture: 'tuiles' });
  assert.equal(d.facade.materiau, 'enduit_blanc');
  assert.equal(d.balcons.type, 'balcons_filants');
  assert.deepEqual(d.elements.map((e) => e.type), ['colombages', 'garage_accole']);
  assert.equal(d.elements[1].cote, 'gauche');
  assert.equal(d.forme, null, 'forme non dite : laissée au moteur');
});

test('validation : rien n’est deviné — valeurs hors liste écartées et DITES (proposition du modèle)', () => {
  const { valeur: d, corrections } = ok({
    type: 'chateau', forme: 'triangle', niveaux: 99, style: 'gothique', toiture: { forme: 'dome', couverture: 'chaume' },
    facade: { materiau: 'marbre', teinte: 'rose', couleur: 'rouge vif' }, elements: [{ type: 'donjon' }, { type: 'autre' }, { type: 'veranda', cote: 'dessus' }],
    champ_invente: 1, attique: 'oui',
  });
  assert.equal(d.type, 'collectif');
  assert.equal(d.forme, null);
  assert.equal(d.niveaux, 30, 'borné à 30 niveaux');
  assert.equal(d.style, 'contemporain');
  assert.deepEqual(d.toiture, { forme: 'terrasse', couverture: null });
  assert.equal(d.facade.materiau, 'enduit_clair');
  assert.equal(d.facade.couleur, null);
  assert.deepEqual(d.elements, [{ type: 'veranda', couleur: null, cote: null, precision: null }]);
  assert.ok(corrections.length >= 9, corrections.join(' | '));
  assert.ok(corrections.some((c) => c.includes('champ_invente')));
});

test('validation : cohérences rétablies et dites (attique / pente, teinte / matière, soubassement / commerces, couverture)', () => {
  const { valeur: d, corrections } = ok({
    toiture: { forme: 'quatre_pans' }, attique: true, facade: { materiau: 'pierre', teinte: 'foncee' }, rdc: 'commerces', soubassement: 'brique',
  });
  assert.equal(d.attique, false);
  assert.equal(d.toiture.couverture, 'tuiles');
  assert.equal(d.facade.teinte, 'naturelle');
  assert.equal(d.soubassement, 'aucun');
  assert.equal(corrections.length, 4, corrections.join(' | '));
  const plat = ok({ toiture: { forme: 'terrasse', couverture: 'zinc' } });
  assert.equal(plat.valeur.toiture.couverture, null);
});

test('validation : bornes des textes et de la liste d’éléments ; aucun accent grave de bloc ne passe', () => {
  const { valeur: d } = ok({
    remarques: 'x'.repeat(500), niveaux: 0,
    elements: Array.from({ length: 12 }, (_, i) => ({ type: 'autre', precision: `détail ${i} \`\`\`mimmoza-brief` })),
  });
  assert.equal(d.remarques?.length, 200);
  assert.equal(d.niveaux, 1);
  assert.equal(d.elements.length, 8);
  assert.ok(d.elements.every((e) => !e.precision?.includes('`') && (e.precision?.length ?? 0) <= 80));
});

test('validation stricte (bloc de la carte) : version exigée, toute valeur hors liste ou incohérence est refusée', () => {
  const { valeur } = ok(MAISON_BASQUE);
  assert.equal(validerDescription(valeur, true).ok, true, 'une description validée repasse en mode strict');
  assert.equal(validerDescription({ ...valeur, v: 2 }, true).ok, false);
  assert.equal(validerDescription({ ...valeur, v: undefined }, true).ok, false);
  assert.equal(validerDescription({ ...valeur, style: 'gothique' }, true).ok, false);
  assert.equal(validerDescription({ ...valeur, intrus: true }, true).ok, false);
  assert.equal(validerDescription({ ...valeur, attique: true }, true).ok, false, 'attique + toit en pente');
  assert.equal(validerDescription({ ...valeur, niveaux: 2.5 }, true).ok, false);
  assert.equal(validerDescription('texte', true).ok, false);
  assert.equal(validerDescription(null).ok, false);
});

test('forme et niveaux demandés au moteur', () => {
  assert.deepEqual(versForme(ok(COLLECTIF_L).valeur), { forme: 'l', niveaux: 3 });
  assert.deepEqual(versForme(ok(MAISON_BASQUE).valeur), { forme: null, niveaux: 2 });
});

test('brief d’habillage : champs du rendu, toiture la plus proche, précisions bornées à 100 caractères', () => {
  const b = versBrief(ok(MAISON_BASQUE).valeur);
  assert.deepEqual(b, {
    facade: 'enduit_blanc', ouvertures: 'fenetres_verticales', balcons: 'balcons_filants', attique: false, rdc: 'logements',
    toiture: 'deux_pans_tuiles', teinte: 'naturelle', garde_corps: 'plein', menuiseries: 'gris', soubassement: 'aucun',
    precisions: 'style basque ; volets battants rouge ; colombages rouge ; garage accolé à gauche',
  });
  assert.equal(versBrief(ok({ toiture: { forme: 'mansarde', couverture: 'zinc' } }).valeur).toiture, 'deux_pans_zinc');
  assert.equal(versBrief(ok({ forme: 'u', toiture: { forme: 'deux_pans', couverture: 'ardoise' } }).valeur).toiture, 'terrasse', 'bâtiment à ailes : pas de toit en pente');
  assert.equal(versBrief(ok(COLLECTIF_L).valeur).precisions, undefined);
  const long = versBrief(ok({ style: 'savoyard', elements: Array.from({ length: 8 }, (_, i) => ({ type: 'autre', precision: `élément remarquable numéro ${i}` })) }).valeur);
  assert.ok(String(long.precisions).length <= 100);
  assert.ok(!String(long.precisions).endsWith(';'));
});

test('clauses du Studio : toiture, style basque, colombages, volets ; rien d’inventé hors style', () => {
  assert.deepEqual(clausesStudio(ok(MAISON_BASQUE).valeur), { toiture: 'toiture à deux pans en tuiles', extras: ['de style basque', 'colombages rouges', 'volets rouges'] });
  assert.deepEqual(clausesStudio(ok({ toiture: { forme: 'quatre_pans', couverture: 'ardoise' }, ouvertures: { volets: 'battants' }, elements: [{ type: 'lucarnes' }] }).valeur),
    { toiture: 'toiture à quatre pans en ardoise', extras: [] }, 'sans style basque ou normand : ni volets ni lucarnes dans la commande');
  assert.deepEqual(clausesStudio(ok({ style: 'normand', toiture: { forme: 'deux_pans', couverture: 'ardoise' }, elements: [{ type: 'colombages', couleur: 'rouge' }, { type: 'lucarnes' }, { type: 'cheminee' }] }).valeur),
    { toiture: 'toiture à deux pans en ardoise', extras: ['de style normand', 'colombages', 'avec lucarnes', 'avec cheminée'] }, 'rouge n’existe pas en normand : teinte du style');
  assert.deepEqual(clausesStudio(ok(COLLECTIF_L).valeur), { toiture: null, extras: [] });
  assert.deepEqual(clausesStudio(ok({ forme: 'l', style: 'basque', toiture: { forme: 'deux_pans', couverture: 'tuiles' } }).valeur), { toiture: null, extras: [] }, 'bâtiment à ailes');
});

test('commande de création : ouverture du Studio (toutes les clauses) et rendu (toiture remplacée, style ajouté)', () => {
  const d = ok(MAISON_BASQUE).valeur;
  assert.equal(commandeAvecDescription('Crée un immeuble R+1 de 12 m sur 9 m.', d),
    'Crée un immeuble R+1 de 12 m sur 9 m, façade en enduit blanc, fenêtres verticales, avec balcons filants, toiture à deux pans en tuiles, de style basque, colombages rouges, volets rouges.');
  // Façade déjà écrite par le brief du projet (VIS-04) : gardée, jamais doublée ; toiture de la fiche remplacée.
  assert.equal(commandeAvecDescription('Crée un immeuble en pierre claire R+2 de 20 m sur 12 m, toiture-terrasse.', ok(COLLECTIF_L).valeur),
    'Crée un immeuble en pierre claire R+2 de 20 m sur 12 m, fenêtres verticales, avec loggias.');
  // Rendu : la commande porte déjà le brief ; « deux pans » remplacé par « quatre pans ».
  const quatre = ok({ toiture: { forme: 'quatre_pans', couverture: 'tuiles' }, facade: { materiau: 'brique' } }).valeur;
  assert.equal(commandeAvecDescription('Crée un immeuble R+2 de 20 m sur 12 m, façade en brique, fenêtres verticales, toiture à deux pans en tuiles.', quatre, true),
    'Crée un immeuble R+2 de 20 m sur 12 m, façade en brique, fenêtres verticales, toiture à quatre pans en tuiles.');
  assert.equal(commandeAvecDescription(null, d), null);
  assert.equal(commandeAvecDescription('Crée un immeuble R+1 de 12 m sur 9 m.', null), 'Crée un immeuble R+1 de 12 m sur 9 m.');
  const longue = `Crée un immeuble R+1 de 12 m sur 9 m${', clause'.repeat(140)}.`;
  assert.equal(commandeAvecDescription(longue, d), longue, 'au-delà de 1 000 caractères : commande rendue telle quelle');
  assert.ok(clausesCompletes(d).every((c) => /^[\p{L} '’-]+$/u.test(c)), 'clauses : lettres seulement (ni chiffre ni virgule)');
});

test('plusieurs bâtiments : seule la toiture est remplacée, six clauses au plus, jamais de style', () => {
  const d = ok({ style: 'basque', toiture: { forme: 'quatre_pans', couverture: 'ardoise' } }).valeur;
  const c = clausesHabillageAvecDescription(['façade en enduit', 'fenêtres verticales', 'toiture à deux pans en ardoise'], d);
  assert.deepEqual(c, ['façade en enduit', 'fenêtres verticales', 'toiture à quatre pans en ardoise']);
  assert.ok(c.every((x) => !/style|balcon|loggia/i.test(x)));
  assert.deepEqual(clausesHabillageAvecDescription(['façade en enduit'], null), ['façade en enduit']);
});

test('bilan honnête : ce qui est reproduit, approché, pas encore reproduit', () => {
  const b = bilanRendu(ok(MAISON_BASQUE).valeur);
  const etat = (champ: string, valeur?: string) => b.find((x) => x.champ === champ && (!valeur || x.valeur.startsWith(valeur)))?.etat;
  assert.equal(etat('style'), 'reproduit');
  assert.equal(etat('toiture'), 'reproduit');
  assert.equal(etat('volets'), 'reproduit');
  assert.equal(etat('elements', 'Colombages'), 'reproduit');
  assert.equal(etat('elements', 'Garage'), 'non_reproduit', 'le garage accolé n’est pas encore reproduit : dit');
  assert.deepEqual(nonReproduits(ok(MAISON_BASQUE).valeur), ['élément remarquable : garage accolé à gauche']);
  const autre = bilanRendu(ok({ style: 'haussmannien', facade: { materiau: 'pierre', couleur: '#D8CFC0' }, ouvertures: { volets: 'roulants' }, elements: [{ type: 'lucarnes' }], incertains: ['style', 'niveaux', 'inconnu'] }).valeur);
  assert.equal(autre.find((x) => x.champ === 'style')?.etat, 'non_reproduit');
  assert.equal(autre.find((x) => x.champ === 'style')?.aVerifier, true);
  assert.equal(autre.find((x) => x.champ === 'facade')?.etat, 'approche');
  assert.equal(autre.find((x) => x.champ === 'volets')?.etat, 'non_reproduit');
  assert.equal(autre.find((x) => x.champ === 'elements')?.etat, 'non_reproduit');
  const ailes = bilanRendu(ok({ forme: 'u', style: 'basque', toiture: { forme: 'deux_pans', couverture: 'tuiles' } }).valeur);
  assert.equal(ailes.find((x) => x.champ === 'toiture')?.etat, 'non_reproduit');
  assert.equal(ailes.find((x) => x.champ === 'style')?.etat, 'non_reproduit');
  assert.ok(b.every((x) => x.libelle && x.valeur && !/undefined|null/.test(`${x.valeur}${x.note ?? ''}`)));
});

test('phrase lisible de la description', () => {
  assert.equal(phraseDescription(ok(MAISON_BASQUE).valeur),
    'maison de style basque, R+1, toit à deux pans en tuiles, façade enduit blanc, fenêtres verticales, menuiseries alu gris, volets battants rouge, balcons filants (garde-corps pleins), colombages rouge, garage accolé à gauche');
  assert.equal(phraseDescription(ok(COLLECTIF_L).valeur),
    'immeuble de logements contemporain, R+2, en L, toit-terrasse, façade bardage bois, fenêtres verticales, menuiseries alu gris, loggias (garde-corps métal)');
});

test('message « Reproduire en 3D » : bloc de description relu en mode strict + bloc d’habillage sans type de rendu', () => {
  const d = ok({ ...MAISON_BASQUE, origine: 'photo' }).valeur;
  const m = messageReproduire(d);
  assert.ok(m.startsWith('Reproduis ce bâtiment en 3D : maison de style basque'));
  const relu = descriptionDuMessage(m);
  assert.ok(relu?.ok);
  assert.deepEqual(relu.ok ? relu.valeur : null, d);
  const brief = /```mimmoza-brief\n([\s\S]*?)\n```/.exec(m);
  assert.ok(brief);
  assert.deepEqual(JSON.parse(brief[1]), { v: 1, brief: versBrief(d) });
  const s = sansBlocDescription(m);
  assert.equal(s.description, true);
  assert.ok(!s.visible.includes(DESCRIPTION_BLOC_LANGUE));
  assert.equal(descriptionDuMessage('bonjour'), null);
  assert.deepEqual(sansBlocDescription('bonjour'), { visible: 'bonjour', description: false });
  assert.equal(descriptionDuMessage('```mimmoza-batiment\n{pas du json}\n```')?.ok, false);
  assert.equal(descriptionDuMessage('```mimmoza-batiment\n{"v":1,"style":"gothique"}\n```')?.ok, false);
});
