// npx tsx --test src/lib/studio/dossierClient/dossierClient.test.ts
// VIS-60 — dossier client : choix des livrables, état « prêt », notice, PDF (sans fournisseur tiers), ZIP relisible.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { collecterLivrables, etatDossier, lignesProgramme, mentionneTiers, nomFichierSur, noticeDossier, programmeDepuisResume, texteClient, MENTION_DOSSIER, type TravailDossier } from './dossierClientLogique.ts';
import { construirePdfDossier, dimensionsImage, jpegPourJsPdf, textePdf } from './pdfDossier.ts';
import { jsPDF } from 'jspdf';
import { appelProposeDossier } from './evenement.ts';
import { crc32, creerZipStocke, lireZipStocke, nomEntreeValide } from './zipStocke.ts';

const U = '375beb65-6e6a-4922-ae70-77cd74e8ad7d';
// JPEG 1 × 1 (SOF2) — suffit à jsPDF, qui n'en décode que l'en-tête.
const JPEG = Uint8Array.from(Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64'));

// Forme RÉELLE des résultats (studio_jobs lus le 26/11/2026, travaux 44a1a885 et 85c32cde), réduite.
const image: TravailDossier = {
  id: '44a1a885', type: 'image', statut: 'termine', cree_le: '2026-11-24T13:00:00Z', termine_le: '2026-11-24T13:36:05Z',
  resultat: {
    qualite: 'finale',
    images: [
      { vue: 'trois_quarts_gauche', libelle: '3/4 gauche', jpeg_path: `${U}/44a1a885/image-trois_quarts_gauche.jpg`, png_path: `${U}/44a1a885/image-trois_quarts_gauche.png` },
      { vue: 'sejour', famille: 'interieur', libelle: 'Séjour', jpeg_path: `${U}/44a1a885/image-sejour.jpg` },
    ],
    avertissements: ['Rue : côté 0 : trottoir projet de 2.0 m < 2.5 m — pas d\'arbres d\'alignement.'],
    rapport_assets: { assets: [{ id: 'ciel', source: 'Poly Haven', licence: 'CC0 1.0', emplacement_path: 'assets/hdri/polyhaven.hdr' }] },
    livraison_commerciale: {
      vues: [{ vue: 'trois_quarts_gauche', formats: [
        { format: 'original', chemin: `${U}/44a1a885/livraison/trois_quarts_gauche/trois_quarts_gauche-original.jpg` },
        { format: 'web_16_9', chemin: `${U}/44a1a885/livraison/trois_quarts_gauche/trois_quarts_gauche-web-16-9.jpg` }] }],
      plan_vente: { lot: 'A101', pdf_path: `${U}/44a1a885/livraison/plan-de-vente/lot-A101.pdf`, png_path: `${U}/44a1a885/livraison/plan-de-vente/lot-A101.png` },
    },
  },
};
const apercuAncien: TravailDossier = {
  id: 'ancien', type: 'image', statut: 'termine', cree_le: '2026-11-20T10:00:00Z', termine_le: '2026-11-20T10:10:00Z',
  resultat: { qualite: 'apercu', images: [{ vue: 'sejour', libelle: 'Séjour (aperçu)', jpeg_path: `${U}/ancien/image-sejour.jpg` }, { vue: 'face', libelle: 'Face', jpeg_path: `${U}/ancien/image-face.jpg` }] },
};
const film: TravailDossier = {
  id: '85c32cde', type: 'film', statut: 'termine', cree_le: '2026-11-26T20:00:00Z', termine_le: '2026-11-26T21:23:30Z',
  resultat: { duree_s: 27, video_path: `${U}/85c32cde/film.mp4`, poster_path: `${U}/85c32cde/poster.jpg`, avertissements: ['7 meuble(s) sans modèle certifié omis'] },
};
const filmApercuRecent: TravailDossier = { id: 'fa', type: 'film', statut: 'termine', cree_le: '2026-11-26T22:00:00Z', termine_le: '2026-11-26T22:05:00Z', resultat: { qualite: 'apercu', duree_s: 20, video_path: `${U}/fa/film.mp4` } };
const plansExt: TravailDossier = {
  id: 'pl', type: 'image', statut: 'termine', cree_le: '2026-11-17T10:00:00Z', termine_le: '2026-11-17T11:00:00Z',
  resultat: { images: [], plans: { statut: 'envoye', pdf_path: `${U}/pl/plans-extension.pdf`, dxf_path: `${U}/pl/plans-extension-dxf.zip`, apercu_path: `${U}/pl/plans-extension-apercu.png` }, ifc_path: `${U}/pl/maquette.ifc` },
};
const echec: TravailDossier = { id: 'ko', type: 'film', statut: 'echec', cree_le: '2026-11-26T10:00:00Z', resultat: null };
const visite: TravailDossier = { id: 'vi', type: 'visite360', statut: 'termine', cree_le: '2026-11-25T10:00:00Z', termine_le: '2026-11-25T11:00:00Z', resultat: { visite_id: 'abc123', manifest_path: 'abc123/manifest.json', panoramas: 6 } };

describe('VIS-60 — choix des livrables', () => {
  const m = collecterLivrables([image, apercuAncien, film, filmApercuRecent, plansExt, echec, visite]);
  it('couverture = la perspective 3/4 HD (original de la livraison commerciale), aperçu web pour le PDF', () => {
    assert.equal(m.perspective?.chemin, `${U}/44a1a885/livraison/trois_quarts_gauche/trois_quarts_gauche-original.jpg`);
    assert.equal(m.perspective?.cheminApercu, `${U}/44a1a885/livraison/trois_quarts_gauche/trois_quarts_gauche-web-16-9.jpg`);
  });
  it('une image par vue ; la finale l’emporte sur un aperçu ; extérieures avant intérieures', () => {
    assert.deepEqual(m.images.map((i) => i.libelle), ['3/4 gauche', 'Face', 'Séjour']);
    assert.equal(m.images.find((i) => i.libelle === 'Séjour')?.chemin, `${U}/44a1a885/image-sejour.jpg`);
    assert.match(m.images[0]!.nomZip, /^02-Images-HD\/01-3-4-gauche\.jpg$/);
  });
  it('film : le plus récent en qualité FINALE, pas l’aperçu plus récent ; le film en échec est ignoré', () => {
    assert.equal(m.film?.fichier.chemin, `${U}/85c32cde/film.mp4`);
    assert.equal(m.film?.affiche?.nomZip, '01-Film/affiche-du-film.jpg');
    assert.equal(m.film?.dureeS, 27);
  });
  it('plans : PDF, DXF, IFC et aperçus réellement envoyés ; rien du rapport d’assets', () => {
    const g = m.plans.map((p) => `${p.genre}:${p.chemin.split('/').pop()}`).sort();
    assert.deepEqual(g, ['plan_apercu:lot-A101.png', 'plan_apercu:plans-extension-apercu.png', 'plan_dxf:plans-extension-dxf.zip', 'plan_ifc:maquette.ifc', 'plan_pdf:lot-A101.pdf', 'plan_pdf:plans-extension.pdf']);
    assert.ok(m.plans.every((p) => !mentionneTiers(p.chemin)));
  });
  it('visite 360° : identifiant retenu (lien public permanent)', () => assert.equal(m.visite?.visiteId, 'abc123'));
});

describe('VIS-60 — état du dossier', () => {
  it('pas prêt tant qu’un rendu est en attente ; prêt ensuite', () => {
    const attente: TravailDossier = { id: 'w', type: 'film', statut: 'en_attente', cree_le: '2026-11-27T00:00:00Z' };
    const e1 = etatDossier([image, film, attente]);
    assert.equal(e1.preparable, true);
    assert.equal(e1.pret, false);
    assert.match(e1.phrase, /1 rendu encore en cours/);
    const e2 = etatDossier([image, film]);
    assert.equal(e2.pret, true);
    assert.match(e2.phrase, /^Dossier prêt : 2 images HD, film \(27 s\), plans \(non inclus : visite 360°\)\.$/);
  });
  it('rien de terminé : pas préparable', () => {
    const e = etatDossier([echec]);
    assert.equal(e.preparable, false);
    assert.equal(e.pret, false);
  });
});

describe('VIS-60 — textes client', () => {
  it('aucune mention de BlenderKit ni de Poly Haven', () => {
    for (const s of ['Poly Haven potted_plant_01', 'polyhaven.com', 'BlenderKit', 'Blender Kit', 'CC0 1.0']) assert.equal(texteClient(s), null, s);
    assert.equal(texteClient('Séjour'), 'Séjour');
  });
  it('programme : SDP lue, SHAB absente dite « à confirmer » (jamais estimée)', () => {
    const p = programmeDepuisResume({ sdp_estimee_m2: 960, logements_places: 12, gabarit: 'R+1', batiments: 3, emprise_batie_m2: 480, surface_parcelle_m2: 2435 });
    const l = Object.fromEntries(lignesProgramme(p));
    assert.equal(l['Surface de plancher (SDP)'], '960 m²');
    assert.equal(l['Surface habitable (SHAB)'], 'à confirmer');
    assert.equal(l['Surface du terrain'], '2 435 m²');
  });
  it('notice : contenu, liens, mention neutre, aucun tiers', () => {
    const m = collecterLivrables([image, film, plansExt, visite]);
    const n = noticeDossier({ titre: 'Résidence Ascain', date: '27 novembre 2026', m, lienFilm: 'https://x/film', lienVisite: 'https://mimmoza.fr/visite/abc123', nomPdf: 'Dossier.pdf' });
    assert.match(n, /01-Film\/film-du-projet\.mp4/);
    assert.match(n, /Visite 360° : https:\/\/mimmoza\.fr\/visite\/abc123/);
    assert.match(n, new RegExp(MENTION_DOSSIER));
    assert.equal(mentionneTiers(n), false);
  });
  it('noms de fichiers sûrs', () => {
    assert.equal(nomFichierSur('Résidence « Les Pins » / Ascain'), 'Residence-Les-Pins-Ascain');
    assert.equal(nomEntreeValide('../x'), false);
    assert.equal(nomEntreeValide('02-Images-HD/01-a.jpg'), true);
  });
});

describe('VIS-60 — PDF', () => {
  it('dimensions JPEG et PNG', () => {
    assert.deepEqual(dimensionsImage(JPEG), { largeur: 1, hauteur: 1, format: 'JPEG' });
    const png = new Uint8Array(24); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); new DataView(png.buffer).setUint32(16, 640); new DataView(png.buffer).setUint32(20, 480);
    assert.deepEqual(dimensionsImage(png), { largeur: 640, hauteur: 480, format: 'PNG' });
  });
  it('JPEG à la manière de ffmpeg (DHT avant SOF, commentaire) : réordonné, jsPDF lit les vraies dimensions', () => {
    // En-tête ffmpeg : SOI, APP0, COM « Lavc », DQT, DHT, SOF0 (1920 × 1080, 3 composantes), SOS.
    const seg = (m: number, corps: number[]) => [0xff, m, ((corps.length + 2) >> 8) & 0xff, (corps.length + 2) & 0xff, ...corps];
    const ff = Uint8Array.from([0xff, 0xd8, ...seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 0, 0, 1, 0, 1, 0, 0]), ...seg(0xfe, [...Buffer.from('Lavc58')]),
      ...seg(0xdb, [0, ...new Array(64).fill(8)]), ...seg(0xc4, [0, ...new Array(16).fill(0)]),
      ...seg(0xc0, [8, 0x04, 0x38, 0x07, 0x80, 3, 1, 0x22, 0, 2, 0x11, 0, 3, 0x11, 0]), ...seg(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]), 0x00, 0xff, 0xd9]);
    const lu = (b: Uint8Array) => { const d = new jsPDF(); d.addImage(b, 'JPEG', 0, 0, 10, 10); return /\/Width (\d+)\s*\/Height (\d+)/.exec(Buffer.from(d.output('arraybuffer')).toString('latin1'))?.slice(1).join('x'); };
    assert.notEqual(lu(ff), '1920x1080'); // défaut de jsPDF 4.2.1 : le DHT est lu comme un SOF (257 × 257 sur un vrai fichier ffmpeg)
    assert.equal(lu(jpegPourJsPdf(ff)), '1920x1080');
    assert.deepEqual(dimensionsImage(ff), { largeur: 1920, hauteur: 1080, format: 'JPEG' });
  });
  it('textes compatibles polices standard', () => assert.equal(textePdf('l’œuvre — 960 m² ≈'), 'l\'oeuvre - 960 m² ~'));
  it('PDF complet : couverture, programme, planches, QR et liens, mention, AUCUN fournisseur tiers', () => {
    const m = collecterLivrables([image, film, plansExt, visite]);
    const octets = new Map<string, Uint8Array>(m.images.map((i) => [i.cheminApercu ?? i.chemin, JPEG]));
    const pdf = construirePdfDossier({
      titre: 'Résidence Ascain', adresse: '12 chemin de Larrun, 64310 Ascain', date: '27 novembre 2026',
      programme: programmeDepuisResume({ sdp_estimee_m2: 960, logements_places: 12 }), manifeste: m, octets,
      lienFilm: 'https://exemple.supabase.co/storage/v1/object/sign/studio-rendus/film.mp4?token=t', lienVisite: 'https://mimmoza.fr/visite/abc123', compresser: false,
    });
    const s = Buffer.from(pdf).toString('latin1');
    assert.ok(s.startsWith('%PDF-'));
    for (const attendu of ['Dossier de pr', 'Images non contractuelles', 'Surface de plancher', 'Surface habitable', '/URI (https://mimmoza.fr/visite/abc123)', 'Planche 1', 'Plans fournis', '/DCTDecode']) {
      assert.ok(s.includes(attendu), attendu);
    }
    assert.equal(/blender\s*kit|poly\s*haven|cc0/i.test(s), false);
    const pages = (s.match(/\/Type \/Page\b/g) ?? []).length;
    // couverture, programme, 2 planches, « Plans fournis » (aperçus sans octets : pas de page), film + visite
    assert.equal(pages, 6);
  });
});

