#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectToolNames } from '../supabase/functions/_shared/copilot-routing/selector.ts';
import { detectGeographicOverclaims } from '../supabase/functions/_shared/copilot-grounding/geographic.ts';
import { detectUnsupportedInferences } from '../supabase/functions/_shared/copilot-grounding/inferences.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const jsonOnly = args.includes('--json');
if (args.includes('--help')) {
  console.log('Usage: node scripts/copilot-eval.mjs [--results fichier.json|jsonl] [--json] [--thresholds fichier.json]');
  process.exit(0);
}

const cases = JSON.parse(await readFile(resolve(root, 'evals/copilot/golden-cases.json'), 'utf8'));
const thresholds = JSON.parse(await readFile(resolve(root, option('--thresholds') ?? 'evals/copilot/thresholds.json'), 'utf8'));
const allTools = [...new Set(cases.flatMap((c) => [...c.required_tools, ...(c.forbidden_tools ?? [])]).concat([
  'get_etude_parcelle','get_parcel_summary','get_parcel_plu','get_zonage_plu','get_prescriptions_urbanisme','get_servitudes','get_risks_georisques','get_ppr_detail','get_altimetrie','get_assainissement','get_classement_sonore','get_potentiel_solaire','get_monuments_historiques','get_batiment_bdnb','get_dpe_ademe','get_dvf_comparables','compute_smartscore','get_quick_market_insight','get_etude_marche','get_sitadel','get_logement_social','get_contexte_commune','get_zonage_abc','get_couts_renovation','get_couts_construction','get_loyers_reference','get_taxes_locales','get_equipements_proches','get_etablissements_proches','get_appels_offres','creer_veille_appels_offres','lister_veilles_appels_offres','lister_nouveautes_appels_offres','marquer_nouveautes_lues','desactiver_veille_appels_offres','recherche_biens','creer_zone_veille','lister_zones_veille','desactiver_zone_veille','creer_watchlist','lister_watchlists','desactiver_watchlist','action_navigate','action_create_operation'
]))];

const routingRows = cases.map((testCase) => {
  const selected = selectToolNames(testCase.question, allTools);
  const requiredFound = testCase.required_tools.filter((tool) => selected.toolNames.includes(tool));
  const forbiddenFound = (testCase.forbidden_tools ?? []).filter((tool) => selected.toolNames.includes(tool));
  return { id: testCase.id, expected_intent: testCase.expected_intent, actual_intent: selected.intent, intent_ok: selected.intent === testCase.expected_intent, required_found: requiredFound.length, required_total: testCase.required_tools.length, missing_tools: testCase.required_tools.filter((t) => !selected.toolNames.includes(t)), forbidden_tools: forbiddenFound, fallback: selected.isFallback };
});

const sum = (values) => values.reduce((a, b) => a + b, 0);
const ratio = (a, b) => b ? a / b : 1;
const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil((p / 100) * sorted.length) - 1];
};
const routing = {
  cases: cases.length,
  intent_accuracy: ratio(routingRows.filter((r) => r.intent_ok).length, routingRows.length),
  required_tool_recall: ratio(sum(routingRows.map((r) => r.required_found)), sum(routingRows.map((r) => r.required_total))),
  forbidden_tool_violations: sum(routingRows.map((r) => r.forbidden_tools.length)),
  fallback_rate: ratio(routingRows.filter((r) => r.fallback).length, routingRows.length),
};

async function loadResults(path) {
  if (!path) return [];
  const raw = await readFile(resolve(path), 'utf8');
  if (path.toLowerCase().endsWith('.jsonl')) return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : (parsed.results ?? []);
}

