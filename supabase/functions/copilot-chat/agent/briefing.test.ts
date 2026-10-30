// deno test supabase/functions/copilot-chat/agent/briefing.test.ts
import * as na from 'node:assert/strict';
const assert = (v: unknown, msg?: string) => na.ok(v, msg);
const assertEquals = (a: unknown, b: unknown) => na.deepStrictEqual(a, b);

import {
  briefingDeterministe,
  briefingPourMissionVeille,
  decompteParGenre,
  lienSur,
  normaliserElement,
  rapportVeilleVersBriefing,
} from './briefing.ts';

const MID = '11111111-2222-3333-4444-555555555555';

Deno.test('rapport vide, non objet ou sans élément sûr → aucun briefing', () => {
  assertEquals(rapportVeilleVersBriefing(null), null);
  assertEquals(rapportVeilleVersBriefing([]), null);
  assertEquals(rapportVeilleVersBriefing({ synthese: 'Rien de notable.' }), null);
  assertEquals(rapportVeilleVersBriefing({ elements: [{ genre: 'opportunite', titre: 'Sans source' }] }), null);
  assertEquals(rapportVeilleVersBriefing({ elements: [{ genre: 'rumeur', titre: 'X', source: 's:1' }] }), null);
  assertEquals(rapportVeilleVersBriefing({ elements: [{ genre: 'permis', titre: 'X', source: 's:1', retenu: false }] }), null);
});

Deno.test('éléments retenus : normalisés, dédoublonnés, mission rattachée, lien dangereux retiré', () => {
  const b = rapportVeilleVersBriefing({
    titre: 'Veille du 30 octobre',
    synthese: 'Deux signaux confirmés.',
    elements: [
      { genre: 'Permis', titre: '  Permis PC 123  ', detail: 'Nature : neuf.', source: 'sitadel_permis:1', lien: 'javascript:alert(1)' },
      { genre: 'permis', titre: 'Permis PC 123', detail: 'doublon', source: 'sitadel_permis:1' },
      { genre: 'opportunite', titre: 'AO voirie', source: 'ao_watch_events:9', lien: 'https://www.boamp.fr/avis/1' },
    ],
  }, { mission_id: MID })!;
  assertEquals(b.titre, 'Veille du 30 octobre');
  assertEquals(b.resume, 'Deux signaux confirmés.');
  assertEquals(b.elements.length, 2);
  assertEquals(b.elements[0].genre, 'permis');
  assertEquals(b.elements[0].titre, 'Permis PC 123');
  assertEquals(b.elements[0].lien, undefined);
  assertEquals(b.elements[1].lien, 'https://www.boamp.fr/avis/1');
  assert(b.elements.every((e) => e.mission_id === MID));
  assertEquals(b.mission_id, MID);
});

Deno.test('terrains : seuls les terrains sourcés et non écartés deviennent des opportunités', () => {
  const b = rapportVeilleVersBriefing({
    terrains: [
      { idu: '75056000AB0012', commune: 'Paris', verdict: 'À approfondir', points_forts: ['Zone UG'], points_bloquants: [], sources: ['get_etude_parcelle'] },
      { idu: '75056000AB0013', commune: 'Paris', verdict: 'À écarter', sources: ['gpu'] },
      { idu: '75056000AB0014', commune: 'Paris', verdict: 'Prometteur', sources: [] },
    ],
  })!;
  assertEquals(b.elements.length, 1);
  assertEquals(b.elements[0].source, 'parcelle:75056000AB0012');
  assert(b.elements[0].detail.includes('Sources : get_etude_parcelle'));
  assertEquals(b.resume, 'La veille a retenu 1 opportunité.');
});

Deno.test('décompte et briefing déterministe', () => {
  const els = [
    { genre: 'opportunite' as const, titre: 'A', detail: '', source: 'x:1' },
    { genre: 'opportunite' as const, titre: 'B', detail: '', source: 'x:2' },
    { genre: 'permis' as const, titre: 'C', detail: '', source: 'x:3' },
    { genre: 'marche' as const, titre: 'D', detail: '', source: 'x:4' },
  ];
  assertEquals(decompteParGenre(els), '2 opportunités, 1 permis de construire et 1 signal de marché');
  const b = briefingDeterministe(els)!;
  assertEquals(b.titre, 'Pendant votre absence : 4 nouveautés');
  assertEquals(briefingDeterministe([]), null);
});

Deno.test('fin de mission veille : rapport qualifié, tout écarté, ou repli si mission interrompue', () => {
  const evenements = [{ genre: 'opportunite', titre: 'AO', detail: '', source: 'ao_watch_events:1' }];
  // Rapport exploitable.
  assertEquals(briefingPourMissionVeille({ id: MID, statut: 'terminee', criteres: { evenements },
    rapport: { elements: [{ genre: 'alerte', titre: 'Z', source: 'zone_alerts:1' }] } })!.elements[0].genre, 'alerte');
  // Mission terminée qui a tout écarté : rien.
  assertEquals(briefingPourMissionVeille({ id: MID, statut: 'terminee', criteres: { evenements },
    rapport: { elements: [{ genre: 'opportunite', titre: 'AO', source: 'ao_watch_events:1', retenu: false }] } }), null);
  // Budget atteint sans rapport : repli sur les signaux bruts.
  const r = briefingPourMissionVeille({ id: MID, statut: 'budget_atteint', criteres: { evenements }, rapport: null })!;
  assertEquals(r.elements.length, 1);
  assertEquals(r.mission_id, MID);
});

Deno.test('liens et éléments', () => {
  assertEquals(lienSur('/app/veille'), '/app/veille');
  assertEquals(lienSur('//evil.example'), undefined);
  assertEquals(lienSur('data:text/html,x'), undefined);
  assertEquals(normaliserElement({ genre: 'plu', titre: 'x'.repeat(500), source: 's' })!.titre.length, 160);
});
