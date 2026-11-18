// supabase/functions/copilot-chat/agent/extension-g7.test.ts
// LOT G7 (18/11/2026) — « On itère en parlant » (objectif d'Albé) : après un premier projet d'extension, chaque demande
// de modification écrite librement devient une VARIANTE du même projet (V1, V2…), recalculée par le moteur (refus et
// reculs re-vérifiés), sur la MÊME photo et avec le MÊME placement ; l'ambigu devient une question à puces.
// Données RÉELLES de 930470000P0646 (fixtures X3/P2, comme G3) ; la photo est un JPEG minimal FABRIQUÉ (EXIF GPS
// simulé, SUPPOSÉ représentatif). M0462 n'a pas de fixture BD TOPO dans le dépôt : l'essai est rejoué sur P0646.
import * as na from 'node:assert/strict';
import { Q } from '../../_shared/extension/parcours.ts';
import { appliquerRetouches, changementsEntre, demandeRetouche, lireRetouches, QR } from '../../_shared/extension/retouchesExtension.ts';
import { avecVariante, empreinteProjet, jsonCanonique, lireVariantes, variantesDesSorties } from '../../_shared/extension/variantesExtension.ts';
import { lireProjetExtension } from '../../_shared/extension/contrat.ts';
import { lirePhotoProjet, type DepotPhotoProjet, type PhotoDuTour } from './photo-projet.ts';
import { executerOutilExtension, phraseDeRelance, type DepotExtension } from './extension.ts';
import { executerOutilStudio, fondDuRenduPrecedent, type ConceptionLue, type DepotStudio, type EnvStudio, type PreparationLue, type StatsFile, type TravailLu } from './studio.ts';
import { facadesVoieDeLaParcelle } from './voisines-parcelle.ts';
import { type BatimentBdTopo } from '../../_shared/extension/bdtopoParcelle.ts';
import { verifierCouverture } from '../../../../src/lib/studio/couverturePhotoRue.ts';


const FX = JSON.parse(Deno.readTextFileSync(new URL('../../../../src/spaces/copilot/studio3d/__fixtures__/extension-x3-reel.json', import.meta.url)));
const CADASTRE = JSON.parse(Deno.readTextFileSync(new URL('../../../../src/spaces/copilot/studio3d/__fixtures__/cadastre-93048000AS0249.json', import.meta.url)));
const PANORAMAX = JSON.parse(Deno.readTextFileSync(new URL('../../../../src/lib/studio/__fixtures__/panoramax-montreuil-AS0249.json', import.meta.url)));
type SiteFx = { idu: string; contourWgs84: [number, number][]; batiments: BatimentBdTopo[] };
const P0646 = '930470000P0646';
const SITE: SiteFx = FX.bdtopo.sites.find((s: SiteFx) => s.idu === P0646);
const C = FX.conceptionP0646;
const USER = '11111111-1111-4111-8111-111111111111';
const JARGON = /\b(?:serveur|la fiche|moteur|extension_maison|lot [A-Z]\d|worker)\b/i;

