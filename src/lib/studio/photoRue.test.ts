// node --test src/lib/studio/photoRue.test.ts
// LOT P2 (11/11/2026) — « image dans sa rue », côté site : options de fond, couverture Panoramax (réponse RÉELLE de
// l'instance IGN autour de 93048000AS0249, relevée le 11/11/2026, et cadastre réel de la parcelle), lecture EXIF
// (JPEG fabriqué octet par octet), diagnostic de la photo, point de vue saisi, résultat du photomontage (libellé
// honnête), atelier « Ajuster le placement », carte « Fond de l'image ».
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validerFond, lireCalageClient, RE_CHEMIN_PHOTO } from './fondImage.ts';
import {
  contourDepuisGeometrie, distanceAuContourM, lireContour, lireCouverture, lireCouvertureTransmise, phraseCouverture, urlRechercheIgn, verifierCouverture,
} from './couverturePhotoRue.ts';
import { capEntre, cheminPhotoClient, diagnostiquerPhoto, EXIF_ABSENT, lireExifPhoto, pointDeVueATransmettre } from './photoClientLogique.ts';
import { libelleResultatImage, lirePhotomontage, lireTravail, resumeOptions, validerOptions, type OptionsImage } from './travauxLogique.ts';
import { examinerMessageCalage, ficheReprise, optionsAvecCalage, urlAtelier, TYPE_MESSAGE_CALAGE, TYPE_MESSAGE_RECU } from './atelierPhotomontage.ts';
import { appelsSuiviRemplaces, cartesSuivi, vueCarteSuivi, type IndiceSuivi } from '../../spaces/copilot/studio3d/suiviRenduChat.ts';
import { lireDevisFond, messageFond, tuilesFond } from '../../spaces/copilot/studio3d/choixFond.ts';

const CADASTRE = JSON.parse(readFileSync(new URL('../../spaces/copilot/studio3d/__fixtures__/cadastre-93048000AS0249.json', import.meta.url), 'utf8'));
const PANORAMAX = JSON.parse(readFileSync(new URL('./__fixtures__/panoramax-montreuil-AS0249.json', import.meta.url), 'utf8'));
const CONTOUR = contourDepuisGeometrie(CADASTRE.parcelle.geometry)!;
const USER = '11111111-1111-4111-8111-111111111111';
const PHOTO = `${USER}/33333333-3333-4333-8333-333333333333.jpg`;
const JOB = 'aaaaaaaa-1111-4111-8111-111111111111';
const CALAGE = {
  version: 1, largeur_image: 4032, hauteur_image: 3024, valide_le: '2026-11-11T12:00:00Z',
  correspondances: [{ image: [100, 2000], monde: [2.4286, 48.8566, 0] }, { image: [3900, 2100], monde: [2.4289, 48.8566, 0] }],
};

// ── Options de fond ─────────────────────────────────────────────────────────────────────────────────

test('options : une image d’étude garde EXACTEMENT ses options d’avant ; les nouvelles clés suivent le contrat', () => {
  assert.deepEqual(validerOptions('image', { vues: ['face'], fond: 'etude' }), { ok: true, valeur: { vues: ['face'], ambiance: 'jour', qualite: 'finale' } });
  const rue = validerOptions('image', { fond: 'photo_rue', qualite: 'apercu' });
  assert.deepEqual(rue, { ok: true, valeur: { vues: ['trois_quarts_gauche'], ambiance: 'jour', qualite: 'apercu', fond: 'photo_rue' } });
  assert.equal(validerOptions('image', { fond: 'photo_client', photo_client: { chemin: PHOTO, octets: 3456789 } }).ok, true);
  assert.equal(validerOptions('image', { fond: 'photo_client' }).ok, false, 'photo obligatoire');
  assert.equal(validerOptions('image', { fond: 'photo_rue', calage_client: CALAGE }).ok, true);
  assert.equal(validerOptions('image', { calage_client: CALAGE }).ok, false, 'calage sans photo');
  assert.equal(validerOptions('image', { fond: 'street_view' }).ok, false);
  assert.equal(validerOptions('film', { fond: 'photo_rue' }).ok, false, 'film inchangé');
  // Dossier du compte (le site connecté et le serveur le vérifient ; la base aussi, par contrainte).
  assert.equal(validerFond({ fond: 'photo_client', photo_client: { chemin: PHOTO, octets: 1 } }, USER).ok, true);
  assert.equal(validerFond({ fond: 'photo_client', photo_client: { chemin: PHOTO, octets: 1 } }, '22222222-2222-4222-8222-222222222222').ok, false);
  assert.ok(RE_CHEMIN_PHOTO.test(PHOTO) && !RE_CHEMIN_PHOTO.test(`${USER}/../x.jpg`) && !RE_CHEMIN_PHOTO.test(`${USER}/33333333-3333-4333-8333-333333333333.heic`));
  // Calage : 2 à 12 points, dans la photo, date ISO.
  assert.equal(lireCalageClient(CALAGE).ok, true);
  assert.equal(lireCalageClient({ ...CALAGE, correspondances: CALAGE.correspondances.slice(0, 1) }).ok, false);
  assert.equal(lireCalageClient({ ...CALAGE, correspondances: [...CALAGE.correspondances, { image: [5000, 1], monde: [2.4, 48.8, 0] }] }).ok, false);
  assert.equal(lireCalageClient({ ...CALAGE, valide_le: '11/11/2026' }).ok, false);
  assert.equal(resumeOptions('image', { vues: ['face'], fond: 'photo_client', photo_client: { chemin: PHOTO, octets: 1 }, calage_client: CALAGE }),
    'Face · en journée · votre photo du trottoir · placement ajusté');
});

