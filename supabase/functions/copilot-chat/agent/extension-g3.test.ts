// supabase/functions/copilot-chat/agent/extension-g3.test.ts
// LOT G3 (17/11/2026) — « J'envoie une photo de ma maison avec mes instructions » (objectif d'Albé).
//   · instructions écrites librement → parcours d'extension prérempli (aucune valeur du modèle) ;
//   · photo jointe : EXIF lu sur le serveur, parcelle retrouvée par la position (et la direction) de la photo,
//     photo d'origine déposée dans l'espace privé, mémorisée d'un tour à l'autre ;
//   · extension placée sans dossier de parcelle : dossier minimal créé (contour + voisines du cadastre) ;
//   · l'image de l'extension part de CETTE photo (fond « photo du client »), jamais de la photo de la rue.
// Données RÉELLES : contour, bâtiments BD TOPO, voisines et règles de 930470000P0646 (fixture X3), 3D préparée et
// cadastre AS0249 (fixtures P2). La photo est un JPEG minimal FABRIQUÉ ici (EXIF GPS simulé) : SUPPOSÉ représentatif
// d'une photo de téléphone (même lecteur EXIF que la carte « Votre photo du trottoir »). M0462 n'a pas de fixture
// BD TOPO dans le dépôt : l'essai est rejoué sur P0646 (côté arrière, le seul côté latéral/arrière qui passe en 4 × 5 m).
import * as na from 'node:assert/strict';
import {
  completerParInstructions, lireInstructions,
} from '../../_shared/extension/instructionsExtension.ts';
import { ETAT_INITIAL, Q } from '../../_shared/extension/parcours.ts';
import {
  carreRecherche, choisirParcelle, intentionPhotoExtension, lirePhotoProjet, optionPhotoClient, photoProjetDesSorties, pointDansContour,
  type DepotPhotoProjet, type PhotoDuTour,
} from './photo-projet.ts';
import { executerOutilExtension, type DepotExtension } from './extension.ts';
import { executerOutilStudio, type ConceptionLue, type DepotStudio, type EnvStudio, type PreparationLue, type StatsFile, type TravailLu } from './studio.ts';
import { facadesVoieDeLaParcelle } from './voisines-parcelle.ts';
import { lireExifPhoto } from '../../../../src/lib/studio/photoClientLogique.ts';
import { type BatimentBdTopo } from '../../_shared/extension/bdtopoParcelle.ts';
import { verifierCouverture } from '../../../../src/lib/studio/couverturePhotoRue.ts';

const FX = JSON.parse(Deno.readTextFileSync(new URL('../../../../src/spaces/copilot/studio3d/__fixtures__/extension-x3-reel.json', import.meta.url)));
const CADASTRE = JSON.parse(Deno.readTextFileSync(new URL('../../../../src/spaces/copilot/studio3d/__fixtures__/cadastre-93048000AS0249.json', import.meta.url)));
const PANORAMAX = JSON.parse(Deno.readTextFileSync(new URL('../../../../src/lib/studio/__fixtures__/panoramax-montreuil-AS0249.json', import.meta.url)));
type SiteFx = { idu: string; contourWgs84: [number, number][]; batiments: BatimentBdTopo[] };
const P0646 = '930470000P0646';
const SITE: SiteFx = FX.bdtopo.sites.find((s: SiteFx) => s.idu === P0646);
const C = FX.conceptionP0646;
const LIBELLES = Object.values(Q).map((q) => q.libelle);
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