// ── JPEG minimal avec EXIF GPS (et direction de prise de vue) ────────────────────────────────────────────────
function jpegAvecGps(lat: number, lon: number, cap: number | null): Uint8Array {
  const dms = (v: number): [number, number][] => {
    const a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60), s = Math.round(((a - d) * 60 - m) * 60 * 10000);
    return [[d, 1], [m, 1], [s, 10000]];
  };
  // TIFF petit-boutiste : en-tête (8) + IFD0 (1 entrée : GPSInfo) + IFD GPS + données.
  const entreesGps: { tag: number; type: number; n: number; val: number[] | string }[] = [
    { tag: 0x0001, type: 2, n: 2, val: lat >= 0 ? 'N' : 'S' },
    { tag: 0x0002, type: 5, n: 3, val: dms(lat).flat() },
    { tag: 0x0003, type: 2, n: 2, val: lon >= 0 ? 'E' : 'W' },
    { tag: 0x0004, type: 5, n: 3, val: dms(lon).flat() },
    ...(cap !== null ? [{ tag: 0x0010, type: 2, n: 2, val: 'T' }, { tag: 0x0011, type: 5, n: 1, val: [Math.round(cap * 100), 100] }] : []),
  ];
  const ifd0 = 8, ifdGps = ifd0 + 2 + 12 + 4;
  let donnees = ifdGps + 2 + entreesGps.length * 12 + 4;
  const buf = new Uint8Array(donnees + entreesGps.reduce((a, e) => a + (e.type === 5 ? e.n * 8 : 0), 0));
  const dv = new DataView(buf.buffer);
  buf.set([0x49, 0x49]); dv.setUint16(2, 42, true); dv.setUint32(4, ifd0, true);
  dv.setUint16(ifd0, 1, true);
  dv.setUint16(ifd0 + 2, 0x8825, true); dv.setUint16(ifd0 + 4, 4, true); dv.setUint32(ifd0 + 6, 1, true); dv.setUint32(ifd0 + 10, ifdGps, true);
  dv.setUint16(ifdGps, entreesGps.length, true);
  entreesGps.forEach((e, k) => {
    const o = ifdGps + 2 + k * 12;
    dv.setUint16(o, e.tag, true); dv.setUint16(o + 2, e.type, true); dv.setUint32(o + 4, e.n, true);
    if (e.type === 2) { const t = e.val as string; for (let i = 0; i < t.length; i++) buf[o + 8 + i] = t.charCodeAt(i); }
    else { dv.setUint32(o + 8, donnees, true); (e.val as number[]).forEach((x, i) => dv.setUint32(donnees + i * 4, x, true)); donnees += e.n * 8; }
  });
  const app1 = new Uint8Array(2 + 2 + 6 + buf.length);
  app1.set([0xff, 0xe1, ((app1.length - 2) >> 8) & 0xff, (app1.length - 2) & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0]);
  app1.set(buf, 10);
  return new Uint8Array([0xff, 0xd8, ...app1, 0xff, 0xd9]);
}

// ── Géométrie de P0646 : centre, point sur la rue (devant la limite sur rue), direction vers la maison ────────
const M_LAT = 111_132;
const kx = (lat: number) => 111_320 * Math.cos(lat * Math.PI / 180);
const centre = (() => {
  const a = SITE.contourWgs84.slice(0, -1);
  return { lon: a.reduce((s, p) => s + p[0], 0) / a.length, lat: a.reduce((s, p) => s + p[1], 0) / a.length };
})();
const pointRue = (() => {
  const f = facadesVoieDeLaParcelle(C.parcelle).facades[0]!;
  const m = { lon: (f.debut[0] + f.fin[0]) / 2, lat: (f.debut[1] + f.fin[1]) / 2 };
  // 8 m au-delà de la limite sur rue, à l'opposé du centre de la parcelle.
  const dx = (m.lon - centre.lon) * kx(m.lat), dy = (m.lat - centre.lat) * M_LAT, d = Math.hypot(dx, dy);
  return { lon: m.lon + (dx / d) * 8 / kx(m.lat), lat: m.lat + (dy / d) * 8 / M_LAT };
})();
const capVers = (a: { lon: number; lat: number }, b: { lon: number; lat: number }) =>
  ((Math.atan2((b.lon - a.lon) * kx(a.lat), (b.lat - a.lat) * M_LAT) * 180 / Math.PI) + 360) % 360;

const FEATURES = [
  { type: 'Feature', properties: { idu: P0646, contenance: C.parcelle.surface_m2 ?? 500 }, geometry: C.parcelle.geometrie },
  ...(C.parcelle.voisines.parcelles as { idu: string | null; geometrie: unknown }[]).map((v) => ({ type: 'Feature', properties: { idu: v.idu }, geometry: v.geometrie })),
];

