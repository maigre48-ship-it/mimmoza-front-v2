// L3 — contrat d'échange `mimmoza-projet-v2` : aller-retour sans perte, migration v1,
// validation, origines, messages, conflits, copies identiques front / Studio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  ancreEnvoi, ancreRetour, comparerProjets, completerDepuisBase, sansDonneesSensibles, validationNormalisee, memeContenu, creerMessage, decoderProjet, empreinteProjet, encoderProjet, etatSynchronisation,
  lireAncre, lireEchange, lireMessageEchange, migrerV1versV2, nouvelleRevision, origineAutorisee, parserOrigines,
  validerProjet, versChargeV1, type ProjetMimmozaV2,
} from './mimmozaProjetV2.ts';
import { projetAleatoire, projetTest } from './fixturesProjetV2.ts';

const ctx = { projetId: 'mz-v1-migre', etudeId: null, horodatage: '2026-10-14T10:00:00.000Z' };
const valide = (p: unknown): ProjetMimmozaV2 => {
  const lu = validerProjet(p);
  assert.ok(lu.ok, lu.ok ? '' : lu.erreur);
  return lu.projet;
};

test('aller-retour sans perte : decode(encode(x)) = x (projet de référence : 3 bâtiments, forme en L, rotation, accès, règles sourcées)', () => {
  const x = valide(projetTest());
  assert.deepEqual(x, projetTest());
  const lu = decoderProjet(encoderProjet(x));
  assert.ok(lu.ok);
  assert.deepEqual(lu.projet, x);
  assert.equal(lu.migreDepuisV1, false);
  assert.equal(lu.projet.batiments[1]!.ailes.length, 2);
  assert.equal(lu.projet.batiments[1]!.rotationDeg, 37.5);
  assert.equal(lu.projet.regles[0]!.source.article, 'UB 6');
});

test('propriété decode(encode(x)) = x sur 200 projets aléatoires (accents, ailes, rotations, natures)', () => {
  for (let g = 1; g <= 200; g += 1) {
    const x = valide(projetAleatoire(g));
    const lu = decoderProjet(encoderProjet(x));
    assert.ok(lu.ok, `graine ${String(g)}`);
    assert.deepEqual(lu.projet, x, `graine ${String(g)}`);
    assert.equal(empreinteProjet(lu.projet), empreinteProjet(x));
  }
});

test('message malformé ou projet invalide : refusé avec un motif', () => {
  const p = projetTest() as unknown as Record<string, unknown>;
  const cas: [string, unknown][] = [
    ['format', { ...p, format: 'autre' }],
    ['NaN', { ...p, batiments: [{ ...projetTest().batiments[0]!, largeurM: Number.NaN }] }],
    ['doublon', { ...p, batiments: [projetTest().batiments[0]!, projetTest().batiments[0]!] }],
    ['aile', { ...p, batiments: [{ ...projetTest().batiments[1]!, ailes: [{ ...projetTest().batiments[1]!.ailes[0]!, niveauDepart: 5 }] }] }],
    ['photo data:', { ...p, photos: [{ ...projetTest().photos[0]!, url: 'data:image/png;base64,AAAA' }] }],
    ['contrôle non indicatif', { ...p, controle: { ...projetTest().controle!, indicatif: false } }],
    ['trop de bâtiments', { ...p, batiments: Array.from({ length: 21 }, (_, i) => ({ ...projetTest().batiments[0]!, id: `b${String(i)}` })) }],
    ['retourUrl d’une autre origine', { ...p, session: { ...projetTest().session!, retourUrl: 'https://evil.example/x' } }],
    ['relief sans parcelle', { ...p, site: { ...projetTest().site, parcelles: [] } }],
  ];
  for (const [nom, v] of cas) {
    const lu = validerProjet(v);
    assert.equal(lu.ok, false, nom);
    if (!lu.ok) assert.match(lu.erreur, /projet Mimmoza invalide/, nom);
  }
  assert.equal(decoderProjet('!!!').ok, false);
  assert.equal(decoderProjet('').ok, false);
  for (const d of [null, 42, 'x', [], { format: 'mimmoza-echange-v2' }, { format: 'mimmoza-echange-v2', canal: 'pirate', sessionId: 'abcdefgh' },
    { format: 'mimmoza-echange-v2', canal: 'bonjour', sessionId: '../../x' },
    { format: 'mimmoza-echange-v2', canal: 'retour', sessionId: 'abcdefgh-1234', projet: { format: 'mimmoza-projet-v2' } },
    { format: 'mimmoza-echange-v2', canal: 'bonjour', sessionId: 'abcdefgh-1234', projet: projetTest() }]) {
    assert.equal(lireMessageEchange(d).ok, false, JSON.stringify(d)?.slice(0, 80));
  }
  // Projet d'une autre session que le message : refusé.
  const autre = creerMessage('retour', 'aaaaaaaa-0000-1111', projetTest());
  assert.equal(lireMessageEchange(autre).ok, false);
  const bon = creerMessage('retour', projetTest().session!.id, projetTest());
  const lu = lireMessageEchange(JSON.parse(JSON.stringify(bon)));
  assert.ok(lu.ok);
  assert.deepEqual(lu.message.projet, projetTest());
});

