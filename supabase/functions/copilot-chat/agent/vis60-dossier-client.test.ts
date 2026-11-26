// deno test --no-lock --no-check --node-modules-dir=none -A supabase/functions/copilot-chat/agent/vis60-dossier-client.test.ts
// =============================================================================
// VIS-60 — outil `studio_dossier_client` : Mimmo propose « Préparer le dossier client » quand tous les livrables sont
// prêts ; lecture seule bornée à l'utilisateur et à la conversation ; aucun débit ; aucun fournisseur tiers.
// =============================================================================
import * as na from 'node:assert/strict';
import {
  demandeDossierClient, depotDossierClientSupabase, executerOutilDossierClient, OUTIL_DOSSIER_CLIENT, OUTIL_DOSSIER_CLIENT_DEF,
  proposerDossierSpontanement, type DepotDossierClient,
} from './dossier-client.ts';
import type { TravailDossier } from '../../../../src/lib/studio/dossierClient/dossierClientLogique.ts';

const U = 'u1';
const image: TravailDossier = { id: 'i', type: 'image', statut: 'termine', cree_le: '2026-11-26T10:00:00Z', termine_le: '2026-11-26T10:30:00Z',
  resultat: { images: [{ vue: 'trois_quarts_gauche', libelle: '3/4 gauche', jpeg_path: `${U}/i/image.jpg` }], rapport_assets: { assets: [{ source: 'Poly Haven' }] } } };
const film: TravailDossier = { id: 'f', type: 'film', statut: 'termine', cree_le: '2026-11-26T20:00:00Z', termine_le: '2026-11-26T21:23:30Z', resultat: { video_path: `${U}/f/film.mp4`, duree_s: 27 } };
const enAttente: TravailDossier = { id: 'w', type: 'visite360', statut: 'en_attente', cree_le: '2026-11-26T22:00:00Z' };
const depot = (t: TravailDossier[], vu: { u?: string; c?: string } = {}): DepotDossierClient => ({ async travaux(u, c) { vu.u = u; vu.c = c; return t; } });

Deno.test('VIS-60 — définition : nom, modes, aucun paramètre requis', () => {
  na.equal(OUTIL_DOSSIER_CLIENT_DEF.name, OUTIL_DOSSIER_CLIENT);
  na.deepEqual(OUTIL_DOSSIER_CLIENT_DEF.available_in_modes, ['quick', 'advanced', 'report']);
  na.equal(OUTIL_DOSSIER_CLIENT_DEF.input_schema.required, undefined);
  na.doesNotMatch(OUTIL_DOSSIER_CLIENT_DEF.description, /blender\s*kit|poly\s*haven/i);
});

Deno.test('VIS-60 — tout est prêt : pret = vrai, bouton proposé, aucun débit, lecture bornée', async () => {
  const vu: { u?: string; c?: string } = {};
  const r = await executerOutilDossierClient({}, { userId: U, conversationId: 'conv', depot: depot([film, image], vu) });
  na.equal(r.status, 'ok');
  na.equal(r.data?.pret, true);
  na.equal(r.data?.debit_jetons, 0);
  na.equal(r.data?.film, true);
  na.equal(r.data?.images, 1);
  na.deepEqual([vu.u, vu.c], [U, 'conv']);
  na.match(r.message ?? '', /« Préparer le dossier client »/);
  na.match(r.message ?? '', /aucun jeton débité/);
  na.doesNotMatch(JSON.stringify(r), /poly\s*haven|blender\s*kit/i);
});

Deno.test('VIS-60 — un rendu encore en attente : pas « prêt », mais préparable', async () => {
  const r = await executerOutilDossierClient({}, { userId: U, conversationId: 'conv', depot: depot([enAttente, film, image]) });
  na.equal(r.data?.pret, false);
  na.equal(r.data?.preparable, true);
  na.equal(r.data?.rendus_en_cours, 1);
  na.match(r.message ?? '', /attendre la fin des rendus/);
});

Deno.test('VIS-60 — rien de terminé : ne pas proposer', async () => {
  const r = await executerOutilDossierClient({}, { userId: U, conversationId: 'conv', depot: depot([{ id: 'k', type: 'film', statut: 'echec', cree_le: '2026-11-26T10:00:00Z' }]) });
  na.equal(r.data?.preparable, false);
  na.match(r.message ?? '', /Ne propose pas le dossier/);
});

Deno.test('VIS-60 — erreurs : sans session, sans conversation, base illisible (rien préparé)', async () => {
  na.equal((await executerOutilDossierClient({}, { userId: null, conversationId: 'c', depot: depot([]) })).status, 'error');
  na.equal((await executerOutilDossierClient({}, { userId: U, conversationId: null, depot: depot([]) })).status, 'error');
  const r = await executerOutilDossierClient({}, { userId: U, conversationId: 'c', depot: { async travaux() { throw new Error('timeout'); } } });
  na.equal(r.status, 'error');
  na.match(r.message ?? '', /Rien n’a été préparé/);
});

Deno.test('VIS-60 — proposition spontanée : une seule fois par nouveau livrable', () => {
  na.equal(proposerDossierSpontanement([film, image], null), true);
  na.equal(proposerDossierSpontanement([film, image], '2026-11-26T21:30:00Z'), false);
  na.equal(proposerDossierSpontanement([film, image], '2026-11-26T21:00:00Z'), true);
  na.equal(proposerDossierSpontanement([enAttente, film, image], null), false);
});

Deno.test('VIS-60 — détection de la demande', () => {
  for (const t of ['Prépare-moi le dossier client', 'il me faut un dossier de présentation pour le promoteur', 'envoie-moi tous les livrables', 'une plaquette ?']) na.equal(demandeDossierClient(t), true, t);
  for (const t of ['fais-moi un film', 'quel est le PLU ?']) na.equal(demandeDossierClient(t), false, t);
});

Deno.test('VIS-60 — dépôt Supabase : filtre utilisateur ET conversation', async () => {
  const appels: string[] = [];
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: (c: string) => { appels.push(`select:${c}`); return q; },
    eq: (k: string, v: string) => { appels.push(`eq:${k}=${v}`); return q; },
    order: () => q,
    limit: async () => ({ data: [film], error: null }),
  });
  const t = await depotDossierClientSupabase({ from: (n: string) => { appels.push(`from:${n}`); return q; } }).travaux(U, 'conv');
  na.equal(t.length, 1);
  na.ok(appels.includes('from:studio_jobs') && appels.includes(`eq:user_id=${U}`) && appels.includes('eq:conversation_id=conv'));
});
