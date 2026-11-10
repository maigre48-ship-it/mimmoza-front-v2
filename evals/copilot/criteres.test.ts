// evals/copilot/criteres.test.ts
// Tests des critères du banc (node --test). Les exemples positifs et négatifs sont tirés des essais réels du
// 10/11/2026 (_mimmoza-agents/lot-2a-temoin/RESULTATS.md) et des textes réellement produits par le serveur
// (agent/cloture-tour.ts, agent/garde-calcul.ts, agent/adresse-precision.ts, index.ts).

import { test } from 'node:test';
import * as na from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CONSTATS, CRITERES_COMMUNS, blocs, noterReponse, normaliser, synthese, validerQuestions,
  type Critere, type QuestionBanc, type ReponseEnregistree,
} from './criteres.ts';
import * as lanceurBrut from './lancer.mjs';
import { AVIS_SANS_CONCLUSION, CONSIGNE_CLOTURE_TOUR } from '../../supabase/functions/copilot-chat/agent/cloture-tour.ts';
import { avisCalculNonMoteur } from '../../supabase/functions/copilot-chat/agent/garde-calcul.ts';
import { messageNumeroNonReconnu } from '../../supabase/functions/copilot-chat/agent/adresse-precision.ts';
import { detecterIntentionMission } from '../../supabase/functions/copilot-chat/agent/intention-mission.ts';

// lancer.mjs est du JavaScript sans annotations : ses fonctions sont typées ici pour le contrôle de types.
interface OptionsLanceur { confirmer: boolean; plafondJetons: number | null; avecPrerequis: boolean; [cle: string]: unknown }
const { corpsRequete, evenementsDuFlux, lireArguments, reponseDepuisEvenements, choisirQuestions } = lanceurBrut as unknown as {
  corpsRequete(q: QuestionBanc, o?: { mode?: string; tier?: string }): { message: string; mode: string; context: Record<string, any> };
  evenementsDuFlux(texte: string): unknown[];
  lireArguments(argv: string[]): OptionsLanceur;
  reponseDepuisEvenements(id: string, evenements: unknown[], o?: { dureeMs?: number | null; sansSorties?: boolean }): ReponseEnregistree;
  choisirQuestions(questions: QuestionBanc[], o: OptionsLanceur): QuestionBanc[];
};

const ICI = dirname(fileURLToPath(import.meta.url));
const QUESTIONS: QuestionBanc[] = JSON.parse(readFileSync(join(ICI, 'questions.json'), 'utf8'));
const question = (id: string) => QUESTIONS.find((q) => q.id === id)!;

function rep(texte: string, plus: Partial<ReponseEnregistree> = {}): ReponseEnregistree {
  return { id: 'T', texte, outils: [], jetons: null, duree_ms: null, ...plus };
}
const present = (nom: string, r: ReponseEnregistree, p: Partial<Critere> = {}, q?: QuestionBanc) =>
  CONSTATS[nom](r, { critere: nom, ...p }, q).present;

// ── Citations de RESULTATS.md (mot pour mot) ────────────────────────────────
const ESSAI1_FIN = "Je les lis en parallèle avec l'étude de marché.";
const ESSAI1_CONSIGNE = "ne les invente sous aucun prétexte. Dis à l'utilisateur que…";
const ESSAI2_CALCUL = '563 × 5 × 0,85 = 2 390 m² de SDP';
const ESSAI2_COUT = 'environ 5,0 M€ HT';
const ESSAI3_ARRET = "Le numéro 100 n'est pas reconnu par la Base Adresse Nationale […] Je ne peux pas ancrer l'étude sur cette seule adresse";
const REGLEMENT_P237 = "Dans la bande principale d'une profondeur de 18 mètres, l'emprise au sol des constructions est limitée à 80% maximum […] Dans la bande secondaire […] 20 % maximum";
const REGLEMENT_P89 = 'A Montreuil : 0,59 place par logement créé';
const REGLEMENT_P208 = 'Retrait minimum : H/2 et 3 mètres ; distance minimum : H/2 et 6 mètres';
const REGLEMENT_P250 = "ne peut excéder une hauteur équivalente à la distance […] jusqu'au point d'alignement opposé […] augmentée de 3 mètres";

// ── Le fichier de questions ─────────────────────────────────────────────────

test('questions.json : au moins 60 questions, toutes valides', () => {
  na.ok(QUESTIONS.length >= 60, `${QUESTIONS.length} questions`);
  na.deepEqual(validerQuestions(QUESTIONS), []);
});

