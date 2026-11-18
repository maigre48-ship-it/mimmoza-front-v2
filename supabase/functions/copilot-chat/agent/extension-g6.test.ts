// supabase/functions/copilot-chat/agent/extension-g6.test.ts
// LOT G6 (18/11/2026) — plan de la maison lu dans le Studio (lecture D7a, sans modèle de langage), confirmé dans la
// carte « Plan lu » du chat, repris par le parcours d'extension : ligne « Emprise lue sur votre plan », écart > 10 %
// avec la BD TOPO signalé, niveaux confirmés, puce « Celle de mon plan » pour la surface de plancher, plan gardé d'un
// tour à l'autre, repris dans la fiche des plans de l'extension (`existant_lu`).
// Données RÉELLES : src/spaces/copilot/studio3d/__fixtures__/extension-x3-reel.json (930470000P0646, 104 m² BD TOPO).
import * as na from 'node:assert/strict';
import { type BatimentBdTopo } from '../../_shared/extension/bdtopoParcelle.ts';
import { avancerParcours, ETAT_INITIAL, lireEtat, Q, type ContexteParcours, type EtatParcours, type SortieParcours } from '../../_shared/extension/parcours.ts';
import {
  CONSIGNE_PLAN_JOINT, effetsPlanLu, existantLuPourFiche, lirePlanLu, MARQUEUR_PLAN_JOINT, OPTION_SURFACE_PLAN, planJointAuMessage, planLuRetenu,
  type PlanLuParcours,
} from '../../_shared/extension/planLu.ts';
import { empriseBdTopoDeLaVue, ficheAvecProjetExtension, projetDesSorties, reglesDeLaConception, resultatParcours } from './extension.ts';
import { facadesVoieDeLaParcelle } from './voisines-parcelle.ts';

const FX = JSON.parse(Deno.readTextFileSync(new URL('../../../../src/spaces/copilot/studio3d/__fixtures__/extension-x3-reel.json', import.meta.url)));
type SiteFx = { idu: string; contourWgs84: [number, number][]; surParcelle: string[]; batiments: BatimentBdTopo[] };
const IDU = '930470000P0646';
const SITE: SiteFx = FX.bdtopo.sites.find((s: SiteFx) => s.idu === IDU);
const C = FX.conceptionP0646;
const JARGON = /\b(?:serveur|la fiche|moteur|D7a|lot)\b/i;

function contexte(planLu: PlanLuParcours | null = null): ContexteParcours {
  const fac = facadesVoieDeLaParcelle(C.parcelle);
  return {
    idu: IDU, commune: 'Montfermeil', contourWgs84: SITE.contourWgs84, surfaceParcelleM2: C.parcelle.surface_m2 ?? null,
    batiments: SITE.batiments, raisonBdTopo: null, dateBdTopo: '2026-11-18', bdnb: null, noteBdnb: null,
    zoneU: { valeur: true, source: 'zone UC du PLU (test)' }, regles: reglesDeLaConception(C.regles_plu),
    facadesVoie: fac.facades.map((f: { debut: [number, number]; fin: [number, number] }) => ({ debut: f.debut, fin: f.fin })), raisonFacades: fac.raison,
    ...(planLu ? { planLu } : {}),
  } as ContexteParcours;
}

/** Joue des tours ; `plans[i]` = plan lu transmis par la page au tour i (absent : rien de nouveau ce tour-là). */
function jouer(messages: string[], plans: (PlanLuParcours | null)[] = [], depuis: SortieParcours | null = null): SortieParcours[] {
  const out: SortieParcours[] = [];
  let etat: EtatParcours = depuis ? depuis.etat : ETAT_INITIAL;
  let attendues: readonly string[] = depuis ? depuis.attendues : [];
  messages.forEach((m, i) => {
    const s = avancerParcours(etat, m, attendues, contexte(plans[i] ?? null));
    out.push(s);
    etat = lireEtat(JSON.parse(JSON.stringify(s.etat))); attendues = s.attendues;
  });
  return out;
}

/** Contexte de la page tel que le site l'envoie (valeurs simples). */
function snapshot(o: Partial<Record<string, string | number | null>> = {}): Record<string, string | number | null> {
  return {
    plan_summary: 'Relevé de l’existant validé dans le Studio', plan_lu_v: 1, plan_lu_source: 'import-plan', plan_lu_origine: 'plan-rdc-etage.pdf',
    plan_lu_le: '2026-11-18', plan_lu_longueur_m: 11.9, plan_lu_largeur_m: 8.0, plan_lu_dimensions_statut: 'lu',
    plan_lu_emprise_m2: 101.5, plan_lu_emprise_statut: 'lu', plan_lu_niveaux: 2, plan_lu_niveaux_statut: 'deduit',
    plan_lu_surface_pieces_m2: 132.4, plan_lu_surface_pieces_statut: 'deduit', plan_lu_nb_pieces: 9,
    plan_lu_echelle: '1/100 (déduite des cotes écrites sur le plan)', plan_lu_douteux: null, ...o,
  };
}

