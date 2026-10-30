// deno test supabase/functions/copilot-chat/agent/rapport.test.ts — rapport v2, pur, sans réseau.
import * as na from 'node:assert/strict';
const assert = (v: unknown, msg?: string) => na.ok(v, msg);
const assertEquals = (a: unknown, b: unknown, msg?: string) => na.deepStrictEqual(a, b, msg);

import {
  assemblerRapportV2, brouillonVide, calculerChargeFonciere, fusionnerHypotheses, hypothesesVides,
  lireHypothesesPartielles, normaliserClassement, normaliserTerrainBrut,
} from './rapport.ts';

// Hypothèses de la mission réelle de Montreuil (7a7c855a…), exprimées en v2.
const COMMUNES = fusionnerHypotheses(hypothesesVides(), lireHypothesesPartielles({
  programme: { nb_logements: 40, shab_m2: 2800, sdp_m2: 3200, gabarit: 'R+4' },
  prix_vente_libre_eur_m2_shab: 5850, source_prix: 'get_etude_marche — médiane DVF commune 93048',
  part_lls_pct: 0, prix_cession_lls_eur_m2_shab: null,
  cout_travaux_eur_m2_sdp: 2100, source_couts: 'get_couts_construction — barème 2026 BT01',
  honoraires_pct_travaux: 8, aleas_pct_travaux: 5, commercialisation_pct_ca: 3, frais_financiers_pct_ca: 2,
  frais_acquisition_pct_foncier: 7.5, taxes_urbanisme_eur: 150000, vrd_eur: 200000, demolition_eur: 0,
  marge_cible_pct_ca: 10,
}));

/** Recalcul de contrôle, écrit indépendamment (même formule que l'onglet Bilan Excel). */
function controle(h: { shab: number; sdp: number; prix: number; lls: number; prixLls: number; cout: number; hon: number; ale: number; com: number; ff: number; fa: number; taxes: number; vrd: number; demo: number; marge: number }) {
  const ca = h.shab * (1 - h.lls / 100) * h.prix + h.shab * (h.lls / 100) * h.prixLls;
  const trav = h.sdp * h.cout;
  const couts = trav * (1 + h.hon / 100 + h.ale / 100) + h.taxes + h.vrd + h.demo + ca * (h.com + h.ff) / 100;
  return { ca, couts, cf: (ca * (1 - h.marge / 100) - couts) / (1 + h.fa / 100) };
}

Deno.test('charge foncière : formule du bilan à rebours, complète', () => {
  const b = calculerChargeFonciere(COMMUNES, {}, 3554);
  const c = controle({ shab: 2800, sdp: 3200, prix: 5850, lls: 0, prixLls: 0, cout: 2100, hon: 8, ale: 5, com: 3, ff: 2, fa: 7.5, taxes: 150000, vrd: 200000, demo: 0, marge: 10 });
  assertEquals(b.statut, 'complet');
  assertEquals(b.ca_ht, Math.round(c.ca));
  assertEquals(b.couts_hors_foncier_ht, Math.round(c.couts));
  assertEquals(b.charge_fonciere_admissible_ht, Math.round(c.cf));
  assertEquals(b.charge_fonciere_eur_m2_terrain, Math.round(c.cf / 3554));
  assertEquals(b.source, 'calculer_charge_fonciere');
  assertEquals(b.hypotheses_specifiques, {});
});

Deno.test('charge foncière : varie par terrain (mixité sociale, démolition, argiles)', () => {
  const spec = lireHypothesesPartielles({ part_lls_pct: 30, prix_cession_lls_eur_m2_shab: 2600, demolition_eur: 120000, cout_travaux_eur_m2_sdp: 2250 });
  const b = calculerChargeFonciere(COMMUNES, spec, 3651);
  const c = controle({ shab: 2800, sdp: 3200, prix: 5850, lls: 30, prixLls: 2600, cout: 2250, hon: 8, ale: 5, com: 3, ff: 2, fa: 7.5, taxes: 150000, vrd: 200000, demo: 120000, marge: 10 });
  assertEquals(b.charge_fonciere_admissible_ht, Math.round(c.cf));
  assert(b.charge_fonciere_admissible_ht! < calculerChargeFonciere(COMMUNES, {}, 3651).charge_fonciere_admissible_ht!);
  assertEquals(b.hypotheses_specifiques, { part_lls_pct: 30, prix_cession_lls_eur_m2_shab: 2600, demolition_eur: 120000, cout_travaux_eur_m2_sdp: 2250 });
});