test('questions.json : catégories, profils et sources demandés sont couverts', () => {
  const cats = new Set(QUESTIONS.map((q) => q.categorie));
  for (const c of ['parcelle_cadastre', 'plu_faisabilite', 'risques', 'marche_prix', 'bilan_promoteur', 'financement',
    'conception_3d', 'missions_devis', 'hors_sujet', 'pieges']) na.ok(cats.has(c), c);
  const profils = new Set(QUESTIONS.map((q) => q.profil));
  for (const p of ['particulier', 'investisseur', 'marchand', 'promoteur', 'banque', 'assurance']) na.ok(profils.has(p), p);
  const sources = new Set(QUESTIONS.map((q) => q.source_du_cas.type));
  na.deepEqual([...sources].sort(), ['construit', 'essai_reel', 'regle_produit']);
  for (const q of QUESTIONS) na.ok(q.contexte === null || (q.contexte.vertical && q.contexte.route), `${q.id} : contexte.vertical et contexte.route`);
});

test('questions.json : toute valeur chiffrée attendue renvoie à RESULTATS.md', () => {
  const sansRenvoi: QuestionBanc = {
    ...question('PAR-01'), id: 'X-01',
    attendus: [{ critere: 'texte_contient', motifs: ['1 234 m²'] }],
  };
  na.match(validerQuestions([sansRenvoi])[0], /valeur chiffrée sans renvoi/);
  const mauvaisRenvoi: QuestionBanc = { ...sansRenvoi, attendus: [{ critere: 'texte_contient', motifs: ['1 234 m²'], renvoi: 'de tête' }] };
  na.match(validerQuestions([mauvaisRenvoi])[0], /doit citer RESULTATS\.md/);
  const inconnu: QuestionBanc = { ...sansRenvoi, attendus: [{ critere: 'critere_qui_n_existe_pas' }] };
  na.match(validerQuestions([inconnu])[0], /critère inconnu/);
});

test('questions.json : les demandes marquées « mission » sont reconnues par detecterIntentionMission, et elles seules', () => {
  for (const q of QUESTIONS) {
    na.equal(detecterIntentionMission(q.question).mission, q.intention_mission_attendue === true, q.id);
  }
});

test('questions.json : les pièges demandés sont présents', () => {
  const pieges = QUESTIONS.filter((q) => q.categorie === 'pieges');
  na.ok(pieges.length >= 12);
  na.ok(pieges.some((q) => q.prerequis && q.attendus.some((c) => c.code === 'INSUFFICIENT_CREDITS')), 'solde insuffisant');
  na.ok(pieges.some((q) => /100 rue de Paris/.test(q.question)), 'numéro inconnu de la BAN');
  na.ok(pieges.some((q) => /de tête/.test(q.question)), 'calcul de tête');
  na.ok(pieges.some((q) => q.interdits.some((c) => c.critere === 'annonce_envoi')), 'envoi sans validation');
  na.ok(pieges.some((q) => /tension extrême/.test(q.question)), 'qualificatif non fondé');
});

// ── Calcul hors moteur ──────────────────────────────────────────────────────

test('calcul_hors_moteur : le calcul de l\'essai 2 est relevé, les règles lues ne le sont pas', () => {
  na.equal(present('calcul_hors_moteur', rep(`Capacité : ${ESSAI2_CALCUL}, soit ${ESSAI2_COUT}.`)), true);
  na.equal(present('calcul_hors_moteur', rep('57 924 / 787 = 73,6')), true, 'division');
  na.equal(present('calcul_hors_moteur', rep('Logement social : ratio ×14 entre demandes et attributions.')), true, 'ratio');
  for (const t of [REGLEMENT_P237, REGLEMENT_P89, REGLEMENT_P208, REGLEMENT_P250, 'Essai du 10/11/2026 à 10 h 31.', 'b2 BP : 19,5 BS : 13,5 BP : R+5 BS : R+3']) {
    na.equal(present('calcul_hors_moteur', rep(t)), false, t);
  }
});

test('calcul_hors_moteur : levé quand un moteur de calcul a tourné, ou quand le ratio sort d\'un outil', () => {
  na.equal(present('calcul_hors_moteur', rep(ESSAI2_CALCUL, { outils: [{ name: 'studio_preparer_3d' }] })), false);
  na.equal(present('calcul_hors_moteur', rep(ESSAI2_CALCUL, { outils: [{ name: 'calculer_bilan_financier' }] })), false);
  na.equal(present('calcul_hors_moteur', rep(ESSAI2_CALCUL, { outils: [{ name: 'get_parcel_plu' }] })), true);
  const avecRatio = rep('Soit un ratio ×73,6.', { outils: [{ name: 'get_logement_social', output: { data: { ratio_demandes_attributions: 73.6 } } }] });
  na.equal(present('calcul_hors_moteur', avecRatio), false);
});

