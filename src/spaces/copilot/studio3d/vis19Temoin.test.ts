// node --test src/spaces/copilot/studio3d/vis19Temoin.test.ts
// VIS-19 (20/11/2026) — corrections de la relecture VIS-18a, côté site : témoin accepté seulement pour la conversation
// courante (canal : même projet ; cadre : null toléré seulement pour le cadre de la conversation), témoin retiré →
// ligne studio_temoins supprimée, écriture refusée → « enregistré sur cet appareil seulement », tailles en octets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import {
  creerMessagePont, creerTemoin, lireMessagePont, octetsJson, TAILLE_MAX_TEMOIN_OCTETS, type TemoinPersonnalise,
} from '../../promoteur/shared/echangeStudio/pontParcoursStudio.ts';
import {
  etatTemoinConversation, lireEchecBase, lireTemoinLocal, lireTemoinPersonnalise, MENTION_APPAREIL_SEULEMENT, recevoirTemoinStudio,
  temoinPourConversation, type ClientTemoins,
} from './temoinStudio.ts';
import { calculerParcours, sourcesVides } from '../../../lib/studio/parcours.ts';

function temoin(maj: string, p: Record<string, unknown> = {}): TemoinPersonnalise {
  return creerTemoin({
    personnalise: true,
    logement: { cle: 'b1|N2|w0#L4', buildingId: 'b1', floorKey: 'N2', wingId: 'w0', logementId: 'L4', lot: 'A204', niveau: 'R+2', rangNiveau: 2, typologie: 'T3', surfaceM2: 64 },
    style: 'scandinave', gamme: 'standard', cible: 'famille', seed: 3, meubles: 18,
    finitions: [{ fonction: 'sejour', sol: 'av-parquet', murs: 'av-mur-peint-lin' }],
    modifications: { ajouts: 1, suppressions: 0, ajustements: 2, finitions: 1, planModifie: false },
    ...p,
  } as never, new Date(maj));
}

class Memoire { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } }

/** Faux client : une « table » en mémoire (upsert / select / delete), erreur d'écriture simulable. */
function fauxClient(o: { erreurEcriture?: string | null; erreurSuppression?: string | null } = {}) {
  const lignes = new Map<string, Record<string, unknown>>();
  const journal: string[] = [];
  const client: ClientTemoins = {
    from: (table: string) => ({
      upsert: (ligne: Record<string, unknown>) => {
        journal.push(`upsert ${table}`);
        if (o.erreurEcriture) return Promise.resolve({ error: { message: o.erreurEcriture } });
        lignes.set(String(ligne.conversation_id), { ...ligne, maj_le: (ligne.temoin as TemoinPersonnalise).majLe });
        return Promise.resolve({ error: null });
      },
      select: () => ({ eq: (_c: string, v: string) => ({ maybeSingle: () => Promise.resolve({ data: lignes.get(v) ?? null, error: null }) }) }),
      delete: () => ({ eq: (c: string, v: string) => {
        journal.push(`delete ${table} ${c}=${v}`);
        if (o.erreurSuppression) return Promise.resolve({ error: { message: o.erreurSuppression } });
        lignes.delete(v);
        return Promise.resolve({ error: null });
      } }),
    }),
  };
  return { client, lignes, journal };
}

test('témoin reçu : canal = même projet obligatoire (onglet Studio non relié, autre projet → refusés)', () => {
  const attendu = 'mzchat-c1';
  // Onglet Studio NON relié (projetId null) par le BroadcastChannel : refusé, même si un cadre existe.
  assert.deepEqual(temoinPourConversation({ via: 'canal', projetIdCharge: null, projetIdAttendu: attendu, cadreDeLaConversation: true }), { accepte: false, retirer: false });
  // Autre projet : refusé (canal et cadre).
  assert.equal(temoinPourConversation({ via: 'canal', projetIdCharge: 'mzchat-c2', projetIdAttendu: attendu, cadreDeLaConversation: false }).accepte, false);
  assert.equal(temoinPourConversation({ via: 'cadre', projetIdCharge: 'mzchat-c2', projetIdAttendu: attendu, cadreDeLaConversation: true }).accepte, false);
  // Même projet : accepté.
  assert.deepEqual(temoinPourConversation({ via: 'canal', projetIdCharge: attendu, projetIdAttendu: attendu, cadreDeLaConversation: false }), { accepte: true, retirer: false });
  // Aucune conversation courante : rien.
  assert.equal(temoinPourConversation({ via: 'cadre', projetIdCharge: null, projetIdAttendu: null, cadreDeLaConversation: true }).accepte, false);
});

