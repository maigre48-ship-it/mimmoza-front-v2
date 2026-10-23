// supabase/functions/api-gateway/index.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Tests Deno de la passerelle API (sans réseau : base et fonctions internes simulées).
//   deno test supabase/functions/api-gateway/index.test.ts
// Couvre : table des coûts, validation, facturation (réservation / refus /
// remboursement / journal p_cost = 0), cache, composites partiels,
// anonymisation DVF, hygiène des journaux et des erreurs.
// ─────────────────────────────────────────────────────────────────────────────

import type { AppelInterne, ClientBase, ReponseInterne, ResultatRpc } from "../_shared/apiBase.ts";
import { API_CATALOGUE, API_ENDPOINT_COSTS } from "../_shared/apiCatalogue.ts";
import { contientDonneeIndividuelle, periodeDvf, SEUIL_SECRET_STATISTIQUE, statistiquesDvf, supprimerCles } from "../_shared/apiDvf.ts";
import { interpreterReservation, reponsePourRefus } from "../_shared/apiFacturation.ts";
import { empreinteSha256, extraireCle, formatCleValide } from "../_shared/apiKeyAuth.ts";
import { analyserReferenceCadastrale, estCodeInsee, estEnFrance, validerCouts, validerDpe, validerDvf, validerParcelle, validerPermis, validerScoring } from "../_shared/apiValidation.ts";
import { cheminPublic, jsonCanonique, traiterRequete } from "./gateway.ts";

// ── Assertions minimales (aucune dépendance distante) ──────────────────────
function assert(c: unknown, msg = "assertion"): asserts c {
  if (!c) throw new Error(msg);
}
function eq(a: unknown, b: unknown, msg = "") {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${msg} attendu ${sb}, obtenu ${sa}`);
}

// ── Simulations ────────────────────────────────────────────────────────────
const CLE = "mk_live_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6";
const KEY_ID = "11111111-2222-3333-4444-555555555555";

interface Simu {
  base: ClientBase;
  rpcs: Array<{ nom: string; args: Record<string, unknown> }>;
  appels: Array<{ fonction: string; corps: Record<string, unknown> }>;
  journal: string[];
  cache: Map<string, unknown>;
}

function simu(o: {
  reservation?: unknown;
  reservationErreur?: boolean;
  cleConnue?: boolean;
  revoquee?: boolean;
  remboursementEchoue?: boolean;
  internes?: Record<string, (corps: Record<string, unknown>) => ReponseInterne | Promise<ReponseInterne>>;
} = {}) {
  const s: Simu = { rpcs: [], appels: [], journal: [], cache: new Map(), base: null as unknown as ClientBase };
  s.base = {
    // deno-lint-ignore require-await
    async rpc<T>(nom: string, args: Record<string, unknown>): Promise<ResultatRpc<T>> {
      s.rpcs.push({ nom, args });
      if (nom === "api_reserver_credits") {
        if (o.reservationErreur) return { data: null, error: "rpc HTTP 500" };
        return { data: (o.reservation ?? { ok: true, source_mois: args.p_cout, source_recharge: 0, restant: 490, limite: 500, plan: "essai" }) as T, error: null };
      }
      if (nom === "api_rembourser_credits") return o.remboursementEchoue ? { data: null, error: "x" } : { data: null, error: null };
      if (nom === "api_cache_get") {
        const v = s.cache.get(`${args.p_provider}|${args.p_cache_key}`);
        return { data: (v ? [{ response: v }] : []) as T, error: null };
      }
      if (nom === "api_cache_put") {
        s.cache.set(`${args.p_provider}|${args.p_cache_key}`, args.p_response);
        return { data: null, error: null };
      }
      return { data: null, error: null };
    },
    // deno-lint-ignore require-await
    async selectionner<T>(table: string, _c: string, eg: Record<string, string>): Promise<ResultatRpc<T[]>> {
      s.rpcs.push({ nom: `select:${table}`, args: eg });
      if (o.cleConnue === false) return { data: [], error: null };
      return { data: [{ id: KEY_ID, user_id: "u1", env: "live", revoked_at: o.revoquee ? "2026-01-01" : null }] as T[], error: null };
    },
  };
  const appeler: AppelInterne = async (fonction, corps) => {
    s.appels.push({ fonction, corps });
    const f = o.internes?.[fonction];
    if (!f) return { ok: false, status: 500, json: { error: "secret interne: stack trace" }, cause: "http" };
    return await f(corps);
  };
  const deps = {
    base: s.base,
    appeler,
    resoudreEpci: (insee: string) => Promise.resolve(insee === "64065" ? "246400337" : null),
    idRequete: () => "req-test",
    journal: (l: string) => s.journal.push(l),
    maintenant: () => new Date(Date.UTC(2026, 9, 22)),
  };
  return { s, deps };
}

function ok(json: unknown): ReponseInterne {
  return { ok: true, status: 200, json };
}

function requete(chemin: string, corps: unknown, o: { methode?: string; cle?: string | null; ct?: string; brut?: string } = {}) {
  const h = new Headers();
  if (o.cle !== null) h.set("Authorization", `Bearer ${o.cle ?? CLE}`);
  h.set("Content-Type", o.ct ?? "application/json");
  const m = o.methode ?? "POST";
  return new Request(`https://x.supabase.co/functions/v1/api-gateway${chemin}`, {
    method: m,
    headers: h,
    body: m === "GET" ? undefined : (o.brut ?? JSON.stringify(corps)),
  });
}

