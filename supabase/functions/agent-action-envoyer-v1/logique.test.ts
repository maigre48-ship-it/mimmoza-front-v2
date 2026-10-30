// deno test --allow-env --allow-read supabase/functions/agent-action-envoyer-v1/logique.test.ts
// Aucun envoi réel : e-mail et Gmail sont simulés, le stockage est en mémoire.
import * as na from 'node:assert/strict';
const assert = (v: unknown, msg?: string) => na.ok(v, msg);
const assertEquals = (a: unknown, b: unknown) => na.deepStrictEqual(a, b);
const assertThrows = (f: () => unknown) => na.throws(f);
const assertRejects = (f: () => Promise<unknown>, _e: unknown, msg: string) => na.rejects(f, (e: Error) => e.message.includes(msg));

import {
  construireMime,
  emailValide,
  EnvoiIncertain,
  envoyerViaGmail,
  lienMailto,
  traiterEnvoi,
  verrouActif,
  type ActionExterne,
  type BoiteMail,
  type DepotActions,
} from './logique.ts';
import { genererCourrierPdf } from './pdf.ts';
import { PDFDocument } from 'npm:pdf-lib@1.17.1';

const UID = 'aaaaaaaa-0000-0000-0000-000000000001';
const AID = 'bbbbbbbb-0000-0000-0000-000000000002';
const NOW = new Date('2026-10-31T09:00:00Z');

class FauxDepot implements DepotActions {
  fichiers = new Map<string, Uint8Array>();
  verrous = 0;
  constructor(public a: ActionExterne | null, public boite: BoiteMail | null = null, public nom: string | null = 'Albé Martin') {}
  utilisateurDepuisJwt(jwt: string) { return Promise.resolve(jwt === 'jwt-ok' ? UID : jwt === 'jwt-autre' ? 'cccccccc-0000-0000-0000-000000000003' : null); }
  lireAction(id: string, userId: string) { return Promise.resolve(this.a && this.a.id === id && this.a.user_id === userId ? { ...this.a } : null); }
  poserVerrou(_id: string, ancien: string | null, nouveau: string) {
    if (!this.a || this.a.statut !== 'valide' || this.a.erreur !== ancien) return Promise.resolve(false);
    this.a.erreur = nouveau; this.verrous++; return Promise.resolve(true);
  }
  marquerIncertain(_id: string, v: string, m: string) { if (this.a && this.a.statut === 'valide' && this.a.erreur === v) this.a.erreur = m; return Promise.resolve(); }
  libererVerrou(_id: string, v: string) { if (this.a && this.a.erreur === v) this.a.erreur = null; return Promise.resolve(); }
  marquerEnvoye() {
    if (!this.a || this.a.statut !== 'valide') return Promise.resolve(false);
    this.a.statut = 'envoye'; this.a.erreur = null; return Promise.resolve(true);
  }
  marquerEchec(_id: string, e: string) { if (this.a?.statut === 'valide') { this.a.statut = 'echec'; this.a.erreur = e; } return Promise.resolve(); }
  nomExpediteur() { return Promise.resolve(this.nom); }
  boiteMail() { return Promise.resolve(this.boite); }
  deposerPdf(chemin: string, o: Uint8Array) { this.fichiers.set(chemin, o); return Promise.resolve(); }
  urlSignee(chemin: string, s: number) { return Promise.resolve(this.fichiers.has(chemin) ? `https://stockage.test/${chemin}?exp=${s}` : null); }
}

function action(x: Partial<ActionExterne> = {}): ActionExterne {
  return { id: AID, user_id: UID, canal: 'email', destinataire: { nom: 'Mairie de Lyon', qualite: 'mairie', email: 'urbanisme@mairie-lyon.fr' },
    objet: 'Demande de renseignements', corps: 'Madame, Monsieur,\n\nJe vous écris au sujet de la parcelle AB 12.\n\nCordialement.',
    pieces: [], statut: 'valide', erreur: null, ...x };
}