test('origines : liste blanche explicite, jamais « * », localhost seulement en développement', () => {
  const liste = parserOrigines(' https://mimmoza.fr, *, https://studio.mimmoza.fr/ ;javascript:alert(1) http://localhost:5174 pas-une-url');
  assert.deepEqual(liste, ['https://mimmoza.fr', 'https://studio.mimmoza.fr', 'http://localhost:5174']);
  assert.deepEqual(parserOrigines(undefined), []);
  assert.deepEqual(parserOrigines('*'), []);
  // Production (page publique) : seule la liste et la même origine passent.
  const page = 'https://mimmoza.fr';
  assert.equal(origineAutorisee('https://studio.mimmoza.fr', liste, page), true);
  assert.equal(origineAutorisee('https://mimmoza.fr', [], page), true);
  assert.equal(origineAutorisee('https://evil.example', liste, page), false);
  assert.equal(origineAutorisee('http://localhost:5174', [], page), false);
  assert.equal(origineAutorisee('null', liste, page), false);
  assert.equal(origineAutorisee(undefined, liste, page), false);
  assert.equal(origineAutorisee('https://studio.mimmoza.fr/chemin', liste, page), false);
  // Développement (R2) : l'exception porte sur l'ORIGINE SOURCE et n'existe que si devLocal (hors build de production).
  assert.equal(origineAutorisee('http://localhost:5174', [], 'http://localhost:5173', true), true);
  assert.equal(origineAutorisee('http://127.0.0.1:5174', [], 'http://localhost:5173', true), true);
  assert.equal(origineAutorisee('http://localhost:5174', [], 'http://localhost:5173', false), false, 'production : pas d’exception localhost');
  assert.equal(origineAutorisee('http://evil.localhost:1234', [], 'http://localhost:5173', true), false, '*.localhost refusé');
  assert.equal(origineAutorisee('https://evil.example', [], 'http://localhost:5173', true), false);
});