// ── Couverture Panoramax ────────────────────────────────────────────────────────────────────────────

test('couverture réelle de AS0249 : photos Licence Ouverte à 60 m au plus, les plus proches d’abord ; CC-BY-SA écartées', async () => {
  assert.ok(CONTOUR.length >= 3);
  assert.match(urlRechercheIgn(CONTOUR), /^https:\/\/panoramax\.ign\.fr\/api\/search\?bbox=[\d.]+,[\d.]+,[\d.]+,[\d.]+&limit=100$/);
  const c = lireCouverture(PANORAMAX, CONTOUR, '2026-11-11T12:00:00.000Z');
  assert.equal(c.couverte, true);
  assert.ok(c.photos.length >= 1 && c.photos.length <= 10);
  for (let i = 1; i < c.photos.length; i++) assert.ok(c.photos[i - 1].distanceM <= c.photos[i].distanceM);
  assert.ok(c.photos.every((p) => p.distanceM <= 60 && /^\d{4}-\d{2}-\d{2}$/.test(p.date)));
  assert.deepEqual(lireCouvertureTransmise(JSON.parse(JSON.stringify(c))), c);
  assert.match(phraseCouverture(c), /sous Licence Ouverte \(Panoramax, instance IGN\) à moins de 60 m/);
  const ccbysa = structuredClone(PANORAMAX);
  for (const f of ccbysa.features) f.properties.license = 'CC-BY-SA-4.0';
  assert.deepEqual(lireCouverture(ccbysa, CONTOUR, 'x'), { couverte: false, photos: [], verifieLe: 'x' });
  // Appel injecté, puis panne : « non vérifiée », jamais « absente ».
  const ok = await verifierCouverture(CONTOUR, (async () => new Response(JSON.stringify(PANORAMAX))) as typeof fetch);
  assert.equal(ok.ok, true);
  const ko = await verifierCouverture(CONTOUR, (async () => { throw new Error('hors ligne'); }) as typeof fetch);
  assert.deepEqual(ko, { ok: false, raison: 'Panoramax (instance IGN) n’a pas répondu : couverture non vérifiée.' });
});

test('distance au contour : 0 dedans, ~10 m à 10 m au sud du point le plus au sud', () => {
  const sud = CONTOUR.reduce((a, b) => (b[1] < a[1] ? b : a));
  const centre: [number, number] = [CONTOUR.reduce((s, p) => s + p[0], 0) / CONTOUR.length, CONTOUR.reduce((s, p) => s + p[1], 0) / CONTOUR.length];
  assert.equal(distanceAuContourM(centre, CONTOUR), 0);
  const d = distanceAuContourM([sud[0], sud[1] - 10 / 111_132], CONTOUR);
  assert.ok(d > 8 && d <= 10.01, String(d));
  assert.equal(lireContour([[0, 0], [1, 1]]), null);
});

// ── EXIF et diagnostic de la photo du client ─────────────────────────────────────────────────────────

