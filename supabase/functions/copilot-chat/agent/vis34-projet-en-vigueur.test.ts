// deno test --no-lock --no-check --node-modules-dir=none -A supabase/functions/copilot-chat/agent/vis34-projet-en-vigueur.test.ts
// =============================================================================
// VIS-34 — LE PROJET EN VIGUEUR, de bout en bout, sur le CAS RÉEL du 24/11 (conversation 0113d281, Ascain AI0002 :
// conception de 12 logements → le moteur place 3 plots ; Albé dessine « Maison hexagonale avec tourelle et garage »).
// Code RÉEL : outil de dessin, studio_preparer_3d, parcours du serveur ET de l'écran, charge Studio, fiche du rendu.
//   dessin validé → 3D préparée (ligne enregistrée) → parcours → compléments Studio → fiche = MÊME empreinte, MÊME nom,
//   portée respectée ('projet' par défaut, 'batiment' si choisi) ; question posée UNE fois ; contradiction dite UNE fois.
// =============================================================================
import * as na from 'node:assert/strict';
import { ecartsModeleVolume, executerOutilDessinerBatiment, executerOutilRetoucherBatiment } from './dessin-batiment.ts';
import { executerOutilStudio, ficheDepuisPreparation, preparerVolume, type ConceptionLue, type DepotStudio, type EnvStudio, type PreparationLue } from './studio.ts';
import { blocParcoursServeur, resumePreparation } from './parcours-chat.ts';
import { empreinteModele, type ModeleBatiment } from '../../../../src/lib/studio/modeleBatiment.ts';
import { messageReproduireModele, referenceModeleDuMessage } from '../../../../src/lib/studio/modeleBatimentMessage.ts';
import { descriptionDuMessage } from '../../../../src/lib/studio/descriptionBatiment.ts';
import {
  blocChoixPortee, complementsDessin, lireProjetEnVigueur, lireResumeProjet, OPTION_PORTEE_BATIMENT, OPTION_PORTEE_PROJET, placeDuDessin, porteeDuMessage,
} from '../../../../src/lib/studio/projetEnVigueur.ts';
import { lireBlocChoix, composerReponse, basculerOption, etatVide } from '../../../../src/spaces/copilot/utils/choixCliquables.ts';
import { lignesCarte, referenceDepuisLigne } from '../../../../src/spaces/copilot/studio3d/preparationStudio.ts';
import { assemblerSourcesEcran } from '../../../../src/spaces/copilot/studio3d/parcoursEcran.ts';
import { calculerParcours } from '../../../../src/lib/studio/parcours.ts';
import { travailAvecModele } from '../../../../src/spaces/copilot/studio3d/modeleTravail.ts';

globalThis.fetch = (() => { throw new Error('RÉSEAU INTERDIT EN TEST'); }) as typeof fetch;
const ok = (v: unknown, m?: string) => na.ok(v, m);
const eq = (a: unknown, b: unknown, m?: string) => na.deepStrictEqual(a, b, m);

const FX = JSON.parse(Deno.readTextFileSync(new URL('../../../../src/lib/studio/__fixtures__/vis34-ascain-ai0002.json', import.meta.url)));
const USER = '0d6f1a2b-0000-4000-8000-000000000001';
const CONV = '0113d281-835a-43af-9442-da7d4608c0a7';
const AUTRE_CONV = 'c7e0e9e1-76e5-4219-b4d3-acc8b6e859dc';
const NOM = 'Maison hexagonale avec tourelle et garage';
const conception = (): ConceptionLue => structuredClone(FX.conception) as ConceptionLue;

