// ============================================================================
// tests/harness.mjs — Harnais de non-régression MimmozIA
// ----------------------------------------------------------------------------
// À lancer APRÈS CHAQUE DÉPLOIEMENT de copilot-chat ou d'une fonction source.
// Node >= 18 (fetch natif), zéro dépendance.
//
// Deux étages :
//   A. PLOMBERIE  — appelle chaque Edge Function source directement (slug par
//      slug). Attrape : slug mismatch (le bug altimetrie-v1-index), fonction
//      cassée, API amont morte. Coût : 0 jeton.
//   B. BOUT-EN-BOUT — pose des questions étalon à copilot-chat (mode quick)
//      et vérifie que le BON OUTIL est appelé + qu'une réponse finale non
//      vide sort. Attrape : outil filtré du mode quick, bug d'orchestration
//      (synthèse coupée), routage cassé. Coût : quelques jetons.
//
// ── Usage (PowerShell) ──────────────────────────────────────────────────────
//   $env:SUPABASE_URL      = "https://TON-PROJET.supabase.co"
//   $env:SUPABASE_ANON_KEY = "eyJ..."          # clé anon (publique)
//   $env:TEST_EMAIL        = "test@mimmoza.fr" # compte de test dédié
//   $env:TEST_PASSWORD     = "..."             # (jamais ton compte perso)
//
//   node tests/harness.mjs                     # tout (A + B)
//   node tests/harness.mjs --skip-copilot      # étage A seul (0 jeton)
//   node tests/harness.mjs --only taxes,loyers # tests ciblés (id partiel)
//   node tests/harness.mjs --dump              # affiche les réponses brutes
//                                              # (calibration des payloads)
//   $env:GOLDEN = "1" ; node tests/harness.mjs # assertions strictes (démo)
//
// Sortie : tableau PASS/FAIL + durées. Code de sortie ≠ 0 si au moins 1 FAIL
// (chaînable dans un script de déploiement).
//
// ── COUTURES À CALIBRER AU PREMIER RUN (--dump) ────────────────────────────
//   1. Les PAYLOADS des fonctions sources : je pose des noms de champs
//      plausibles (code_insee, cadastral_ref, lat/lon) d'après les contrats
//      connus. Si une fonction renvoie "paramètre manquant", --dump montre sa
//      réponse → ajuste le payload du test concerné ci-dessous.
//   2. Le PARSING SSE de copilot-chat : la détection d'outil cherche les noms
//      de tools dans le flux brut (robuste quel que soit le format d'event) ;
//      la détection de texte final est heuristique. Si un test copilot échoue
//      avec un flux visiblement correct, --dump montre le flux → on ajuste
//      extractFinalText() sur tes vrais noms d'events.
//   3. AUTH étage A : les Edge Functions sont appelées avec le JWT du compte
//      de test. Si elles renvoient 401 (verify_jwt ou garde interne), pose
//      $env:SUPABASE_SERVICE_KEY (usage LOCAL uniquement, jamais commité) :
//      le harnais l'utilisera pour l'étage A seulement.
// ============================================================================

/* ─────────────────────────── Configuration des cas ─────────────────────── */

// Commune étalon : Ascain (64065). IDU étalon : parcelle réelle d'Ascain —
// ⚠️ remplace par un IDU que TU sais exister au cadastre (AI0001 n'y est pas,
// cf. test altimétrie retombé en centre commune).
const INSEE = '64065';
const CITY = 'Ascain';
const IDU = '64065000AI0002';          // ← À REMPLACER par un IDU réel vérifié
const LAT = 43.3435, LON = -1.6212;    // bourg d'Ascain (repli géométrique)

const GOLDEN = process.env.GOLDEN === '1';