describe('VIS-60 — ZIP stocké', () => {
  it('CRC32 de référence', () => assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926));
  it('aller-retour : noms UTF-8, données, CRC', () => {
    const e = [{ nom: 'LISEZMOI.txt', donnees: new TextEncoder().encode('Héllo') }, { nom: '01-Film/film-du-projet.mp4', donnees: new Uint8Array([1, 2, 3]) }];
    const z = creerZipStocke(e);
    const l = lireZipStocke(z);
    assert.deepEqual(l.map((x) => x.nom), ['LISEZMOI.txt', '01-Film/film-du-projet.mp4']);
    assert.equal(new TextDecoder().decode(l[0]!.donnees), 'Héllo');
    assert.equal(l[1]!.crc, crc32(new Uint8Array([1, 2, 3])));
  });
  it('refuse un doublon et un chemin remontant', () => {
    assert.throws(() => creerZipStocke([{ nom: 'a', donnees: new Uint8Array() }, { nom: 'a', donnees: new Uint8Array() }]), /double/);
    assert.throws(() => creerZipStocke([{ nom: '../a', donnees: new Uint8Array() }]), /refusé/);
  });
});

describe('VIS-60 — proposition dans le chat', () => {
  it('seul un appel terminé de studio_dossier_client avec pret = vrai met le bouton en évidence', () => {
    assert.equal(appelProposeDossier({ name: 'studio_dossier_client', status: 'done', output: { status: 'ok', data: { pret: true } } }), true);
    assert.equal(appelProposeDossier({ name: 'studio_dossier_client', status: 'running', output: { status: 'ok', data: { pret: true } } }), false);
    assert.equal(appelProposeDossier({ name: 'studio_dossier_client', status: 'done', output: { status: 'ok', data: { pret: false } } }), false);
    assert.equal(appelProposeDossier({ name: 'studio_commander', status: 'done', output: { status: 'ok', data: { pret: true } } }), false);
  });
});
