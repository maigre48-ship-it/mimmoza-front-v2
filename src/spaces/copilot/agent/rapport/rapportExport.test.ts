import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { Packer } from 'docx';
import {
  construireModeleRapport, extraireHypothesesV1, hypothesesTerrain, libelleVerdict, lisible, nomFichierRapport,
  pctVersFraction, type ModeleRapport,
} from './rapportModele.ts';
import { calculerBilan, chargeFonciereSensibilite, entreesDepuisJeu, libelleEtatBilan, type EntreesBilan } from './bilanCalcul.ts';
import {
  construireClasseurBilan, formulesBilan, formuleSensibilite, FEUILLE_BILAN, FEUILLE_HYP, FEUILLE_SENSI, LIGNE_HYP, LIGNE_SURFACE, LIGNES_BILAN,
} from './bilanExcel.ts';
import { construireClasseurRapport } from './rapportExcel.ts';
import { construireWordRapport } from './rapportWord.ts';
import { construirePdfRapport } from './rapportPdf.ts';
import { textePdf, proprietaireTexte } from './rapportTexte.ts';
// Moteur de mission (Deno, sans dépendance) : même calcul que l'onglet Bilan.
import { calculerChargeFonciere, hypothesesVides } from '../../../../../supabase/functions/copilot-chat/agent/rapport.ts';

// ── Jeux de données fictifs ──────────────────────────────────────────────────
const MISSION = { objectif: 'Trouver 2 terrains à Villefictive', type: 'prospection_fonciere', cree_le: '2026-10-30T12:00:00Z', termine_le: '2026-10-30T12:40:00Z', criteres: { communes: ['Villefictive'] } };

const RAPPORT_V1 = {
  titre: 'Prospection Villefictive',
  synthese: 'Le marché dvf affiche une médiane de 5 000 €/m² (120 ventes). Coûts estimés à 2 000 €/m² SDP HT pour 3 000 m² SDP et 2 600 m² SHAB vendables. Charge foncière pour une marge cible de 10 % du CA.',
  terrains: [
    { idu: '99999000AB0001', commune: 'Villefictive', adresse: 'Rue A', zonage: 'UA1 — Zone centrale (PLUi…', verdict: 'prioritaire', surface_m2: 2000, potentiel_logements: 35, charge_fonciere_admissible: 4000000,
      points_forts: ['Propriétaire personne morale identifié : SCI EXEMPLE (SCI) — approchable'], points_bloquants: [], sources: ['dvf'] },
    { idu: '99999000AB0002', commune: 'Villefictive', zonage: 'UB2 — Zone mixte', verdict: 'a_etudier', surface_m2: 2500, potentiel_logements: 35, charge_fonciere_admissible: 4000000,
      points_forts: [], points_bloquants: ['Propriétaire NON identifié en base : particulier probable — via notaire'], sources: [] },
  ],
  limites: ['Étude indicative.'], jetons_consommes: 40, memoire_ajoutee: 0, actions_proposees: [],
};

