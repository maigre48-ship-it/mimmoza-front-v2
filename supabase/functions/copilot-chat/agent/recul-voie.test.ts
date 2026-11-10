// deno test --no-lock --no-check -A supabase/functions/copilot-chat/agent/recul-voie.test.ts
// Lot C10 : préparation du volume (preparerVolume) — recul différencié voie / limites, alignement seulement s'il
// est LU, plafond d'emprise strict, hauteur prudente quand la bande n'est pas appliquée, version du calcul.
// Parcelle réelle : 93048000AS0249 (98 rue de Paris, Montreuil) et ses cinq voisines, fixture du lot C7a.
// Règles : celles réellement lues à l'essai 5 du 10/11/2026 (lot-2a-temoin/RESULTATS.md). Le recul à la voie n'y
// est PAS chiffré (« non réglementé ») : l'alignement n'apparaît ici que comme VALEUR D'ESSAI, dite comme telle.
import * as na from 'node:assert/strict';
import { preparerVolume, VERSION_CALCUL, type ConceptionLue, type IssuePreparation } from './studio.ts';
import { mesurerReculsVolume, verifierBandeVolume } from '../../../../src/spaces/copilot/studio3d/bandePrincipale.ts';

const IDU = '93048000AS0249';
const FX = JSON.parse(Deno.readTextFileSync(new URL('../../../../src/spaces/copilot/studio3d/__fixtures__/cadastre-93048000AS0249.json', import.meta.url)));
const PARCELLE = { idu: IDU, geometrie: FX.parcelle.geometry, surface_m2: 804, source: 'API Carto IGN — cadastre',
  voisines: { statut: 'disponibles', source: 'API Carto IGN — cadastre', parcelles: FX.voisines.map((v: { idu?: string; geometry: unknown }) => ({ idu: v.idu ?? null, geometrie: v.geometry })) } };
const SRC = 'Règlement GPU — PLUi Est Ensemble';
const bande = (principale: number, secondaire: number) => [{ libelle: 'bande principale (18 m)', valeur: principale }, { libelle: 'bande secondaire', valeur: secondaire }];
const PAR_BANDE = [
  { cle: 'emprise_sol_max_pct', valeur: 80, statut: 'confirme', source: SRC, article: 'indice J, p. 237', nature: 'alternative', alternatives: bande(80, 20) },
  { cle: 'hauteur_max_m', valeur: 19.5, statut: 'confirme', source: SRC, article: 'indice b2, p. 263', nature: 'alternative', alternatives: bande(19.5, 13.5) },
  { cle: 'niveaux_max', valeur: 6, statut: 'confirme', source: SRC, article: 'indice b2, p. 263', nature: 'alternative', alternatives: bande(6, 4) },
  { cle: 'pleine_terre_min_pct', valeur: 15, statut: 'confirme', source: SRC, article: 'indice J, p. 237', nature: 'alternative', alternatives: bande(15, 50) },
];
const VOIE_LUE = { cle: 'recul_voie_m', valeur: null, statut: 'confirme', source: SRC, article: 'indice 9, p. 200', nature: 'non_reglementee', texte: 'Il n’est pas fixé de règle' };
const LIMITES_LUES = [
  { cle: 'recul_limites_m', valeur: 3, statut: 'confirme', source: SRC, article: 'indice 1, p. 214' },
  { cle: 'recul_limites_formule', valeur: 'H/2', statut: 'confirme', source: SRC, article: 'indice 1, p. 214' },
];
const VOIE_ESSAI_ALIGNEMENT = { cle: 'recul_voie_m', valeur: 0, statut: 'confirme', source: 'VALEUR D’ESSAI (non lue à Montreuil)', article: 'essai', nature: 'chiffree' };
const conception = (logements: number, regles: unknown[], parcelle: unknown = PARCELLE): ConceptionLue =>
  ({ id: 'c-montreuil-c10', idu: IDU, commune: 'Montreuil', parcelle, regles_plu: regles, programme: { nb_logements: logements } }) as ConceptionLue;
type Prete = Extract<IssuePreparation, { ok: true }>;
const prete = (r: IssuePreparation): Prete => { na.ok(r.ok, r.ok ? '' : r.raison); return r as Prete; };
const controle = (r: Prete, cle: string) => r.resume.controles.find((k) => k.cle === cle)!;