test('migration v1 → v2 sans perte, puis retour à une charge v1 équivalente', () => {
  const grille = [[1, 2], [3, 4]];
  const v1 = {
    version: 1, source: 'mimmoza-front-v2',
    bridgeSessionId: '11111111-2222-3333-4444-555555555555', conversationId: '66666666-7777-8888-9999-000000000000', openerOrigin: 'http://localhost:5173',
    communeInsee: '64065', adresse: 'Ascain', pointAdresse: { lat: 43.3442, lon: -1.6201 },
    parcels: [{ id: '64065000AI0001', feature: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-1.6205, 43.344], [-1.6197, 43.344], [-1.6197, 43.3448], [-1.6205, 43.344]]] } } }],
    terrainData: { provider: 'IGN_ALTI', renderBounds: [0, 0, 1, 1], parcelBounds: [0, 0, 1, 1], grid: { z: grille, n: 2 }, altitudeMin: 1, altitudeMax: 4, penteMoyenne: null },
    implantation: { lon: -1.6201, lat: 43.3444, orientationDeg: 15, entryOffsetM: 0.4 },
    accesses: [{ kind: 'pieton', lon: -1.6204, lat: 43.344 }, { kind: 'vehicule', lon: -1.6199, lat: 43.344 }],
    panoramas: [{ url: 'https://x.supabase.co/storage/v1/object/sign/environnement-360/a.jpg', nom: 'Pano' }],
    brief: 'Programme : 8 logements',
    commandeArchitecture: 'Crée un immeuble collectif R+3',
    volumeAiles: [{ name: 'A', largeurM: 20, profondeurM: 10, niveaux: 4, retraitM: 0, x: 0, z: 0 }, { name: 'B', largeurM: 10, profondeurM: 8, niveaux: 2, retraitM: 1, x: 12, z: 3, fromLevelIndex: 0 }],
    facades: [{ url: 'https://x.supabase.co/storage/v1/object/sign/studio-transfert/f.jpg', nom: 'Façade' }],
    plans: [{ url: 'https://x.supabase.co/storage/v1/object/sign/studio-transfert/p.pdf', nom: 'Plan RDC' }],
  };
  const lu = migrerV1versV2(v1, ctx);
  assert.ok(lu.ok, lu.ok ? '' : lu.erreur);
  assert.equal(lu.migreDepuisV1, true);
  const p = lu.projet;
  assert.equal(p.site.parcelles[0]!.id, '64065000AI0001');
  assert.equal(p.site.relief?.nature, 'mesure');
  assert.equal(p.acces.length, 2);
  assert.equal(p.photos.length, 3);
  assert.equal(p.session?.retourOrigine, 'http://localhost:5173');
  assert.equal(p.extensionsV1.implantation?.orientationDeg, 15);
  // Retour à la charge v1 : identique à l'original (aucun champ perdu).
  assert.deepEqual(versChargeV1(p), v1);
  // Un v1 lu via lireEchange exige un contexte de migration.
  assert.equal(lireEchange(v1).ok, false);
  assert.ok(lireEchange(v1, ctx).ok);
  // v1 sans relief ni extras : minimal.
  const mini = migrerV1versV2({ version: 1, source: 'mimmoza-front-v2', parcels: [{ id: 'X1', feature: null }] }, ctx);
  assert.ok(mini.ok);
  if (mini.ok) assert.equal(mini.projet.site.parcelles[0]!.geometrie, null);
  // v1 invalide : refus explicite.
  assert.equal(migrerV1versV2({ version: 1, source: 'mimmoza-front-v2', parcels: [{ id: 'X', feature: null }], accesses: [{ kind: 'drone', lon: 0, lat: 0 }] }, ctx).ok, false);
  assert.equal(migrerV1versV2({ version: 1, source: 'autre' }, ctx).ok, false);
});

test('différences lisibles : déplacement, rotation, dimensions, niveaux, accès, règles', () => {
  const avant = projetTest();
  const b0 = avant.batiments[0]!;
  const apres: ProjetMimmozaV2 = {
    ...avant,
    batiments: [
      { ...b0, centre: { lon: b0.centre.lon, lat: b0.centre.lat + 2.3 / 110_574 }, rotationDeg: 5, niveaux: 5 },
      { ...avant.batiments[1]!, largeurM: 32 },
    ],
    acces: [avant.acces[0]!],
    regles: [{ ...avant.regles[0]!, valeur: 4 }, avant.regles[1]!],
  };
  const libelles = comparerProjets(avant, apres).map((c) => c.libelle);
  assert.ok(libelles.includes('bâtiment A déplacé de 2,3 m'), libelles.join(' | '));
  assert.ok(libelles.includes('bâtiment A tourné de 5,0°'));
  assert.ok(libelles.includes('bâtiment A : 4 → 5 niveaux'));
  assert.ok(libelles.includes('bâtiment B (en L) : 30,0 × 22,0 m → 32,0 × 22,0 m'));
  assert.ok(libelles.includes('bâtiment Annexe supprimé'));
  assert.ok(libelles.includes('accès véhicule supprimé'));
  assert.ok(libelles.some((l) => l.startsWith('règle reculs.voirie.min_m : 5 (validee) → 4')));
  assert.deepEqual(comparerProjets(avant, avant), []);
});

