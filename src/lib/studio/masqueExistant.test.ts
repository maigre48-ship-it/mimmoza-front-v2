// node --test src/lib/studio/masqueExistant.test.ts
// LOT P5-SITE (12/11/2026) — effacement de l'existant, côté site : message `mimmoza-masque-existant-v1` de l'atelier
// (PNG fabriqué octet par octet avec zlib), option `masque_existant` (mêmes règles que la migration 20261112120000),
// relance avec calage + masque, lecture de `resultat.photomontage.existant`, carte du chat (mention, zones, a_valider).
// Identifiants et chemins SYNTHÉTIQUES.
import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateSync } from 'node:zlib';
import {
  avertissementsSansMention, cheminMasqueExistant, libelleEffacement, lireExistant, lireMasqueExistantOption, lireMessageMasqueExistant,
  masqueAccordeAuCalage, MENTION_EFFACEMENT, OCTETS_MAX_MASQUE, RE_CHEMIN_MASQUE, TYPE_MESSAGE_MASQUE_EXISTANT,
} from './masqueExistant.ts';
import { examinerMessageCalage, messageAtelier, optionsAvecCalage, TYPE_MESSAGE_CALAGE } from './atelierPhotomontage.ts';
import { libelleResultatImage, lirePhotomontage, lireTravail, messageErreurTravail, resumeOptions, validerOptions, type OptionsImage } from './travauxLogique.ts';
import { vueCarteSuivi, type IndiceSuivi } from '../../spaces/copilot/studio3d/suiviRenduChat.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const AUTRE = '22222222-2222-4222-8222-222222222222';
const JOB = 'aaaaaaaa-1111-4111-8111-111111111111';
const MASQUE = { chemin: `${USER}/44444444-4444-4444-8444-444444444444.png`, octets: 2048 };
const CALAGE = {
  version: 1 as const, largeur_image: 64, hauteur_image: 48, valide_le: '2026-11-12T12:00:00Z',
  correspondances: [{ image: [10, 40] as [number, number], monde: [2.4286, 48.8566, 0] as [number, number, number] }, { image: [60, 42] as [number, number], monde: [2.4289, 48.8566, 0] as [number, number, number] }],
};
const STUDIO = 'https://mimmoza.fr';