const req = (jwt: string | null, corps: unknown = { action_id: AID }) => new Request('http://local/agent-action-envoyer-v1', {
  method: 'POST', headers: jwt ? { Authorization: `Bearer ${jwt}` } : {}, body: JSON.stringify(corps),
});

function deps(depot: FauxDepot, envois: unknown[] = []) {
  return {
    depot,
    envoyerEmail: (_b: BoiteMail, m: unknown) => { envois.push(m); return Promise.resolve({ id: 'msg-1' }); },
    genererPdf: genererCourrierPdf,
    maintenant: () => NOW,
  };
}

Deno.test('authentification et propriété', async () => {
  const d = new FauxDepot(action());
  assertEquals((await traiterEnvoi(req(null), deps(d))).status, 401);
  assertEquals((await traiterEnvoi(req('jwt-ok', { action_id: 'x' }), deps(d))).status, 400);
  assertEquals((await traiterEnvoi(req('jwt-autre'), deps(d))).status, 404); // action d'un autre utilisateur
});

Deno.test('seul le statut valide part', async () => {
  for (const statut of ['brouillon', 'refuse', 'echec'] as const) {
    const envois: unknown[] = [];
    const r = await traiterEnvoi(req('jwt-ok'), deps(new FauxDepot(action({ statut }), { fournisseur: 'google', adresse: 'moi@ex.fr', accessToken: 't' }), envois));
    assertEquals(r.status, 409);
    assertEquals((await r.json()).raison, 'non_valide');
    assertEquals(envois.length, 0);
  }
});

Deno.test('e-mail sans boîte connectée → boite_non_connectee + repli, statut inchangé, verrou libéré', async () => {
  const d = new FauxDepot(action());
  const r = await traiterEnvoi(req('jwt-ok'), deps(d));
  assertEquals(r.status, 200);
  const j = await r.json();
  assertEquals(j.ok, false);
  assertEquals(j.raison, 'boite_non_connectee');
  assert(j.repli.mailto.startsWith('mailto:urbanisme%40mairie-lyon.fr?subject=Demande%20de%20renseignements'));
  assertEquals(d.a!.statut, 'valide');
  assertEquals(d.a!.erreur, null);
});

Deno.test('e-mail avec boîte : un seul envoi, puis idempotent (jamais deux fois)', async () => {
  const envois: unknown[] = [];
  const d = new FauxDepot(action(), { fournisseur: 'google', adresse: 'moi@ex.fr', accessToken: 't' });
  const r = await traiterEnvoi(req('jwt-ok'), deps(d, envois));
  assertEquals((await r.json()).ok, true);
  assertEquals(d.a!.statut, 'envoye');
  const r2 = await traiterEnvoi(req('jwt-ok'), deps(d, envois));
  assertEquals((await r2.json()).deja_envoye, true);
  assertEquals(envois.length, 1);
});

Deno.test('envoi concurrent : verrou frais → 409, verrou périmé → repris', async () => {
  const envois: unknown[] = [];
  const frais = new FauxDepot(action({ erreur: `envoi_en_cours:${new Date(NOW.getTime() - 60_000).toISOString()}` }), { fournisseur: 'google', adresse: 'moi@ex.fr', accessToken: 't' });
  const r = await traiterEnvoi(req('jwt-ok'), deps(frais, envois));
  assertEquals(r.status, 409);
  assertEquals(envois.length, 0);
  const perime = new FauxDepot(action({ erreur: `envoi_en_cours:${new Date(NOW.getTime() - 600_000).toISOString()}` }), { fournisseur: 'google', adresse: 'moi@ex.fr', accessToken: 't' });
  assertEquals((await (await traiterEnvoi(req('jwt-ok'), deps(perime, envois))).json()).ok, true);
  assertEquals(envois.length, 1);
  assert(!verrouActif(null, NOW));
  assert(!verrouActif('autre erreur', NOW));
});