function reseau(compteur: { cadastreGeom: number; dossier: number }) {
  const bats = SITE.batiments.map((b) => ({
    type: 'Feature',
    properties: { cleabs: b.id, hauteur: b.hauteurM, nombre_d_etages: b.etages, altitude_minimale_sol: b.altitudeSolM, altitude_minimale_toit: b.altitudeToitMinM,
      altitude_maximale_toit: b.altitudeToitMaxM, usage_1: b.usage, nature: b.nature, construction_legere: b.legere, etat_de_l_objet: 'En service' },
    geometry: { type: 'Polygon', coordinates: b.anneaux.map((a) => [...a, a[0]]) },
  }));
  return ((url: string) => {
    const u = String(url);
    if (u.startsWith('https://data.geopf.fr/')) return Promise.resolve(new Response(JSON.stringify({ type: 'FeatureCollection', features: bats }), { status: 200 }));
    if (u.startsWith('https://apicarto.ign.fr/api/cadastre/parcelle') && u.includes('geom=')) {
      compteur.cadastreGeom += 1;
      return Promise.resolve(new Response(JSON.stringify({ type: 'FeatureCollection', features: FEATURES }), { status: 200 }));
    }
    if (u.startsWith('https://apicarto.ign.fr/api/cadastre/parcelle')) { compteur.dossier += 1; return Promise.resolve(new Response(JSON.stringify({ type: 'FeatureCollection', features: [FEATURES[0]] }), { status: 200 })); }
    if (u.startsWith('https://apicarto.ign.fr/api/gpu/')) return Promise.resolve(new Response(JSON.stringify({ features: [{ properties: { typezone: 'U', libelle: 'UC' } }] }), { status: 200 }));
    return Promise.resolve(new Response('{}', { status: 404 }));
  }) as typeof fetch;
}

class Depot implements DepotStudio {
  conceptions: Array<ConceptionLue & { user_id: string }> = [];
  preparations: Array<PreparationLue & { user_id: string }> = [];
  travaux: Array<TravailLu & { user_id: string; fiche: Record<string, unknown>; options: Record<string, unknown> }> = [];
  appels: Array<Record<string, unknown>> = [];
  sorties: Record<string, unknown>[] = [];
  stats: StatsFile | null = { attente: 0, plusAncienneAttente: null, enCours: 0, derniereActivite: null };
  async conception(u: string, q: { id?: string | null; idu?: string | null }) {
    return this.conceptions.filter((c) => c.user_id === u && (!q.id || c.id === q.id) && (!q.idu || c.idu === q.idu)).at(-1) ?? null;
  }
  async derniereVersion() { return null; }
  async enregistrerPreparation(u: string, l: Omit<PreparationLue, 'id' | 'cree_le'>) {
    const id = crypto.randomUUID();
    this.preparations.push({ ...structuredClone(l), id, user_id: u, cree_le: new Date().toISOString() });
    return id;
  }
  async preparation(u: string, q: { id?: string | null; conceptionId?: string | null }) {
    return this.preparations.filter((p) => p.user_id === u && (!q.id || p.id === q.id) && (!q.conceptionId || p.conception_id === q.conceptionId)).at(-1) ?? null;
  }
  async typeRenduAutorise() { return true; }
  async statsFile() { return this.stats; }
  async travauxActifs() { return 0; }
  async travailParDevis(u: string, d: string) { return this.travaux.find((t) => t.user_id === u && t.fiche.devis_id === d) ?? null; }
  async questionBriefPosee() { return true; }
  async jetonsDevis() {
    return this.appels.slice().reverse().map((a) => (a.data as { jeton_devis?: unknown } | undefined)?.jeton_devis).filter((j): j is string => typeof j === 'string');
  }
  async insererTravail(u: string, l: { conversation_id: string; type: string; fiche: Record<string, unknown>; options: Record<string, unknown> }) {
    const t = { id: crypto.randomUUID(), user_id: u, conversation_id: l.conversation_id, type: l.type, statut: 'en_attente', progression: 0, etape: null,
      resultat: null, elements_omis: [], erreur: null, cree_le: new Date().toISOString(), demarre_le: null, termine_le: null, fiche: l.fiche, options: l.options };
    this.travaux.push(t);
    return t;
  }
  async travail(u: string) { return this.travaux.filter((t) => t.user_id === u).at(-1) ?? null; }
  async positionFile() { return 0; }
  async urlSigneeRendu(c: string) { return `https://exemple.supabase.co/storage/v1/object/sign/studio-rendus/${c}?token=t`; }
  async couverturePhotoRue(contour: [number, number][]) {
    return await verifierCouverture(contour, (async () => new Response(JSON.stringify(PANORAMAX), { status: 200 })) as typeof fetch, () => Date.parse('2026-11-11T12:00:00Z'));
  }
  async sortiesExtension() { return [...this.sorties]; }
}

