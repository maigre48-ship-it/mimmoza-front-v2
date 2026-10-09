import assert from 'node:assert/strict';
import test from 'node:test';
import middleware from './middleware.ts';

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  try { fn(); } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

const req = (authorization?: string) =>
  new Request('https://mimmoza.vercel.app/mimmozia', authorization ? { headers: { authorization } } : {});
const basic = (s: string) => `Basic ${btoa(s)}`;

test('production : aucune Basic Auth demandée', () => {
  withEnv({ VERCEL_ENV: 'production', PREVIEW_USER: 'u', PREVIEW_PASS: 'p' }, () => {
    assert.equal(middleware(req()), undefined);
    assert.equal(middleware(req('Basic !!!')), undefined);
  });
});

test('preview : 401 sans identifiants, accès avec les bons', () => {
  withEnv({ VERCEL_ENV: 'preview', PREVIEW_USER: 'u', PREVIEW_PASS: 'p' }, () => {
    const res = middleware(req());
    assert.equal(res?.status, 401);
    assert.equal(res?.headers.get('WWW-Authenticate'), 'Basic realm="Mimmoza Preview"');
    assert.equal(middleware(req(basic('u:p'))), undefined);
    assert.equal(middleware(req(basic('u:wrong')))?.status, 401);
  });
});

test('hors production sans VERCEL_ENV : reste protégé', () => {
  withEnv({ VERCEL_ENV: undefined, PREVIEW_USER: 'u', PREVIEW_PASS: 'p' }, () => {
    assert.equal(middleware(req())?.status, 401);
  });
});

test('preview : Authorization malformé → 401 sans exception', () => {
  withEnv({ VERCEL_ENV: 'preview', PREVIEW_USER: 'u', PREVIEW_PASS: 'p' }, () => {
    for (const header of ['Basic !!!not-base64', 'Basic', 'Bearer xyz', 'garbage', basic('nocolon'), 'Basic %%%']) {
      assert.doesNotThrow(() => middleware(req(header)), header);
      assert.equal(middleware(req(header))?.status, 401, header);
    }
  });
});