/** Base en mémoire : mêmes règles que studio_preparations (upsert par empreinte, « courante » = dernière mise à jour). */
function base() {
  const lignes: (PreparationLue & { ordre: number })[] = [];
  const messages: { texte: string; cree_le: string }[] = [];
  const sorties: unknown[] = [];
  let ordre = 0;
  const depot = {
    conception: () => Promise.resolve(conception()),
    enregistrerPreparation: (_u: string, l: PreparationLue) => {
      const deja = lignes.find((x) => x.empreinte === l.empreinte);
      // Comme le déclencheur de la base : un même calcul repris ne change que la conversation et la date.
      if (deja) { deja.conversation_id = l.conversation_id; deja.ordre = ++ordre; return Promise.resolve(deja.id); }
      const id = `9b000000-0000-4000-8000-${String(lignes.length + 1).padStart(12, '0')}`;
      lignes.push({ ...structuredClone(l), id, ordre: ++ordre });
      return Promise.resolve(id);
    },
    preparation: (_u: string, q: { id?: string | null; conceptionId?: string | null; conversationId?: string | null }) => {
      const tri = [...lignes].sort((a, b) => b.ordre - a.ordre);
      return Promise.resolve((q.id ? tri.find((x) => x.id === q.id) : q.conceptionId ? tri.find((x) => x.conception_id === q.conceptionId) : tri.find((x) => x.conversation_id === q.conversationId)) ?? null);
    },
    briefsMessages: () => Promise.resolve([...messages].reverse()),
    sortiesModele: () => Promise.resolve([...sorties].reverse()),
    sortiesExtension: () => Promise.resolve([]), sortiesMaison: () => Promise.resolve([]), dernierParcours: () => Promise.resolve(null),
  } as unknown as DepotStudio;
  const env = (plus: Partial<EnvStudio> = {}, conv = CONV): EnvStudio => ({ userId: USER, depot, secret: 's', requete: crypto.randomUUID(), conversationId: conv, origine: 'https://mimmoza.vercel.app', ...plus });
  const courante = (conv = CONV) => [...lignes].sort((a, b) => b.ordre - a.ordre).find((x) => x.conversation_id === conv)!;
  return { depot, env, lignes, messages, sorties, courante };
}

function dessiner(b: ReturnType<typeof base>): ModeleBatiment {
  const sortie = executerOutilDessinerBatiment(structuredClone(FX.dessin), { photoAuTour: false });
  na.equal(sortie.status, 'ok', sortie.message);
  b.sorties.push(sortie);
  return (sortie.data as { modele: ModeleBatiment }).modele;
}

/** Clic « Reproduire en 3D » : le message part (référence du dessin), Mimmo appelle studio_preparer_3d. */
async function reproduire(b: ReturnType<typeof base>, m: ModeleBatiment) {
  const texte = messageReproduireModele(m, empreinteModele(m));
  b.messages.push({ texte, cree_le: new Date(Date.UTC(2026, 10, 24, 15, 11, b.messages.length)).toISOString() });
  const r = await executerOutilStudio('studio_preparer_3d', {}, b.env({ batimentCarte: descriptionDuMessage(texte), modeleCarte: referenceModeleDuMessage(texte) }));
  ok(r && r.status === 'ok', JSON.stringify(r?.message));
  return r!;
}
const donnees = (r: { data?: unknown }) => r.data as Record<string, any>;
const MISSION = { id: '7072412f-288a-4205-b882-773558073e81', type: 'conception', statut: 'terminee', conversation_id: CONV, criteres: { parcel_ids: ['64065000AI0002'], programme: '12 logements collectifs' } };
const parcoursEcran = (ligne: PreparationLue) => calculerParcours(assemblerSourcesEcran({
  messages: [], conversationId: CONV, typeChoisi: 'image', missions: [MISSION as never], travaux: [], parcelle: '64065000AI0002 · Ascain', brief: null, film: null, visite: null,
  preparationRef: referenceDepuisLigne({ ...ligne, commune: 'Ascain' }),
}));
const parcoursServeur = (ligne: PreparationLue) => blocParcoursServeur({ instantane: null, mission: MISSION, preparation: { idu: ligne.idu, resume: ligne.resume }, travaux: [], textesUtilisateur: [], messageCourant: 'Fais-moi une image' });
const etape = (p: { etapes: { cle: string; resume: string }[] }, cle: string) => p.etapes.find((e) => e.cle === cle)!.resume;