const DPE_OK = () => ok({ status: "ok", summary: "3 DPE", stats: { total: 3 }, items: [{ classe_dpe: "D" }] });
const PARIS = { lat: 48.8686, lon: 2.3306 };

// ═══ Catalogue ═════════════════════════════════════════════════════════════

Deno.test("catalogue : coûts du contrat, tous ≥ 1 sauf /health", () => {
  eq(API_ENDPOINT_COSTS, {
    "/health": 0, "/v1/scoring/smart": 10, "/v1/market/dvf": 3, "/v1/risks": 3, "/v1/parcelle": 1, "/v1/plu": 4,
    "/v1/servitudes": 2, "/v1/faisabilite": 25, "/v1/permis": 2, "/v1/dpe": 1, "/v1/batiment": 2, "/v1/loyers": 1,
    "/v1/fiscalite": 2, "/v1/environnement": 3, "/v1/mobilite": 2, "/v1/couts": 2, "/v1/estimation": 15,
  });
  for (const [k, v] of Object.entries(API_ENDPOINT_COSTS)) {
    if (k !== "/health") assert(v >= 1, `${k} coûte au moins 1 crédit`);
    assert(API_CATALOGUE[k as keyof typeof API_CATALOGUE], `${k} présent dans le catalogue`);
  }
});

Deno.test("catalogue : objet littéral lisible par regex (test node du front)", async () => {
  const src = await Deno.readTextFile(new URL("../_shared/apiCatalogue.ts", import.meta.url));
  const bloc = /export const API_ENDPOINT_COSTS = \{([\s\S]*?)\} as const;/.exec(src);
  assert(bloc, "bloc API_ENDPOINT_COSTS trouvé");
  const lu: Record<string, number> = {};
  for (const m of bloc[1].matchAll(/"([^"]+)":\s*(\d+),/g)) lu[m[1]] = Number(m[2]);
  eq(lu, { ...API_ENDPOINT_COSTS });
});

// ═══ Validation ════════════════════════════════════════════════════════════

Deno.test("validation : zones géographiques", () => {
  assert(estEnFrance(48.8686, 2.3306), "Paris");
  assert(estEnFrance(41.92, 8.74), "Ajaccio");
  assert(estEnFrance(-20.88, 55.45), "Saint-Denis de La Réunion");
  assert(estEnFrance(16.24, -61.53), "Pointe-à-Pitre");
  assert(estEnFrance(4.93, -52.33), "Cayenne");
  assert(estEnFrance(-12.78, 45.23), "Mamoudzou");
  assert(!estEnFrance(51.5, -0.12), "Londres refusé");
  assert(!estEnFrance(2.33, 48.86), "lat/lon inversés refusés");
  assert(!estEnFrance(0, 0), "0,0 refusé");
});

Deno.test("validation : codes INSEE et références cadastrales", () => {
  for (const c of ["75056", "2A004", "2B033", "97411", "97611", "01001"]) assert(estCodeInsee(c), c);
  for (const c of ["20004", "00000", "98000", "7505", "750561", "75000", "2C004"]) assert(!estCodeInsee(c), c);
  eq(analyserReferenceCadastrale("75056 000 AB 0012"), { idu: "75056000AB0012", code_insee: "75056", prefixe: "000", section: "AB", numero: "0012" });
  eq(analyserReferenceCadastrale("2a0040000a0123")?.section, "0A");
  assert(analyserReferenceCadastrale("64065000AI0002"), "IDU standard");
  for (const r of ["75056AB0012", "75056000AB0000", "75056000000012", "20004000AB0012", "75056000AB00123"]) {
    assert(!analyserReferenceCadastrale(r), r);
  }
});