const DEBUT = ['Je voudrais agrandir ma maison', 'Maison existante : Conserver la maison'];
const TYPE = 'Toit de la maison : 2 pans · Niveaux de la maison : R+1 · Type d’extension : Arrière · Façade (vue de la rue) : À l’arrière';
const DIM = 'Dimensions (largeur × profondeur) : 4 × 5 m · Hauteur de l’extension : Même hauteur que la maison · égout 5,2 m';

Deno.test('G6-1 : le plan lu est relu depuis le contexte de la page, borné ; une valeur sans statut ou hors bornes est ignorée', () => {
  const p = lirePlanLu(snapshot())!;
  na.equal(p.source, 'import-plan');
  na.equal(p.longueurM, 11.9); na.equal(p.largeurM, 8); na.equal(p.statutDimensions, 'lu');
  na.equal(p.empriseM2, 101.5); na.equal(p.niveaux, 2); na.equal(p.statutNiveaux, 'deduit');
  na.equal(p.surfacePiecesM2, 132.4); na.equal(p.nbPieces, 9);
  // Sans statut : la valeur n'est pas reprise (jamais un statut supposé à sa place).
  const q = lirePlanLu(snapshot({ plan_lu_emprise_statut: null, plan_lu_niveaux: 2.5, plan_lu_surface_pieces_m2: -3 }))!;
  na.equal(q.empriseM2, null); na.equal(q.niveaux, null); na.equal(q.surfacePiecesM2, null);
  na.equal(lirePlanLu({ plan_summary: 'ancien relevé sans plan_lu' }), null);
  na.equal(lirePlanLu(snapshot({ plan_lu_source: 'gpt' })), null);
  // Forme stockée (état du parcours) : relue à l'identique.
  na.deepEqual(lirePlanLu(JSON.parse(JSON.stringify(p))), p);
});

Deno.test('G6-2 : plan cohérent (101,5 m² lus pour 104 m² BD TOPO) → ligne « Emprise lue sur votre plan », source datée, aucun écart signalé', () => {
  const r = jouer([...DEBUT], [null, lirePlanLu(snapshot())]);
  const s = r.at(-1)!;
  na.equal(s.etape, 'confirmer', s.texte);
  const l = s.vue.maison!.lignes.find((x) => x.libelle === 'Emprise lue sur votre plan')!;
  na.ok(l, JSON.stringify(s.vue.maison!.lignes));
  na.match(l.valeur, /101,5|102 m²|101 m²/);
  na.match(l.valeur, /11,9 × 8 m hors tout/);
  na.equal(l.statut, 'mesuree');
  na.match(l.source, /lu dans le Studio, le 18\/11\/2026 — lecture automatique, sans modèle de langage ; échelle 1\/100/);
  na.ok(s.vue.sources.some((x) => /Plan de la maison fourni par vous \(« plan-rdc-etage\.pdf »\)/.test(x)));
  na.ok(!s.vue.avertissements.some((x) => /plus de 10 %/.test(x)));
  // L'emprise BD TOPO (mesurée) reste la ligne du calcul.
  na.equal(s.vue.maison!.lignes[0]!.libelle, 'Emprise au sol');
  na.match(s.texte, /Emprise lue sur votre plan/);
  na.doesNotMatch(s.texte, JARGON);
});

Deno.test('G6-3 : écart de plus de 10 % (150 m² lus pour 104 m²) → SIGNALÉ ; le calcul de l’extension est inchangé (contour BD TOPO)', () => {
  const plan = lirePlanLu(snapshot({ plan_lu_emprise_m2: 150 }))!;
  const e = effetsPlanLu(plan, 104);
  na.ok(e.ecartSignale); na.ok(e.ecartPct! > 40);
  const avec = jouer([...DEBUT, TYPE, DIM, 'Surface de plancher existante : Je ne sais pas · Demandeur : Particulier'], [lirePlanLu(snapshot({ plan_lu_emprise_m2: 150 }))]);
  const sans = jouer([...DEBUT, TYPE, DIM, 'Surface de plancher existante : Je ne sais pas · Demandeur : Particulier']);
  const g = avec.at(-1)!, h = sans.at(-1)!;
  na.equal(g.etape, 'termine', g.texte);
  na.ok(g.vue.avertissements.some((x) => /150 m² contre 104 m² dans la BD TOPO \(écart \+4\d %, plus de 10 %\)/.test(x)), g.vue.avertissements.join(' | '));
  na.ok(g.vue.avertissements.some((x) => /l’extension reste calculée sur le contour de la BD TOPO/.test(x)));
  // Même résultat de calcul (géométrie de l'existant inchangée).
  na.deepEqual(g.resultatMoteur?.volume, h.resultatMoteur?.volume);
  na.equal(g.resultatMoteur?.ok, h.resultatMoteur?.ok);
});