Deno.test('AUDIT — sans dessin, le moteur répartit les 12 logements en PLUSIEURS bâtiments (cas réel : « Plots », 3 bâtiments)', async () => {
  const p = await preparerVolume(conception(), {});
  ok(p.ok, JSON.stringify(p));
  if (!p.ok) return;
  ok(p.resume.batiments > 1, `plusieurs bâtiments attendus : ${p.resume.batiments}`);
  eq(p.resume.logements_vises, 12);
});

Deno.test('BOUT EN BOUT — dessin validé → préparation → parcours → charge Studio → fiche : MÊME empreinte, même nom, portée « projet »', async () => {
  const b = base();
  // Avant le dessin : la 3D préparée de la conversation est celle du moteur (plusieurs bâtiments).
  const avant = await executerOutilStudio('studio_preparer_3d', {}, b.env());
  ok(avant && avant.status === 'ok');
  ok((b.courante().resume as { batiments: number }).batiments > 1);
  ok(!donnees(avant!).projet_en_vigueur, 'pas de dessin : pas de projet en vigueur');

  const m = dessiner(b);
  const E = empreinteModele(m);
  const r = await reproduire(b, m);
  const d = donnees(r);

  // 1. PRÉPARATION — le dessin est ENREGISTRÉ avec la 3D préparée ; il remplace tout : UN seul bâtiment préparé.
  const ligne = b.courante();
  const pv = lireProjetEnVigueur(ligne.entree, CONV)!;
  ok(pv, 'entree.projet_en_vigueur lisible');
  eq(pv.empreinte, E); eq(pv.nom, NOM); eq(pv.portee, 'projet'); eq(pv.portee_choisie, false);
  eq(empreinteModele(pv.modele), E, 'le modèle enregistré est le dessin, à l’identique');
  const rp = lireResumeProjet(ligne.resume)!;
  eq(rp.empreinte, E); eq(rp.nom, NOM); eq(rp.batiments_prepares, 1); ok(rp.batiments_moteur > 1);
  eq((ligne.resume as { batiments: number }).batiments, 1, 'portée « projet » : plus de plots à côté du dessin');
  eq(d.projet_en_vigueur.empreinte, E); eq(d.projet_en_vigueur.portee, 'projet'); eq(d.volume.projet_en_vigueur.empreinte, E);
  ok(d.empreinte !== donnees(avant!).empreinte && /^[0-9a-f]{64}$/.test(d.empreinte), 'ligne propre au dessin (empreinte de préparation distincte, format de la base)');
  eq(b.lignes.length, 2, 'la préparation sans dessin n’est pas écrasée');

  // 2. QUESTION DE PORTÉE — une seule, à boutons, défaut « tout le projet » ; CONTRADICTION dite.
  eq(d.projet_en_vigueur.question_portee, true);
  ok(r.message!.includes(blocChoixPortee()), 'le bloc de choix est donné tel quel à Mimmo');
  const bloc = lireBlocChoix(`Par défaut, ce dessin remplace tout le projet.\n\n${blocChoixPortee()}`).bloc!;
  ok(bloc, 'bloc validé par le front (choixCliquables)');
  eq(bloc.questions[0].options, [OPTION_PORTEE_PROJET, OPTION_PORTEE_BATIMENT]); eq(bloc.questions[0].defaut, [OPTION_PORTEE_PROJET]);
  ok(/maison individuelle/.test(d.projet_en_vigueur.contradiction_programme) && /12 logements/.test(d.projet_en_vigueur.contradiction_programme), d.projet_en_vigueur.contradiction_programme);
  ok(/CONTRADICTION AVEC LE PROGRAMME/.test(r.message!) && /mettre le programme à jour/.test(r.message!));

  // 3. PARCOURS (écran ET serveur) — étapes 2 et 3 décrivent LE DESSIN, plus « Plots · 12 logements placés ».
  const pe = parcoursEcran(ligne);
  for (const cle of ['conception', 'volume']) {
    ok(etape(pe, cle).includes(NOM), `écran, étape ${cle} : ${etape(pe, cle)}`);
    ok(!/logements placés|bâtiments en R\+/.test(etape(pe, cle)), etape(pe, cle));
  }
  ok(/maison individuelle/.test(etape(pe, 'conception')) && /Programme à mettre à jour/.test(etape(pe, 'conception')), etape(pe, 'conception'));
  ok(/3 volumes/.test(etape(pe, 'volume')) && /R\+1/.test(etape(pe, 'volume')), etape(pe, 'volume'));
  const ps = parcoursServeur(ligne);
  ok(ps.bloc.includes(NOM) && !/logements placés/.test(ps.bloc), ps.bloc);
  eq(etape(ps.parcours!, 'volume'), etape(pe, 'volume'), 'même phrase à l’écran et dans le bloc relu par Mimmo');
  eq(resumePreparation({ idu: ligne.idu, resume: ligne.resume }).projet!.empreinte, E);
  // Carte « 3D préparée » de l'Espace 3D.
  const ref = referenceDepuisLigne({ ...ligne, commune: 'Ascain' })!;
  ok(lignesCarte(ref)[0].includes(NOM) && /remplace tout/.test(lignesCarte(ref).join(' ')), lignesCarte(ref).join(' | '));
  eq(placeDuDessin(E, ref.projet), 'projet'); eq(placeDuDessin('mb1-00000000', ref.projet), 'pas_en_vigueur');

  // 4. CHARGE STUDIO — compléments lus par le Studio (noms exacts : modeleBatiment, portee, empreinteModele).
  const c = complementsDessin(pv);
  eq(Object.keys(c).sort(), ['empreinteModele', 'modeleBatiment', 'portee']);
  eq(c.empreinteModele, E); eq(c.portee, 'projet'); eq(empreinteModele(c.modeleBatiment), E); eq(c.modeleBatiment.nom, NOM);

  // 5. FICHE DU RENDU — le SERVEUR joint le dessin lui-même (aucun `options.modele`, aucune description dans le fil).
  const f = ficheDepuisPreparation(ligne, CONV, '2026-11-24T15:20:00.000Z', crypto.randomUUID(), 'https://mimmoza.vercel.app');
  ok(f.ok, JSON.stringify(f));
  if (!f.ok) return;
  const mb = f.valeur.modele_batiment as { v: number; empreinte: string; portee: string; nom: string; modele: ModeleBatiment };
  eq(mb.v, 1); eq(mb.empreinte, E); eq(mb.portee, 'projet'); eq(mb.nom, NOM); eq(mb.modele.nom, NOM);
  eq(f.valeur.projet_en_vigueur, { v: 1, source: 'dessin', empreinte: E, nom: NOM, portee: 'projet' });
  eq(f.valeur.titre, `${NOM} — Ascain`, 'le rendu ne s’appelle plus « 12 logements — Ascain »');
  eq(f.valeur.preparation_id, ligne.id);
  // Chemin de l'Espace 3D (FilmVisitePanel) : même empreinte, même portée.
  const t = travailAvecModele({ type: 'image', fiche: { charge: f.valeur.charge, draft: f.valeur.draft }, options: {} }, pv.modele, pv.portee);
  eq(t.modeleBatiment!.empreinte, E); eq(t.modeleBatiment!.portee, 'projet');

  // 6. UNE AUTRE CONVERSATION ne reçoit jamais ce dessin, même en relisant cette ligne.
  eq(lireProjetEnVigueur(ligne.entree, AUTRE_CONV), null);
  const fa = ficheDepuisPreparation(ligne, AUTRE_CONV, '2026-11-24T15:20:00.000Z', crypto.randomUUID(), 'https://mimmoza.vercel.app');
  ok(fa.ok && !('modele_batiment' in fa.valeur));
});

