// VIS-67 — outil `grille_vente` : phrase → filtre → commande `grille-vente` validée (carte commande-studio) ; synthèse
// quand les lots du projet sont connus (table vente_lots) ; pertinence du tour.
// deno test --no-lock --no-check --node-modules-dir=none -A supabase/functions/copilot-chat/agent/vis67-grille-vente.test.ts
import * as na from 'node:assert/strict';
const assert = (v: unknown, m?: string) => na.ok(v, m);
const assertEquals = (a: unknown, b: unknown) => na.deepStrictEqual(a, b);
const assertMatch = (s: string, re: RegExp) => na.match(s, re);
import { executerOutilGrilleVente, grilleVentePertinente, lotsDepuisLignes, OUTIL_GRILLE_VENTE_DEF } from './grille-vente.ts';
import { CATALOGUE_COMMANDES_CHAT } from '../../../../src/spaces/promoteur/shared/echangeStudio/pontCommandesStudio.ts';

const LIGNES = [
  { lot_id: 'A305', niveau: 3, typologie: 'T3', shab_m2: 76.96, exterieur_m2: 8, orientation: 'sud', azimuts_deg: [180, 270], parkings: 1, prix_grille_eur: 414000, prix_force_eur: null, statut: 'libre', empreinte_modele: 'mb1-b', maj_le: '2026-11-27T10:00:00Z' },
  { lot_id: 'A405', niveau: 4, typologie: 'T3', shab_m2: 76.96, exterieur_m2: 8, orientation: 'sud', azimuts_deg: [180, 270], parkings: 1, prix_grille_eur: 431500, prix_force_eur: null, statut: 'libre', empreinte_modele: 'mb1-b', maj_le: '2026-11-27T10:00:00Z' },
  { lot_id: 'A205', niveau: 2, typologie: 'T3', shab_m2: 76.96, exterieur_m2: 8, orientation: 'sud', azimuts_deg: [180], parkings: 1, prix_grille_eur: 392900, prix_force_eur: null, statut: 'libre', empreinte_modele: 'mb1-b', maj_le: '2026-11-27T10:00:00Z' },
  { lot_id: 'A301', niveau: 3, typologie: 'T3', shab_m2: 76.96, exterieur_m2: 8, orientation: 'nord', azimuts_deg: [0, 270], parkings: 1, prix_grille_eur: 390600, prix_force_eur: null, statut: 'libre', empreinte_modele: 'mb1-b', maj_le: '2026-11-27T10:00:00Z' },
  { lot_id: 'A307', niveau: 3, typologie: 'T3', shab_m2: 70, exterieur_m2: 6, orientation: 'sud', azimuts_deg: [180], parkings: 1, prix_grille_eur: 380000, prix_force_eur: 375000, statut: 'vendu', empreinte_modele: 'mb1-b', maj_le: '2026-11-27T10:00:00Z' },
  { lot_id: 'A999', niveau: 3, typologie: 'T3', shab_m2: 70, statut: 'libre', empreinte_modele: 'mb1-a', maj_le: '2026-11-20T10:00:00Z' },
];
const PHRASE = 'montre-moi les T3 libres au-dessus du 2e étage orientés sud';

Deno.test('VIS-67 · la commande grille-vente est au catalogue du pont (contrat VIS-67)', () => {
  const e = CATALOGUE_COMMANDES_CHAT.find((x) => x.id === 'grille-vente');
  assertEquals(e?.contrat, 'VIS-67');
  assertEquals(OUTIL_GRILLE_VENTE_DEF.name, 'grille_vente');
});

Deno.test('VIS-67 · phrase → filtre → carte commande-studio validée (sans lots : aucune synthèse, aucun lot cité)', async () => {
  const r = await executerOutilGrilleVente({ demande: PHRASE }, { texteRecu: PHRASE, conversationId: null, maintenant: () => 1 });
  assertEquals(r.status, 'ok');
  const d = r.data as Record<string, any>;
  assertEquals(d.carte, 'commande-studio');
  assertEquals(d.commande.id, 'grille-vente');
  assertEquals(d.commande.params, { etageMin: 3, typologies: 'T3', orientations: 'sud', statuts: 'libre', demande: PHRASE });
  assertEquals(d.grille_vente.filtre, { typologies: ['T3'], statuts: ['libre'], etageMin: 3, orientations: ['sud'] });
  assertEquals(d.grille_vente.synthese, null);
  assertMatch(r.message!, /Ne cite AUCUN lot/);
});

Deno.test('VIS-67 · avec les lots du projet : synthèse (empreinte la plus récente, statut et orientation respectés)', async () => {
  const r = await executerOutilGrilleVente({}, { texteRecu: PHRASE, conversationId: 'c1', lireLots: async () => lotsDepuisLignes(LIGNES) });
  const s = (r.data as Record<string, any>).grille_vente.synthese;
  assertEquals(s.total, 5);
  assertEquals(s.retenus, 2);
  assertEquals(s.lots.map((l: { lot: string }) => l.lot), ['A305', 'A405']);
  assertEquals(s.prixMin, 414000);
  assertMatch(r.message!, /2 lot\(s\) sur 5/);
  assertEquals(lotsDepuisLignes(LIGNES).find((l) => l.id === 'A307')?.prixEur, 375000);
});

Deno.test('VIS-67 · paramètres explicites et comparateur ; lecture en échec → pas de synthèse', async () => {
  const r = await executerOutilGrilleVente({ demande: 'compare A203 et a305', prixMax: 450000 }, { texteRecu: '', conversationId: 'c1', lireLots: async () => { throw new Error('table absente'); } });
  const d = r.data as Record<string, any>;
  assertEquals(d.commande.params.comparer, 'A203,A305');
  assertEquals(d.commande.params.prixMax, 450000);
  assertEquals(d.grille_vente.synthese, null);
  const refus = await executerOutilGrilleVente({ etageMin: 'haut' as unknown as number, demande: 'x'.repeat(10) }, { texteRecu: '', conversationId: null });
  assertEquals(refus.status, 'ok'); // valeur illisible ignorée, pas d'erreur
});

Deno.test('VIS-67 · pertinence du tour', () => {
  assert(grilleVentePertinente([PHRASE]));
  assert(grilleVentePertinente(['compare A203 et A305']));
  assert(grilleVentePertinente(['ouvre la grille de vente']));
  assert(grilleVentePertinente(['qu’est-ce qui reste à vendre dans les logements ?']));
  assert(!grilleVentePertinente(['quel temps fait-il à Lyon ?']));
  assert(!grilleVentePertinente(['analyse la parcelle 75056000AB0012']));
});
