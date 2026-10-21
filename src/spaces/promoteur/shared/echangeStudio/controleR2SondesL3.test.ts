// CONTRÔLE L3 R2 — sondes de contournement (front + contrat). Aucune écriture disque.
// Intégré en R3 (source : _mimmoza-agents/controle-l3/tests/r2SondesContrat.test.ts) ; sondes devenues assertions.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as F from './mimmozaProjetV2.ts';
import { projetTest } from './fixturesProjetV2.ts';
import { recevoirRetour, nouvelEchange, enregistrerEnvoi } from './persistanceEchange.ts';
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const log = (s: string) => console.log('R2 ' + s);
const ok = (p: any) => { const l = F.validerProjet(p); assert.ok(l.ok, (l as any).erreur); return l.projet; };

test('A9 : validateurs factices (liste noire)', () => {
  for (const n of ['admin1', 'Test User', 'aa', 'Qq', 'xx yy', 'N.A.', 'Mimmoza IA', 'Jean', '🙂🙂', 'Albé Durand'])
    log(`validateurExploitable(${JSON.stringify(n)}) = ${F.validateurExploitable(n)}`);
  for (const n of ['admin1', 'Test User', 'aa', 'Qq', 'xx yy', 'N.A.', 'Mimmoza IA', '🙂🙂', 'Assistant 2', 'user42', 'Utilisateur Studio']) assert.equal(F.validateurExploitable(n), false, n);
  for (const n of ['Jean', 'Albé Durand', 'Claire Martin']) assert.equal(F.validateurExploitable(n), true, n);
  const p: any = clone(projetTest()); p.regles[0].validation = { statut: 'validee', par: null, le: null };
  log(`validee sans par/le → ${JSON.stringify(ok(p).regles[0].validation)}`);
  const q: any = clone(projetTest()); q.regles[0].validation = { statut: 'validee', par: 'Albé Durand', le: 'demain' };
  log(`validee date illisible → ${JSON.stringify(ok(q).regles[0].validation)}`);
  assert.equal(ok(q).regles[0].validation.statut, 'non-validee', 'R3 : date illisible → non validée (projet accepté)');
  const r: any = clone(projetTest()); r.regles[0].validation = { statut: 'validee', par: 'Albé Durand', le: '1' };
  log(`validee le="1" (Date.parse lisible) → ${JSON.stringify(ok(r).regles[0].validation)}`);
});

test('A10 : données sensibles dans l’ancre', () => {
  const p: any = clone(projetTest()); p.session = null;
  p.photos[0].url = 'https://abc.supabase.co/storage/v1/object/sign/studio-transfert/u1/eyJhbGciOiJIUzI1NiJ9.jeton/f1.jpg';
  const a = F.ancreEnvoi(ok(p));
  const txt = F.depuisBase64Url(a.ancre.replace(/^projet=/, ''));
  log(`sans session : nom validateur dans l’ancre = ${txt.includes('Albé Durand')} ; jeton dans le CHEMIN conservé = ${txt.includes('eyJhbGciOiJIUzI1NiJ9')}`);
  assert.equal(txt.includes('Albé Durand'), false);
  assert.equal(txt.includes('eyJhbGciOiJIUzI1NiJ9'), false, 'R3 (R2-6) : jeton dans le chemin retiré');
  const s: any = clone(projetTest()); s.regles[0].validation = { statut: 'rejetee', par: 'Albé Durand', le: '2026-10-13T08:00:00Z' };
  const r = F.ancreRetour(ok(s))!;
  const t2 = F.depuisBase64Url(r.replace(/^studio-retour=/, ''));
  log(`ancreRetour : nom = ${t2.includes('Albé')} ; retourUrl ?study= présent = ${t2.includes('study=')} ; adresse = ${t2.includes('Ascain')} ; longueur=${r.length}`);
  assert.equal(t2.includes('Albé'), false);
  const e = F.ancreEnvoi(ok(clone(projetTest())));
  log(`avec session + validateur : parPostMessage=${e.parPostMessage}`);
});

