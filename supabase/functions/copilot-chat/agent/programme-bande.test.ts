// deno test --no-lock --no-check -A supabase/functions/copilot-chat/agent/programme-bande.test.ts
// Lot C7c : préparation du volume (preparerVolume) cohérente de bout en bout avec une règle d'emprise PAR BANDE.
// Le plafond « bande principale » (45 % à Montreuil) n'est utilisé que si TOUS les bâtiments sont dans la bande
// principale ; sinon plafond prudent (20 %), et la raison est dans les notes.
// Parcelle réelle : 93048000AS0249 (98 rue de Paris, Montreuil) et ses cinq voisines, fixture du lot C7a.
// Les formes choisies (L, fiche) sont essayées sur une parcelle d'essai rectangulaire, dite comme telle.
import * as na from 'node:assert/strict';
import { preparerVolume, type ConceptionLue, type IssuePreparation } from './studio.ts';
import { saisieDepuisVolume } from './studio-front.ts';
import { bandePourMoteur, bandesDeLaConception } from './voisines-parcelle.ts';
import { lireRegles } from './studio.ts';
import { distanceALaVoie, distancePointSegment, identifierCoteVoie, type CoteVoie } from '../../../../src/spaces/copilot/studio3d/coteVoie.ts';
import { dansPolygone, type VolumePropose } from '../../../../src/spaces/copilot/studio3d/volumeParcelle.ts';

const IDU = '93048000AS0249';
const FX = JSON.parse(Deno.readTextFileSync(new URL('../../../../src/spaces/copilot/studio3d/__fixtures__/cadastre-93048000AS0249.json', import.meta.url)));
const voisinesDe = (liste: { idu?: string; geometry: unknown }[]) => ({ statut: 'disponibles', source: 'API Carto IGN — cadastre', parcelles: liste.map((v) => ({ idu: v.idu ?? null, geometrie: v.geometry })) });
const PARCELLE = { idu: IDU, geometrie: FX.parcelle.geometry, surface_m2: 804, source: 'API Carto IGN — cadastre', voisines: voisinesDe(FX.voisines) };
const COTE = identifierCoteVoie(FX.parcelle.geometry, FX.voisines.map((v: { geometry: unknown }) => v.geometry));

// Règles du PLUi Est Ensemble telles que le lot C6 les enregistre (indices J et b2) ; `profondeur` : libellé de la bande.
const regles = (profondeur = '18 m') => [
  { cle: 'emprise_sol_max_pct', valeur: 80, statut: 'confirme', source: 'Règlement GPU — PLUi Est Ensemble', article: 'indice J', nature: 'alternative',
    texte: 'selon la bande', alternatives: [{ libelle: `bande principale (${profondeur})`, valeur: 80 }, { libelle: 'bande secondaire', valeur: 20 }] },
  { cle: 'hauteur_max_m', valeur: 19.5, statut: 'confirme', source: 'Règlement GPU — PLUi Est Ensemble', article: 'indice b2, p. 263', nature: 'alternative',
    alternatives: [{ libelle: `bande principale (${profondeur})`, valeur: 19.5 }, { libelle: 'bande secondaire', valeur: 13.5 }] },
  { cle: 'niveaux_max', valeur: 6, statut: 'confirme', source: 'Règlement GPU — PLUi Est Ensemble', article: 'indice b2, p. 263', nature: 'alternative',
    alternatives: [{ libelle: `bande principale (${profondeur})`, valeur: 6 }, { libelle: 'bande secondaire', valeur: 4 }] },
];
const conception = (logements: number, parcelle: unknown = PARCELLE, r: unknown = regles()): ConceptionLue =>
  ({ id: 'c-montreuil', idu: IDU, commune: 'Montreuil', parcelle, regles_plu: r, programme: { nb_logements: logements } }) as ConceptionLue;
type Prete = Extract<IssuePreparation, { ok: true }>;
const prete = (r: IssuePreparation): Prete => { na.ok(r.ok, r.ok ? '' : r.raison); return r as Prete; };

/**
 * Vérification GÉOMÉTRIQUE indépendante du moteur : chaque bâtiment (aile par aile), sommets et grille de
 * 0,25 m, est dans la parcelle et à ≥ recul des limites ; rend la plus grande distance à la voie et l'emprise.
 */
