// LOT X7 (16/11/2026) — côté front : carte de suivi d'une image d'extension « à valider » (raisons lisibles par code,
// arbre à abattre / arbuste à supprimer avec le rappel PLU, hauteur à l'égout et clôture retenues), et chemin
// atelier → site → fiche de la hauteur à l'égout SAISIE (CONFIRMÉE dans projet_extension, jamais dans calage_client).
import assert from 'node:assert/strict';
import test from 'node:test';
import { existantDuTravail, lignesRendu, raisonsAValider, TEXTES_A_VALIDER, vegetationARetirer } from './extensionMaison.ts';
import { examinerMessageCalage, ficheReprise, lireEgoutAtelier, TYPE_MESSAGE_CALAGE } from '../../../lib/studio/atelierPhotomontage.ts';
import { lireProjetExtension } from '../../../../supabase/functions/_shared/extension/contrat.ts';

const MAISON = 'BATIMENT0000000312987650';
const PROJET = {
  format: 'mimmoza-projet-extension', version: 1, nature: 'extension', modeExistantParDefaut: 'conserver',
  existants: [{ id: MAISON, source: 'bdtopo', mode: 'conserver', formeToit: { valeur: 'quatre-pans', statut: 'confirmee', source: 'parcours' } }],
  extension: { type: 'laterale', facade: { cote: 'rue' }, existantId: MAISON, dimensions: { largeurM: { valeur: 5, statut: 'confirmee', source: 'parcours' }, profondeurM: { valeur: 4, statut: 'confirmee', source: 'parcours' } } },
};
const RESULTAT_A_VALIDER = {
  ok: true, surface_plancher_creee_m2: 16.8, statut_x7: 'a_valider', livrable: false,
  raisons_a_valider: [
    { code: 'arbuste_a_supprimer', texte: 'texte du worker', detail: 'Suppression d’un arbuste nécessaire (V1…)' },
    { code: 'egout', texte: 'x' }, { code: 'egout', texte: 'doublon' }, { code: 'outil_interne_inconnu', texte: 'get_prescriptions_urbanisme a échoué' },
  ],
  vegetation: { ajustement: 'position', conserves: ['V2'], a_supprimer: [{ id: 'V1', nature: 'arbuste', message: 'Suppression d’un arbuste nécessaire (V1).' }], mention_reglementaire: 'À vérifier dans le PLU(i) avant tout abattage : espace boisé classé (art. L.113-1).' },
  egout_maison: { hauteur_m: 5.17, statut: 'confirmee', origine: 'calage', a_valider: false },
  cloture: { statut: 'mesuree', nature: 'pleine-et-ajouree', hauteur_pleine_m: 0.82 },
};

test('X7 carte : raisons « à valider » par code, textes du site (doublons et codes inconnus neutralisés)', () => {
  const r = raisonsAValider(RESULTAT_A_VALIDER);
  assert.deepEqual(r.map((x) => x.code), ['arbuste_a_supprimer', 'egout', 'autre']);
  assert.equal(r[0]!.texte, TEXTES_A_VALIDER['arbuste_a_supprimer']);
  for (const x of r) assert.doesNotMatch(x.texte, /get_|_[a-z]+_|worker|Unreal|IoU/);
  for (const t of Object.values(TEXTES_A_VALIDER)) assert.doesNotMatch(t, /[a-z]+_[a-z]+|\bIoU\b|worker|Unreal|GLB/);
  assert.deepEqual(raisonsAValider(null), []);
});

test('X7 carte : arbre à abattre / arbuste à supprimer avec le rappel PLU ; rien sans végétation à retirer', () => {
  const v = vegetationARetirer(RESULTAT_A_VALIDER)!;
  assert.deepEqual(v.lignes, ['Arbuste à supprimer : un arbuste de votre terrain gêne l’extension à cet endroit (position estimée sur la photo).']);
  assert.match(v.rappelPlu, /PLU\(i\).*L\.113-1/);
  const arbre = vegetationARetirer({ vegetation: { a_supprimer: [{ id: 'V2', nature: 'arbre' }] } })!;
  assert.match(arbre.lignes[0]!, /^Arbre à abattre/);
  assert.match(arbre.rappelPlu, /L\.113-1/, 'rappel PLU par défaut si le résultat n’en porte pas');
  assert.equal(vegetationARetirer({ vegetation: { a_supprimer: [] } }), null);
});