type E = { tag: number; type: 2 | 3 | 4 | 5; valeurs: number[] | string };
/** JPEG minimal (SOI, APP1 Exif, EOI) avec les IFD donnés, petit-boutiste. */
function jpegExif(ifd0: E[], exif: E[], gps: E[]): Uint8Array {
  const taille = (n: number) => 2 + 12 * n + 4;
  const e0 = [...ifd0, ...(exif.length ? [{ tag: 0x8769, type: 4 as const, valeurs: [0] }] : []), ...(gps.length ? [{ tag: 0x8825, type: 4 as const, valeurs: [0] }] : [])].sort((a, b) => a.tag - b.tag);
  const offEx = 8 + taille(e0.length), offGps = offEx + (exif.length ? taille(exif.length) : 0);
  let offData = offGps + (gps.length ? taille(gps.length) : 0);
  for (const e of e0) { if (e.tag === 0x8769) e.valeurs = [offEx]; if (e.tag === 0x8825) e.valeurs = [offGps]; }
  const t = new Uint8Array(4096), dv = new DataView(t.buffer);
  t.set([0x49, 0x49]); dv.setUint16(2, 42, true); dv.setUint32(4, 8, true);
  const encoder = (e: E): number[] => {
    if (e.type === 2) return [...String(e.valeurs)].map((c) => c.charCodeAt(0)).concat(0);
    const o: number[] = [];
    for (const v of e.valeurs as number[]) {
      const b = new DataView(new ArrayBuffer(8));
      if (e.type === 3) { b.setUint16(0, v, true); o.push(...new Uint8Array(b.buffer, 0, 2)); }
      else if (e.type === 4) { b.setUint32(0, v, true); o.push(...new Uint8Array(b.buffer, 0, 4)); }
      else { b.setUint32(0, Math.round(v * 10000), true); b.setUint32(4, 10000, true); o.push(...new Uint8Array(b.buffer)); }
    }
    return o;
  };
  const ecrire = (off: number, entrees: E[]) => {
    dv.setUint16(off, entrees.length, true);
    entrees.forEach((e, k) => {
      const p = off + 2 + 12 * k, octets = encoder(e);
      dv.setUint16(p, e.tag, true); dv.setUint16(p + 2, e.type, true);
      dv.setUint32(p + 4, e.type === 2 ? octets.length : (e.valeurs as number[]).length, true);
      if (octets.length <= 4) t.set(octets, p + 8);
      else { dv.setUint32(p + 8, offData, true); t.set(octets, offData); offData += octets.length + (octets.length % 2); }
    });
    dv.setUint32(off + 2 + 12 * entrees.length, 0, true);
  };
  ecrire(8, e0);
  if (exif.length) ecrire(offEx, exif);
  if (gps.length) ecrire(offGps, gps);
  const tiff = t.slice(0, offData);
  const longueur = 2 + 6 + tiff.length;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, longueur >> 8, longueur & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff, 0xff, 0xd9]);
}

const EXIF_COMPLET = jpegExif(
  [{ tag: 0x0112, type: 3, valeurs: [1] }],
  [{ tag: 0x920a, type: 5, valeurs: [4.25] }, { tag: 0xa002, type: 4, valeurs: [4032] }, { tag: 0xa003, type: 4, valeurs: [3024] }, { tag: 0xa405, type: 3, valeurs: [26] }],
  [{ tag: 0x0001, type: 2, valeurs: 'N' }, { tag: 0x0002, type: 5, valeurs: [48, 51, 24.12] }, { tag: 0x0003, type: 2, valeurs: 'E' },
    { tag: 0x0004, type: 5, valeurs: [2, 25, 43.2] }, { tag: 0x0010, type: 2, valeurs: 'T' }, { tag: 0x0011, type: 5, valeurs: [12.5] }],
);