// ── Étage A : fonctions sources ─────────────────────────────────────────────
// checks(json) renvoie une liste d'erreurs (vide = PASS).
const FUNCTION_TESTS = [
  {
    id: 'loyers',
    slug: 'loyers-reference-v1',
    payload: { code_insee: INSEE },
    checks: (j) => [
      ...baseContract(j),
      ...(GOLDEN ? [
        num(j?.stats?.loyer_median_appartement, 'loyer médian appartement'),
        mustMatch(j?.summary ?? '', /^(?!.*\bnull\b).*$/, "summary sans « null » (bug d'affichage loyers)"),
      ] : []),
    ],
  },
  {
    id: 'zonage',
    slug: 'zonage-abc-v1',
    payload: { code_insee: INSEE },
    checks: (j) => [
      ...baseContract(j),
      // Le Pinel est clos : la réponse doit le signaler, jamais le vendre.
      ...(GOLDEN ? [mustMatch(JSON.stringify(j), /pinel/i, 'mention clôture Pinel')] : []),
    ],
  },
  {
    id: 'taxes',
    slug: 'taxes-locales-v1',
    payload: { code_insee: INSEE },
    checks: (j) => [
      ...baseContract(j),
      ...(GOLDEN ? [mustMatch(JSON.stringify(j), /31[.,]75/, 'TFB Ascain 31,75 % (exercice courant — à rafraîchir chaque année)')] : []),
    ],
  },
  {
    id: 'assainissement',
    slug: 'assainissement-commune-v1',
    payload: { code_insee: INSEE },
    checks: (j) => [
      ...baseContract(j),
      ...(GOLDEN ? [mustMatch(JSON.stringify(j), /suez/i, 'opérateur SUEZ à Ascain')] : []),
    ],
  },
  {
    id: 'altimetrie',
    slug: 'altimetrie-v1',
    payload: { cadastral_ref: IDU },
    checks: (j) => [
      ...baseContract(j),
      // Valide la branche parcelle (résolution IDU→cadastre) dès qu'un IDU réel
      // est posé ci-dessus ; en attendant, accepte le repli centre commune.
      ...(GOLDEN ? [mustMatch(String(j?.stats?.precision ?? j?.precision ?? ''), /parcelle/, "precision='parcelle' (IDU résolu au cadastre)")] : []),
    ],
  },
  {
    id: 'solaire',
    slug: 'potentiel-solaire-v1',
    payload: { code_insee: INSEE, lat: LAT, lon: LON },
    checks: (j) => [...baseContract(j)],
  },
  {
    id: 'servitudes',
    slug: 'servitudes-gpu-v1',
    payload: { lat: LAT, lon: LON, cadastral_ref: IDU },
    // Les servitudes exigent une géométrie ; no_data est un résultat honnête
    // (GPU non exhaustif), donc le contrat de base suffit.
    checks: (j) => [...baseContract(j)],
  },
  // Sources non testées volontairement : ppr-detail-v1 (parkée, dormante),
  // bruit-classement-v1 (décision en attente). Les ajouter ici le jour où.
];

// ── Étage B : bout-en-bout copilot (mode quick = ton onglet réel) ──────────
const COPILOT_TESTS = [
  {
    id: 'copilot-taxes',
    question: `Quels sont les taux de taxe foncière à ${CITY} ?`,
    expectTool: 'get_taxes_locales',
    finalMatch: GOLDEN ? /31[.,]75/ : /taxe|fonci/i,
  },
  {
    id: 'copilot-loyers',
    question: `Quel est le loyer de référence au m² à ${CITY} ?`,
    expectTool: 'get_loyers_reference',
    finalMatch: /€|euro|m²|m2/i,
  },
  {
    id: 'copilot-zonage',
    question: `Quel est le zonage ABC de ${CITY} ?`,
    expectTool: 'get_zonage_abc',
    finalMatch: /zone|abis|b1|b2/i,
  },
  {
    id: 'copilot-altimetrie',
    // « altitude/pente » (pas « hauteur » : ce mot route vers le PLU — voulu).
    question: `Quelle est l'altitude et la pente de la parcelle ${IDU} ?`,
    expectTool: 'get_altimetrie',
    finalMatch: /altitude|pente|%/i,
  },
  {
    id: 'copilot-multi',
    // Sentinelle du bug d'orchestration : 2 outils enchaînés en quick DOIVENT
    // quand même produire une synthèse finale (patch finishReason==='tool_use').
    question: `Pour la parcelle ${IDU}, donne-moi l'assainissement de la commune et le zonage ABC.`,
    expectTool: 'get_assainissement',
    finalMatch: /assainissement|collectif|zone/i,
  },
];

