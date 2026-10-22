import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Limiteur,
  construireChargeUtile,
  decrireErreur,
  echantillonner,
  estBruit,
  nettoyerContexte,
  nettoyerRoute,
  tronquer,
  versionDepuisScripts,
} from './core.ts';
import { empreinteErreur, normaliserMessageErreur } from '../../../supabase/functions/_shared/copilot-stream/reprise.ts';

test('route : ni query string, ni ancre, identifiants masqués', () => {
  assert.equal(nettoyerRoute('https://mimmoza.fr/mimmozia?token=abc#x'), '/mimmozia');
  assert.equal(nettoyerRoute('/projets/8f14e45f-ceea-467a-9f2b-1234567890ab/plan?x=1'), '/projets/:id/plan');
  assert.equal(nettoyerRoute('/etude/123456'), '/etude/:id');
  assert.equal(nettoyerRoute(''), '/');
});

test('contexte : clés sensibles et valeurs complexes écartées, valeurs tronquées', () => {
  const ctx = nettoyerContexte({
    etape: 'flux', duree_ms: 1200, access_token: 'x', email: 'a@b.c', message_utilisateur: 'secret',
    payload: { a: 1 }, liste: [1, 2], long: 'x'.repeat(500), ok: true, rien: null,
  });
  assert.deepEqual(Object.keys(ctx).sort(), ['duree_ms', 'etape', 'long', 'ok', 'rien']);
  assert.equal((ctx.long as string).length, 200);
});

test('bruit connu ignoré', () => {
  assert.ok(estBruit('ResizeObserver loop completed with undelivered notifications.'));
  assert.ok(estBruit('Script error.'));
  assert.ok(estBruit('AbortError: The user aborted a request.'));
  assert.ok(estBruit('x', 'at chrome-extension://abc/content.js:1:1'));
  assert.ok(!estBruit('TypeError: Cannot read properties of undefined'));
});

test('limiteur : dé-duplication par empreinte et plafond par minute', () => {
  const l = new Limiteur(3, 60_000);
  assert.ok(l.accepter('a', 0));
  assert.ok(!l.accepter('a', 1000));
  assert.ok(l.accepter('b', 1000));
  assert.ok(l.accepter('c', 1000));
  assert.ok(!l.accepter('d', 2000)); // 4e envoi dans la minute
  assert.ok(l.accepter('d', 61_500));
  assert.ok(l.accepter('a', 70_000)); // fenêtre de dé-duplication écoulée
});

test('échantillonnage', () => {
  assert.ok(echantillonner(1, 0.99));
  assert.ok(!echantillonner(0, 0));
  assert.ok(echantillonner(0.5, 0.2));
  assert.ok(!echantillonner(0.5, 0.7));
  assert.ok(echantillonner(Number.NaN, 0.7));
});

test('version : variable d’environnement, sinon hash du bundle', () => {
  assert.equal(versionDepuisScripts([], 'abc123'), 'abc123');
  assert.equal(versionDepuisScripts(['https://mimmoza.fr/assets/index-B2x9_kQz.js']), 'B2x9_kQz');
  assert.equal(versionDepuisScripts(['https://cdn/x.js']), null);
});

test('empreinte : stable malgré identifiants, nombres et hash de build', () => {
  const a = empreinteErreur('front', 'Échec 8f14e45f-ceea-467a-9f2b-1234567890ab après 1200 ms',
    'TypeError\n    at f (https://mimmoza.fr/assets/index-AbCdEf12.js:10:20)');
  const b = empreinteErreur('front', 'Échec 11111111-2222-4333-8444-555555555555 après 98 ms',
    'TypeError\n    at f (https://mimmoza.fr/assets/index-ZzYyXx99.js:11:5)');
  assert.equal(a, b);
  assert.notEqual(a, empreinteErreur('edge', 'Échec x après 1 ms', null));
  assert.equal(normaliserMessageErreur('id "abc" n°42'), 'id <str> n°<n>');
});

test('charge utile : bornée et sans donnée superflue', () => {
  const c = construireChargeUtile(
    { source: 'copilot', message: 'm'.repeat(5000), stack: 's'.repeat(9000), context: { etape: 'flux', token: 'x' } },
    { routeCourante: '/mimmozia?q=adresse', userAgent: 'UA', release: 'r1' },
  );
  assert.equal(c.p_message.length, 1000);
  assert.equal(c.p_stack?.length, 4000);
  assert.equal(c.p_route, '/mimmozia');
  assert.deepEqual(c.p_context, { etape: 'flux' });
  assert.match(c.p_fingerprint, /^[0-9a-f]{8}$/);
  assert.equal(tronquer('abc', 10), 'abc');
});

test('decrireErreur : Error, chaîne, objet', () => {
  assert.equal(decrireErreur(new TypeError('x')).message, 'TypeError: x');
  assert.equal(decrireErreur('brut').message, 'brut');
  assert.equal(decrireErreur({ a: 1 }).message, '{"a":1}');
});
