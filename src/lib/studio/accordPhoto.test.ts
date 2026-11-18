// FINITIONS 18/11 — carte d'accord sur l'usage de la photo jointe.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dernierAppelPhotoProjet, lireDemandeAccordPhoto } from './accordPhoto.ts';

const demande = { titre: 'Utiliser cette photo pour l’image ?', texte: 'Les visages et les plaques ne sont pas floutés.', choix: ['Oui, utiliser ma photo pour l’image', 'Non, ne pas utiliser ma photo'] };

test('FIN-A1 demande lue telle quelle ; absente ou mal formée : rien', () => {
  const d = lireDemandeAccordPhoto({ status: 'ok', data: { accord_photo_requis: demande } })!;
  assert.equal(d.oui, demande.choix[0]); assert.equal(d.non, demande.choix[1]);
  assert.match(d.texte, /plaques/);
  assert.equal(lireDemandeAccordPhoto({ status: 'ok', data: {} }), null);
  assert.equal(lireDemandeAccordPhoto({ status: 'ok', data: { accord_photo_requis: { titre: 'x', texte: 'y', choix: ['a'] } } }), null);
  assert.equal(lireDemandeAccordPhoto({ status: 'error', data: { accord_photo_requis: demande } }), null);
});

test('FIN-A2 seule la dernière sortie de parcours portant la photo affiche la carte', () => {
  const messages = [
    { toolCalls: [{ id: 'a', name: 'extension_maison', output: { status: 'ok', data: { photo_projet: {}, accord_photo_requis: demande } } }] },
    { toolCalls: [{ id: 'b', name: 'studio_lancer_rendu', output: { status: 'ok', data: {} } }] },
    { toolCalls: [{ id: 'c', name: 'extension_maison', output: { status: 'ok', data: { photo_projet: {} } } }] },
  ];
  assert.equal(dernierAppelPhotoProjet(messages), 'c');
  assert.equal(dernierAppelPhotoProjet([messages[0]!]), 'a');
  assert.equal(dernierAppelPhotoProjet([]), null);
});
