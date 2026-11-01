import test from 'node:test';
import assert from 'node:assert/strict';
import { metadonneesTus, SEUIL_UPLOAD_REPRENABLE, TAILLE_BLOC_TUS, televerserTus, urlTus } from './televersementTus.ts';

const Mo = 1024 * 1024;

test('TUS : point d’entrée et métadonnées', () => {
  assert.equal(urlTus('https://fwvrqngbafqdaekbdfnm.supabase.co/'), 'https://fwvrqngbafqdaekbdfnm.storage.supabase.co/storage/v1/upload/resumable');
  assert.equal(urlTus('https://api.mimmoza.fr'), 'https://api.mimmoza.fr/storage/v1/upload/resumable');
  const m = metadonneesTus({ bucketName: 'b', objectName: 'u/c/règlement.pdf', contentType: 'application/pdf' });
  const parties = Object.fromEntries(m.split(',').map((x) => x.split(' ')).map(([k, v]) => [k, Buffer.from(v, 'base64').toString('utf8')]));
  assert.deepEqual(parties, { cacheControl: '3600', bucketName: 'b', objectName: 'u/c/règlement.pdf', contentType: 'application/pdf' });
  assert.equal(SEUIL_UPLOAD_REPRENABLE, 6 * Mo);
  assert.equal(TAILLE_BLOC_TUS, 6 * Mo, 'taille de bloc imposée par Supabase');
});

/** Serveur TUS factice : enregistre les octets reçus ; peut faire échouer un PATCH. */
function serveur(o: { echecPatch?: number; statutCreation?: number } = {}) {
  let recu = 0; let patchs = 0; const appels: string[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    const h = new Headers(init.headers as HeadersInit);
    appels.push(`${init.method} ${h.get('upload-offset') ?? ''}`);
    if (init.method === 'POST') {
      assert.equal(h.get('tus-resumable'), '1.0.0');
      assert.ok(h.get('authorization')?.startsWith('Bearer '));
      return new Response(null, { status: o.statutCreation ?? 201, headers: { location: '/storage/v1/upload/resumable/abc' } });
    }
    assert.equal(url, 'https://ref.storage.supabase.co/storage/v1/upload/resumable/abc');
    if (init.method === 'HEAD') return new Response(null, { status: 200, headers: { 'upload-offset': String(recu) } });
    patchs++;
    if (patchs === o.echecPatch) throw new TypeError('Failed to fetch');
    assert.equal(Number(h.get('upload-offset')), recu, 'bloc envoyé au bon décalage');
    recu += (init.body as Blob).size;
    return new Response(null, { status: 204, headers: { 'upload-offset': String(recu) } });
  }) as unknown as typeof fetch;
  return { fetchFn, appels, recu: () => recu };
}

const p = (fichier: Blob, fetchFn: typeof fetch, progres?: number[]) => ({
  supabaseUrl: 'https://ref.supabase.co', apikey: 'anon', jeton: 'jwt', bucket: 'copilot-pieces-jointes', chemin: 'u/c/x.pdf',
  fichier, type: 'application/pdf', fetchFn, attendre: async () => {}, surProgres: progres ? (e: number) => progres.push(e) : undefined,
});

test('TUS : un PDF de 50 Mo part en 9 blocs de 6 Mo maximum', async () => {
  const s = serveur();
  const progres: number[] = [];
  await televerserTus(p(new Blob([new Uint8Array(50 * Mo)]), s.fetchFn, progres));
  assert.equal(s.recu(), 50 * Mo);
  assert.equal(s.appels.filter((a) => a.startsWith('PATCH')).length, 9);
  assert.equal(progres.at(-1), 50 * Mo);
});

test('TUS : coupure réseau sur un bloc → reprise au bon endroit', async () => {
  const s = serveur({ echecPatch: 2 });
  await televerserTus(p(new Blob([new Uint8Array(13 * Mo)]), s.fetchFn));
  assert.equal(s.recu(), 13 * Mo);
  assert.ok(s.appels.includes('HEAD '), 'décalage relu au serveur');
});

test('TUS : refus à la création → message clair', async () => {
  await assert.rejects(televerserTus(p(new Blob([new Uint8Array(10)]), serveur({ statutCreation: 403 }).fetchFn)), /session expirée ou dossier non autorisé/);
  await assert.rejects(televerserTus(p(new Blob([new Uint8Array(10)]), serveur({ statutCreation: 409 }).fetchFn)), /existe déjà/);
});
