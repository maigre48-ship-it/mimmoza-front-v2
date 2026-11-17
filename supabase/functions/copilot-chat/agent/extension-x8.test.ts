// supabase/functions/copilot-chat/agent/extension-x8.test.ts
// LOT X8 (17/11/2026) — essai d'Albé sur 930470000P0646 : la BD TOPO (WFS Géoplateforme) a répondu « HTTP 400 » au
// 5e tour, le parcours est tombé sur « sans_bdtopo » et le modèle a écrit des clôtures fausses (« le serveur a affiché
// le gabarit »). On rejoue la séquence avec un réseau simulé (données réelles du fixture X3).
import * as na from 'node:assert/strict';
import { lireLectureMemorisee, telechargerBatimentsParcelle, contourEnLambert93, type BatimentBdTopo } from '../../_shared/extension/bdtopoParcelle.ts';
import { reponseAuParcours, suiteDuParcours, texteEgoutSansReponse } from '../../_shared/extension/parcours.ts';
import { executerOutilExtension, phraseDeRelance, resultatParcours, CONSIGNE_EXTENSION, OUTIL_EXTENSION_MAISON_DEF, type DepotExtension } from './extension.ts';

const FX = JSON.parse(Deno.readTextFileSync(new URL('../../../../src/spaces/copilot/studio3d/__fixtures__/extension-x3-reel.json', import.meta.url)));
type SiteFx = { idu: string; contourWgs84: [number, number][]; surParcelle: string[]; batiments: BatimentBdTopo[] };
const IDU = '930470000P0646';
const SITE: SiteFx = FX.bdtopo.sites.find((s: SiteFx) => s.idu === IDU);
const C = FX.conceptionP0646;
const JARGON = /\b(?:serveur|la fiche|moteur|extension_maison|lot [A-Z]\d)\b/i;

/** Réseau simulé : la BD TOPO répond normalement, sauf quand `panne()` est vrai (HTTP 400, comme l'essai). */
function reseau(panne: () => boolean, compteur: { wfs: number }): typeof fetch {
  const features = SITE.batiments.map((b) => ({
    type: 'Feature', id: b.id,
    properties: { cleabs: b.id, hauteur: b.hauteurM, nombre_d_etages: b.etages, altitude_minimale_sol: b.altitudeSolM, altitude_minimale_toit: b.altitudeToitMinM,
      altitude_maximale_toit: b.altitudeToitMaxM, usage_1: b.usage, nature: b.nature, construction_legere: b.legere, etat_de_l_objet: 'En service' },
    geometry: { type: 'Polygon', coordinates: b.anneaux.map((a) => [...a, a[0]]) },
  }));
  return ((url: string) => {
    const u = String(url);
    if (u.startsWith('https://data.geopf.fr/')) {
      compteur.wfs += 1;
      return Promise.resolve(panne() ? new Response('<ExceptionReport/>', { status: 400 }) : new Response(JSON.stringify({ type: 'FeatureCollection', features }), { status: 200 }));
    }
    const corps = u.startsWith('https://api.bdnb.io/') ? [] : u.startsWith('https://apicarto.ign.fr/api/gpu/') ? { features: [{ properties: { typezone: 'U', libelle: 'UC' } }] } : null;
    return Promise.resolve(corps ? new Response(JSON.stringify(corps), { status: 200 }) : new Response('{}', { status: 404 }));
  }) as typeof fetch;
}

function banc(conversation: string) {
  const sorties: Record<string, unknown>[] = [];
  const etat = { panne: false };
  const compteur = { wfs: 0 };
  const depot: DepotExtension = {
    conception: async (_u, q) => (q.idu === IDU || q.id === 'c-1' ? { id: 'c-1', ...C } : null),
    conceptionDeLaConversation: async () => 'c-1',
    sortiesPrecedentes: async () => [...sorties].reverse(),
  };
  const tour = async (texte: string) => {
    const r = await executerOutilExtension({ idu: IDU }, { userId: 'u-1', conversationId: conversation, texteUtilisateur: texte, depot, fetch: reseau(() => etat.panne, compteur), maintenant: () => Date.parse('2026-11-17T10:27:00Z') });
    if (r.status === 'ok') sorties.push(r.data!);
    return r;
  };
  return { tour, etat, compteur, sorties };
}