function mesurer(v: VolumePropose, cote: CoteVoie) {
  type Rect = { coins: { x: number; y: number }[]; l: number; p: number };
  const rects: Rect[] = v.batiments?.length
    ? v.batiments.flatMap((b): Rect[] => b.ailes && b.ailes.length >= 2 ? b.ailes.map((a) => ({ coins: a.coins, l: a.lu, p: a.lv })) : [{ coins: b.coins, l: b.largeurM, p: b.profondeurM }])
    : v.emprise ? [{ coins: v.emprise.coins, l: v.emprise.largeurM, p: v.emprise.profondeurM }] : [];
  na.ok(rects.length > 0, 'aucun bâtiment');
  const contour = cote.anneaux[0];
  let distanceMax = 0, emprise = 0;
  for (const r of rects) {
    const [c0, c1, c2, c3] = r.coins;
    emprise += r.l * r.p;
    const centre = { x: (c0.x + c2.x) / 2, y: (c0.y + c2.y) / 2 };
    const nu = Math.ceil(Math.hypot(c1.x - c0.x, c1.y - c0.y) / 0.25), nv = Math.ceil(Math.hypot(c3.x - c0.x, c3.y - c0.y) / 0.25);
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
      const p = { x: c0.x + (c1.x - c0.x) * i / nu + (c3.x - c0.x) * j / nv, y: c0.y + (c1.y - c0.y) * i / nu + (c3.y - c0.y) * j / nv };
      const q = { x: p.x + (centre.x - p.x) * 1e-4, y: p.y + (centre.y - p.y) * 1e-4 };
      na.ok(dansPolygone(cote.anneaux, q.x, q.y), `point hors parcelle : ${JSON.stringify(p)}`);
      for (let s = 0; s < contour.length; s++) na.ok(distancePointSegment(p, contour[s], contour[(s + 1) % contour.length]) >= v.reculM - 0.02, 'point trop près d’une limite');
      distanceMax = Math.max(distanceMax, distanceALaVoie(p, cote));
    }
  }
  return { distanceMax, emprise };
}
const ces = (r: Prete) => r.resume.regles_appliquees.find((l) => /^Emprise au sol \(CES\)/.test(l)) ?? '';
const controleEmprise = (r: Prete) => r.resume.controles.find((k) => k.cle === 'emprise_sol_max_pct')!;

Deno.test('C7c-1 : bandePourMoteur — côté voie, profondeur lue et plafond de la bande principale (368 m²) ; null si un élément manque', () => {
  const b = bandesDeLaConception(PARCELLE, lireRegles(regles()));
  na.equal(b.tauxPrincipalPct, 80);
  na.equal(b.cote?.statut, 'identifie');
  const d = bandePourMoteur(b);
  na.ok(d);
  na.equal(d!.profondeurM, 18);
  na.equal(d!.empriseMaxM2, 368);
  na.equal(d!.cote, b.cote);
  na.equal(bandePourMoteur({ ...b, mesure: null }), null);
  na.equal(bandePourMoteur({ ...b, cote: null }), null);
  na.equal(bandePourMoteur({ ...b, tauxPrincipalPct: null }), null);
  na.equal(bandePourMoteur({ ...b, tauxPrincipalPct: 0 }), null);
  na.equal(bandePourMoteur({ ...b, profondeurM: null }), null);
  const sans = bandesDeLaConception({ ...PARCELLE, voisines: undefined }, lireRegles(regles()));
  na.equal(sans.cote, null);
  na.equal(bandePourMoteur(sans), null);
});