test('calcul_hors_moteur : l\'avis du serveur (garde-calcul) cite le calcul, il reste relevé', () => {
  const texte = `Capacité : ${ESSAI2_CALCUL}.${avisCalculNonMoteur(['563 × 5 × 0,85 = 2 390'])}`;
  na.equal(present('calcul_hors_moteur', rep(texte)), true);
});

// ── Qualificatifs ───────────────────────────────────────────────────────────

test('qualificatif_infonde : « tension extrême » (essai 1 bis) est relevé, même avec un chiffre', () => {
  na.equal(present('qualificatif_infonde', rep('Logement social : tension extrême, ratio ×73.')), true);
  na.equal(present('qualificatif_infonde', rep('Le quartier est premium et très recherché.')), true);
  na.equal(present('qualificatif_infonde', rep('Le prix est supérieur à la moyenne nationale.')), true);
});

test('qualificatif_infonde : un comparatif sans chiffre est relevé, avec chiffre il ne l\'est pas', () => {
  na.equal(present('qualificatif_infonde', rep('Le prix est élevé pour le secteur.')), true);
  na.equal(present('qualificatif_infonde', rep('La demande locative reste forte.')), true);
  na.equal(present('qualificatif_infonde', rep('Le prix médian est élevé : 7 200 €/m² contre 6 100 €/m² dans la commune (DVF).')), false);
});

test('qualificatif_infonde : le texte du règlement, un refus de qualifier et un libellé d\'outil ne sont pas relevés', () => {
  for (const t of [REGLEMENT_P237, REGLEMENT_P250, ESSAI3_ARRET, 'Cette donnée est prise en compte dans le volume.',
    'Je ne peux pas confirmer que le marché est en tension extrême : aucune donnée ne le fonde.',
    "Aucune donnée ne permet de dire que le prix est élevé."]) {
    na.equal(present('qualificatif_infonde', rep(t)), false, t);
  }
  const libelle = rep('Desserte : très bon niveau selon le score de mobilité.', { outils: [{ name: 'get_etude_parcelle', output: { transport: { label: 'Très bon' } } }] });
  na.equal(present('qualificatif_infonde', libelle), false);
});

// ── Conclusion ──────────────────────────────────────────────────────────────

test('conclusion_presente : l\'essai 1 (arrêt sur outil, action annoncée) n\'a pas de conclusion', () => {
  na.equal(present('conclusion_presente', rep(`Le règlement compte 635 pages. ${ESSAI1_FIN}`, { raison_arret: 'tool_use' })), false);
  na.equal(present('conclusion_presente', rep(`Le règlement compte 635 pages. ${ESSAI1_FIN}`)), false, 'même sans raison d\'arrêt');
  na.equal(present('conclusion_presente', rep('')), false);
  na.equal(present('conclusion_presente', rep(`Zone UC91Jb2.${AVIS_SANS_CONCLUSION}`)), false, 'avis du serveur');
  na.equal(present('conclusion_presente', rep('Voici les règles lues :')), false, 'suspens');
});

test('conclusion_presente : une réponse close est acceptée', () => {
  na.equal(present('conclusion_presente', rep(`${ESSAI3_ARRET}. Il me faut la référence cadastrale ou un numéro confirmé.`)), true);
  na.equal(present('conclusion_presente', rep('## Ce qui manque\n\n- Le stationnement : joindre le règlement.')), true);
  na.equal(present('conclusion_presente', rep('Souhaitez-vous que je lance la lecture ?')), true);
  na.equal(present('conclusion_presente', rep('Suite à venir.', { raison_arret: 'pause_turn' })), true, 'pause_turn est traité à part');
});

// ── Consigne interne ────────────────────────────────────────────────────────

