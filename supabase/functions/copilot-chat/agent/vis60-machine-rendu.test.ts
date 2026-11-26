// deno test --no-lock --no-check --node-modules-dir=none -A supabase/functions/copilot-chat/agent/vis60-machine-rendu.test.ts
import * as na from 'node:assert/strict';
import { lireSignalMachine, phraseMachineSignal } from './machine-rendu.ts';

const T0 = Date.parse('2026-11-26T21:00:00Z');

Deno.test('VIS-60 — hors ligne : durée exacte (horloge du serveur), attente et aucun débit annoncés', () => {
  const p = phraseMachineSignal({ vu_le: '2026-11-26T18:44:00Z', etat: 'pret', maintenant: '2026-11-26T21:00:00Z' }, T0 + 3_600_000);
  na.equal(p, 'Machine de rendu hors ligne depuis 2 h 16 (dernier signal le 26/11 à 19 h 44). Le rendu restera EN ATTENTE et démarrera automatiquement à son retour ; rien n’est débité tant qu’il n’a pas démarré.');
});

Deno.test('VIS-60 — en ligne / sans signal', () => {
  na.equal(phraseMachineSignal({ vu_le: '2026-11-26T20:59:30Z', etat: 'occupe', maintenant: '2026-11-26T21:00:00Z' }, T0), 'Machine de rendu en ligne, un rendu en cours (un seul à la fois).');
  na.equal(phraseMachineSignal(null, T0), null);
});

Deno.test('VIS-60 — lecture : migration absente → null (repli sur l’état déduit)', async () => {
  na.equal(await lireSignalMachine({ rpc: async () => ({ data: null, error: { message: 'function studio_machine_etat() does not exist' } }) }), null);
  const s = await lireSignalMachine({ rpc: async () => ({ data: [{ vu_le: '2026-11-26T20:59:30Z', etat: 'pret' }], error: null }) });
  na.equal(s?.etat, 'pret');
});