const sourcePattern = /(?:https?:\/\/|\bsource(?:s)?\b|\bDVF\b|\bADEME\b|\bINSEE\b|\bG[eé]orisques\b|\bPLU\b|\bBOAMP\b|\[[^\]]+\]\([^\)]+\))/i;
const limitPattern = /(?:limite|incert|à vérifier|a verifier|sous réserve|sous reserve|indisponible|estimation|hypothèse|hypothese|je ne dispose|donnée manquante|donnee manquante)/i;
const numberPattern = /(?:\b\d+(?:[.,]\d+)?\s*(?:%|€|m²|m2|ans?|mois|jours?)?\b)/;
const recorded = await loadResults(option('--results'));
const byId = new Map(cases.map((c) => [c.id, c]));
const responseRows = recorded.filter((r) => byId.has(r.case_id)).map((result) => {
  const testCase = byId.get(result.case_id);
  const response = String(result.response ?? '');
  const sentencesWithNumbers = response.split(/(?<=[.!?])\s+|\n+/).filter((s) => numberPattern.test(s));
  const uncitedNumberSentences = sentencesWithNumbers.filter((s) => !sourcePattern.test(s));
  const called = Array.isArray(result.tool_calls) ? result.tool_calls.map((t) => typeof t === 'string' ? t : t?.name).filter(Boolean) : [];
  const geographicOverclaims = detectGeographicOverclaims(response);
  const unsupportedInferences = detectUnsupportedInferences(response);
  return {
    id: result.case_id,
    source_required: testCase.response_requirements.requires_sources,
    limits_required: testCase.response_requirements.requires_limits,
    sources_ok: !testCase.response_requirements.requires_sources || sourcePattern.test(response),
    limits_ok: !testCase.response_requirements.requires_limits || limitPattern.test(response),
    phrases_ok: (testCase.response_requirements.required_phrases ?? []).every((p) => response.toLocaleLowerCase('fr').includes(p.toLocaleLowerCase('fr'))),
    required_tool_recall: ratio(testCase.required_tools.filter((t) => called.includes(t)).length, testCase.required_tools.length),
    uncited_number_sentences: uncitedNumberSentences.length,
    numbered_sentences: sentencesWithNumbers.length,
    geographic_overclaims: geographicOverclaims,
    unsupported_inferences: unsupportedInferences,
    latency_ms: Number.isFinite(result.latency_ms) ? result.latency_ms : null,
    input_tokens: Number.isFinite(result.input_tokens) ? result.input_tokens : null,
    output_tokens: Number.isFinite(result.output_tokens) ? result.output_tokens : null,
    cost: Number.isFinite(result.cost) ? result.cost : (Number.isFinite(result.cost_usd) ? result.cost_usd : null),
  };
});

const response = responseRows.length ? {
  evaluated: responseRows.length,
  source_citation_rate: ratio(responseRows.filter((r) => r.source_required && r.sources_ok).length, responseRows.filter((r) => r.source_required).length),
  limits_rate: ratio(responseRows.filter((r) => r.limits_required && r.limits_ok).length, responseRows.filter((r) => r.limits_required).length),
  required_phrase_rate: ratio(responseRows.filter((r) => r.phrases_ok).length, responseRows.length),
  required_tool_recall: ratio(sum(responseRows.map((r) => r.required_tool_recall)), responseRows.length),
  uncited_number_rate: ratio(sum(responseRows.map((r) => r.uncited_number_sentences)), sum(responseRows.map((r) => r.numbered_sentences))),
  geographic_overclaim_count: sum(responseRows.map((r) => r.geographic_overclaims.length)),
  geographic_overclaim_rate: ratio(responseRows.filter((r) => r.geographic_overclaims.length > 0).length, responseRows.length),
  unsupported_inference_count: sum(responseRows.map((r) => r.unsupported_inferences.length)),
  unsupported_inference_rate: ratio(responseRows.filter((r) => r.unsupported_inferences.length > 0).length, responseRows.length),
  latency_ms: { p50: percentile(responseRows.map((r) => r.latency_ms).filter(Number.isFinite), 50), p95: percentile(responseRows.map((r) => r.latency_ms).filter(Number.isFinite), 95) },
  tokens: { input: sum(responseRows.map((r) => r.input_tokens).filter(Number.isFinite)), output: sum(responseRows.map((r) => r.output_tokens).filter(Number.isFinite)) },
  cost: sum(responseRows.map((r) => r.cost).filter(Number.isFinite)),
} : null;