for (const n of [30, 40]) {
  Deno.test(`C7c-2 : parcelle réelle, ${n} logements — plafond 45 % ET tous les bâtiments à 18 m au plus de la voie, emprise ≤ 368 m²`, async () => {
    const r = prete(await preparerVolume(conception(n)));
    na.match(ces(r), /45 %/);
    na.equal(r.volume.bande?.statut, 'appliquee');
    const g = mesurer(r.volume, COTE);
    na.ok(g.distanceMax <= 18 + 1e-6, `bâtiment jusqu’à ${g.distanceMax.toFixed(2)} m de la voie`);
    na.ok(g.emprise <= 368 + 1e-6 && g.emprise <= 0.45 * 816 + 1e-6, String(g.emprise));
    na.equal(r.resume.emprise_batie_m2, Math.round(g.emprise));
    // Relevé le 10/11/2026 : un plot de 14 × 14 m, R+5, 16 logements (programme non atteint, dit).
    na.equal(r.resume.emprise_batie_m2, 196);
    na.equal(r.resume.niveaux, 6);
    na.equal(r.resume.logements_places, 16);
    na.equal(r.resume.programme_atteint, false);
    na.ok(r.resume.alertes.some((a) => /programme non atteint — 16 logements au plus \(6 niveaux, 1 bâtiment, dans la bande principale\)/.test(a)));
    na.ok(r.resume.hypotheses.some((h) => /rangées parallèles à la voie, dans la bande principale/.test(h)));
    // Notes : plus de « pas encore contraint », plus de sous-estimation ; le côté voie reste présumé.
    const notes = r.resume.regles_non_appliquees.join(' | ');
    na.match(notes, /Côté voie présumé d’après le cadastre \(limite sans parcelle mitoyenne\), à confirmer ; les bâtiments du volume d’étude sont contenus dans la bande principale \(vérifié par le calcul\)/);
    na.doesNotMatch(notes, /pas encore contraint|SOUS-ESTIME|non retenue/);
    // Contrôle d'emprise : plafond de la bande en m², verdict « à vérifier » (côté voie présumé), textes à jour.
    const e = controleEmprise(r);
    na.equal(e.verdict, 'a_verifier');
    na.equal(e.valeur_volume, '196 m² dans la bande principale (24 % de la parcelle)');
    na.match(e.regle!, /^368 m² max\. dans la bande principale \(80 % de la bande de 18 m\)/);
    na.doesNotMatch(JSON.stringify(r.resume.controles), /côté voie non identifié par le volume|80 % max\./);
    na.ok(!r.resume.controles.some((k) => k.verdict === 'dans_la_limite'));
    na.deepEqual(r.entree.bandes, { profondeurM: 18, surfaceParcelleM2: 816, bandePrincipaleM2: 461, bandeSecondaireM2: 355 });
    na.equal(prete(await preparerVolume(conception(n))).empreinte, r.empreinte, 'déterministe');
  });
}

Deno.test('C7c-3 : repli — bande mesurée mais trop peu profonde (8 m) : plafond prudent 20 %, jamais 45 %, raison dans les notes', async () => {
  const r = prete(await preparerVolume(conception(30, PARCELLE, regles('8 m'))));
  na.match(ces(r), /20 %/);
  na.match(ces(r), /taux le plus contraignant appliqué à la parcelle/);
  na.doesNotMatch(r.resume.regles_appliquees.join(' | '), /80 % de la bande principale/);
  na.equal(r.volume.bande?.statut, 'non-appliquee');
  const note = 'Bande principale mesurée (218 m² à moins de 8 m de la voie) mais non retenue pour ce volume — aucun rectangle de 6 × 6 m ne tient à la fois à 4 m des limites et à moins de 8 m du côté voie (emprise maximale 174 m²). Plafond d’emprise prudent appliqué à toute la parcelle.';
  na.ok(r.resume.regles_non_appliquees.includes(note), r.resume.regles_non_appliquees.join(' | '));
  na.equal(r.volume.bande?.raison, note);
  na.doesNotMatch(r.resume.regles_non_appliquees.join(' | '), /contenus dans la bande principale/);
  // Même volume qu'une conception sans voisines (calcul prudent du lot C6), à la note et au champ `bande` près.
  const sans = prete(await preparerVolume(conception(30, { ...PARCELLE, voisines: undefined }, regles('8 m'))));
  na.equal(r.resume.emprise_batie_m2, sans.resume.emprise_batie_m2);
  na.deepEqual(r.volume.batiments, sans.volume.batiments);
  na.equal('bande' in sans.volume, false);
  const e = controleEmprise(r);
  na.equal(e.verdict, 'a_verifier');
  na.match(e.regle!, /^20 % de la parcelle \(plafond prudent\)/);
  mesurer(r.volume, COTE);
});

Deno.test('C7c-4 : conception sans voisines — rien ne change (plafond prudent, pas de champ bande, note « côté voie non situé »)', async () => {
  const r = prete(await preparerVolume(conception(30, { ...PARCELLE, voisines: undefined })));
  na.match(ces(r), /20 %/);
  na.equal('bande' in r.volume, false);
  na.equal('bandes' in r.entree, false);
  na.ok(r.resume.regles_non_appliquees.some((l) => l.startsWith('Côté voie non situé — Parcelles voisines absentes')));
  na.match(controleEmprise(r).regle!, /^20 % de la parcelle \(plafond prudent\)/);
});