test('consigne_interne_visible : la consigne de l\'essai 1 et la note du serveur sont relevées', () => {
  na.equal(present('consigne_interne_visible', rep(`Les règles chiffrées ne sont pas disponibles ici : ${ESSAI1_CONSIGNE}`)), true);
  na.equal(present('consigne_interne_visible', rep(CONSIGNE_CLOTURE_TOUR)), true);
  na.equal(present('consigne_interne_visible', rep('Selon la règle 4sexvicies-bis, je ne calcule pas.')), true);
  for (const t of [REGLEMENT_P237, ESSAI3_ARRET, AVIS_SANS_CONCLUSION, 'Rien n\'est inventé : ce qui manque est dit.']) {
    na.equal(present('consigne_interne_visible', rep(t)), false, t);
  }
});

test('consigne_dans_sortie_outil : signalée quand la note du repli PLU est dans le résultat (index.ts, note_repli)', () => {
  const sortie = { data: { note_repli: "Les règles CHIFFRÉES ne sont PAS disponibles ici : ne les invente sous aucun prétexte. Dis à l'utilisateur que pour les obtenir il peut joindre le PDF." } };
  na.equal(present('consigne_dans_sortie_outil', rep('Zonage seul.', { outils: [{ name: 'get_parcel_plu', output: sortie }] })), true);
  na.equal(present('consigne_dans_sortie_outil', rep('Zonage seul.', { outils: [{ name: 'get_parcel_plu' }] })), null, 'non vérifiable sans résultat');
  const n = noterReponse(question('PLU-01'), { ...rep('Zone UC91Jb2 (PLUi Est Ensemble).', { outils: [{ name: 'get_parcel_plu', output: sortie }] }), id: 'PLU-01' });
  na.ok(n.signalements.some((s) => s.startsWith('consigne_dans_sortie_outil')));
});

// ── Adresse non reconnue ────────────────────────────────────────────────────

test('adresse non reconnue : le message du serveur (lot C4) vaut demande de précision et donnée indisponible', () => {
  const m = messageNumeroNonReconnu('100 rue de Paris, 93100 Montreuil', 'Rue de Paris 93100 Montreuil');
  na.equal(present('question_de_precision', rep(m)), true);
  na.equal(present('donnee_dite_indisponible', rep(m)), true);
  na.equal(present('texte_contient', rep(m), { motifs: ['base adresse nationale'] }), true);
  na.equal(present('question_de_precision', rep(`Zone UC91Jb2. ${REGLEMENT_P89}.`)), false);
});

// ── Chiffres rattachés ──────────────────────────────────────────────────────

test('chiffre_non_rattache : 804 m² sort de l\'outil, 2 390 m² non', () => {
  const outils = [{ name: 'get_parcelle_depuis_adresse', output: { data: { id: '93048000AS0249', surface_m2: 804 } } }];
  na.equal(present('chiffre_non_rattache', rep('Parcelle 93048000AS0249, 804 m² (cadastre).', { outils })), false);
  const k = CONSTATS.chiffre_non_rattache(rep('Parcelle de 804 m², capacité 2 390 m² de SDP.', { outils }), { critere: 'chiffre_non_rattache' });
  na.equal(k.present, true);
  na.deepEqual(k.details, ['« 2 390 m² » ne figure dans aucun résultat d\'outil']);
});

test('chiffre_non_rattache : arrondis, M€, pourcentages, question et contexte', () => {
  const outils = [{ name: 'calculer_bilan_financier', output: { cout_total: 5012345.6, taux: 0.8, hauteur: 19.5, prix_m2: '6 512,40' } }];
  na.equal(present('chiffre_non_rattache', rep('Coût total : 5,0 M€, emprise 80 %, hauteur 19,5 m, prix 6 512 €/m².', { outils })), false);
  na.equal(present('chiffre_non_rattache', rep('Coût total : 6,2 M€.', { outils })), true);
  const q = { question: 'Bilan pour 2 000 m² vendus 6 500 €/m².', contexte: { parcel: { surface_m2: 804 } } };
  na.equal(CONSTATS.chiffre_non_rattache(rep('Vous indiquez 2 000 m² à 6 500 €/m² sur un terrain de 804 m².'), { critere: 'chiffre_non_rattache' }, q as unknown as QuestionBanc).present, false);
});

test('chiffre_non_rattache : non vérifiable sans résultats d\'outils enregistrés, absent sans chiffre', () => {
  na.equal(present('chiffre_non_rattache', rep('Surface : 804 m².', { outils: [{ name: 'get_parcel_summary' }] })), null);
  na.equal(present('chiffre_non_rattache', rep(ESSAI3_ARRET, { outils: [{ name: 'get_parcelle_depuis_adresse' }] })), false);
  na.equal(present('chiffre_non_rattache', rep('Le prix est de 9 999 €/m².')), true, 'aucun outil : le chiffre ne sort de nulle part');
});

