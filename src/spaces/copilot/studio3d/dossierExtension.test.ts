// LOT D9 (16/11/2026) — « Préparer mon dossier » côté front : aperçu du serveur relu défensivement, bouton seulement en fin
// de parcours (deux boutons si « DP ou PC »), rendus LIVRÉS seulement (jamais « à valider »), bloc `dossier` sans valeur
// estimée, et transport : `projetExtension` + `dossier` joints au message « projet » sans écraser le contrat.
import assert from 'node:assert/strict';
import test from 'node:test';
import { blocDossierPourStudio, etatPreparerDossier, lireVueDossier, rendusLivresPourDossier, verifierPreparationDossier } from './dossierExtension.ts';
import { lireVueExtension } from './extensionMaison.ts';
import { demarrerPoigneeDeMain, type Minuterie } from '../../promoteur/shared/echangeStudio/transportStudio.ts';
import { lireProjetExtension } from '../../../../supabase/functions/_shared/extension/contrat.ts';
import { dossierPrevisionnel } from '../../../../supabase/functions/_shared/extension/dossier.ts';
import type { TravailStudio } from '../../../lib/studio/travauxLogique.ts';

const MAISON = 'BATIMENT0000000312986202';
const PROJET_BRUT = {
  format: 'mimmoza-projet-extension', version: 1, nature: 'extension', modeExistantParDefaut: 'conserver', demandeur: 'particulier',
  existants: [{ id: MAISON, source: 'bdtopo', mode: 'conserver', surfacePlancherM2: { valeur: 118, statut: 'confirmee', source: 'saisie' } }],
  extension: { type: 'arriere', facade: { cote: 'arriere' }, existantId: MAISON, dimensions: { largeurM: { valeur: 5, statut: 'confirmee', source: 'parcours' }, profondeurM: { valeur: 4, statut: 'confirmee', source: 'parcours' } } },
};
const PROJET = (() => { const l = lireProjetExtension(PROJET_BRUT); if (!l.ok) throw new Error('projet'); return l.projet; })();
const sortie = (dossier: unknown, etape = 'termine', verdict = 'ok') => ({
  status: 'ok',
  data: { projet_extension: PROJET_BRUT, vue: { v: 1, etape, idu: '930470000P0646', commune: 'Montfermeil', maison: null, extension: { type: 'Arrière', verdict, refus: [], alertes: [] }, regles: [], regime: null, avertissements: [], sources: [], dossier } },
});

test('D9-F1 aperçu du serveur relu ; bouton seulement en fin de parcours, extension placée ; « DP ou PC » → deux boutons', () => {
  const v = lireVueExtension(sortie(dossierPrevisionnel('DP', null)))!;
  assert.equal(v.dossier!.pieces.DP!.length, 8);
  assert.deepEqual(etatPreparerDossier(v).boutons.map((b) => b.libelle), ['Préparer mon dossier']);
  assert.equal(etatPreparerDossier(lireVueExtension(sortie(dossierPrevisionnel('DP', null), 'surface'))!).visible, false);
  assert.equal(etatPreparerDossier(lireVueExtension(sortie(dossierPrevisionnel('DP', null), 'termine', 'refus'))!).visible, false);
  const deux = lireVueExtension(sortie(dossierPrevisionnel('DP ou PC', 'oui')))!;
  assert.deepEqual(etatPreparerDossier(deux).boutons.map((b) => [b.regime, b.libelle]), [['DP', 'Préparer un dossier DP'], ['PC', 'Préparer un dossier PC']]);
  assert.match(etatPreparerDossier(deux).question!, /déclaration préalable ou d’un permis/);
  assert.equal(etatPreparerDossier(lireVueExtension(sortie(dossierPrevisionnel('inconnu', null)))!).visible, false);
  // Lecture défensive : code de pièce inconnu écarté, régime inconnu → null.
  assert.equal(lireVueDossier({ v: 1, regimeIndicatif: 'autre' }), null);
  assert.deepEqual(lireVueDossier({ v: 1, regimeIndicatif: 'DP', choix: ['DP'], pieces: { DP: [{ code: 'get_x', intitule: 'x' }, { code: 'DP1', intitule: 'Plan', origine: 'studio' }] } })!.pieces.DP!.map((p) => p.code), ['DP1']);
});

test('D9-F2 contrôles avant ouverture : parcours terminé, régime cohérent, préparation 3D présente (messages lisibles)', () => {
  const vue = lireVueExtension(sortie(dossierPrevisionnel('DP ou PC', null)))!;
  assert.equal(verifierPreparationDossier({ conversationId: null, vue, ficheDisponible: true, regime: 'DP' }).ok, false);
  const sansFiche = verifierPreparationDossier({ conversationId: 'c', vue, ficheDisponible: false, regime: 'PC' });
  assert.ok(!sansFiche.ok && /voir en 3D/.test(sansFiche.message));
  const ok = verifierPreparationDossier({ conversationId: 'c', vue, ficheDisponible: true, regime: 'PC' });
  assert.ok(ok.ok && ok.projet.existants[0]!.id === MAISON);
  const dpSeul = lireVueExtension(sortie(dossierPrevisionnel('DP', null)))!;
  assert.equal(verifierPreparationDossier({ conversationId: 'c', vue: dpSeul, ficheDisponible: true, regime: 'PC' }).ok, false);
});

