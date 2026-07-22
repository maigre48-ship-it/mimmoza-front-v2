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

  // ══════════════════════════════════════════════════════════════════════════
  // ÉTUDE DE PARCELLE v4 — qualification, cohérence, verdict, plan d'action
  // --------------------------------------------------------------------------
  // Quatre scénarios de LOCALISATION, chacun contrôlé par les mêmes invariants
  // structurels (contratEtudeV4) plus ses assertions propres.
  //
  // ⚠️ Les scénarios de DONNÉE (inondation, PPR/PPRI contradictoires, servitude
  // intersectante, monument à proximité, DVF extrêmes, timeout, échec partiel)
  // ne peuvent pas être FORCÉS depuis l'extérieur : ils dépendent de ce que les
  // API amont renvoient le jour du run, et le harnais n'a pas de couche de
  // simulation. Ils sont donc exprimés en INVARIANTS CONDITIONNELS dans
  // invariantsEtude() : « si la donnée X apparaît, alors la règle Y doit tenir ».
  // C'est ce qu'on veut réellement vérifier en non-régression — la règle, pas la
  // présence fortuite d'un aléa sur la commune étalon. Chaque invariant se tait
  // quand son déclencheur est absent, et échoue bruyamment quand il est présent
  // et que la règle est violée.
  //   → lancer ciblé : node tests/harness.mjs --only etude
  // ══════════════════════════════════════════════════════════════════════════
  {
    // Cas 1 — parcelle localisée à la parcelle (IDU valide).
    id: 'etude-parcelle',
    slug: 'etude-parcelle-v1',
    payload: { cadastral_ref: IDU },
    checks: (j) => [
      ...contratEtudeStatus(j),
      ...contratEtudeV4(j),
      ...invariantsEtude(j),
      ...(GOLDEN ? [
        mustMatch(String(j?.stats?.precision ?? ''), /^parcelle$/, "precision='parcelle' (IDU résolu au cadastre)"),
        num(j?.stats?.parcelle?.surface_m2, 'contenance cadastrale'),
      ] : []),
    ],
  },
  {
    // Cas 2 — parcelle NON localisée : repli centre commune, et surtout les
    // sources `needs: 'geo'` ne doivent PAS avoir été interrogées (sinon les
    // servitudes du centre-bourg passeraient pour parcellaires).
    id: 'etude-commune',
    slug: 'etude-parcelle-v1',
    payload: { code_insee: INSEE },
    checks: (j) => {
      const errs = [...contratEtudeStatus(j), ...contratEtudeV4(j), ...invariantsEtude(j)];
      if (j?.stats?.precision !== 'centre_commune') {
        errs.push(`precision attendue 'centre_commune', reçue '${j?.stats?.precision}'`);
      }
      // GARDE DE PRÉCISION — la régression la plus dangereuse du lot.
      const ko = (j?.stats?.sources_indisponibles ?? []).map((s) => s.cle);
      for (const geo of ['servitudes', 'bruit']) {
        if (!ko.includes(geo)) {
          errs.push(`GARDE DE PRÉCISION ROMPUE : source geo '${geo}' interrogée sans localisation parcellaire`);
        }
      }
      // Les données géométriques ne doivent jamais être portées 'parcel' ici.
      for (const id of ['altitude', 'pente', 'potentiel_solaire']) {
        const e = evEtude(j, id);
        if (e && e.scope === 'parcel') errs.push(`'${id}' porté 'parcel' alors que precision='centre_commune'`);
        if (e && e.status === 'confirmed') errs.push(`'${id}' déclaré 'confirmed' alors que mesuré au centre commune`);
      }
      return errs;
    },
  },
  {
    // Cas 3 — référence cadastrale invalide (section/numéro inexistants). Le
    // code INSEE reste dérivable des 5 premiers caractères → repli commune
    // attendu, jamais une erreur ni une surface inventée.
    id: 'etude-idu-invalide',
    slug: 'etude-parcelle-v1',
    payload: { cadastral_ref: '64065000ZZ9999' },
    checks: (j) => {
      const errs = [...contratEtudeStatus(j), ...contratEtudeV4(j), ...invariantsEtude(j)];
      if (j?.stats?.precision === 'parcelle') {
        errs.push("precision='parcelle' sur un IDU inexistant : le cadastre a été considéré comme résolu à tort");
      }
      if (j?.stats?.parcelle?.surface_m2 != null) {
        errs.push('une contenance est renvoyée pour une parcelle inexistante (valeur inventée)');
      }
      const surf = evEtude(j, 'surface_cadastrale');
      if (surf && surf.status !== 'unavailable') {
        errs.push(`surface_cadastrale devrait être 'unavailable', reçue '${surf.status}'`);
      }
      return errs;
    },
  },
  {
    // Cas 4 — aucune localisation exploitable. Contrat de sortie spécifique :
    // status 'no_localization', stats null, HTTP 200 quand même.
    id: 'etude-sans-localisation',
    slug: 'etude-parcelle-v1',
    payload: {},
    checks: (j) => {
      const errs = [];
      if (j?.status !== 'no_localization') errs.push(`status attendu 'no_localization', reçu '${j?.status}'`);
      if (typeof j?.summary !== 'string' || !j.summary.trim()) errs.push('summary absent ou vide');
      if (j?.stats !== null) errs.push('stats devrait être null sans localisation');
      if (!Array.isArray(j?.items) || j.items.length) errs.push('items devrait être un tableau vide');
      return errs;
    },
  },
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