Deno.test('charge foncière : inconnu = null + manques, jamais 0 inventé', () => {
  const sans = fusionnerHypotheses(COMMUNES, lireHypothesesPartielles({ part_lls_pct: null, vrd_eur: null, prix_vente_libre_eur_m2_shab: 5850 }));
  const b = calculerChargeFonciere(sans, {}, 3000);
  assertEquals(b.statut, 'partiel');
  assert(b.manques.some((m) => m.startsWith('Part de logements sociaux')));
  assert(b.manques.some((m) => m.startsWith('VRD')));
  assert(b.charge_fonciere_admissible_ht !== null, 'postes secondaires inconnus : calcul fait, signalé');
  assertEquals(b.detail.vrd_ht, null);
  // Essentiel manquant → aucun chiffre.
  const b2 = calculerChargeFonciere(fusionnerHypotheses(COMMUNES, lireHypothesesPartielles({ cout_travaux_eur_m2_sdp: null })), {}, 3000);
  assertEquals([b2.charge_fonciere_admissible_ht, b2.ca_ht, b2.statut], [null, null, 'partiel']);
  assert(b2.manques.includes('Coût des travaux (€/m² SDP)'));
  // LLS imposée mais prix de cession inconnu → pas de CA.
  const b3 = calculerChargeFonciere(COMMUNES, lireHypothesesPartielles({ part_lls_pct: 25 }), 3000);
  assertEquals(b3.charge_fonciere_admissible_ht, null);
  // Valeurs hors bornes rejetées (null), pas tronquées.
  assertEquals(lireHypothesesPartielles({ marge_cible_pct_ca: 150, honoraires_pct_travaux: -2 }), { marge_cible_pct_ca: null, honoraires_pct_travaux: null });
});

Deno.test('assemblage v2 : brouillon + terminer_mission léger, bilans rattachés, classement, contacts', () => {
  const b = brouillonVide();
  b.hypotheses_communes = COMMUNES;
  b.terrains['93048000AJ0209'] = normaliserTerrainBrut({ idu: '93048000AJ0209', commune: 'Montreuil', surface_m2: 3554, zonage: 'UC91D19', verdict: 'prioritaire', score: 97.4,
    proprietaire: { nom: 'ADYAL PROPERTY MANAGEMENT', forme: 'SAS', siren: 'non exploitable', source: 'get_proprietaire_parcelle' },
    contraintes: [{ type: 'mixite_sociale', libelle: 'Servitude de mixité sociale', source: 'get_prescriptions_urbanisme' }, { type: 'inconnu', libelle: 'x' }],
    sources: ['get_etude_parcelle'] })!;
  b.terrains['93048000AZ0194'] = normaliserTerrainBrut({ idu: '93048000AZ0194', commune: 'Montreuil', verdict: 'a_etudier', score: 95 })!;
  b.bilans['93048000AJ0209'] = calculerChargeFonciere(COMMUNES, {}, 3554);
  b.bilans['93048000CI0008'] = calculerChargeFonciere(COMMUNES, {}, 3217);   // bilan sans fiche
  b.contacts.push({ qualite: 'mairie', nom: 'Mairie de Montreuil', telephone: '01 48 70 60 00', source: 'get_contacts_mairies' });
  const r = assemblerRapportV2(b, {
    titre: 'Prospection Montreuil', synthese: 'S.',
    classement: [{ idu: '93048000AZ0194', justification: 'Moins cher' }, { idu: '93048000AJ0209', justification: 'Bien placé' }, { idu: '99999999ZZ9999' }],
    limites: ['L1'],
    contacts: [{ qualite: 'mairie', nom: 'Mairie de Montreuil', telephone: '01 48 70 60 00', source: 'x' }],
  }, { actions_proposees: ['a1'], memoire_ajoutee: 2, jetons_consommes: 50, limites_ajoutees: [] });
  assertEquals(r.version, 2);
  const t = r.terrains as Array<Record<string, unknown>>;
  assertEquals(t.map((x) => x.idu), ['93048000AZ0194', '93048000AJ0209', '93048000CI0008']);
  assertEquals(t.map((x) => x.rang), [1, 2, null]);
  assertEquals(t[1].verdict_libelle, 'Prioritaire');
  assertEquals((t[1].proprietaire as Record<string, unknown>).siren, null, 'SIREN non exploitable → null');
  assertEquals((t[1].contraintes as Array<Record<string, unknown>>)[1].type, 'autre');
  assertEquals(t[1].charge_fonciere_admissible, (t[1].bilan as { charge_fonciere_admissible_ht: number }).charge_fonciere_admissible_ht, 'compat v1');
  assertEquals(t[0].bilan, null);
  assertEquals((r.classement as unknown[]).length, 2, 'idu inconnu écarté');
  assertEquals((r.contacts as unknown[]).length, 1, 'contacts dédoublonnés');
  assert((r.limites as string[]).some((l) => l.includes('Programme et hypothèses identiques')), 'dit quand rien ne départage');
  assertEquals((r.hypotheses_communes as { programme: { gabarit: string } }).programme.gabarit, 'R+4');
  assertEquals([r.actions_proposees, r.memoire_ajoutee, r.jetons_consommes], [['a1'], 2, 50]);
});

Deno.test('assemblage : rapport v1 complet toujours accepté', () => {
  const r = assemblerRapportV2(brouillonVide(), { titre: 'T', synthese: 'S', terrains: [{ idu: '35238000AB0001', commune: 'Rennes', verdict: 'bizarre', surface_m2: 1200 }] },
    { actions_proposees: [], memoire_ajoutee: 0, jetons_consommes: 3, limites_ajoutees: ['Réserve épuisée'] });
  const t = (r.terrains as Array<Record<string, unknown>>)[0];
  assertEquals([t.idu, t.verdict, t.surface_m2, t.bilan], ['35238000AB0001', 'indetermine', 1200, null]);
  assertEquals(r.limites, ['Réserve épuisée']);
  assertEquals(normaliserClassement([{ idu: 'a b' }], new Set()), []);
});