const checks = [
  ['intent_accuracy', routing.intent_accuracy >= thresholds.intent_accuracy_min, routing.intent_accuracy, `>= ${thresholds.intent_accuracy_min}`],
  ['required_tool_recall', routing.required_tool_recall >= thresholds.required_tool_recall_min, routing.required_tool_recall, `>= ${thresholds.required_tool_recall_min}`],
  ['forbidden_tool_violations', routing.forbidden_tool_violations <= thresholds.forbidden_tool_violations_max, routing.forbidden_tool_violations, `<= ${thresholds.forbidden_tool_violations_max}`],
  ['fallback_rate', routing.fallback_rate <= thresholds.fallback_rate_max, routing.fallback_rate, `<= ${thresholds.fallback_rate_max}`],
];
if (response) checks.push(
  ['source_citation_rate', response.source_citation_rate >= thresholds.source_citation_rate_min, response.source_citation_rate, `>= ${thresholds.source_citation_rate_min}`],
  ['limits_rate', response.limits_rate >= thresholds.limits_rate_min, response.limits_rate, `>= ${thresholds.limits_rate_min}`],
  ['uncited_number_rate', response.uncited_number_rate <= thresholds.uncited_number_rate_max, response.uncited_number_rate, `<= ${thresholds.uncited_number_rate_max}`],
  ['geographic_overclaim_count', response.geographic_overclaim_count <= thresholds.geographic_overclaim_count_max, response.geographic_overclaim_count, `<= ${thresholds.geographic_overclaim_count_max}`],
  ['unsupported_inference_count', response.unsupported_inference_count <= thresholds.unsupported_inference_count_max, response.unsupported_inference_count, `<= ${thresholds.unsupported_inference_count_max}`],
);
const failures = checks.filter(([, ok]) => !ok).map(([metric, , actual, expected]) => ({ metric, actual, expected }));
const report = { generated_at: new Date().toISOString(), dataset: 'evals/copilot/golden-cases.json', routing, response, thresholds, passed: failures.length === 0, failures, failed_cases: routingRows.filter((r) => !r.intent_ok || r.missing_tools.length || r.forbidden_tools.length), heuristic_notes: ['Une citation est détectée par URL, lien Markdown ou nom explicite de source publique.', 'Un chiffre est considéré non cité si sa phrase ne contient aucun marqueur de source.', 'Les formulations de limites sont détectées lexicalement; une revue humaine reste nécessaire.'] };

if (jsonOnly) console.log(JSON.stringify(report, null, 2));
else {
  const pct = (n) => `${(n * 100).toFixed(1)} %`;
  console.log(`Copilot eval — ${routing.cases} cas`);
  console.log(`Intentions        ${pct(routing.intent_accuracy)}`);
  console.log(`Rappel outils     ${pct(routing.required_tool_recall)}`);
  console.log(`Outils interdits  ${routing.forbidden_tool_violations}`);
  console.log(`Fallback          ${pct(routing.fallback_rate)}`);
  if (response) {
    console.log(`Citations         ${pct(response.source_citation_rate)}`);
    console.log(`Limites           ${pct(response.limits_rate)}`);
    console.log(`Chiffres non cités ${pct(response.uncited_number_rate)}`);
    console.log(`Suraffirmations géographiques ${response.geographic_overclaim_count} (${pct(response.geographic_overclaim_rate)})`);
    console.log(`Inférences non étayées ${response.unsupported_inference_count} (${pct(response.unsupported_inference_rate)})`);
    console.log(`Latence p50/p95   ${response.latency_ms.p50 ?? 'n/a'} / ${response.latency_ms.p95 ?? 'n/a'} ms`);
    console.log(`Tokens entrée/sortie ${response.tokens.input} / ${response.tokens.output}; coût ${response.cost || 'n/a'}`);
  }
  if (report.failed_cases.length) console.log(`Cas à revoir: ${report.failed_cases.map((r) => r.id).join(', ')}`);
  console.log(report.passed ? 'PASS — seuils respectés' : `FAIL — ${failures.map((f) => f.metric).join(', ')}`);
}
process.exitCode = report.passed ? 0 : 1;