Deno.test('G6-4 : niveaux CONFIRMÉS dans la carte « Plan lu » → la question « Niveaux de la maison » n’est plus posée', () => {
  const s = jouer([...DEBUT], [null, lirePlanLu(snapshot({ plan_lu_niveaux_statut: 'confirme' }))]).at(-1)!;
  na.ok(!s.attendues.includes(Q.niveaux.id), s.attendues.join(','));
  na.ok(s.attendues.includes(Q.toit.id));
  na.equal(s.etat.niveaux, 2);
  na.ok(s.vue.avertissements.some((x) => /Niveaux de la maison : 2, confirmés par vous sur votre plan/.test(x)));
  // Niveaux seulement DÉDUITS : la question reste posée.
  const t = jouer([...DEBUT], [null, lirePlanLu(snapshot())]).at(-1)!;
  na.ok(t.attendues.includes(Q.niveaux.id));
});

Deno.test('G6-5 : surface des pièces lue → puce « Celle de mon plan (≈ 132 m²) » ; la choisir retient 132 m² et le dit ; le plan est gardé d’un tour à l’autre', () => {
  const r = jouer([...DEBUT, TYPE, DIM], [lirePlanLu(snapshot())]);
  const s = r.at(-1)!;
  na.equal(s.etape, 'surface', s.texte);
  na.match(String(s.blocChoix), new RegExp(`${OPTION_SURFACE_PLAN} \\(≈ 132 m²\\)`));
  na.match(s.texte, /Votre plan donne \*\*132 m² de pièces\*\* \(9 pièces\) \(déduit de votre plan\) : c’est la somme des pièces, proche de la surface de plancher sans lui être égale\./);
  // Le plan n'a été transmis qu'au 1er tour : il est encore là (état relu).
  na.equal(s.etat.planLu?.surfacePiecesM2, 132.4);
  const fin = jouer(['Surface de plancher existante : Celle de mon plan (≈ 132 m²) · Demandeur : Particulier'], [], s).at(-1)!;
  na.equal(fin.etat.sdpExistanteM2, 132);
  na.ok(fin.vue.avertissements.some((x) => /Surface de plancher existante retenue : somme des pièces de votre plan \(choisie par vous\)/.test(x)), fin.vue.avertissements.join(' | '));
  na.equal(fin.etape, 'termine', fin.texte);
});

Deno.test('G6-6 : cotes SAISIES (repli quand la lecture échoue) → « Emprise d’après vos cotes », statut confirmée', () => {
  const p = lirePlanLu({ plan_lu_v: 1, plan_lu_source: 'saisie', plan_lu_le: '2026-11-18', plan_lu_longueur_m: 12, plan_lu_largeur_m: 8.5, plan_lu_dimensions_statut: 'confirme' })!;
  const s = jouer([...DEBUT], [null, p]).at(-1)!;
  const l = s.vue.maison!.lignes.find((x) => x.libelle === 'Emprise d’après vos cotes')!;
  na.ok(l);
  na.equal(l.statut, 'confirmee');
  na.match(l.valeur, /102 m², 12 × 8,5 m hors tout, écart -2 % avec la BD TOPO/);
  na.match(l.source, /Cotes de la maison saisies par vous, le 18\/11\/2026 ; emprise = longueur × largeur hors tout/);
});

Deno.test('G6-7 : le plus récent l’emporte ; un plan plus ancien reçu de la page ne remplace pas celui de l’état', () => {
  const ancien = lirePlanLu(snapshot({ plan_lu_le: '2026-11-10', plan_lu_origine: 'vieux.pdf' }))!;
  const recent = lirePlanLu(snapshot())!;
  na.equal(planLuRetenu(recent, ancien)!.origine, 'plan-rdc-etage.pdf');
  na.equal(planLuRetenu(ancien, recent)!.origine, 'plan-rdc-etage.pdf');
  na.equal(planLuRetenu(null, recent), recent);
  na.equal(planLuRetenu(recent, null), recent);
});