/* ───────────────── Assertions étude de parcelle v4 ─────────────────────── */

const SCOPES = ['parcel', 'nearby', 'municipality', 'intermunicipality', 'department', 'national'];
const STATUSES = ['confirmed', 'estimated', 'unavailable', 'contradictory', 'not_applicable'];

/** Retrouve un DataEvidence par son id. */
function evEtude(j, id) {
  return (j?.stats?.evidences ?? []).find((e) => e?.id === id);
}
/** Retrouve une contradiction par son id. */
function contraEtude(j, id) {
  return (j?.stats?.coherence?.contradictions ?? []).find((c) => c?.id === id);
}

/**
 * INVARIANTS STRUCTURELS — vrais pour toute étude, quelle que soit la commune.
 * Couvre : compatibilité ascendante v3, présence des quatre couches v4, et les
 * règles de portée NON NÉGOCIABLES (une donnée communale ne peut jamais être
 * portée 'parcel').
 */
function contratEtudeV4(j) {
  const e = [];
  const s = j?.stats;
  if (!s || typeof s !== 'object') return ['stats absent — les couches v4 ne peuvent pas être vérifiées'];

  // ── Compatibilité ascendante : aucun champ v3 ne doit avoir disparu ──
  for (const champ of ['parcelle', 'precision', 'sources_ok', 'sources_sans_donnee',
    'sources_indisponibles', 'duree_ms', 'avertissements', 'note_methode']) {
    if (s[champ] === undefined) e.push(`RÉGRESSION v3 : stats.${champ} a disparu`);
  }
  for (const champ of ['idu', 'code_insee', 'commune', 'surface_m2', 'lat', 'lon']) {
    if (s.parcelle && s.parcelle[champ] === undefined) e.push(`RÉGRESSION v3 : stats.parcelle.${champ} a disparu`);
  }
  if (!Array.isArray(j?.items)) e.push('RÉGRESSION v3 : items n\'est pas un tableau');
  for (const it of j?.items ?? []) {
    for (const champ of ['cle', 'label', 'status', 'summary', 'stats', 'duree_ms']) {
      if (it[champ] === undefined) e.push(`RÉGRESSION v3 : items[${it.cle}].${champ} a disparu`);
    }
  }

  // ── Couche 1 : qualification ──
  if (!Array.isArray(s.evidences) || !s.evidences.length) {
    e.push('stats.evidences absent ou vide');
  } else {
    for (const ev of s.evidences) {
      if (!ev.id) { e.push('une evidence sans id'); continue; }
      if (!STATUSES.includes(ev.status)) e.push(`evidence '${ev.id}' : status invalide '${ev.status}'`);
      if (!SCOPES.includes(ev.scope)) e.push(`evidence '${ev.id}' : scope invalide '${ev.scope}'`);
      if (typeof ev.confidence !== 'number' || ev.confidence < 0 || ev.confidence > 100) {
        e.push(`evidence '${ev.id}' : confidence hors bornes (${ev.confidence})`);
      }
      if (typeof ev.source !== 'string' || !ev.source.trim()) e.push(`evidence '${ev.id}' : source non renseignée`);
      if (ev.value === undefined) e.push(`evidence '${ev.id}' : champ value absent (doit valoir null si inconnu)`);
      // Une donnée absente ne doit jamais porter de confiance résiduelle.
      if ((ev.status === 'unavailable' || ev.status === 'not_applicable') && ev.confidence !== 0) {
        e.push(`evidence '${ev.id}' : status '${ev.status}' mais confidence ${ev.confidence} (doit être 0)`);
      }
    }
  }

  // ── RÈGLES DE PORTÉE NON NÉGOCIABLES ──
  for (const id of ['assainissement', 'loyers_reference', 'zonage_abc', 'fiscalite_tfb']) {
    const ev = evEtude(j, id);
    if (ev && ev.scope !== 'municipality') {
      e.push(`PORTÉE VIOLÉE : '${id}' doit être 'municipality', reçu '${ev.scope}'`);
    }
  }
  for (const ev of s.evidences ?? []) {
    if (ev.id?.startsWith('risque_') && ev.scope !== 'municipality') {
      e.push(`PORTÉE VIOLÉE : '${ev.id}' (Géorisques) doit être 'municipality', reçu '${ev.scope}'`);
    }
  }
  // Servitudes et bruit : 'parcel' EXIGE une intersection démontrée.
  for (const id of ['servitudes', 'classement_sonore']) {
    const ev = evEtude(j, id);
    if (ev && ev.scope === 'parcel' && ev.value?.intersection_demontree !== true) {
      e.push(`PORTÉE VIOLÉE : '${id}' porté 'parcel' sans intersection démontrée`);
    }
  }
  // Le monument à proximité ne devient 'parcel' qu'avec intersection démontrée.
  const mon = evEtude(j, 'monument_historique');
  if (mon && mon.scope === 'parcel' && mon.value?.intersection_demontree !== true) {
    e.push("PORTÉE VIOLÉE : 'monument_historique' porté 'parcel' sans intersection démontrée");
  }

  // ── Couche 2 : cohérence ──
  if (!s.coherence || !Array.isArray(s.coherence.contradictions)) {
    e.push('stats.coherence.contradictions absent');
  } else {
    for (const c of s.coherence.contradictions) {
      if (!['bloquante', 'importante'].includes(c.gravite)) e.push(`contradiction '${c.id}' : gravité invalide '${c.gravite}'`);
      if (!c.verification || !c.organisme) e.push(`contradiction '${c.id}' : document opposable ou organisme manquant`);
      // Toute contradiction doit remonter dans les avertissements (exigence).
      if (!(s.avertissements ?? []).includes(c.message)) {
        e.push(`contradiction '${c.id}' absente de stats.avertissements`);
      }
    }
  }

  // ── Couche 3 : verdict — trois indicateurs SÉPARÉS ──
  const v = s.verdict;
  if (!v) e.push('stats.verdict absent');
  else {
    if (!['favorable', 'intermediaire', 'defavorable'].includes(v.potentiel?.niveau)) {
      e.push(`verdict.potentiel.niveau invalide : '${v.potentiel?.niveau}'`);
    }
    if (!['faible', 'modere', 'eleve', 'bloquant', 'indetermine'].includes(v.risque?.niveau)) {
      e.push(`verdict.risque.niveau invalide : '${v.risque?.niveau}'`);
    }
    if (typeof v.fiabilite?.score !== 'number' || v.fiabilite.score < 0 || v.fiabilite.score > 100) {
      e.push(`verdict.fiabilite.score hors bornes : ${v.fiabilite?.score}`);
    }
    if (!['poursuivre', 'poursuivre_sous_conditions', 'suspendre', 'ecarter'].includes(v.recommandation?.valeur)) {
      e.push(`verdict.recommandation.valeur invalide : '${v.recommandation?.valeur}'`);
    }
    // Aucun score global unique ne doit réapparaître.
    if (v.score_global !== undefined) e.push('un score global unique est réapparu dans le verdict (interdit)');
    // Les formules doivent être exposées pour que MimmozIA puisse les restituer.
    for (const k of ['potentiel', 'risque', 'fiabilite', 'recommandation']) {
      if (!v[k]?.formule) e.push(`verdict.${k}.formule non exposée`);
    }
    for (const k of ['potentiel', 'risque', 'fiabilite']) {
      if (!Array.isArray(v[k]?.facteurs)) e.push(`verdict.${k}.facteurs non exposés`);
    }
    // CONSTRUCTIBILITÉ : toujours indéterminable tant que le PLU n'est pas là.
    if (v.constructibilite?.statut !== 'indeterminable') {
      e.push(`constructibilité '${v.constructibilite?.statut}' : doit valoir 'indeterminable' sans règlement PLU`);
    }
  }

  // ── Couche 4 : plan d'action ──
  if (!Array.isArray(s.plan_action) || !s.plan_action.length) {
    e.push('stats.plan_action absent ou vide');
  } else {
    let rangPrec = -1;
    const rang = { bloquante: 0, importante: 1, recommandee: 2 };
    for (const a of s.plan_action) {
      if (!(a.priorite in rang)) { e.push(`action : priorité invalide '${a.priorite}'`); continue; }
      if (rang[a.priorite] < rangPrec) e.push('plan_action non trié par priorité décroissante');
      rangPrec = rang[a.priorite];
      for (const champ of ['action', 'motif', 'organisme', 'document']) {
        if (!a[champ] || !String(a[champ]).trim()) e.push(`action '${a.action}' : champ ${champ} vide`);
      }
      // Aucune action générique : le motif doit référencer un constat de l'étude.
      if (!/constat de cette étude|contradiction détectée/i.test(String(a.motif))) {
        e.push(`action '${a.action}' : motif non rattaché à un constat de cette étude`);
      }
    }
  }

  // ── Traçabilité ──
  if (!Array.isArray(s.tableau_sources) || !s.tableau_sources.length) {
    e.push('stats.tableau_sources absent ou vide');
  } else {
    for (const l of s.tableau_sources) {
      for (const champ of ['donnee', 'organisme', 'jeu_de_donnees', 'portee', 'statut']) {
        if (l[champ] === undefined || l[champ] === null || l[champ] === '') e.push(`tableau_sources : champ ${champ} vide (${l.donnee})`);
      }
      if (!SCOPES.includes(l.portee)) e.push(`tableau_sources '${l.donnee}' : portée invalide '${l.portee}'`);
    }
  }

  return e;
}

