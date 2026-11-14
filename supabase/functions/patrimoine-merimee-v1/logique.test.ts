// deno test --no-lock -A supabase/functions/patrimoine-merimee-v1/logique.test.ts — LOT P11, sans réseau.
// Réponses simulées au format de l'API tabulaire data.gouv.fr : { data, links, meta: { page, page_size, total } }.
// Les 65 couples (Reference, coordonnées) de la bande 43.4877–43.4978 ont été RELEVÉS le 14/11/2026 sur
// l'API réelle (deux pages, total 65). Seules les deux notices vérifiées une à une (PA00084340, PA00084342)
// portent des libellés ; les autres n'ont que référence + coordonnées (aucun nom inventé).
import assert from 'node:assert/strict';
import {
  bornesBande, lireCoordonnees, MAX_PAGES, rechercherMonuments, RESSOURCE_MERIMEE_ID, type Fetcher,
} from './logique.ts';

const BAYONNE = { lat: 43.49275, lon: -1.47616 }; // cathédrale (cas témoin de copilot-health-cases-v1)

const BANDE = `PA00080975 43.494832970347,5.44121112401168
PA00081669 43.492007026172,6.36089788432602
PA00081672 43.4923749447654,6.362972900177161
PA00081673 43.49320172810471,6.36205263122571
PA00081674 43.492018406573,6.36213878396497
PA00084345 43.4897008331851,-1.47024183236486
PA00084336 43.4896865119259,-1.4793152753180303
PA00084334 43.495902813896,-1.47022570114576
PA00084343 43.490579149312,-1.47633380952762
PA00084332 43.491852069564,-1.47816135149924
PA00084475 43.4890858114361,-0.774484783430392
PA00084338 43.4901791783857,-1.47783954196358
PA00084341 43.4888153175869,-1.47655108694594
PA00084340 43.4913114736406,-1.47691382050481
PA00084342 43.4911357290745,-1.47663590816973
PA00084331 43.4901444789663,-1.47028470560863
PA00084474 43.4879851204153,-0.772323771791356
PA00084542 43.4911822947308,-1.47357264206165
PA00084337 43.4902161011749,-1.47560332502383
PA00084329 43.4903428476999,-1.4770873619019
PA00084339 43.4912302912731,-1.47780820239155
PA00084479 43.4922096266538,-0.770155056491475
PA00084473 43.489518643434,-0.775277079938579
PA00084476 43.4883335330734,-0.775134160267944
PA00094264 43.4899905497703,1.8417012051524702
PA00094426 43.4903954939008,1.51428205883539
PA00094464 43.4896947346474,1.8978438210299302
PA00094465 43.4901664244285,1.8971525809714898
PA00094425 43.48792465042241,1.51244388042782
PA00094928 43.4888143999363,1.00895616825669
PA00094923 43.4924551373296,0.9539826562451231
PA00094821 43.4927480701557,0.670131217298007
PA00094929 43.4906266010263,0.593472742613625
PA00095328 43.4951961731296,0.0881165328517943
PA00095571 43.4970228581786,2.65203292987459
PA00095602 43.4931523452392,2.16045357449476
PA00095676 43.4966008172778,2.37363328823363
PA00125594 43.4921190846732,0.9306623156912
PA00135192 43.497015084638,-1.46907738249858
PA31000024 43.495916631363,1.535528314536
PA31000023 43.4881643785022,1.54389336068781
PA00103710 43.4880773663541,2.75964716359214
PA00103707 43.4889474534912,2.7591639889254
PA00103709 43.4885796173978,2.75839985711173
PA00103477 43.4932844039864,3.4391814881697
PA00103708 43.4877241683023,2.75799187544625
PA00103671 43.4884485797744,3.66996466038756
PA00103683 43.4920969871636,3.31697948475347
PA00103672 43.4893273589127,3.67104736281582
PA00103750 43.4913608107894,3.79703838329417
PA31000051 43.4921745249053,1.69936207594969
PA31000047 43.4893083241062,1.79094220604379
PA64000057 43.4908210384461,-0.7739515853065712
PA64000066 43.4906243293011,-1.47344385738201
PA34000060 43.4888021849682,3.67092926880771
PA64000072 43.4937869876141,-1.55393903632594
PA64000075 43.4929170834513,-1.01060400233745
PA81000050 43.4898693140345,2.37259930373539
PA64000080 43.4932685705224,-1.47347312991932
PA64000084 43.4947670493057,-1.53529058006086
PA64000086 43.4960204452056,-1.46928922873575
PA64000087 43.4926692358658,-1.47939938650368
PA81000059 43.48908617150546,2.3755497894701394
PA81000060 43.4887394180127,2.371691102218497
PA13000134 43.49128609602082,5.39963580188709`;

