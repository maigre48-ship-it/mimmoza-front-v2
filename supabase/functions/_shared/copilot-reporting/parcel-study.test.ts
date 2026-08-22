import assert from 'node:assert/strict';
import test from 'node:test';
import { renderParcelStudyReport } from './parcel-study.ts';

const forbidden = ['très probable', 'proximité immédiate', 'marché actif', 'demande soutenue', 'risques élevés', 'avenue structurante', 'rendement', 'dispersion', 'seul document opposable', 'seul moyen'];

function fixture(overrides: Record<string, unknown> = {}) {
  return { status: 'ok', data: {
    ancrage: { anchor_type: 'coordinate_point', cadastral_resolved: false },
    parcelle: { idu: null, commune: 'Bayonne', code_insee: '64102', lat: 43.49, lon: -1.47 },
    evidences: [
      { id: 'surface_cadastrale', label: 'Surface cadastrale', value: null, status: 'unavailable', scope: 'parcel', source: 'DGFiP', confidence: 0, warning: 'Contenance absente.' },
      { id: 'pente', label: 'Pente', value: 2.4, unit: '%', status: 'confirmed', scope: 'point', source: 'IGN', sourceDate: '2026', confidence: 80, warning: 'Mesure ponctuelle.' },
      { id: 'reglement_plu', label: 'Règlement PLU opposable', value: null, status: 'unavailable', scope: 'parcel', source: 'Non collecté', confidence: 0, warning: 'Vérification requise.' },
      { id: 'risque_inondation', label: "Risque d'inondation", value: { zone_inondable: true, ppri: false }, status: 'confirmed', scope: 'municipality', source: 'Géorisques', confidence: 65, warning: "Signal d'inondation fourni à l'échelle communale. Il ne prouve pas que l'adresse ou la parcelle est exposée. Les règles d'un PPRI ne peuvent être appliquées au terrain qu'après vérification de son intersection avec le zonage réglementaire opposable." },
      { id: 'risque_ppr', label: 'Plans de prévention des risques (PPR)', value: 0, status: 'confirmed', scope: 'municipality', source: 'Géorisques', confidence: 65, warning: "Aucun PPR n'est recensé dans cette réponse de la source. Ce résultat ne prouve pas l'absence de PPR applicable : vérifier les documents officiels." },
      { id: 'assainissement', label: 'Assainissement', value: { mode: 'collectif', operateur: 'Agglomération' }, status: 'confirmed', scope: 'municipality', source: 'SISPEA', confidence: 60 },
      { id: 'fiscalite_tfb', label: 'Taux de taxe foncière sur le bâti', value: null, unit: '%', status: 'unavailable', scope: 'municipality', source: 'DGFiP', confidence: 0, warning: 'Valeur absente.' },
      { id: 'potentiel_solaire', label: 'Potentiel solaire', value: null, unit: 'kWh/m²/an', status: 'unavailable', scope: 'point', source: 'PVGIS', confidence: 0, warning: 'Valeur absente.' },
      { id: 'zonage_abc', label: 'Zonage ABC', value: 'B1', status: 'confirmed', scope: 'municipality', source: 'Ministère', sourceDate: '2025', confidence: 70 },
      { id: 'dvf_prix_m2', label: 'Prix au m²', value: { prix_m2_median_source: 4200, dispersion_pct: 77 }, unit: '€/m²', status: 'estimated', scope: 'nearby', source: 'DVF', confidence: 30 },
    ],
    verdict: { potentiel: { niveau: 'intermediaire' }, risque: { niveau: 'indetermine', scope: 'municipality', niveau_decisionnel: 'indetermine', indicateurs_communaux: ['inondation'] }, fiabilite: { score: 46 }, recommandation: { valeur: 'suspendre', motif: "Le niveau de risque à la parcelle n'a pas pu être établi : les signaux disponibles sont communaux." }, constructibilite: { statut: 'indeterminable' } },
    plan_action: [{ action: 'Consulter le règlement PLU opposable', motif: 'PLU absent.' }],
    sources_indisponibles: [{ cle: 'bruit', motif: 'timeout' }], avertissements: ['Parcelle cadastrale non résolue.'], ...overrides,
  }};
}

test('rend une adresse ponctuelle non résolue sans extrapolation', () => {
  const report = renderParcelStudyReport(fixture());
  assert.ok(report); assert.match(report, /coordinate_point/);
  assert.match(report, /Parcelle cadastrale résolue\*\* : non/);
  assert.match(report, /Constructibilité\*\* : indéterminable/);
  assert.match(report, /bruit : timeout/);
  assert.match(report, /Risque — niveau attribué par le moteur\*\* : indetermine/);
  assert.match(report, /Portée du verdict de risque\*\* : municipality/);
  assert.match(report, /PPRI déclaré par la source : non ; signal communal d’inondation : oui/);
  assert.match(report, /gestionnaire/i);
  assert.doesNotMatch(report, /operateur:/i);
  assert.doesNotMatch(report, /non disponible %/i);
  assert.doesNotMatch(report, /non disponible kWh/i);
  assert.match(report, /Données ou preuves indisponibles/);
  assert.match(report, /Taux de taxe foncière sur le bâti : Valeur absente/);
  assert.match(report, /Services techniques indisponibles/);
  assert.doesNotMatch(report, /Contrainte potentiellement bloquante/i);
  assert.doesNotMatch(report, /DGFiP :.*indisponible/i);
  for (const phrase of forbidden) assert.ok(!report.toLowerCase().includes(phrase), phrase);
});

test('rend une parcelle cadastrale résolue', () => {
  const report = renderParcelStudyReport(fixture({ ancrage: { anchor_type: 'cadastral_parcel', cadastral_resolved: true }, parcelle: { idu: '64102000AB0123', commune: 'Bayonne', code_insee: '64102', surface_m2: 850 } }));
  assert.ok(report); assert.match(report, /cadastral_parcel/);
  assert.match(report, /Parcelle cadastrale résolue\*\* : oui/); assert.match(report, /64102000AB0123/);
});

test('reste robuste avec des données partielles et rejette un contrat invalide', () => {
  const report = renderParcelStudyReport(fixture({ plan_action: [], sources_indisponibles: [], avertissements: [] }));
  assert.ok(report); assert.match(report, /Aucune défaillance technique signalée/);
  assert.match(report, /Première action du plan\*\* : non disponible/);
  assert.equal(renderParcelStudyReport({ status: 'error', data: {} }), null);
  assert.equal(renderParcelStudyReport({ status: 'ok', data: { evidences: [] } }), null);
});

test('neutralise un mot interdit dans un avertissement sans abandonner le rapport', () => {
  const base = fixture();
  const data = base.data;
  const evidences = [...data.evidences];
  evidences[1] = { ...evidences[1], warning: 'La dispersion observée ne doit pas être interprétée ici.' };
  const report = renderParcelStudyReport(fixture({ evidences }));
  assert.ok(report);
  assert.doesNotMatch(report, /dispersion/i);
  assert.match(report, /information non restituée/i);
});
