// supabase/functions/copilot-chat/agent/extension-x8b.test.ts
// LOT X8b (17/11/2026) — essai d'Albé sur 930470000P0646 : maison R+1 (2 niveaux), égout 5,2 m confirmé, extension
// latérale gauche 4 × 5 m « Sur 2 niveaux ». Avant : 2 × 3 m = 6,00 m > 5,20 m → refus « cochez « même hauteur » »,
// sans aucune case à cocher dans le chat (impasse). Après : autant de niveaux que la maison → même hauteur (égout et
// niveaux de l'existant, statut et source hérités) ; plus de niveaux que la maison → refus avec les choix réels en puces.
// Données RÉELLES : src/spaces/copilot/studio3d/__fixtures__/extension-x3-reel.json.
import * as na from 'node:assert/strict';
import { type BatimentBdTopo } from '../../_shared/extension/bdtopoParcelle.ts';
import {
  avancerParcours, ETAT_INITIAL, HAUTEUR_MEME, lireEtat, lireReponses, Q, reponseAuParcours,
  type ContexteParcours, type EtatParcours, type SortieParcours,
} from '../../_shared/extension/parcours.ts';
import { PREFIXE_REFUS_HAUTEUR } from '../../_shared/extension/moteur.ts';
import { phraseDeRelance, reglesDeLaConception, resultatParcours } from './extension.ts';
import { facadesVoieDeLaParcelle } from './voisines-parcelle.ts';

const FX = JSON.parse(Deno.readTextFileSync(new URL('../../../../src/spaces/copilot/studio3d/__fixtures__/extension-x3-reel.json', import.meta.url)));
type SiteFx = { idu: string; contourWgs84: [number, number][]; surParcelle: string[]; batiments: BatimentBdTopo[] };
const IDU = '930470000P0646';
const SITE: SiteFx = FX.bdtopo.sites.find((s: SiteFx) => s.idu === IDU);
const C = FX.conceptionP0646;
const JARGON = /\b(?:serveur|la fiche|moteur|cochez|cocher)\b/i;

function contexte(): ContexteParcours {
  const fac = facadesVoieDeLaParcelle(C.parcelle);
  return {
    idu: IDU, commune: 'Montfermeil', contourWgs84: SITE.contourWgs84, surfaceParcelleM2: C.parcelle.surface_m2 ?? null,
    batiments: SITE.batiments, raisonBdTopo: null, dateBdTopo: '2026-11-17', bdnb: null, noteBdnb: null,
    zoneU: { valeur: true, source: 'zone UC du PLU (test)' }, regles: reglesDeLaConception(C.regles_plu),
    facadesVoie: fac.facades.map((f: { debut: [number, number]; fin: [number, number] }) => ({ debut: f.debut, fin: f.fin })), raisonFacades: fac.raison,
  } as ContexteParcours;
}

function jouer(messages: string[], depuis: SortieParcours | null = null): SortieParcours[] {
  const out: SortieParcours[] = [];
  let etat: EtatParcours = depuis ? depuis.etat : ETAT_INITIAL;
  let attendues: readonly string[] = depuis ? depuis.attendues : [];
  for (const m of messages) {
    const s = avancerParcours(etat, m, attendues, contexte());
    out.push(s);
    // Comme en production : l'état est sérialisé puis relu d'un tour à l'autre.
    etat = lireEtat(JSON.parse(JSON.stringify(s.etat))); attendues = s.attendues;
  }
  return out;
}

const DEBUT = [
  'Je voudrais agrandir ma maison',
  'Maison existante : Conserver la maison',
  'Toit de la maison : 2 pans · Niveaux de la maison : R+1 · Type d’extension : Latérale · Façade (vue de la rue) : À gauche',
  'égout 5,2 m',
];
const FIN = 'Surface de plancher existante : Je ne sais pas · Demandeur : Particulier';

const DIM_ESSAI = 'Dimensions (largeur × profondeur) : 4 × 5 m · Hauteur de l’extension : Sur 2 niveaux';
const ARRIERE = 'Façade (vue de la rue) : À l’arrière';

