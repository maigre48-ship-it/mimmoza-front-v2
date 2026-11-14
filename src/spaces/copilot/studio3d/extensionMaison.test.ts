// LOT X3 (14/11/2026) — extensions de maison côté front : carte du parcours (vue lue dans la sortie RÉELLE du serveur,
// calculée ici par le même code sur la maison réelle P0646), carte de résultat d'un rendu « maison conservée »,
// options d'image (`existant`, refus avec une zone à effacer), lecture des travaux.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { avancerParcours, ETAT_INITIAL, type ContexteParcours, type EtatParcours, type SortieParcours } from '../../../../supabase/functions/_shared/extension/parcours.ts';
import { reglesDeLaConception, resultatParcours } from '../../../../supabase/functions/copilot-chat/agent/extension.ts';
import { facadesVoieDeLaParcelle } from '../../../../supabase/functions/copilot-chat/agent/voisines-parcelle.ts';
import {
  avertissementsSansConservation, derniereVueExtension, existantDuTravail, libelleEtape, ligneExtension, ligneSurfaceCreee, lireVueExtension,
  PREFIXE_MENTION_CONSERVE,
} from './extensionMaison.ts';
import { vueCarteSuivi } from './suiviRenduChat.ts';
import { lireTravail, resumeOptions, validerOptions } from '../../../lib/studio/travauxLogique.ts';

const FX = JSON.parse(readFileSync(new URL('./__fixtures__/extension-x3-reel.json', import.meta.url), 'utf8'));
const C = FX.conceptionP0646;
const S = FX.bdtopo.sites.find((s: { idu: string }) => s.idu === '930470000P0646');
const fac = facadesVoieDeLaParcelle(C.parcelle);
const CTX: ContexteParcours = {
  idu: S.idu, commune: 'Montfermeil', contourWgs84: S.contourWgs84, surfaceParcelleM2: 750, batiments: S.batiments, raisonBdTopo: null,
  dateBdTopo: '2026-11-12', bdnb: null, noteBdnb: null, zoneU: { valeur: true, source: 'zone UC du PLU (test)' }, regles: reglesDeLaConception(C.regles_plu),
  facadesVoie: fac.facades.map((f) => ({ debut: f.debut, fin: f.fin })), raisonFacades: fac.raison,
};
function jouer(messages: string[]): SortieParcours[] {
  const out: SortieParcours[] = [];
  let etat: EtatParcours = ETAT_INITIAL;
  let att: readonly string[] = [];
  for (const m of messages) { const s = avancerParcours(etat, m, att, CTX); out.push(s); etat = s.etat; att = s.attendues; }
  return out;
}
const PARCOURS = jouer([
  'Je voudrais agrandir ma maison', 'Maison existante : Conserver la maison',
  'Toit de la maison : 2 pans · Niveaux de la maison : R+1 · Type d’extension : Arrière · Façade (vue de la rue) : À l’arrière',
  'Dimensions (largeur × profondeur) : 5 × 4 m · Hauteur de l’extension : Plain-pied',
  'Surface de plancher existante : 118 m² · Demandeur : Particulier',
]);
const SORTIE_FIN = JSON.parse(JSON.stringify(resultatParcours(PARCOURS[4]!)));
const SORTIE_CONF = JSON.parse(JSON.stringify(resultatParcours(PARCOURS[1]!)));

