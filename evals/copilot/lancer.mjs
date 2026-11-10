#!/usr/bin/env node
// evals/copilot/lancer.mjs
// =============================================================
// Banc d'évaluation de Mimmo (lot 1.A, 10/11/2026) — lanceur.
//
// Deux modes :
//   · --a-blanc : AUCUN appel réseau. Lit des réponses déjà enregistrées
//     (par défaut les fichiers de evals/copilot/exemples/) et affiche les notes.
//   · réel : rejoue les questions contre l'URL de l'Edge Function copilot-chat
//     passée en argument, avec le jeton de session lu dans la variable
//     d'environnement MIMMOZA_JETON. CHAQUE QUESTION CONSOMME DES JETONS.
//     Exige --confirmer ET --plafond-jetons <N>.
//
// Usage :
//   node evals/copilot/lancer.mjs --a-blanc [--reponses <fichier.json>]
//   node evals/copilot/lancer.mjs <url> --confirmer --plafond-jetons 300 [--seulement PAR-01,PIE-02]
//
// Voir LISEZMOI.md pour le détail des options et la lecture des notes.
// =============================================================

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { synthese, validerQuestions } from './criteres.ts';

const ICI = dirname(fileURLToPath(import.meta.url));

// Coût relevé par message lors des essais réels du 10/11 (RESULTATS.md) : de 9 jetons (arrêt sur une adresse
// non reconnue, essai 3) à 56 jetons (étude complète, essai 1 bis).
const JETONS_PAR_QUESTION_RELEVES = { min: 9, max: 56 };

// ─── Arguments ───────────────────────────────────────────────────────────────