Deno.test('échec d\'envoi → statut echec avec message', async () => {
  const d = new FauxDepot(action(), { fournisseur: 'google', adresse: 'moi@ex.fr', accessToken: 't' });
  const r = await traiterEnvoi(req('jwt-ok'), { ...deps(d), envoyerEmail: () => Promise.reject(new Error('Gmail 401 : jeton révoqué')) });
  assertEquals(r.status, 502);
  assertEquals(d.a!.statut, 'echec');
  assertEquals(d.a!.erreur, 'Gmail 401 : jeton révoqué');
});

Deno.test('destinataire e-mail invalide → 422, rien n\'est envoyé', async () => {
  const d = new FauxDepot(action({ destinataire: { nom: 'X', email: 'pas-une-adresse' } }), { fournisseur: 'google', adresse: 'moi@ex.fr', accessToken: 't' });
  assertEquals((await traiterEnvoi(req('jwt-ok'), deps(d))).status, 422);
  assertEquals(d.a!.statut, 'valide');
  assertEquals(d.a!.erreur, null);
});

Deno.test('courrier : PDF A4 déposé à <user>/<action>.pdf, URL signée, idempotent', async () => {
  const d = new FauxDepot(action({ canal: 'courrier', destinataire: { nom: 'M. Jean Dupont', qualite: 'proprietaire', adresse: '12 rue des Lilas\n69003 Lyon' },
    corps: 'Monsieur,\n\n' + 'Je me permets de vous contacter au sujet de votre terrain situé à Lyon (parcelle AB 12) — « projet » à 1 000 € près → ok. '.repeat(40) + '\n\nBien cordialement.' }));
  const r = await traiterEnvoi(req('jwt-ok'), deps(d));
  const j = await r.json();
  assertEquals(j.ok, true);
  assertEquals(j.chemin, `${UID}/${AID}.pdf`);
  assert(j.url.includes(`${UID}/${AID}.pdf`));
  assertEquals(d.a!.statut, 'envoye');
  const pdf = await PDFDocument.load(d.fichiers.get(j.chemin)!);
  assert(pdf.getPageCount() >= 2);
  assertEquals(Math.round(pdf.getPage(0).getWidth()), 595);
  const r2 = await (await traiterEnvoi(req('jwt-ok'), deps(d))).json();
  assertEquals(r2.deja_envoye, true);
  assert(r2.url.includes(`${AID}.pdf`));
});

Deno.test('courrier sans nom d\'expéditeur → 422 profil_incomplet, statut inchangé', async () => {
  const d = new FauxDepot(action({ canal: 'courrier', destinataire: { nom: 'Mairie', adresse: '1 place' } }), null, null);
  const r = await traiterEnvoi(req('jwt-ok'), deps(d));
  assertEquals(r.status, 422);
  assertEquals((await r.json()).raison, 'profil_incomplet');
  assertEquals(d.a!.statut, 'valide');
});