test('témoin reçu : iframe de la conversation courante → null toléré ; iframe d’une autre conversation → refusé', () => {
  const attendu = 'mzchat-c1';
  assert.deepEqual(temoinPourConversation({ via: 'cadre', projetIdCharge: null, projetIdAttendu: attendu, cadreDeLaConversation: true }), { accepte: true, retirer: false });
  assert.equal(temoinPourConversation({ via: 'cadre', projetIdCharge: null, projetIdAttendu: attendu, cadreDeLaConversation: false }).accepte, false);
  // `retire` : seulement d'un Studio RELIÉ à ce projet (jamais d'un Studio non relié, même dans le cadre).
  assert.equal(temoinPourConversation({ via: 'cadre', projetIdCharge: null, projetIdAttendu: attendu, cadreDeLaConversation: true, retire: true }).retirer, false);
  assert.equal(temoinPourConversation({ via: 'cadre', projetIdCharge: attendu, projetIdAttendu: attendu, cadreDeLaConversation: true, retire: true }).retirer, true);
  assert.equal(temoinPourConversation({ via: 'canal', projetIdCharge: attendu, projetIdAttendu: attendu, cadreDeLaConversation: false, retire: true }).retirer, true);
});

test('protocole : `retire` transmis seulement avec un témoin nul ou non personnalisé', () => {
  const lu = (charge: unknown) => lireMessagePont({ type: 'mimmoza-parcours-studio', version: 1, canal: 'temoin.etat', charge });
  const r1 = lu({ projetId: 'mzchat-c1', temoin: null, retire: true });
  assert.equal(r1.ok && r1.message.canal === 'temoin.etat' && r1.message.charge.retire, true);
  const r2 = lu({ projetId: 'mzchat-c1', temoin: JSON.parse(JSON.stringify(temoin('2026-11-20T10:00:00Z'))), retire: true });
  assert.equal(r2.ok && r2.message.canal === 'temoin.etat' && 'retire' in r2.message.charge, false);
  const r3 = lu({ projetId: 'mzchat-c1', temoin: null });
  assert.equal(r3.ok && r3.message.canal === 'temoin.etat' && 'retire' in r3.message.charge, false);
  // Aller-retour par creerMessagePont.
  const m = creerMessagePont('temoin.etat', { projetId: 'mzchat-c1', temoin: null, retire: true });
  const r4 = lireMessagePont(JSON.parse(JSON.stringify(m)));
  assert.equal(r4.ok && r4.message.canal === 'temoin.etat' && r4.message.charge.retire, true);
});

test('témoin retiré par le Studio relié → ligne studio_temoins supprimée, parcours plus « fait » ; sans `retire` → base gardée', async () => {
  const st = new Memoire();
  const f = fauxClient();
  const t = temoin('2026-11-20T10:00:00Z');
  await recevoirTemoinStudio(f.client, 'u1', 'c1', 'mzchat-c1', t, st);
  assert.equal(f.lignes.has('c1'), true);
  assert.equal((await etatTemoinConversation(f.client, 'u1', 'c1', st)).fait, true);
  // Studio qui démarre / autre appareil : null SANS retire → copie locale effacée, base GARDÉE.
  const r0 = await recevoirTemoinStudio(f.client, 'u1', 'c1', 'mzchat-c1', null, st, false);
  assert.equal(r0.base, null);
  assert.equal(f.lignes.has('c1'), true);
  assert.equal((await etatTemoinConversation(f.client, 'u1', 'c1', st)).fait, true);
  // Retrait par le Studio relié : suppression (RLS : la ligne de l'utilisateur), plus « fait ».
  const r1 = await recevoirTemoinStudio(f.client, 'u1', 'c1', 'mzchat-c1', null, st, true);
  assert.deepEqual(r1.base, { ok: true, erreur: null });
  assert.deepEqual(f.journal.filter((j) => j.startsWith('delete')), ['delete studio_temoins conversation_id=c1']);
  assert.equal(f.lignes.has('c1'), false);
  assert.equal((await etatTemoinConversation(f.client, 'u1', 'c1', st)).fait, false);
  // Témoin NON personnalisé avec retire : même effet.
  await recevoirTemoinStudio(f.client, 'u1', 'c1b', 'mzchat-c1b', t, st);
  await recevoirTemoinStudio(f.client, 'u1', 'c1b', 'mzchat-c1b', temoin('2026-11-20T11:00:00Z', { personnalise: false }), st, true);
  assert.equal(f.lignes.has('c1b'), false);
  // Retirer → re-personnaliser (même empreinte qu'avant) → réécrit en base.
  await recevoirTemoinStudio(f.client, 'u1', 'c1', 'mzchat-c1', t, st);
  assert.equal(f.lignes.has('c1'), true);
});