Deno.test('G3-1 : instructions libres → valeurs explicites seulement (ambiguïtés et puces ignorées, jamais le toit)', () => {
  const t = 'Voici ma maison : ajoute une extension de 4 × 5 m à gauche, même hauteur, menuiseries anthracite avec baie vitrée. Je garde la maison.';
  na.deepEqual(lireInstructions(t, LIBELLES), { conserver: true, facade: 'gauche', type: 'laterale', memeHauteur: true, menuiserie: 'av-aluminium-noir', baies: 'auto' });
  na.deepEqual(lireInstructions('extension à gauche ou à droite, je ne sais pas', LIBELLES), {}, 'côté ambigu : question posée');
  na.deepEqual(lireInstructions('Niveaux de la maison : Plain-pied · Type d’extension : Latérale', LIBELLES), {}, 'réponses aux puces : lues ailleurs');
  na.deepEqual(lireInstructions('une extension à l’arrière avec un toit plat', LIBELLES), { facade: 'arriere', type: 'arriere' }, 'le toit de la maison n’est jamais repris');
  na.deepEqual(lireInstructions('surélévation de la maison', LIBELLES), { type: 'surelevation' });
  na.deepEqual(lireInstructions('garage accolé à droite, sans baie, en blanc', LIBELLES), { facade: 'droite', type: 'garage', baies: 'aucune' }, 'couleur sans mot « menuiseries » : non reprise');
  na.deepEqual(lireInstructions('extension de plain-pied sur 2 niveaux', LIBELLES), {}, 'hauteur contradictoire');
  na.deepEqual(lireInstructions('```mimmoza-brief\n{"fond":"à gauche"}\n```', LIBELLES), {});
  // Complète seulement les champs vides ; ce qui a été répondu n'est jamais remplacé.
  const deja = { ...ETAT_INITIAL, facade: 'droite' as const };
  const r = completerParInstructions(deja, t, LIBELLES);
  na.equal(r.etat.facade, 'droite');
  na.equal(r.etat.type, 'laterale');
  na.deepEqual(r.reprises, ['maison conservée', 'extension latérale', 'même hauteur que la maison', 'menuiseries anthracite', 'avec baie vitrée']);
});

Deno.test('G3-2 : intention « photo + agrandir » (et pas sans photo, ni « extension de délai »)', () => {
  na.equal(intentionPhotoExtension('ajoute une extension de 4 × 5 m à gauche', true), true);
  na.equal(intentionPhotoExtension('je veux agrandir', true), true);
  na.equal(intentionPhotoExtension('ajoute une extension de 4 × 5 m à gauche', false), false);
  na.equal(intentionPhotoExtension('quelle est cette maison ?', true), false);
  na.equal(intentionPhotoExtension('extension de délai du permis', true), false);
});

Deno.test('G3-3 : EXIF lu ; parcelle retrouvée par la position (dedans) ou par la direction (depuis la rue) ; sinon rien deviné', () => {
  const ex = lireExifPhoto(jpegAvecGps(pointRue.lat, pointRue.lon, 123.45));
  na.ok(ex.gps && Math.abs(ex.gps.lat - pointRue.lat) < 1e-6 && Math.abs(ex.gps.lon - pointRue.lon) < 1e-6, JSON.stringify(ex.gps));
  na.equal(ex.capDeg, 123.45);
  // Depuis le terrain : la parcelle qui contient le point.
  const dedans = choisirParcelle(FEATURES, centre, null);
  na.ok(dedans.ok && dedans.parcelle.idu === P0646 && dedans.parcelle.depuisTerrain === true, JSON.stringify(dedans));
  na.equal(pointDansContour(centre, SITE.contourWgs84), true);
  na.equal(pointDansContour(pointRue, SITE.contourWgs84), false);
  // Depuis la rue, direction vers la maison : la première parcelle visée.
  const rue = choisirParcelle(FEATURES, pointRue, capVers(pointRue, centre));
  na.ok(rue.ok && rue.parcelle.idu === P0646 && rue.parcelle.depuisTerrain === false, JSON.stringify(rue));
  // Depuis la rue, sans direction : aucune maison devinée.
  const sans = choisirParcelle(FEATURES, pointRue, null);
  na.equal(sans.ok, false);
  na.match((sans as { raison: string }).raison, /direction/);
  // Visée vers l'extérieur : rien à moins de 80 m.
  const dos = choisirParcelle(FEATURES, pointRue, (capVers(pointRue, centre) + 180) % 360);
  na.equal(dos.ok, false, 'aucune parcelle visée dans le dos');
  const carre = carreRecherche(pointRue, 60);
  na.equal(carre.coordinates[0]!.length, 5);
});

// ── Parcours complet depuis une photo (aucune parcelle donnée) ──────────────────────────────────────────────
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

