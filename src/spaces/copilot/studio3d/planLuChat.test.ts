// LOT G6 (18/11/2026) — « Plan lu » dans le chat : résumé du Studio relu sans rien compléter, valeurs clés à confirmer,
// saisie de repli, contexte transmis au parcours, plan joint détecté (jamais une photo de la maison).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  confirmerValeur, contextePlanLu, indicePlanJoint, lirePlanLuStudio, lireSaisie, MARQUEUR_PLAN_JOINT, messageValidationPlan,
  planLuDepuisSaisie, planPretPourLeParcours, texteAvecMarqueurPlan, valeursCles, type PlanLuSite,
} from './planLuChat.ts';
import { contexteCopilotReleve, FORMAT_RELEVE, lireRetourReleve, TYPE_RETOUR_RELEVE } from './planExistantStudio.ts';

const T = Date.UTC(2026, 10, 18, 9, 0, 0);
const SESSION = '11111111-2222-4333-8444-555555555555';

/** Résumé tel que le Studio l'envoie (format `mimmoza-plan-lu` v1). */
function resumeStudio(o: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: 'mimmoza-plan-lu', version: 1, origine: 'plan-rdc-etage.pdf',
    echelle: { texte: '1/100 (déduite des cotes écrites sur le plan)', statut: 'lu', cotesConcordantes: 6, cotesDiscordantes: 0 },
    dimensions: { longueurM: 11.9, largeurM: 8.02, statut: 'lu' },
    emprise: { lueM2: 101.5, statut: 'lu', bdTopoM2: 104, ecartPct: -2.4, signale: false },
    position: { statut: 'deduit', recouvrementPct: 96 },
    cotesExterieures: [{ libelle: 'Façade sud (11,90 m)', cote: 0, longueurLueM: 11.88, statut: 'lu', longueurBdTopoM: 11.9, ecartM: -0.02 }, { libelle: 'x', longueurLueM: 'NaN', statut: 'lu' }],
    niveaux: { nombre: 2, statut: 'deduit', libelles: ['Rez-de-chaussée', 'Étage'] },
    pieces: [
      { nom: 'Séjour', niveau: 'Rez-de-chaussée', surfaceM2: 32.4, statut: 'deduit' },
      { nom: null, niveau: 'Étage', surfaceM2: 12, statut: 'deduit' },
      { nom: 'Faux', niveau: 'Étage', surfaceM2: -4, statut: 'deduit' },
    ],
    pointsDouteux: ['1 pièce(s) sans nom lu.'],
    ...o,
  };
}

test('G6-F1 : résumé du Studio relu sans rien compléter (valeurs illisibles écartées)', () => {
  const p = lirePlanLuStudio(resumeStudio(), 'plan.pdf', T)!;
  assert.equal(p.source, 'import-plan');
  assert.equal(p.origine, 'plan-rdc-etage.pdf');
  assert.deepEqual(p.dimensions, { longueurM: 11.9, largeurM: 8.02, statut: 'lu' });
  assert.equal(p.emprise!.lueM2, 101.5);
  assert.equal(p.cotesExterieures.length, 1, 'le côté illisible est écarté');
  assert.equal(p.pieces.length, 2, 'la pièce de surface négative est écartée');
  assert.equal(p.surfacePiecesM2, 44.4);
  assert.equal(p.statutSurfacePieces, 'deduit');
  assert.equal(lirePlanLuStudio({ format: 'autre' }, 'x', T), null);
  assert.equal(lirePlanLuStudio(resumeStudio({ version: 2 }), 'x', T), null);
  // Dimensions sans statut : rien n'est repris.
  assert.equal(lirePlanLuStudio(resumeStudio({ dimensions: { longueurM: 11.9, largeurM: 8 } }), 'x', T)!.dimensions, null);
});