const HC = {
  programme: { nb_logements: 30, shab_m2: 2000, sdp_m2: 2400, gabarit: 'R+4' },
  prix_vente_libre_eur_m2_shab: 5000, source_prix: 'get_etude_marche (DVF)',
  part_lls_pct: 25, prix_cession_lls_eur_m2_shab: 2500,
  cout_travaux_eur_m2_sdp: 2000, source_couts: 'get_couts_construction',
  honoraires_pct_travaux: 12, aleas_pct_travaux: 5, commercialisation_pct_ca: 4,
  frais_financiers_pct_ca: 2, frais_acquisition_pct_foncier: 8,
  taxes_urbanisme_eur: 300000, vrd_eur: null, demolition_eur: 0, marge_cible_pct_ca: 10,
};
const RAPPORT_V2 = {
  version: 2, titre: 'Prospection v2', synthese: 'Deux terrains.', hypotheses_communes: HC,
  terrains: [
    { rang: 2, idu: '99999000CD0002', commune: 'Villefictive', surface_m2: 1800, verdict: 'a_etudier', verdict_libelle: 'À étudier',
      proprietaire: null, contraintes: [{ type: 'argiles', libelle: 'Aléa fort', source: 'georisques' }],
      bilan: { hypotheses_specifiques: { demolition_eur: 150000, part_lls_pct: null, justification: 'Bâti à démolir' }, statut: 'partiel', manques: ['VRD (€) — non compté'], source: 'calculer_charge_fonciere', charge_fonciere_admissible_ht: 1234567, detail: { travaux_ht: 4800000 } } },
    { rang: 1, idu: '99999000CD0001', commune: 'Villefictive', surface_m2: 2200, verdict: 'prioritaire', verdict_libelle: 'Prioritaire', score: 91.5,
      proprietaire: { nom: 'SAS DEMO', forme: 'SAS', siren: '123456789', source: 'DGFiP' }, contraintes: [], bilan: null },
  ],
  classement: [{ rang: 1, idu: '99999000CD0001', justification: 'Meilleur zonage' }, { rang: 2, idu: '99999000CD0002', justification: 'Démolition' }],
  contacts: [{ qualite: 'mairie', nom: 'Service urbanisme', telephone: '01 00 00 00 00', email: 'urba@example.fr', adresse: null, source: 'annuaire' }],
  limites: [], jetons_consommes: 60,
};
const v1 = () => construireModeleRapport(MISSION, RAPPORT_V1)!;
const v2 = () => construireModeleRapport(MISSION, RAPPORT_V2)!;

// ── Modèle ───────────────────────────────────────────────────────────────────
test('v1 : verdicts lisibles, sigles en capitales, hypothèses reprises du texte et signalées', () => {
  const m = v1();
  assert.equal(m.version, 1);
  assert.deepEqual(m.terrains.map((t) => t.verdict), ['Prioritaire', 'À étudier']);
  assert.match(m.synthese.join(' '), /marché DVF/);
  assert.equal(m.hypotheses.prix_vente_libre_eur_m2_shab.valeur, 5000);
  assert.equal(m.hypotheses.cout_travaux_eur_m2_sdp.valeur, 2000);
  assert.equal(m.hypotheses.sdp_m2.valeur, 3000);
  assert.equal(m.hypotheses.shab_m2.valeur, 2600);
  assert.equal(m.hypotheses.marge_cible_pct_ca.valeur, 0.1);
  assert.equal(m.hypotheses.honoraires_pct_travaux.valeur, null, 'jamais inventé');
  assert.equal(m.hypotheses.nb_logements.valeur, 35);
  assert.equal(m.hypothesesDepuisTexte, true);
  assert.match(m.hypotheses.prix_vente_libre_eur_m2_shab.source!, /à vérifier/);
  assert.ok(m.noteBilanIdentique, 'même charge foncière partout : dit honnêtement');
  assert.equal(m.terrains[0].charge_fonciere_m2, 2000);
  assert.equal(m.terrains[0].cfM2Calculee, true);
  assert.equal(proprietaireTexte(m.terrains[0]), 'SCI EXEMPLE (SCI)');
  assert.match(proprietaireTexte(m.terrains[1]), /^Non identifié/);
  assert.deepEqual([m.terrains[0].zonageCode, m.terrains[0].zonageLibelle], ['UA1', 'Zone centrale (PLUi…']);
  assert.equal(nomFichierRapport(m, 'pdf'), 'Mimmoza_Prospection_Villefictive_2026-10-30.pdf');
  assert.equal(nomFichierRapport(m, 'xlsx', true), 'Mimmoza_Bilan_Villefictive_2026-10-30.xlsx');
});

