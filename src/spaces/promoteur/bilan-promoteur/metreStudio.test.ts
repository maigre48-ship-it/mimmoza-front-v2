import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CANAL_METRE, calculerSyntheseBilan, cleMetreEtude, ecartProgrammationModele, lireMetreV2, logementsDuMassing,
  metreConcerneEtude, metreVersMassing, plusRecent, resoudreSurfaces, type MetreStudioV2,
} from './metreStudio.ts';
import { ecouterMetreStudio, lireMetrePersistant, publierResumeBilan } from './canalMetreStudio.ts';

const v = (valeur: number, source: 'mesure' | 'estime' | 'saisi' = 'mesure') => ({ valeur, source });

/** Métré v2 de forme identique à celui de Studio (src/core/bim/metreV2.ts). */
export function fixtureMetre(niveauxHorsSol = 5, etudeId: string | null = 'etude-1'): MetreStudioV2 {
  const emprise = 420, sdp = emprise * niveauxHorsSol, logements = Math.floor(sdp * 0.75 * 0.92 / 62);
  const typo = { T1: Math.round(logements * 0.1), T2: Math.round(logements * 0.35), T3: Math.round(logements * 0.35), T4: Math.round(logements * 0.15), T5: 0 };
  typo.T5 = logements - typo.T1 - typo.T2 - typo.T3 - typo.T4;
  const bat = {
    id: 'b1', nom: 'Collectif', niveaux: v(niveauxHorsSol), niveauxHorsSol: v(niveauxHorsSol), sousSols: v(0), hauteurM: v(niveauxHorsSol * 3),
    empriseSolM2: v(emprise), sdpM2: v(sdp), surfaceUtileM2: v(sdp * 0.75, 'estime'), surfaceHabitableM2: v(sdp * 0.69, 'estime'),
    logements: v(logements, 'estime'), typologie: { valeurs: typo, source: 'estime' as const },
    stationnement: v(0), commerceM2: v(0, 'saisi'), bureauxM2: v(0, 'saisi'),
    facadeM2: v(88 * 3 * niveauxHorsSol), facadeNetteM2: v(88 * 3 * niveauxHorsSol * 0.8), typeToiture: 'terrasse' as const,
    toitureM2: v(emprise), balconsM2: v(0), menuiseries: v(20 * niveauxHorsSol),
  };
  return {
    format: 'mimmoza-metre', version: 2, etudeId, projetMimmozaId: null, architectureId: 'arch-1', nom: 'Projet',
    revision: niveauxHorsSol, empreinte: (0x1000000 + niveauxHorsSol).toString(16).padStart(8, '0'), emisLe: new Date(2026, 9, 16, 10, niveauxHorsSol).toISOString(),
    parcelleM2: v(1200), batiments: [bat],
    totaux: {
      nbBatiments: 1, niveauxMax: v(niveauxHorsSol), empriseSolM2: v(emprise), ces: v(emprise / 1200), sdpM2: v(sdp),
      surfaceHabitableM2: v(sdp * 0.69, 'estime'), logements: v(logements, 'estime'), typologie: { valeurs: typo, source: 'estime' },
      stationnement: v(0), commerceM2: v(0, 'saisi'), bureauxM2: v(0, 'saisi'), facadeM2: bat.facadeM2, facadeNetteM2: bat.facadeNetteM2,
      toitureTerrasseM2: v(emprise), toiturePenteM2: v(0), balconsM2: v(0), menuiseries: bat.menuiseries,
    },
    quartier: null,
  };
}

