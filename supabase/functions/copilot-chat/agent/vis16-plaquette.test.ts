// deno test --no-lock --no-check -A supabase/functions/copilot-chat/agent/vis16-plaquette.test.ts
// LOT VIS-16 — « Préparer la plaquette » (essai du 20/11/2026, conversation f9fa5476…, mission 51029769… terminée à 06:23) :
//   2. état réel des missions relu en base (bloc système) ; sorties d'outils d'ÉTAT jamais rappelées comme « déjà obtenues » ;
//   3. plaquette → vues du brief projet si enregistrées, sinon PACK_PLAQUETTE (6 vues), durée annoncée ; l'ancien jeu
//      (3/4 gauche, 3/4 droite, face) écrit par le modèle est remplacé ; un choix précis est gardé ;
//   4. carte « Brief créatif » pré-remplie avec le brief projet s'il est connu du serveur.
// Préparation RÉELLE AE0414 (fixture des lots P2 / C7), outil Studio RÉEL, dépôt en mémoire. Aucun réseau.
import * as na from 'node:assert/strict';
import { executerOutilStudio, renduTypeDemande, studioPertinent, briefPrerempli, type DepotStudio, type EnvStudio, type PreparationLue, type StatsFile, type TravailLu } from './studio.ts';
import { blocEtatMissions, consignePlaquette, demandePlaquette, OUTILS_ETAT_VOLATIL, vuesDuModeleRemplacables, vuesPackPlaquette } from './plaquette.ts';
import { OUTIL_STUDIO_LANCER_RENDU } from './outils.ts';
import { assemblerBriefProjet, champsContrat, type ChampsContratBrief } from '../../../../src/lib/studio/briefProjet.ts';
import { PACK_PLAQUETTE } from '../../../../src/lib/studio/catalogueVues.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const CONV = 'f9fa5476-11db-4eda-8692-2051aa13b653';
const MESSAGE_CARTE = 'Prépare le pack plaquette de ce projet (visuels de commercialisation), à partir de la 3D de la conception.';
const PREPARATION_AE0414 = JSON.parse(await Deno.readTextFile(new URL('../../../../src/spaces/copilot/studio3d/__fixtures__/preparation-AE0414.json', import.meta.url))).ligne as PreparationLue;

class Depot implements DepotStudio {
  preparations: Array<PreparationLue & { user_id: string }> = [];
  travaux: Array<TravailLu & { user_id: string; fiche: Record<string, unknown>; options: Record<string, unknown> }> = [];
  stats: StatsFile | null = { attente: 0, plusAncienneAttente: null, enCours: 0, derniereActivite: null };
  messages: { texte: string; cree_le: string }[] = [];
  posee = false;
  async briefsMessages() { return this.messages; }
  async conception() { return null; }
  async derniereVersion() { return null; }
  async enregistrerPreparation() { return 'x'; }
  async preparation(u: string, q: { id?: string | null }) { return this.preparations.filter((p) => p.user_id === u && (!q.id || p.id === q.id)).at(-1) ?? null; }
  async typeRenduAutorise() { return true; }
  async statsFile() { return this.stats; }
  async travauxActifs() { return 0; }
  async travailParDevis() { return null; }
  async questionBriefPosee() { return this.posee; }
  async jetonsDevis() { return []; }
  async insererTravail(): Promise<never> { throw new Error('aucun lancement attendu'); }
  async travail() { return null; }
  async positionFile() { return 0; }
  async urlSigneeRendu(c: string) { return c; }
  async couverturePhotoRue() { return { ok: false as const, raison: 'non vérifiée (test)' }; }
}
const depot = () => { const d = new Depot(); d.preparations.push({ ...structuredClone(PREPARATION_AE0414), user_id: USER }); return d; };
const env = (d: DepotStudio, extra: Partial<EnvStudio> = {}): EnvStudio =>
  ({ userId: USER, depot: d, secret: 'secret-de-test', requete: 'R1', conversationId: CONV, origine: 'https://mimmoza.vercel.app', ...extra });