Deno.test("validation : erreurs explicites et champs inconnus", () => {
  const r1 = validerScoring({ lat: "48.8", lon: 2.3 });
  assert(!r1.ok && r1.erreurs.some((e) => e.champ === "lat" && /nombre/.test(e.message)));
  const r2 = validerScoring({ lat: 48.86 });
  assert(!r2.ok && r2.erreurs.some((e) => e.champ === "lon"));
  const r3 = validerScoring({ ...PARIS, rayonkm: 2 });
  assert(!r3.ok && r3.erreurs.some((e) => e.champ === "rayonkm" && e.message === "champ inconnu"));
  const r4 = validerScoring({});
  assert(!r4.ok && /localisation obligatoire/.test(r4.erreurs[0].message));
  const r5 = validerDpe({ adresse: "x".repeat(201) });
  assert(!r5.ok && r5.erreurs.some((e) => /200/.test(e.message)));
  const r6 = validerParcelle({ reference_cadastrale: "75056000AB0012", code_insee: "75056" });
  assert(!r6.ok, "code_insee non attendu sur /v1/parcelle");
  const r7 = validerScoring({ reference_cadastrale: "75056000AB0012", code_insee: "69123" });
  assert(!r7.ok && r7.erreurs.some((e) => e.champ === "code_insee"));
  const r8 = validerDvf({ ...PARIS });
  assert(r8.ok);
  eq(r8.valeur.types, ["appartement", "maison"]);
  eq([r8.valeur.rayon_km, r8.valeur.horizon_mois], [2, 24]);
  const r9 = validerPermis({ code_epci: "246400337", code_insee: "64065" }, 2026);
  assert(!r9.ok);
  const r10 = validerPermis({ code_insee: "64065" }, 2026);
  assert(r10.ok && r10.valeur.annee_min === 2023);
  const r11 = validerCouts({ nature: "renovation", postes: [{ poste: "cuisine" }, { poste: "jacuzzi" }] });
  assert(!r11.ok && r11.erreurs.some((e) => e.champ === "postes[1].poste"));
  const r12 = validerCouts({ nature: "construction", typologie: "maison_individuelle", surface_sdp_m2: 120 });
  assert(r12.ok && r12.valeur.nature === "construction" && r12.valeur.gamme === "standard");
});

// ═══ Clé API ═══════════════════════════════════════════════════════════════

Deno.test("clé API : extraction et format", async () => {
  eq(extraireCle("Bearer abc", null), "abc");
  eq(extraireCle(null, " xyz "), "xyz");
  eq(extraireCle("Basic abc", null), null);
  assert(formatCleValide(CLE));
  assert(!formatCleValide("mk_prod_" + "a".repeat(32)));
  assert(!formatCleValide("mk_live_court"));
  eq((await empreinteSha256("abc")).length, 64);
});

// ═══ Facturation (logique pure) ════════════════════════════════════════════

Deno.test("facturation : interprétation des réponses de réservation", () => {
  const a = interpreterReservation({ ok: true, source_mois: 7, source_recharge: 3, restant: 90, limite: 100, plan: "starter" });
  assert(a?.ok && a.source_mois === 7 && a.source_recharge === 3);
  assert(interpreterReservation([{ ok: true, source_mois: 1, source_recharge: 0 }])?.ok, "tableau PostgREST accepté");
  eq(interpreterReservation(null), null);
  eq(interpreterReservation({ foo: 1 }), null);
  const cas: Array<[string, number]> = [["cle_invalide", 401], ["essai_expire", 403], ["debit_depasse", 429], ["credits_epuises", 402], ["autre", 403]];
  for (const [raison, status] of cas) {
    const r = interpreterReservation({ ok: false, raison, restant: 0, limite: 500, reessayer_dans: 12.2 });
    assert(r && !r.ok);
    eq(reponsePourRefus(r).status, status, raison);
  }
  const r429 = interpreterReservation({ ok: false, raison: "debit_depasse", reessayer_dans: 12.2 });
  assert(r429 && !r429.ok);
  eq(reponsePourRefus(r429).entetes["Retry-After"], "13");
});

// ═══ Anonymisation DVF ═════════════════════════════════════════════════════