Deno.test('PORTÉE CHOISIE — « Il remplace un seul bâtiment » : enregistré, transmis, jamais redemandé ; les autres bâtiments sont gardés', async () => {
  const b = base();
  const m = dessiner(b);
  const E = empreinteModele(m);
  await reproduire(b, m);
  // Clic sur le bouton : la réponse arrive sous la forme « Ce dessin : Il remplace un seul bâtiment ».
  const bloc = lireBlocChoix(`Question.\n\n${blocChoixPortee()}`).bloc!;
  const reponse = composerReponse(bloc, basculerOption(etatVide(), bloc, 'portee_dessin', OPTION_PORTEE_BATIMENT));
  eq(porteeDuMessage(reponse), 'batiment', reponse);
  eq(porteeDuMessage(composerReponse(bloc, basculerOption(etatVide(), bloc, 'portee_dessin', OPTION_PORTEE_PROJET))), 'projet');
  eq(porteeDuMessage('Prépare la 3D de mon projet à partir de la conception.'), null);
  eq(porteeDuMessage(messageReproduireModele(m, E)), null, 'jamais lu dans un message qui porte une carte');

  const r = await executerOutilStudio('studio_preparer_3d', {}, b.env({ porteeCarte: porteeDuMessage(reponse) }));
  ok(r && r.status === 'ok', JSON.stringify(r?.message));
  const d = donnees(r!);
  const ligne = b.courante();
  const pv = lireProjetEnVigueur(ligne.entree, CONV)!;
  eq(pv.empreinte, E, 'même dessin'); eq(pv.portee, 'batiment'); eq(pv.portee_choisie, true);
  const n = (ligne.resume as { batiments: number }).batiments;
  ok(n > 1, `les bâtiments du moteur sont gardés : ${n}`);
  eq(d.projet_en_vigueur.question_portee, false, 'jamais deux fois la même question');
  ok(!r!.message!.includes(blocChoixPortee()) && !/QUESTION DE PORTÉE/.test(r!.message!) && /UN SEUL des/.test(r!.message!), r!.message);
  ok(!d.projet_en_vigueur.contradiction_programme, 'un bâtiment parmi d’autres : pas de contradiction avec le programme');
  ok(ecartsModeleVolume(m, ligne.volume as never, 'batiment').some((e) => /en remplace UN seul/.test(e)));
  // Parcours : c'est dit.
  ok(/à la place d’un des \d bâtiments/.test(etape(parcoursEcran(ligne), 'volume')), etape(parcoursEcran(ligne), 'volume'));
  eq(placeDuDessin(E, referenceDepuisLigne({ ...ligne, commune: 'Ascain' })!.projet), 'batiment');
  // Fiche : le dessin est joint MÊME avec plusieurs bâtiments, avec sa portée (appliquée par la machine de rendu).
  const f = ficheDepuisPreparation(ligne, CONV, '2026-11-24T15:25:00.000Z', crypto.randomUUID(), 'https://mimmoza.vercel.app');
  ok(f.ok);
  if (!f.ok) return;
  const mb = f.valeur.modele_batiment as { empreinte: string; portee: string };
  eq(mb.empreinte, E); eq(mb.portee, 'batiment');
  ok(((f.valeur.charge as { batiments?: unknown[] }).batiments?.length ?? 0) > 1, 'les bâtiments préparés voyagent toujours dans la charge');
  ok(!/Maison hexagonale/.test(String(f.valeur.titre)), 'portée « batiment » : le titre reste celui du programme');
  eq(complementsDessin(pv).portee, 'batiment');

  // Retour à « tout le projet » : même dessin, un seul bâtiment préparé, toujours sans question.
  const r2 = await executerOutilStudio('studio_preparer_3d', {}, b.env({ porteeCarte: 'projet' }));
  eq(donnees(r2!).projet_en_vigueur.portee, 'projet'); eq(donnees(r2!).projet_en_vigueur.question_portee, false);
  eq((b.courante().resume as { batiments: number }).batiments, 1);
  eq(lireProjetEnVigueur(b.courante().entree, CONV)!.empreinte, E);
});