/** Appel EXACT du modèle au 3e clic (20/11, 06:30), + `pack` posé par index.ts (message reçu = carte « Préparer la plaquette »). */
const appel3eClic = (extra: Record<string, unknown> = {}) => ({
  type: 'image', options: { fond: 'photo_rue', vues: ['trois_quarts_gauche', 'trois_quarts_droite', 'face'], ambiance: 'jour' },
  preparation_id: PREPARATION_AE0414.id, pack: 'plaquette', ...extra,
});
function briefProjet(vues?: string[]): ChampsContratBrief {
  return champsContrat(assemblerBriefProjet({
    etudeId: 'etude-vis16', precedent: null, maintenant: '2026-11-20T05:00:00.000Z',
    habillage: { facade: 'brique', teinte: 'claire', menuiseries: 'anthracite', garde_corps: 'verre', balcons: 'balcons' },
    ...(vues ? { reglages: { vues: vues as never } } : {}),
  }));
}

Deno.test('VIS16-1 : la carte « Préparer la plaquette » est une demande de rendu (outils Studio au tour) ; négation respectée', () => {
  na.equal(demandePlaquette(MESSAGE_CARTE), true);
  na.equal(renduTypeDemande(MESSAGE_CARTE), true, 'garde-fou : studio_lancer_rendu imposé après la 3D');
  na.equal(studioPertinent(['Fais-moi la plaquette']), true);
  na.equal(demandePlaquette('je veux des visuels de commercialisation'), true);
  na.equal(demandePlaquette('pas de plaquette pour l’instant, juste la 3D'), false);
  na.equal(demandePlaquette('quelle est la surface ?'), false);
});

Deno.test('VIS16-2 : état réel des missions — prime sur l’historique ; sorties d’état jamais rappelées', () => {
  for (const n of ['proposer_mission', 'etat_mission', 'lister_missions', 'studio_etat_rendu']) na.ok(OUTILS_ETAT_VOLATIL.has(n), n);
  na.equal(OUTILS_ETAT_VOLATIL.has('studio_preparer_3d'), false);
  na.equal(blocEtatMissions([]), '');
  // Ligne RÉELLE (base, 20/11) : mission 51029769… terminée à 05:23:27 UTC = 06:23 Paris, conception 9c4bee57….
  const b = blocEtatMissions([{ id: '51029769-0641-4773-bb8d-cf43f2cc8802', type: 'conception', statut: 'terminee', etapes_faites: 8, etapes_max: 18,
    termine_le: '2026-11-20 05:23:27.730802+00', erreur: null, conception_id: '9c4bee57-b2fa-403e-982d-37a07daf02c7' }]);
  na.match(b, /FAIT FOI/);
  na.match(b, /PÉRIMÉS/);
  na.match(b, /mission 51029769-0641-4773-bb8d-cf43f2cc8802 · conception · statut « terminee » = TERMINÉE le 20\/11 06:23 \(8\/18 étapes\)/);
  na.match(b, /studio_preparer_3d \{ conception_id: "9c4bee57-b2fa-403e-982d-37a07daf02c7" \}/);
  na.match(blocEtatMissions([{ id: 'm', type: 'conception', statut: 'devis' }]), /DEVIS PROPOSÉ, PAS ENCORE LANCÉE/);
  const c = consignePlaquette();
  na.match(c, /pack « plaquette »/);
  na.match(c, /6 vues — 3\/4 gauche, 3\/4 droite, aérienne, cœur d’îlot, terrasse et séjour/);
  na.match(c, /jamais « 3 visuels »/);
});

Deno.test('VIS16-3 : description de studio_lancer_rendu alignée sur le catalogue (plus de « 1 à 3 … face »), paramètre pack', () => {
  const props = (OUTIL_STUDIO_LANCER_RENDU.input_schema as { properties: Record<string, { description?: string; enum?: string[] }> }).properties;
  na.ok(!/1 à 3 parmi/.test(String(props.options.description)));
  na.match(String(props.options.description), /1 à 6/);
  na.match(String(props.options.description), /aerienne/);
  na.deepEqual(props.pack.enum, ['plaquette']);
  na.deepEqual(vuesPackPlaquette(), [...PACK_PLAQUETTE]);
  na.equal(vuesDuModeleRemplacables(undefined), true);
  na.equal(vuesDuModeleRemplacables(['trois_quarts_gauche', 'trois_quarts_droite', 'face']), true);
  na.equal(vuesDuModeleRemplacables(['aerienne']), false);
});