test('conflit de version : les deux côtés ont changé → « conflit », jamais un écrasement silencieux', () => {
  const base = projetTest();
  const b = base.batiments[0]!;
  const local = { ...base, batiments: [{ ...b, rotationDeg: 10 }, ...base.batiments.slice(1)] };
  const distant = nouvelleRevision({ ...base, batiments: [{ ...b, largeurM: 30 }, ...base.batiments.slice(1)] }, 'mimmoza-studio', '2026-10-14T11:00:00.000Z', base);
  assert.equal(etatSynchronisation(null, local, distant), 'sans-base');
  assert.equal(etatSynchronisation(base, base, distant), 'distant-seul');
  assert.equal(etatSynchronisation(base, local, distant), 'conflit');
  assert.equal(etatSynchronisation(base, local, base), 'distant-inchange');
  assert.equal(etatSynchronisation(base, distant, distant), 'convergent');
  // L'autre côté repart de notre état actuel : pas de conflit.
  const suite = nouvelleRevision({ ...local, programme: { ...local.programme, logementsVises: 14 } }, 'mimmoza-studio', '2026-10-14T12:00:00.000Z', local);
  assert.equal(etatSynchronisation(base, local, suite), 'conflit', 'sans connaître notre dernier envoi, prudence');
  assert.equal(etatSynchronisation(base, local, suite, local), 'distant-seul');
  // Mais si nous avons encore changé depuis cet envoi : conflit.
  const encore = { ...local, batiments: [{ ...b, rotationDeg: 20 }, ...base.batiments.slice(1)] };
  assert.equal(etatSynchronisation(base, encore, suite, local), 'conflit');
  assert.equal(suite.revision, base.revision + 1);
  // Le bruit de projection (< 1 cm) n'est pas un changement ; le contrôle et l'horodatage non plus.
  const bruit = { ...base, horodatage: '2027-01-01T00:00:00.000Z', controle: null, batiments: base.batiments.map((x) => ({ ...x, centre: { lon: x.centre.lon + 4e-9, lat: x.centre.lat - 3e-9 } })) };
  assert.equal(etatSynchronisation(base, bruit, distant), 'distant-seul');
  assert.equal(etatSynchronisation(base, local, bruit), 'distant-inchange');
  // L'empreinte identifie une version transmise exacte (après sérialisation).
  assert.equal(empreinteProjet(JSON.parse(JSON.stringify(base))), empreinteProjet(base));
});

test('transport par adresse : petit projet dans l’ancre, gros projet par poignée de main, retour sans relief si besoin', () => {
  const sensible = projetTest();
  // R2 (A10) : un nom de validateur ou un lien signé ne passe jamais par l'adresse.
  assert.equal(ancreEnvoi(sensible).parPostMessage, true);
  const p = sansDonneesSensibles(sensible);
  assert.equal(p.omissions.validations, true);
  assert.ok(!JSON.stringify(p).includes('Albé') && !JSON.stringify(p).includes('token='));
  assert.equal(ancreEnvoi(p).parPostMessage, false);
  const petit = ancreEnvoi(p);
  assert.equal(petit.parPostMessage, false);
  const a = lireAncre(`#${petit.ancre}`);
  assert.ok(a && a.type === 'projet');
  if (a && a.type === 'projet') assert.deepEqual((decoderProjet(a.code) as { projet: ProjetMimmozaV2 }).projet, p);
  const gros = ancreEnvoi(p, 100);
  assert.equal(gros.parPostMessage, true);
  assert.deepEqual(lireAncre(`#${gros.ancre}`), { type: 'attente', sessionId: p.session!.id });
  assert.equal(lireAncre('#projet-attente=../x'), null);
  assert.equal(lireAncre('#parcelles=abc'), null);
  const sansRelief = encoderProjet({ ...p, site: { ...p.site, relief: null, reliefOmis: true } }).length;
  const r = ancreRetour(p, sansRelief + 20);
  assert.ok(r);
  const lr = lireAncre(`#${r!}`);
  assert.ok(lr && lr.type === 'retour');
  if (lr && lr.type === 'retour') {
    const d = decoderProjet(lr.code);
    assert.ok(d.ok);
    if (d.ok) { assert.equal(d.projet.site.relief, null); assert.equal(d.projet.site.reliefOmis, true); }
  }
  assert.equal(ancreRetour(p, 50), null);
});

