// node --test src/spaces/copilot/studio3d/vis18aPontParcours.test.ts
// VIS-18a (20/11/2026) — pont « parcours ↔ Studio », côté site : origines, versions, étapes inconnues, accusés,
// table de correspondance des étapes du parcours, logement témoin personnalisé (lecture pure, copie locale, base).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  cibleStudioDe, creerMessagePont, creerTemoin, examinerMessagePont, lireMessagePont, messageAccuse, SOUS_ONGLETS_STUDIO,
  type TemoinPersonnalise,
} from '../../promoteur/shared/echangeStudio/pontParcoursStudio.ts';
import { accuseAttendu, ouvrirEtapeStudio } from './pontParcoursSite.ts';
import {
  cleTemoinLocal, enregistrerTemoinBase, lireTemoinLocal, lireTemoinPersonnalise, memoriserTemoinLocal, recevoirTemoinStudio, type ClientTemoins,
} from './temoinStudio.ts';
import { calculerParcours, sourcesVides, TYPES_PARCOURS } from '../../../lib/studio/parcours.ts';

const STUDIO = 'https://mimmoza.fr';

function temoin(maj: string, p: Partial<Parameters<typeof creerTemoin>[0]> = {}): TemoinPersonnalise {
  return creerTemoin({
    personnalise: true,
    logement: { cle: 'b1|N2|w0#L4', buildingId: 'b1', floorKey: 'N2', wingId: 'w0', logementId: 'L4', lot: 'A204', niveau: 'R+2', rangNiveau: 2, typologie: 'T3', surfaceM2: 64 },
    style: 'scandinave', gamme: 'standard', cible: 'famille', seed: 3, meubles: 18,
    finitions: [{ fonction: 'sejour', sol: 'av-parquet', murs: 'av-mur-peint-lin' }],
    modifications: { ajouts: 1, suppressions: 0, ajustements: 2, finitions: 1, planModifie: false },
    ...p,
  }, new Date(maj));
}

class Memoire { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } }

test('copie du protocole : fichier identique attendu côté Studio (en-tête de copie présent)', () => {
  const src = readFileSync(new URL('../../promoteur/shared/echangeStudio/pontParcoursStudio.ts', import.meta.url), 'utf8');
  assert.match(src, /COPIE IDENTIQUE dans les deux dépôts/);
  assert.doesNotMatch(src, /^import /m, 'aucun import : le fichier se compile seul des deux côtés');
});

test('chaque étape du parcours (images, film, visite) a sa place dans le Studio', () => {
  for (const type of TYPES_PARCOURS) {
    for (const e of calculerParcours(sourcesVides(type)).etapes) {
      const c = cibleStudioDe(e.cle, type);
      assert.ok(c, `${type}/${e.cle}`);
      assert.ok((SOUS_ONGLETS_STUDIO[c.etape] as readonly string[]).includes(c.sousOnglet), `${type}/${e.cle}`);
    }
  }
  assert.deepEqual(cibleStudioDe('style'), { etape: 'batiment', sousOnglet: 'style', libelle: 'Bâtiment → Style' });
  assert.equal(cibleStudioDe('interieurs')?.sousOnglet, 'interieur');
  assert.equal(cibleStudioDe('n-importe-quoi'), null);
});

test('accusé : accepté seulement de la fenêtre visée, à son origine, pour cette requête', () => {
  const fenetre = {};
  const bon = { origin: STUDIO, source: fenetre, data: creerMessagePont('etape.accuse', { requeteId: 'req-abcdef', statut: 'ok', libelle: 'Bâtiment → Style', message: '' }) };
  const attendu = { origine: STUDIO, source: fenetre, requeteId: 'req-abcdef' };
  assert.equal(accuseAttendu(bon, attendu)?.statut, 'ok');
  assert.equal(accuseAttendu({ ...bon, origin: 'https://pirate.example' }, attendu), null);
  assert.equal(accuseAttendu({ ...bon, source: {} }, attendu), null);
  assert.equal(accuseAttendu(bon, { ...attendu, requeteId: 'req-autre1' }), null);
  assert.equal(accuseAttendu({ ...bon, data: { ...bon.data, version: 2 } }, attendu), null);
});