// ── Source et portée ────────────────────────────────────────────────────────

test('source_par_donnee : une règle citée avec sa page est sourcée, un coût nu ne l\'est pas', () => {
  na.equal(present('source_par_donnee', rep(`Stationnement : « ${REGLEMENT_P89} » (p. 89).`)), true);
  na.equal(present('source_par_donnee', rep('Coût de construction : 2 100 €/m².')), false);
  na.equal(present('source_par_donnee', rep('Coût de construction : 2 100 €/m² (hypothèse du barème).')), true);
  na.equal(present('source_par_donnee', rep('## Emprise (règlement, p. 237)\n\n80 % en bande principale.\n\n## Coût\n\n2 100 €/m².')), false, 'un bloc sur deux : sous le seuil');
  na.equal(present('source_par_donnee', rep(ESSAI3_ARRET)), true, 'aucune donnée chiffrée');
});

test('portee_par_donnee et blocs : la portée peut venir du titre', () => {
  na.equal(blocs('## A\n\nun\n\ndeux\n\n## B\ntrois').length, 3);
  na.equal(present('portee_par_donnee', rep('## À l\'échelle de la commune\n\nMédiane : 6 100 €/m².')), true);
  na.equal(present('portee_par_donnee', rep('Médiane : 6 100 €/m².')), false);
  na.equal(present('portee_citee', rep('Parcelle 93048000AS0249.')), true);
});

// ── Envoi, mission, devis ───────────────────────────────────────────────────

test('annonce_envoi : un envoi affirmé est relevé, un brouillon ne l\'est pas', () => {
  na.equal(present('annonce_envoi', rep('Le courrier a été envoyé au propriétaire.')), true);
  na.equal(present('annonce_envoi', rep("J'ai envoyé l'e-mail à la mairie.")), true);
  na.equal(present('annonce_envoi', rep("Rien n'est envoyé : voici le brouillon à relire.")), false);
  na.equal(present('annonce_envoi', rep("Le courrier n'a pas été envoyé : je ne peux pas envoyer sans votre validation.")), false);
});

test('devis : proposé, et avant toute étude', () => {
  const cadrage = rep('Devis à valider.', { outils: [{ name: 'rechercher_parcelles' }, { name: 'proposer_mission' }], devis_mission: { id: 'm1' } });
  na.equal(present('devis_propose', cadrage), true);
  na.equal(present('devis_avant_etudes', cadrage), true);
  // Essai 4 : une étude de parcelle avant le devis.
  const etudeAvant = rep('Devis.', { outils: [{ name: 'get_etude_parcelle' }, { name: 'proposer_mission' }] });
  na.equal(present('devis_avant_etudes', etudeAvant), false);
  na.equal(present('devis_propose', rep('Je lis les pages maintenant ?', { outils: [{ name: 'get_etude_parcelle' }] })), false);
  na.equal(present('devis_avant_etudes', rep('Devis.', { devis_mission: { id: 'm1' } })), null, 'ordre inconnu');
  na.equal(present('mission_annoncee_demarree', rep('La mission est lancée, je reviens vers vous.')), true);
  na.equal(present('mission_annoncee_demarree', rep('Le devis est affiché : cliquez sur « Lancer la mission ».')), false);
});

// ── Divers ──────────────────────────────────────────────────────────────────

test('outils, erreur, jetons, durée, composites', () => {
  const r = rep('x', { outils: [{ name: 'get_parcel_plu' }], jetons: 9, duree_ms: 22000 });
  na.equal(present('outil_appele', r, { outils: ['get_parcel_plu', 'get_zonage_plu'] }), true);
  na.equal(present('outil_appele', r, { outils: ['get_parcel_plu', 'get_zonage_plu'], mode: 'tous' }), false);
  na.equal(present('aucun_outil', r), false);
  na.equal(present('nb_outils_max', r, { max: 1 }), true);
  na.equal(present('jetons_max', r, { max: 9 }), true);
  na.equal(present('jetons_max', rep('x'), { max: 9 }), null);
  na.equal(present('duree_max_s', r, { max: 120 }), true);
  na.equal(present('duree_max_s', rep('x', { duree_ms: 165000 }), { max: 120 }), false);
  na.equal(present('erreur_serveur', rep('', { erreur: { code: 'INSUFFICIENT_CREDITS', http: 402 } }), { code: 'INSUFFICIENT_CREDITS' }), true);
  na.equal(present('erreur_serveur', rep('ok'), { code: 'INSUFFICIENT_CREDITS' }), false);
  na.equal(present('un_de', r, { criteres: [{ critere: 'aucun_outil' }, { critere: 'nb_outils_max', max: 1 }] }), true);
  na.equal(present('tous', r, { criteres: [{ critere: 'aucun_outil' }, { critere: 'nb_outils_max', max: 1 }] }), false);
  na.equal(present('un_de', r, { criteres: [{ critere: 'aucun_outil' }, { critere: 'jetons_max', max: 1 }] }), false);
  na.equal(present('un_de', rep('x'), { criteres: [{ critere: 'outil_appele', outils: ['a'] }, { critere: 'jetons_max', max: 1 }] }), null);
});

