// node --test src/spaces/copilot/agent/projet3DMission.test.ts
// LOT VIS-15 — parcours chat → projet en 3D : carte d'échec transitoire masquée, phrase claire sans conception,
// « Ouvrir mon projet en 3D » à la fin d'une mission de conception.
import test from 'node:test';
import assert from 'node:assert/strict';
import { devisAAfficher } from './agentLogique.ts';
import {
  ACTION_PREPARER_3D_CONCEPTION, corpsPreparation3D, lireIssuePreparation3D, missionConceptionOuvrable3D, phraseStudioSansConception,
  phraseSuiteConception, phraseUtilisateur,
} from './projet3DMission.ts';
import type { Mission } from './agent.types';

const A1 = '64065000AI0001', A2 = '64065000AI0002';
const ERREUR = { id: 'e', name: 'proposer_mission', status: 'error', output: { status: 'error', message: 'Conception : criteres.idu (identifiant cadastral à 14 caractères) est requis.' } };
const VALIDE = { id: 'v', name: 'proposer_mission', status: 'success', output: { status: 'ok', data: { mission_id: '344c865d', devis: { jetons_min: 51, jetons_max: 126 } } } };

test('VIS-15 point 1 : devis refusé puis reproposé dans le même tour → aucune carte rouge (pendant ET après)', () => {
  // Pendant le tour : l'échec n'est jamais montré, même seul (Mimmo va reproposer).
  assert.equal(devisAAfficher([ERREUR], true).get('e'), undefined);
  assert.equal(devisAAfficher([ERREUR, { id: 'r', name: 'proposer_mission', status: 'running' }], true).get('e'), undefined);
  // Reproposition en cours, réponse terminée (cas d'un tour interrompu) : pas d'échec affiché non plus.
  assert.equal(devisAAfficher([ERREUR, { id: 'r', name: 'proposer_mission', status: 'running' }], false).get('e'), undefined);
  // Proposition valide : seule la carte du devis.
  const r = devisAAfficher([ERREUR, VALIDE], false);
  assert.equal(r.get('e'), undefined);
  assert.equal(r.get('v')?.etat, 'carte');
  // Échec seul, réponse terminée : il reste dit.
  assert.equal(devisAAfficher([ERREUR], false).get('e')?.etat, 'erreur');
  assert.equal(devisAAfficher([ERREUR]).get('e')?.etat, 'erreur', 'défaut inchangé (rechargement d’une conversation)');
});

test('VIS-15 point 2 : studio_preparer_3d sans conception → phrase claire, jamais une carte vide', () => {
  const p = phraseStudioSansConception({ name: 'studio_preparer_3d', status: 'not_found', output: { status: 'not_found', message: 'PAS ENCORE DE CONCEPTION pour la parcelle X…' } });
  assert.match(String(p), /^Pas encore de 3D : ce projet n’a pas encore de conception enregistrée/);
  const partielle = phraseStudioSansConception({ name: 'studio_preparer_3d', status: 'partial', output: { status: 'partial', message: `AUCUNE 3D PRÉPARÉE : la conception enregistrée porte sur ${A1} (66 m²), pas sur l’assiette groupée ${A1} + ${A2} (manque ${A2}). Une 3D sur cette seule surface serait fausse. Dis-le en une phrase et propose…` } });
  assert.match(String(partielle), /^La conception enregistrée porte sur 64065000AI0001 \(66 m²\).*serait fausse\.$/);
  assert.equal(phraseStudioSansConception({ name: 'studio_preparer_3d', status: 'running' }), null);
  assert.equal(phraseStudioSansConception({ name: 'studio_preparer_3d', status: 'success', output: { status: 'ok' } }), null);
  assert.equal(phraseStudioSansConception({ name: 'get_zonage_plu', status: 'not_found' }), null);
});

const mission = (p: Partial<Mission>): Mission => ({
  id: '344c865d-0180-41d1-af19-d874e1ca9ccd', projet_id: null, conversation_id: '2631ee1e-e01a-451f-a181-ff94b2f6693b', origine: 'chat', type: 'conception',
  objectif: 'Concevoir un immeuble R+4', statut: 'terminee', devis: null, jetons_reserves: 126, jetons_consommes: 11, etapes_faites: 6, etapes_max: 18,
  question_en_attente: null, rapport: null, rapport_brut: null, criteres: { idu: A1, parcel_ids: [A1, A2] }, erreur: null, cree_le: null, maj_le: null, termine_le: null, ...p,
});

test('VIS-15 point 3 : fin de mission de conception → « Ouvrir mon projet en 3D », Mimmo propose la suite', () => {
  assert.equal(missionConceptionOuvrable3D(mission({})), true);
  assert.equal(missionConceptionOuvrable3D(mission({ statut: 'budget_atteint' })), true);
  assert.equal(missionConceptionOuvrable3D(mission({ statut: 'en_cours' })), false);
  assert.equal(missionConceptionOuvrable3D(mission({ type: 'prospection_fonciere' })), false);
  assert.equal(missionConceptionOuvrable3D(mission({ erreur: 'boom' })), false);
  assert.deepEqual(corpsPreparation3D(mission({})), {
    action: ACTION_PREPARER_3D_CONCEPTION, mission_id: '344c865d-0180-41d1-af19-d874e1ca9ccd',
    conversation_id: '2631ee1e-e01a-451f-a181-ff94b2f6693b', parcel_ids: [A1, A2],
  });
  assert.equal(corpsPreparation3D(mission({ criteres: { idu: A1 } })).parcel_ids, undefined, 'une parcelle : pas de contrôle d’assiette');
  assert.match(phraseSuiteConception(mission({})), /^Votre conception est prête\. Voulez-vous voir le projet en 3D \? Ensuite, je peux préparer le pack plaquette/);
  assert.match(phraseSuiteConception(mission({ statut: 'budget_atteint' })), /plafond prévu/);
});

test('VIS-15 point 3/5 : réponse du serveur → ouverture, écart de gabarit et assiette transmis', () => {
  const ok = lireIssuePreparation3D({ status: 'ok', data: { preparation_id: 'p1', gabarit_retenu: 'R+4 demandé, R+1 retenu dans la 3D car hauteur max 7 m en UC — modifiable', assiette: 'AI0001 + AI0002 (2 349 m²)' } });
  assert.deepEqual(ok, { ok: true, preparationId: 'p1', gabaritRetenu: 'R+4 demandé, R+1 retenu dans la 3D car hauteur max 7 m en UC — modifiable', assiette: 'AI0001 + AI0002 (2 349 m²)' });
  assert.equal(lireIssuePreparation3D({ status: 'ok', data: { preparation_id: 'p2' } }).ok, true);
  const nf = lireIssuePreparation3D({ status: 'not_found', message: 'PAS ENCORE DE CONCEPTION…' });
  assert.equal(nf.ok, false);
  assert.match(!nf.ok ? nf.message : '', /introuvable/);
  const err = lireIssuePreparation3D({ status: 'partial', message: 'Aucun volume ne tient sur la parcelle avec les règles connues : recul.' });
  assert.equal(!err.ok && err.message, 'Aucun volume ne tient sur la parcelle avec les règles connues : recul.');
  assert.equal(lireIssuePreparation3D(null).ok, false);
  assert.equal(phraseUtilisateur('RIEN N’A ÉTÉ LANCÉ. Cette extension n’est pas placée. Dis-le simplement.'), 'Cette extension n’est pas placée.');
});