// Notices vérifiées une à une le 14/11/2026 (Reference__in=PA00084340,PA00084342).
const DETAILS: Record<string, Record<string, unknown>> = {
  PA00084340: {
    Titre_editorial_de_la_notice: 'Immeuble', Denomination_de_l_edifice: 'immeuble', Autre_appellation_de_l_edifice: null,
    Typologie_de_la_protection: 'inscrit MH partiellement', Date_et_typologie_de_la_protection: '1988/02/01 : inscrit MH',
    Adresse_forme_editoriale: '5 rue des Gouverneurs', Commune_forme_editoriale: 'Bayonne', Format_abrege_du_siecle_de_construction: '14e s.',
  },
  PA00084342: {
    Titre_editorial_de_la_notice: 'Immeuble', Denomination_de_l_edifice: 'immeuble', Autre_appellation_de_l_edifice: null,
    Typologie_de_la_protection: 'inscrit MH partiellement', Date_et_typologie_de_la_protection: '1988/02/01 : inscrit MH',
    Adresse_forme_editoriale: '5 rue de la Monnaie', Commune_forme_editoriale: 'Bayonne', Format_abrege_du_siecle_de_construction: '14e s.',
  },
};

const LIGNES = BANDE.split('\n').map((l) => {
  const [ref, coord] = l.trim().split(/\s+/);
  return { Reference: ref, coordonnees_au_format_WGS84: coord, ...(DETAILS[ref!] ?? {}) };
});

function reponseJson(corps: unknown, status = 200): Response {
  return new Response(JSON.stringify(corps), { status, headers: { 'content-type': 'application/json' } });
}

/** Faux serveur tabulaire : sert `lignes` page par page selon ?page= et ?page_size=. */
function serveur(lignes: Record<string, unknown>[], journal: string[] = []): Fetcher {
  return async (url: string) => {
    journal.push(url);
    const u = new URL(url);
    const page = Number(u.searchParams.get('page') ?? '1');
    const taille = Number(u.searchParams.get('page_size') ?? '20');
    const data = lignes.slice((page - 1) * taille, page * taille);
    return reponseJson({ data, links: { next: null, prev: null }, meta: { page, page_size: taille, total: lignes.length } });
  };
}

Deno.test('P11-M1 : JSON correct (bande réelle de Bayonne, 2 pages) → 14 monuments à moins de 500 m, ABF vrai, contrat inchangé', async () => {
  const journal: string[] = [];
  const s = await rechercherMonuments({ ...BAYONNE, radius_m: 500 }, serveur(LIGNES, journal));
  assert.equal(s.status, 'ok');
  assert.equal(journal.length, 2, 'total 65 → 2 pages de 50');
  const u = new URL(journal[0]!);
  assert.ok(u.href.startsWith(`https://tabular-api.data.gouv.fr/api/resources/${RESSOURCE_MERIMEE_ID}/data/`));
  assert.equal(u.searchParams.get('page_size'), '50');
  assert.ok(u.searchParams.get('columns')!.includes('coordonnees_au_format_WGS84'));
  const mini = u.searchParams.get('coordonnees_au_format_WGS84__greater')!;
  const maxi = u.searchParams.get('coordonnees_au_format_WGS84__less')!;
  assert.ok(mini < '43.49275' && maxi > '43.49275', `${mini} / ${maxi}`);
  // Contrat lu par le chat (pick) et par X3b (items[].distance_m, stats.total).
  const st = s.stats!;
  assert.equal(st.total, 14);
  assert.equal(st.dans_perimetre_abf_500m, true);
  assert.equal(st.distance_plus_proche_m, 171);
  assert.equal(st.nb_inscrits, 2, 'seules les deux notices détaillées portent une protection');
  assert.equal(st.inventaire_complet, true);
  assert.equal(s.items.length, 10);
  const p = s.items[0]!;
  for (const k of ['nom', 'denomination', 'protection', 'date_protection', 'adresse', 'commune', 'siecle', 'distance_m']) assert.ok(k in p, k);
  assert.deepEqual([p.nom, p.protection, p.distance_m, p.reference], ['Immeuble', 'inscrit MH partiellement', 171, 'PA00084340']);
  assert.ok(s.items.every((i) => typeof i.distance_m === 'number' && (i.distance_m as number) <= 500));
  assert.ok(s.summary.includes('14 monument(s)') && s.summary.includes('ABF'));
});