/** PNG en niveaux de gris 8 bits, valide (IHDR, IDAT zlib, IEND, CRC). */
function png(l: number, h: number): Uint8Array {
  const bloc = (type: string, data: Uint8Array) => {
    const t = Buffer.from(type, 'latin1');
    const lg = Buffer.alloc(4); lg.writeUInt32BE(data.length);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([lg, t, data, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(l, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const brut = Buffer.alloc((l + 1) * h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < l; x += 1) brut[y * (l + 1) + 1 + x] = x > l / 2 ? 255 : 0;
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bloc('IHDR', ihdr), bloc('IDAT', deflateSync(brut)), bloc('IEND', new Uint8Array(0))]));
}
const b64 = (o: Uint8Array) => Buffer.from(o).toString('base64');
const message = (p: Record<string, unknown> = {}) => ({ type: TYPE_MESSAGE_MASQUE_EXISTANT, version: 1, travail: JOB, largeur: 64, hauteur: 48, png_base64: b64(png(64, 48)), ...p });

// ── Message de l'atelier ─────────────────────────────────────────────────────────────────────────────
test('message de masque : relu, octets du PNG rendus tels quels', () => {
  const r = lireMessageMasqueExistant(message(), JOB);
  assert.ok(r.ok);
  assert.deepEqual([r.valeur.travail, r.valeur.largeur, r.valeur.hauteur], [JOB, 64, 48]);
  assert.deepEqual(Buffer.from(r.valeur.octets), Buffer.from(png(64, 48)));
  assert.ok(lireMessageMasqueExistant(message({ travail: JOB.toUpperCase() }), JOB).ok, 'casse de l’identifiant indifférente');
});

test('message de masque : refusé s’il est mal formé, d’un autre travail, pas un PNG ou de taille différente', () => {
  const ko = (m: unknown, motif: RegExp) => { const r = lireMessageMasqueExistant(m, JOB); assert.ok(!r.ok); assert.match(r.erreur, motif); };
  ko(null, /inconnu/);
  ko({ ...message(), type: 'autre' }, /inconnu/);
  ko({ ...message(), url: 'https://x' }, /champs inattendus/);
  ko(message({ version: 2 }), /version/);
  ko(message({ travail: 'x' }), /invalide/);
  ko(message({ travail: AUTRE }), /autre image/);
  ko(message({ largeur: 15 }), /dimensions invalides/);
  ko(message({ largeur: 64.5 }), /dimensions invalides/);
  ko(message({ png_base64: 'abc' }), /absente/);
  ko(message({ png_base64: 'data:image/png;base64,' + b64(png(64, 48)) }), /absente/);
  ko(message({ png_base64: b64(new TextEncoder().encode('GIF89a — ce n’est pas un PNG, mais assez long')) }), /pas une image PNG/);
  ko(message({ largeur: 65 }), /différentes de celles annoncées/);
  ko(message({ png_base64: 'A'.repeat(Math.ceil((OCTETS_MAX_MASQUE * 4) / 3) + 8) }), /trop volumineuse/);
});

test('masque et calage : la taille doit être exactement celle de la photo calée', () => {
  assert.ok(masqueAccordeAuCalage({ largeur: 64, hauteur: 48 }, CALAGE).ok);
  const r = masqueAccordeAuCalage({ largeur: 32, hauteur: 24 }, CALAGE);
  assert.ok(!r.ok);
  assert.match(r.erreur, /32 × 24 px.*64 × 48 px/);
});

test('examinerMessageCalage : masque gardé (pas de fin d’échange), refus explicite, origine et fenêtre contrôlées', () => {
  const d = examinerMessageCalage({ origin: STUDIO, data: message() }, STUDIO, true, JOB);
  assert.equal(d.type, 'masque');
  assert.equal(examinerMessageCalage({ origin: 'https://ailleurs.fr', data: message() }, STUDIO, true, JOB).type, 'ignore');
  assert.equal(examinerMessageCalage({ origin: STUDIO, data: message() }, STUDIO, false, JOB).type, 'ignore');
  assert.equal(examinerMessageCalage({ origin: STUDIO, data: message({ travail: AUTRE }) }, STUDIO, true, JOB).type, 'ignore');
  const ko = examinerMessageCalage({ origin: STUDIO, data: message({ largeur: 65 }) }, STUDIO, true, JOB);
  assert.equal(ko.type, 'refus');
  // Le calage, lui, reste traité comme avant.
  assert.equal(examinerMessageCalage({ origin: STUDIO, data: { type: TYPE_MESSAGE_CALAGE, travail: JOB, calage_client: CALAGE } }, STUDIO, true, JOB).type, 'calage');
});

test('messageAtelier : masque_url seulement s’il existe (sinon message du lot P2 inchangé)', () => {
  const sans = messageAtelier(JOB, AUTRE, 'https://p', 'https://q', 0);
  assert.equal('masque_url' in sans, false);
  assert.deepEqual(Object.keys(sans), ['type', 'version', 'travail', 'session', 'photo_url', 'plan_url', 'expire_le']);
  const avec = messageAtelier(JOB, AUTRE, 'https://p', 'https://q', 0, 'https://m');
  assert.equal(avec.masque_url, 'https://m');
});

// ── Option `masque_existant` ─────────────────────────────────────────────────────────────────────────
test('chemin du masque : <uid>/<uuid>.png, même motif que la base', () => {
  const c = cheminMasqueExistant(USER.toUpperCase(), '44444444-4444-4444-8444-444444444444');
  assert.equal(c, MASQUE.chemin);
  assert.ok(RE_CHEMIN_MASQUE.test(c!));
  assert.equal(cheminMasqueExistant('x', '44444444-4444-4444-8444-444444444444'), null);
});

test('option masque_existant : clés, dossier du compte, taille', () => {
  assert.deepEqual(lireMasqueExistantOption(MASQUE, USER), { ok: true, valeur: MASQUE });
  assert.ok(!lireMasqueExistantOption(MASQUE, AUTRE).ok);
  assert.ok(!lireMasqueExistantOption({ ...MASQUE, bucket: 'studio-rendus' }).ok);
  assert.ok(!lireMasqueExistantOption({ ...MASQUE, chemin: MASQUE.chemin.replace('.png', '.jpg') }).ok);
  assert.ok(!lireMasqueExistantOption({ ...MASQUE, octets: OCTETS_MAX_MASQUE + 1 }).ok);
  assert.ok(lireMasqueExistantOption({ ...MASQUE, octets: OCTETS_MAX_MASQUE }).ok);
  assert.ok(!lireMasqueExistantOption({ ...MASQUE, octets: 0 }).ok);
});

test('validerOptions : masque_existant accepté seulement avec un calage validé', () => {
  const ok = validerOptions('image', { fond: 'photo_rue', calage_client: CALAGE, masque_existant: MASQUE });
  assert.ok(ok.ok);
  assert.deepEqual((ok.valeur as OptionsImage).masque_existant, MASQUE);
  const sans = validerOptions('image', { fond: 'photo_rue', masque_existant: MASQUE });
  assert.ok(!sans.ok);
  assert.match(sans.erreur, /placement validé/);
  assert.ok(!validerOptions('film', { masque_existant: MASQUE }).ok);
  // Options d'avant : inchangées (aucune clé ajoutée).
  assert.deepEqual(validerOptions('image', { fond: 'photo_rue', calage_client: CALAGE }), { ok: true, valeur: { vues: ['trois_quarts_gauche'], ambiance: 'jour', qualite: 'finale', fond: 'photo_rue', calage_client: CALAGE } });
  assert.match(resumeOptions('image', (ok as { valeur: OptionsImage }).valeur), /zone à effacer corrigée/);
});

test('optionsAvecCalage : le masque de CET atelier est joint ; celui d’une image précédente est retiré', () => {
  const origine = { fond: 'photo_client', photo_client: { chemin: `${USER}/33333333-3333-4333-8333-333333333333.jpg`, octets: 1000 }, calage_client: CALAGE, masque_existant: { ...MASQUE, octets: 999 } };
  const sansNouveau = optionsAvecCalage(origine, CALAGE, null);
  assert.ok(sansNouveau.ok);
  assert.equal(sansNouveau.valeur.masque_existant, undefined);
  const avec = optionsAvecCalage(origine, CALAGE, null, MASQUE);
  assert.ok(avec.ok);
  assert.deepEqual(avec.valeur.masque_existant, MASQUE);
});

test('messageErreurTravail : contrainte de propriétaire du masque dite clairement', () => {
  assert.match(messageErreurTravail({ message: 'new row violates check constraint "studio_jobs_masque_existant_proprietaire"' }, 'image'), /zone à effacer n’appartient pas/);
});

// ── Résultat : bâtiment existant effacé ──────────────────────────────────────────────────────────────
const EXISTANT = { efface: true, batiments: ['BATIMENT0000000301234567'], surface_reconstituee_pct: 12.3, methode: 'lama', masque_source: 'utilisateur', zones_path: `${USER}/${JOB}/zones-reconstituees.png` };

test('lireExistant : rien n’est complété ni deviné', () => {
  assert.deepEqual(lireExistant(EXISTANT), { ...EXISTANT, batiments: ['BATIMENT0000000301234567'] });
  assert.equal(lireExistant({ ...EXISTANT, efface: false }), null);
  assert.equal(lireExistant(null), null);
  const partiel = lireExistant({ efface: true, methode: 'photoshop', surface_reconstituee_pct: 140 });
  assert.deepEqual(partiel, { efface: true, batiments: [], surface_reconstituee_pct: null, methode: null, masque_source: null, zones_path: null });
});

test('libelleEffacement : mention complète, sans nom d’outil ; seulement ce que le résultat contient', () => {
  const l = libelleEffacement(lireExistant(EXISTANT));
  assert.ok(l);
  assert.equal(l.mention, 'Bâtiment existant effacé — zone reconstituée (non photographique), 12,3 % de l’image, méthode : reconstitution par réseau de neurones (contenu inventé, plausible).');
  assert.doesNotMatch(l.mention, /LaMa|OpenCV|big-lama/i);
  assert.match(l.masque!, /corrigée par vous/);
  assert.equal(l.zonesPath, EXISTANT.zones_path);
  const nu = libelleEffacement(lireExistant({ efface: true }));
  assert.deepEqual(nu, { mention: `${MENTION_EFFACEMENT}.`, masque: null, zonesPath: null });
  assert.equal(libelleEffacement(null), null);
});

test('lirePhotomontage : existant lu sur une image livrée seulement ; masque_path de l’atelier conservé', () => {
  const livre = lirePhotomontage({ statut: 'livre', verdict: 'cale', existant: EXISTANT });
  assert.equal(livre?.existant?.surface_reconstituee_pct, 12.3);
  assert.equal(lirePhotomontage({ statut: 'livre', verdict: 'cale' })?.existant, null);
  assert.equal(lirePhotomontage({ statut: 'a_valider', raison: 'x', existant: EXISTANT, atelier: { photo_path: 'a', plan_path: 'b' } })?.existant, null);
  const av = lirePhotomontage({ statut: 'a_valider', raison: 'x', atelier: { photo_path: 'a/photo.jpg', plan_path: 'a/plan.json', masque_path: 'a/masque-existant.png' } });
  assert.deepEqual(av?.atelier, { photo_path: 'a/photo.jpg', plan_path: 'a/plan.json', masque_path: 'a/masque-existant.png' });
  assert.deepEqual(lirePhotomontage({ statut: 'a_valider', raison: 'x', atelier: { photo_path: 'a/photo.jpg', plan_path: 'a/plan.json' } })?.atelier, { photo_path: 'a/photo.jpg', plan_path: 'a/plan.json' });
});

test('libelleResultatImage : effacement sur l’image livrée, « corriger la zone » sur l’image à valider', () => {
  const livre = libelleResultatImage({ photomontage: lirePhotomontage({ statut: 'livre', verdict: 'cale', existant: EXISTANT }) });
  assert.ok(livre.inseree && livre.effacement && !livre.corrigerZone);
  const av = libelleResultatImage({ photomontage: lirePhotomontage({ statut: 'a_valider', raison: 'Effacement du bâtiment existant à valider : zone trop grande.', atelier: { photo_path: 'a', plan_path: 'b', masque_path: 'c' } }) });
  assert.deepEqual([av.aValider, av.corrigerZone, av.raison, av.effacement], [true, true, 'Effacement du bâtiment existant à valider : zone trop grande.', null]);
  const avSansMasque = libelleResultatImage({ photomontage: lirePhotomontage({ statut: 'a_valider', raison: 'Calage insuffisant.', atelier: { photo_path: 'a', plan_path: 'b' } }) });
  assert.deepEqual([avSansMasque.aValider, avSansMasque.corrigerZone], [true, false]);
  assert.deepEqual([libelleResultatImage(null).effacement, libelleResultatImage(null).corrigerZone], [null, false]);
});

test('avertissementsSansMention : la mention seule n’est pas répétée quand elle a son bloc', () => {
  const av = [MENTION_EFFACEMENT, 'Zone reconstituée : 12,3 % de l’image…', 'Autre.'];
  assert.deepEqual(avertissementsSansMention(av, libelleEffacement(lireExistant(EXISTANT))), av.slice(1));
  assert.deepEqual(avertissementsSansMention(av, null), av);
});

test('carte du chat : image livrée avec effacement (mention, lien des zones) et image à valider (raison, atelier)', () => {
  const indice: IndiceSuivi = { jobId: JOB, origine: 'lance', type: 'image', statut: 'en_attente', machine: null, positionFile: null };
  const ligne = (resultat: unknown) => lireTravail({ id: JOB, conversation_id: 'c', type: 'image', statut: 'termine', progression: 100, etape: null, resultat, elements_omis: [], erreur: null, cree_le: '2026-11-12T10:00:00Z', maj_le: '2026-11-12T10:05:00Z', demarre_le: null, termine_le: null, options: {} });
  const livre = ligne({ image_path: 'i.jpg', avertissements: [MENTION_EFFACEMENT, 'Zone reconstituée : 12,3 % de l’image.'], photomontage: { statut: 'livre', verdict: 'cale', existant: EXISTANT } });
  const v = vueCarteSuivi(livre, indice, Date.parse('2026-11-12T10:06:00Z'));
  assert.equal(v.image?.effacement?.zonesPath, EXISTANT.zones_path);
  assert.deepEqual(v.avertissements, ['Zone reconstituée : 12,3 % de l’image.']);
  const av = ligne({ image_path: 'i.jpg', photomontage: { statut: 'a_valider', raison: 'Effacement du bâtiment existant à valider : 40,4 % de l’image à inventer.', atelier: { photo_path: 'a', plan_path: 'b', masque_path: 'c' } } });
  const va = vueCarteSuivi(av, indice, Date.parse('2026-11-12T10:06:00Z'));
  assert.deepEqual([va.image?.inseree, va.image?.aValider, va.image?.corrigerZone, va.image?.raison], [false, true, true, 'Effacement du bâtiment existant à valider : 40,4 % de l’image à inventer.']);
});