test('v2 : pourcentages en fraction, tri par rang, valeur propre à null = inconnue pour ce terrain', () => {
  const m = v2();
  assert.equal(m.version, 2);
  assert.equal(m.hypotheses.part_lls_pct.valeur, 0.25);
  assert.equal(m.hypotheses.marge_cible_pct_ca.valeur, 0.1);
  assert.equal(m.hypotheses.vrd_eur.valeur, null);
  assert.equal(m.gabarit, 'R+4');
  assert.deepEqual(m.terrains.map((t) => t.idu), ['99999000CD0001', '99999000CD0002']);
  const t2 = m.terrains[1];
  assert.equal(t2.verdict, 'À étudier');
  assert.equal(t2.contraintes[0].type, 'Argiles (retrait-gonflement)');
  assert.equal(t2.bilan?.justification, 'Bâti à démolir');
  const h = hypothesesTerrain(m, t2);
  assert.equal(h.demolition_eur.valeur, 150000);
  assert.equal(h.part_lls_pct.valeur, null);
  assert.equal(h.prix_vente_libre_eur_m2_shab.valeur, 5000);
  assert.equal(m.terrains[0].charge_fonciere, null, 'bilan v2 absent → pas de chiffre');
  assert.equal(proprietaireTexte(m.terrains[0]), 'SAS DEMO (SAS, SIREN 123456789)');
  assert.equal(m.contacts[0].email, 'urba@example.fr');
  assert.equal(m.classement[0].justification, 'Meilleur zonage');
  assert.equal(m.noteBilanIdentique, null);
});

test('petits utilitaires', () => {
  assert.equal(libelleVerdict('a_etudier'), 'À étudier');
  assert.equal(libelleVerdict('ecarte'), 'Écarté');
  assert.equal(libelleVerdict('a_negocier'), 'A negocier');
  assert.equal(lisible('source dvf et plu, sru'), 'source DVF et PLU, SRU');
  assert.equal(pctVersFraction(8), 0.08);
  assert.equal(pctVersFraction(null), null);
  assert.equal(textePdf('≈ 1 550 € − 3 → ok'), '~ 1 550 € - 3 -> ok');
  assert.equal(Object.keys(extraireHypothesesV1('rien de chiffré')).length, 0);
});

// ── Calcul : identique au moteur ─────────────────────────────────────────────
function scenario(modif: Record<string, unknown> = {}) {
  const pct = { ...HC, ...modif } as typeof HC;
  const moteur = { ...hypothesesVides(), ...pct, programme: { ...hypothesesVides().programme, ...pct.programme } };
  const e = {
    nb_logements: pct.programme.nb_logements, shab_m2: pct.programme.shab_m2, sdp_m2: pct.programme.sdp_m2,
    prix_vente_libre_eur_m2_shab: pct.prix_vente_libre_eur_m2_shab, part_lls_pct: pctVersFraction(pct.part_lls_pct as number | null),
    prix_cession_lls_eur_m2_shab: pct.prix_cession_lls_eur_m2_shab, cout_travaux_eur_m2_sdp: pct.cout_travaux_eur_m2_sdp,
    honoraires_pct_travaux: pctVersFraction(pct.honoraires_pct_travaux), aleas_pct_travaux: pctVersFraction(pct.aleas_pct_travaux),
    demolition_eur: pct.demolition_eur, vrd_eur: pct.vrd_eur, taxes_urbanisme_eur: pct.taxes_urbanisme_eur,
    commercialisation_pct_ca: pctVersFraction(pct.commercialisation_pct_ca), frais_financiers_pct_ca: pctVersFraction(pct.frais_financiers_pct_ca),
    frais_acquisition_pct_foncier: pctVersFraction(pct.frais_acquisition_pct_foncier), marge_cible_pct_ca: pctVersFraction(pct.marge_cible_pct_ca),
    surface_terrain_m2: 2000, prix_negocie_eur: null,
  } as EntreesBilan;
  return { js: calculerBilan(e), moteur: calculerChargeFonciere(moteur as never, {}, 2000), e };
}