test('EXIF lus dans le navigateur : position, direction (GPSImgDirection), focale, orientation ; rien de deviné', () => {
  const ex = lireExifPhoto(EXIF_COMPLET);
  assert.equal(ex.orientation, 1);
  assert.equal(ex.focaleMm, 4.25);
  assert.equal(ex.focale35mm, 26);
  assert.deepEqual([ex.largeurExif, ex.hauteurExif], [4032, 3024]);
  assert.ok(Math.abs(ex.gps!.lat - (48 + 51 / 60 + 24.12 / 3600)) < 1e-6);
  assert.ok(Math.abs(ex.gps!.lon - (2 + 25 / 60 + 43.2 / 3600)) < 1e-6);
  assert.deepEqual([ex.capDeg, ex.capReference], [12.5, 'T']);
  assert.deepEqual(lireExifPhoto(new Uint8Array([1, 2, 3])), EXIF_ABSENT);
  assert.deepEqual(lireExifPhoto(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])), EXIF_ABSENT);
  const sansGps = lireExifPhoto(jpegExif([{ tag: 0x0112, type: 3, valeurs: [6] }], [{ tag: 0xa405, type: 3, valeurs: [77] }], []));
  assert.deepEqual([sansGps.gps, sansGps.capDeg, sansGps.orientation, sansGps.focale35mm], [null, null, 6, 77]);
});

test('diagnostic : paysage exigé, position et direction à saisir si absentes, zoom signalé, format et taille', () => {
  const ex = lireExifPhoto(EXIF_COMPLET);
  assert.deepEqual(diagnostiquerPhoto({ type: 'image/jpeg', octets: 3e6, exif: ex, largeur: 4032, hauteur: 3024, ecartParcelleM: 12 }).map((l) => l.niveau), ['ok']);
  const portrait = diagnostiquerPhoto({ type: 'image/jpeg', octets: 3e6, exif: ex, largeur: 3024, hauteur: 4032 });
  assert.match(portrait[0].texte, /portrait.*paysage/);
  const nu = diagnostiquerPhoto({ type: 'image/jpeg', octets: 3e6, exif: { ...EXIF_ABSENT, focale35mm: 77 }, largeur: 4032, hauteur: 3024 });
  assert.deepEqual(nu.map((l) => l.niveau), ['a_saisir', 'a_saisir', 'avertissement']);
  assert.match(nu[2].texte, /zoom \(équivalent 77 mm\)/);
  assert.equal(diagnostiquerPhoto({ type: 'image/heic', octets: 3e6, exif: ex, largeur: 4032, hauteur: 3024 })[0].niveau, 'bloquant');
  assert.equal(diagnostiquerPhoto({ type: 'image/jpeg', octets: 25e6, exif: ex, largeur: 4032, hauteur: 3024 })[0].niveau, 'bloquant');
  assert.match(diagnostiquerPhoto({ type: 'image/jpeg', octets: 3e6, exif: ex, largeur: 4032, hauteur: 3024, ecartParcelleM: 400 }).at(-1)!.texte, /à 400 m de la parcelle/);
});

test('point de vue : rien à transmettre si l’EXIF a tout ; sinon position et direction saisies sur le plan', () => {
  const ex = lireExifPhoto(EXIF_COMPLET);
  assert.deepEqual(pointDeVueATransmettre(ex, { position: null, visee: null }), { pret: true, point: null });
  const a = { lon: 2.4286, lat: 48.8565 };
  assert.equal(pointDeVueATransmettre(EXIF_ABSENT, { position: null, visee: null }).pret, false);
  assert.equal(pointDeVueATransmettre(EXIF_ABSENT, { position: a, visee: null }).pret, false);
  const nord = pointDeVueATransmettre(EXIF_ABSENT, { position: a, visee: { lon: 2.4286, lat: 48.8566 } });
  assert.deepEqual(nord, { pret: true, point: { lon: 2.4286, lat: 48.8565, cap_deg: 0 } });
  assert.equal(capEntre(a, { lon: 2.4287, lat: 48.8565 }), 90);
  assert.equal(capEntre(a, { lon: 2.4286, lat: 48.8564 }), 180);
  assert.equal(capEntre(a, a), null);
  // GPS présent, direction absente : seule la visée est saisie.
  const gpsSeul = { ...ex, capDeg: null };
  assert.deepEqual(pointDeVueATransmettre(gpsSeul, { position: null, visee: { lon: ex.gps!.lon, lat: ex.gps!.lat + 0.0001 } }),
    { pret: true, point: { lon: Math.round(ex.gps!.lon * 1e6) / 1e6, lat: Math.round(ex.gps!.lat * 1e6) / 1e6, cap_deg: 0 } });
  assert.equal(cheminPhotoClient(USER.toUpperCase(), '33333333-3333-4333-8333-333333333333', 'image/jpeg'), PHOTO);
  assert.equal(cheminPhotoClient(USER, '33333333-3333-4333-8333-333333333333', 'image/heic'), null);
});