Deno.test("DVF : statistiques agrégées et secret statistique", () => {
  const bloc = {
    coverage: "ok",
    kpis: { transactions_count: 42, price_median_eur_m2: 10234.6, price_mean_eur_m2: 10500.2, price_q1_eur_m2: 9000, price_q3_eur_m2: 11800 },
    comps: [{ id: "2024-123", address: "12 rue X", price_m2: 9999, date: "2024-03-14" }],
  };
  const s = statistiquesDvf("appartement", bloc);
  eq(s, { type_bien: "appartement", couverture: "ok", nombre_ventes: 42, prix_m2_median: 10235, prix_m2_moyen: 10500, prix_m2_q1: 9000, prix_m2_q3: 11800, secret_statistique: false });
  assert(!contientDonneeIndividuelle(s));
  const petit = statistiquesDvf("maison", { coverage: "ok", kpis: { transactions_count: SEUIL_SECRET_STATISTIQUE - 1, price_median_eur_m2: 5000 } });
  eq([petit.prix_m2_median, petit.secret_statistique, petit.nombre_ventes], [null, true, SEUIL_SECRET_STATISTIQUE - 1]);
  eq(statistiquesDvf("maison", { coverage: "error", kpis: null }).couverture, "indisponible");
  const nettoye = supprimerCles({ a: { comps: [1], b: [{ comparables: [2], c: 3 }] } });
  eq(nettoye, { a: { b: [{ c: 3 }] } });
  eq(periodeDvf(24, new Date(Date.UTC(2026, 9, 22))), { horizon_mois: 24, du: "2024-10", au: "2026-10" });
});

// ═══ Passerelle de bout en bout ════════════════════════════════════════════

Deno.test("passerelle : chemins, méthode, Content-Type, taille, /health sans clé", async () => {
  eq(cheminPublic("/api-gateway/v1/dpe/"), "/v1/dpe");
  eq(cheminPublic("/functions/v1/api-gateway/health"), "/health");
  const { s, deps } = simu();
  const h = await traiterRequete(requete("/health", null, { methode: "GET", cle: null }), deps);
  eq(h.status, 200);
  eq(h.headers.get("X-Credits-Cout"), "0");
  eq((await traiterRequete(requete("/v1/inconnu", {}), deps)).status, 404);
  const m = await traiterRequete(requete("/v1/dpe", null, { methode: "GET" }), deps);
  eq(m.status, 405);
  eq(m.headers.get("Allow"), "POST, OPTIONS");
  eq((await traiterRequete(requete("/v1/dpe", PARIS, { ct: "text/plain" }), deps)).status, 415);
  eq((await traiterRequete(requete("/v1/dpe", null, { brut: JSON.stringify({ adresse: "x".repeat(40000) }) }), deps)).status, 413);
  eq((await traiterRequete(requete("/v1/dpe", null, { brut: "{pas du json" }), deps)).status, 400);
  eq((await traiterRequete(requete("/v1/dpe", null, { brut: "[1,2]" }), deps)).status, 400);
  eq(s.rpcs.filter((r) => r.nom === "api_reserver_credits").length, 0, "aucune réservation");
  eq((await traiterRequete(new Request("https://x/api-gateway/v1/dpe", { method: "OPTIONS" }), deps)).status, 204);
});

Deno.test("passerelle : clé absente / mal formée / inconnue / révoquée → 401 sans réservation", async () => {
  for (const [o, cle] of [[{}, null], [{}, "mk_live_xx"], [{ cleConnue: false }, CLE], [{ revoquee: true }, CLE]] as const) {
    const { s, deps } = simu(o);
    const r = await traiterRequete(requete("/v1/dpe", PARIS, { cle }), deps);
    eq(r.status, 401);
    eq(s.rpcs.filter((x) => x.nom === "api_reserver_credits").length, 0);
  }
  const fmt = simu();
  await traiterRequete(requete("/v1/dpe", PARIS, { cle: "mk_live_xx" }), fmt.deps);
  eq(fmt.s.rpcs.length, 0, "format invalide : aucune requête en base");
});

Deno.test("passerelle : requête invalide → 400 détaillé, AVANT toute réservation", async () => {
  const { s, deps } = simu({ internes: { "dpe-ademe-v1": DPE_OK } });
  const r = await traiterRequete(requete("/v1/dpe", { lat: 51.5, lon: -0.12 }), deps);
  eq(r.status, 400);
  const j = await r.json();
  eq(j.erreur.code, "requete_invalide");
  assert(Array.isArray(j.erreur.details) && j.erreur.details[0].champ === "lat");
  eq(s.rpcs.filter((x) => x.nom === "api_reserver_credits").length, 0);
  eq(s.appels.length, 0);
});

