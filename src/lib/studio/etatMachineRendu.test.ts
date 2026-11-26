// npx tsx --test src/lib/studio/etatMachineRendu.test.ts
// VIS-60 — « Machine de rendu hors ligne depuis … » : durée JUSTE (horloge du serveur), client prévenu, aucun débit.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dureeLisible, heureParisCourte, PHRASE_AUCUN_DEBIT, SEUIL_HORS_LIGNE_MS, vueMachineRendu } from './etatMachineRendu.ts';

const T0 = Date.parse('2026-11-26T21:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

describe('VIS-60 — durée lisible', () => {
  it('arrondie vers le bas, jamais plus que le réel', () => {
    assert.equal(dureeLisible(59_999), 'moins d’une minute');
    assert.equal(dureeLisible(7 * 60_000 + 59_000), '7 min');
    assert.equal(dureeLisible(2 * 3_600_000 + 5 * 60_000 + 59_000), '2 h 05');
    assert.equal(dureeLisible(3 * 3_600_000), '3 h');
    assert.equal(dureeLisible(3 * 86_400_000 + 4 * 3_600_000 + 50 * 60_000), '3 jours 4 h');
  });
  it('heure de Paris', () => assert.equal(heureParisCourte('2026-11-26T21:23:00Z'), '26/11 à 22 h 23'));
});

describe('VIS-60 — avec signal de vie', () => {
  const film = { type: 'film', statut: 'en_attente', cree_le: iso(T0 - 30 * 60_000) };
  it('hors ligne : durée depuis le DERNIER SIGNAL, sur l’horloge du serveur (pas celle du PC du client)', () => {
    const v = vueMachineRendu({
      signal: { vu_le: iso(T0 - (2 * 3_600_000 + 15 * 60_000)), etat: 'pret', maintenant: iso(T0) },
      file: [film], maintenant: T0 + 47 * 60_000, // horloge du client en avance de 47 min : ignorée
    });
    assert.equal(v.etat, 'hors_ligne');
    assert.equal(v.certain, true);
    assert.equal(v.titre, 'Machine de rendu hors ligne depuis 2 h 15 (dernier signal le 26/11 à 19 h 45).');
    assert.equal(v.messageClient, `Votre film attend la machine de rendu, hors ligne depuis 2 h 15. Il démarrera automatiquement dès son retour, sans rien relancer. ${PHRASE_AUCUN_DEBIT}`);
  });
  it('3 signaux manqués = hors ligne ; 2 = encore en ligne', () => {
    const a = vueMachineRendu({ signal: { vu_le: iso(T0 - SEUIL_HORS_LIGNE_MS + 1000), etat: 'pret', maintenant: iso(T0) }, file: [], maintenant: T0 });
    assert.equal(a.etat, 'en_ligne');
    const b = vueMachineRendu({ signal: { vu_le: iso(T0 - SEUIL_HORS_LIGNE_MS - 1000), etat: 'pret', maintenant: iso(T0) }, file: [], maintenant: T0 });
    assert.equal(b.etat, 'hors_ligne');
    assert.equal(b.messageClient, null);
  });
  it('allumée mais Unreal introuvable : « indisponible », le client est prévenu', () => {
    const v = vueMachineRendu({ signal: { vu_le: iso(T0 - 20_000), etat: 'degrade', diagnostic: { unreal: false }, maintenant: iso(T0) }, file: [film], maintenant: T0 });
    assert.equal(v.etat, 'degradee');
    assert.match(v.titre, /moteur 3D introuvable/);
    assert.match(v.messageClient ?? '', /Rien n’est débité/);
  });
  it('occupée : le travail attend son tour', () => {
    const v = vueMachineRendu({ signal: { vu_le: iso(T0 - 20_000), etat: 'occupe', maintenant: iso(T0) }, file: [film], maintenant: T0 });
    assert.equal(v.etat, 'occupee');
    assert.match(v.messageClient ?? '', /après le rendu en cours/);
  });
});

describe('VIS-60 — sans signal de vie (migration non appliquée) : déduction, jamais affirmation', () => {
  it('aucune activité récente : « non confirmé », durée d’attente du client exacte', () => {
    const v = vueMachineRendu({ signal: null, file: [{ type: 'film', statut: 'en_attente', cree_le: iso(T0 - 50 * 60_000) }], derniereActiviteFile: iso(T0 - 5 * 3_600_000), maintenant: T0 });
    assert.equal(v.etat, 'inconnue');
    assert.equal(v.certain, false);
    assert.match(v.titre, /non confirmé \(dernière activité connue il y a 5 h\)/);
    assert.match(v.messageClient ?? '', /^Votre film attend depuis 50 min/);
    assert.doesNotMatch(v.titre, /hors ligne/);
  });
});