Deno.test('MIME Gmail : objet encodé, pas d\'injection d\'en-tête', async () => {
  const mime = construireMime('moi@ex.fr', 'toi@ex.fr', 'Objet accentué\r\nBcc: pirate@ex.fr', 'Corps é');
  assert(!/\r\nBcc:/i.test(mime));
  assert(mime.includes('Subject: =?UTF-8?B?'));
  assertThrows(() => construireMime('moi@ex.fr', 'a@b.fr\r\nBcc: x@y.fr', 'o', 'c'));
  let appel: { url: string; body: string } | null = null;
  const fauxFetch = ((url: string, init: RequestInit) => { appel = { url, body: String(init.body) }; return Promise.resolve(new Response(JSON.stringify({ id: 'g1' }), { status: 200 })); }) as unknown as typeof fetch;
  assertEquals((await envoyerViaGmail({ fournisseur: 'google', adresse: 'moi@ex.fr', accessToken: 't' }, { a: 'toi@ex.fr', objet: 'o', corps: 'c' }, fauxFetch)).id, 'g1');
  assertEquals(appel!.url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
  const refus = (() => Promise.resolve(new Response(JSON.stringify({ error: { message: 'Insufficient Permission' } }), { status: 403 }))) as unknown as typeof fetch;
  await assertRejects(() => envoyerViaGmail({ fournisseur: 'google', adresse: 'moi@ex.fr', accessToken: 't' }, { a: 'toi@ex.fr', objet: 'o', corps: 'c' }, refus), Error, 'Gmail 403');
  assert(emailValide('a.b@mairie-lyon.fr'));
  assert(!emailValide('a@b'));
  assert(lienMailto('a@b.fr', 'é', 'x y').includes('subject=%C3%A9'));
});

Deno.test('résultat inconnu (coupure, 5xx) : ni echec ni renvoi possible, message clair', async () => {
  const envois: unknown[] = [];
  const d = new FauxDepot(action(), { fournisseur: 'google', adresse: 'moi@ex.fr', accessToken: 't' });
  const r = await traiterEnvoi(req('jwt-ok'), { ...deps(d), envoyerEmail: () => Promise.reject(new EnvoiIncertain('Gmail injoignable : délai dépassé')) });
  assertEquals(r.status, 502);
  const j = await r.json();
  assertEquals(j.raison, 'resultat_inconnu');
  assert(j.message.includes('Envoyés'));
  assertEquals(d.a!.statut, 'valide');
  assert(d.a!.erreur!.startsWith('envoi_incertain:'));
  // Même 1 heure plus tard, aucun renvoi automatique.
  const plusTard = { ...deps(d, envois), maintenant: () => new Date(NOW.getTime() + 3600_000) };
  const r2 = await traiterEnvoi(req('jwt-ok'), plusTard);
  assertEquals(r2.status, 409);
  assertEquals((await r2.json()).raison, 'resultat_inconnu');
  assertEquals(envois.length, 0);
});

Deno.test('parti mais statut non enregistré : bloqué comme incertain', async () => {
  const envois: unknown[] = [];
  const d = new FauxDepot(action(), { fournisseur: 'google', adresse: 'moi@ex.fr', accessToken: 't' });
  d.marquerEnvoye = () => Promise.reject(new Error('base indisponible'));
  assertEquals((await (await traiterEnvoi(req('jwt-ok'), deps(d, envois))).json()).ok, true);
  assert(d.a!.erreur!.startsWith('envoi_incertain:'));
  const r2 = await traiterEnvoi(req('jwt-ok'), { ...deps(d, envois), maintenant: () => new Date(NOW.getTime() + 3600_000) });
  assertEquals((await r2.json()).raison, 'resultat_inconnu');
  assertEquals(envois.length, 1);
});

Deno.test('Gmail : coupure réseau et 5xx → EnvoiIncertain ; 4xx → échec certain', async () => {
  const b: BoiteMail = { fournisseur: 'google', adresse: 'moi@ex.fr', accessToken: 't' };
  const m = { a: 'toi@ex.fr', objet: 'o', corps: 'c' };
  const coupure = (() => Promise.reject(new TypeError('connection reset'))) as unknown as typeof fetch;
  await na.rejects(() => envoyerViaGmail(b, m, coupure), (e: Error) => e instanceof EnvoiIncertain);
  const s503 = (() => Promise.resolve(new Response('oops', { status: 503 }))) as unknown as typeof fetch;
  await na.rejects(() => envoyerViaGmail(b, m, s503), (e: Error) => e instanceof EnvoiIncertain);
  const s400 = (() => Promise.resolve(new Response('{}', { status: 400 }))) as unknown as typeof fetch;
  await na.rejects(() => envoyerViaGmail(b, m, s400), (e: Error) => !(e instanceof EnvoiIncertain) && e.message.includes('Gmail 400'));
});