Deno.test('G3-4 : photo (EXIF depuis la rue) + « extension de 4 × 5 m à l’arrière, même hauteur… » → parcelle trouvée, photo gardée, parcours prérempli jusqu’au gabarit, dossier créé', async () => {
  const sorties: Record<string, unknown>[] = [];
  const dossiers: { idu: string; parcelle: Record<string, unknown> }[] = [];
  const depot: DepotExtension = {
    conception: async (_u, q) => (q.idu && dossiers.some((d) => d.idu === q.idu) ? { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', idu: q.idu, commune: null, parcelle: dossiers[0]!.parcelle, regles_plu: [] } : null),
    sortiesPrecedentes: async () => [...sorties].reverse(),
    creerDossierParcelle: async (_u, d) => { dossiers.push({ idu: d.idu, parcelle: d.parcelle }); return 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'; },
  };
  const deposees: string[] = [];
  const depotPhoto: DepotPhotoProjet = { deposer: async (u, o, t) => { deposees.push(`${u}:${o.length}:${t}`); return `${u}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`; } };
  const jpeg = jpegAvecGps(pointRue.lat, pointRue.lon, capVers(pointRue, centre));
  const photo: PhotoDuTour = { nom: 'maison.jpg', mediaType: 'image/jpeg', charger: async () => jpeg };
  const compteur = { cadastreGeom: 0, dossier: 0 };
  const tour = async (t: string, p: PhotoDuTour | null = null) => {
    const r = await executerOutilExtension({}, { userId: USER, conversationId: 'conv-g3', texteUtilisateur: t, depot, fetch: reseau(compteur), photoDuTour: p, depotPhoto, maintenant: () => Date.parse('2026-11-17T17:00:00Z') });
    if (r.status === 'ok') sorties.push(r.data!);
    return r;
  };
  const r1 = await tour('Voici ma maison : ajoute une extension de 4 × 5 m à l’arrière, même hauteur, menuiseries anthracite avec baie vitrée. Je garde la maison.', photo);
  na.equal(r1.status, 'ok', r1.message);
  na.equal(deposees.length, 1, 'photo d’origine déposée une fois');
  na.equal(deposees[0], `${USER}:${jpeg.length}:image/jpeg`);
  const d1 = r1.data!;
  na.equal((d1.vue as { idu: string }).idu, P0646, 'parcelle retrouvée par la position et la direction de la photo');
  na.equal(d1.etape, 'confirmer', 'reste à confirmer le toit et les niveaux de la maison');
  const etat1 = d1.etat as Record<string, unknown>;
  na.deepEqual([etat1.conserver, etat1.type, etat1.facade, etat1.largeurM, etat1.profondeurM, etat1.memeHauteur, etat1.menuiserie, etat1.baies],
    [true, 'arriere', 'arriere', 4, 5, true, 'av-aluminium-noir', 'auto']);
  const av1 = (d1.vue as { avertissements: string[] }).avertissements;
  na.ok(av1.some((l) => /^Repris de votre message : 4 × 5 m, maison conservée, extension arrière, à l’arrière, même hauteur que la maison, menuiseries anthracite, avec baie vitrée\./.test(l)), av1.join(' | '));
  na.ok(av1.some((l) => /servira de fond à l’image de l’extension/.test(l)));
  na.ok(av1.some((l) => /Parcelle 930470000P0646 retrouvée d’après la position et direction de prise de vue/.test(l)), av1.join(' | '));
  const ph = lirePhotoProjet(d1.photo_projet)!;
  na.ok(ph && ph.idu === P0646 && ph.depuis_terrain === false && ph.cap_deg !== null && ph.position !== null);
  for (const l of av1) na.doesNotMatch(l, JARGON);
  // Tours suivants : seulement les questions manquantes ; la photo reste celle du projet.
  let questions = 1;
  const r2 = await tour('Toit de la maison : 2 pans · Niveaux de la maison : R+1');
  if ((r2.data!.attendues as string[]).length) questions += 1;
  na.equal(r2.data!.etape, 'dimensions', 'dimensions et hauteur déjà dites : seulement pente, faîtage, égout');
  na.deepEqual(r2.data!.attendues, [Q.penteToit.id, Q.faitage.id, Q.egout.id]);
  const r3 = await tour('Pente du toit de la maison : Je ne sais pas · Sens du faîtage : Je ne sais pas · Hauteur à l’égout de la maison : Je ne sais pas (estimation)');
  if ((r3.data!.attendues as string[]).length) questions += 1;
  na.equal(r3.data!.etape, 'surface');
  na.deepEqual(r3.data!.attendues, [Q.surface.id, Q.demandeur.id, Q.cloture.id], 'menuiseries et baie déjà dites');
  const r4 = await tour('Surface de plancher existante : Je ne sais pas · Demandeur : Particulier · Clôture sur rue : ≈ 1,5 m');
  na.equal(r4.data!.etape, 'termine', String(r4.data!.texte_affiche));
  na.equal(questions, 3, 'trois séries de questions (maison ; toit ; surface et clôture) après le message initial');
  const vue = r4.data!.vue as { extension: { verdict: string }; avertissements: string[] };
  na.equal(vue.extension.verdict, 'ok', JSON.stringify(vue.extension));
  na.equal(r4.data!.phrase_relance, 'Si vous le souhaitez, je peux maintenant préparer l’image de l’extension sur votre photo.');
  na.equal(lirePhotoProjet(r4.data!.photo_projet)?.chemin, ph.chemin, 'même photo du début à la fin');
  na.equal(deposees.length, 1, 'jamais redéposée');
  // Dossier minimal de la parcelle créé au placement (aucune fiche avant), une seule fois.
  na.equal(dossiers.length, 1);
  na.equal(r4.data!.dossier_parcelle_id, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  na.ok(vue.avertissements.some((l) => /Dossier de la parcelle 930470000P0646 créé dans Mimmoza/.test(l)));
  na.equal((dossiers[0]!.parcelle.voisines as { statut: string }).statut, 'disponibles');
  const projet = r4.data!.projet_extension as { extension: { facade: { cote: string } } };
  na.equal(projet.extension.facade.cote, 'arriere');
  na.equal(photoProjetDesSorties([...sorties].reverse())?.chemin, ph.chemin);
});

Deno.test('G3-5 : photo SANS position ni parcelle → photo gardée, adresse demandée (phrase exacte), rien d’estimé ; photo dans le terrain → avertissement gauche/droite', async () => {
  const sorties: Record<string, unknown>[] = [];
  const depot: DepotExtension = { conception: async () => null, sortiesPrecedentes: async () => [...sorties].reverse() };
  const depotPhoto: DepotPhotoProjet = { deposer: async (u) => `${u}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png` };
  const png: PhotoDuTour = { nom: 'capture.png', mediaType: 'image/png', charger: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) };
  const r = await executerOutilExtension({}, { userId: USER, conversationId: 'c', texteUtilisateur: 'agrandis ma maison à gauche', depot, fetch: reseau({ cadastreGeom: 0, dossier: 0 }), photoDuTour: png, depotPhoto });
  na.equal(r.status, 'ok');
  na.equal(r.data!.etape, 'sans_parcelle');
  na.equal(r.data!.phrase_relance, 'J’ai bien votre photo. Donnez-moi l’adresse ou la référence cadastrale de la maison, et je reprends.');
  na.ok(lirePhotoProjet(r.data!.photo_projet));
  na.equal('vue' in r.data!, false, 'aucune estimation');
  sorties.push(r.data!);
  // Tour suivant : la parcelle est donnée ; la photo du tour précédent est reprise et rattachée.
  const r2 = await executerOutilExtension({ idu: P0646 }, { userId: USER, conversationId: 'c', texteUtilisateur: '930470000P0646', depot, fetch: reseau({ cadastreGeom: 0, dossier: 0 }) });
  na.equal(lirePhotoProjet(r2.data!.photo_projet)?.idu, P0646);
  na.equal(lirePhotoProjet(r2.data!.photo_projet)?.chemin, `${USER}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png`);
  // Photo prise DEPUIS le terrain : avertissement sur le sens de « gauche / droite ».
  const jardin: PhotoDuTour = { nom: 'jardin.jpg', mediaType: 'image/jpeg', charger: async () => jpegAvecGps(centre.lat, centre.lon, null) };
  const r3 = await executerOutilExtension({}, { userId: USER, conversationId: 'c2', texteUtilisateur: 'ajoute une extension à gauche', depot: { conception: async () => null, sortiesPrecedentes: async () => [] }, fetch: reseau({ cadastreGeom: 0, dossier: 0 }), photoDuTour: jardin, depotPhoto });
  const av = (r3.data!.vue as { avertissements: string[] }).avertissements;
  na.equal(lirePhotoProjet(r3.data!.photo_projet)?.depuis_terrain, true);
  na.ok(av.some((l) => /prise depuis votre terrain : « à gauche » et « à droite » s’entendent toujours vus depuis la rue/.test(l)), av.join(' | '));
  na.equal((r3.data!.etat as { facade: string }).facade, 'gauche', 'jamais converti à l’aveugle : dit, et corrigeable');
  // Relecture stricte.
  na.equal(lirePhotoProjet({ v: 1, chemin: '../x.jpg', octets: 3, media_type: 'image/jpeg', recue_le: '2026-11-17' }), null);
  na.deepEqual(optionPhotoClient(lirePhotoProjet(r.data!.photo_projet)!), { chemin: `${USER}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png`, octets: 7 });
});

// ── Image : la photo envoyée est le fond (jamais la photo de la rue) ────────────────────────────────────────
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

Deno.test('G3-6 : extension placée + photo envoyée → le rendu lancé a pour fond CETTE photo (photo du client), jamais la photo de la rue ; la 3D part de la parcelle du parcours', async () => {
  // Parcours terminé (rejoué sur P0646, sorties réelles de G3-4 reconstituées ici).
  const sorties: Record<string, unknown>[] = [];
  const depotExt: DepotExtension = { conception: async () => null, sortiesPrecedentes: async () => [...sorties].reverse() };
  const jpeg = jpegAvecGps(pointRue.lat, pointRue.lon, capVers(pointRue, centre));
  const chemin = `${USER}/cccccccc-cccc-4ccc-8ccc-cccccccccccc.jpg`;
  const env0 = (t: string, p: PhotoDuTour | null = null) => ({ userId: USER, conversationId: 'conv-g3-img', texteUtilisateur: t, depot: depotExt, fetch: reseau({ cadastreGeom: 0, dossier: 0 }), photoDuTour: p, depotPhoto: { deposer: async () => chemin } });
  for (const [t, p] of [
    ['ajoute une extension de 4 × 5 m à l’arrière, même hauteur, menuiseries anthracite avec baie vitrée, je garde la maison', { nom: 'm.jpg', mediaType: 'image/jpeg', charger: async () => jpeg }],
    ['Toit de la maison : 2 pans · Niveaux de la maison : R+1', null],
    ['Pente du toit de la maison : Je ne sais pas · Sens du faîtage : Je ne sais pas · Hauteur à l’égout de la maison : Je ne sais pas (estimation)', null],
    ['Surface de plancher existante : Je ne sais pas · Demandeur : Particulier · Clôture sur rue : ≈ 1,5 m', null],
  ] as [string, PhotoDuTour | null][]) {
    const r = await executerOutilExtension({}, env0(t, p));
    na.equal(r.status, 'ok', r.message);
    sorties.push(r.data!);
  }
  na.equal(sorties.at(-1)!.etape, 'termine');
  // Studio : deux dossiers de parcelle existent ; la 3D doit partir de celui du parcours (P0646), pas du plus récent.
  const d = new Depot();
  d.sorties = [...sorties].reverse();
  d.conceptions.push({
    id: '55555555-5555-4555-8555-555555555555', idu: P0646, commune: 'Montfermeil', user_id: USER, regles_plu: [], programme: null,
    parcelle: { idu: P0646, geometrie: C.parcelle.geometrie, surface_m2: C.parcelle.surface_m2 ?? null, source: 'cadastre', voisines: C.parcelle.voisines },
  } as unknown as ConceptionLue & { user_id: string });
  d.conceptions.push({
    id: '44444444-4444-4444-8444-444444444444', idu: '93048000AS0249', commune: 'Montreuil', user_id: USER, regles_plu: [], programme: { nb_logements: 6, gabarit: 'R+3' },
    parcelle: { idu: '93048000AS0249', geometrie: CADASTRE.parcelle.geometry, surface_m2: null, source: 'cadastre', voisines: { statut: 'disponibles', source: 'API Carto IGN', parcelles: CADASTRE.voisines.map((v: { geometry: unknown; idu?: string }) => ({ idu: v.idu ?? null, geometrie: v.geometry })) } },
  } as unknown as ConceptionLue & { user_id: string });
  const env = (rq: string): EnvStudio => ({ userId: USER, depot: d, secret: 'secret-de-test', requete: rq, conversationId: 'conv-g3-img', origine: 'https://mimmoza.vercel.app' });
  const p = await executerOutilStudio('studio_preparer_3d', {}, env('P0'));
  na.equal(p?.status, 'ok', p?.message);
  na.equal((p!.data as { idu: string }).idu, P0646, 'support de parcelle = parcelle du parcours, pas le dossier le plus récent');
  const r1 = await executerOutilStudio('studio_lancer_rendu', { type: 'image' }, env('R1'));
  na.equal(r1?.status, 'confirmation_requise', r1?.message);
  d.appels.push(structuredClone(r1!) as unknown as Record<string, unknown>);
  const r2 = await executerOutilStudio('studio_lancer_rendu', { confirmer: true }, env('R2'));
  na.equal(r2?.status, 'ok', r2?.message);
  const t = d.travaux.at(-1)!;
  na.equal(t.options.fond, 'photo_client', JSON.stringify(t.options));
  na.deepEqual(t.options.photo_client, { chemin, octets: jpeg.length });
  na.equal(t.options.existant, 'conserver');
  na.equal((t.fiche.projet_extension as { nature: string }).nature, 'extension');
  na.equal('brief_rendu' in t.fiche, false);
});