Deno.test('C10-1 : la version du calcul est incrémentée (le volume d’une même conception peut changer)', () => {
  na.equal(VERSION_CALCUL, 'e1-studio-2');
});

Deno.test('C10-2 : Montreuil, règles réellement lues — voie « non réglementée » : recul uniforme, alignement NON supposé, et c’est dit', async () => {
  const r = prete(await preparerVolume(conception(30, [...PAR_BANDE, VOIE_LUE, ...LIMITES_LUES])));
  na.equal(r.volume.bande?.statut, 'appliquee');
  na.equal(r.volume.bande?.reculVoieM, undefined);
  na.deepEqual([r.resume.emprise_batie_m2, r.resume.niveaux, r.resume.sdp_estimee_m2, r.resume.logements_places, r.resume.recul_applique_m], [176, 3, 527, 7, 4.5]);
  na.ok(r.resume.hypotheses.includes('Recul à la voie non réglementé (Règlement GPU — PLUi Est Ensemble, indice 9, p. 200) : aucune valeur chiffrée lue — alignement non supposé, recul prudent conservé côté voie.'));
  na.match(r.resume.hypotheses[0], /^Recul de 4,5 m sur toutes les limites, côté voie compris/);
  const m = mesurerReculsVolume(r.volume)!;
  na.ok(m.voieM >= 4.48 && m.limitesM! >= 4.48, JSON.stringify(m));
  const voie = controle(r, 'recul_voie_m');
  na.equal(voie.regle, 'non réglementé (Règlement GPU — PLUi Est Ensemble, indice 9, p. 200)');
  na.match(voie.explication, /n’en déduit pas l’implantation à l’alignement/);
});

Deno.test('C10-3 : Montreuil, VALEUR D’ESSAI — recul à la voie supposé lu à 0 m : alignement côté voie, H/2 aux autres limites', async () => {
  const r = prete(await preparerVolume(conception(30, [...PAR_BANDE, VOIE_ESSAI_ALIGNEMENT, ...LIMITES_LUES])));
  na.equal(r.volume.bande?.statut, 'appliquee');
  na.deepEqual([r.volume.bande?.reculVoieM, r.volume.bande?.reculLimitesM], [0, 6]);
  na.deepEqual([r.resume.emprise_batie_m2, r.resume.niveaux, r.resume.sdp_estimee_m2, r.resume.logements_places], [168, 4, 672, 9]);
  na.equal(verifierBandeVolume(r.volume).prouvee, true);
  const m = mesurerReculsVolume(r.volume)!;
  na.ok(m.voieM < 0.5 && m.limitesM! >= 5.98, JSON.stringify(m));
  na.match(r.resume.hypotheses[0], /^Côté voie : implantation à l’alignement \(recul 0 m\), permise par la règle lue \(VALEUR D’ESSAI \(non lue à Montreuil\), essai\)/);
  na.equal(controle(r, 'recul_voie_m').valeur_volume, '0,25 m du côté voie présumé (mesuré)');
  na.notEqual(controle(r, 'recul_limites_m').verdict, 'au_dela');
  na.match(r.resume.regles_non_appliquees.join(' | '), /recul_voie_m : 0 m \(implantation à l’alignement autorisée\) — appliqué côté voie seulement si la règle est confirmée et citée/);
});

Deno.test('C10-4 : alignement seulement ESTIMÉ (non confirmé) : non appliqué, même volume que sans la règle', async () => {
  const estimee = { ...VOIE_ESSAI_ALIGNEMENT, statut: 'estime' };
  const r = prete(await preparerVolume(conception(30, [...PAR_BANDE, estimee])));
  const sans = prete(await preparerVolume(conception(30, PAR_BANDE)));
  na.equal(r.volume.bande?.reculVoieM, undefined);
  na.deepEqual(r.volume.batiments, sans.volume.batiments);
  na.deepEqual([sans.resume.emprise_batie_m2, sans.resume.niveaux, sans.resume.recul_applique_m], [196, 6, 4]);
  na.ok(r.resume.hypotheses.some((h) => /Recul à la voie de 0 m \(alignement\) non confirmé \(règle estimée\) — alignement non supposé/.test(h)));
});