test('cohérence avec le moteur : même charge foncière (arrondie) sur plusieurs jeux', () => {
  for (const modif of [{}, { part_lls_pct: null }, { taxes_urbanisme_eur: null, demolition_eur: null }, { part_lls_pct: 0 }, { honoraires_pct_travaux: null }, { prix_cession_lls_eur_m2_shab: null }]) {
    const { js, moteur } = scenario(modif);
    const cf = js.chargeFonciere == null ? null : Math.round(js.chargeFonciere);
    assert.equal(cf, moteur.charge_fonciere_admissible_ht, JSON.stringify(modif));
    if (moteur.ca_ht != null) assert.equal(Math.round(js.ca!), moteur.ca_ht);
    assert.equal(js.etat === 'incomplet', moteur.charge_fonciere_admissible_ht == null, `état ${JSON.stringify(modif)}`);
  }
});

test('calcul de contrôle à la main (jeu complet)', () => {
  const { js } = scenario();
  // CA = 2000×0,75×5000 + 2000×0,25×2500 = 7 500 000 + 1 250 000
  assert.equal(js.ca, 8_750_000);
  // Coûts = 2 400 × 2 000 × 1,17 + 0 + 300 000 + 8 750 000 × 0,06 (VRD non chiffré → 0, signalé)
  assert.equal(Math.round(js.coutsHorsFoncier!), 6_441_000);
  // CF = (8 750 000 × 0,9 − 6 441 000) / 1,08 = 1 327 777,78
  assert.equal(Math.round(js.chargeFonciere!), 1_327_778);
  assert.equal(js.etat, 'partiel');
  assert.equal(libelleEtatBilan(js), 'Bilan partiel : 1 poste(s) non chiffré(s), comptés à 0');
  const sansHon = scenario({ honoraires_pct_travaux: null }).js;
  assert.equal(sansHon.chargeFonciere, null);
  assert.equal(sansHon.etat, 'incomplet');
  assert.equal(Math.round(chargeFonciereSensibilite(scenario().e, 0, 0)!), Math.round(js.chargeFonciere!));
  assert.ok(chargeFonciereSensibilite(scenario().e, 0.1, 0)! > js.chargeFonciere!);
});

// ── Excel ────────────────────────────────────────────────────────────────────
const formuleDe = (c: ExcelJS.Cell) => (c.value && typeof c.value === 'object' && 'formula' in c.value ? (c.value as ExcelJS.CellFormulaValue).formula : null);

test('bilan Excel : vraies formules, cellules vides « à renseigner », recalcul à l’ouverture', async () => {
  const m: ModeleRapport = v1();
  const wb = construireClasseurBilan(m);
  assert.equal(wb.calcProperties.fullCalcOnLoad, true);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Hypothèses', 'Bilan', 'Sensibilité', 'Sources & limites']);
  const h = wb.getWorksheet(FEUILLE_HYP)!, b = wb.getWorksheet(FEUILLE_BILAN)!, s = wb.getWorksheet(FEUILLE_SENSI)!;
  assert.equal(h.getCell(`D${LIGNE_SURFACE}`).value, 2000);
  assert.equal(h.getCell(`C${LIGNE_HYP.prix_vente_libre_eur_m2_shab}`).value, 5000);
  assert.ok(String(h.getCell(`C${LIGNE_HYP.prix_vente_libre_eur_m2_shab}`).note).includes('à vérifier'));
  assert.equal(h.getCell(`C${LIGNE_HYP.honoraires_pct_travaux}`).value, null, 'inconnu = vide');
  assert.equal(formuleDe(h.getCell(`D${LIGNE_HYP.prix_vente_libre_eur_m2_shab}`)), `IF($C${LIGNE_HYP.prix_vente_libre_eur_m2_shab}="","",$C${LIGNE_HYP.prix_vente_libre_eur_m2_shab})`);
  // Toutes les lignes calculées du Bilan sont des formules (pas de valeurs figées).
  for (const [k, ligne] of Object.entries(LIGNES_BILAN)) {
    if (k.startsWith('titre') || k === 'cfRapport') continue;
    for (const col of ['D', 'E']) assert.ok(formuleDe(b.getCell(`${col}${ligne}`)), `${k} ${col}`);
  }
  assert.equal(formuleDe(b.getCell(`D${LIGNES_BILAN.chargeFonciere}`)), formulesBilan('D').chargeFonciere);
  assert.match(formulesBilan('D').chargeFonciere, /\(D12\*\(1-'Hypothèses'!D21\)-D23\)\/\(1\+'Hypothèses'!D20\)/);
  assert.match(formulesBilan('E').postes, /COUNTBLANK\('Hypothèses'!E7\)/);
  assert.equal(b.getCell(`D${LIGNES_BILAN.cfRapport}`).value, 4000000);
  assert.match(String((b.getCell(`D${LIGNES_BILAN.etat}`).value as ExcelJS.CellFormulaValue).result), /Bilan incomplet/);
  assert.equal(formuleDe(s.getCell('C5')), formuleSensibilite('$B5', 'C$4'));
  // Le fichier s'écrit et se relit avec ses formules.
  const relu = new ExcelJS.Workbook();
  await relu.xlsx.load(await wb.xlsx.writeBuffer());
  assert.equal(formuleDe(relu.getWorksheet(FEUILLE_BILAN)!.getCell(`E${LIGNES_BILAN.chargeFonciere}`)), formulesBilan('E').chargeFonciere);
});