// ── Parcelle D'ESSAI (rectangle de 40 × 60 m, voie au sud, trois voisines) : formes choisies ──
const LAT = 48.87, LON = 2.18, KX = 111_320 * Math.cos(LAT * Math.PI / 180);
const poly = (pts: number[][]) => { const a = pts.map(([x, y]) => [LON + x / KX, LAT + y / 111_320]); return { type: 'Polygon', coordinates: [[...a, a[0]]] }; };
const ESSAI = { idu: IDU, geometrie: poly([[0, 0], [40, 0], [40, 60], [0, 60]]), surface_m2: 2400, source: 'parcelle d’essai',
  voisines: voisinesDe([poly([[-30, 0], [0, 0], [0, 60], [-30, 60]]), poly([[40, 0], [70, 0], [70, 60], [40, 60]]), poly([[-30, 60], [70, 60], [70, 90], [-30, 90]])].map((geometry) => ({ geometry }))) };
const COTE_ESSAI = identifierCoteVoie(ESSAI.geometrie as never, ESSAI.voisines.parcelles.map((v) => v.geometrie as never));

Deno.test('C7c-5 : parcelle d’essai — moteur dans la bande (24 %), forme « en L » hors bande → tout est recalculé au plafond prudent', async () => {
  const moteur = prete(await preparerVolume(conception(30, ESSAI)));
  na.match(ces(moteur), /24 %/);
  na.equal(moteur.volume.bande?.statut, 'appliquee');
  const gm = mesurer(moteur.volume, COTE_ESSAI);
  na.ok(gm.distanceMax <= 18 + 1e-6 && gm.emprise <= 576 + 1e-6, JSON.stringify(gm));
  na.equal(moteur.resume.logements_places, 30);

  const enL = prete(await preparerVolume(conception(30, ESSAI), { forme: 'l' }));
  na.match(ces(enL), /20 %/);
  na.doesNotMatch(enL.resume.regles_appliquees.join(' | '), /de la bande principale de 18 m \(/);
  na.equal(enL.volume.bande?.statut, 'non-appliquee');
  na.match(enL.volume.bande!.raison!, /forme choisie non contenue dans la bande principale \(2 emprises bâties sur 2 non contenues dans la bande principale de 18 m\) : plafond d’emprise prudent appliqué à toute la parcelle\.$/);
  na.ok(enL.resume.regles_non_appliquees.includes(enL.volume.bande!.raison!));
  const gl = mesurer(enL.volume, COTE_ESSAI);
  na.ok(gl.distanceMax > 18, 'la forme en L sort bien de la bande');
  na.ok(gl.emprise <= 0.2 * 2400 + 1e-6, `emprise ${gl.emprise} m² sous le plafond prudent de 480 m²`);
  na.match(controleEmprise(enL).regle!, /^20 % de la parcelle \(plafond prudent\)/);
  na.notEqual(enL.empreinte, moteur.empreinte);
});

Deno.test('C7c-6 : fiche — dimensions modifiées DANS la bande : plafond de bande gardé ; bâtiment glissé HORS bande : plafond prudent', async () => {
  const moteur = prete(await preparerVolume(conception(30, ESSAI)));
  const s = saisieDepuisVolume(moteur.volume);
  const raccourci = prete(await preparerVolume(conception(30, ESSAI), { saisie: { ...s, corps: s.corps.map((k) => ({ ...k, longueurM: k.longueurM - 4 })) } }));
  na.match(ces(raccourci), /24 %/);
  na.equal(raccourci.volume.bande?.statut, 'appliquee');
  const gr = mesurer(raccourci.volume, COTE_ESSAI);
  na.ok(gr.distanceMax <= 18 + 1e-6 && gr.emprise < mesurer(moteur.volume, COTE_ESSAI).emprise);
  na.match(controleEmprise(raccourci).regle!, /^576 m² max\. dans la bande principale/);

  const glisse = prete(await preparerVolume(conception(30, ESSAI), { saisie: { ...s, corps: s.corps.map((k) => ({ ...k, centre: { x: k.centre.x, y: k.centre.y + 10 } })) } }));
  na.match(ces(glisse), /20 %/);
  na.equal(glisse.volume.bande?.statut, 'non-appliquee');
  na.match(glisse.volume.bande!.raison!, /forme choisie non contenue dans la bande principale \(1 emprise bâtie sur 1 non contenue/);
  na.ok(mesurer(glisse.volume, COTE_ESSAI).distanceMax > 18);
  na.match(controleEmprise(glisse).regle!, /^20 % de la parcelle \(plafond prudent\)/);
  na.doesNotMatch(glisse.resume.regles_non_appliquees.join(' | '), /contenus dans la bande principale/);
});