Deno.test('X8b-1 : l’essai d’Albé (R+1, égout 5,2 m confirmé, latérale gauche 4 × 5 m « Sur 2 niveaux ») : plus de refus de hauteur ; le côté gauche n’a pas la place, l’arrière est proposé et donne un gabarit à 5,2 m', () => {
  const r = jouer([...DEBUT, DIM_ESSAI, FIN]);
  const g = r.at(-1)!;
  na.equal(g.etape, 'termine', g.texte);
  // La hauteur n'est plus un motif de refus : 2 niveaux sur une maison à 2 niveaux = même hauteur que la maison.
  na.ok(!g.resultatMoteur!.refus.some((x) => x.startsWith(PREFIXE_REFUS_HAUTEUR)), g.resultatMoteur!.refus.join(' | '));
  na.match(g.texte, /même hauteur que la maison \(2 niveaux, égout 5,2 m\)/);
  // Données réelles P0646 : la maison touche presque la limite de gauche — refus de placement, mais pas d'impasse.
  na.equal(g.resultatMoteur!.ok, false);
  na.match(g.texte, /Hors parcelle/);
  na.match(g.texte, /l’extension se place sur ces côtés de la maison \(vu de la rue\) : à l’arrière, côté rue\. Choisissez-en un ci-dessous\./);
  na.deepEqual(g.attendues, [Q.facade.id]);
  na.match(String(g.blocChoix), /À l’arrière/);
  na.match(String(g.blocChoix), /Côté rue/);
  na.doesNotMatch(String(g.blocChoix), /À gauche/);
  na.equal(phraseDeRelance(g), 'Choisissez un autre côté ci-dessous, et je replace l’extension.');
  na.doesNotMatch(g.texte, JARGON);
  // Clic « À l'arrière » → placée ; égout et niveaux de la maison, statut et source hérités et dits.
  const fin = jouer([ARRIERE], g).at(-1)!;
  na.equal(fin.etape, 'termine', fin.texte);
  na.ok(fin.resultatMoteur?.ok, `refus : ${fin.resultatMoteur?.refus.join(' | ')}`);
  const vol = fin.resultatMoteur!.volume!;
  na.equal(vol.hauteurEgoutM.valeur, 5.2);
  na.equal(vol.hauteurEgoutM.statut, 'confirmee', 'statut de l’égout existant hérité');
  na.match(vol.hauteurEgoutM.source, /même hauteur à l’égout que l’existant/);
  na.equal(vol.niveaux.valeur, 2);
  na.match(vol.niveaux.source, /même nombre de niveaux que l’existant/);
  na.match(fin.texte, /L’extension se place sans refus/);
  na.doesNotMatch(fin.texte, JARGON);
  // LOT G7 — seules les suggestions de variante restent proposées (aucune question bloquante).
  na.deepEqual(fin.attendues, ['x3_retouche', 'x3_plans']); // FINITIONS 18/11 : + « Recevoir les plans »
  na.ok(fin.projet, 'projet transmissible (image, plans)');
  na.match(phraseDeRelance(fin), /préparer une image de l’extension/);
});

