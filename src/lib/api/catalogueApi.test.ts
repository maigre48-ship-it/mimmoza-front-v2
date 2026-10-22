import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  API_ENDPOINT_COSTS,
  API_ENDPOINTS,
  API_FORMULES,
  API_FORMULES_PAYANTES,
  formuleApi,
  normaliserFormuleApi,
  prixParMilleCreditsForfait,
} from './catalogueApi.ts';

// Contrat docs/api/CONTRAT_API.md : le prix le plus bas vendu est 1,60 € / 1 000
// crédits (Scale annuel : 399 € / 250 000 = 1,596 €, arrondi au centime 1,60 €).
const PRIX_PLANCHER_PAR_MILLE = 1.6;
const auCentime = (x: number) => Math.round(x * 100) / 100;

test('API (a) : chaque formule payante vend ses crédits au moins 1,60 € / 1 000, en mensuel comme en annuel', () => {
  assert.ok(API_FORMULES_PAYANTES.length >= 3);
  for (const f of API_FORMULES_PAYANTES) {
    assert.equal(f.renouvellement, 'mensuel', f.nom);
    assert.ok(f.prixMensuelAnnuelHT != null && f.prixMensuelAnnuelHT <= f.prixMensuelHT, `${f.nom} : prix annuel incohérent`);
    for (const p of ['mensuel', 'annuel'] as const) {
      const prix = prixParMilleCreditsForfait(f, p);
      assert.ok(prix != null, `${f.nom} ${p}`);
      assert.ok(auCentime(prix) >= PRIX_PLANCHER_PAR_MILLE, `${f.nom} ${p} : ${prix.toFixed(3)} € / 1 000 crédits < 1,60 €`);
    }
  }
});

test('API (a) : la recharge prépayée coûte plus cher au crédit que le forfait mensuel de la même formule', () => {
  for (const f of API_FORMULES_PAYANTES) {
    assert.ok(f.rechargeParMilleHT != null, `${f.nom} : prix de recharge manquant`);
    const forfait = prixParMilleCreditsForfait(f, 'mensuel')!;
    assert.ok(f.rechargeParMilleHT > forfait, `${f.nom} : recharge ${f.rechargeParMilleHT} € ≤ forfait ${forfait.toFixed(2)} €`);
    assert.ok(f.rechargeParMilleHT >= PRIX_PLANCHER_PAR_MILLE, `${f.nom} : recharge sous le plancher`);
  }
});

test('API (a) : chiffres des formules conformes au contrat', () => {
  const attendu = {
    essai: [0, null, 500, null, 10, 2],
    starter: [49, 39, 10_000, 5.9, 60, 5],
    growth: [149, 119, 50_000, 3.5, 200, 20],
    scale: [499, 399, 250_000, 2.4, 1000, 100],
  } as const;
  assert.deepEqual(API_FORMULES.map((f) => f.id), ['essai', 'starter', 'growth', 'scale']);
  for (const f of API_FORMULES) {
    assert.deepEqual(
      [f.prixMensuelHT, f.prixMensuelAnnuelHT, f.credits, f.rechargeParMilleHT, f.debitParMinute, f.clesMax],
      [...attendu[f.id]],
      f.nom,
    );
  }
});

test("API (b) : l'essai est gratuit, sans recharge, 500 crédits uniques valables 30 jours", () => {
  const essai = formuleApi('essai');
  assert.equal(essai.prixMensuelHT, 0);
  assert.equal(essai.prixMensuelAnnuelHT, null);
  assert.equal(essai.rechargeParMilleHT, null);
  assert.equal(essai.renouvellement, 'unique');
  assert.equal(essai.credits, 500);
  assert.equal(essai.dureeEssaiJours, 30);
  assert.equal(prixParMilleCreditsForfait(essai, 'mensuel'), null);
  assert.equal(normaliserFormuleApi('free'), 'essai');
  assert.equal(normaliserFormuleApi('payg'), 'essai');
  assert.equal(normaliserFormuleApi('Growth'), 'growth');
});

test('API : aucun avantage promis qui n\'existe pas (SLA, webhooks, liste d\'IP, journaux en temps réel)', () => {
  const textes = API_FORMULES.flatMap((f) => [f.accroche, ...f.avantages]).join(' | ');
  assert.doesNotMatch(textes, /SLA|webhook|allowlist|liste blanche|adresses? IP|temps réel|dépassement :/i);
});

test('API : chaque endpoint « /v1/ » coûte au moins 1 crédit, chemins uniques', () => {
  const chemins = API_ENDPOINTS.map((e) => e.chemin);
  assert.equal(new Set(chemins).size, chemins.length);
  for (const e of API_ENDPOINTS) {
    if (e.chemin.startsWith('/v1/')) {
      assert.ok(Number.isInteger(e.credits) && e.credits >= 1, `${e.chemin} : ${e.credits}`);
      assert.equal(e.methode, 'POST', e.chemin);
      assert.ok(e.exemple && Object.keys(e.exemple).length > 0, `${e.chemin} : exemple manquant`);
    }
  }
});

// ── (c) Table des coûts identique à celle de la passerelle ───────────────────

const CHEMIN_PASSERELLE = fileURLToPath(
  new URL('../../../supabase/functions/_shared/apiCatalogue.ts', import.meta.url),
);

/** Lit `export const API_ENDPOINT_COSTS = { "/v1/...": n, ... } as const;` par expression régulière. */
function lireCoutsPasserelle(source: string): Record<string, number> {
  const bloc = source.match(/export\s+const\s+API_ENDPOINT_COSTS\b[^=]*=\s*\{([\s\S]*?)\}/);
  assert.ok(bloc, 'API_ENDPOINT_COSTS introuvable dans apiCatalogue.ts de la passerelle');
  const couts: Record<string, number> = {};
  for (const m of bloc[1].matchAll(/["'`]([^"'`]+)["'`]\s*:\s*(\d+)/g)) couts[m[1]] = Number(m[2]);
  return couts;
}

test('API (c) : la table des coûts du front est identique à celle de la passerelle', () => {
  assert.ok(
    existsSync(CHEMIN_PASSERELLE),
    `Fichier de la passerelle absent : ${CHEMIN_PASSERELLE}. ` +
      "L'agent passerelle doit l'écrire (export const API_ENDPOINT_COSTS = { \"/v1/...\": n } as const) ; relancer npm test ensuite.",
  );
  const passerelle = lireCoutsPasserelle(readFileSync(CHEMIN_PASSERELLE, 'utf8'));
  const v1Passerelle = Object.fromEntries(Object.entries(passerelle).filter(([k]) => k.startsWith('/v1/')));
  assert.deepEqual(
    Object.fromEntries(Object.entries(API_ENDPOINT_COSTS).sort(([a], [b]) => a.localeCompare(b))),
    Object.fromEntries(Object.entries(v1Passerelle).sort(([a], [b]) => a.localeCompare(b))),
    'Coûts différents entre src/lib/api/catalogueApi.ts et supabase/functions/_shared/apiCatalogue.ts',
  );
});