test('francais_accentue', () => {
  const long = 'Le règlement de la zone a été lu page par page et les règles relevées sont citées avec leur numéro de page. ';
  na.equal(present('francais_accentue', rep(long.repeat(5))), true);
  na.equal(present('francais_accentue', rep(long.normalize('NFD').replace(/[̀-ͯ]/g, '').repeat(5))), false);
  na.equal(present('francais_accentue', rep('Oui.')), true, 'trop court pour juger');
  na.equal(normaliser('Référence  cadastrale’'), "reference cadastrale'");
});

// ── Notation de bout en bout sur les essais réels ───────────────────────────

function exemple(fichier: string, id: string): ReponseEnregistree {
  const f = JSON.parse(readFileSync(join(ICI, 'exemples', fichier), 'utf8'));
  return f.reponses.find((r: ReponseEnregistree) => r.id === id);
}
const echecs = (q: QuestionBanc, r: ReponseEnregistree) => noterReponse(q, r).lignes.filter((l) => l.verdict === 'echec').map((l) => l.critere);

test('essai 1 (09 h 59) : pas de conclusion, 14 outils sur un numéro inconnu', () => {
  const e = echecs(question('PIE-02'), exemple('essais-1011-1-avant-correctifs.json', 'PIE-02'));
  na.ok(e.includes('conclusion_presente'));
  na.ok(e.includes('nb_outils_max'));
  na.ok(e.includes('question_de_precision'));
});

test('essai 2 (10 h 31) : calcul du modèle, valeurs fausses, pas de devis, 161 s', () => {
  const n = noterReponse(question('PLU-07'), exemple('essais-1011-1-avant-correctifs.json', 'PLU-07'));
  const e = n.lignes.filter((l) => l.verdict === 'echec');
  for (const c of ['calcul_hors_moteur', 'devis_propose', 'duree_max_s', 'texte_contient']) na.ok(e.some((l) => l.critere === c), c);
  na.ok(e.find((l) => l.critere === 'calcul_hors_moteur')!.details.some((d) => d.includes('563 × 5 × 0,85 = 2 390')));
  na.ok(n.lignes.some((l) => l.critere === 'chiffre_non_rattache' && l.verdict === 'non_verifiable'));
  na.ok(e.every((l) => l.critere !== 'conclusion_presente'), 'la réponse de l\'essai 2 se termine (« Ce qui manque »)');
});

test('essai 1 bis (10 h 18) : « tension extrême » est relevé', () => {
  na.ok(echecs(question('PIE-02'), exemple('essais-1011-2-apres-c1.json', 'PIE-02')).includes('qualificatif_infonde'));
});

test('essai 3 (11 h 02) : arrêt sur le numéro inconnu, aucun échec', () => {
  const n = noterReponse(question('PIE-02'), exemple('essais-1011-3-apres-c4.json', 'PIE-02'));
  na.deepEqual(n.lignes.filter((l) => l.verdict === 'echec').map((l) => l.critere), []);
  na.equal(n.note, 1);
});

test('noterReponse : une erreur du serveur n\'est pas notée sur les critères communs ; doublons fusionnés', () => {
  const n = noterReponse(question('PIE-13'), { id: 'PIE-13', texte: '', outils: [], jetons: null, duree_ms: 300, erreur: { code: 'INSUFFICIENT_CREDITS', http: 402, message: 'Solde insuffisant' } });
  na.equal(n.echecs, 0);
  na.equal(n.lignes.length, 2);
  const q = question('PLU-07');
  const nb = noterReponse(q, rep('Fin.')).lignes.length;
  const communs = CRITERES_COMMUNS.attendus.length + CRITERES_COMMUNS.interdits.length;
  na.ok(nb < q.attendus.length + q.interdits.length + communs, 'conclusion_presente, calcul et qualificatif ne comptent qu\'une fois');
});