/* ─────────────────────────── Helpers d'assertion ───────────────────────── */

function baseContract(j) {
  const errs = [];
  if (!j || typeof j !== 'object') return ['réponse non-JSON'];
  const status = j.status ?? j.result?.status;
  if (!['ok', 'no_data'].includes(String(status))) errs.push(`status inattendu: ${JSON.stringify(status)}`);
  const summary = j.summary ?? j.result?.summary;
  if (typeof summary !== 'string' || !summary.trim()) errs.push('summary absent ou vide');
  return errs;
}
const mustMatch = (s, re, label) => (re.test(String(s)) ? [] : [`attendu ${label} (motif ${re})`]);
const num = (v, label) => (typeof v === 'number' && !Number.isNaN(v) ? [] : [`${label} manquant ou non numérique`]);

/* ─────────────────────────── Infra d'exécution ─────────────────────────── */

const URL_BASE = must('SUPABASE_URL');
const ANON = must('SUPABASE_ANON_KEY');
const SERVICE = process.env.SUPABASE_SERVICE_KEY || null;

const argv = process.argv.slice(2);
const DUMP = argv.includes('--dump');
const SKIP_COPILOT = argv.includes('--skip-copilot');
const onlyArg = argv[argv.indexOf('--only') + 1];
const ONLY = argv.includes('--only') && onlyArg ? onlyArg.split(',').map((s) => s.trim()) : null;
const keep = (id) => !ONLY || ONLY.some((frag) => id.includes(frag));

function must(name) {
  const v = process.env[name];
  if (!v) { console.error(`✖ Variable d'environnement manquante : ${name}`); process.exit(2); }
  return v.replace(/\/$/, '');
}

async function login() {
  const email = process.env.TEST_EMAIL, password = process.env.TEST_PASSWORD;
  if (!email || !password) {
    console.warn('⚠ TEST_EMAIL/TEST_PASSWORD absents → étage B (copilot) impossible ; étage A tentera anon/service.');
    return null;
  }
  const res = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    console.error(`✖ Login du compte de test impossible (${res.status}) : ${JSON.stringify(j).slice(0, 200)}`);
    return null;
  }
  return j.access_token;
}

async function callFunction(slug, payload, jwt) {
  // Étage A : service key si fournie (voir couture 3), sinon JWT user, sinon anon.
  const bearer = SERVICE ?? jwt ?? ANON;
  const t0 = Date.now();
  const res = await fetch(`${URL_BASE}/functions/v1/${slug}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const ms = Date.now() - t0;
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { httpStatus: res.status, json, text, ms };
}

async function callCopilot(question, jwt) {
  const t0 = Date.now();
  const res = await fetch(`${URL_BASE}/functions/v1/copilot-chat`, {
    method: 'POST',
    headers: {
      apikey: ANON, Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json', Accept: 'text/event-stream',
    },
    // Forme alignée sur CopilotChatRequest (useCopilot) : message + mode (+context).
    body: JSON.stringify({ message: question, mode: 'quick', context: {} }),
  });
  const raw = await res.text(); // SSE complet (les fonctions ferment le flux à la fin)
  return { httpStatus: res.status, raw, ms: Date.now() - t0 };
}

// Détection d'outil robuste au format d'event : cherche le nom dans le flux brut.
const toolCalled = (raw, tool) => raw.includes(tool);

// Texte final : heuristique tolérante — concatène toutes les chaînes des
// champs texte usuels trouvées dans les data: SSE. À ajuster (--dump) si besoin.
function extractFinalText(raw) {
  let out = '';
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const body = line.slice(5).trim();
    if (!body || body === '[DONE]') continue;
    try {
      const e = JSON.parse(body);
      for (const k of ['delta', 'text', 'content', 'message', 'final', 'answer']) {
        const v = e?.[k] ?? e?.data?.[k];
        if (typeof v === 'string') out += v;
      }
    } catch { /* data non-JSON : ignorée */ }
  }
  return out || raw; // repli : on matche sur le flux brut plutôt que rater à tort
}

/* ─────────────────────────────── Runner ────────────────────────────────── */

const results = [];
const record = (id, ok, ms, errs = []) => {
  results.push({ id, ok, ms, errs });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(22)} ${String(ms).padStart(5)} ms${errs.length ? '   → ' + errs.join(' | ') : ''}`);
};