const ASS = {
  salePriceEurM2Hab: 5200, commercialisationPct: 100, coefVendable: 1, landPriceEur: 900000, notaryFeesPct: 7.5, acquisitionTaxesPct: 0,
  worksCostEurM2Sdp: 1850, vrdPct: 6, extPct: 3, contingencyPct: 3, surveyorEur: 6000, geotechEur: 12000, moePct: 10, betPct: 3,
  spsCtOpcEur: 15000, insuranceDoPct: 2, miscEur: 8000, marketingPctCa: 2, marketingFixedEur: 0, financingRatePct: 4, financingFeesEur: 8000,
  taxeAmenagementEurM2Sdp: 120, terrassementEur: 0, structureCostEurM2Sdp: 1100, facadeCostEurM2: 180, roofTerrasseCostEurM2: 180,
  roofPenteCostEurM2: 220, balconyCostEurM2: 600, windowUnitCostEur: 650, foundationCostEurM2Emprise: 290, soilType: 'normal',
  parkingType: 'surface', parkingCostPerPlace: 3000, autoCosts: true, travauxRehabTotal: 0, rehabMode: false, surfaceRehabM2: 0,
  targetMarginPct: 18, nbAscenseurs: 1, ascenseurBaseCostEur: 60000, nbSousSols: 0, surfaceSousSolM2: 0, coutSousSolEurM2: 1100,
  dureeAcquisitionMois: 3, dureePermisMois: 6, dureePurgeMois: 3, dureeTravauxMois: 18, dureeCommercialisationMois: 24, margeSecuriteFoncierPct: 15,
} as const;

test('valide le métré v2 et rejette les messages malformés', () => {
  const m = fixtureMetre();
  assert.equal(lireMetreV2(JSON.parse(JSON.stringify(m)))?.empreinte, m.empreinte);
  assert.equal(lireMetreV2({ ...m, version: 1 }), null);
  assert.equal(lireMetreV2({ ...m, empreinte: 'zz' }), null);
  assert.equal(lireMetreV2({ ...m, batiments: [{ ...m.batiments[0], sdpM2: { valeur: Infinity, source: 'mesure' } }] }), null);
  assert.equal(lireMetreV2({ ...m, batiments: [{ ...m.batiments[0], sdpM2: { valeur: 10, source: 'invente' } }] }), null);
  assert.equal(lireMetreV2('{}'), null);
});

test('projette le métré en MassingMetrics (niveaux hors sol, logements, typologie T1..T5, CES)', () => {
  const m = fixtureMetre(6);
  const mm = metreVersMassing(m);
  assert.equal(mm.totaux.sdpM2, 420 * 6);
  assert.equal(mm.parBatiment[0]!.niveaux, 6);
  assert.equal(logementsDuMassing(mm), m.totaux.logements.valeur);
  assert.ok(m.totaux.logements.valeur > 0, 'les logements ne sont plus à 0');
  assert.equal(mm.ratios.cesEmprise, 420 / 1200);
});

test('le modèle fait foi ; la programmation sert de défaut avant le modèle', () => {
  const base = { rehabMode: false, surfaceRehabM2: 0, sdpProgrammeM2: 1500, footprintBuildingsM2Raw: 0, footprintBuildingsM2: 0, sdpFromSnap: 0, niveauxSaisis: 2, logementsProgramme: 20, logementsSaisis: 1 };
  const sans = resoudreSurfaces({ ...base, massing: null });
  assert.deepEqual([sans.sdpSource, sans.sdpM2, sans.logements, sans.logementsSource, sans.levelsCount], ['programmation', 1500, 20, 'programmation', 2]);
  const mm = metreVersMassing(fixtureMetre(5));
  const avec = resoudreSurfaces({ ...base, massing: mm });
  assert.deepEqual([avec.sdpSource, avec.sdpM2, avec.logementsSource, avec.levelsCount, avec.niveauxSource], ['massing', 2100, 'modele', 5, 'modele']);
  const rehab = resoudreSurfaces({ ...base, massing: mm, rehabMode: true, surfaceRehabM2: 800 });
  assert.equal(rehab.sdpSource, 'rehab');
});