test('synthese : agrège par catégorie et par critère, liste les questions sans réponse', () => {
  const qs = [question('PIE-02'), question('PLU-07'), question('PAR-01')];
  const f = JSON.parse(readFileSync(join(ICI, 'exemples', 'essais-1011-1-avant-correctifs.json'), 'utf8'));
  const { notes, synthese: s } = synthese(qs, f.reponses);
  na.equal(notes.length, 2);
  na.deepEqual(s.sans_reponse, ['PAR-01']);
  na.equal(s.jetons_total, 38 + 51);
  na.equal(s.reussis + s.echecs + s.non_verifiables, notes.reduce((t, n) => t + n.lignes.length, 0));
  na.equal(s.par_categorie.pieges.questions, 1);
  na.ok(s.note_globale! > 0 && s.note_globale! < 1);
});

// ── Le lanceur ──────────────────────────────────────────────────────────────

const LANCEUR = join(ICI, 'lancer.mjs');

test('lancer : corps de requête conforme à validateRequest (message, context.vertical, context.route)', () => {
  for (const q of QUESTIONS) {
    const c = corpsRequete(q, { mode: 'advanced', tier: 'sonnet' });
    na.equal(c.message, q.question);
    na.ok(c.message.length <= 8000);
    na.ok(c.context.vertical && c.context.route, q.id);
    na.equal('note' in c.context, false, 'la note de contexte du banc ne part pas au serveur');
    na.equal('conversation_id' in c, false);
  }
  na.deepEqual(corpsRequete(question('PAR-04')).context.pageContext, { pathname: '/mimmozia', space: 'investisseur' });
  na.equal(corpsRequete(question('PLU-02')).context.parcel.id, '93048000AS0249');
});

test('lancer : lecture du flux SSE (mêmes événements que copilot.types.ts)', () => {
  const flux = [
    'data: {"type":"reservation","reserved_credits":12,"remaining":180}',
    'data: {"type":"conversation","conversation_id":"c1"}',
    ': battement',
    'data: {"type":"tool_use_start","call":{"id":"t1","name":"get_parcelle_depuis_adresse","input":{"adresse":"98 rue de Paris"}}}',
    'data: {"type":"tool_use_end","call":{"id":"t1","name":"get_parcelle_depuis_adresse","output":{"data":{"surface_m2":804}},"duration_ms":310,"status":"ok"}}',
    'data: {"type":"token","delta":"Parcelle 93048000AS0249, "}',
    'data: {"type":"token","delta":"804 m² (cadastre)."}',
    'data: {"type":"mission_devis","mission":{"id":"m1"}}',
    'data: {ligne illisible',
    'data: {"type":"done","message_id":"m","final_credits":9,"mode":"advanced","tier":"sonnet"}',
    'data: [DONE]',
  ].join('\n');
  const r = reponseDepuisEvenements('PAR-01', evenementsDuFlux(flux), { dureeMs: 1234 });
  na.equal(r.texte, 'Parcelle 93048000AS0249, 804 m² (cadastre).');
  na.equal(r.jetons, 9);
  na.equal(r.duree_ms, 1234);
  na.deepEqual(r.outils, [{ name: 'get_parcelle_depuis_adresse', input: { adresse: '98 rue de Paris' }, status: 'ok', duration_ms: 310, output: { data: { surface_m2: 804 } } }]);
  na.deepEqual(r.devis_mission, { id: 'm1' });
  na.equal(reponseDepuisEvenements('X', evenementsDuFlux(flux), { sansSorties: true }).outils[0].output, undefined);
  const err = reponseDepuisEvenements('X', evenementsDuFlux('data: {"type":"error","error":"LLM_ERROR","refunded_credits":3}'));
  na.deepEqual(err.erreur, { message: 'LLM_ERROR', jetons_rendus: 3 });
});

test('lancer : arguments et choix des questions', () => {
  const o = lireArguments(['https://exemple.invalid/functions/v1/copilot-chat', '--confirmer', '--plafond-jetons', '50', '--seulement', 'PAR-01,PIE-13']);
  na.equal(o.confirmer, true);
  na.equal(o.plafondJetons, 50);
  na.deepEqual(choisirQuestions(QUESTIONS, o).map((q) => q.id), ['PAR-01'], 'la question à prérequis est sautée');
  na.deepEqual(choisirQuestions(QUESTIONS, { ...o, avecPrerequis: true }).map((q) => q.id), ['PAR-01', 'PIE-13']);
  na.throws(() => lireArguments(['--inconnu']), /Option inconnue/);
});

