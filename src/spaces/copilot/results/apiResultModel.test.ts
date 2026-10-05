import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApiResult, formatApiValue, safeSourceUrl } from './apiResultModel';
import type { ActiveToolCall } from '../types/copilot.types';
const result = (name: string, data: unknown, status = 'ok', callStatus = 'success') => buildApiResult({ id: 'test', name, status: callStatus, output: { status, source: 'Source de test', data } })!;

test('des coordonnées et une zone textuelle ne fabriquent pas une parcelle ni une règle', () => {
  const sirene = result('get_etablissements_proches', {precision:'point',analyses:67});
  assert.match(sirene.scope!, /parcelle non confirmée/);
  const gpu = result('get_zonage_plu', {zone_principale:'SPR',zones:[]});
  assert.equal(gpu.metrics.find(m=>m.label==='Zone au point')?.value,'SPR');
  assert.match(gpu.notes.join(' '),/ne sont pas connues/);
  const parcel = result('get_parcelle_depuis_adresse',{adresse:{commune:'Bayonne'},parcelle:null},'partial');
  assert.match(parcel.notes.join(' '), /sans parcelle résolue/);
});

test('les compteurs de couverture ne sont jamais tracés comme des scores sur 100', () => {
  const m = result('get_etude_marche', { commune:{project_type_label:'Bureaux'}, scores:{demande:50, offre:65, global:68, demande_champs_mesures:0, demande_champs_attendus:2} });
  assert.equal(m.title, 'Étude de marché · Bureaux');
  assert.deepEqual(m.charts[0].items.map(i => i.value), [50,65,68]);
  assert.equal(m.metrics.find(v => v.label === 'Champs de demande mesurés')?.value, '0');
  assert.equal(m.metrics.find(v => v.label === 'Champs de demande attendus')?.value, '2');
  assert.match(m.notes.join(' '), /Aucun champ de demande mesuré/);
});