Deno.test('X8b-2 : « Même hauteur que la maison » proposé avec les dimensions, et pris en compte', () => {
  const q = jouer([...DEBUT]).at(-1)!;
  na.equal(q.etape, 'dimensions');
  na.match(String(q.blocChoix), new RegExp(HAUTEUR_MEME));
  na.ok(reponseAuParcours(`${Q.hauteur.libelle} : ${HAUTEUR_MEME}`));
  const e = lireReponses(q.etat, `Dimensions (largeur × profondeur) : 4 × 5 m · Hauteur de l’extension : ${HAUTEUR_MEME}`, q.attendues);
  na.equal(e.memeHauteur, true); na.equal(e.niveauxExtension, null);
  const r2 = jouer([`Dimensions (largeur × profondeur) : 4 × 5 m · Hauteur de l’extension : ${HAUTEUR_MEME}`, FIN, ARRIERE], q);
  // La hauteur n'est pas redemandée une fois « même hauteur » choisi.
  na.ok(!r2[0]!.attendues.includes(Q.hauteur.id));
  const fin = r2.at(-1)!;
  na.equal(fin.etape, 'termine', fin.texte);
  na.ok(fin.resultatMoteur?.ok, fin.resultatMoteur?.refus.join(' | '));
  na.equal(fin.resultatMoteur!.volume!.hauteurEgoutM.valeur, 5.2);
  na.equal(fin.resultatMoteur!.volume!.niveaux.valeur, 2);
  // Un choix suivant (« Plain-pied ») remplace « même hauteur ».
  const e2 = lireReponses(fin.etat, 'Hauteur de l’extension : Plain-pied', []);
  na.equal(e2.memeHauteur, false); na.equal(e2.niveauxExtension, 1);
});

Deno.test('X8b-3 : plus de niveaux que la maison (3 sur une maison à 2) → refus expliqué, « Même hauteur que la maison » / « Plain-pied » en puces ; le clic débloque', () => {
  const ok = jouer([...DEBUT, DIM_ESSAI, FIN, ARRIERE]).at(-1)!;
  na.ok(ok.resultatMoteur?.ok);
  const etat3 = { ...ok.etat, niveauxExtension: 3 } as EtatParcours;
  const s = avancerParcours(etat3, '', [], contexte());
  na.equal(s.etape, 'termine', s.texte);
  na.equal(s.resultatMoteur?.ok, false);
  na.ok(s.resultatMoteur!.refus.some((x) => x.startsWith(PREFIXE_REFUS_HAUTEUR)), s.resultatMoteur!.refus.join(' | '));
  na.match(s.texte, /ne peut pas être placée/);
  na.match(s.texte, /choisissez « Même hauteur que la maison » ou « Plain-pied »/);
  na.doesNotMatch(s.texte, JARGON);
  na.deepEqual(s.attendues, [Q.hauteur.id]);
  na.match(String(s.blocChoix), /Même hauteur que la maison/);
  na.match(String(s.blocChoix), /Plain-pied/);
  na.equal(phraseDeRelance(s), 'Choisissez la hauteur de l’extension ci-dessous, et je la replace.');
  na.match(String(resultatParcours(s).message), /Choisissez la hauteur de l’extension ci-dessous/);
  const s2 = avancerParcours(s.etat, `${Q.hauteur.libelle} : ${HAUTEUR_MEME}`, s.attendues, contexte());
  na.ok(s2.resultatMoteur?.ok, s2.resultatMoteur?.refus.join(' | '));
  na.equal(s2.resultatMoteur!.volume!.hauteurEgoutM.valeur, 5.2);
  const s3 = avancerParcours(s.etat, `${Q.hauteur.libelle} : Plain-pied`, s.attendues, contexte());
  na.ok(s3.resultatMoteur?.ok, s3.resultatMoteur?.refus.join(' | '));
  na.equal(s3.resultatMoteur!.volume!.niveaux.valeur, 1);
});

Deno.test('X8b-4 : textes affichés du parcours sans « moteur » ni « cochez »', () => {
  const r = jouer([...DEBUT, DIM_ESSAI, FIN, ARRIERE]);
  for (const s of r) {
    na.doesNotMatch(s.texte, JARGON, s.texte);
    for (const a of s.vue.avertissements) na.doesNotMatch(a, JARGON, a);
    for (const l of s.vue.regles) na.doesNotMatch(l, JARGON, l);
  }
  const sansRue = avancerParcours(r.at(-1)!.etat, '', [], { ...contexte(), facadesVoie: [], raisonFacades: 'test' });
  for (const a of sansRue.vue.avertissements) na.doesNotMatch(a, JARGON, a);
  for (const x of sansRue.resultatMoteur?.refus ?? []) na.doesNotMatch(x, JARGON, x);
});
