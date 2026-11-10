// deno test --no-check supabase/functions/copilot-chat/agent/garde-calcul.test.ts
import * as na from 'node:assert/strict';
import { avisCalculNonMoteur, calculParMoteur, CONSIGNE_PAS_DE_CALCUL, expressionsCalculees } from './garde-calcul.ts';
import { messageNumeroNonReconnu, numeroDemande, numeroNonReconnu } from './adresse-precision.ts';

Deno.test('cas réel du 10/11 : la SDP posée par le modèle est relevée', () => {
  const ligne = '| SDP brute indicative (563 × 5 × 0,85 coeff) | ~2 390 m² SDP |';
  na.deepEqual(expressionsCalculees(ligne), ['563 × 5 × 0,85']);
});

Deno.test('une multiplication suivie de son résultat est relevée, avec unités et gras', () => {
  na.deepEqual(expressionsCalculees('Emprise : **804 m² × 70 % = 563 m²**'), ['804 m² × 70 % = 563']);
  na.equal(expressionsCalculees('Coût : 2 100 €/m² × 2 390 m² soit ~5,0 M€').length, 1);
  na.equal(expressionsCalculees('12 x 4 x 3 niveaux').length, 1);
});

Deno.test('ne relève ni dimension, ni multiplicateur seul, ni date, ni règle lue', () => {
  for (const t of [
    'OAP thématique économie et commerce (× 2)',
    'Bâtiment de 12 × 18 m, R+5',
    'R+5 × emprise 80 %',
    'PPRMT approuvé le 22/04/2011',
    '0,59 place par logement créé',
    '57 924 demandes en attente / 787 attributions par an',
    'Emprise au sol ≤ 80 % dans la bande principale de 18 m',
    '',
  ]) na.deepEqual(expressionsCalculees(t), [], t);
});

Deno.test('plusieurs lignes : sans doublon, 5 au plus', () => {
  const t = Array.from({ length: 8 }, (_, i) => `${i + 2} × 3 × 4`).join('\n') + '\n2 × 3 × 4';
  na.equal(expressionsCalculees(t).length, 5);
  na.deepEqual(expressionsCalculees('a 2 × 3 × 4\nb 2 × 3 × 4'), ['2 × 3 × 4']);
});

Deno.test('calculParMoteur : seuls les outils de calcul lèvent la garde', () => {
  na.ok(calculParMoteur([{ name: 'get_zonage_plu' }, { name: 'calculer_bilan_financier' }]));
  na.ok(calculParMoteur([{ name: 'studio_preparer_3d' }]));
  na.ok(!calculParMoteur([{ name: 'get_couts_construction' }, { name: 'get_parcel_plu' }]));
  na.ok(!calculParMoteur([]));
});

Deno.test('avis et consigne : contenu attendu', () => {
  const avis = avisCalculNonMoteur(['563 × 5 × 0,85', 'a', 'b']);
  na.ok(avis.includes('« 563 × 5 × 0,85 », « a »') && !avis.includes('« b »'));
  na.ok(avis.includes("ne sort d'aucun moteur de calcul"));
  for (const mot of ['AUCUNE opération', 'surface de plancher', 'coût total', 'ratio', 'coefficient']) {
    na.ok(CONSIGNE_PAS_DE_CALCUL.includes(mot), mot);
  }
});

Deno.test('adresse : numéro demandé et précision de la BAN', () => {
  na.equal(numeroDemande('100 rue de Paris, 93100 Montreuil'), '100');
  na.equal(numeroDemande(' 12 bis avenue Foch'), '12 bis');
  na.equal(numeroDemande('3B chemin des Vignes'), '3 b');
  na.equal(numeroDemande('rue de Paris, Montreuil'), null);
  na.equal(numeroDemande('93100 Montreuil'), null);          // un code postal n'est pas un numéro de voirie
  na.ok(numeroNonReconnu('100 rue de Paris, 93100 Montreuil', 'street'));      // cas réel du 10/11
  na.ok(!numeroNonReconnu('98 rue de Paris, 93100 Montreuil', 'housenumber'));
  na.ok(!numeroNonReconnu('rue de Paris, Montreuil', 'street'));               // voie demandée, voie rendue
  const m = messageNumeroNonReconnu('100 rue de Paris, 93100 Montreuil', 'Rue de Paris 93100 Montreuil');
  na.ok(m.includes('Le numéro 100') && m.includes('Rue de Paris 93100 Montreuil') && m.includes('référence cadastrale'));
});
