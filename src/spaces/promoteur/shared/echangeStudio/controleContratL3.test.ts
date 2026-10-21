// CONTRÔLE L3 — projets pièges sur le contrat mimmoza-projet-v2 (front + copie Studio).
// Intégré au dépôt en R2 (source : _mimmoza-agents/controle-l3/tests/controleContratL3.test.ts) ;
// les sondes qui constataient les anomalies A2, A3, A6, A9, A11 et A12 sont devenues des assertions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as F from './mimmozaProjetV2.ts';
import { projetTest } from './fixturesProjetV2.ts';
import { examinerMessageStudio, originesStudio } from './transportStudio.ts';
import { recevoirRetour, nouvelEchange, enregistrerEnvoi, lireEchangeStocke, ecrireEchangeStocke, accepterRetour } from './persistanceEchange.ts';

const cheminStudio = new URL('../../../../../../mimmozia-studio/src/core/echange/mimmozaProjetV2.ts', import.meta.url);
const S: typeof F = existsSync(fileURLToPath(cheminStudio)) ? await import(cheminStudio.href) : F;

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const out: string[] = [];
const log = (s: string) => { out.push(s); console.log('CTRL ' + s); };

function piege(): any {
  const p: any = clone(projetTest());
  p.batiments[0].centre = { lon: -1.620300123456789, lat: 43.344200987654321 };
  p.batiments[0].rotationDeg = 359.9;
  p.batiments[1].rotationDeg = -0.1;
  p.batiments[0].nom = 'Bâtiment Été 🏢 «Œ»';
  p.site.adresse = 'Chemin de l’Église — Ñandú 🏡';
  p.site.parcelles[1].geometrie = { type: 'MultiPolygon', coordinates: [
    [[[-1.6197, 43.344], [-1.6193, 43.344], [-1.6193, 43.3444], [-1.6197, 43.3444], [-1.6197, 43.344]],
     [[-1.6196, 43.3441], [-1.6195, 43.3441], [-1.6195, 43.3442], [-1.6196, 43.3441]]],
    [[[-1.619, 43.344], [-1.6188, 43.344], [-1.6188, 43.3442], [-1.619, 43.344]]]] };
  p.regles[0].source.extrait = 'Implantation à 5 m — « alignement » ✓ 🚧';
  return p;
}

test('copies du contrat identiques (exports)', () => {
  assert.deepEqual(Object.keys(F).sort(), Object.keys(S).sort());
});

test('aller-retour sans perte : précision, 359,9° / -0,1°, multipolygone à trou, ailes, accents, emoji, règles sourcées', () => {
  const p = piege();
  const lu = F.validerProjet(p); assert.ok(lu.ok, (lu as any).erreur);
  const code = F.encoderProjet(lu.projet);
  const d1 = F.decoderProjet(code); assert.ok(d1.ok);
  assert.deepEqual(d1.projet, lu.projet);
  const d2 = S.decoderProjet(code); assert.ok(d2.ok);
  assert.deepEqual(d2.projet, lu.projet);
  assert.equal(d1.projet.batiments[0].centre.lon, -1.620300123456789);
  assert.equal(d1.projet.batiments[0].nom, 'Bâtiment Été 🏢 «Œ»');
  assert.deepEqual(d1.projet.regles[0].source, p.regles[0].source);
  assert.deepEqual(d1.projet.batiments[1].ailes, p.batiments[1].ailes);
  // 359,9 et -0,1 : même orientation, pas de faux changement
  const q = clone(lu.projet) as any; q.batiments[0].rotationDeg = -0.1; q.batiments[1].rotationDeg = 359.9;
  assert.equal(F.comparerProjets(lu.projet, q).length, 0);
  assert.equal(F.empreinteProjet(lu.projet), F.empreinteProjet(q));
  log('aller-retour piège : OK (deepEqual, front et Studio)');
});