Deno.test('LE DESSIN RESTE LE PROJET — nouvelle préparation sans carte (« Préparer », autre onglet) et retouche : rien n’est redemandé ni redit', async () => {
  const b = base();
  const m = dessiner(b);
  const E = empreinteModele(m);
  const r1 = await reproduire(b, m);
  eq(donnees(r1).projet_en_vigueur.question_portee, true);
  // L'utilisateur ne répond pas ; plus tard, la 3D est préparée à nouveau SANS aucun message de carte dans le fil relu.
  b.messages.length = 0;
  const r2 = await executerOutilStudio('studio_preparer_3d', {}, b.env());
  const d2 = donnees(r2!);
  eq(d2.projet_en_vigueur.empreinte, E, 'le dessin enregistré reste le projet');
  eq(d2.projet_en_vigueur.question_portee, false, 'question déjà posée : jamais deux fois');
  ok(!d2.projet_en_vigueur.contradiction_programme && !/CONTRADICTION/.test(r2!.message!), 'contradiction déjà dite : pas redite');
  eq((b.courante().resume as { batiments: number }).batiments, 1);
  // Une forme choisie explicitement (« refais-le en plots ») : le dessin n'est plus le projet.
  const r3 = await executerOutilStudio('studio_preparer_3d', { forme: 'plots' }, b.env());
  ok(r3 && r3.status === 'ok', JSON.stringify(r3?.message));
  ok(!donnees(r3!).projet_en_vigueur);
  eq(lireProjetEnVigueur(b.courante().entree, CONV), null);

  // Retouche (« un étage de plus sur le garage ») puis « Reproduire en 3D » de la nouvelle carte : nouveau projet en vigueur.
  const retouche = await executerOutilRetoucherBatiment({ retouches: [{ action: 'modifier', id: 'garage', champs: { niveaux: 2 } }] },
    { userId: USER, conversationId: CONV, photoAuTour: false, depot: { sortiesModele: () => Promise.resolve([...b.sorties].reverse()) } });
  na.equal(retouche.status, 'ok', retouche.message);
  b.sorties.push(retouche);
  const m2 = (retouche.data as { modele: ModeleBatiment }).modele;
  ok(empreinteModele(m2) !== E);
  const r4 = await reproduire(b, m2);
  eq(donnees(r4).projet_en_vigueur.empreinte, empreinteModele(m2));
  eq(lireProjetEnVigueur(b.courante().entree, CONV)!.empreinte, empreinteModele(m2));
  const f = ficheDepuisPreparation(b.courante(), CONV, '2026-11-24T15:30:00.000Z', crypto.randomUUID(), 'https://mimmoza.vercel.app');
  ok(f.ok && (f.valeur.modele_batiment as { empreinte: string }).empreinte === empreinteModele(m2), 'la fiche suit la retouche validée');
});

Deno.test('LECTURE SANS CONFIANCE — une ligne abîmée ou falsifiée ne donne jamais de dessin', async () => {
  const b = base();
  const m = dessiner(b);
  await reproduire(b, m);
  const entree = structuredClone(b.courante().entree) as { projet_en_vigueur: Record<string, any> };
  ok(lireProjetEnVigueur(entree, CONV));
  eq(lireProjetEnVigueur({ projet_en_vigueur: { ...entree.projet_en_vigueur, empreinte: 'mb1-deadbeef' } }, CONV), null, 'empreinte qui ne correspond pas au modèle');
  eq(lireProjetEnVigueur({ projet_en_vigueur: { ...entree.projet_en_vigueur, modele: { v: 1, volumes: [] } } }, CONV), null, 'modèle illisible');
  eq(lireProjetEnVigueur({ projet_en_vigueur: { ...entree.projet_en_vigueur, portee: 'nimporte' } }, CONV)!.portee, 'projet', 'portée absente ou inconnue = « projet »');
  eq(lireProjetEnVigueur({}, CONV), null); eq(lireResumeProjet({ batiments: 3 }), null);
});