test('A6 : bornes de révision (retour à 1e9)', () => {
  const base = ok(clone(projetTest()));
  const e = enregistrerEnvoi(nouvelEchange('etude-0001', () => 'x', 't'), base, 't');
  const r: any = clone(base); r.origine = 'mimmoza-studio'; r.revision = 1e9; r.batiments[0].niveaux = 6;
  const a = recevoirRetour(e, ok(r), base, 't') as any;
  log(`retour révision 1e9 : ${'erreur' in a ? 'REFUSÉ — ' + a.erreur : 'accepté'}`);
  assert.ok('erreur' in a, 'R3 (R2-5) : saut de révision invraisemblable refusé');
  const r2: any = clone(base); r2.origine = 'mimmoza-studio'; r2.revision = 4; r2.batiments[0].niveaux = 7;
  const b = recevoirRetour(e, ok(r2), base, 't') as any;
  log(`retour légitime rev 4 : ${'erreur' in b ? 'REFUSÉ — ' + b.erreur : 'accepté'}`);
  assert.ok(!('erreur' in b), 'le retour légitime suivant reste accepté');
  const futur: any = clone(base); futur.origine = 'mimmoza-studio'; futur.revision = 10; futur.horodatage = '1970-01-01T00:00:05.000Z';
  assert.equal(F.revisionVraisemblable(ok(futur), 3), false, 'révision supérieure à l’horodatage en secondes');
});

test('A11 : exception localhost', () => {
  const prod = 'https://mimmoza.vercel.app';
  for (const o of ['http://localhost:9999', 'http://127.0.0.1:1', 'http://[::1]:3000', 'http://localhost.:5173', 'http://127.0.0.1.nip.io', 'http://[::ffff:127.0.0.1]', 'http://0.0.0.0:5173', 'http://sub.localhost:5173'])
  {
    log(`devLocal=true page prod : ${o} → ${F.origineAutorisee(o, [], prod, true)} ; devLocal=false → ${F.origineAutorisee(o, [], prod, false)}`);
    assert.equal(F.origineAutorisee(o, [], prod, false), false, o);
  }
});

test('Point ouvert : faux conflit après retour par adresse', () => {
  const s: any = clone(projetTest()); s.origine = 'mimmoza-studio';
  s.regles[1].validation = { statut: 'validee', par: 'Bob Martin', le: '2026-10-14T10:00:00Z' }; // validation faite dans Studio
  const envoye = ok(s);
  const recu = F.decoderProjet(F.ancreRetour(envoye)!.replace(/^studio-retour=/, ''));
  assert.ok(recu.ok);
  const complete = F.completerDepuisBase(recu.projet, ok(clone(projetTest())));
  log(`empreinte Studio envoyée == empreinte reçue complétée : ${F.empreinteProjet(envoye) === F.empreinteProjet(complete)} ; validation Bob restituée = ${JSON.stringify(complete.regles[1].validation)}`);
  log(`etatSynchronisation (Studio inchangé depuis l’envoi, Mimmoza modifie et renvoie avec parent=empreinte reçue) :`);
  const fr: any = clone(complete); fr.origine = 'mimmoza-front'; fr.batiments[0].niveaux = 8; fr.parentEmpreinte = F.empreinteProjet(complete);
  log(`  → ${F.etatSynchronisation(ok(clone(projetTest())), envoye, ok(fr), envoye)}`);
});

test('Point ouvert : champs inconnus et hauteur', () => {
  const p: any = clone(projetTest()); p.futur = 1; p.batiments[0].hauteurNature = 'mesure';
  const l = ok(p);
  log(`champs inconnus conservés = ${'futur' in l || 'hauteurNature' in (l.batiments[0] as any)} ; avertissement = ${JSON.stringify((F.validerProjet(p) as any).avertissements)}`);
  const av = (F.validerProjet(p) as any).avertissements as string[];
  assert.equal(av.length, 1, 'R3 : avertissement « champs inconnus ignorés »');
  assert.match(av[0]!, /futur/);
  assert.match(av[0]!, /batiments\[0\]\.hauteurNature/);
});
