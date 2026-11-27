// VIS-67 — copie SITE du module partagé de la grille de vente (identique au Studio) et lecture de la carte du chat.
// npx tsx --test src/lib/vente/filtreVente.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { empreinteFiltreVente, filtreDepuisPhrase, filtrerLots, syntheseLots, type LotFiltrable } from './filtreVente';
import { lireCarteGrilleVente, textesCarteGrilleVente } from './carteGrilleVente';

const lot = (id: string, niveau: number, typologie: string, az: number[], statut: LotFiltrable['statut'] = 'libre', prix = 300000): LotFiltrable =>
  ({ id, lot: id, niveau, typologie, shabM2: 65, prixEur: prix, azimutsDeg: az, orientation: null, exterieurM2: 6, parkings: 1, statut });
const LOTS = [lot('A205', 2, 'T3', [180]), lot('A305', 3, 'T3', [180, 270]), lot('A301', 3, 'T3', [0]), lot('A405', 4, 'T3', [135], 'libre', 410000), lot('A407', 4, 'T3', [180], 'vendu'), lot('A302', 3, 'T2', [180])];

test('« T3 libres au-dessus du 2e étage orientés sud » : sud-est compris, vendu et nord exclus', () => {
  const f = filtreDepuisPhrase('montre-moi les T3 libres au-dessus du 2e étage orientés sud').filtre;
  assert.deepEqual(filtrerLots(LOTS, f).map((l) => l.id), ['A305', 'A405']);
  const s = syntheseLots(LOTS, f);
  assert.equal(s.retenus, 2);
  assert.equal(s.prixMax, 410000);
});

test('empreinte du vocabulaire stable (même valeur que le Studio)', () => {
  assert.match(empreinteFiltreVente(), /^fnv1a32:[0-9a-f]{8}$/);
  // Le fichier ne doit rien importer : il se compile seul dans le Studio, le site et l'Edge.
  assert.doesNotMatch(readFileSync(new URL('./filtreVente.ts', import.meta.url), 'utf8'), /^import /m);
});

test('carte du chat : lue depuis data de l’outil, textes prêts', () => {
  const f = filtreDepuisPhrase('T3 libres orientés sud').filtre;
  const data = { carte: 'commande-studio', commande: { id: 'grille-vente', params: {} }, grille_vente: { filtre: f, resume: 'T3 · libre', compris: [], comparer: [], synthese: syntheseLots(LOTS, f) } };
  const c = lireCarteGrilleVente(data)!;
  const t = textesCarteGrilleVente(c);
  assert.equal(t.titre, '3 lots sur 6');
  assert.equal(t.lignes[0]!.lot, 'A205');
  assert.equal(lireCarteGrilleVente({ carte: 'commande-studio' }), null);
  assert.equal(lireCarteGrilleVente({ carte: 'autre', grille_vente: {} }), null);
});