const ESSAI = [
  'Je voudrais agrandir ma maison',
  'Maison existante : Conserver la maison',
  'Toit de la maison : 2 pans · Niveaux de la maison : R+1 · Type d’extension : Latérale · Façade (vue de la rue) : À gauche',
  'égout 5,2 m',
  'Dimensions (largeur × profondeur) : 4 × 5 m · Hauteur de l’extension : Sur 2 niveaux',
  'Surface de plancher existante : Je ne sais pas · Demandeur : Particulier',
];

Deno.test('X8-1 : BD TOPO en panne (HTTP 400) au 5e tour → seconde tentative, puis lecture du tour précédent réutilisée : le parcours avance jusqu’au gabarit, réponses gardées', async () => {
  const b = banc('conv-x8-1');
  const r: Awaited<ReturnType<typeof b.tour>>[] = [];
  for (let i = 0; i < 4; i++) r.push(await b.tour(ESSAI[i]!));
  na.equal(r[3]!.data!.etape, 'dimensions');
  na.match(String(r[2]!.data!.texte_affiche), /sinon on garde 5 m \(valeur de la BD TOPO\)/);
  na.doesNotMatch(String(r[2]!.data!.texte_affiche), /estimée \(5 m, mesurée\)/);
  na.ok(r[3]!.data!.bdtopo_lue, 'lecture mémorisée dans la sortie');
  b.etat.panne = true;
  const avant = b.compteur.wfs;
  r.push(await b.tour(ESSAI[4]!));
  na.equal(b.compteur.wfs - avant, 2, 'deux tentatives WFS');
  na.notEqual(r[4]!.data!.etape, 'sans_bdtopo');
  const e5 = r[4]!.data!.etat as Record<string, unknown>;
  na.equal(e5.hauteurEgoutM, 5.2); na.equal(e5.toit, 'deux-pans'); na.equal(e5.largeurM, 4); na.equal(e5.profondeurM, 5); na.equal(e5.niveauxExtension, 2);
  const v5 = r[4]!.data!.vue as { maison: { id: string } | null; avertissements: string[]; sources: string[] };
  na.equal(v5.maison!.id, 'BATIMENT0000000312986202');
  na.ok(v5.avertissements.some((a) => /n’a pas répondu à ce tour \(BD TOPO \(WFS Géoplateforme\) : HTTP 400 \(2 tentatives\)\) : la lecture du 2026-11-17 est réutilisée/.test(a)), v5.avertissements.join(' | '));
  na.ok(v5.sources.some((s) => /lue le 2026-11-17/.test(s)));
  na.ok(r[4]!.data!.bdtopo_lue, 'la lecture reste mémorisée pour les tours suivants');
  // Toujours en panne au tour suivant : le parcours se termine (gabarit, régime) sur la lecture réutilisée.
  r.push(await b.tour(ESSAI[5]!));
  na.equal(r[5]!.data!.etape, 'termine', String(r[5]!.data!.texte_affiche));
  const v6 = r[5]!.data!.vue as { extension: { verdict: string } | null; regime: unknown };
  na.ok(v6.extension && v6.extension.verdict !== 'non-calcule');
  na.ok(v6.regime);
  for (const x of r) {
    na.doesNotMatch(String(x.message), /Écris au plus UNE phrase/);
    na.doesNotMatch(phraseDeRelance({ etape: x.data!.etape as never, projet: null, resultatMoteur: null }), JARGON);
  }
});

Deno.test('X8-2 : sans lecture précédente → « sans_bdtopo », réponses gardées, puce « Réessayer » ; au clic, reprise au même point', async () => {
  const b = banc('conv-x8-2');
  b.etat.panne = true;
  const r1 = await b.tour(ESSAI[0]!);
  na.equal(r1.data!.etape, 'sans_bdtopo');
  na.match(String(r1.data!.texte_affiche), /vos réponses sont gardées/);
  na.doesNotMatch(String(r1.data!.texte_affiche), /Rien n’est estimé ; réessayez/);
  na.match(String(r1.data!.bloc_choix), /"id":"x3_reprendre"/);
  // Le clic sur la puce est routé vers le parcours (même détection que les autres questions).
  na.ok(suiteDuParcours(String(r1.data!.bloc_choix)));
  na.ok(reponseAuParcours('Parcours d’extension : Réessayer'));
  na.match(String(r1.message), /Écris EXACTEMENT cette phrase.*Réessayer/);
  na.equal(r1.data!.bdtopo_lue, undefined);
  // Un état déjà avancé (conserver, toit) n'est pas perdu par une panne.
  b.etat.panne = false;
  await b.tour(ESSAI[1]!);
  const r3 = await b.tour(ESSAI[2]!);
  na.equal(r3.data!.etape, 'dimensions');
  b.sorties.splice(0, b.sorties.length, ...b.sorties.map((s) => { const c = { ...s }; delete c.bdtopo_lue; return c; }));
  b.etat.panne = true;
  const r4 = await b.tour(ESSAI[4]!);
  na.equal(r4.data!.etape, 'sans_bdtopo');
  const e4 = r4.data!.etat as Record<string, unknown>;
  na.equal(e4.conserver, true); na.equal(e4.toit, 'deux-pans'); na.equal(e4.largeurM, 4);
  b.etat.panne = false;
  const r5 = await b.tour('Parcours d’extension : Réessayer');
  na.notEqual(r5.data!.etape, 'sans_bdtopo');
  na.notEqual(r5.data!.etape, 'conserver');
  const e5 = r5.data!.etat as Record<string, unknown>;
  na.equal(e5.largeurM, 4); na.equal(e5.profondeurM, 5);
});

