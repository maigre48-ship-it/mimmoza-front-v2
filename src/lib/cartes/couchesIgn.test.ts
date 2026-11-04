import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ATTRIBUTION_IGN, COUCHE_CADASTRE_IGN, COUCHE_CADASTRE_IGN_URL, COUCHE_SATELLITE_IGN, FOND_PLAN_URL, FOND_SATELLITE_IGN_URL,
  PREFERENCES_PAR_DEFAUT, TILEMATRIXSET_IGN, ZOOM_MAX_CARTE_IGN, ZOOM_MAX_RECADRAGE, ZOOM_NATIF_MAX_CADASTRE,
  ZOOM_NATIF_MAX_PLAN, ZOOM_NATIF_MAX_SATELLITE, urlTuilesWmtsIgn,
} from './couchesIgn.ts';
import { FOND_PLAN_IGN_URL } from './fondPlanIgn.ts';

function parametres(url: string): URLSearchParams {
  // Les gabarits {z}/{x}/{y} restent littéraux : on les remplace pour parser.
  return new URL(url.replace('{z}', '17').replace('{y}', '47000').replace('{x}', '66000')).searchParams;
}

describe('couchesIgn — URL des tuiles WMTS Géoplateforme', () => {
  it('satellite : ORTHOIMAGERY.ORTHOPHOTOS, style normal, JPEG, PM', () => {
    assert.ok(FOND_SATELLITE_IGN_URL.startsWith('https://data.geopf.fr/wmts?'));
    const p = parametres(FOND_SATELLITE_IGN_URL);
    assert.equal(p.get('SERVICE'), 'WMTS');
    assert.equal(p.get('REQUEST'), 'GetTile');
    assert.equal(p.get('VERSION'), '1.0.0');
    assert.equal(p.get('LAYER'), 'ORTHOIMAGERY.ORTHOPHOTOS');
    assert.equal(p.get('STYLE'), 'normal');
    assert.equal(p.get('FORMAT'), 'image/jpeg');
    assert.equal(p.get('TILEMATRIXSET'), 'PM');
    assert.equal(p.get('TILEMATRIX'), '17');
    assert.equal(p.get('TILEROW'), '47000');
    assert.equal(p.get('TILECOL'), '66000');
  });

  it('cadastre : PARCELLAIRE_EXPRESS, style « PCI vecteur » encodé PCI%20vecteur, PNG', () => {
    assert.ok(COUCHE_CADASTRE_IGN_URL.includes('&STYLE=PCI%20vecteur&'));
    const p = parametres(COUCHE_CADASTRE_IGN_URL);
    assert.equal(p.get('LAYER'), 'CADASTRALPARCELS.PARCELLAIRE_EXPRESS');
    assert.equal(p.get('STYLE'), 'PCI vecteur');
    assert.equal(p.get('FORMAT'), 'image/png');
  });

  it('gabarits Leaflet {z} {x} {y} présents, aucune autre accolade, jamais wxs.ign.fr', () => {
    for (const url of [FOND_SATELLITE_IGN_URL, COUCHE_CADASTRE_IGN_URL, FOND_PLAN_URL]) {
      assert.match(url, /TILEMATRIX=\{z\}&TILEROW=\{y\}&TILECOL=\{x\}$/);
      assert.equal((url.match(/[{}]/g) ?? []).length, 6);
      assert.ok(!url.includes('wxs.ign.fr'));
      assert.ok(!/apikey|key=/i.test(url));
    }
  });

  it('même TILEMATRIXSET que le Plan IGN en production (homogène)', () => {
    assert.equal(TILEMATRIXSET_IGN, 'PM');
    assert.ok(FOND_PLAN_IGN_URL.includes('TILEMATRIXSET=PM&'));
    assert.equal(FOND_PLAN_URL, FOND_PLAN_IGN_URL);
  });

  it('jeu de tuiles paramétrable (PM_0_19 si l’alias PM devait disparaître)', () => {
    const p = parametres(urlTuilesWmtsIgn(COUCHE_SATELLITE_IGN, 'PM_0_19'));
    assert.equal(p.get('TILEMATRIXSET'), 'PM_0_19');
    assert.throws(() => urlTuilesWmtsIgn({ ...COUCHE_CADASTRE_IGN, couche: '  ' }));
  });
});

describe('couchesIgn — zooms, attribution, défauts', () => {
  it('zooms natifs 19 et suréchantillonnage jusqu’à 21', () => {
    assert.equal(ZOOM_NATIF_MAX_SATELLITE, 19);
    assert.equal(ZOOM_NATIF_MAX_CADASTRE, 19);
    assert.equal(ZOOM_NATIF_MAX_PLAN, 19);
    assert.equal(ZOOM_MAX_CARTE_IGN, 21);
    assert.ok(ZOOM_MAX_RECADRAGE <= ZOOM_NATIF_MAX_SATELLITE);
  });

  it('attribution « © IGN – Géoplateforme »', () => {
    assert.ok(ATTRIBUTION_IGN.startsWith('&copy;'));
    assert.ok(ATTRIBUTION_IGN.includes('IGN</a> – Géoplateforme'));
  });

  it('défauts : Satellite + Cadastre (parcelle), Plan sans cadastre (thématique), opacité 0.8', () => {
    assert.deepEqual(PREFERENCES_PAR_DEFAUT.parcelle, { fond: 'satellite', cadastre: true, opaciteCadastre: 0.8 });
    assert.deepEqual(PREFERENCES_PAR_DEFAUT.thematique, { fond: 'plan', cadastre: false, opaciteCadastre: 0.8 });
  });
});