/**
 * INVARIANTS CONDITIONNELS — chacun correspond à un scénario métier du cahier
 * des charges. Ils se taisent quand leur déclencheur est absent de la réponse
 * du jour, et échouent quand il est présent et que la règle est violée.
 */
function invariantsEtude(j) {
  const e = [];
  const s = j?.stats ?? {};
  const v = s.verdict ?? {};
  const ko = (s.sources_indisponibles ?? []).map((x) => x.cle);
  const okc = s.sources_ok ?? [];

  // ── Scénario : risque d'inondation détecté ──
  const inond = evEtude(j, 'risque_inondation');
  if (inond?.value?.zone_inondable === true) {
    if (!['eleve', 'bloquant'].includes(v.risque?.niveau)) {
      e.push(`zone inondable détectée mais risque='${v.risque?.niveau}' (attendu 'eleve' ou 'bloquant')`);
    }
    if (inond.value.ppri === true && v.risque?.niveau !== 'bloquant') {
      e.push("zone inondable AVEC PPRI mais risque ≠ 'bloquant' (la règle bloquante est absorbante)");
    }
    // Un score de sécurité élevé ne doit jamais avoir masqué l'aléa.
    const sec = evEtude(j, 'score_securite');
    if (typeof sec?.value === 'number' && sec.value >= 70 && !contraEtude(j, 'inondable_vs_score')) {
      e.push('zone inondable + score de sécurité ≥ 70 sans contradiction déclarée (masquage possible)');
    }
  }

  // ── Scénario : données PPR / PPRI contradictoires ──
  if (contraEtude(j, 'ppr_vs_ppri')) {
    const ppr = evEtude(j, 'risque_ppr');
    if (ppr && ppr.status !== 'contradictory' && ppr.status !== 'unavailable') {
      e.push(`contradiction PPR/PPRI détectée mais evidence risque_ppr en '${ppr.status}' (attendu 'contradictory')`);
    }
    if (!(s.plan_action ?? []).some((a) => /lever la contradiction/i.test(a.action) && a.priorite === 'bloquante')) {
      e.push('contradiction PPR/PPRI sans action de vérification bloquante correspondante');
    }
  }

  // ── Scénario : servitude réellement intersectante ──
  const serv = evEtude(j, 'servitudes');
  if (serv?.value?.intersection_demontree === true) {
    if (serv.scope !== 'parcel') e.push("servitude intersectante démontrée mais scope ≠ 'parcel'");
    if (v.risque?.niveau !== 'bloquant') e.push("servitude intersectante démontrée mais risque ≠ 'bloquant'");
  }

  // ── Scénario : monument UNIQUEMENT à proximité ──
  const mon = evEtude(j, 'monument_historique');
  if (mon && mon.value?.intersection_demontree !== true) {
    if (!contraEtude(j, 'monument_proximite')) {
      e.push('monument signalé sans intersection démontrée, mais aucune réserve de proximité déclarée');
    }
    if (!/proximit/i.test(String(mon.warning ?? ''))) {
      e.push("monument à proximité : la réserve ne dit pas explicitement qu'il n'y a pas d'intersection");
    }
  }

  // ── Scénario : assainissement collectif communal, non confirmé à la parcelle ──
  const assain = evEtude(j, 'assainissement');
  if (assain && assain.status !== 'unavailable') {
    if (assain.scope !== 'municipality') e.push("assainissement porté ailleurs qu'en 'municipality'");
    if (!/ne vaut PAS raccordement|raccordabilité/i.test(String(assain.warning ?? ''))) {
      e.push('assainissement sans réserve interdisant la lecture « parcelle raccordable »');
    }
    if (!(s.plan_action ?? []).some((a) => /raccordement au droit de la parcelle|filière d'assainissement non collectif/i.test(a.action))) {
      e.push('assainissement connu mais aucune action de vérification de la desserte à la parcelle');
    }
  }

  // ── Scénario : comparables DVF avec valeurs extrêmes / catégories mêlées ──
  const q = s.qualite_dvf;
  if (q) {
    if (typeof q.extremes_ecartes !== 'number' || q.extremes_ecartes < 0) e.push('qualite_dvf.extremes_ecartes invalide');
    if (q.extremes_ecartes > 0 && !q.reserves?.some((r) => /extrême/i.test(r))) {
      e.push('valeurs extrêmes écartées sans réserve correspondante');
    }
    if (q.echantillon_heterogene && !q.reserves?.some((r) => /catégories/i.test(r))) {
      e.push('échantillon multi-catégories sans réserve correspondante');
    }
    const dvf = evEtude(j, 'dvf_prix_m2');
    if (dvf && (q.echantillon_heterogene || (q.nb_comparables ?? 0) < 5) && dvf.status === 'confirmed') {
      e.push("échantillon DVF hétérogène ou insuffisant mais evidence dvf_prix_m2 en 'confirmed'");
    }
  }

  // ── Scénario : règlement PLU absent → constructibilité indéterminable ──
  const plu = evEtude(j, 'reglement_plu');
  if (!plu) e.push("l'absence de règlement PLU n'est pas déclarée comme donnée manquante");
  else if (plu.status !== 'unavailable') e.push(`reglement_plu en '${plu.status}' : doit rester 'unavailable'`);
  if (!(s.plan_action ?? []).some((a) => /règlement PLU opposable/i.test(a.action) && a.priorite === 'bloquante')) {
    e.push("PLU absent mais aucune action bloquante « consulter le règlement PLU opposable »");
  }

  // ── Scénario : échec partiel d'une API — le rapport sort quand même ──
  if (ko.length && okc.length && j?.status !== 'ok') {
    e.push(`échec partiel (${ko.length} source(s) ko) mais status='${j?.status}' au lieu de 'ok'`);
  }
  if (ko.length && !(s.avertissements ?? []).some((a) => /absence de donnée ne vaut pas absence de contrainte/i.test(a))) {
    e.push("sources indisponibles sans l'avertissement « l'absence de donnée ne vaut pas absence de contrainte »");
  }

  // ── Scénario : timeout d'une source lente ──
  for (const x of s.sources_indisponibles ?? []) {
    if (/timeout/i.test(String(x.motif ?? ''))) {
      if (!(s.plan_action ?? []).some((a) => new RegExp(x.cle, 'i').test(a.motif) || /source indisponible/i.test(a.motif))) {
        e.push(`source '${x.cle}' en timeout sans action de repli dans le plan`);
      }
    }
  }

  // ── Règle : source risques absente ⇒ risque JAMAIS 'faible' ──
  if (ko.includes('risques')) {
    if (v.risque?.niveau !== 'indetermine') {
      e.push(`source risques indisponible mais risque='${v.risque?.niveau}' (attendu 'indetermine')`);
    }
    if (v.recommandation?.valeur !== 'suspendre') {
      e.push(`risque indéterminé mais recommandation='${v.recommandation?.valeur}' (attendu 'suspendre')`);
    }
  }

  // ── Règle : bloquant absorbant, et pas de « favorable » sur données trouées ──
  if (v.risque?.niveau === 'bloquant' && !['suspendre', 'ecarter'].includes(v.recommandation?.valeur)) {
    e.push(`risque bloquant mais recommandation='${v.recommandation?.valeur}'`);
  }
  if (typeof v.fiabilite?.score === 'number' && v.fiabilite.score < 40 && v.potentiel?.niveau === 'favorable') {
    e.push(`potentiel 'favorable' avec une fiabilité de ${v.fiabilite.score}/100 (plafonnement non appliqué)`);
  }

  // ── Règle : aucune capacité constructive ne doit être AVANCÉE ──
  // On exclut verdict.constructibilite : c'est le bloc qui EXPLIQUE pourquoi
  // aucune capacité n'est calculable, il cite donc légitimement ces termes.
  const { constructibilite: _ignore, ...verdictSansConstructibilite } = v;
  if (/surface de plancher|capacité constructive|emprise au sol maximale|\bCOS\b/i.test(JSON.stringify(verdictSansConstructibilite))) {
    e.push('le verdict avance une capacité constructive alors que le PLU est absent');
  }

  return e;
}

/**
 * Statut de sortie attendu. 'error' n'est légitime QUE si aucune source n'a
 * produit de donnée — c'est la dégradation totale prévue par le contrat v3
 * (l'étude sort quand même son verdict et son plan d'action). Si au moins une
 * source répond et que le statut reste 'error', c'est une régression.
 */
function contratEtudeStatus(j) {
  const s = j?.stats ?? {};
  const err = [];
  if (typeof j?.summary !== 'string' || !j.summary.trim()) err.push('summary absent ou vide');
  // Le verdict doit être lisible dans le summary : c'est la seule partie que
  // le LLM lit à coup sûr quand le payload est tronqué.
  else if (!/Verdict — potentiel .+ risque .+ fiabilité des données/i.test(j.summary)) {
    err.push('summary sans le verdict à trois indicateurs');
  }
  const nbExploitables = (s.sources_ok ?? []).length + (s.sources_sans_donnee ?? []).length;
  if (['ok', 'no_data'].includes(j?.status)) return err;
  if (j?.status === 'error' && nbExploitables === 0) {
    console.log(`      ℹ ${(s.sources_indisponibles ?? []).length} source(s) indisponible(s) → status 'error' (dégradation totale, verdict tout de même produit)`);
    return [];
  }
  return [`status '${j?.status}' avec ${nbExploitables} source(s) exploitable(s)`];
}

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