Deno.test('X8-3 : seconde tentative réussie → aucune trace d’échec ; deux échecs → raison « 2 tentatives »', async () => {
  const l93 = contourEnLambert93(SITE.contourWgs84);
  let n = 0;
  const f1 = (() => { n += 1; return Promise.resolve(n === 1 ? new Response('', { status: 400 }) : new Response(JSON.stringify({ features: [] }), { status: 200 })); }) as typeof fetch;
  const ok = await telechargerBatimentsParcelle(l93, f1, 1000, 1);
  na.equal(ok.ok, true); na.equal(n, 2);
  const f2 = (() => Promise.reject(new Error('réseau coupé'))) as typeof fetch;
  const ko = await telechargerBatimentsParcelle(l93, f2, 1000, 1);
  na.equal(ko.ok, false);
  na.match(!ko.ok ? ko.raison : '', /injoignable : réseau coupé \(2 tentatives\)/);
});

Deno.test('X8-4 : lecture mémorisée relue strictement (rien n’est corrigé ni inventé)', () => {
  const b = SITE.batiments[0]!;
  const bon = { idu: IDU, date: '2026-11-17', batiments: [b] };
  na.deepEqual(lireLectureMemorisee(JSON.parse(JSON.stringify(bon)))!.batiments[0]!.id, b.id);
  na.equal(lireLectureMemorisee({ ...bon, idu: 'xx' }), null);
  na.equal(lireLectureMemorisee({ ...bon, date: 'hier' }), null);
  na.equal(lireLectureMemorisee({ ...bon, batiments: [] }), null);
  na.equal(lireLectureMemorisee({ ...bon, batiments: [{ ...b, anneaux: [[[0, 0], [1, 1]]] }] }), null);
  na.equal(lireLectureMemorisee({ ...bon, batiments: [{ ...b, anneaux: [[[0, 0], [1, 'a'], [2, 2]]] }] }), null);
});

Deno.test('X8-5 : libellé égout jamais « estimée … mesurée » ; consignes sans « serveur », « fiche », « moteur »', () => {
  na.equal(texteEgoutSansReponse(5, 'mesuree'), 'sinon on garde 5 m (valeur de la BD TOPO)');
  na.match(texteEgoutSansReponse(5.4, 'estimee'), /^sinon on garde l’estimation de 5,4 m/);
  na.doesNotMatch(texteEgoutSansReponse(5, 'mesuree'), /estim/);
  for (const e of ['sans_parcelle', 'sans_bdtopo', 'aucun_batiment', 'conserver', 'neuf', 'confirmer', 'type', 'dimensions', 'surface', 'termine'] as const) {
    na.doesNotMatch(phraseDeRelance({ etape: e, projet: null, resultatMoteur: null }), JARGON, e);
    na.doesNotMatch(phraseDeRelance({ etape: e, projet: null, resultatMoteur: null }), /\d/, e);
  }
  na.match(phraseDeRelance({ etape: 'termine', projet: null, resultatMoteur: null }), /Modifiez les dimensions/);
  na.doesNotMatch(CONSIGNE_EXTENSION, /PAR LE SERVEUR|Le serveur AFFICHE/);
  na.match(CONSIGNE_EXTENSION, /Ne parle jamais du « serveur »/);
  na.doesNotMatch(OUTIL_EXTENSION_MAISON_DEF.description, /SERVEUR/);
  void resultatParcours;
});