test('X3-F1 : carte du parcours — estimation avec statuts, extension, surface créée ESTIMÉE, régime indicatif et sources', () => {
  const conf = lireVueExtension(SORTIE_CONF)!;
  assert.equal(conf.etape, 'confirmer');
  assert.equal(libelleEtape(conf.etape), 'Estimation de la maison à confirmer');
  const toit = conf.maison!.lignes.find((l) => l.libelle === 'Toit')!;
  assert.deepEqual([toit.valeur, toit.statut, toit.statutLibelle], ['2 pans, pente 35°', 'supposee', 'SUPPOSÉE']);
  const sdp = conf.maison!.lignes.find((l) => l.libelle === 'Surface de plancher')!;
  assert.deepEqual([sdp.valeur, sdp.statut], ['≈ 183 m² (entre 156 et 211 m²)', 'estimee']);
  assert.equal(conf.maison!.lignes.find((l) => l.libelle === 'Hauteur à l’égout')!.statut, 'mesuree');
  const fin = lireVueExtension(SORTIE_FIN)!;
  assert.equal(fin.maison!.conservee, true);
  assert.equal(fin.maison!.lignes.find((l) => l.libelle === 'Surface de plancher')!.statut, 'confirmee');
  assert.equal(ligneExtension(fin.extension!), 'Arrière, à l’arrière (vu de la rue) — 5 × 4 m, plain-pied');
  assert.equal(fin.extension!.verdict, 'ok');
  assert.equal(ligneSurfaceCreee(fin.extension!), 'surface de plancher créée ESTIMÉE ≈ 16,8 m² (entre 14 et 19 m²) ; emprise au sol créée 20 m²');
  assert.match(fin.regime!.libelle, /Déclaration préalable/);
  assert.equal(fin.regime!.sources.length, 2);
  assert.ok(fin.projetEnregistre);
  // Aucune règle ESTIMÉE présentée comme lue.
  assert.ok(fin.regles.every((r) => !/— lu dans le règlement/.test(r)));
  // Sortie illisible : rien.
  assert.equal(lireVueExtension({ status: 'error' }), null);
  assert.equal(lireVueExtension({ status: 'ok', data: { vue: { etape: 'termine' } } }), null);
});

test('X3-F2 : Dossier 3D — dernière vue du parcours de la conversation', () => {
  const messages = [
    { role: 'assistant', toolCalls: [{ name: 'extension_maison', status: 'success', output: SORTIE_CONF }] },
    { role: 'user' },
    { role: 'assistant', toolCalls: [{ name: 'extension_maison', status: 'success', output: SORTIE_FIN }, { name: 'extension_maison', status: 'error', output: null }] },
  ];
  assert.equal(derniereVueExtension(messages)!.etape, 'termine');
  assert.equal(derniereVueExtension([{ toolCalls: [{ name: 'studio_etat_rendu', status: 'success', output: {} }] }]), null);
});

test('X3-F3 : carte de résultat — « maison existante conservée », extension demandée, statuts ; refus du moteur (X4) ; projet neuf : rien', () => {
  const projet = SORTIE_FIN.data.projet_extension;
  const e = existantDuTravail({ options: { existant: 'conserver' }, projet_extension: projet })!;
  assert.equal(e.titre, 'Maison existante conservée (projet d’extension)');
  assert.equal(e.extension, 'Extension arrière, à l’arrière (vu de la rue) — 5 × 4 m — plain-pied');
  assert.deepEqual(e.maison.map((l) => [l.libelle, l.valeur, l.statutLibelle]), [
    ['Toit', '2 pans', 'confirmée par l’utilisateur'], ['Hauteur à l’égout', '5 m', 'mesurée'], ['Niveaux', '2', 'confirmée par l’utilisateur'], ['Surface de plancher', '118 m²', 'confirmée par l’utilisateur'],
  ]);
  const refuse = existantDuTravail({ options: { existant: 'conserver' }, projet_extension: projet, resultat_extension: { refus: ['Hors parcelle : 2 angle(s) de l’extension hors du terrain.'], surface_plancher_creee_m2: 16.8 } })!;
  assert.deepEqual(refuse.refus, ['Hors parcelle : 2 angle(s) de l’extension hors du terrain.']);
  assert.equal(refuse.surfaceCreee, 'Surface de plancher créée ESTIMÉE par le moteur : ≈ 16,8 m²');
  // Option seule (fiche illisible) : bloc sans détail inventé.
  assert.deepEqual([existantDuTravail({ options: { existant: 'conserver' } })!.extension, existantDuTravail({ options: { existant: 'conserver' } })!.maison], [null, []]);
  assert.equal(existantDuTravail({ options: { existant: 'effacer' } }), null);
  assert.equal(existantDuTravail({ options: {} , projet_extension: { format: 'autre' } }), null);
  assert.equal(existantDuTravail(null), null);
  const mention = `${PREFIXE_MENTION_CONSERVE} (projet d’extension) : la maison de la photo est gardée telle quelle…`;
  assert.deepEqual(avertissementsSansConservation([mention, 'Autre'], e), ['Autre']);
  assert.deepEqual(avertissementsSansConservation([mention], null), [mention]);
});