test('champs inconnus d’une version future', () => {
  const p = piege(); p.futur = { x: 1 }; p.batiments[0].materiau = 'bois';
  const lu = F.validerProjet(p); assert.ok(lu.ok);
  log(`v2 + champs inconnus : accepté, champs perdus en silence = ${!('futur' in lu.projet) && !('materiau' in (lu.projet.batiments[0] as any))}`);
  const v3 = piege(); v3.version = 3;
  const l3 = F.validerProjet(v3); assert.equal(l3.ok, false);
  log(`version 3 : refusée (${(l3 as any).erreur})`);
});

test('changements NON détectés par comparerProjets / memeContenu (perte possible)', () => {
  const base = F.validerProjet(piege()); assert.ok(base.ok);
  const cas: [string, (p: any) => void][] = [
    ['programme.brief', (p) => { p.programme.brief = 'autre brief'; }],
    ['programme.commandeArchitecture', (p) => { p.programme.commandeArchitecture = 'R+3 bois'; }],
    ['programme.surfacePlancherM2', (p) => { p.programme.surfacePlancherM2 = { valeur: 9999, nature: 'estime' }; }],
    ['acces.type', (p) => { p.acces[0].type = 'vehicule'; }],
    ['acces.largeurM', (p) => { p.acces[0].largeurM = 9; }],
    ['regle.unite', (p) => { p.regles[0].unite = '%'; }],
    ['regle.categorie', (p) => { p.regles[0].categorie = 'fond'; }],
    ['photo.url', (p) => { p.photos[0].url = 'https://evil.example/x.jpg'; }],
    ['photo.nom', (p) => { p.photos[0].nom = 'renommée'; }],
    ['niveauEntree.coteM', (p) => { p.batiments[0].niveauEntree.coteM = 99; }],
    ['batiment.nom', (p) => { p.batiments[0].nom = 'Z'; }],
    ['batiment.nature', (p) => { p.batiments[0].nature = 'vise'; }],
  ];
  for (const [nom, f] of cas) {
    const q = clone(base.projet) as any; f(q);
    const v = F.validerProjet(q); assert.ok(v.ok, nom);
    const memeC = F.memeContenu(base.projet, v.projet);
    const memeE = F.empreinteProjet(base.projet) === F.empreinteProjet(v.projet);
    const etat = F.etatSynchronisation(base.projet, base.projet, v.projet);
    log(`${nom}: memeContenu=${memeC} memeEmpreinte=${memeE} etat=${etat}`);
    // R2 (A2) : chaque changement est détecté, et l'empreinte est alignée.
    assert.equal(memeC, false, nom);
    assert.equal(memeE, false, nom);
    assert.notEqual(etat, 'distant-inchange', nom);
    assert.ok(F.comparerProjets(base.projet, v.projet).length > 0, nom);
  }
});

test('migration v1 → v2 : champs absents en inconnu, jamais inventés', () => {
  const ctx = { projetId: 'mz-e1', etudeId: 'e1', horodatage: '2026-10-14T09:00:00.000Z' };
  const v1 = { version: 1, source: 'mimmoza-front-v2', parcels: [{ id: 'P1', feature: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[1, 45], [1.001, 45], [1.001, 45.001], [1, 45]]] } } }],
    implantation: { lon: 1.0005, lat: 45.0005, orientationDeg: 20, entryOffsetM: 0.3 },
    terrainData: { renderBounds: [0, 0, 1, 1], parcelBounds: [0, 0, 1, 1], grid: { n: 2, z: [[1, 2], [3, 4]] }, altitudeMin: 1, altitudeMax: 4 } };
  const m = F.migrerV1versV2(v1, ctx); assert.ok(m.ok, (m as any).erreur);
  const p = m.projet;
  log(`v1 minimal : batiments=${p.batiments.length} regles=${p.regles.length} logementsVises=${p.programme.logementsVises} surface=${JSON.stringify(p.programme.surfacePlancherM2)} controle=${p.controle} repere=${p.repere} adresse=${p.site.adresse} relief.nature=${p.site.relief?.nature} fournisseur=${p.site.relief?.fournisseur} penteMoyenne=${p.site.relief?.penteMoyenne} implantation=${JSON.stringify(p.extensionsV1.implantation)}`);
  assert.deepEqual(F.versChargeV1(p).implantation, v1.implantation);
  // photo v1 en data: → toute la migration échoue ?
  const v1b = { ...v1, panoramas: [{ url: 'data:image/jpeg;base64,AAAA', nom: 'p' }] };
  const mb = F.migrerV1versV2(v1b, ctx);
  log(`v1 avec panorama data: → ok=${mb.ok} ${(mb as any).erreur ?? ''}`);
  assert.ok(mb.ok, 'R2 (A12) : la photo data: est ignorée, la migration réussit');
  assert.equal((mb as any).projet.photos.length, 0);
  assert.equal((mb as any).avertissements.length, 1);
  const v1c = { ...v1, panoramas: [{ url: 'https://x.supabase.co/a.jpg' }] };
  const mc = F.migrerV1versV2(v1c, ctx);
  log(`v1 panorama sans nom → nom=${mc.ok ? mc.projet.photos[0].nom : (mc as any).erreur}`);
});