test('signale un écart notable sans rien écraser', () => {
  const e = ecartProgrammationModele({ sdpProgrammeM2: 1500, logementsProgramme: 20 }, { sdpModeleM2: 2100, logementsModele: 26 });
  assert.equal(e.notable, true);
  assert.equal(e.lignes.length, 2);
  assert.equal(ecartProgrammationModele({ sdpProgrammeM2: 2000, logementsProgramme: 26 }, { sdpModeleM2: 2100, logementsModele: 26 }).notable, false);
});

test('recalcul : +1 niveau dans le modèle change CA, coûts et marge (moteur computeProForma)', () => {
  const calc = (niv: number) => {
    const mm = metreVersMassing(fixtureMetre(niv));
    const s = resoudreSurfaces({ rehabMode: false, surfaceRehabM2: 0, sdpProgrammeM2: 1500, massing: mm, footprintBuildingsM2Raw: 0, footprintBuildingsM2: 0, sdpFromSnap: 0, niveauxSaisis: 1, logementsProgramme: 20, logementsSaisis: 1 });
    return calculerSyntheseBilan({ ass: ASS as never, sdpM2: s.sdpM2, surfaceVendableM2: s.sdpM2 * 0.82, massing: mm, regionFactor: 1, levelsCount: s.levelsCount, parkingCost: 0 });
  };
  const a = calc(5), b = calc(6);
  assert.ok(b.pf.caTotal > a.pf.caTotal);
  assert.ok(b.coutTotal > a.coutTotal);
  assert.notEqual(Math.round(b.marge), Math.round(a.marge));
  assert.ok(Math.abs(a.marge - (a.pf.caTotal - a.coutTotal)) < 1e-6);
});

test('filtre étude / liaison et ordre des métrés', () => {
  const m = fixtureMetre(5, null);
  assert.equal(metreConcerneEtude(m, 'etude-1', null), false);
  assert.equal(metreConcerneEtude(m, 'etude-1', { projectId: 'arch-1', studyId: 'etude-1' }), true);
  assert.equal(metreConcerneEtude(fixtureMetre(5, 'etude-2'), 'etude-1', { projectId: 'arch-1', studyId: 'etude-1' }), false);
  assert.equal(plusRecent(fixtureMetre(6), fixtureMetre(5)), true);
});

test('canal même origine : BroadcastChannel réel, rattrapage par « demande » et stockage persistant', async () => {
  const data = new Map<string, string>();
  const stockage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, val: string) => { data.set(k, val); } };
  data.set(cleMetreEtude('etude-1'), JSON.stringify(fixtureMetre(4)));
  assert.equal(lireMetrePersistant('etude-1', stockage).etude?.revision, 4);

  const studio = new BroadcastChannel(CANAL_METRE);
  const demandes: unknown[] = [];
  studio.onmessage = (e) => { if ((e.data as { type?: string }).type === 'demande') demandes.push(e.data); };
  const bilan = new BroadcastChannel(CANAL_METRE);
  const recus: MetreStudioV2[] = [];
  const stop = ecouterMetreStudio('etude-1', (m) => recus.push(m), { canal: bilan as never, stockage, fenetre: null });
  const t0 = Date.now();
  studio.postMessage({ canal: CANAL_METRE, type: 'metre', metre: fixtureMetre(6) });
  studio.postMessage({ canal: 'autre', type: 'metre', metre: fixtureMetre(7) });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(recus.length, 1);
  assert.equal(recus[0]!.totaux.niveauxMax.valeur, 6);
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(demandes.length, 1);
  publierResumeBilan({ format: 'mimmoza-bilan-resume', version: 1, etudeId: 'etude-1', architectureId: 'arch-1', empreinteMetre: 'x', sourceSurfaces: 'modele-studio', caTotal: 1, coutTotal: 1, marge: 0, margePct: 0, sdpM2: 1, logements: 1, calculeLe: new Date().toISOString(), urlBilan: '/promoteur/bilan-promoteur?study=etude-1' }, { canal: null, stockage, fenetre: null });
  assert.ok(data.get('mimmoza.bilan.resume.v1.etude-1'));
  stop();
  studio.close();
});