Deno.test('P11-M2 : la source renvoie du HTML (la panne réelle) → « source indisponible », jamais de crash JSON ni « aucun monument »', async () => {
  const html: Fetcher = async () =>
    new Response('<!doctype html><html><head><title>culture.data.gouv.fr</title></head><body>Désolé, ce site ne fonctionne pas encore sans javascript.</body></html>',
      { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  const s = await rechercherMonuments({ ...BAYONNE }, html);
  assert.equal(s.status, 'error');
  assert.equal(s.erreur, 'source_indisponible');
  assert.ok(s.summary.startsWith('Source Mérimée indisponible'), s.summary);
  assert.ok(s.summary.includes('text/html'));
  assert.ok(!s.summary.includes('Unexpected token'));
  assert.ok(!/aucun monument historique dans/i.test(s.summary));
  assert.deepEqual([s.stats, s.items], [null, []]);
  // HTML servi avec un faux Content-Type JSON → toujours une erreur claire.
  const menteur: Fetcher = async () => new Response('<!doctype html><p>x</p>', { status: 200, headers: { 'content-type': 'application/json' } });
  const s2 = await rechercherMonuments({ ...BAYONNE }, menteur);
  assert.equal(s2.erreur, 'source_indisponible');
  assert.ok(s2.summary.includes('JSON illisible'));
  // JSON sans tableau « data » (contrat changé) → erreur, pas « aucun ».
  const autre: Fetcher = async () => reponseJson({ results: [] });
  assert.equal((await rechercherMonuments({ ...BAYONNE }, autre)).erreur, 'source_indisponible');
});

Deno.test('P11-M3 : pannes — HTTP 503, réseau, délai, page 2 en échec → erreur explicite', async () => {
  const h503: Fetcher = async () => new Response('Service Unavailable', { status: 503, headers: { 'content-type': 'text/plain' } });
  const a = await rechercherMonuments({ ...BAYONNE }, h503);
  assert.equal(a.status, 'error');
  assert.ok(a.summary.includes('HTTP 503'));
  const reseau: Fetcher = async () => { throw new TypeError('error sending request: dns error'); };
  const b = await rechercherMonuments({ ...BAYONNE }, reseau);
  assert.ok(b.summary.includes('erreur réseau'), b.summary);
  const delai: Fetcher = async () => { throw new DOMException('Signal timed out.', 'TimeoutError'); };
  const c = await rechercherMonuments({ ...BAYONNE }, delai);
  assert.ok(c.summary.includes('délai'), c.summary);
  // Une page manquante = inventaire inconnu : erreur, pas un résultat partiel silencieux.
  const base = serveur(LIGNES);
  const page2KO: Fetcher = async (url, init) => (new URL(url).searchParams.get('page') === '2'
    ? new Response('Bad Gateway', { status: 502 }) : base(url, init));
  const d = await rechercherMonuments({ ...BAYONNE }, page2KO);
  assert.equal(d.status, 'error');
  assert.ok(d.summary.includes('HTTP 502'));
});

Deno.test('P11-M4 : bande vide ou aucun monument dans le rayon → no_data (stats null, comme avant)', async () => {
  const vide = await rechercherMonuments({ lat: 46.2, lon: 2.2 }, serveur([]));
  assert.equal(vide.status, 'no_data');
  assert.equal(vide.stats, null);
  assert.ok(vide.summary.includes('Aucun monument historique dans un rayon de 500 m'));
  // Même bande que Bayonne mais point décalé de ~1,5 km à l'ouest : rien à moins de 500 m.
  const loin = await rechercherMonuments({ lat: 43.49275, lon: -1.495 }, serveur(LIGNES));
  assert.equal(loin.status, 'no_data');
});

Deno.test('P11-M5 : plafond de pages atteint → jamais « aucun » ; inventaire incomplet signalé', async () => {
  const loin = await rechercherMonuments({ lat: 43.49275, lon: -1.495 }, serveur(LIGNES), { maxPages: 1 });
  assert.equal(loin.status, 'error', 'rien trouvé sur la page lue, le reste non lu : pas de conclusion');
  // Bayonne : les monuments proches sont sur la page 1 → ok, mais marqué incomplet.
  const tronque = await rechercherMonuments({ ...BAYONNE }, serveur(LIGNES), { maxPages: 1 });
  assert.equal(tronque.status, 'ok');
  assert.equal(tronque.stats!.inventaire_complet, false);
  assert.ok(tronque.summary.includes('INVENTAIRE INCOMPLET'));
  assert.ok(MAX_PAGES >= 15, 'la bande de Paris (±500 m) compte ~674 lignes : 14 pages doivent passer');
});

Deno.test('P11-M6 : repli par commune, localisation absente, rayon plafonné', async () => {
  const journal: string[] = [];
  const s = await rechercherMonuments({ code_insee: '64102' }, serveur(LIGNES.filter((l) => DETAILS[l.Reference!]), journal));
  assert.equal(s.status, 'ok');
  assert.equal(new URL(journal[0]!).searchParams.get('COG_Insee_lors_de_la_protection__exact'), '64102');
  assert.equal(s.stats!.dans_perimetre_abf_500m, null, 'sans coordonnées, aucune affirmation sur les abords');
  assert.ok(s.summary.includes('ancien code'));
  assert.equal((await rechercherMonuments({}, serveur(LIGNES))).status, 'no_localization');
  assert.equal((await rechercherMonuments({ code_insee: '64102 OR 1=1' }, serveur(LIGNES))).status, 'no_localization');
  const r = await rechercherMonuments({ ...BAYONNE, radius_m: 5000 }, serveur(LIGNES));
  assert.equal(r.stats!.rayon_m, 1000);
  assert.ok(r.summary.includes('limité à 1000 m'));
  // `lng` accepté comme `lon`.
  assert.equal((await rechercherMonuments({ lat: BAYONNE.lat, lng: BAYONNE.lon }, serveur(LIGNES))).stats!.total, 14);
});

Deno.test('P11-M7 : bornes textuelles de la bande et lecture des coordonnées', () => {
  const b = bornesBande(48.8553, 500)!;
  // 48.8553 ∓ (500 / 111 000 + 0,001) = 48.8553 ∓ 0.0055045, arrondi à 5 décimales.
  assert.deepEqual(b, { min: '48.84980', max: '48.86080' });
  const sud = bornesBande(-21.115, 500)!; // La Réunion : ordre des chaînes inversé en négatif
  assert.ok(sud.min < sud.max && sud.min.startsWith('-21.') && sud.max.startsWith('-21.'));
  assert.equal(bornesBande(9.999, 500), null, 'passage 9 → 10 : comparaison textuelle non fiable, refus');
  assert.deepEqual(lireCoordonnees('43.4913114736406,-1.47691382050481'), { lat: 43.4913114736406, lon: -1.47691382050481 });
  assert.equal(lireCoordonnees(''), null);
  assert.equal(lireCoordonnees('abc'), null);
  assert.equal(lireCoordonnees(null), null);
});
