// supabase/functions/copilot-chat/agent/extension-g9.test.ts
// LOT G9 (18/11/2026) — photo de téléphone ordinaire jointe au chat (côté serveur) :
//   · l'ORIGINAL (pleine résolution, redressé) envoyé à côté de la copie du chat devient la photo du projet,
//     seulement s'il est dans le dossier du compte (sinon la copie du chat) ;
//   · une photo encore enregistrée « tournée » (orientation EXIF ≠ 1) n'est pas gardée : dit ;
//   · accord sur l'usage de la photo jointe isolé derrière ACCORD_PHOTO_JOINTE (décision d'Albé en attente) ;
//   · limite sur rue lue par le parcours (lot X10) reprise quand la fiche de parcelle ne l'a pas : la photo prise
//     depuis le jardin n'est plus arrêtée par la garde « façade sur voie ».
// JPEG et fiches FABRIQUÉS ici (aucune donnée réelle n'est nécessaire à ces règles).
import * as na from 'node:assert/strict';
import {
  ACCORD_PHOTO_JOINTE, lirePhotoProjet, photoDuTourGardee, photoProjetUtilisableCommeFond, recevoirPhoto, type PhotoProjet,
} from './photo-projet.ts';
import { facadesVoiePreparation, gardePhotoExtension, type ConceptionLue, type DepotStudio, type EnvStudio, type PreparationLue } from './studio.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const AUTRE = '22222222-2222-4222-8222-222222222222';
const IDU = '930470000P0646';

const le16 = (n: number): number[] => [n & 255, (n >>> 8) & 255];
const le32 = (n: number): number[] => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
/** JPEG minimal avec un IFD0 { Orientation }. */
function jpegOrientation(o: number): Uint8Array {
  const tiff = [0x49, 0x49, 0x2a, 0, ...le32(8), ...le16(1), ...le16(0x0112), ...le16(3), ...le32(1), ...le16(o), 0, 0, ...le32(0)];
  const lg = 2 + 6 + tiff.length;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, lg >> 8, lg & 255, 0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff, 0xff, 0xda, 0, 2, 0x11, 0xff, 0xd9]);
}

Deno.test('G9-S1 : l’original du compte devient la photo du projet ; sinon la copie du chat', () => {
  const copie = { name: 'IMG_1.jpg', mediaType: 'image/jpeg', storagePath: `${USER}/conv/20261118-080000-img_1.jpg` };
  const avec = { ...copie, originalPath: `${USER}/conv/20261118-080000-original-img_1.png`, originalMediaType: 'image/png' };
  na.deepEqual(photoDuTourGardee(avec, USER), { nom: 'IMG_1.jpg', mediaType: 'image/png', storagePath: avec.originalPath });
  na.deepEqual(photoDuTourGardee(copie, USER), { nom: 'IMG_1.jpg', mediaType: 'image/jpeg', storagePath: copie.storagePath });
  // Original d'un autre compte, chemin piégé ou format non photo : la copie du chat est gardée.
  na.equal(photoDuTourGardee({ ...avec, originalPath: `${AUTRE}/conv/x.jpg` }, USER).storagePath, copie.storagePath);
  na.equal(photoDuTourGardee({ ...avec, originalPath: `${USER}/../${AUTRE}/x.jpg` }, USER).storagePath, copie.storagePath);
  na.equal(photoDuTourGardee({ ...avec, originalMediaType: 'image/webp' }, USER).mediaType, 'image/jpeg');
  // Petite photo en base64 (pas d'original) : inchangée.
  na.deepEqual(photoDuTourGardee({ mediaType: 'image/jpeg', data: 'AAAA' }, USER), { nom: null, mediaType: 'image/jpeg', data: 'AAAA' });
});

Deno.test('G9-S2 : photo encore enregistrée tournée → pas gardée, raison dite ; photo droite → gardée', async () => {
  const depot = { deposer: async () => `${USER}/33333333-3333-4333-8333-333333333333.jpg` };
  const tournee = await recevoirPhoto({ nom: 'a.jpg', mediaType: 'image/jpeg', charger: async () => jpegOrientation(6) }, USER, depot, '2026-11-18', IDU);
  na.equal(tournee.photo, null);
  na.match(tournee.raison ?? '', /tournée/);
  na.doesNotMatch(tournee.raison ?? '', /orientation \d|EXIF|serveur|worker/i);
  const droite = await recevoirPhoto({ nom: 'b.jpg', mediaType: 'image/jpeg', charger: async () => jpegOrientation(1) }, USER, depot, '2026-11-18', IDU);
  na.ok(droite.photo);
  na.equal(droite.raison, null);
});