test('copies du contrat identiques dans les deux dépôts (empreinte SHA-256)', (t) => {
  const ici = fileURLToPath(new URL('./mimmozaProjetV2.ts', import.meta.url));
  const studio = fileURLToPath(new URL('../../../../../../mimmozia-studio/src/core/echange/mimmozaProjetV2.ts', import.meta.url));
  if (!existsSync(studio)) { t.skip('dépôt mimmozia-studio absent à côté de mimmoza-front-v2'); return; }
  const sha = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');
  assert.equal(sha(ici), sha(studio));
});

// ------------------------------------------------------------------ R2

const TRANSPORT = new Set(['format', 'version', 'projetId', 'etudeId', 'revision', 'parentEmpreinte', 'horodatage', 'origine', 'session', 'repere', 'controle', 'omissions']);
const ENUMS = ['mesure', 'modelise', 'estime', 'vise', 'pieton', 'vehicule', 'photo', 'facade', 'plan', 'panorama', 'document', 'saisie', 'ia', 'defaut', 'inconnue', 'non-validee', 'validee', 'rejetee'];

function chemins(x: unknown, prefixe: (string | number)[] = []): (string | number)[][] {
  if (x === null || typeof x !== 'object') return [prefixe];
  const entrees = Array.isArray(x) ? x.map((v, i) => [i, v] as const) : Object.entries(x as Record<string, unknown>);
  if (entrees.length === 0) return [prefixe];
  return entrees.flatMap(([k, v]) => chemins(v, [...prefixe, k]));
}
function lire(o: unknown, c: (string | number)[]): unknown { return c.reduce<unknown>((a, k) => (a as Record<string | number, unknown>)[k], o); }
function ecrire(o: unknown, c: (string | number)[], v: unknown): void {
  const parent = lire(o, c.slice(0, -1)) as Record<string | number, unknown>;
  parent[c[c.length - 1]!] = v;
}
function candidats(v: unknown, c: (string | number)[]): unknown[] {
  const cle = String(c[c.length - 1]);
  if (typeof v === 'number') return cle === 'lon' || cle === 'lat' || c.includes('coordinates') || c.includes('renderBounds') || c.includes('parcelBounds') ? [v + 0.001, v - 0.001] : [v + 1, v - 1, v + 0.5, v - 0.5];
  if (typeof v === 'boolean') return [!v];
  if (typeof v === 'string') return [...ENUMS.filter((e) => e !== v), `${v}x`, `${v.slice(0, -1)}9`, '2026-10-15T00:00:00Z', 'https://autre.example/b.jpg', 'Zoé Martin'];
  if (v === null) return [1, 'x', 'https://autre.example/c.jpg', '2026-10-15T00:00:00Z', { lon: -1.62, lat: 43.34 }, { valeur: 10, nature: 'estime' }];
  return [];
}

test('R2 (A2) propriété : toute mutation VALIDE d’un champ de contenu du contrat donne au moins une différence', () => {
  const base = valide(projetTest());
  let testees = 0;
  const muets: string[] = [];
  for (const c of chemins(base)) {
    if (TRANSPORT.has(String(c[0]))) continue;
    if (c[0] === 'batiments' && (c[2] === 'emprise' || c[2] === 'refs')) continue; // emprise dérivée, refs = correspondance
    if (c[0] === 'site' && c[1] === 'reliefOmis') continue; // indicateur de transport (relief repris de la base)
    for (const v of candidats(lire(base, c), c)) {
      const q = JSON.parse(JSON.stringify(base));
      ecrire(q, c, v);
      const lu = validerProjet(q);
      if (!lu.ok || JSON.stringify(lu.projet) === JSON.stringify(base)) continue;
      testees += 1;
      if (comparerProjets(base, lu.projet).length === 0 || memeContenu(base, lu.projet)) muets.push(`${c.join('.')} = ${JSON.stringify(v)}`);
      break;
    }
  }
  assert.deepEqual(muets, [], 'mutations non détectées');
  assert.ok(testees >= 120, `seulement ${String(testees)} champs mutés`);
});