// ── 1. Lecture des retouches (pure) ──────────────────────────────────────────────────────────────────────────
Deno.test('G7-1 : retouches écrites librement → changements explicites ; l’ambigu devient une question à puces ; jamais deviné', () => {
  na.deepEqual(lireRetouches('fais-la en bardage bois clair').facade, 'av-bardage-bois-clair');
  const bois = lireRetouches('fais-la en bardage bois');
  na.equal(bois.facade, undefined, 'teinte du bois non dite : pas devinée');
  na.deepEqual(bois.questions.map((q) => [q.id, q.options]), [[QR.facade.id, ['Bardage bois brun', 'Bardage bois clair', 'Bardage bois noirci']]]);
  na.deepEqual(lireRetouches('Revêtement de l’extension : Bardage bois noirci'), { limites: [], questions: [], facade: 'av-bardage-bois-noirci' }, 'la réponse à la puce se relit d’elle-même');
  na.deepEqual(lireRetouches('plus large d’1 m').largeur, { rel: 1 });
  na.deepEqual(lireRetouches('50 cm de plus en profondeur').profondeur, { rel: 0.5 });
  na.deepEqual(lireRetouches('1 m moins profonde').profondeur, { rel: -1 });
  na.equal(lireRetouches('plus grande').questions[0]!.id, QR.largeur.id, '« plus grande » sans chiffre : question');
  na.equal(lireRetouches('mets un toit plat').toit, 'plat');
  const veg = lireRetouches('toit végétalisé');
  na.equal(veg.toit, 'plat');
  na.match(veg.limites[0]!, /végétation de toiture n’est pas encore dans la bibliothèque/);
  na.deepEqual([lireRetouches('toit en ardoise, 2 pans').toit, lireRetouches('toit en ardoise, 2 pans').couverture], ['deux-pans', 'av-ardoise']);
  na.equal(lireRetouches('enlève la baie').baies, 'aucune');
  na.equal(lireRetouches('remets une baie vitrée').baies, 'auto');
  na.match(lireRetouches('ajoute une porte-fenêtre').limites[0]!, /ouvertures sont placées par règle/);
  na.equal(lireRetouches('mets-la à droite').cote, 'droite');
  na.equal(lireRetouches('la baie à gauche').cote, undefined, 'le côté d’une baie ne déplace pas l’extension');
  na.equal(lireRetouches('mets une clôture sur rue').cote, undefined, 'une clôture sur rue ne déplace pas l’extension');
  na.equal(lireRetouches('de l’autre côté').cote, 'autre');
  const ral = lireRetouches('RAL 7016');
  na.deepEqual(ral.questions[0]!.options, ['Menuiseries RAL 7016', 'Façade RAL 7016'], 'RAL sans dire pour quoi : question');
  na.equal(lireRetouches('menuiseries RAL 9016').menuiserie, 'av-aluminium-blanc');
  na.match(lireRetouches('menuiseries RAL 9005').limites[0]!, /RAL 9005 : cette couleur n’est pas encore dans la bibliothèque/);
  na.deepEqual([lireRetouches('en brique rouge avec des menuiseries blanches').facade, lireRetouches('en brique rouge avec des menuiseries blanches').menuiserie], ['av-brique-rouge', 'av-aluminium-blanc']);
  na.equal(lireRetouches('vue depuis le jardin').vueJardin, true);
  na.equal(demandeRetouche('Bonjour, quel temps fait-il ?'), false);
  na.equal(demandeRetouche('la baie à gauche'), false);
  // Application : variations relatives, bornes, champs non applicables dits.
  const e0 = { type: 'arriere', facade: 'arriere' as const, largeurM: 4, profondeurM: 5, niveauxExtension: null, memeHauteur: true };
  const a = appliquerRetouches(e0, lireRetouches('plus large d’1 m, en bardage bois clair, toit plat'));
  na.deepEqual([a.etat.largeurM, a.etat.facadeExtension, a.etat.toitExtension], [5, 'av-bardage-bois-clair', 'plat']);
  na.deepEqual(changementsEntre(e0, a.etat), ['largeur 4 m → 5 m', 'toit : toit plat', 'façade : bardage bois clair']);
  const b = appliquerRetouches(e0, lireRetouches('5 m moins large'));
  na.equal(b.etat.largeurM, 4, 'largeur nulle refusée');
  na.match(b.limites[0]!, /n’est pas possible/);
  const c = appliquerRetouches({ ...e0, toitExtension: 'plat' as const }, lireRetouches('couverture en ardoise'));
  na.match(c.limites[0]!, /toit plat n’a pas de couverture/);
});