const jwt = await login();

console.log(`\n═ Étage A — plomberie (fonctions sources)${GOLDEN ? ' [GOLDEN]' : ''} ═`);
for (const t of FUNCTION_TESTS.filter((t) => keep(t.id))) {
  try {
    const r = await callFunction(t.slug, t.payload, jwt);
    if (DUMP) console.log(`--- ${t.id} (${t.slug}) HTTP ${r.httpStatus}\n${r.text.slice(0, 1200)}\n---`);
    const errs = [];
    if (r.httpStatus === 404) errs.push(`HTTP 404 — SLUG INTROUVABLE (vérifie slug déployé == "${t.slug}", gare au suffixe -index)`);
    else if (r.httpStatus === 401 || r.httpStatus === 403) errs.push(`HTTP ${r.httpStatus} — auth refusée (voir couture 3 : SUPABASE_SERVICE_KEY en local)`);
    else if (r.httpStatus !== 200) errs.push(`HTTP ${r.httpStatus}`);
    else errs.push(...t.checks(r.json).flat());
    record(t.id, errs.length === 0, r.ms, errs);
  } catch (e) {
    record(t.id, false, 0, [`exception: ${e?.message ?? e}`]);
  }
}

if (!SKIP_COPILOT) {
  console.log(`\n═ Étage B — bout-en-bout copilot (mode quick)${GOLDEN ? ' [GOLDEN]' : ''} ═`);
  if (!jwt) {
    console.error('✖ Étage B sauté : pas de JWT (TEST_EMAIL/TEST_PASSWORD requis).');
  } else {
    for (const t of COPILOT_TESTS.filter((t) => keep(t.id))) {
      try {
        const r = await callCopilot(t.question, jwt);
        if (DUMP) console.log(`--- ${t.id} HTTP ${r.httpStatus}\n${r.raw.slice(0, 2000)}\n---`);
        const errs = [];
        if (r.httpStatus !== 200) errs.push(`HTTP ${r.httpStatus}`);
        else {
          if (!toolCalled(r.raw, t.expectTool)) errs.push(`outil ${t.expectTool} jamais appelé (filtré du mode quick ? routage ?)`);
          const final = extractFinalText(r.raw);
          if (!final.trim()) errs.push('réponse finale VIDE (bug orchestration : synthèse coupée ?)');
          else if (!t.finalMatch.test(final)) errs.push(`réponse finale sans motif ${t.finalMatch}`);
        }
        record(t.id, errs.length === 0, r.ms, errs);
      } catch (e) {
        record(t.id, false, 0, [`exception: ${e?.message ?? e}`]);
      }
    }
  }
} else {
  console.log('\n(Étage B copilot sauté — --skip-copilot)');
}

/* ─────────────────────────────── Bilan ─────────────────────────────────── */

const fails = results.filter((r) => !r.ok);
console.log(`\n══════════════════════════════════════════`);
console.log(`${results.length - fails.length}/${results.length} PASS${fails.length ? ` — ${fails.length} FAIL: ${fails.map((f) => f.id).join(', ')}` : ' — tout est vert ✔'}`);
process.exit(fails.length ? 1 : 0);
