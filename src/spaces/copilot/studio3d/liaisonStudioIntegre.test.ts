// LIAISON 03/11/2026 — Studio intégré toujours servi à la même origine que la page.
// Panne de production : VITE_MIMMOZIA_STUDIO_URL=https://mimmozia-studio-preview.vercel.app
// (autre origine) → poignée de main impossible, « Ouverture de Studio… » sans fin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adresseStudioIntegre, baseStudioIntegre, DELAI_STUDIO_MUET_MS, messageStudioMuet, projetIdChat } from './projetChat.ts';

const PROD = 'https://mimmoza.vercel.app';
const SESSION = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

test('production : une adresse Studio d’une autre origine est remplacée par <origine>/studio/', () => {
  assert.equal(baseStudioIntegre('https://mimmozia-studio-preview.vercel.app/', PROD), 'https://mimmoza.vercel.app/studio/');
  assert.equal(baseStudioIntegre('https://mimmozia-studio.vercel.app/studio/', PROD), 'https://mimmoza.vercel.app/studio/');
});

test('adresse déjà de la même origine : gardée telle quelle', () => {
  assert.equal(baseStudioIntegre('https://mimmoza.vercel.app/studio/', PROD), 'https://mimmoza.vercel.app/studio/');
  assert.equal(baseStudioIntegre('https://mimmoza.vercel.app/autre-studio/', PROD), 'https://mimmoza.vercel.app/autre-studio/');
});

test('Preview Vercel du front : même règle, sa propre origine', () => {
  const preview = 'https://mimmoza-front-git-x-albe.vercel.app';
  assert.equal(baseStudioIntegre('https://mimmozia-studio-preview.vercel.app', preview), `${preview}/studio/`);
});

test('poste local : l’adresse de développement configurée est respectée', () => {
  assert.equal(baseStudioIntegre('http://localhost:5174/', 'http://localhost:5173'), 'http://localhost:5174/');
  assert.equal(baseStudioIntegre('http://127.0.0.1:4174/studio/', 'http://127.0.0.1:4173'), 'http://127.0.0.1:4174/studio/');
});

test('adresse complète de Studio intégré : même origine, projet et session dans l’ancre', () => {
  const u = new URL(adresseStudioIntegre(baseStudioIntegre('https://mimmozia-studio-preview.vercel.app', PROD), projetIdChat('conv-1'), SESSION, 'etude-7'));
  assert.equal(u.origin, PROD);
  assert.equal(u.pathname, '/studio/');
  assert.equal(u.searchParams.get('mzprojet'), 'mzchat-conv-1');
  assert.equal(u.searchParams.get('etude'), 'etude-7');
  assert.equal(u.hash, `#projet-attente=${SESSION}`);
});

test('Studio muet : message clair, avec l’origine fautive quand elle diffère', () => {
  assert.ok(DELAI_STUDIO_MUET_MS >= 10_000 && DELAI_STUDIO_MUET_MS < 90_000);
  assert.match(messageStudioMuet('https://mimmozia-studio-preview.vercel.app/?x', PROD), /mimmozia-studio-preview\.vercel\.app/);
  assert.match(messageStudioMuet('https://mimmozia-studio-preview.vercel.app/?x', PROD), /VITE_MIMMOZIA_STUDIO_URL/);
  assert.doesNotMatch(messageStudioMuet(`${PROD}/studio/?x`, PROD), /VITE_/);
});
