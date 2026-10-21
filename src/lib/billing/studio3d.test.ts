import assert from 'node:assert/strict';
import test from 'node:test';
import { STUDIO_3D } from './grille.ts';

// Coûts complets au pire cas (audit du 21/10/2026) : si l'un de ces prix baisse
// sous son coût majoré de 3 % de frais de paiement, Mimmoza perd de l'argent.
const COUT_COMPLET: Record<string, number> = {
  studio_essentiel: 177, studio_pro: 635, studio_entreprise: 1711,
  image_4k: 16.43, pack_5_images: 82, film_60s: 134.52, visite_6_mois: 502, pack_lancement: 584,
};

test('Studio 3D : chaque offre reste bénéficiaire au pire cas, remises comprises', () => {
  const remiseMax = STUDIO_3D.remisesCumulables
    ? (1 - STUDIO_3D.remiseAnnuellePct / 100) * (1 - STUDIO_3D.remisePct / 100)
    : 1 - Math.max(STUDIO_3D.remiseAnnuellePct, STUDIO_3D.remisePct) / 100;
  for (const o of STUDIO_3D.abonnements) {
    const encaisse = o.prixHT * remiseMax * 0.97;
    assert.ok(encaisse > COUT_COMPLET[o.code] * 1.3, `${o.libelle} : marge < 30 % avec toutes les remises`);
  }
  for (const o of STUDIO_3D.aLActe) assert.ok(o.prixHT * 0.97 > COUT_COMPLET[o.code], o.libelle);
  const pack = STUDIO_3D.aLActe.find((o) => o.code === 'pack_lancement')!;
  assert.equal(STUDIO_3D.offrePilote.prixHT, Math.round(pack.prixHT * (1 - STUDIO_3D.offrePilote.remisePct / 100)));
  assert.ok(STUDIO_3D.offrePilote.prixHT * 0.97 > COUT_COMPLET.pack_lancement);
  assert.equal(STUDIO_3D.prixMensuelDesHT, Math.min(...STUDIO_3D.abonnements.map((o) => o.prixHT)));
});
