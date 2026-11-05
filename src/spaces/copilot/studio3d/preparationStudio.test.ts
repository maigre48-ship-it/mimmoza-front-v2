// LOT E1 — « 3D préparée par Mimmo » : de l'appel d'outil du chat à l'ouverture du Studio.
// La préparation est produite par le CODE RÉEL du serveur (copilot-chat/agent/studio.ts, qui appelle
// ce même dossier studio3d) puis relue et ouverte comme le fait la carte du Dossier 3D.
// Géométrie SYNTHÉTIQUE ; valeurs réglementaires : celles de la fiche AE0414 du 05/11/2026.
import assert from 'node:assert/strict';
import test from 'node:test';
import { preparerVolume, ficheDepuisPreparation } from '../../../../supabase/functions/copilot-chat/agent/studio.ts';
import { dernierePreparation, lignesCarte, lirePreparationStockee, ouverturePreparation, renduDemande } from './preparationStudio.ts';
import { validerProjet } from '../../promoteur/shared/echangeStudio/mimmozaProjetV2.ts';

const LON = 2.2068, LAT = 48.892, KX = 111_320 * Math.cos(LAT * Math.PI / 180);
function rectangle(l: number, h: number) {
  const ring = [[0, 0], [l, 0], [l, h], [0, h]].map(([x, y]) => [LON + x / KX, LAT + y / 111_320]);
  return { type: 'Polygon' as const, coordinates: [[...ring, ring[0]]] };
}
const SOURCE = 'Règlement GPU — 92050_PLU_20251209';
const REGLES = [
  { cle: 'hauteur_max_m', valeur: 28, unite: 'm', statut: 'confirme', source: SOURCE, article: 'UC 10, p. 109', nature: 'par_secteur', regle_relative: 'UC 10-1' },
  { cle: 'emprise_sol_max_pct', valeur: null, unite: '%', statut: 'confirme', source: SOURCE, article: 'UC 9, p. 109', nature: 'non_reglementee' },
  { cle: 'recul_voie_m', valeur: 0, unite: 'm', statut: 'confirme', source: SOURCE, article: 'UC 6-1, p. 106', nature: 'chiffree' },
  { cle: 'recul_limites_m', valeur: 8, unite: 'm', statut: 'confirme', source: SOURCE, article: 'UC 7' },
  { cle: 'pleine_terre_min_pct', valeur: 20, unite: '%', statut: 'confirme', source: SOURCE, article: 'UC 13' },
  { cle: 'stationnement_par_logement', valeur: 1, unite: 'places/logement', statut: 'confirme', source: SOURCE, article: 'UC 12' },
];

async function preparation(l: number, h: number, logements: number) {
  const c = { id: '5a1c0e00-0000-4000-8000-0000000000c1', idu: '92050000AE0414', commune: 'Nanterre',
    parcelle: { idu: '92050000AE0414', geometrie: rectangle(l, h), surface_m2: l * h, source: 'test' }, regles_plu: REGLES,
    programme: { nb_logements: logements, gabarit: 'R+4' } };
  const p = await preparerVolume(c);
  assert.ok(p.ok);
  if (!p.ok) throw new Error(p.raison);
  // Ce que la base renvoie (JSON) : studio_preparations.{id, idu, entree, volume}.
  const ligne = JSON.parse(JSON.stringify({ id: '9b2c0000-0000-4000-8000-000000000001', idu: c.idu, entree: p.entree, volume: p.volume, resume: p.resume }));
  return { p, ligne };
}

test('E1 front : dernière préparation RÉUSSIE de la conversation (erreurs et sorties partielles ignorées)', async () => {
  const { p } = await preparation(50, 40, 40);
  const sortieOk = { status: 'ok', source: 'MimmozIA · Studio 3D', data: { preparation_id: '9b2c0000-0000-4000-8000-000000000001', conception_id: null, idu: '92050000AE0414', commune: 'Nanterre', volume: p.resume } };
  const messages = [
    { role: 'assistant', toolCalls: [{ name: 'studio_preparer_3d', status: 'success', output: sortieOk }] },
    { role: 'assistant', toolCalls: [{ name: 'studio_preparer_3d', status: 'success', output: { status: 'partial', source: 'x', message: 'contour manquant' } }] },
    { role: 'assistant', toolCalls: [{ name: 'studio_preparer_3d', status: 'error', output: { status: 'error' } }] },
  ];
  const r = dernierePreparation(messages);
  assert.equal(r?.preparationId, '9b2c0000-0000-4000-8000-000000000001');
  assert.deepEqual(lignesCarte(r!).map((l) => l.replace(/[\u202f\u00a0]/g, ' ')), ['1 bâtiment en R+4', '≈ 2 720 m² de surface de plancher (estimée)', '38 logements placés sur 40 visés']);
  assert.ok(r!.controles.some((c) => c.verdict === 'a_verifier' && /UC 10-1/.test(c.explication)));
  assert.equal(dernierePreparation([{ role: 'user' }]), null);
  assert.equal(renduDemande(messages), false);
  assert.equal(renduDemande([{ role: 'assistant', toolCalls: [{ name: 'studio_lancer_rendu', status: 'success' }] }]), true);
});

test('E1 front : un bâtiment — ouverture = fiche du volume + parcelle de la conception + pose (comme « Voir en 3D »)', async () => {
  const { ligne } = await preparation(50, 40, 40);
  const s = lirePreparationStockee(ligne);
  assert.ok(s);
  const o = ouverturePreparation(s!);
  assert.ok(o.ok);
  if (!o.ok) return;
  assert.match(o.fiche.objectif ?? '', /R\+4/);
  assert.equal(o.terrain.volumeBatiments, null);
  assert.ok(o.terrain.implantation && Number.isFinite(o.terrain.implantation.orientationDeg));
  assert.deepEqual([o.terrain.parcel.properties.idu, o.terrain.parcel.properties.code_insee, o.terrain.adresse], ['92050000AE0414', '92050', 'Nanterre']);
  // Même fiche que celle jointe au rendu par le serveur (un seul code).
  const f = ficheDepuisPreparation(ligne, '7c0f0000-0000-4000-8000-0000000000aa', '2026-11-05T12:00:00.000Z', crypto.randomUUID(), 'https://mimmoza.vercel.app');
  assert.ok(f.ok);
  if (f.ok) {
    assert.deepEqual(f.valeur.draft, o.fiche);
    assert.ok(validerProjet(f.valeur.charge).ok, 'projet v2 valide (contrat partagé avec le Studio)');
  }
});

test('E1 front : plusieurs bâtiments — tous partent dans `batiments`, pas de pose unique', async () => {
  const { ligne } = await preparation(90, 70, 80);
  const o = ouverturePreparation(lirePreparationStockee(ligne)!);
  assert.ok(o.ok);
  if (!o.ok) return;
  assert.ok((o.terrain.volumeBatiments?.batiments.length ?? 0) >= 2);
  assert.equal(o.terrain.implantation, undefined);
});

test('E1 front : ligne illisible → null (jamais d’ouverture sur des données douteuses)', () => {
  assert.equal(lirePreparationStockee(null), null);
  assert.equal(lirePreparationStockee({ id: 'x', entree: {}, volume: {} }), null);
  assert.equal(lirePreparationStockee({ id: 'x', idu: 'A', entree: { parcelle: { geometrie: { type: 'Point', coordinates: [0, 0] } } }, volume: { emprise: {}, niveaux: 5, origine: {} } }), null);
});