// ── Résultat du photomontage ─────────────────────────────────────────────────────────────────────────

const base = { id: JOB, type: 'image', statut: 'termine', progression: 100, options: { fond: 'photo_rue' }, cree_le: '2026-11-11T10:00:00Z', maj_le: '2026-11-11T10:20:00Z' };
const IMAGES = { image_path: `${USER}/${JOB}/image-face.jpg`, images: [{ vue: 'face', jpeg_path: `${USER}/${JOB}/image-face.jpg` }] };
const INDICE: IndiceSuivi = { jobId: JOB, origine: 'lance', type: 'image', statut: 'en_attente', machine: 'La machine de rendu ne donne pas signe de vie (1 rendu(s) en attente depuis 4 jours).', positionFile: null };

test('résultat : libellé honnête — insérée seulement si livrée ; sinon image d’étude avec la raison ; atelier si à valider', () => {
  const livre = lireTravail({ ...base, resultat: { ...IMAGES, photomontage: { tente: true, statut: 'livre', verdict: 'approximatif', incertitude_m: 0.8,
    source_photo: { type: 'panoramax', id: 'd36c2217-f0a8-4c56-88bb-5092cbe40b93', producteur: 'immergis', date: '2026-03-06', licence: 'etalab-2.0' },
    mention: 'Photo : Panoramax / IGN — immergis, 06/03/2026 — Licence Ouverte 2.0' } } })!;
  const v = vueCarteSuivi(livre, INDICE, Date.parse('2026-11-15T10:00:00Z'));
  assert.equal(v.titre, 'Image insérée dans la photo de la rue — prête');
  assert.equal(v.image?.mention, 'Photo : Panoramax / IGN — immergis, 06/03/2026 — Licence Ouverte 2.0');
  assert.equal(v.image?.raison, 'placement approximatif, précision ± 0,8 m');
  // Défaut du 10/11 : une image livrée n'affiche plus rien de l'attente (ni « en attente », ni la machine).
  assert.deepEqual([v.etat, v.pastille, v.details, v.alerte, v.actif], ['termine', 'Prêt', [], null, false]);
  const aValider = lireTravail({ ...base, resultat: { ...IMAGES, photomontage: { tente: true, statut: 'a_valider', verdict: 'insuffisant', raison: 'Calage insuffisant (± 1,6 m).',
    atelier: { photo_path: `${USER}/${JOB}/atelier/photo.jpg`, plan_path: `${USER}/${JOB}/atelier/plan.json` } } } })!;
  const va = vueCarteSuivi(aValider, INDICE, Date.parse('2026-11-15T10:00:00Z'));
  assert.equal(va.titre, 'Image d’étude — prête');
  assert.deepEqual([va.image?.inseree, va.image?.raison, va.image?.aValider], [false, 'Calage insuffisant (± 1,6 m).', true]);
  const repli = libelleResultatImage({ photomontage: lirePhotomontage({ statut: 'repli_etude', raison: 'Bâtiment existant visible sur la photo.' }) });
  assert.deepEqual([repli.titre, repli.raison, repli.aValider], ['Image d’étude', 'Bâtiment existant visible sur la photo.', false]);
  // Résultat antérieur au lot (sans photomontage) : image d'étude, jamais « photoréaliste ».
  assert.equal(vueCarteSuivi(lireTravail({ ...base, resultat: IMAGES })!, INDICE, 0).titre, 'Image d’étude — prête');
  // Atelier sans chemins : pas de bouton.
  assert.equal(lirePhotomontage({ statut: 'a_valider', atelier: { photo_path: 'x' } })?.atelier, null);
  assert.equal(lirePhotomontage({ statut: 'inconnu' }), null);
});

// ── Atelier « Ajuster le placement » ─────────────────────────────────────────────────────────────────