Deno.test('G6-8 : plan joint au message → consigne au modèle : aucune cote du plan citée ni estimée', () => {
  const s = jouer([...DEBUT]).at(-1)!;
  na.ok(planJointAuMessage(`Voici mon plan ${MARQUEUR_PLAN_JOINT} : « plan.pdf », lu dans le Studio]`));
  na.ok(!planJointAuMessage('Voici mon plan'));
  na.match(CONSIGNE_PLAN_JOINT, /ne cite, n’estime ni ne calcule aucune cote/);
  na.doesNotMatch(resultatParcours(s).message, /PAS par toi/);
});

Deno.test('G6-9 : le plan lu part avec le projet vers les plans de l’extension (`fiche.existant_lu`, statuts compris)', () => {
  const r = jouer([...DEBUT, TYPE, DIM, 'Surface de plancher existante : Je ne sais pas · Demandeur : Particulier'], [lirePlanLu(snapshot())]);
  const g = r.at(-1)!;
  na.ok(g.projet, 'projet attendu');
  const sortie = resultatParcours(g).data as Record<string, unknown>;
  const ext = projetDesSorties([JSON.parse(JSON.stringify(sortie))])!;
  na.ok(ext.existantLu, 'existantLu attendu');
  na.equal(ext.existantLu!.emprise_m2, 101.5);
  na.equal(ext.existantLu!.ecart_signale, false);
  na.equal(ext.existantLu!.ecart_bdtopo_pct, -2.4);
  const fiche = ficheAvecProjetExtension({ titre: 'x' }, ext.projet, ext.existantLu);
  na.equal((fiche as Record<string, Record<string, unknown>>).existant_lu.origine, 'plan-rdc-etage.pdf');
  // Sans plan : rien n'est ajouté.
  const sans = projetDesSorties([JSON.parse(JSON.stringify(resultatParcours(jouer([...DEBUT, TYPE, DIM, 'Surface de plancher existante : Je ne sais pas · Demandeur : Particulier']).at(-1)!).data))])!;
  na.equal(sans.existantLu, undefined);
  na.ok(!('existant_lu' in ficheAvecProjetExtension({ titre: 'x' }, sans.projet, sans.existantLu)));
  na.equal(empriseBdTopoDeLaVue([{ libelle: 'Emprise au sol', valeur: '1 204 m²' }]), 1204);
  na.equal(empriseBdTopoDeLaVue([{ libelle: 'Autre', valeur: '104 m²' }]), null);
  na.equal(existantLuPourFiche(lirePlanLu(snapshot())!, null).ecart_bdtopo_pct, null);
});

Deno.test('G6-10 : la validation de la carte « Plan lu » (sans nombre) et un plan joint relancent le parcours ; rien n’est lu comme dimensions de l’extension', async () => {
  const { messagePlanPourLeParcours } = await import('../../_shared/extension/planLu.ts');
  na.ok(messagePlanPourLeParcours('Plan de la maison : valeurs vérifiées dans la carte « Plan lu ».'));
  na.ok(messagePlanPourLeParcours(`Voici le plan\n\n${MARQUEUR_PLAN_JOINT} : « plan.pdf » — lu par Mimmoza dans le Studio, sans le modèle de langage]`));
  na.ok(!messagePlanPourLeParcours('Quel plan de financement ?'));
  const s = jouer([...DEBUT, TYPE, 'Plan de la maison : valeurs vérifiées dans la carte « Plan lu ».'], [null, null, null, lirePlanLu(snapshot())]).at(-1)!;
  na.equal(s.etat.largeurM, null); na.equal(s.etat.profondeurM, null);
  na.equal(s.etat.planLu?.origine, 'plan-rdc-etage.pdf');
});

Deno.test('G6-11 : chaîne de bout en bout — résumé RÉEL du Studio → carte du site (niveaux confirmés) → contexte de la page → parcours', async () => {
  const { lirePlanLuStudio, confirmerValeur, contextePlanLu } = await import('../../../../src/spaces/copilot/studio3d/planLuChat.ts');
  const brut = JSON.parse(Deno.readTextFileSync(new URL('../../../../src/spaces/copilot/studio3d/__fixtures__/plan-lu-studio-g6.json', import.meta.url)));
  const site = confirmerValeur(lirePlanLuStudio(brut, 'x', Date.UTC(2026, 10, 18))!, 'niveaux');
  const p = lirePlanLu(contextePlanLu(site))!;
  na.equal(p.origine, 'niveau-0.dxf, niveau-1.dxf');
  na.equal(p.statutNiveaux, 'confirme');
  const s = jouer([...DEBUT], [null, p]).at(-1)!;
  na.equal(s.etat.niveaux, 2);
  // Maison de référence 92 m² sur la maison P0646 (104 m²) : écart de -11 % → signalé.
  na.ok(s.vue.avertissements.some((x) => /92 m² contre 104 m² dans la BD TOPO \(écart -11 %, plus de 10 %\)/.test(x)), s.vue.avertissements.join(' | '));
});