const travail = (id: string, statut: string, x7: unknown = undefined, pm = 'livre'): TravailStudio => ({
  id, conversation_id: 'c', type: 'image', statut: 'termine', progression: 100, etape: null, options: {}, elements_omis: [], erreur: null,
  cree_le: '2026-11-15T10:00:00Z', maj_le: '2026-11-15T10:00:00Z', demarre_le: null, termine_le: '2026-11-15T10:05:00Z',
  projet_extension: PROJET_BRUT,
  ...(x7 !== undefined ? { resultat_extension: x7 } : {}),
  resultat: { image_path: 'a', qualite: 'finale', avertissements: [], images: [{ vue: 'face', libelle: `Vue de face ${statut}`, jpeg_path: `u/${id}/face.jpg`, png_path: null, largeur: 10, hauteur: 10 }],
    photomontage: { tente: true, statut: pm as 'livre', raison: null, verdict: 'cale', incertitude_m: 0.2, source_photo: null, mention: null, atelier: null, existant: null } },
} as TravailStudio);

test('D9-F3 rendus proposables : photomontages LIVRÉS seulement (pas « à valider », pas d’étude) ; aucun choisi d’office', () => {
  const r = rendusLivresPourDossier([travail('a', 'livré'), travail('b', 'à valider', { statut_x7: 'a_valider', livrable: false }), travail('c', 'étude', undefined, 'repli_etude'), travail('d', 'livrable', { statut_x7: 'livrable', livrable: true })]);
  assert.deepEqual(r.map((x) => x.id), ['a:face', 'd:face']);
  assert.equal(r[0]!.date, '15/11/2026');
  assert.match(r[0]!.statut, /livré \(calé\)/);
});

test('D9-F4 bloc `dossier` : surface SAISIE seulement, demandeur du projet, secteur, URL https ; jointure au message « projet »', () => {
  const d = lireVueDossier(dossierPrevisionnel('DP ou PC', 'oui'))!;
  const b = blocDossierPourStudio({ regime: 'PC', dossier: d, secteur: { etat: 'oui', date: '14/11/2026' }, projet: PROJET, rendus: [{ id: 'a', libelle: 'Vue', url: 'https://x.supabase.co/s', date: null, statut: 'livré' }, { id: 'b', libelle: 'x', url: 'http://pas-sur', date: null, statut: 'livré' }] });
  assert.deepEqual([b.format, b.version, b.regime, b.regimeIndicatif, b.surfaceExistanteM2, b.demandeur], ['mimmoza-dossier-extension', 1, 'PC', 'DP ou PC', 118, 'particulier']);
  assert.match(b.provenance, /PC choisi par la personne/);
  assert.deepEqual(b.secteurProtege!.valeur, true);
  assert.deepEqual(b.rendus.map((r) => r.id), ['a']);
  const estimee = lireProjetExtension({ ...PROJET_BRUT, existants: [{ ...PROJET_BRUT.existants[0], surfacePlancherM2: { valeur: 183, statut: 'estimee', source: 'BD TOPO' } }] });
  assert.ok(estimee.ok);
  if (estimee.ok) assert.equal(blocDossierPourStudio({ regime: 'DP', dossier: d, secteur: null, projet: estimee.projet, rendus: [] }).surfaceExistanteM2, null);
  // Transport : compléments joints au message « projet », clés du contrat prioritaires.
  let tic: (() => void) | null = null;
  const minuterie: Minuterie = { setInterval: (f) => { tic = f; return 1; }, clearInterval: () => { tic = null; }, maintenant: () => 0 };
  const recus: Record<string, unknown>[] = [];
  const onglet = { closed: false, postMessage: (m: unknown) => { recus.push(m as Record<string, unknown>); } };
  const sid = '0b0b2c1e-5a4f-4d2b-9a7c-1f2e3d4c5b6a';
  const h = demarrerPoigneeDeMain(onglet, 'http://localhost:5174', sid, { session: { id: sid } } as never, { minuterie, complements: { projetExtension: PROJET_BRUT, dossier: b, canal: 'pirate' } });
  tic!();
  h.surPret(true);
  const projet = recus.find((m) => m['canal'] === 'projet')!;
  assert.ok(projet, 'message projet envoyé');
  assert.deepEqual([projet['canal'], (projet['dossier'] as { regime: string }).regime, (projet['projetExtension'] as { nature: string }).nature], ['projet', 'PC', 'extension']);
});