test('X7 carte : hauteur à l’égout retenue et clôture (statuts) ; bloc complet sur le travail ; livrable → pas de raison', () => {
  const l = lignesRendu(RESULTAT_A_VALIDER);
  assert.equal(l[0]!.valeur, '5,17 m (indiquée par vous)');
  assert.equal(l[0]!.statut, 'confirmee');
  assert.match(l[1]!.valeur, /partie pleine ≈ 0,82 m \(mesurée sur la photo\)/);
  const e = existantDuTravail({ options: { existant: 'conserver' }, projet_extension: PROJET, resultat_extension: RESULTAT_A_VALIDER })!;
  assert.equal(e.aValider.length, 3);
  assert.ok(e.vegetation);
  assert.equal(e.rendu.length, 2);
  const livre = existantDuTravail({ options: { existant: 'conserver' }, projet_extension: PROJET, resultat_extension: { ...RESULTAT_A_VALIDER, statut_x7: 'livrable', raisons_a_valider: [] } })!;
  assert.deepEqual(livre.aValider, []);
  const ancien = existantDuTravail({ options: { existant: 'conserver' }, projet_extension: PROJET, resultat_extension: { surface_plancher_creee_m2: 16.8 } })!;
  assert.deepEqual([ancien.aValider, ancien.vegetation, ancien.rendu], [[], null, []], 'résultat antérieur au lot X7 : inchangé');
});

test('X7 atelier → site : egout_saisi lu à côté de calage_client, posé CONFIRMÉ dans projet_extension du nouveau travail', () => {
  const JOB = '11111111-2222-4333-8444-555555555555';
  const O = 'https://mimmoza.vercel.app';
  const CALAGE = { version: 1, largeur_image: 2880, hauteur_image: 1920, valide_le: '2026-11-16T12:00:00Z', correspondances: [{ image: [1, 1], monde: [2.55, 48.88, 0] }, { image: [2, 2], monde: [2.55, 48.88, 5.17] }] };
  const eg = { valeur_m: 5.17, statut: 'confirmee', source: 'saisie dans l’atelier de calage le 2026-11-16', batiment: MAISON };
  const d = examinerMessageCalage({ origin: O, data: { type: TYPE_MESSAGE_CALAGE, travail: JOB, calage_client: CALAGE, egout_saisi: eg } }, O, true, JOB);
  assert.equal(d.type, 'calage');
  const egout = (d as { egout: typeof eg }).egout;
  assert.deepEqual(egout, eg);
  assert.equal(examinerMessageCalage({ origin: O, data: { type: TYPE_MESSAGE_CALAGE, travail: JOB, calage_client: CALAGE, egout_saisi: { ...eg, valeur_m: 40 } } }, O, true, JOB).type, 'refus');
  assert.equal(lireEgoutAtelier({ ...eg, statut: 'estimee' }).ok, false);
  assert.equal(lireEgoutAtelier({ ...eg, autre: 1 }).ok, false);
  const f = ficheReprise({ titre: 'x', devis_id: 'd', projet_extension: PROJET }, JOB, egout as never);
  assert.equal(f.ok, true);
  const fiche = (f as { valeur: Record<string, unknown> }).valeur;
  assert.equal(fiche.reprise_de, JOB);
  assert.equal(fiche.devis_id, undefined);
  const lu = lireProjetExtension(fiche.projet_extension);
  assert.equal(lu.ok, true);
  const h = (lu as { projet: { existants: { hauteurEgoutM?: { valeur: number; statut: string; source: string } }[] } }).projet.existants[0]!.hauteurEgoutM!;
  assert.deepEqual([h.valeur, h.statut], [5.17, 'confirmee']);
  assert.match(h.source, /atelier de calage/);
  // Sans projet d'extension, ou maison visée non conservée : refus (jamais posé ailleurs en silence).
  assert.equal(ficheReprise({ titre: 'x' }, JOB, egout as never).ok, false);
  assert.equal(ficheReprise({ projet_extension: PROJET }, JOB, { ...egout, batiment: 'BATIMENT_AUTRE' } as never).ok, false);
  // Sans hauteur saisie : comportement antérieur.
  assert.deepEqual(ficheReprise({ titre: 'x', devis_id: 'd' }, JOB), { ok: true, valeur: { titre: 'x', reprise_de: JOB } });
});