test('distinction mesuré / modélisé / estimé / visé', () => {
  const p = piege(); p.site.relief.nature = 'estime';
  log(`relief nature estime → ok=${F.validerProjet(p).ok}`);
  const q = piege(); q.programme.logementsVises = 12; q.programme.logementsModelises = null;
  const l = F.validerProjet(q); assert.ok(l.ok);
  const r = piege(); r.batiments[0].hauteurM = 99;
  log(`hauteurM sans nature (modélisée Studio / estimée front) : champ nature absent = ${!('natureHauteur' in r.batiments[0])}`);
  const v = piege(); v.regles[0].validation = { statut: 'validee', par: null, le: null };
  log(`règle validee sans par ni le → ok=${F.validerProjet(v).ok}`);
  const lv = F.validerProjet(v) as any;
  assert.equal(lv.projet.regles[0].validation.statut, 'non-validee', 'R2 (A9) : validée sans auteur ni date → non validée');
  const w = piege(); w.regles.push(clone(w.regles[0]));
  log(`règles à id en double → ok=${F.validerProjet(w).ok}`);
  assert.equal(F.validerProjet(w).ok, false, 'R2 (A3) : identifiants de règle en double refusés');
});

test('origines : liste blanche', () => {
  const prod = 'https://mimmoza.vercel.app';
  const liste = F.parserOrigines('http://localhost:5173, https://studio.mimmoza.fr/, *, https://a.fr/chemin, HTTPS://B.FR');
  log(`parserOrigines → ${JSON.stringify(liste)}`);
  const cas = ['http://localhost:5173.evil.com', 'null', 'file://', 'file:///C:/x.html', 'http://localhost:5174', 'https://studio.mimmoza.fr.evil.com', 'https://studio.mimmoza.fr:444', 'http://studio.mimmoza.fr', 'https://studio.mimmoza.fr', prod, 'https://evil.localhost'];
  for (const o of cas) log(`page prod, liste ${JSON.stringify(liste)} : ${o} → ${F.origineAutorisee(o, liste, prod)}`);
  for (const o of ['http://localhost:9999', 'http://evil.localhost:1234', 'http://127.0.0.9:80', 'http://[::1]:3000', 'https://attaquant.fr']) {
    log(`page DEV http://localhost:5173, liste [] : ${o} → ${F.origineAutorisee(o, [], 'http://localhost:5173')}`);
    // R2 (A11) : hors mode développement explicite, aucune exception localhost.
    assert.equal(F.origineAutorisee(o, [], 'http://localhost:5173'), false, o);
  }
  assert.equal(F.origineAutorisee('http://evil.localhost:1234', [], 'http://localhost:5173', true), false, '*.localhost refusé même en dev');
  assert.equal(F.origineAutorisee('http://127.0.0.9:80', [], 'http://localhost:5173', true), false, 'seul 127.0.0.1');
  assert.equal(F.origineAutorisee('http://localhost:9999', [], 'https://mimmoza.vercel.app', true), true, 'exception fondée sur l’origine source');
  log(`env vide en prod : originesStudio('', null) = ${JSON.stringify(originesStudio('', null))} ; https://x.fr accepté = ${F.origineAutorisee('https://x.fr', originesStudio('', null), prod)}`);
  log(`env vide en prod : originesStudio(undefined, 'https://mimmoza.vercel.app/studio/') = ${JSON.stringify(originesStudio(undefined, 'https://mimmoza.vercel.app/studio/'))}`);
  assert.equal(F.origineAutorisee('http://localhost:5173.evil.com', liste, prod), false);
  assert.equal(F.origineAutorisee('null', liste, prod), false);
});