Deno.test('C10-5 : sans parcelles voisines (côté voie non situé) — plafond prudent STRICT et hauteur la plus contraignante des bandes', async () => {
  const r = prete(await preparerVolume(conception(40, [...PAR_BANDE, VOIE_ESSAI_ALIGNEMENT], { ...PARCELLE, voisines: undefined })));
  na.equal('bande' in r.volume, false);
  // Défaut C : 160 m² pour 163,2 m² autorisés (avant : 168 m², 20,6 % pour 20 %). Défaut D : 4 niveaux (13,5 m), et non 6 (19,5 m).
  na.deepEqual([r.resume.emprise_batie_m2, r.resume.emprise_pct, r.resume.niveaux, r.resume.hauteur_indicative_m], [160, 19.6, 4, 12]);
  na.ok(r.resume.emprise_batie_m2 <= 0.2 * r.resume.surface_parcelle_m2);
  na.match(r.resume.regles_non_appliquees.join(' | '), /Règle par bande, hauteur \(bande principale de 18 m depuis la voie : 19,5 m ; bande secondaire : 13,5 m\) — le volume d’étude n’est pas situé dans la bande principale : 13,5 m appliqué, et non 19,5 m/);
  // L'alignement fourni n'a aucun effet sans côté voie : le recul reste celui du calcul d'origine (4 m par défaut).
  na.equal(r.resume.recul_applique_m, 4);
  na.match(r.resume.regles_non_appliquees.join(' | '), /recul_voie_m : 0 m \(implantation à l’alignement autorisée\) — le volume garde le recul des limites séparatives/);
  na.match(controle(r, 'hauteur_max_m').regle!, /^13,5 m max\. \(valeur la plus contraignante des bandes\)/);
});

Deno.test('C10-6 : lecture RÉELLE du lot C9 (« Sur les limites séparatives ou en retrait », indice 1, p. 208) — permission signalée, retrait conservé', async () => {
  // Le lot C9 corrige la lecture dans conception.ts (fichier que ce lot ne modifie pas). S'il n'est pas dans la base, rien à vérifier ici.
  const c9 = await import('./conception.ts') as unknown as { reglesDepuisLecture?: (lecture: unknown, origine: string, source: string) => { cle: string; valeur: unknown }[]; LIBELLE_SUR_LIMITE?: string };
  if (typeof c9.reglesDepuisLecture !== 'function' || typeof c9.LIBELLE_SUR_LIMITE !== 'string') return;
  const INDICE_1 = 'Sur les limites séparatives ou en retrait. • Retrait minimum : H/2 et 3 mètres • Distance minimum : H/2 et 6 mètres';
  const lues = c9.reglesDepuisLecture({ regles: [
    { cle: 'recul_limites_m', valeur: 3, article: 'indice 1, p. 208', texte: INDICE_1 },
    { cle: 'recul_limites_formule', valeur: 'H/2 min 3 m', article: 'indice 1, p. 208', texte: INDICE_1 },
  ] }, 'gpu', SRC);
  na.equal(lues.find((x) => x.cle === 'recul_limites_m')!.valeur, 0);
  const r = prete(await preparerVolume(conception(30, [...PAR_BANDE, VOIE_LUE, ...lues])));
  // Le moteur NE construit PAS en limite (donnée pas encore tenue pour fiable) : retrait H/2, minimum 3 m, partout — et il le dit.
  na.equal(r.volume.bande?.statut, 'appliquee');
  na.deepEqual([r.resume.emprise_batie_m2, r.resume.niveaux, r.resume.recul_applique_m], [176, 3, 4.5]);
  na.ok(r.resume.hypotheses.includes('Implantation en limite séparative permise selon la règle lue : NON appliquée dans ce volume d’étude (retrait conservé sur les limites autres que la voie), ce qui peut sous-estimer l’emprise possible.'));
  na.match(r.resume.regles_non_appliquees.join(' | '), /recul_limites_m : 0 m \(implantation en limite séparative permise\) — non appliqué : le volume garde un retrait sur les limites séparatives/);
  const m = mesurerReculsVolume(r.volume)!;
  na.ok(m.limitesM! >= 4.48, JSON.stringify(m));
});