test('origine inconnue ignorée ; version future refusée avec accusé ; étape absente refusée', () => {
  const m = { type: 'mimmoza-parcours-studio', version: 1, canal: 'etape.ouvrir', charge: { requeteId: 'req-123456', cle: 'style' } };
  assert.equal(examinerMessagePont({ origin: 'https://pirate.example', data: m }, [], STUDIO).type, 'ignore');
  assert.equal(examinerMessagePont({ origin: '*', data: m }, ['*'], STUDIO).type, 'ignore');
  assert.equal(examinerMessagePont({ origin: STUDIO, data: m }, [], STUDIO).type, 'message');
  assert.deepEqual(examinerMessagePont({ origin: STUDIO, data: { ...m, version: 3 } }, [], STUDIO), {
    type: 'refus', requeteId: 'req-123456', statut: 'version', raison: 'version 3 non prise en charge (max 1) : mettre à jour le Studio',
  });
  assert.equal(lireMessagePont({ ...m, charge: { requeteId: 'req-123456' } }).ok, false);
  assert.match(messageAccuse({ requeteId: 'r', statut: 'etape-inconnue', message: '' }), /n’existe pas/);
  assert.match(messageAccuse({ requeteId: 'r', statut: 'version', message: '' }), /autre version/);
  assert.match(messageAccuse({ requeteId: 'r', statut: 'ok', libelle: 'Aménagement → Intérieur', message: '' }, true), /autre onglet/);
});

/** Faux Studio : reçoit postMessage(m, origine) et répond par l'écoute fournie. */
function fauxStudio(reponse: (m: any) => unknown | null) {
  const ecouteurs = new Set<(e: { origin: string; data: unknown; source: unknown }) => void>();
  const envois: { m: any; o: string }[] = [];
  const fenetre = {
    postMessage(m: any, o: string) {
      envois.push({ m, o });
      const r = reponse(m);
      if (r) setTimeout(() => { for (const f of ecouteurs) f({ origin: STUDIO, data: r, source: fenetre }); }, 5);
    },
  };
  return { fenetre: fenetre as unknown as Window, envois, ecoute: { ajouter: (f: any) => { ecouteurs.add(f); return () => ecouteurs.delete(f); } } };
}

test('ouvrirEtapeStudio : cadre → étape envoyée à l’origine exacte, accusé ok', async () => {
  const s = fauxStudio((m) => creerMessagePont('etape.accuse', { requeteId: m.charge.requeteId, statut: 'ok', etapeStudio: 'batiment', sousOnglet: 'style', libelle: 'Bâtiment → Style', message: '' }));
  const issue = await ouvrirEtapeStudio({ cle: 'style', type: 'image' }, { cadre: { fenetre: s.fenetre, origine: STUDIO }, projetId: 'mzchat-c1', ecouteFenetre: s.ecoute, canal: null, delaiMs: 200 });
  assert.equal(issue.etat, 'ok');
  assert.equal(issue.ou, 'cadre');
  assert.equal(issue.message, 'Le Studio est passé sur l’étape « Bâtiment → Style ».');
  assert.equal(s.envois[0]!.o, STUDIO);
  assert.deepEqual(s.envois[0]!.m.charge, { requeteId: s.envois[0]!.m.charge.requeteId, cle: 'style', type: 'image', projetId: 'mzchat-c1' });
});

test('ouvrirEtapeStudio : étape inconnue → refus dit ; Studio muet → absent (repli de l’appelant)', async () => {
  const inconnu = fauxStudio((m) => creerMessagePont('etape.accuse', { requeteId: m.charge.requeteId, statut: 'etape-inconnue', message: 'x' }));
  const r1 = await ouvrirEtapeStudio({ cle: 'zzz' }, { cadre: { fenetre: inconnu.fenetre, origine: STUDIO }, projetId: null, ecouteFenetre: inconnu.ecoute, canal: null, delaiMs: 200 });
  assert.equal(r1.etat, 'refus');
  assert.match(r1.message, /n’existe pas/);
  const muet = fauxStudio(() => null);
  const r2 = await ouvrirEtapeStudio({ cle: 'style' }, { cadre: { fenetre: muet.fenetre, origine: STUDIO }, projetId: 'mzchat-c1', ecouteFenetre: muet.ecoute, canal: null, delaiMs: 50 });
  assert.deepEqual(r2, { etat: 'absent', ou: null, accuse: null, message: '' });
  const r3 = await ouvrirEtapeStudio({ cle: 'style' }, { cadre: null, projetId: null, canal: null });
  assert.equal(r3.etat, 'absent');
});