Deno.test('G9-S3 : accord sur la photo jointe — implicite aujourd’hui (comportement G3 gardé) ; mode « bouton » prêt', () => {
  na.equal(ACCORD_PHOTO_JOINTE, 'implicite', 'décision d’Albé en attente : le comportement actuel ne change pas');
  const base = lirePhotoProjet({ v: 1, chemin: `${USER}/33333333-3333-4333-8333-333333333333.jpg`, octets: 1000, media_type: 'image/jpeg', recue_le: '2026-11-18', nom: 'a.jpg', position: null, cap_deg: null, depuis_terrain: null, idu: IDU }) as PhotoProjet;
  na.ok(base);
  na.equal(photoProjetUtilisableCommeFond(base), true);
  na.equal(photoProjetUtilisableCommeFond(base, 'bouton'), false);
  const accordee = lirePhotoProjet({ ...base, accord_le: '2026-11-18T08:00:00Z' }) as PhotoProjet;
  na.equal(accordee.accord_le, '2026-11-18T08:00:00Z');
  na.equal(photoProjetUtilisableCommeFond(accordee, 'bouton'), true);
  na.equal(lirePhotoProjet({ ...base, accord_le: 'n’importe quoi' })?.accord_le, undefined, 'date illisible : écartée');
});

// ── Limite sur rue reprise du parcours (fiche de parcelle sans voisines) ─────────────────────────────────────
const CONTOUR: [number, number][] = [[2.4400, 48.8600], [2.4402, 48.8600], [2.4402, 48.8602], [2.4400, 48.8602], [2.4400, 48.8600]];
const FACADES_LUES = {
  idu: IDU, date: '2026-11-17',
  facades: [{ debut: [2.4400, 48.8600], fin: [2.4402, 48.8600], longueurM: 14.7, source: 'cadastre-voisines' }],
};
const CONCEPTION = { id: 'c-g9', idu: IDU, commune: null, parcelle: { geometrie: { type: 'Polygon', coordinates: [CONTOUR] } }, regles_plu: [], programme: null } as unknown as ConceptionLue;
const PREPARATION = { id: 'p-g9', conception_id: 'c-g9', entree: { parcelle: { geometrie: { type: 'Polygon', coordinates: [CONTOUR] } } } } as unknown as PreparationLue;
const envAvec = (sorties: Record<string, unknown>[] | null): EnvStudio => ({
  userId: USER, secret: 'secret-de-test', requete: 'r', conversationId: 'conv-g9', origine: 'https://mimmoza.vercel.app',
  depot: {
    conception: async () => CONCEPTION,
    ...(sorties ? { sortiesExtension: async () => sorties } : {}),
    couverturePhotoRue: async () => ({ ok: false, raison: 'non vérifiée' }),
  } as unknown as DepotStudio,
});

Deno.test('G9-S4 : fiche de parcelle sans voisines — limite sur rue du parcours reprise (même parcelle seulement)', async () => {
  const sans = await facadesVoiePreparation(envAvec(null), USER, PREPARATION);
  na.equal(sans.facades.length, 0, 'sans parcours : rien d’inventé');
  na.ok(sans.raison);
  const avec = await facadesVoiePreparation(envAvec([{ facades_voie_lues: FACADES_LUES }]), USER, PREPARATION);
  na.equal(avec.facades.length, 1);
  na.equal(avec.facades[0]!.source, 'cadastre-voisines');
  na.equal(avec.raison, null);
  const autreParcelle = await facadesVoiePreparation(envAvec([{ facades_voie_lues: { ...FACADES_LUES, idu: '930470000P0647' } }]), USER, PREPARATION);
  na.equal(autreParcelle.facades.length, 0, 'limite d’une autre parcelle : écartée');
});

Deno.test('G9-S5 : photo de l’utilisateur (rue ou jardin) acceptée dès que la limite sur rue est connue, par la fiche OU par le parcours', async () => {
  const refus = await gardePhotoExtension(envAvec(null), USER, PREPARATION, { fond: 'photo_client' });
  na.ok('refus' in refus, 'aucune limite sur rue nulle part : refus (la machine de rendu en a besoin pour replacer l’extension)');
  const ok = await gardePhotoExtension(envAvec([{ facades_voie_lues: FACADES_LUES }]), USER, PREPARATION, { fond: 'photo_client' });
  na.deepEqual(ok, { fond: 'photo_client' });
});