Deno.test('G7-2 : variantes — empreinte canonique (ordre des clés indifférent), historique rattaché au projet, relecture stricte', async () => {
  na.equal(jsonCanonique({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } }), '{"a":{"c":null,"d":[1,{"x":1,"y":2}]},"b":1}');
  na.equal(await empreinteProjet({ a: 1, b: 2 }), await empreinteProjet({ b: 2, a: 1 }));
  na.notEqual(await empreinteProjet({ a: 1 }), await empreinteProjet({ a: 2 }));
  const v1 = { n: 1, cree_le: '2026-11-18T08:00:00.000Z', changements: [], resume: 'V1', verdict: 'placee' as const, empreinte_projet: 'a'.repeat(64) };
  const v2 = { ...v1, n: 2, cree_le: '2026-11-18T08:05:00.000Z', changements: ['largeur 4 m → 5 m'], empreinte_projet: 'b'.repeat(64) };
  const h = avecVariante(avecVariante([], v1), v2);
  na.deepEqual(h.map((x) => x.n), [1, 2]);
  const h2 = avecVariante(h, { ...v2, cree_le: '2026-11-18T09:00:00.000Z', changements: [], verdict: 'refusee' });
  na.deepEqual([h2.length, h2[1]!.cree_le, h2[1]!.changements, h2[1]!.verdict], [2, v2.cree_le, v2.changements, 'refusee'], 'même variante recalculée : remplacée, date et changements gardés');
  na.deepEqual(lireVariantes([{ n: 0 }, { n: 3, empreinte_projet: 'pas-une-empreinte' }]).map((x) => [x.n, x.empreinte_projet]), [[3, null]]);
  na.deepEqual(variantesDesSorties([{ etape: 'termine' }, { variantes: [v1] }]).map((x) => x.n), [1]);
});