test('atelier : adresse, filtre du retour (origine, fenêtre, travail, calage revalidé), nouveau travail identique avec le calage', () => {
  assert.equal(urlAtelier('https://mimmoza.vercel.app/studio/', JOB), `https://mimmoza.vercel.app/studio/?atelier=photomontage&travail=${JOB}`);
  const O = 'https://mimmoza.vercel.app';
  const msg = { type: TYPE_MESSAGE_CALAGE, travail: JOB, calage_client: CALAGE };
  assert.equal(examinerMessageCalage({ origin: 'https://pirate.example', data: msg }, O, true, JOB).type, 'ignore');
  assert.equal(examinerMessageCalage({ origin: O, data: msg }, O, false, JOB).type, 'ignore');
  assert.equal(examinerMessageCalage({ origin: O, data: { ...msg, travail: 'autre' } }, O, true, JOB).type, 'ignore');
  assert.equal(examinerMessageCalage({ origin: O, data: { ...msg, calage_client: { ...CALAGE, version: 2 } } }, O, true, JOB).type, 'refus');
  const d = examinerMessageCalage({ origin: O, data: msg }, O, true, JOB);
  assert.equal(d.type, 'calage');
  const calage = (d as { calage: typeof CALAGE }).calage as never;
  // Accusé de réception de l'atelier (lot P3) : reconnu pour CE travail seulement.
  assert.deepEqual(examinerMessageCalage({ origin: O, data: { type: TYPE_MESSAGE_RECU, travail: JOB } }, O, true, JOB), { type: 'recu' });
  assert.equal(examinerMessageCalage({ origin: O, data: { type: TYPE_MESSAGE_RECU, travail: 'autre' } }, O, true, JOB).type, 'ignore');
  assert.equal(examinerMessageCalage({ origin: O, data: { type: TYPE_MESSAGE_RECU, travail: JOB } }, O, false, JOB).type, 'ignore');
  // Fond « photo de la rue » : la relance vise LA photo de l'image d'origine (source_photo.id), pas celle que le worker choisirait.
  const source = lirePhotomontage({ statut: 'a_valider', source_photo: { type: 'panoramax', id: '693baecd-d632-4c12-b28b-3f92b3278ccc', licence: 'etalab-2.0' } });
  const o = optionsAvecCalage({ vues: ['face'], ambiance: 'jour', qualite: 'finale', fond: 'photo_rue' }, calage, source);
  assert.equal(o.ok, true);
  assert.deepEqual((o as { valeur: OptionsImage }).valeur.calage_client, CALAGE);
  assert.equal((o as { valeur: OptionsImage }).valeur.photo_rue?.id, '693baecd-d632-4c12-b28b-3f92b3278ccc');
  const o2 = optionsAvecCalage({ vues: ['face'], fond: 'photo_rue', photo_rue: { id: 'd36c2217-f0a8-4c56-88bb-5092cbe40b93' } }, calage, source);
  assert.equal((o2 as { valeur: OptionsImage }).valeur.photo_rue?.id, '693baecd-d632-4c12-b28b-3f92b3278ccc', 'la photo réellement utilisée l’emporte');
  assert.match((optionsAvecCalage({ vues: ['face'], fond: 'photo_rue' }, calage, null) as { erreur: string }).erreur, /n’est pas identifiée/);
  // Photo du client : son chemin suffit à identifier la photo.
  assert.equal(optionsAvecCalage({ vues: ['face'], fond: 'photo_client', photo_client: { chemin: PHOTO, octets: 10 } }, calage, null).ok, true);
  assert.equal(optionsAvecCalage({ vues: ['face'] }, calage).ok, false, 'image d’étude : aucun calage');
  assert.deepEqual(ficheReprise({ version: 1, charge: { a: 1 }, devis_id: 'x' }, JOB), { ok: true, valeur: { version: 1, charge: { a: 1 }, reprise_de: JOB } });
  assert.equal(ficheReprise(null, JOB).ok, false);
});

test('bornes du calage identiques à celles du worker (lot P3) : 2 à 12 points, |z| ≤ 1000 m, 1 à 20 000 px, points dans l’image', () => {
  const pt = (x: number, y: number, z = 0) => ({ image: [x, y], monde: [2.4286, 48.8566, z] });
  const c = (m: Record<string, unknown>) => lireCalageClient({ ...CALAGE, ...m }).ok;
  assert.equal(c({ correspondances: Array(12).fill(pt(1, 1)) }), true);
  assert.equal(c({ correspondances: Array(13).fill(pt(1, 1)) }), false);
  assert.equal(c({ correspondances: [pt(1, 1, 1000), pt(1, 1, -1000)] }), true);
  assert.equal(c({ correspondances: [pt(1, 1, 1000.5), pt(1, 1)] }), false);
  assert.equal(c({ largeur_image: 20000, hauteur_image: 1, correspondances: [pt(20000, 1), pt(0, 0)] }), true, 'bords de l’image compris');
  assert.equal(c({ largeur_image: 20001 }), false);
  assert.equal(c({ hauteur_image: 0 }), false);
  assert.equal(c({ correspondances: [pt(4032.5, 1), pt(1, 1)] }), false);
});