Deno.test("passerelle : refus de réservation 402 / 429 / 403 / 503, aucun appel interne", async () => {
  const cas: Array<[unknown, number, string | null]> = [
    [{ ok: false, raison: "credits_epuises", restant: 0, limite: 500 }, 402, null],
    [{ ok: false, raison: "debit_depasse", restant: 12, limite: 500, reessayer_dans: 30 }, 429, "30"],
    [{ ok: false, raison: "essai_expire", restant: 100, limite: 500 }, 403, null],
    [{ ok: false, raison: "cle_invalide" }, 401, null],
  ];
  for (const [reservation, status, retry] of cas) {
    const { s, deps } = simu({ reservation, internes: { "dpe-ademe-v1": DPE_OK } });
    const r = await traiterRequete(requete("/v1/dpe", PARIS), deps);
    eq(r.status, status);
    eq(r.headers.get("Retry-After"), retry);
    eq(s.appels.length, 0);
  }
  const { s, deps } = simu({ reservationErreur: true, internes: { "dpe-ademe-v1": DPE_OK } });
  const r = await traiterRequete(requete("/v1/dpe", PARIS), deps);
  eq(r.status, 503);
  eq(s.appels.length, 0, "jamais d'appel sans réservation confirmée");
});

Deno.test("passerelle : succès → réservation au bon coût, en-têtes, journal p_cost = 0, sources", async () => {
  const { s, deps } = simu({ internes: { "dpe-ademe-v1": DPE_OK } });
  const r = await traiterRequete(requete("/v1/dpe", { ...PARIS, rayon_m: 100 }), deps);
  eq(r.status, 200);
  eq(r.headers.get("X-Credits-Cout"), "1");
  eq(r.headers.get("X-Credits-Restants"), "490");
  eq(r.headers.get("X-Request-Id"), "req-test");
  eq(r.headers.get("X-RateLimit-Limit"), null);
  const res = s.rpcs.find((x) => x.nom === "api_reserver_credits");
  eq(res?.args, { p_key_id: KEY_ID, p_endpoint: "/v1/dpe", p_cout: 1 });
  const usage = s.rpcs.find((x) => x.nom === "increment_api_usage");
  eq([usage?.args.p_cost, usage?.args.p_is_error], [0, false]);
  eq(s.rpcs.filter((x) => x.nom === "api_rembourser_credits").length, 0);
  eq(s.appels[0].corps, { lat: 48.8686, lon: 2.3306, radius_m: 100 });
  const j = await r.json();
  eq(j.statut, "ok");
  assert(j.sources.some((x: { id: string }) => x.id === "dpe_ademe"));
  eq(j.credits, { cout: 1, restants: 490 });
});