test('bilan Excel v2 : valeurs en cache = calcul JS, valeur propre au terrain écrite en dur', () => {
  const m = v2();
  const wb = construireClasseurBilan(m);
  const h = wb.getWorksheet(FEUILLE_HYP)!, b = wb.getWorksheet(FEUILLE_BILAN)!;
  assert.equal(h.getCell(`C${LIGNE_HYP.part_lls_pct}`).value, 0.25);
  assert.equal(h.getCell(`C${LIGNE_HYP.part_lls_pct}`).numFmt, '0.0%');
  assert.equal(h.getCell(`E${LIGNE_HYP.demolition_eur}`).value, 150000);
  assert.equal(h.getCell(`E${LIGNE_HYP.part_lls_pct}`).value, null);
  const attendu = calculerBilan(entreesDepuisJeu(hypothesesTerrain(m, m.terrains[0]), 2200)).chargeFonciere!;
  assert.equal((b.getCell(`D${LIGNES_BILAN.chargeFonciere}`).value as ExcelJS.CellFormulaValue).result, attendu);
  assert.equal((b.getCell(`D${LIGNES_BILAN.vrd}`).value as ExcelJS.CellFormulaValue).result, 'non chiffré');
});

test('Excel du rapport : onglets du rapport puis du bilan', () => {
  const wb = construireClasseurRapport(v2());
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Rapport', 'Comparatif', 'Fiches terrains', 'Contacts', 'Hypothèses', 'Bilan', 'Sensibilité', 'Sources & limites']);
  const c = wb.getWorksheet('Comparatif')!;
  assert.equal(c.getCell('B2').value, '99999000CD0001');
  assert.equal(c.getCell('I2').value, 'Prioritaire');
});

// ── Word et PDF ──────────────────────────────────────────────────────────────
test('Word : page de garde, verdicts lisibles et avertissement', async () => {
  const zip = await JSZip.loadAsync(await Packer.toBuffer(construireWordRapport(v1())));
  const xml = await zip.file('word/document.xml')!.async('string');
  for (const attendu of ['Prospection Villefictive', 'Tableau comparatif', 'À étudier', 'Prioritaire', 'faire valider par un professionnel', 'Hypothèses du bilan', 'à renseigner']) {
    assert.ok(xml.includes(attendu), attendu);
  }
  assert.ok(!xml.includes('a_etudier'));
});

test('PDF : document multipage généré sans navigateur', () => {
  const doc = construirePdfRapport(v2());
  assert.ok(doc.getNumberOfPages() >= 4);
  const octets = new Uint8Array(doc.output('arraybuffer'));
  assert.equal(String.fromCharCode(...octets.slice(0, 5)), '%PDF-');
});