test('G6-F2 : valeurs clés — dimensions lues sûres (rien à confirmer) ; niveaux et surface déduits À CONFIRMER ; écart > 10 % → dimensions à confirmer', () => {
  const p = lirePlanLuStudio(resumeStudio(), 'x', T)!;
  const v = valeursCles(p);
  assert.deepEqual(v.map((x) => [x.cle, x.necessaire]), [['dimensions', false], ['niveaux', true], ['surface', true]]);
  assert.match(v[0]!.valeur, /11,9 × 8,02 m/);
  assert.ok(!planPretPourLeParcours(p));
  const q = lirePlanLuStudio(resumeStudio({ emprise: { lueM2: 150, statut: 'lu', bdTopoM2: 104, ecartPct: 44.2, signale: true } }), 'x', T)!;
  const d = valeursCles(q).find((x) => x.cle === 'dimensions')!;
  assert.ok(d.necessaire);
  assert.match(d.raison!, /écart de plus de 10 %/);
});

test('G6-F3 : confirmer tel quel, ou corriger (une correction des dimensions retire l’emprise lue)', () => {
  let p = lirePlanLuStudio(resumeStudio(), 'x', T)!;
  p = confirmerValeur(p, 'niveaux');
  p = confirmerValeur(p, 'surface', lireSaisie('surface', '138 m²'));
  assert.equal(p.niveaux!.statut, 'confirme');
  assert.equal(p.surfacePiecesM2, 138);
  assert.equal(p.statutSurfacePieces, 'confirme');
  assert.ok(planPretPourLeParcours(p));
  const c = confirmerValeur(p, 'dimensions', lireSaisie('dimensions', '12,10 x 8'));
  assert.deepEqual(c.dimensions, { longueurM: 12.1, largeurM: 8, statut: 'confirme' });
  assert.equal(c.emprise, null);
  const t = confirmerValeur(p, 'dimensions');
  assert.equal(t.dimensions!.statut, 'confirme');
  assert.equal(t.emprise!.statut, 'confirme');
  assert.equal(lireSaisie('dimensions', '12'), null);
  assert.equal(lireSaisie('niveaux', '2,5'), null);
  assert.deepEqual(lireSaisie('niveaux', '2'), [2]);
});

test('G6-F4 : saisie de repli (lecture impossible) — 2 ou 3 cotes, toutes confirmées ; illisible → null', () => {
  const p = planLuDepuisSaisie({ longueur: '8,5', largeur: '12', niveaux: '2' }, T)!;
  assert.equal(p.source, 'saisie');
  assert.deepEqual(p.dimensions, { longueurM: 12, largeurM: 8.5, statut: 'confirme' });
  assert.equal(p.niveaux!.nombre, 2);
  assert.ok(planPretPourLeParcours(p));
  assert.equal(planLuDepuisSaisie({ longueur: 'douze', largeur: '8' }, T), null);
  assert.equal(planLuDepuisSaisie({ longueur: '12', largeur: '8', niveaux: 'deux' }, T), null);
  assert.equal(planLuDepuisSaisie({ longueur: '12', largeur: '8' }, T)!.niveaux, null);
});

test('G6-F5 : contexte transmis au parcours (valeurs simples, statuts) ; message de validation SANS nombre', () => {
  const p = confirmerValeur(lirePlanLuStudio(resumeStudio(), 'x', T)!, 'niveaux');
  const c = contextePlanLu(p);
  assert.equal(c.plan_lu_v, 1);
  assert.equal(c.plan_lu_le, '2026-11-18');
  assert.equal(c.plan_lu_longueur_m, 11.9);
  assert.equal(c.plan_lu_niveaux_statut, 'confirme');
  assert.equal(c.plan_lu_surface_pieces_m2, 44.4);
  assert.equal(c.plan_lu_douteux, '1 pièce(s) sans nom lu.');
  for (const v of Object.values(c)) assert.ok(v === null || typeof v === 'string' || typeof v === 'number');
  assert.doesNotMatch(messageValidationPlan(p), /\d/);
  assert.match(messageValidationPlan(p), /^Plan de la maison : /);
  assert.doesNotMatch(messageValidationPlan(planLuDepuisSaisie({ longueur: '12', largeur: '8' }, T)!), /\d/);
});