Deno.test("passerelle : échec interne (HTTP 500 / statut error / délai / exception) → remboursement exact + erreur masquée", async () => {
  const echecs: Array<[string, () => ReponseInterne | Promise<ReponseInterne>, number]> = [
    ["http500", () => ({ ok: false, status: 500, json: { error: "relation plu_x does not exist" }, cause: "http" }), 502],
    ["metier", () => ok({ status: "error", summary: "Erreur ADEME : HTTP 503 at https://..." }), 502],
    ["delai", () => ({ ok: false, status: 0, json: null, cause: "delai" }), 504],
    ["exception", () => {
      throw new Error("boom secret");
    }, 502],
  ];
  for (const [nom, f, status] of echecs) {
    const { s, deps } = simu({
      reservation: { ok: true, source_mois: 0, source_recharge: 1, restant: 41, limite: 500, plan: "starter" },
      internes: { "dpe-ademe-v1": f },
    });
    const r = await traiterRequete(requete("/v1/dpe", PARIS), deps);
    eq(r.status, status, nom);
    const texte = await r.text();
    assert(!/relation|ADEME : HTTP|boom|secret|https:\/\//.test(texte), `${nom} : détail interne masqué`);
    const remb = s.rpcs.find((x) => x.nom === "api_rembourser_credits");
    eq(remb?.args, { p_key_id: KEY_ID, p_source_mois: 0, p_source_recharge: 1 }, nom);
    eq(r.headers.get("X-Credits-Cout"), "0");
    eq(r.headers.get("X-Credits-Restants"), "42");
    eq(s.rpcs.find((x) => x.nom === "increment_api_usage")?.args.p_is_error, true);
  }
});

Deno.test("passerelle : remboursement impossible → journalisé pour régularisation, sans secret", async () => {
  const { s, deps } = simu({ remboursementEchoue: true, internes: {} });
  const r = await traiterRequete(requete("/v1/dpe", PARIS), deps);
  eq(r.status, 502);
  eq(s.rpcs.filter((x) => x.nom === "api_rembourser_credits").length, 2, "une nouvelle tentative");
  assert(s.journal.some((l) => l.includes("REMBOURSEMENT EN ECHEC") && l.includes(KEY_ID)));
});

Deno.test("passerelle : 404 de la source → 404 introuvable, remboursé", async () => {
  const { s, deps } = simu({ internes: { "cadastre-parcelle-by-id": () => ({ ok: false, status: 404, json: { success: false }, cause: "http" }) } });
  const r = await traiterRequete(requete("/v1/parcelle", { reference_cadastrale: "75056000AB0012" }), deps);
  eq(r.status, 404);
  eq((await r.json()).erreur.code, "introuvable");
  assert(s.rpcs.some((x) => x.nom === "api_rembourser_credits"));
  eq(s.appels[0].corps, { parcel_id: "75056000AB0012", commune_insee: "75056" });
});

Deno.test("passerelle : composite environnement partiel facturé, tout en échec remboursé", async () => {
  const internes = {
    "bruit-classement-v1": () => ok({ status: "no_data", summary: "rien", stats: { nb_secteurs: 0 }, items: [] }),
    "potentiel-solaire-v1": () => ok({ status: "ok", summary: "1200 kWh", stats: { production_specifique_kwh_kwc_an: 1200 }, items: [] }),
    "altimetrie-v1": () => ({ ok: false, status: 0, json: null, cause: "delai" as const }),
    "patrimoine-merimee-v1": () => ok({ status: "error", summary: "ODS HTTP 500" }),
  };
  const a = simu({ internes });
  const r = await traiterRequete(requete("/v1/environnement", PARIS), a.deps);
  eq(r.status, 200);
  const j = await r.json();
  eq(j.statut, "partiel");
  eq(j.donnees.sources_indisponibles, ["altimetrie", "patrimoine"]);
  eq(j.donnees.solaire.statut, "ok");
  eq(a.s.rpcs.filter((x) => x.nom === "api_rembourser_credits").length, 0, "au moins une source : facturé");
  eq(a.s.rpcs.filter((x) => x.nom === "api_cache_put").length, 0, "réponse partielle non mise en cache");
  assert(j.sources.some((x: { id: string }) => x.id === "pvgis") && j.sources.some((x: { id: string }) => x.id === "merimee"));

  const b = simu({ internes: {} });
  const r2 = await traiterRequete(requete("/v1/environnement", PARIS), b.deps);
  eq(r2.status, 502);
  eq(b.s.rpcs.filter((x) => x.nom === "api_rembourser_credits").length, 1);
});

Deno.test("passerelle : /v1/market/dvf ne renvoie que des agrégats", async () => {
  const dvf = (n: number) => ({
    coverage: "ok",
    source: "csv",
    kpis: { transactions_count: n, price_median_eur_m2: 10000, price_mean_eur_m2: 10100, price_q1_eur_m2: 9000, price_q3_eur_m2: 11000 },
    comps: [{ id: "mut-1", address: "3 rue Y", price_m2: 12000, date: "2025-02-03", surface_m2: 40 }],
  });
  const { s, deps } = simu({
    internes: {
      "smartscore-enriched-v3": (c) =>
        ok({ success: true, resolved_point: { lat: 48.86, lon: 2.33, commune_insee: "75101", source: "payload" }, dvf: dvf(c.type_local === "maison" ? 3 : 57) }),
    },
  });
  const r = await traiterRequete(requete("/v1/market/dvf", { ...PARIS, horizon_mois: 12 }), deps);
  eq(r.status, 200);
  const j = await r.json();
  assert(!contientDonneeIndividuelle(j), "aucun comparable individuel");
  const texte = JSON.stringify(j);
  assert(!/rue Y|mut-1|2025-02-03|12000/.test(texte), "ni adresse, ni id, ni date, ni prix individuel");
  eq(j.donnees.par_type.appartement.prix_m2_median, 10000);
  eq(j.donnees.par_type.maison.prix_m2_median, null, "secret statistique");
  eq(j.donnees.periode, { horizon_mois: 12, du: "2025-10", au: "2026-10" });
  assert(j.sources.some((x: { id: string; licence: string }) => x.id === "dvf" && /Licence Ouverte/.test(x.licence)));
  eq(s.appels.map((a) => a.corps.include), [["dvf"], ["dvf"]]);
  eq(s.rpcs.find((x) => x.nom === "api_reserver_credits")?.args.p_cout, 3);
});

Deno.test("passerelle : cache — deuxième appel servi sans appel interne, mais facturé", async () => {
  const { s, deps } = simu({ internes: { "loyers-reference-v1": () => ok({ status: "ok", summary: "12 €/m²", stats: { loyer: 12 }, items: [] }) } });
  const r1 = await traiterRequete(requete("/v1/loyers", { code_insee: "64065" }), deps);
  eq((await r1.json()).depuis_cache, false);
  const r2 = await traiterRequete(requete("/v1/loyers", { code_insee: "64065" }), deps);
  const j2 = await r2.json();
  eq(j2.depuis_cache, true);
  eq(j2.donnees.stats, { loyer: 12 });
  eq(s.appels.length, 1);
  eq(s.rpcs.filter((x) => x.nom === "api_reserver_credits").length, 2);
  const put = s.rpcs.find((x) => x.nom === "api_cache_put");
  eq(put?.args.p_ttl_seconds, 7 * 24 * 3600);
  eq(put?.args.p_request, { endpoint: "/v1/loyers" }, "la requête n'est pas recopiée");
  eq(jsonCanonique({ b: 1, a: [{ d: 2, c: undefined }] }), '{"a":[{"d":2}],"b":1}');
});

Deno.test("passerelle : scoring et faisabilité purgés des ventes individuelles et des consignes LLM", async () => {
  const { deps } = simu({
    internes: {
      "smartscore-enriched-v3": () => ok({ success: true, input: { prix: 1 }, smartscore_v4: { score: 61 }, market_like: { dvf: { kpis: { transactions_count: 9 }, comps: [{ address: "1 rue Z" }] } } }),
      "etude-parcelle-v1": () =>
        ok({
          status: "ok",
          summary: "Étude",
          stats: { verdict: { risque: "faible" }, interdictions_de_conclusion: ["…"], note_methode: "Mimmo…", avertissements: ["A"] },
          items: [{ cle: "dvf", stats: { echantillon: [{ date: "2025-01-02", prix_m2: 4000 }], nb_comparables: 8 } }],
        }),
      "plu-from-parcelle-v2": () => ok({ success: true, plu: { found: true, zone_code: "UA", ruleset: { hauteur_max_m: 12 } } }),
    },
  });
  const r = await traiterRequete(requete("/v1/scoring/smart", PARIS), deps);
  const j = await r.json();
  eq(r.status, 200);
  assert(!contientDonneeIndividuelle(j) && !JSON.stringify(j).includes("1 rue Z"));
  eq(j.donnees.input, undefined);
  assert(j.sources.some((x: { id: string }) => x.id === "osm"), "attribution ODbL OSM");

  const f = await traiterRequete(requete("/v1/faisabilite", { reference_cadastrale: "64065000AI0002" }), deps);
  const jf = await f.json();
  eq(f.status, 200);
  assert(!contientDonneeIndividuelle(jf));
  eq(jf.donnees.etude.interdictions_de_conclusion, undefined);
  eq(jf.donnees.etude.note_methode, undefined);
  eq(jf.donnees.plu, { statut: "ok", trouve: true, zone_code: "UA", reglement: { hauteur_max_m: 12 } });
  assert(jf.sources.some((x: { id: string; licence: string }) => x.id === "wikipedia" && x.licence === "CC BY-SA 4.0"));
});

Deno.test("passerelle : permis — résolution EPCI depuis le code INSEE, EPCI inconnu remboursé", async () => {
  const { s, deps } = simu({ internes: { "sitadel-v1": (c) => ok(c.epciCode === "246400337" ? { ok: true, logements: 812, surface: 61000, rows: 3, anneeMin: 2023 } : { ok: false, error: "EPCI x non trouvé dans le CSV" }) } });
  const r = await traiterRequete(requete("/v1/permis", { code_insee: "64065" }), deps);
  eq(r.status, 200);
  eq((await r.json()).donnees.logements_autorises, 812);
  const r2 = await traiterRequete(requete("/v1/permis", { code_epci: "200000000" }), deps);
  eq(r2.status, 404);
  eq(s.rpcs.filter((x) => x.nom === "api_rembourser_credits").length, 1);
});

Deno.test("passerelle : estimation sans référence DVF → 422 remboursé ; avec → comparables retirés", async () => {
  const sansDvf = simu({ internes: { "smartscore-enriched-v3": () => ok({ success: true, dvf: { coverage: "no_data", kpis: { transactions_count: 2 } } }) } });
  const r = await traiterRequete(requete("/v1/estimation", { ...PARIS, surface_m2: 50, type_bien: "appartement" }), sansDvf.deps);
  eq(r.status, 422);
  eq(sansDvf.s.appels.some((a) => a.fonction === "valuation-engine"), false);
  assert(sansDvf.s.rpcs.some((x) => x.nom === "api_rembourser_credits"));

  const avec = simu({
    internes: {
      "smartscore-enriched-v3": () => ok({ success: true, dvf: { coverage: "ok", kpis: { transactions_count: 30, price_median_eur_m2: 10000 } } }),
      "valuation-engine": (c) => ok({ estimatedValue: 500000, valuationBasis: "market_reference", comparables: [{ price: 1, saleDate: "2024-01-01" }], echo: c.marketReference }),
    },
  });
  const r2 = await traiterRequete(requete("/v1/estimation", { ...PARIS, surface_m2: 50, type_bien: "appartement" }), avec.deps);
  const j2 = await r2.json();
  eq(r2.status, 200);
  eq(j2.donnees.comparables, undefined);
  eq(j2.donnees.echo.pricePerM2, 10000);
  eq(j2.beta, true);
});

Deno.test("hygiène : aucun journal ne contient la clé, le corps ou une réponse", async () => {
  const { s, deps } = simu({ remboursementEchoue: true, internes: { "dpe-ademe-v1": () => ({ ok: false, status: 500, json: { error: "détail sensible" }, cause: "http" }) } });
  await traiterRequete(requete("/v1/dpe", { adresse: "10 rue Secrète 75001 Paris" }), deps);
  const tout = s.journal.join("\n");
  assert(tout.length > 0, "des lignes de journal existent");
  assert(!tout.includes(CLE) && !tout.includes("Secrète") && !tout.includes("détail sensible"), tout);
});

// ═══ Licences (revue du 23/10/2026) ════════════════════════════════════════
import { masquerPrixSousSecret as masquerSecret } from "../_shared/apiDvf.ts";

Deno.test("licences : /v1/batiment suspendu → 503, ni clé ni réservation ni appel interne", async () => {
  const { s, deps } = simu({ internes: { "batiment-bdnb-v1": () => ok({ status: "ok" }) } });
  const r = await traiterRequete(requete("/v1/batiment", { adresse: "10 rue de la Paix, 75002 Paris" }), deps);
  const j = await r.json();
  eq(r.status, 503);
  eq(j.erreur.code, "endpoint_suspendu");
  eq(s.rpcs.filter((x) => x.nom === "api_reserver_credits").length, 0);
  eq(s.appels.length, 0);
});

Deno.test("licences : le SmartScore de l'API demande sans_overpass (pas de serveur Overpass public)", async () => {
  const { s, deps } = simu({
    internes: { "smartscore-enriched-v3": () => ok({ success: true, smartscore_v4: { score: 61 } }) },
  });
  await traiterRequete(requete("/v1/scoring/smart", PARIS), deps);
  await traiterRequete(requete("/v1/risks", PARIS), deps);
  const corps = s.appels.filter((a) => a.fonction === "smartscore-enriched-v3").map((a) => a.corps);
  assert(corps.length >= 2, "appels smartscore");
  for (const c of corps) eq(c.sans_overpass, true);
});

Deno.test("licences : faisabilité — prix DVF masqués sous 5 ventes, conservés au-delà", async () => {
  const sous = masquerSecret({ id: "dvf_prix_m2", value: { prix_m2_median_source: 4100, prix_m2_median_robuste: 4000, nb_comparables: 3, extremes_ecartes: [9000], dispersion_pct: 40, categories: ["Maison"] } }) as Record<string, Record<string, unknown>>;
  eq(sous.value.prix_m2_median_source, null);
  eq(sous.value.prix_m2_median_robuste, null);
  eq(sous.value.extremes_ecartes, null);
  eq(sous.value.dispersion_pct, null);
  eq(sous.value.nb_comparables, 3);
  eq(sous.value.secret_statistique, true);
  eq(sous.value.categories, ["Maison"]);
  const sur = masquerSecret({ prix_m2_median_robuste: 4000, nb_comparables: 12 }) as Record<string, unknown>;
  eq(sur.prix_m2_median_robuste, 4000);
  eq(sur.secret_statistique, undefined);

  const { deps } = simu({
    internes: {
      "etude-parcelle-v1": () => ok({
        status: "ok", summary: "Étude",
        stats: { dvf: { nb_comparables: 2, prix_m2_median_robuste: 5100 } },
        items: [{ cle: "dvf", stats: { nb_comparables: 2, prix_m2_median: 5100, ventes: [{ prix: 300000 }] } }],
      }),
      "plu-from-parcelle-v2": () => ok({ success: true, plu: { found: false } }),
    },
  });
  const f = await traiterRequete(requete("/v1/faisabilite", { reference_cadastrale: "64065000AI0002" }), deps);
  const t = JSON.stringify(await f.json());
  eq(f.status, 200);
  assert(!t.includes("5100") && !t.includes("300000"), "aucun prix sous le secret statistique");
});