test('R2 (A3) règles et photos à identifiant en double : refusées (jamais départagées au hasard)', () => {
  const p = projetTest();
  assert.equal(validerProjet({ ...p, regles: [p.regles[0]!, { ...p.regles[0]!, valeur: 7 }] }).ok, false);
  assert.equal(validerProjet({ ...p, photos: [p.photos[0]!, p.photos[0]!] }).ok, false);
});

test('R2 (A9) « validée » exige un auteur non factice et une date ; sinon non validée', () => {
  assert.deepEqual(validationNormalisee('validee', null, null), { statut: 'non-validee', par: null, le: null });
  assert.deepEqual(validationNormalisee('validee', 'Albé Durand', null), { statut: 'non-validee', par: null, le: null });
  for (const f of ['test', 'Admin', 'utilisateur', 'IA', 'Mimmoza', 'x', 'À compléter', '42']) assert.equal(validationNormalisee('validee', f, '2026-10-13T08:00:00Z').statut, 'non-validee', f);
  assert.equal(validationNormalisee('rejetee', 'Claire Martin', 'pas une date').statut, 'non-validee');
  assert.deepEqual(validationNormalisee('validee', 'Claire Martin', '2026-10-13T08:00:00Z'), { statut: 'validee', par: 'Claire Martin', le: '2026-10-13T08:00:00Z' });
  const p = projetTest();
  const lu = validerProjet({ ...p, regles: [{ ...p.regles[0]!, validation: { statut: 'validee', par: 'test', le: '2026-10-13T08:00:00Z' } }] });
  assert.ok(lu.ok);
  if (lu.ok) assert.equal(lu.projet.regles[0]!.validation.statut, 'non-validee');
});

test('R2 (A10) retour par adresse : sans nom de validateur ni lien signé, complété par la base à l’arrivée', () => {
  const base = valide(projetTest());
  const a = lireAncre(`#${ancreRetour(base)!}`);
  assert.ok(a && a.type === 'retour');
  if (!a || a.type !== 'retour') return;
  const brut = decoderProjet(a.code);
  assert.ok(brut.ok);
  if (!brut.ok) return;
  assert.ok(!JSON.stringify(brut.projet).includes('Albé'), 'aucun nom dans l’adresse');
  assert.ok(!JSON.stringify(brut.projet).includes('token='), 'aucun lien signé dans l’adresse');
  assert.deepEqual(brut.projet.omissions, { validations: true, liensPhotos: true });
  assert.deepEqual(completerDepuisBase(brut.projet, base), base);
  // Une règle modifiée ne récupère PAS la validation de la base.
  const modifie = { ...brut.projet, regles: brut.projet.regles.map((r, i) => (i === 0 ? { ...r, valeur: 7 } : r)) };
  assert.equal(completerDepuisBase(modifie, base).regles[0]!.validation.statut, 'non-validee');
});

test('R2 (A12) migration v1 : une photo data: est ignorée avec un avertissement, la migration réussit', () => {
  const v1 = { version: 1, source: 'mimmoza-front-v2', parcels: [{ id: 'P1', feature: null }],
    panoramas: [{ url: 'data:image/jpeg;base64,AAAA', nom: 'p' }, { url: 'https://x.supabase.co/storage/v1/object/sign/environnement-360/a.jpg', nom: 'ok' }] };
  const m = migrerV1versV2(v1, ctx);
  assert.ok(m.ok, m.ok ? '' : m.erreur);
  if (!m.ok) return;
  assert.equal(m.projet.photos.length, 1);
  assert.equal(m.projet.photos[0]!.nom, 'ok');
  assert.equal(m.avertissements.length, 1);
  assert.match(m.avertissements[0]!, /ignorée/);
});