// ── 2. Séquence de 4 retouches sur P0646 (photo envoyée, parcours complet) ──────────────────────────────────
async function parcoursTermine(conversationId: string) {
  const sorties: Record<string, unknown>[] = [];
  const dossiers: { idu: string; parcelle: Record<string, unknown> }[] = [];
  const depot: DepotExtension = {
    conception: async (_u, q) => (q.idu && dossiers.some((d) => d.idu === q.idu) ? { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', idu: q.idu, commune: null, parcelle: dossiers[0]!.parcelle, regles_plu: [] } : null),
    sortiesPrecedentes: async () => [...sorties].reverse(),
    creerDossierParcelle: async (_u, d) => { dossiers.push({ idu: d.idu, parcelle: d.parcelle }); return 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'; },
  };
  const depotPhoto: DepotPhotoProjet = { deposer: async (u) => `${u}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg` };
  const jpeg = jpegAvecGps(pointRue.lat, pointRue.lon, capVers(pointRue, centre));
  let minute = 0;
  const tour = async (t: string, p: PhotoDuTour | null = null) => {
    minute += 1;
    const r = await executerOutilExtension({}, { userId: USER, conversationId, texteUtilisateur: t, depot, fetch: reseau({ cadastreGeom: 0, dossier: 0 }), photoDuTour: p, depotPhoto, maintenant: () => Date.parse('2026-11-18T08:00:00Z') + minute * 60_000 });
    na.equal(r.status, 'ok', r.message);
    sorties.push(r.data!);
    return r.data!;
  };
  await tour('Voici ma maison : ajoute une extension de 4 × 5 m à l’arrière, même hauteur, menuiseries anthracite avec baie vitrée. Je garde la maison.', { nom: 'maison.jpg', mediaType: 'image/jpeg', charger: async () => jpeg });
  await tour('Toit de la maison : 2 pans · Niveaux de la maison : R+1');
  await tour('Pente du toit de la maison : Je ne sais pas · Sens du faîtage : Je ne sais pas · Hauteur à l’égout de la maison : Je ne sais pas (estimation)');
  const v1 = await tour('Surface de plancher existante : Je ne sais pas · Demandeur : Particulier · Clôture sur rue : ≈ 1,5 m');
  return { sorties, tour, v1, jpeg };
}

type DataV = { etape: string; etat: Record<string, unknown>; attendues: string[]; texte_affiche: string; phrase_relance: string; bloc_choix: string | null; projet_extension: Record<string, unknown>; photo_projet: unknown; variantes: { n: number; verdict: string; empreinte_projet: string | null; changements: string[] }[]; vue: { extension: { verdict: string; dimensions: string; refus: string[]; variante: number; habillage: string } } };

Deno.test('G7-3 : 4 retouches en parlant sur P0646 → variantes V2…V5 recalculées (dimensions, refus hors parcelle), même photo, empreintes différentes', async () => {
  const { tour, v1: d1 } = await parcoursTermine('conv-g7');
  const v1 = d1 as unknown as DataV;
  na.equal(v1.etape, 'termine');
  na.equal(v1.vue.extension.verdict, 'ok');
  na.equal(v1.etat.variante, 1);
  na.deepEqual(v1.attendues, [QR.retouche.id, 'x3_plans'], 'suggestions de variante en puces (+ plans sans image, FINITIONS 18/11)');
  na.match(String(v1.bloc_choix), /"Façade en bardage bois clair".*"Toit plat".*"1 m plus large".*"Sans baie vitrée"/);
  na.match(v1.texte_affiche, /\*\*Pour une variante\*\*, écrivez simplement ce que vous voulez changer/);
  na.deepEqual(v1.variantes.map((v) => [v.n, v.verdict]), [[1, 'placee']]);
  const photo = lirePhotoProjet(v1.photo_projet)!;
  const empreintes = [v1.variantes[0]!.empreinte_projet];

  // Retouche 1 : matière (ambiguë d'abord → question, aucune nouvelle variante ; puis la puce).
  const q = await tour('fais-la en bardage bois') as unknown as DataV;
  na.deepEqual([q.etat.variante, q.attendues, q.variantes.length], [1, [QR.facade.id], 1], 'ambigu : question, pas de variante');
  na.equal(q.phrase_relance, 'Choisissez ci-dessous, et je recalcule la variante.');
  na.match(q.texte_affiche, /\*\*Variante V1\*\* \(inchangée\) — votre demande a besoin d’une précision/);
  const v2 = await tour('Revêtement de l’extension : Bardage bois clair') as unknown as DataV;
  na.equal(v2.etat.variante, 2);
  na.match(v2.texte_affiche, /^\*\*Variante V2\*\* — modifié depuis la variante V1 : façade : bardage bois clair\./);
  const h2 = (v2.projet_extension.extension as { habillage: Record<string, { valeur: string; statut: string }> }).habillage;
  na.deepEqual([h2.facade!.valeur, h2.facade!.statut], ['av-bardage-bois-clair', 'confirmee']);
  na.equal(h2.menuiserie!.valeur, 'av-aluminium-noir', 'le reste de l’habillage est gardé');
  na.match(v2.vue.extension.dimensions, /^4 × 5 m/);
  na.equal(v2.phrase_relance, 'Voici la variante V2. Si vous le souhaitez, je peux maintenant préparer une image de l’extension (avec ses plans), sur la même photo et avec le même placement.');
  empreintes.push(v2.variantes.at(-1)!.empreinte_projet);

  // Retouche 2 : dimension relative.
  const v3 = await tour('plus large d’1 m') as unknown as DataV;
  na.equal(v3.etat.variante, 3);
  na.deepEqual([v3.etat.largeurM, v3.etat.profondeurM], [5, 5]);
  const dims3 = (v3.projet_extension.extension as { dimensions: { largeurM: { valeur: number } } }).dimensions;
  na.equal(dims3.largeurM.valeur, 5);
  na.match(v3.texte_affiche, /largeur 4 m → 5 m/);
  na.equal(v3.vue.extension.verdict, 'ok', 'le moteur a recalculé : 5 × 5 m passe encore à l’arrière');
  empreintes.push(v3.variantes.at(-1)!.empreinte_projet);

  // Retouche 3 : toit de l'extension.
  const v4 = await tour('mets un toit plat') as unknown as DataV;
  na.equal(v4.etat.variante, 4);
  const toit4 = (v4.projet_extension.extension as { toiture: { forme: { valeur: string; statut: string } } }).toiture;
  na.deepEqual([toit4.forme.valeur, toit4.forme.statut], ['plat', 'confirmee']);
  na.match(v4.vue.extension.habillage, /bardage bois clair · toit plat/);
  empreintes.push(v4.variantes.at(-1)!.empreinte_projet);

  // Retouche 4 : trop profonde → refus re-vérifié par le moteur (hors parcelle), dit.
  const v5 = await tour('15 m plus profonde') as unknown as DataV;
  na.equal(v5.etat.variante, 5);
  na.equal(v5.etat.profondeurM, 20);
  na.equal(v5.vue.extension.verdict, 'refus', JSON.stringify(v5.vue.extension));
  na.ok(v5.vue.extension.refus.length > 0);
  na.equal(v5.variantes.at(-1)!.verdict, 'refusee');
  na.doesNotMatch(v5.phrase_relance, /variante V5/, 'une variante refusée ne propose pas d’image');
  empreintes.push(v5.variantes.at(-1)!.empreinte_projet);

  // Historique complet, empreintes toutes différentes, même photo du début à la fin, aucun jargon.
  na.deepEqual(v5.variantes.map((v) => v.n), [1, 2, 3, 4, 5]);
  na.equal(new Set(empreintes).size, 5, empreintes.join(' '));
  for (const e of empreintes) na.match(String(e), /^[0-9a-f]{64}$/);
  na.equal(lirePhotoProjet(v5.photo_projet)?.chemin, photo.chemin, 'même photo pour toutes les variantes');
  for (const v of [v2, v3, v4, v5]) {
    na.ok(lireProjetExtension(v.projet_extension).ok, 'projet transmissible (contrat)');
    na.doesNotMatch(v.texte_affiche, JARGON);
  }
  // « vue depuis le jardin » : le point de vue est celui de la photo — rien n'est modifié, une photo du jardin est demandée.
  const vj = await tour('et une vue depuis le jardin ?') as unknown as DataV;
  na.equal(vj.etat.variante, 5);
  na.match(vj.texte_affiche, /point de vue de l’image est celui de la \*\*photo\*\*/);
});

// ── 3. Image de la variante : même photo, même placement (calage validé) ────────────────────────────────────
Deno.test('G7-4 : image d’une variante → fond ET calage du rendu précédent repris (jamais l’étude), sauf fond choisi explicitement', async () => {
  const { sorties } = await parcoursTermine('conv-g7-img');
  const chemin = `${USER}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`;
  const calage = { version: 1, correspondances: [{ image: [100, 900], monde: [2.62, 48.9, 0] }, { image: [1800, 880], monde: [2.6201, 48.9001, 0] }, { image: [120, 400], monde: [2.62, 48.9, 5.2] }], largeur_image: 2880, hauteur_image: 1920, valide_le: '2026-11-18T08:30:00Z' };
  na.deepEqual(fondDuRenduPrecedent({ fond: 'photo_client', photo_client: { chemin, octets: 10 }, calage_client: calage, vues: ['face'] }), { fond: 'photo_client', photo_client: { chemin, octets: 10 }, calage_client: calage });
  na.equal(fondDuRenduPrecedent({ vues: ['face'] }), null, 'image d’étude : jamais reprise');
  // Variante V2 puis image : le dernier rendu de la conversation avait un calage validé.
  const d = new Depot();
  d.sorties = [...sorties].reverse();
  d.conceptions.push({
    id: '55555555-5555-4555-8555-555555555555', idu: P0646, commune: 'Montfermeil', user_id: USER, regles_plu: [], programme: null,
    parcelle: { idu: P0646, geometrie: C.parcelle.geometrie, surface_m2: C.parcelle.surface_m2 ?? null, source: 'cadastre', voisines: C.parcelle.voisines },
  } as unknown as ConceptionLue & { user_id: string });
  const precedent = { fond: 'photo_client', photo_client: { chemin, octets: 4321 }, calage_client: calage, existant: 'conserver' };
  (d as unknown as { optionsDernierRenduImage: () => Promise<Record<string, unknown>> }).optionsDernierRenduImage = async () => structuredClone(precedent);
  const env = (rq: string): EnvStudio => ({ userId: USER, depot: d, secret: 'secret-de-test', requete: rq, conversationId: 'conv-g7-img', origine: 'https://mimmoza.vercel.app' });
  const p = await executerOutilStudio('studio_preparer_3d', {}, env('P0'));
  na.equal(p?.status, 'ok', p?.message);
  const r1 = await executerOutilStudio('studio_lancer_rendu', { type: 'image' }, env('R1'));
  na.equal(r1?.status, 'confirmation_requise', r1?.message);
  d.appels.push(structuredClone(r1!) as unknown as Record<string, unknown>);
  const r2 = await executerOutilStudio('studio_lancer_rendu', { confirmer: true }, env('R2'));
  na.equal(r2?.status, 'ok', r2?.message);
  const t = d.travaux.at(-1)!;
  na.equal(t.options.fond, 'photo_client');
  na.deepEqual(t.options.photo_client, { chemin, octets: 4321 }, 'même photo');
  na.deepEqual(t.options.calage_client, calage, 'même placement (calage validé)');
  na.equal(t.options.existant, 'conserver');
  // Fond choisi explicitement : il l'emporte (rien n'est repris).
  const r3 = await executerOutilStudio('studio_lancer_rendu', { type: 'image', options: { fond: 'photo_rue' } }, env('R3'));
  na.ok(r3, 'réponse');
  na.equal(JSON.stringify(r3).includes('placement (ajusté)'), false);
});

Deno.test('G7-5 : phrase de relance des variantes (sans jargon) et routage du chat', () => {
  na.equal(phraseDeRelance({ etape: 'termine', projet: null, resultatMoteur: null, attendues: [QR.facade.id] }), 'Choisissez ci-dessous, et je recalcule la variante.');
  na.equal(demandeRetouche('Retoucher l’extension : 1 m plus large'), true);
  na.equal(demandeRetouche('peux-tu me donner le régime fiscal ?'), false);
  na.equal(demandeRetouche(`${Q.surface.libelle} : Je ne sais pas`), false);
});