export function lireArguments(argv) {
  const o = {
    url: null, aBlanc: false, confirmer: false, reponses: null, seulement: null, categorie: null, max: null,
    plafondJetons: null, mode: 'quick', tier: null, pauseMs: 2000, delaiS: 300, avecPrerequis: false,
    sansSorties: false, dossierResultats: join(ICI, 'resultats'), questions: join(ICI, 'questions.json'), aide: false,
  };
  const valeur = (i, nom) => {
    if (i + 1 >= argv.length) throw new Error(`Option ${nom} : valeur manquante.`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--a-blanc') o.aBlanc = true;
    else if (a === '--confirmer') o.confirmer = true;
    else if (a === '--avec-prerequis') o.avecPrerequis = true;
    else if (a === '--sans-sorties') o.sansSorties = true;
    else if (a === '--aide' || a === '-h' || a === '--help') o.aide = true;
    else if (a === '--reponses') o.reponses = valeur(i++, a);
    else if (a === '--seulement') o.seulement = valeur(i++, a).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--categorie') o.categorie = valeur(i++, a);
    else if (a === '--max') o.max = Number(valeur(i++, a));
    else if (a === '--plafond-jetons') o.plafondJetons = Number(valeur(i++, a));
    else if (a === '--mode') o.mode = valeur(i++, a);
    else if (a === '--tier') o.tier = valeur(i++, a);
    else if (a === '--pause-ms') o.pauseMs = Number(valeur(i++, a));
    else if (a === '--delai-s') o.delaiS = Number(valeur(i++, a));
    else if (a === '--dossier-resultats') o.dossierResultats = resolve(valeur(i++, a));
    else if (a === '--questions') o.questions = resolve(valeur(i++, a));
    else if (a.startsWith('--')) throw new Error(`Option inconnue : ${a}`);
    else if (!o.url) o.url = a;
    else throw new Error(`Argument en trop : ${a}`);
  }
  return o;
}

const AIDE = `Banc d'évaluation de Mimmo

  À blanc (aucun appel réseau, aucun jeton) :
    node evals/copilot/lancer.mjs --a-blanc [--reponses <fichier.json>]

  Réel (CONSOMME DES JETONS sur le compte du jeton fourni) :
    MIMMOZA_JETON=<jeton de session> node evals/copilot/lancer.mjs <url de copilot-chat> --confirmer --plafond-jetons <N>

  Options :
    --seulement PAR-01,PIE-02   ne lancer que ces questions
    --categorie pieges          ne lancer qu'une catégorie
    --max 10                    au plus N questions
    --plafond-jetons 300        arrêt dès que le total débité atteint N (obligatoire en réel)
    --mode quick|advanced       mode demandé (le serveur le redéfinit selon le plan)
    --tier haiku|sonnet|opus    niveau de modèle demandé (revalidé par le serveur)
    --pause-ms 2000             pause entre deux questions
    --delai-s 300               délai maximal d'une réponse
    --avec-prerequis            inclure les questions à prérequis (solde bas…)
    --sans-sorties              ne pas enregistrer les résultats d'outils (données personnelles)
    --dossier-resultats <dir>   dossier d'écriture (défaut : evals/copilot/resultats)
`;

// ─── Questions ───────────────────────────────────────────────────────────────

export function chargerQuestions(chemin) {
  const questions = JSON.parse(readFileSync(chemin, 'utf8'));
  const erreurs = validerQuestions(questions);
  if (erreurs.length) throw new Error(`questions.json invalide :\n  - ${erreurs.join('\n  - ')}`);
  return questions;
}

export function choisirQuestions(questions, o) {
  let q = questions;
  if (o.seulement) q = q.filter((x) => o.seulement.includes(x.id));
  if (o.categorie) q = q.filter((x) => x.categorie === o.categorie);
  if (!o.avecPrerequis) q = q.filter((x) => !x.prerequis);
  if (o.max != null && Number.isFinite(o.max)) q = q.slice(0, o.max);
  return q;
}

// ─── Corps de la requête ─────────────────────────────────────────────────────

/**
 * Corps envoyé à copilot-chat pour une question. Forme relevée dans le site :
 *   · src/spaces/copilot/lib/copilotClient.ts (streamCopilotChat, buildEnrichedContext) ;
 *   · src/spaces/copilot/types/copilot.types.ts (CopilotChatRequest, MimmozaContext) ;
 *   · supabase/functions/copilot-chat/index.ts (validateRequest : message, context.vertical et context.route requis).
 * SUPPOSÉ : `project_followup: null` (le site y met le résultat de followupContext, non reproduit ici) ;
 * pas de `conversation_id` (chaque question ouvre une conversation neuve) ; pas de `promoteur_chain`.
 */
export function corpsRequete(question, o = {}) {
  const c = question.contexte ?? {};
  const { note: _note, ...contexte } = c;
  return {
    message: question.question,
    mode: o.mode ?? 'quick',
    ...(o.tier ? { tier: o.tier } : {}),
    context: {
      ...contexte,
      vertical: contexte.vertical ?? 'generique',
      route: contexte.route ?? '/mimmozia',
      predictive_snapshot: null,
      valuation_engine: null,
      project_followup: null,
    },
  };
}

// ─── Flux SSE ────────────────────────────────────────────────────────────────

/** Événements d'un flux SSE déjà reçu en entier (même logique que src/spaces/copilot/lib/streamParser.ts). */
export function evenementsDuFlux(texte) {
  const evenements = [];
  for (const ligne of texte.split('\n')) {
    const t = ligne.trim();
    if (!t.startsWith('data:')) continue;
    const charge = t.slice(5).trim();
    if (!charge || charge === '[DONE]') continue;
    try { evenements.push(JSON.parse(charge)); } catch { /* ligne illisible : ignorée, comme sur le site */ }
  }
  return evenements;
}

/** Assemble une réponse enregistrée à partir des événements du flux. */
export function reponseDepuisEvenements(id, evenements, { dureeMs = null, sansSorties = false } = {}) {
  const r = { id, texte: '', outils: [], jetons: null, duree_ms: dureeMs, raison_arret: null, devis_mission: null, erreur: null };
  const parId = new Map();
  for (const e of evenements) {
    if (e.type === 'token') r.texte += e.delta ?? '';
    else if (e.type === 'tool_use_start') {
      const outil = { name: e.call?.name, input: e.call?.input };
      parId.set(e.call?.id, outil);
      r.outils.push(outil);
    } else if (e.type === 'tool_use_end') {
      let outil = parId.get(e.call?.id);
      if (!outil) { outil = { name: e.call?.name }; r.outils.push(outil); }
      outil.status = e.call?.status;
      outil.duration_ms = e.call?.duration_ms;
      if (e.call?.error) outil.error = e.call.error;
      if (!sansSorties) outil.output = e.call?.output;
    } else if (e.type === 'mission_devis') r.devis_mission = e.mission ?? e.devis ?? e;
    else if (e.type === 'reservation') r.jetons_reserves = e.reserved_credits;
    else if (e.type === 'conversation') r.conversation_id = e.conversation_id;
    else if (e.type === 'done') { r.jetons = e.final_credits ?? null; r.mode_applique = e.mode; r.tier_applique = e.tier; }
    else if (e.type === 'error') r.erreur = { message: e.error, ...(e.refunded_credits != null ? { jetons_rendus: e.refunded_credits } : {}) };
  }
  return r;
}

async function interroger(url, entetes, question, o) {
  const debut = Date.now();
  const controle = new AbortController();
  const minuteur = setTimeout(() => controle.abort(), o.delaiS * 1000);
  try {
    const res = await fetch(url, { method: 'POST', headers: entetes, body: JSON.stringify(corpsRequete(question, o)), signal: controle.signal });
    if (!res.ok) {
      let code; let message = `Erreur ${res.status}`;
      try { const j = await res.json(); code = j.code; message = j.message ?? message; } catch { /* corps non JSON */ }
      return { id: question.id, texte: '', outils: [], jetons: null, duree_ms: Date.now() - debut, raison_arret: null, devis_mission: null, erreur: { code, message, http: res.status } };
    }
    const texte = await res.text();
    return reponseDepuisEvenements(question.id, evenementsDuFlux(texte), { dureeMs: Date.now() - debut, sansSorties: o.sansSorties });
  } catch (err) {
    return { id: question.id, texte: '', outils: [], jetons: null, duree_ms: Date.now() - debut, raison_arret: null, devis_mission: null, erreur: { code: 'RESEAU', message: String(err?.message ?? err) } };
  } finally {
    clearTimeout(minuteur);
  }
}

// ─── Tableau de notes ────────────────────────────────────────────────────────

const pct = (n) => (n == null ? '   —' : `${String(Math.round(n * 100)).padStart(3)} %`);

export function tableauDeNotes(questions, reponses, titre) {
  const { notes, synthese: s } = synthese(questions, reponses);
  const lignes = [];
  lignes.push(`\n=== ${titre} ===`);
  lignes.push(`${'Question'.padEnd(8)} ${'Catégorie'.padEnd(18)} ${'Note'.padStart(5)}  OK  KO  NV  Jetons  Durée  Échecs`);
  const parId = new Map(reponses.map((r) => [r.id, r]));
  const categorie = new Map(questions.map((q) => [q.id, q.categorie]));
  for (const n of notes) {
    const r = parId.get(n.id);
    const echecs = n.lignes.filter((l) => l.verdict === 'echec').map((l) => (l.origine.includes('interdit') ? `interdit:${l.critere}` : `attendu:${l.critere}`));
    lignes.push(
      `${n.id.padEnd(8)} ${(categorie.get(n.id) ?? '').padEnd(18)} ${pct(n.note)} ${String(n.reussis).padStart(3)} ${String(n.echecs).padStart(3)} ${String(n.non_verifiables).padStart(3)} ` +
      `${String(r?.jetons ?? '—').padStart(6)} ${(r?.duree_ms != null ? `${Math.round(r.duree_ms / 1000)} s` : '—').padStart(6)}  ${echecs.join(', ')}`);
    for (const l of n.lignes.filter((x) => x.verdict === 'echec')) {
      for (const d of l.details.slice(0, 3)) lignes.push(`${' '.repeat(10)}· ${l.critere} : ${d}`);
    }
    for (const sg of n.signalements) lignes.push(`${' '.repeat(10)}! signalement — ${sg}`);
  }
  lignes.push('');
  lignes.push(`Questions notées : ${s.notees} sur ${s.questions}` + (s.sans_reponse.length ? ` (sans réponse enregistrée : ${s.sans_reponse.length})` : ''));
  lignes.push(`Critères : ${s.reussis} réussis, ${s.echecs} en échec, ${s.non_verifiables} non vérifiables — note globale ${pct(s.note_globale).trim()}`);
  lignes.push(`Questions sans aucun échec : ${s.questions_sans_echec} sur ${s.notees}`);
  if (s.jetons_total != null) lignes.push(`Jetons débités : ${s.jetons_total}`);
  if (s.duree_mediane_s != null) lignes.push(`Durée médiane : ${s.duree_mediane_s} s`);
  if (Object.keys(s.par_categorie).length) {
    lignes.push('\nPar catégorie :');
    for (const [nom, c] of Object.entries(s.par_categorie)) {
      lignes.push(`  ${nom.padEnd(18)} ${String(c.questions).padStart(3)} question(s)  ${pct(c.note)}  (${c.reussis} OK, ${c.echecs} KO, ${c.non_verifiables} NV)`);
    }
    lignes.push('\nPar critère (échecs d\'abord) :');
    const tri = Object.entries(s.par_critere).sort((a, b) => b[1].echecs - a[1].echecs || a[0].localeCompare(b[0]));
    for (const [nom, c] of tri) lignes.push(`  ${nom.padEnd(28)} ${String(c.reussis).padStart(3)} OK ${String(c.echecs).padStart(3)} KO ${String(c.non_verifiables).padStart(3)} NV`);
  }
  return { texte: lignes.join('\n'), notes, synthese: s };
}

// ─── Modes ───────────────────────────────────────────────────────────────────

function lireReponses(chemin) {
  const brut = JSON.parse(readFileSync(chemin, 'utf8'));
  const reponses = Array.isArray(brut) ? brut : brut.reponses;
  if (!Array.isArray(reponses)) throw new Error(`${chemin} : ni tableau, ni objet { "reponses": [...] }.`);
  return { titre: brut.titre ?? chemin, reponses };
}

function modeABlanc(o, questions) {
  const fichiers = o.reponses
    ? [resolve(o.reponses)]
    : readdirSync(join(ICI, 'exemples')).filter((f) => f.endsWith('.json')).sort().map((f) => join(ICI, 'exemples', f));
  console.log(`Mode à blanc : aucun appel réseau, aucun jeton consommé. ${questions.length} questions au banc.`);
  for (const f of fichiers) {
    const { titre, reponses } = lireReponses(f);
    const connues = new Set(questions.map((q) => q.id));
    const inconnues = reponses.filter((r) => !connues.has(r.id)).map((r) => r.id);
    if (inconnues.length) console.log(`Attention : réponses sans question correspondante, ignorées : ${inconnues.join(', ')}`);
    const concernees = questions.filter((q) => reponses.some((r) => r.id === q.id));
    console.log(tableauDeNotes(concernees, reponses, `${titre} — ${reponses.length} réponse(s) enregistrée(s)`).texte);
  }
  return 0;
}

async function modeReel(o, questions) {
  const choisies = choisirQuestions(questions, o);
  const sautees = questions.filter((q) => q.prerequis && !o.avecPrerequis).length;
  console.log(`Banc d'évaluation de Mimmo — lancement RÉEL contre : ${o.url}`);
  console.log(`Questions à envoyer : ${choisies.length}` + (sautees ? ` (${sautees} à prérequis sautée(s))` : ''));
  console.log('ATTENTION : chaque question est un vrai message envoyé à Mimmo et CONSOMME DES JETONS sur le compte du jeton fourni.');
  console.log(`Relevé du 10/11 (RESULTATS.md) : de ${JETONS_PAR_QUESTION_RELEVES.min} à ${JETONS_PAR_QUESTION_RELEVES.max} jetons par message. ` +
    `Pour ${choisies.length} questions : entre ${choisies.length * JETONS_PAR_QUESTION_RELEVES.min} et ${choisies.length * JETONS_PAR_QUESTION_RELEVES.max} jetons si ces coûts se répètent (ordre d'idée, non garanti).`);
  console.log("N'utilisez jamais un compte personnel : certaines réponses écrivent en mémoire de projet ou proposent des missions.");
  if (!o.confirmer) {
    console.log('\nRien n\'a été envoyé. Pour lancer réellement, ajoutez --confirmer et --plafond-jetons <N>.');
    return 2;
  }
  if (!Number.isFinite(o.plafondJetons) || o.plafondJetons <= 0) {
    console.log('\nRien n\'a été envoyé. --plafond-jetons <N> est obligatoire : le banc s\'arrête dès que le total débité atteint N.');
    return 2;
  }
  const jeton = process.env.MIMMOZA_JETON;
  if (!jeton) {
    console.log('\nRien n\'a été envoyé. La variable d\'environnement MIMMOZA_JETON (jeton de session du compte de test) est absente.');
    return 2;
  }
  if (!/copilot-chat\/?$/.test(new URL(o.url).pathname)) {
    console.log(`\nRien n'a été envoyé. L'URL doit être celle de la fonction (…/functions/v1/copilot-chat), reçue : ${o.url}`);
    return 2;
  }
  const entetes = { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' };
  // Le site ajoute l'en-tête `apikey` (clé publique du projet) quand elle est configurée.
  if (process.env.MIMMOZA_CLE_PUBLIQUE) entetes.apikey = process.env.MIMMOZA_CLE_PUBLIQUE;

  const reponses = [];
  let jetons = 0;
  let arret = null;
  for (const [i, q] of choisies.entries()) {
    if (jetons >= o.plafondJetons) { arret = `plafond de ${o.plafondJetons} jetons atteint après ${i} question(s)`; break; }
    process.stdout.write(`[${i + 1}/${choisies.length}] ${q.id} … `);
    const r = await interroger(o.url, entetes, q, o);
    reponses.push(r);
    jetons += r.jetons ?? 0;
    console.log(r.erreur ? `erreur ${r.erreur.code ?? r.erreur.http ?? ''} ${r.erreur.message ?? ''}` : `${r.jetons ?? '?'} jeton(s), ${Math.round((r.duree_ms ?? 0) / 1000)} s, ${r.outils.length} outil(s) — total ${jetons}`);
    if (r.erreur?.http === 401) { arret = 'jeton refusé (401) : session expirée ?'; break; }
    if (r.erreur?.http === 402 && !q.prerequis) { arret = 'solde insuffisant (402)'; break; }
    if (i < choisies.length - 1) await new Promise((ok) => setTimeout(ok, o.pauseMs));
  }
  if (arret) console.log(`\nArrêt anticipé : ${arret}.`);

  const lancees = choisies.filter((q) => reponses.some((r) => r.id === q.id));
  const date = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const t = tableauDeNotes(lancees, reponses, `Passage réel du ${date} — ${reponses.length} réponse(s)`);
  mkdirSync(o.dossierResultats, { recursive: true });
  const fichier = join(o.dossierResultats, `${date}.json`);
  writeFileSync(fichier, JSON.stringify({
    titre: `Passage réel du ${date}`,
    date,
    hote: new URL(o.url).host,
    mode_demande: o.mode, tier_demande: o.tier,
    arret_anticipe: arret,
    questions_prevues: choisies.length,
    jetons_debites: jetons,
    synthese: t.synthese,
    notes: t.notes,
    reponses,
  }, null, 1));
  console.log(t.texte);
  console.log(`\nRéponses et notes enregistrées dans : ${fichier}`);
  console.log('Ce fichier peut contenir des données personnelles (propriétaires, adresses) : ne le publiez pas.');
  return 0;
}

export async function principal(argv) {
  let o;
  try { o = lireArguments(argv); } catch (e) { console.error(String(e.message ?? e)); console.error(AIDE); return 1; }
  if (o.aide) { console.log(AIDE); return 0; }
  const questions = chargerQuestions(o.questions);
  if (o.aBlanc) {
    if (o.url || o.confirmer) { console.error('--a-blanc ne se combine ni avec une URL ni avec --confirmer.'); return 1; }
    return modeABlanc(o, questions);
  }
  if (!o.url) { console.error('Indiquez --a-blanc, ou l\'URL de copilot-chat pour un lancement réel.\n'); console.error(AIDE); return 1; }
  return await modeReel(o, questions);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e); process.exitCode = 1; });
}
