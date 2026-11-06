// LOT BRIEF-FORMES (fusion des lots brief-unifié et formes-batiment, 06/11/2026) — l'habillage du brief
// sur un bâtiment À AILES (en L, en U, cour fermée, redans) : aperçu 3D aile par aile avec les détails du
// brief (soubassement, toiture végétalisée, attique, menuiseries, garde-corps), et jamais de toit à deux
// pans promis sur un bâtiment à ailes (le Studio couvrirait chaque aile d'un toit séparé, sans noue).
// Données : parcelle RÉELLE 92050000AE0414 (Nanterre) — __fixtures__/preparation-AE0414.json (lot formes-batiment).
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { apercuVolume } from '../../../../supabase/functions/copilot-chat/agent/studio.ts';
import { lirePreparationStockee, type PreparationStockee } from './preparationStudio.ts';
import { apercuDepuisEvaluation, appliquerForme, evaluerSaisie, saisieDepuisVolume } from './ficheDimensions.ts';
import {
  CHOIX_DEFAUT, HAUTEUR_SOUBASSEMENT, RAISON_PENTE_AILES, apercuAAiles, choisir, demandeFiche, demandePanneau, etatInitial, lireDemandeBrief,
  limitesDossier, raisonIndisponible, sceneApercu, type ChoixBrief, type LimitesBrief,
} from './briefCreatif.ts';

const FIX = JSON.parse(readFileSync(new URL('./__fixtures__/preparation-AE0414.json', import.meta.url), 'utf8'));
const P = lirePreparationStockee(FIX.ligne) as PreparationStockee;
const evalForme = (f: 'l' | 'u' | 'cour' | 'redans' | 'plots') => evaluerSaisie(P, appliquerForme(P, saisieDepuisVolume(P.volume), f));
const apercuForme = (f: 'l' | 'u' | 'cour' | 'redans' | 'plots') => apercuDepuisEvaluation(evalForme(f));
/** Brief riche de la fusion : brique claire, loggias, garde-corps verre, menuiseries anthracite, soubassement pierre, toiture végétalisée, attique. */
const RICHE: ChoixBrief = { ...CHOIX_DEFAUT, facade: 'brique', teinte: 'claire', balcons: 'loggias', attique: true, toiture: 'vegetalisee', garde_corps: 'verre', menuiseries: 'anthracite', soubassement: 'pierre' };
const LIM: LimitesBrief = { batiments: 1, balcons: true };

test('aperçu d’un bâtiment à ailes + brief riche : chaque aile porte soubassement, toiture végétalisée, attique (sans retrait côté accolé), menuiseries et garde-corps vitrés', () => {
  for (const [f, n] of [['l', 2], ['u', 3], ['cour', 4], ['redans', 3]] as const) {
    const ap = apercuForme(f);
    assert.equal(ap.corps.length, n, f);
    assert.equal(apercuAAiles(ap), f !== 'redans', `${f} : côtés entièrement accolés (les redans n’en ont pas)`);
    const sc = sceneApercu(ap, RICHE);
    const de = (m: string) => sc.boites.filter((b) => b.m === m);
    assert.equal(de('soubassement').length, n, `${f} : un bandeau de soubassement par aile`);
    for (const b of de('soubassement')) assert.equal(b.s[1], HAUTEUR_SOUBASSEMENT);
    assert.equal(de('toiture').length, n, `${f} : une toiture végétalisée par aile`);
    assert.equal(sc.toits.length, 0, `${f} : aucun toit à deux pans`);
    assert.ok(de('menuiserie').length > 0 && de('gardeCorps').every((b) => b.opacite === 0.45), f);
    assert.ok(de('fondLoggia').length > 0, `${f} : loggias dessinées`);
    // Attique : une boîte par aile (au-dessus du corps), sans retrait du côté accolé à une autre aile.
    const hCorps = Math.max(...de('toiture').map((b) => b.p[1]));
    const attiques = de('mur').filter((b) => b.p[1] > hCorps);
    assert.equal(attiques.length, n, `${f} : un attique par aile`);
    for (const [i, k] of ap.corps.entries()) {
      const a = attiques[i];
      const retraitU = k.l - a.s[0], retraitV = k.p - a.s[2];
      const attenduU = [2, 3].filter((c) => !(k.int ?? []).includes(c)).length * 2;
      const attenduV = [0, 1].filter((c) => !(k.int ?? []).includes(c)).length * 2;
      assert.deepEqual([Math.round(retraitU * 100) / 100, Math.round(retraitV * 100) / 100], [attenduU, attenduV], `${f} aile ${i}`);
    }
  }
});

test('toit à deux pans : non cliquable pour un bâtiment à ailes (fiche, panneau, ancienne sortie du serveur) ; cliquable pour des plots', () => {
  for (const f of ['l', 'u', 'cour', 'redans'] as const) {
    const ev = evalForme(f);
    const ap = apercuDepuisEvaluation(ev);
    // Fiche « Espace 3D » : limites du dossier (JarvisDraftPanel) — ailes évaluées par le moteur.
    const d = demandeFiche(null, ap, limitesDossier(ev.corps));
    assert.deepEqual(d.limites, { batiments: 1, balcons: true, ailes: true }, f);
    for (const t of ['deux_pans_tuiles', 'deux_pans_ardoise', 'deux_pans_zinc'] as const) {
      assert.equal(raisonIndisponible('toiture', t, CHOIX_DEFAUT, d), RAISON_PENTE_AILES, `${f} ${t}`);
      const e = etatInitial(d);
      assert.deepEqual(choisir(e, 'toiture', t, d), e, 'clic sans effet');
    }
    assert.equal(raisonIndisponible('toiture', 'vegetalisee', CHOIX_DEFAUT, d), null);
    // Demande du chat : `limites.ailes` du serveur (ce lot) ; sans lui, déduit de l'aperçu (côtés accolés : L, U, cour).
    const sortie = (ailes?: boolean) => ({ status: 'partial', data: { brief_requis: true, type: 'film', apercu: apercuVolume(ev.volume), limites: { batiments: 1, balcons: true, ...(ailes === undefined ? {} : { ailes }) } } });
    const lue = lireDemandeBrief({ name: 'studio_lancer_rendu', status: 'success', output: sortie(true) })!;
    assert.equal(lue.limites.ailes, true, f);
    assert.equal(demandePanneau(lue, null, null, LIM).limites.ailes, true);
    const sansChamp = lireDemandeBrief({ name: 'studio_lancer_rendu', status: 'success', output: sortie() })!;
    assert.equal(sansChamp.limites.ailes, f !== 'redans', `${f} : repli sur l’aperçu`);
    if (f !== 'redans') assert.ok(sansChamp.apercu!.corps.some((c) => (c.int ?? []).length > 0), `${f} : côtés accolés conservés à la lecture`);
    // Brief connu avec un toit à deux pans (choisi avant de passer à une forme à ailes) : toit-terrasse proposé à nouveau.
    const e = etatInitial({ ...d, actuel: { ...CHOIX_DEFAUT, toiture: 'deux_pans_tuiles', defauts: [] } });
    assert.equal(e.choix.toiture, 'terrasse');
    assert.ok(!e.touches.includes('toiture'));
  }
  const evP = evalForme('plots');
  const plots = demandeFiche(null, apercuDepuisEvaluation(evP), limitesDossier(evP.corps));
  assert.deepEqual(plots.limites, { batiments: 3, balcons: true, ailes: false });
  assert.equal(raisonIndisponible('toiture', 'deux_pans_tuiles', CHOIX_DEFAUT, plots), null);
});