Deno.test('VIS16-4 : 3e clic rejoué — pack plaquette (6 vues) et durée dans la demande d’habillage, jamais l’ancien jeu', async () => {
  const d = depot();
  const r = await executerOutilStudio('studio_lancer_rendu', appel3eClic(), env(d));
  na.equal(r?.status, 'partial', r?.message);
  const data = r?.data as Record<string, unknown>;
  na.equal(data.brief_requis, true);
  na.deepEqual(data.vues_prevues, [...PACK_PLAQUETTE], 'pack plaquette, ordre du catalogue');
  na.equal(data.pack, 'plaquette');
  na.match(String(data.duree_prevue), /^environ .* une fois le rendu démarré/);
  na.match(String(r?.message), /pack plaquette\) : 6 vues — 3\/4 gauche, 3\/4 droite, aérienne, cœur d’îlot, terrasse et séjour/);
  na.match(String(r?.message), /Annonce EXACTEMENT ces vues et cette durée/);
  na.ok(!(data.vues_prevues as string[]).includes('face'));
  // Sans pack (autre demande d'image) : comportement d'avant (vues du modèle).
  const sans = await executerOutilStudio('studio_lancer_rendu', appel3eClic({ pack: undefined, options: { vues: ['trois_quarts_gauche', 'face'] } }), env(depot()));
  na.deepEqual((sans?.data as Record<string, unknown>).vues_prevues, ['trois_quarts_gauche', 'face']);
  na.equal((sans?.data as Record<string, unknown>).pack, undefined);
  // Choix précis du modèle (demande explicite) : gardé même avec le pack.
  const precis = await executerOutilStudio('studio_lancer_rendu', appel3eClic({ options: { vues: ['aerienne'] } }), env(depot()));
  na.deepEqual((precis?.data as Record<string, unknown>).vues_prevues, ['aerienne']);
});

Deno.test('VIS16-5 : brief projet connu du serveur → ses vues priment sur le pack ; carte pré-remplie (prerempli: brief_projet)', async () => {
  const p = briefProjet(['trois_quarts_gauche', 'aerienne', 'terrasse']);
  // Brief projet seul dans le fil (bloc sans habillage : relu par projetDuFil, pas par briefDuFil).
  const pre = briefPrerempli(p);
  na.deepEqual([pre?.facade, pre?.teinte, pre?.menuiseries, pre?.garde_corps], ['brique', 'claire', 'anthracite', 'verre']);
  na.ok(pre?.defauts.includes('rdc') && !pre?.defauts.includes('facade'));
  na.equal(briefPrerempli(null), null);
  const d = depot();
  d.briefsMessages = async () => [];
  const r0 = await executerOutilStudio('studio_lancer_rendu', appel3eClic(), env(d, {
    briefCarte: { ok: true, valeur: { brief: null, type: 'image', projet: p } } as never,
  }));
  const data = r0?.data as Record<string, unknown>;
  na.equal(r0?.status, 'partial', r0?.message);
  na.deepEqual(data.vues_prevues, ['trois_quarts_gauche', 'aerienne', 'terrasse'], 'vues du brief projet');
  na.equal(data.pack, undefined);
  na.equal(data.prerempli, 'brief_projet');
  na.equal((data.actuel as Record<string, unknown>).facade, 'brique');
  na.match(String(r0?.message), /PRÉ-REMPLIE avec l'habillage du brief projet/);
});

Deno.test('VIS16-6 : habillage validé (bloc avec les vues prévues, sans le mot « plaquette ») → devis du pack, 6 vues, fond d’étude', async () => {
  const d = depot();
  const carte = { ok: true, valeur: { brief: { style: 'contemporain', facade: 'enduit_clair', ouvertures: 'fenetres_verticales', balcons: 'balcons', attique: false, rdc: 'logements', ambiance: 'jour', toiture: 'terrasse', teinte: 'naturelle', garde_corps: 'metal', menuiseries: 'gris', soubassement: 'aucun', precisions: null, defauts: ['facade'] }, type: 'image', vues: [...PACK_PLAQUETTE] } };
  // Le modèle recopie l'ancien jeu : la carte (message reçu) l'emporte.
  const r = await executerOutilStudio('studio_lancer_rendu', { type: 'image', options: { vues: ['trois_quarts_gauche', 'trois_quarts_droite', 'face'] } }, env(d, { briefCarte: carte as never, requete: 'R2' }));
  na.equal(r?.status, 'confirmation_requise', r?.message);
  const o = (r?.data as { options: { vues: string[]; fond?: string } }).options;
  na.equal(o.vues.length, 6);
  na.deepEqual(new Set(o.vues), new Set(PACK_PLAQUETTE));
  na.equal(o.fond ?? 'etude', 'etude');
});