test('rejeu d’un ancien message / régression de révision', () => {
  const sid = '0f3a9c1e-2b4d-4e6f-8a1b-123456789abc';
  const base = F.validerProjet(projetTest()); assert.ok(base.ok);
  let e = enregistrerEnvoi(nouvelEchange('etude-0001', () => 'x', 't'), base.projet, 't');
  const r5: any = clone(base.projet); r5.revision = 5; r5.origine = 'mimmoza-studio'; r5.batiments[0].niveaux = 6;
  const r4: any = clone(base.projet); r4.revision = 4; r4.origine = 'mimmoza-studio'; r4.batiments[0].niveaux = 5;
  const msg = (p: any) => ({ origin: 'http://localhost:5174', data: F.creerMessage('retour', sid, p) });
  const d5 = examinerMessageStudio(msg(r5), ['http://localhost:5174'], 'https://mimmoza.vercel.app', new Set([sid]));
  const d4 = examinerMessageStudio(msg(r4), ['http://localhost:5174'], 'https://mimmoza.vercel.app', new Set([sid]));
  assert.equal(d5.type, 'retour'); assert.equal(d4.type, 'retour');
  const a5 = recevoirRetour(e, (d5 as any).projet, base.projet, 't') as any;
  const a4 = recevoirRetour(a5.echange, (d4 as any).projet, base.projet, 't') as any;
  log(`rejeu : révision 4 reçue après 5 → ${'erreur' in a4 ? `refusée (${a4.erreur})` : 'acceptée'}`);
  assert.ok('erreur' in a4, 'R2 (A6) : révision plus ancienne refusée');
  // retour d'origine « mimmoza-front » accepté comme retour Studio ?
  const rf: any = clone(base.projet); rf.batiments[0].niveaux = 9;
  const af = recevoirRetour(e, rf, base.projet, 't') as any;
  log(`retour dont origine=mimmoza-front accepté : ${!('erreur' in af)}`);
  assert.ok('erreur' in af, 'R2 (A6) : un retour doit venir de Studio');
  // appli acceptée puis même retour rejoué : nouvelle modale ?
  const acc = accepterRetour(a5.echange, a5.retour, {}, 't');
  const rej = recevoirRetour(acc, (d5 as any).projet, null, 't') as any;
  log(`rejeu du retour déjà appliqué : ${'erreur' in rej ? `refusé (${rej.erreur})` : `etat=${rej.etat}`}`);
  assert.ok('erreur' in rej, 'R2 (A6) : retour rejoué refusé');
});

test('persistance simulée : isolation par clé (utilisateur via userStorage), reprise', () => {
  const mem = new Map<string, string>();
  const st = (uid: string) => ({ getItem: (k: string) => mem.get(`u:${uid}:${k}`) ?? null, setItem: (k: string, v: string) => { mem.set(`u:${uid}:${k}`, v); } });
  const base = F.validerProjet(projetTest()); assert.ok(base.ok);
  const e = enregistrerEnvoi(nouvelEchange('etude-0001', () => 'x', 't'), base.projet, 't');
  const r: any = clone(base.projet); r.batiments[0].niveaux = 7; r.origine = 'mimmoza-studio'; r.revision = base.projet.revision + 1;
  const a = recevoirRetour(e, F.validerProjet(r).projet as any, base.projet, 't') as any;
  ecrireEchangeStocke(st('alice'), a.echange);
  const relu = lireEchangeStocke(st('alice'), 'etude-0001');
  assert.equal(relu?.enAttente?.batiments[0].niveaux, 7);
  assert.equal(lireEchangeStocke(st('bob'), 'etude-0001'), null);
  log('persistance : reprise OK, autre utilisateur isolé (si userStorage préfixe)');
});