test('ouvrirEtapeStudio : autre onglet (diffusion) → accusé du bon projet', async () => {
  const ecouteurs = new Set<any>();
  const envoyes: any[] = [];
  const canal = {
    postMessage(m: any) {
      envoyes.push(m);
      setTimeout(() => { for (const f of ecouteurs) f({ origin: STUDIO, source: 'diffusion', data: creerMessagePont('etape.accuse', { requeteId: m.charge.requeteId, statut: 'ok', libelle: 'Aménagement → Intérieur', message: '' }) }); }, 5);
    },
    ecoute: { ajouter: (f: any) => { ecouteurs.add(f); return () => ecouteurs.delete(f); } },
  };
  const r = await ouvrirEtapeStudio({ etapeStudio: 'amenagement', sousOnglet: 'interieur' }, { cadre: null, projetId: 'mzchat-c1', canal, delaiMs: 200 });
  assert.equal(r.etat, 'ok');
  assert.equal(r.ou, 'onglet');
  assert.match(r.message, /autre onglet/);
  assert.equal(envoyes[0].charge.projetId, 'mzchat-c1');
});

test('lireTemoinPersonnalise (pure) : base, local, le plus récent ; non personnalisé ≠ fait', () => {
  const ancien = temoin('2026-11-20T09:00:00Z');
  const recent = temoin('2026-11-20T10:00:00Z', { meubles: 20 });
  assert.deepEqual(lireTemoinPersonnalise(null), { fait: false, resume: null, temoin: null, source: null });
  const e = lireTemoinPersonnalise({ ligneBase: { temoin: ancien, maj_le: 'x' }, local: JSON.parse(JSON.stringify(recent)) });
  assert.equal(e.fait, true);
  assert.equal(e.source, 'local');
  assert.equal(e.resume, 'T3 A204 · séjour scandinave · parquet · 20 meubles');
  assert.equal(lireTemoinPersonnalise({ ligneBase: { temoin: recent }, local: ancien }).source, 'base');
  assert.equal(lireTemoinPersonnalise({ local: { ...ancien, personnalise: false } }).fait, false);
  assert.equal(lireTemoinPersonnalise({ local: { format: 'autre' } }).fait, false);
});

test('copie locale scopée utilisateur + conversation ; clés refusées si caractères douteux', () => {
  const st = new Memoire();
  assert.equal(cleTemoinLocal('u1', 'c1'), 'mimmoza.temoin.u1.c1');
  assert.equal(cleTemoinLocal('u1', '../c1'), null);
  const t = temoin('2026-11-20T10:00:00Z');
  assert.equal(memoriserTemoinLocal('u1', 'c1', t, st), true);
  assert.deepEqual(lireTemoinLocal('u1', 'c1', st), JSON.parse(JSON.stringify(t)));
  assert.equal(lireTemoinLocal('u2', 'c1', st), null);
});

function fauxClient(erreur: string | null = null) {
  const ecrits: any[] = [];
  const client: ClientTemoins = {
    from: (table: string) => ({
      upsert: (ligne: Record<string, unknown>, o: { onConflict: string }) => { ecrits.push({ table, ligne, o }); return Promise.resolve({ error: erreur ? { message: erreur } : null }); },
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
    }),
  };
  return { client, ecrits };
}

test('base : upsert studio_temoins (conversation, projet, résumé, empreinte) ; une seule écriture par empreinte ; table absente tolérée', async () => {
  const t = temoin('2026-11-20T10:00:00Z');
  const { client, ecrits } = fauxClient();
  assert.deepEqual(await enregistrerTemoinBase(client, 'c1', 'mzchat-c1', t), { ok: true, erreur: null });
  assert.equal(ecrits[0].table, 'studio_temoins');
  assert.equal(ecrits[0].o.onConflict, 'user_id,conversation_id');
  assert.deepEqual({ ...ecrits[0].ligne, temoin: undefined }, { conversation_id: 'c1', projet_id: 'mzchat-c1', temoin: undefined, resume: t.resume, empreinte: t.empreinte });
  const st = new Memoire();
  const f = fauxClient();
  const r1 = await recevoirTemoinStudio(f.client, 'u1', 'c2', 'mzchat-c2', t, st);
  const r2 = await recevoirTemoinStudio(f.client, 'u1', 'c2', 'mzchat-c2', t, st);
  assert.deepEqual(r1, { local: true, base: { ok: true, erreur: null } });
  assert.deepEqual(r2, { local: true, base: null });
  assert.equal(f.ecrits.length, 1);
  const absente = fauxClient('relation "public.studio_temoins" does not exist');
  const r3 = await recevoirTemoinStudio(absente.client, 'u1', 'c3', null, t, st);
  assert.equal(r3.local, true);
  assert.equal(r3.base?.ok, false);
  assert.equal(lireTemoinPersonnalise({ local: lireTemoinLocal('u1', 'c3', st) }).fait, true);
});