test('X3-F4 : suivi d’un rendu — bloc existant dans la vue, mention du worker non répétée ; lecture d’un travail', () => {
  const brut = {
    id: '11111111-1111-4111-8111-111111111111', conversation_id: 'c', type: 'image', statut: 'termine', progression: 100, etape: null,
    options: { vues: ['face'], existant: 'conserver' }, elements_omis: [], erreur: null, cree_le: '2026-11-14T10:00:00Z', maj_le: '2026-11-14T10:30:00Z', demarre_le: null, termine_le: null,
    resultat: { image_path: 'u/x.jpg', avertissements: [`${PREFIXE_MENTION_CONSERVE} (projet d’extension) : …`, 'Terrain supposé plat.'], extension: { refus: [] } },
    projet_extension: SORTIE_FIN.data.projet_extension,
  };
  const t = lireTravail(brut)!;
  assert.ok(t.projet_extension);
  assert.deepEqual(t.resultat_extension, { refus: [] });
  const v = vueCarteSuivi(t, { jobId: t.id, origine: 'lance', type: 'image', statut: 'termine', machine: null, positionFile: null }, Date.parse('2026-11-14T11:00:00Z'));
  assert.equal(v.existant!.titre, 'Maison existante conservée (projet d’extension)');
  assert.ok(!v.avertissements.some((a) => a.startsWith(PREFIXE_MENTION_CONSERVE)));
  assert.ok(v.avertissements.includes('Terrain supposé plat.'));
  // Travail d'un projet neuf : aucun bloc.
  const neuf = lireTravail({ ...brut, options: { vues: ['face'] }, projet_extension: undefined })!;
  assert.equal(vueCarteSuivi(neuf, { jobId: t.id, origine: 'lance', type: 'image', statut: 'termine', machine: null, positionFile: null }, 0).existant, null);
});

test('X3-F5 : options d’image — « existant » accepté ; « conserver » refusé avec une zone à effacer ; résumé lisible', () => {
  const ok = validerOptions('image', { vues: ['face'], existant: 'conserver' });
  assert.ok(ok.ok);
  assert.equal(ok.ok && (ok.valeur as { existant?: string }).existant, 'conserver');
  assert.equal(validerOptions('image', { existant: 'partiel' }).ok, false);
  const calage = { version: 1, largeur_image: 4032, hauteur_image: 3024, valide_le: '2026-11-12T12:00:00Z', correspondances: [{ image: [1, 1], monde: [2.4, 48.8, 0] }, { image: [2, 2], monde: [2.4, 48.8, 0] }] };
  const masque = { chemin: '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.png', octets: 12345 };
  const refus = validerOptions('image', { fond: 'photo_rue', calage_client: calage, masque_existant: masque, existant: 'conserver' });
  assert.equal(refus.ok, false);
  assert.match(!refus.ok ? refus.erreur : '', /conservée/);
  assert.ok(validerOptions('image', { fond: 'photo_rue', calage_client: calage, masque_existant: masque, existant: 'effacer' }).ok);
  assert.ok(validerOptions('image', { fond: 'photo_rue', calage_client: calage, masque_existant: masque }).ok, 'comportement P5 inchangé');
  assert.match(resumeOptions('image', { vues: ['face'], existant: 'conserver' }), /maison existante conservée/);
  assert.equal(validerOptions('film', { existant: 'conserver' }).ok, false);
});