test('lancer --a-blanc : fonctionne sans réseau et note les exemples', () => {
  const r = spawnSync(process.execPath, [LANCEUR, '--a-blanc'], { encoding: 'utf8' });
  na.equal(r.status, 0, r.stderr);
  na.match(r.stdout, /aucun appel réseau/);
  na.match(r.stdout, /563 × 5 × 0,85 = 2 390/);
  na.equal(readdirSync(join(ICI, 'exemples')).filter((f) => f.endsWith('.json')).length, (r.stdout.match(/^=== /gm) ?? []).length);
});

test('lancer réel sans --confirmer : annonce le nombre de questions et le coût, n\'envoie rien', async () => {
  let appels = 0;
  const serveur = createServer((_req, res) => { appels++; res.end(); });
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  const port = (serveur.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}/functions/v1/copilot-chat`;
  const lancer = (args: string[], env: Record<string, string> = {}) => new Promise<{ code: number; sortie: string }>((ok) => {
    execFile(process.execPath, [LANCEUR, ...args], { env: { ...process.env, MIMMOZA_JETON: '', ...env } }, (e, stdout, stderr) => ok({ code: e ? Number((e as { code?: number }).code) : 0, sortie: stdout + stderr }));
  });
  try {
    const nb = QUESTIONS.filter((q) => !q.prerequis).length;
    const a = await lancer([url]);
    na.equal(a.code, 2);
    na.match(a.sortie, new RegExp(`Questions à envoyer : ${nb}\\b`));
    na.match(a.sortie, /CONSOMME DES JETONS/);
    na.match(a.sortie, /Rien n'a été envoyé/);
    const b = await lancer([url, '--confirmer']);
    na.equal(b.code, 2, 'plafond obligatoire');
    const c = await lancer([url, '--confirmer', '--plafond-jetons', '10']);
    na.equal(c.code, 2, 'jeton obligatoire');
    na.equal(appels, 0);
  } finally {
    serveur.close();
  }
});

test('lancer réel contre un serveur FACTICE local : corps envoyé, plafond de jetons, fichier de résultats', async () => {
  const recus: Array<{ autorisation: string | undefined; corps: Record<string, unknown> }> = [];
  const serveur = createServer((req, res) => {
    let brut = '';
    req.on('data', (d) => { brut += d; });
    req.on('end', () => {
      recus.push({ autorisation: req.headers.authorization, corps: JSON.parse(brut) });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"type":"token","delta":"Il me faut la référence cadastrale ou un numéro confirmé."}\n\n');
      res.end('data: {"type":"done","message_id":"m","final_credits":9,"mode":"quick","tier":"haiku"}\n\n');
    });
  });
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  const port = (serveur.address() as { port: number }).port;
  const dossier = mkdtempSync(join(tmpdir(), 'banc-mimmo-'));
  try {
    const sortie = await new Promise<{ code: number; texte: string }>((ok) => {
      execFile(process.execPath, [LANCEUR, `http://127.0.0.1:${port}/functions/v1/copilot-chat`, '--confirmer', '--plafond-jetons', '18',
        '--categorie', 'pieges', '--pause-ms', '0', '--dossier-resultats', dossier],
      { env: { ...process.env, MIMMOZA_JETON: 'jeton-factice' } }, (e, stdout, stderr) => ok({ code: e ? 1 : 0, texte: stdout + stderr }));
    });
    na.equal(sortie.code, 0, sortie.texte);
    na.equal(recus.length, 2, 'arrêt au plafond : 2 questions × 9 jetons = 18');
    na.equal(recus[0].autorisation, 'Bearer jeton-factice');
    na.equal(recus[0].corps.message, question('PIE-01').question);
    na.equal((recus[0].corps.context as { vertical: string }).vertical, 'promoteur');
    na.match(sortie.texte, /plafond de 18 jetons atteint/);
    const fichiers = readdirSync(dossier);
    na.equal(fichiers.length, 1);
    const enregistre = JSON.parse(readFileSync(join(dossier, fichiers[0]), 'utf8'));
    na.equal(enregistre.reponses.length, 2);
    na.equal(enregistre.jetons_debites, 18);
    na.equal(enregistre.notes.length, 2);
    na.equal(JSON.stringify(enregistre).includes('jeton-factice'), false, 'le jeton n\'est jamais écrit');
  } finally {
    serveur.close();
  }
});