test('G6-F6 : plan joint — DXF toujours ; PDF / image seulement si on parle de plan ; une photo de la maison n’est jamais prise pour un plan', () => {
  assert.equal(indicePlanJoint([{ name: 'maison.dxf', mediaType: 'application/octet-stream' }], 'voici'), 0);
  assert.equal(indicePlanJoint([{ name: 'scan.pdf', mediaType: 'application/pdf' }], 'Voici le plan de ma maison'), 0);
  assert.equal(indicePlanJoint([{ name: 'plan_rdc.png', mediaType: 'image/png' }], 'je veux agrandir'), 0);
  assert.equal(indicePlanJoint([{ name: 'IMG_1234.jpg', mediaType: 'image/jpeg' }], 'Ajoute une extension de 4 × 5 m à gauche'), -1);
  assert.equal(indicePlanJoint([{ name: 'facture.pdf', mediaType: 'application/pdf' }], 'que penses-tu de ce devis ?'), -1);
  assert.equal(indicePlanJoint([{ name: 'IMG.jpg', mediaType: 'image/jpeg' }, { name: 'relevé.pdf', mediaType: 'application/pdf' }], 'agrandir'), 1);
  const t = texteAvecMarqueurPlan('Voici le plan', 'plan.pdf');
  assert.ok(t.includes(`${MARQUEUR_PLAN_JOINT} : « plan.pdf »`));
});

test('G6-F7 : relevé renvoyé par le Studio avec `planLu` → synthèse et contexte du copilote complétés', () => {
  const data = {
    type: TYPE_RETOUR_RELEVE, version: 1, sessionId: SESSION,
    releve: { format: FORMAT_RELEVE, version: 1, maisonId: 'BATIMENT0000000312986202', source: 'import-plan', origine: 'plan-rdc-etage.pdf', cotes: [], baies: [], avertissements: [], planLu: resumeStudio() },
    synthese: { pieces: [{ nom: 'Séjour', niveau: 'RDC', surfaceM2: 32.4, statutSurface: 'deduit', statutNom: 'lu' }], murs: { exterieurs: 4, interieurs: 6 } },
  };
  const r = lireRetourReleve(data, SESSION, T);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.synthese.planLu!.emprise!.lueM2, 101.5);
  const c = contexteCopilotReleve(r.synthese);
  assert.equal(c.plan_lu_source, 'import-plan');
  assert.equal(c.plan_lu_emprise_m2, 101.5);
  // Relevé sans plan (photo) : aucune clé plan_lu_*.
  const sans = lireRetourReleve({ ...data, releve: { ...data.releve, source: 'photo', planLu: undefined } }, SESSION, T);
  assert.ok(sans.ok && !sans.synthese.planLu && !('plan_lu_v' in contexteCopilotReleve(sans.synthese)));
});

test('G6-F8 : le contexte transmis est relu tel quel par le parcours (même clés)', () => {
  const p: PlanLuSite = planLuDepuisSaisie({ longueur: '12', largeur: '8,5', niveaux: '2' }, T)!;
  const c = contextePlanLu(p);
  assert.deepEqual(Object.keys(c).filter((k) => !k.startsWith('plan_lu_')), []);
  assert.equal(c.plan_lu_source, 'saisie');
  assert.equal(c.plan_lu_dimensions_statut, 'confirme');
});

test('G6-F9 : chaîne complète — résumé RÉEL produit par le Studio (plans DXF de référence) → carte → contexte transmis au parcours', async () => {
  const { readFileSync } = await import('node:fs');
  const brut = JSON.parse(readFileSync(new URL('./__fixtures__/plan-lu-studio-g6.json', import.meta.url), 'utf8'));
  const p = lirePlanLuStudio(brut, 'x', T)!;
  assert.ok(p, 'résumé du Studio lisible par le site');
  assert.equal(p.origine, 'niveau-0.dxf, niveau-1.dxf');
  assert.deepEqual(p.dimensions, { longueurM: 11, largeurM: 8.4, statut: 'mesure' });
  assert.equal(p.cotesExterieures.length, brut.cotesExterieures.length);
  assert.equal(p.pieces.length, 11);
  assert.equal(p.niveaux!.nombre, 2);
  // Dimensions mesurées (échelle contrôlée par 31 cotes) : rien à confirmer ; niveaux déduits : à confirmer.
  const v = valeursCles(p);
  assert.equal(v.find((x) => x.cle === 'dimensions')!.necessaire, false);
  const c = contextePlanLu(confirmerValeur(p, 'niveaux'));
  assert.equal(c.plan_lu_emprise_m2, 92.4);
  assert.equal(c.plan_lu_niveaux_statut, 'confirme');
});