test('reste du défaut du 10/11 : un appel de suivi plus ancien n’affiche plus sa sortie figée quand un état plus récent cite le même travail', () => {
  const appel = (id: string, name: string, data: Record<string, unknown>, status = 'ok') => ({ id, name, status: 'success', output: { status, data } });
  const messages = [
    { toolCalls: [appel('devis', 'studio_lancer_rendu', { jeton_devis: 'x', type: 'image' }, 'confirmation_requise')] },
    { toolCalls: [appel('lance', 'studio_lancer_rendu', { lance: true, job_id: JOB, type: 'image', statut: 'en_attente', machine: 'sans signe de vie depuis 4 jours' })] },
    { toolCalls: [appel('etat', 'studio_etat_rendu', { job_id: JOB, type: 'image', statut: 'en_attente' })] },
  ];
  assert.deepEqual([...appelsSuiviRemplaces(messages)], ['lance']);
  assert.deepEqual([...cartesSuivi(messages).keys()], ['etat']);
  assert.deepEqual([...appelsSuiviRemplaces(messages.slice(0, 2))], [], 'un seul appel : il garde sa carte vivante');
});

// ── Carte « Fond de l'image » ────────────────────────────────────────────────────────────────────────

test('carte « Fond de l’image » : tuiles selon la couverture ; message avec le brief du devis et le fond', () => {
  const couverture = lireCouverture(PANORAMAX, CONTOUR, '2026-11-11T12:00:00.000Z');
  const appel = (fondImage: unknown) => ({ name: 'studio_lancer_rendu', status: 'success', output: { status: 'confirmation_requise', data: { type: 'image', fond_image: fondImage } } });
  const d = lireDevisFond(appel({ choisi: 'etude', couverture, facade_sur_voie: 'identifiée : 28,65 m', contour: CONTOUR }))!;
  assert.equal(d.couverture?.couverte, true);
  assert.deepEqual(tuilesFond(d).map((t) => [t.fond, t.actif]), [['photo_rue', true], ['photo_client', true], ['etude', true]]);
  const sans = lireDevisFond(appel({ choisi: 'etude', couverture: { couverte: false, photos: [], verifieLe: 'x' } }))!;
  assert.deepEqual(tuilesFond(sans).map((t) => t.actif), [false, true, true]);
  const nonVerifiee = lireDevisFond(appel({ choisi: 'etude', couverture: { verifiee: false, raison: 'Panoramax (instance IGN) n’a pas répondu : couverture non vérifiée.' } }))!;
  assert.equal(tuilesFond(nonVerifiee)[0].detail, 'Panoramax (instance IGN) n’a pas répondu : couverture non vérifiée.');
  assert.equal(lireDevisFond({ name: 'studio_lancer_rendu', output: { status: 'confirmation_requise', data: { type: 'film', fond_image: {} } } }), null);
  const actuel = { facade: 'brique', ouvertures: 'fenetres_verticales', balcons: 'loggias', attique: false, rdc: 'logements', ambiance: 'jour',
    toiture: 'terrasse', teinte: 'naturelle', garde_corps: 'metal', menuiseries: 'gris', soubassement: 'aucun', defauts: [] } as const;
  const m = messageFond({ actuel: actuel as never }, { fond: 'photo_rue' })!;
  assert.match(m, /^Fond de l’image : Photo de la rue \(Panoramax \/ IGN\)\.\n\n```mimmoza-brief\n/);
  const bloc = JSON.parse(m.split('\n')[3]);
  assert.deepEqual([bloc.v, bloc.type, bloc.fond, bloc.brief.facade], [1, 'image', { fond: 'photo_rue' }, 'brique']);
  assert.equal(messageFond(null, { fond: 'photo_rue' }), null);
});