test('écriture refusée → étape « Intérieurs » : « enregistré sur cet appareil seulement » ; écriture réussie ensuite → mention retirée', async () => {
  const st = new Memoire();
  const t = temoin('2026-11-20T10:00:00Z');
  const ko = fauxClient({ erreurEcriture: 'new row violates check constraint' });
  const r = await recevoirTemoinStudio(ko.client, 'u1', 'c3', 'mzchat-c3', t, st);
  assert.equal(r.base?.ok, false);
  assert.equal(lireEchecBase('u1', 'c3', st), t.empreinte);
  const e = await etatTemoinConversation(ko.client, 'u1', 'c3', st);
  assert.equal(e.fait, true);
  assert.equal(e.appareilSeulement, true);
  assert.match(e.resume ?? '', new RegExp(MENTION_APPAREIL_SEULEMENT));
  // Lecture synchrone du parcours (copie locale + échec) : même mention.
  assert.equal(lireTemoinPersonnalise({ local: lireTemoinLocal('u1', 'c3', st), echecBase: lireEchecBase('u1', 'c3', st) }).appareilSeulement, true);
  const etape = calculerParcours({ ...sourcesVides('image'), temoinStudio: e }).etapes.find((x) => x.cle === 'interieurs')!;
  assert.equal(etape.statut, 'fait');
  assert.match(etape.resume, /enregistré sur cet appareil seulement/);
  // Un témoin DIFFÉRENT (autre empreinte) n'hérite pas de la mention.
  assert.equal(lireTemoinPersonnalise({ local: temoin('2026-11-20T12:00:00Z', { meubles: 3 }), echecBase: t.empreinte }).appareilSeulement, undefined);
  // Base revenue : réécriture, mention retirée.
  const ok = fauxClient();
  await recevoirTemoinStudio(ok.client, 'u1', 'c3', 'mzchat-c3', t, st);
  assert.equal(lireEchecBase('u1', 'c3', st), null);
  const e2 = await etatTemoinConversation(ok.client, 'u1', 'c3', st);
  assert.equal(e2.appareilSeulement, undefined);
  assert.doesNotMatch(e2.resume ?? '', /appareil/);
});

test('tailles en octets : réglage accentué retiré ; témoin borné à 90 000 octets ; copie du pont identique au Studio', () => {
  const gros = { texte: 'é'.repeat(40_000) }; // 40 000 caractères, ~80 000 octets
  const t = creerTemoin({ ...(temoin('2026-11-20T10:00:00Z') as never as Record<string, unknown>), reglage: gros } as never);
  assert.ok(t.reglage === undefined);
  assert.ok(octetsJson(t) <= TAILLE_MAX_TEMOIN_OCTETS);
  const ici = new URL('../../promoteur/shared/echangeStudio/pontParcoursStudio.ts', import.meta.url);
  const studio = new URL('../../../../../mimmozia-studio/src/core/echange/pontParcoursStudio.ts', import.meta.url);
  if (existsSync(studio)) {
    const h = (u: URL) => createHash('sha256').update(readFileSync(u)).digest('hex');
    assert.equal(h(ici), h(studio), 'les deux copies de pontParcoursStudio.ts doivent être identiques');
  }
});