test('une valeur absente ne devient pas un zéro ; zéro et faux restent mesurés', () => {
  assert.equal(formatApiValue(null), 'Non renseigné');
  assert.equal(formatApiValue(0, '%'), '0 %');
  assert.equal(formatApiValue(false), 'Non');
  assert.equal(formatApiValue(Number.NaN), 'Non renseigné');
  const m = result('get_dpe_ademe', { stats: { total: 0, distribution_dpe: { A: 0, B: null, C: 2 } } });
  assert.equal(m.metrics[0].value, '0');
  assert.deepEqual(m.charts[0].items.map(({label, value}) => [label,value]), [['A',0],['C',2]]);
  assert.match(m.notes.join(' '), /pas la classe certifiée/);
});
test('distingue source indisponible, absence de résultat, résultat partiel et recherche', () => {
  assert.equal(result('get_servitudes', {}, 'empty', 'error').state, 'empty');
  assert.equal(result('get_servitudes', {}, 'partial', 'error').state, 'partial');
  assert.equal(result('get_servitudes', {}, 'not_configured').state, 'error');
  const failed = result('get_dvf_comparables', { stats: {price_median_eur_m2: 9000} }, 'error');
  assert.deepEqual(failed.metrics, []);
  assert.equal(result('get_servitudes', {}, 'ok', 'running').state, 'running');
});
test('quartiles DVF cohérents uniquement, sans confondre une médiane et une fourchette', () => {
  const m = result('get_dvf_comparables', { stats: {price_q1_eur_m2: 3000, price_median_eur_m2: 4000, price_q3_eur_m2: 5500}, comparables: Array.from({length:12},(_,i)=>({date:'2026-01-01',surface_m2:50,price_m2:4000,commune:`Commune ${i}`})) });
  assert.equal(m.range?.mid, 4000); assert.equal(m.tables[0].rows.length,8); assert.equal(m.tables[0].total,12);
  assert.equal(result('get_dvf_comparables', { stats: {price_q1_eur_m2: 5000,price_median_eur_m2:4000,price_q3_eur_m2:4500} }).range,undefined);
});
test('le PLU refuse une emprise au format ambigu, et une zone sans règles reste inconnue', () => {
  const m = result('get_parcel_plu', {zone_code:'UA',regles:{emprise_sol_max_ratio:0.4}});
  assert.equal(m.metrics.find(v=>v.label==='Emprise maximale')?.value,'40 %');
  assert.equal(result('get_parcel_plu', {regles:{emprise_sol_max_ratio:40}}).metrics.find(v=>v.label==='Emprise maximale')?.value,'Non renseigné');
  assert.match(result('get_zonage_plu', {zone_principale:{libelle:'UA'}}).notes.join(' '), /règles.*ne sont pas connues/);
});
test('le score de sécurité conserve son sens et ses données manquantes', () => {
  const m = result('get_risks_georisques', {scores_securite:{global:90},confiance:{criteres_mesures:4,criteres_total:9}});
  assert.equal(m.metrics[0].value,'90 /100'); assert.match(m.metrics[0].note!, /100 = sécurité élevée/);
  assert.equal(m.metrics[1].value,'4'); assert.equal(m.metrics[2].value,'9');
});
test('les unités solaire, budgets HT et taux fiscaux restent distincts', () => {
  const solar = result('get_potentiel_solaire', {stats:{production_specifique_kwh_kwc_an:1200},production_mensuelle:[{mois:'Jan',production_kwh_kwc:52}]});
  assert.match(solar.metrics[0].value,/kWh\/kWc\/an/); assert.equal(solar.charts[0].items[0].value,52);
  assert.match(result('get_couts_renovation',{stats:{total_bas:50000}}).metrics[0].value,/€ HT/);
  assert.match(result('get_taxes_locales',{stats:{taxe_fonciere_batie_pct:35}}).notes.join(' '),/pas le montant/);
});
test('le périmètre départemental ne devient pas un rayon local et millésime reste explicite', () => {
  const m=result('get_etude_marche',{commune:{commune_nom:'Ascain',radius_km:5,generated_at:'2026-10-05T12:00:00Z'},marche_dvf:{perimetre:'departement',perimetre_label:'Département 64',prix_m2_median:3200}});
  assert.match(m.scope!,/Département 64/); assert.doesNotMatch(m.scope!,/5 km/); assert.equal(m.dateLabel,'Date du résultat');
  const alt=result('get_altimetrie',{stats:{precision:'centre_commune',millesime:2025,altitude_m:30}});
  assert.match(alt.notes.join(' '),/pas sur une parcelle/); assert.equal(alt.dateLabel,'Millésime'); assert.equal(alt.date,'2025');
});
test('le dispositif fiscal bloqué ne présente aucun avantage acquis', () => {
  const m=result('get_dispositif_fiscal',{eligible:false,fiche:{libelle:'Test'},resultat:{avantageAnnuelEur:5000,constats:[{niveau:'bloquant',message:'Condition manquante'}]}});
  assert.equal(m.state,'partial'); assert.equal(m.metrics.some(v=>v.label.includes('Avantage')),false);
  assert.equal(m.tables[0].rows[0][1],'Condition manquante');
});
test('aucune URL exécutable ni HTML n’est interprété par les adaptations', () => {
  assert.equal(safeSourceUrl('javascript:alert(1)'),null); assert.equal(safeSourceUrl('data:text/html,<script>'),null);
  assert.equal(safeSourceUrl('https://example.fr/a'),'https://example.fr/a');
  assert.equal(formatApiValue('<img onerror=alert(1)>'),'<img onerror=alert(1)>');
  const m=result('get_operateurs_candidats',{candidats:[{nom:'Exemple',fiche_officielle:'javascript:alert(1)'},{nom:'Société',fiche_officielle:'https://annuaire-entreprises.data.gouv.fr/entreprise/123'}]});
  assert.deepEqual(m.tables[0].links,[null,'https://annuaire-entreprises.data.gouv.fr/entreprise/123']);
});
test('le contrat booléen historique fiscal est lisible malgré son ancien statut transport', () => {
  const m=buildApiResult({id:'f',name:'get_dispositif_fiscal',status:'error',output:{ok:true,source:'BOFiP',data:{eligible:true,fiche:{libelle:'Simulation'},resultat:{avantageAnnuelEur:1000}}}})!;
  assert.equal(m.state,'partial'); assert.match(m.metrics.find(v=>v.label.includes('première année'))!.value,/1.*000 €/);
});
test('contacts, risques PPR, bruit et annonces utilisent les champs du serveur', () => {
  assert.equal(result('get_contacts_mairies',{mairies:[{commune:'Ascain',maire:'Nom',email:'mairie@example.fr',telephone:'0123456789'}]}).tables[0].rows[0][2],'mairie@example.fr');
  assert.equal(result('get_ppr_detail',{ppr:[{nom_ppr:'PPRi',risques:['Inondation'],statut:'Approuvé'}]}).tables[0].rows[0][1],'Inondation');
  assert.equal(result('get_classement_sonore',{secteurs:[{libelle:'Route',categorie:2,largeur_secteur_m:250}]}).tables[0].rows[0][2],'250 m');
  assert.equal(result('recherche_biens',{count:1,biens:[{ville:'Ascain',prix:400000,surface:100,prix_m2:4000}]}).tables[0].rows[0][0],'Ascain');
});
test('un outil inconnu conserve sa carte existante', () => {
  assert.equal(buildApiResult({id:'x',name:'action_ouvrir_page',status:'success'} satisfies ActiveToolCall),null);
});
