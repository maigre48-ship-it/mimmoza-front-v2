// evals/copilot/criteres.ts
// =============================================================
// Banc d'évaluation de Mimmo (lot 1.A, 10/11/2026) — critères de notation.
//
// Ce module est PUR et DÉTERMINISTE : aucun accès réseau, aucune horloge, aucun
// hasard. Il note une réponse ENREGISTRÉE (texte + outils appelés + jetons +
// durée) selon les règles du produit :
//   · aucune donnée inventée (un chiffre doit sortir d'un outil, de la question
//     ou du contexte) ;
//   · aucun qualificatif ni étalon de comparaison non déductible des données ;
//   · chaque donnée a une portée (parcelle / à proximité / commune) et une source ;
//   · le modèle ne calcule pas (réutilise agent/garde-calcul.ts, sans le modifier) ;
//   · la réponse se termine par une conclusion (réutilise agent/cloture-tour.ts) ;
//   · aucune consigne interne n'est visible ;
//   · un devis précède toute mission ; rien n'est « envoyé » sans validation.
//
// Un CONSTAT est un fait observé sur la réponse (present = true / false), ou
// `null` quand l'enregistrement ne permet pas de trancher (« non vérifiable »).
// Un ATTENDU réussit si son constat est présent ; un INTERDIT réussit s'il est
// absent. Les constats sont des heuristiques lexicales : un signal de
// régression, pas une preuve de justesse (voir LISEZMOI.md, « Limites »).
// =============================================================

import {
  calculParMoteur,
  expressionsCalculees,
} from '../../supabase/functions/copilot-chat/agent/garde-calcul.ts';
import {
  AVIS_SANS_CONCLUSION,
  clotureSansConclusion,
} from '../../supabase/functions/copilot-chat/agent/cloture-tour.ts';
import { OUTILS_CADRAGE_MISSION } from '../../supabase/functions/copilot-chat/agent/intention-mission.ts';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OutilAppele {
  name: string;
  input?: unknown;
  /** Résultat de l'outil tel que diffusé (`tool_use_end.call.output`). Absent si non enregistré. */
  output?: unknown;
  status?: string;
  duration_ms?: number;
  error?: string;
}

export interface ReponseEnregistree {
  /** Identifiant de la question du banc. */
  id: string;
  texte: string;
  outils: OutilAppele[];
  /** Jetons débités (`done.final_credits`) ; null si inconnu. */
  jetons: number | null;
  duree_ms: number | null;
  /** Raison d'arrêt du modèle. Le flux du site ne la diffuse pas : null le plus souvent. */
  raison_arret?: string | null;
  /** Carte de devis reçue (`mission_devis`), le cas échéant. */
  devis_mission?: unknown;
  /** Erreur renvoyée par le serveur (HTTP ou événement `error`). */
  erreur?: { code?: string; message?: string; http?: number } | null;
}

export interface Critere {
  critere: string;
  /** Renvoi obligatoire dès qu'un paramètre porte une valeur chiffrée (voir validerQuestions). */
  renvoi?: string;
  libelle?: string;
  [parametre: string]: unknown;
}

export interface QuestionBanc {
  id: string;
  profil: string;
  categorie: string;
  question: string;
  contexte: Record<string, unknown> | null;
  attendus: Critere[];
  interdits: Critere[];
  source_du_cas: { type: string; renvoi: string };
  /** Condition de lancement réel (compte à solde bas, etc.). La question est sautée par défaut. */
  prerequis?: string;
  /** Vrai si `detecterIntentionMission` doit reconnaître la demande (vérifié par test). */
  intention_mission_attendue?: boolean;
  /** Noms de critères communs à ne pas appliquer à cette question. */
  sans_criteres_communs?: string[];
}

export interface Constat {
  /** true : le fait est observé ; false : il ne l'est pas ; null : non vérifiable. */
  present: boolean | null;
  details: string[];
}

export type Verdict = 'ok' | 'echec' | 'non_verifiable';

export interface LigneNote {
  origine: 'attendu' | 'interdit' | 'commun_attendu' | 'commun_interdit';
  critere: string;
  verdict: Verdict;
  details: string[];
  renvoi?: string;
}

export interface NoteQuestion {
  id: string;
  lignes: LigneNote[];
  reussis: number;
  echecs: number;
  non_verifiables: number;
  /** reussis / (reussis + echecs) ; null si rien n'est vérifiable. */
  note: number | null;
  signalements: string[];
}

// ─── Outils de texte ─────────────────────────────────────────────────────────

/** Minuscules, sans accents, espaces et apostrophes normalisés (même convention que intention-mission.ts). */
export function normaliser(t: string): string {
  return (t ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[   ]/g, ' ')
    .replace(/[ \t]+/g, ' ');
}

/** Phrases d'un texte (coupe sur la ponctuation forte et les sauts de ligne). */
export function phrases(texte: string): string[] {
  return (texte ?? '')
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function sortiesEnregistrees(r: ReponseEnregistree): boolean {
  return r.outils.some((o) => o.output !== undefined);
}

function texteDesSorties(r: ReponseEnregistree): string {
  return r.outils.map((o) => (o.output === undefined ? '' : JSON.stringify(o.output))).join('\n');
}

function liste(p: unknown): string[] {
  return Array.isArray(p) ? p.map(String) : p == null ? [] : [String(p)];
}

// ─── Qualificatifs et étalons de comparaison ─────────────────────────────────

// Étalons et superlatifs : jamais déductibles d'une donnée seule. Relevés quel que soit le contexte,
// sauf si le terme figure tel quel dans un résultat d'outil (libellé officiel) ou si la phrase le refuse.
const RE_ETALONS: RegExp[] = [
  /\btension (?:extreme|tres forte|maximale)\b/g,
  /\bextremement\b/g,
  /\bexceptionnel(?:le)?s?\b/g,
  /\bexcellente?s?\b/g,
  /\bpremium\b/g,
  /\b(?:quartier|secteur|bien|adresse|commune|rue|tres|plus|particulierement|si) prisee?s?\b/g,
  /\bideal(?:e|ement)?\b/g,
  /\btres (?:recherche|demande|tendu|attractif|dynamique|eleve|faible|cher|abordable|rentable|bon|porteur)e?s?\b/g,
  /\b(?:au[- ]dessus|en[- ]dessous|au[- ]dela) de la moyenne\b/g,
  /\b(?:superieure?s?|inferieure?s?) a la moyenne\b/g,
  /\bmoyenne (?:nationale|departementale|regionale)\b/g,
  /\bordre de grandeur habituel\b/g,
  /\bclasse aisee\b/g,
  /\bfiscalite favorable\b/g,
  /\bmarche (?:tendu|dynamique|porteur|atone|sature)\b/g,
  /\b(?:secteur|quartier|emplacement) (?:prise|recherche|porteur|attractif|privilegie|strategique|de choix)e?s?\b/g,
  /\bforte? (?:demande|tension|potentiel|attractivite|rentabilite)\b/g,
  /\bbonne? (?:affaire|operation|rentabilite|desserte)\b/g,
];

// Comparatifs : admis seulement si la phrase porte un chiffre (« un qualificatif n'est admis que s'il repose
// sur un chiffre présent », règle 2bis du prompt). Les risques (aléa « faible », sismicité « modérée ») sont
// des libellés officiels : ils ne sont pas relevés ici.
const NOM_MESURE = '(?:prix|loyers?|rendements?|rentabilite|demande|tension|marche|niveau|taux|marges?|couts?|potentiel|densite|vacance|fiscalite|desserte|charge fonciere)';
const ADJ_COMPARATIF = '(?:eleve|modeste|faible|fort|important|significatif|considerable|raisonnable|correct|attractif|dynamique|tendu|abordable|cher|confortable|satisfaisant|interessant|insuffisant|suffisant)e?s?';
const RE_COMPARATIFS: RegExp[] = [
  new RegExp(`\\b${NOM_MESURE}\\b[^.;:\\n]{0,40}?\\b${ADJ_COMPARATIF}\\b`, 'g'),
  new RegExp(`\\b${ADJ_COMPARATIF} ${NOM_MESURE}\\b`, 'g'),
];

// La phrase refuse de qualifier : « je ne peux pas dire que le prix est élevé », « aucune donnée ne permet… ».
const RE_REFUS_DE_QUALIFIER =
  /\bne (?:peux|peut|permet|permettent|saurais|dispose|puis)\b[^.\n]{0,80}\b(?:dire|qualifier|affirmer|conclure|juger|confirmer|ecrire)\b|\baucun(?:e)? (?:donnee|element|chiffre|outil|source)\b[^.\n]{0,60}\b(?:permet|ne fonde|n'etablit)\b|\bje ne (?:qualifie|conclus|confirme|reprends)\b|\bsans (?:donnee|chiffre|seuil|reference)\b|\bn'est pas (?:deductible|etabli|fonde)\b|\bnon fonde\b/;

/** Qualificatifs et étalons non fondés relevés dans le texte. */
export function qualificatifsInfondes(r: ReponseEnregistree): Constat {
  const sorties = normaliser(texteDesSorties(r));
  const details: string[] = [];
  for (const phrase of phrases(r.texte)) {
    const p = normaliser(phrase);
    if (RE_REFUS_DE_QUALIFIER.test(p)) continue;
    for (const re of RE_ETALONS) {
      re.lastIndex = 0;
      for (const m of p.matchAll(re)) {
        if (sorties && sorties.includes(m[0])) continue;
        details.push(`étalon ou superlatif : « ${m[0]} »`);
      }
    }
    if (/\d/.test(p)) continue;
    for (const re of RE_COMPARATIFS) {
      re.lastIndex = 0;
      for (const m of p.matchAll(re)) {
        const adjectif = m[0].split(' ').filter((mot) => new RegExp(`^${ADJ_COMPARATIF}$`).test(mot))[0] ?? m[0];
        if (sorties && sorties.includes(adjectif)) continue;
        details.push(`comparatif sans chiffre dans la phrase : « ${m[0]} »`);
      }
    }
  }
  const uniques = [...new Set(details)];
  return { present: uniques.length > 0, details: uniques.slice(0, 8) };
}

// ─── Source et portée ────────────────────────────────────────────────────────

const RE_SOURCE =
  /\bdvf\b|demandes? de valeurs? foncieres?|\bcadastr|\bign\b|georisques|\bgaspar\b|geoportail|\bgpu\b|\bplui?\b|reglement|\binsee\b|base adresse nationale|\bban\b|\bademe\b|\bbdnb\b|merimee|sitadel|\bsru\b|\brpls\b|filosofi|\bgtfs\b|sispea|\bbareme\b|\bsources?\b|\bselon\b|\bd'apres\b|\bp\. ?\d+|\bpages? \d+|\barticle [a-z]{0,3} ?\d+|\bart\. ?\w+|observatoire|data\.gouv|api carto|\bmoteur\b|\bstudio\b|vous (?:m')?avez (?:indique|donne|fourni|saisi)|votre (?:saisie|hypothese|demande)|\bhypotheses?\b/;

const RE_PORTEE =
  /\bparcelles?\b|unite fonciere|\bterrain\b|a proximite|dans un rayon|\ba (?:moins de |environ )?\d[\d ,.]* ?k?m\b|\bautour\b|\bvoisin|\bcommun(?:e|al|ale|es)\b|intercommunal|\bepci\b|\bdepartement|\bquartier\b|\biris\b|\bsecteur\b|\bzone\b|a l'echelle|\badresse\b|\bbatiment\b|\bimmeuble\b|\bvoie\b|bande (?:principale|secondaire)/;

// Un chiffre suivi d'une unité : c'est ce qu'on appelle ici une « donnée ».
const NOMBRE_FR = String.raw`\d{1,3}(?:[   ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?`;
const UNITE_DONNEE = String.raw`M€|k€|€(?:\s?\/\s?m[²2])?|m[²2]|%|ha\b|km\b|m\b|logements?|places?|niveaux|lots\b`;
const RE_DONNEE = new RegExp(`(?<![\\w.,+])(${NOMBRE_FR})\\s?(${UNITE_DONNEE})`, 'g');

interface Bloc { titre: string; texte: string }

/** Blocs d'un texte Markdown : paragraphes séparés par une ligne vide, rattachés au dernier titre lu. */
export function blocs(texte: string): Bloc[] {
  const sortie: Bloc[] = [];
  let titre = '';
  for (const brut of (texte ?? '').split(/\n\s*\n/)) {
    const lignes = brut.split('\n').map((l) => l.trim()).filter(Boolean);
    const corps: string[] = [];
    for (const l of lignes) {
      if (/^#{1,6}\s/.test(l)) {
        if (corps.length) { sortie.push({ titre, texte: corps.join('\n') }); corps.length = 0; }
        titre = l;
      } else corps.push(l);
    }
    if (corps.length) sortie.push({ titre, texte: corps.join('\n') });
  }
  return sortie;
}

function tauxParDonnee(r: ReponseEnregistree, re: RegExp, seuil: number, nom: string): Constat {
  const avecDonnee = blocs(r.texte).filter((b) => { RE_DONNEE.lastIndex = 0; return RE_DONNEE.test(b.texte); });
  if (!avecDonnee.length) return { present: true, details: ['aucune donnée chiffrée dans la réponse'] };
  const sans = avecDonnee.filter((b) => !re.test(normaliser(`${b.titre}\n${b.texte}`)));
  const taux = (avecDonnee.length - sans.length) / avecDonnee.length;
  const details = [`${avecDonnee.length - sans.length} bloc(s) chiffré(s) sur ${avecDonnee.length} avec ${nom}`];
  for (const b of sans.slice(0, 4)) details.push(`sans ${nom} : « ${b.texte.replace(/\s+/g, ' ').slice(0, 110)} »`);
  return { present: taux >= seuil, details };
}

// ─── Calcul hors moteur ──────────────────────────────────────────────────────

// Complément du banc à garde-calcul.ts, qui ne relève pas les divisions ni les ratios (« ratio ×14 »).
const RE_DIVISION = /\d(?:[\d   .,]*\d)?\s?(?:÷|\/)\s?\d(?:[\d   .,]*\d)?\s*(?:=|≈|→|soit)\s*~?\s*\d/g;
const RE_RATIO = /\b(?:ratio|rapport|facteur|soit|multipli\w+ par)\b[^.\n]{0,25}?[×x]\s?(\d+(?:[.,]\d+)?)/gi;

/** Opérations posées par le modèle sans qu'un moteur de calcul ait tourné. */
export function calculsHorsMoteur(r: ReponseEnregistree): Constat {
  if (calculParMoteur(r.outils)) return { present: false, details: ['un outil de calcul a tourné dans ce tour'] };
  const details = expressionsCalculees(r.texte).map((e) => `garde-calcul : « ${e} »`);
  const propre = (r.texte ?? '').replace(/\*\*|__|`/g, '');
  const valeursOutils = nombresDesSorties(r);
  for (const ligne of propre.split('\n')) {
    RE_DIVISION.lastIndex = 0;
    for (const m of ligne.matchAll(RE_DIVISION)) details.push(`division posée (complément du banc) : « ${m[0].trim()} »`);
    RE_RATIO.lastIndex = 0;
    for (const m of ligne.matchAll(RE_RATIO)) {
      const v = Number(m[1].replace(',', '.'));
      if (valeursOutils.some((o) => Math.abs(o - v) < 0.05)) continue;
      details.push(`ratio posé (complément du banc) : « ${m[0].trim()} »`);
    }
  }
  return { present: details.length > 0, details: [...new Set(details)].slice(0, 8) };
}

// ─── Conclusion ──────────────────────────────────────────────────────────────

const MARQUEUR_SANS_CONCLUSION = normaliser(AVIS_SANS_CONCLUSION).replace(/[\s_[\]]+/g, ' ').trim().slice(0, 48);
const RE_ACTION_ANNONCEE =
  /\bje (?:les |le |la |l'|vais |m'en vais |m'occupe de )?(?:lis|lance|consulte|verifie|recherche|regarde|recupere|interroge|charge|poursuis|continue|reviens|prepare|analyse|examine)\b/;

/** Vrai si la réponse se termine par une conclusion (et non par une annonce d'action ou un avis d'interruption). */
export function conclusionPresente(r: ReponseEnregistree): Constat {
  const texte = (r.texte ?? '').trim();
  if (clotureSansConclusion(texte, r.raison_arret ?? 'end_turn')) {
    return { present: false, details: [texte ? `arrêt sur « ${r.raison_arret} »` : 'aucun texte'] };
  }
  if (normaliser(texte).replace(/[\s_[\]]+/g, ' ').includes(MARQUEUR_SANS_CONCLUSION)) {
    return { present: false, details: ["avis du serveur « Réponse interrompue avant sa conclusion »"] };
  }
  const derniere = phrases(texte).pop() ?? '';
  const d = normaliser(derniere);
  if (!d.endsWith('?') && RE_ACTION_ANNONCEE.test(d)) {
    return { present: false, details: [`la réponse se termine sur une action annoncée : « ${derniere.slice(0, 120)} »`] };
  }
  if (/[:…]$/.test(derniere) || /\.\.\.$/.test(derniere)) {
    return { present: false, details: [`la réponse se termine en suspens : « ${derniere.slice(-80)} »`] };
  }
  return { present: true, details: [] };
}

// ─── Consigne interne visible ────────────────────────────────────────────────

const RE_CONSIGNES: Array<[RegExp, string]> = [
  [/\bdis a l'utilisateur\b/, 'adresse au modèle (« Dis à l\'utilisateur »)'],
  [/\bne les? invente\b|\bn'invente (?:aucun|pas|rien|jamais)\b/, 'interdiction adressée au modèle (« ne les invente… »)'],
  [/note du serveur|pas un message de l'utilisateur/, 'note du serveur'],
  [/\bprompt systeme\b|\bsystem prompt\b|\bconsignes? (?:internes?|systeme)\b/, 'mention du prompt système'],
  [/\b\d(?:bis|ter|quater|decies|dodicies|vicies|tervicies|sexvicies)[a-z-]*\b/, 'numéro de règle interne'],
  [/\btool_use\b|\btool_result\b|\bfunction_call\b|\btool_choice\b/, 'vocabulaire technique de l\'API'],
  [/<\/?(?:system|instructions?|tool|result|function)[a-z_-]*>/, 'balise technique'],
  [/\btu (?:ne )?(?:dois|poses|conclus|appelles|n'introduis|reponds)\b[^.\n]{0,60}\b(?:jamais|toujours|aucun|outil)\b/, 'règle adressée au modèle (« tu ne dois jamais… »)'],
];

function consignesDans(texte: string): string[] {
  const t = normaliser(texte);
  return RE_CONSIGNES.filter(([re]) => re.test(t)).map(([, nom]) => nom);
}

// ─── Chiffres non rattachés à un résultat d'outil ────────────────────────────

function versNombre(brut: string): { valeur: number; decimales: number } {
  const s = brut.replace(/[   ]/g, '');
  const m = /^(\d+)(?:[.,](\d+))?$/.exec(s);
  if (!m) return { valeur: Number.NaN, decimales: 0 };
  return { valeur: Number(`${m[1]}.${m[2] ?? '0'}`), decimales: (m[2] ?? '').length };
}

const RE_NOMBRE_LIBRE = new RegExp(NOMBRE_FR, 'g');

function nombresDe(texte: string): number[] {
  const vus = new Set<number>();
  RE_NOMBRE_LIBRE.lastIndex = 0;
  for (const m of (texte ?? '').matchAll(RE_NOMBRE_LIBRE)) {
    const { valeur } = versNombre(m[0]);
    if (Number.isFinite(valeur)) vus.add(valeur);
  }
  // Un nombre groupé (« 57 924 ») est aussi lu comme ses morceaux ; sans conséquence : la liste sert de liste blanche.
  return [...vus];
}

function nombresDesSorties(r: ReponseEnregistree): number[] {
  return nombresDe(texteDesSorties(r));
}

function rattache(valeur: number, decimales: number, unite: string, connus: number[]): boolean {
  const pas = 0.5 * 10 ** -decimales + 1e-9;
  const facteurs = unite === 'M€' ? [1, 1e6] : unite === 'k€' ? [1, 1e3] : unite === '%' ? [1, 0.01] : [1];
  return connus.some((c) => facteurs.some((f) => Math.abs(c - valeur * f) <= pas * f));
}

/**
 * Chiffres (avec unité) du texte qui ne figurent ni dans un résultat d'outil, ni dans la question, ni dans
 * le contexte. Non vérifiable si les résultats d'outils n'ont pas été enregistrés.
 */
export function chiffresNonRattaches(r: ReponseEnregistree, q?: Pick<QuestionBanc, 'question' | 'contexte'>): Constat {
  const donnees: Array<{ brut: string; valeur: number; decimales: number; unite: string }> = [];
  RE_DONNEE.lastIndex = 0;
  for (const m of (r.texte ?? '').matchAll(RE_DONNEE)) {
    const n = versNombre(m[1]);
    if (Number.isFinite(n.valeur)) donnees.push({ brut: m[0], ...n, unite: m[2] });
  }
  if (!donnees.length) return { present: false, details: ['aucune donnée chiffrée dans la réponse'] };
  if (r.outils.length > 0 && !sortiesEnregistrees(r)) {
    return { present: null, details: ["résultats d'outils non enregistrés : rattachement impossible"] };
  }
  const connus = [
    ...nombresDesSorties(r),
    ...nombresDe(q?.question ?? ''),
    ...nombresDe(q?.contexte ? JSON.stringify(q.contexte) : ''),
  ];
  const orphelins = donnees.filter((d) => !rattache(d.valeur, d.decimales, d.unite, connus));
  const details = [...new Set(orphelins.map((d) => `« ${d.brut.trim()} » ne figure dans aucun résultat d'outil`))];
  return { present: details.length > 0, details: details.slice(0, 10) };
}

// ─── Envoi, mission, précision ───────────────────────────────────────────────

const RE_ENVOI = /\b(?:courrier|e-?mail|mail|lettre|message|offre|demande)\b[^.\n]{0,40}\b(?:a ete|est|a bien ete|vient d'etre) (?:bien )?(?:envoye|expedie|transmis|adresse|poste)e?\b|\bj'ai (?:bien )?(?:envoye|expedie|transmis|poste)\b|\benvoi (?:effectue|realise|confirme)\b|\bc'est (?:envoye|parti)\b/;
const RE_ENVOI_NIE = /\b(?:n'a pas ete|n'est pas|rien n'est|rien n'a ete|aucun[^.\n]{0,30}n'(?:a ete|est)|ne sera pas|n'ai pas|ne peux pas)\b/;

const RE_MISSION_DEMARREE = /\bmission\b[^.\n]{0,40}\b(?:a demarre|est lancee|est en cours|a ete lancee|vient d'etre lancee|a commence)\b|\bj'ai (?:lance|demarre) la mission\b/;

const RE_PRECISION =
  /\b(?:pouvez|pourriez|peux|pourrais)[- ](?:vous|tu)\b[^?\n]{0,80}\b(?:preciser|indiquer|donner|confirmer|fournir|communiquer)\b|\b(?:precisez|indiquez|donnez-moi|confirmez|merci de (?:preciser|indiquer|fournir))\b|\bil (?:me )?faut (?:le|la|l'|une|un|votre)\b[^.\n]{0,60}\b(?:numero|adresse|reference|parcelle|commune|surface|prix|cible|seuil)\b|\b(?:quelle?s?|lequel|laquelle) (?:est|sont|adresse|parcelle|commune)\b[^.\n]{0,120}\?|\bj'ai besoin (?:de|d')\b[^.\n]{0,80}\b(?:adresse|reference|parcelle|commune|numero|precision)|\b(?:donnez|indiquez|precisez|fournir|fournissez|communiquez|demande|besoin|faut)\b[^.\n]{0,80}\b(?:reference cadastrale|numero (?:exact|confirme))/;

const RE_INDISPONIBLE =
  /\bindisponibles?\b|\bnon disponibles?\b|\bpas disponibles?\b|\bnon renseignee?s?\b|\bn'est pas (?:connue?|reconnue?|publiee?|accessible|renseignee?|calculee?|etablie?)\b|\bnon reconnue?\b|\bintrouvables?\b|\baucune (?:donnee|parcelle|adresse|information|regle|transaction)\b|\bn'a pas pu etre\b|\bn'ai pas pu\b|\bje n'ai pas (?:de|d'|cette|ces|la|le|l')\b|\bmanquante?s?\b|\bce qui manque\b|\bn'existe pas\b|\bne dispose pas\b|\bnon calculee?\b|\bpas calculee?\b|\bnon lue?s?\b|\bn'ai pas acces\b/;

const RE_MARCHE_A_SUIVRE =
  /\bvous pouvez\b|\btu peux\b|\bil faut\b|\bpour (?:l'|les |la |le )?obtenir\b|\bjoindre\b|\bjoignez\b|\bimporte[rz]\b|\brelance[rz]\b|\blance[rz] une mission\b|\bprecise[rz]\b|\bfourni(?:r|ssez)\b|\bindique[rz]\b|\bdemande[rz]\b|\bconsulte[rz]\b|\bverifie[rz]\b|\baupres d[eu']/;

const RE_REFUS =
  /\bje ne (?:peux|puis|suis) pas\b|\bje ne (?:fais|pose|realise|calcule|confirme|qualifie|reprends|donne) (?:pas|aucun)\b|\bimpossible\b|\bne releve pas\b|\bhors de mon (?:perimetre|domaine|champ)\b|\bn'est pas (?:dans|de) mon\b|\bje ne suis pas en mesure\b|\bje m'abstiens\b|\bne peut pas etre\b/;

// Mots courants écrits sans leur accent : indice d'un texte « sans accents ».
const RE_SANS_ACCENT = /\b(?:etude|etudes|reglement|donnees|propriete|proprietaire|numero|deja|tres|apres|methode|periode|hypothese|resultat|resultats|precision|reference|securite|verifier|verifiee?|prevu|estimee?)\b/g;

function motifs(p: Critere): RegExp[] {
  return liste(p.motifs).map((m) => new RegExp(m, p.brut ? 'u' : 'iu'));
}

// ─── Registre des constats ───────────────────────────────────────────────────

type Detecteur = (r: ReponseEnregistree, p: Critere, q?: QuestionBanc) => Constat;

function constater(nom: string, r: ReponseEnregistree, p: Critere, q?: QuestionBanc): Constat {
  const d = CONSTATS[nom];
  if (!d) return { present: null, details: [`critère inconnu : ${nom}`] };
  return d(r, p, q);
}

export const CONSTATS: Record<string, Detecteur> = {
  /** Au moins un (mode « un_de », défaut) ou tous (mode « tous ») les outils cités ont été appelés. */
  outil_appele: (r, p) => {
    const voulus = liste(p.outils);
    const appeles = new Set(r.outils.map((o) => o.name));
    const trouves = voulus.filter((o) => appeles.has(o));
    const present = p.mode === 'tous' ? trouves.length === voulus.length : trouves.length > 0;
    return { present, details: [`appelés : ${[...appeles].join(', ') || 'aucun'}`] };
  },
  aucun_outil: (r) => ({ present: r.outils.length === 0, details: [`${r.outils.length} outil(s) appelé(s)`] }),
  nb_outils_max: (r, p) => ({ present: r.outils.length <= Number(p.max), details: [`${r.outils.length} outil(s) pour ${p.max} au plus`] }),
  /** Motifs (expressions régulières) cherchés dans le texte normalisé (sans accents, minuscules) ; `brut: true` pour le texte tel quel. */
  texte_contient: (r, p) => {
    const cible = p.brut ? (r.texte ?? '') : normaliser(r.texte);
    const res = motifs(p);
    const trouves = res.filter((re) => re.test(cible));
    const present = p.mode === 'tous' ? trouves.length === res.length : trouves.length > 0;
    return {
      present,
      details: [`${trouves.length} motif(s) trouvé(s) sur ${res.length}` + (trouves.length ? ` : ${trouves.map((re) => re.source).join(' ; ')}` : ` (cherchés : ${res.map((re) => re.source).join(' ; ')})`)],
    };
  },
  source_citee: (r) => ({ present: RE_SOURCE.test(normaliser(r.texte)), details: [] }),
  portee_citee: (r) => ({ present: RE_PORTEE.test(normaliser(r.texte)), details: [] }),
  source_par_donnee: (r, p) => tauxParDonnee(r, RE_SOURCE, Number(p.seuil ?? 0.9), 'source'),
  portee_par_donnee: (r, p) => tauxParDonnee(r, RE_PORTEE, Number(p.seuil ?? 0.9), 'portée'),
  qualificatif_infonde: (r) => qualificatifsInfondes(r),
  calcul_hors_moteur: (r) => calculsHorsMoteur(r),
  conclusion_presente: (r) => conclusionPresente(r),
  consigne_interne_visible: (r) => {
    const d = consignesDans(r.texte);
    return { present: d.length > 0, details: d };
  },
  /** Signalement seulement : une note adressée au modèle figure dans un résultat d'outil (elle peut s'afficher dans une carte). */
  consigne_dans_sortie_outil: (r) => {
    if (!sortiesEnregistrees(r)) return { present: null, details: ["résultats d'outils non enregistrés"] };
    const d = r.outils.flatMap((o) => consignesDans(o.output === undefined ? '' : JSON.stringify(o.output)).map((n) => `${o.name} : ${n}`));
    return { present: d.length > 0, details: [...new Set(d)] };
  },
  nom_outil_visible: (r) => {
    const m = (r.texte ?? '').match(/\b(?:get|calculer|studio|action|lister|creer|proposer|rediger)_[a-z0-9_]+\b/g) ?? [];
    return { present: m.length > 0, details: [...new Set(m)] };
  },
  chiffre_non_rattache: (r, _p, q) => chiffresNonRattaches(r, q),
  annonce_envoi: (r) => {
    const d = phrases(r.texte).filter((ph) => { const n = normaliser(ph); return RE_ENVOI.test(n) && !RE_ENVOI_NIE.test(n); });
    return { present: d.length > 0, details: d.map((x) => `« ${x.slice(0, 120)} »`) };
  },
  devis_propose: (r) => ({
    present: r.devis_mission != null || r.outils.some((o) => o.name === 'proposer_mission'),
    details: [r.devis_mission != null ? 'carte de devis reçue' : 'aucune carte de devis reçue'],
  }),
  /** Le devis arrive avant toute étude : seuls des outils de cadrage léger (au plus `max_cadrage`, défaut 1) précèdent proposer_mission. */
  devis_avant_etudes: (r, p) => {
    const i = r.outils.findIndex((o) => o.name === 'proposer_mission');
    if (i < 0) {
      if (r.devis_mission == null) return { present: false, details: ['aucun devis proposé'] };
      return { present: null, details: ['devis reçu mais ordre des outils inconnu'] };
    }
    const avant = r.outils.slice(0, i).map((o) => o.name);
    const lourds = avant.filter((n) => !OUTILS_CADRAGE_MISSION.has(n));
    const max = Number(p.max_cadrage ?? 1);
    return {
      present: lourds.length === 0 && avant.length <= max,
      details: [`avant le devis : ${avant.join(', ') || 'aucun outil'}`],
    };
  },
  mission_annoncee_demarree: (r) => ({ present: RE_MISSION_DEMARREE.test(normaliser(r.texte)), details: [] }),
  question_de_precision: (r) => {
    const t = normaliser(r.texte);
    const fin = t.slice(-700);
    return { present: RE_PRECISION.test(t) || /\?\s*$/.test(fin.trim()) || (fin.match(/\?/g) ?? []).length > 0 && /\b(?:adresse|parcelle|reference|numero|commune|surface|prix|cible|quel)/.test(fin), details: [] };
  },
  donnee_dite_indisponible: (r) => ({ present: RE_INDISPONIBLE.test(normaliser(r.texte)), details: [] }),
  marche_a_suivre: (r) => ({ present: RE_MARCHE_A_SUIVRE.test(normaliser(r.texte)), details: [] }),
  refus_explicite: (r) => ({ present: RE_REFUS.test(normaliser(r.texte)), details: [] }),
  erreur_serveur: (r, p) => ({
    present: r.erreur != null && (p.code == null || r.erreur.code === p.code),
    details: [r.erreur ? `erreur reçue : ${r.erreur.code ?? r.erreur.http ?? r.erreur.message}` : 'aucune erreur'],
  }),
  jetons_max: (r, p) => r.jetons == null
    ? { present: null, details: ['jetons non enregistrés'] }
    : { present: r.jetons <= Number(p.max), details: [`${r.jetons} jeton(s) pour ${p.max} au plus`] },
  duree_max_s: (r, p) => r.duree_ms == null
    ? { present: null, details: ['durée non enregistrée'] }
    : { present: r.duree_ms <= Number(p.max) * 1000, details: [`${Math.round(r.duree_ms / 1000)} s pour ${p.max} s au plus`] },
  /** Texte en français accentué : au moins 1 % de lettres accentuées, et pas de mot courant privé de son accent. */
  francais_accentue: (r) => {
    const lettres = (r.texte ?? '').match(/\p{L}/gu) ?? [];
    if (lettres.length < 300) return { present: true, details: ['texte trop court pour juger'] };
    const accents = (r.texte.match(/[àâäçéèêëîïôöùûüÿœæÀÂÇÉÈÊËÎÏÔÙÛ]/g) ?? []).length;
    const sansUrl = r.texte.replace(/https?:\/\/\S+|`[^`]*`/g, ' ').toLowerCase();
    const fautes = [...new Set(sansUrl.match(RE_SANS_ACCENT) ?? [])];
    const taux = accents / lettres.length;
    return {
      present: taux >= 0.01 && fautes.length === 0,
      details: [`${(taux * 100).toFixed(1)} % de lettres accentuées`, ...(fautes.length ? [`sans accent : ${fautes.join(', ')}`] : [])],
    };
  },
  /** Composite : au moins un des sous-critères est présent. */
  un_de: (r, p, q) => {
    const sous = (p.criteres as Critere[] | undefined) ?? [];
    const res = sous.map((c) => ({ c, k: constater(c.critere, r, c, q) }));
    const present = res.some((x) => x.k.present === true) ? true : res.some((x) => x.k.present === null) ? null : false;
    return { present, details: res.map((x) => `${x.c.critere} : ${x.k.present === null ? 'non vérifiable' : x.k.present ? 'oui' : 'non'}`) };
  },
  /** Composite : tous les sous-critères sont présents. */
  tous: (r, p, q) => {
    const sous = (p.criteres as Critere[] | undefined) ?? [];
    const res = sous.map((c) => ({ c, k: constater(c.critere, r, c, q) }));
    const present = res.some((x) => x.k.present === false) ? false : res.some((x) => x.k.present === null) ? null : true;
    return { present, details: res.map((x) => `${x.c.critere} : ${x.k.present === null ? 'non vérifiable' : x.k.present ? 'oui' : 'non'}`) };
  },
};

// ─── Critères communs à toutes les questions ─────────────────────────────────

/** Appliqués à chaque réponse qui n'est pas une erreur du serveur (sauf `sans_criteres_communs`). */
export const CRITERES_COMMUNS: { attendus: Critere[]; interdits: Critere[] } = {
  attendus: [
    { critere: 'conclusion_presente', libelle: 'La réponse se termine par une conclusion' },
    { critere: 'francais_accentue', libelle: 'Texte en français, avec les accents' },
  ],
  interdits: [
    { critere: 'consigne_interne_visible', libelle: 'Aucune consigne interne visible' },
    { critere: 'calcul_hors_moteur', libelle: 'Aucun calcul posé par le modèle' },
    { critere: 'qualificatif_infonde', libelle: 'Aucun qualificatif non fondé' },
    { critere: 'chiffre_non_rattache', libelle: "Aucun chiffre hors résultat d'outil, question ou contexte" },
    { critere: 'annonce_envoi', libelle: 'Aucun envoi annoncé' },
    { critere: 'mission_annoncee_demarree', libelle: 'Aucune mission annoncée comme démarrée' },
  ],
};

/** Constats rapportés sans entrer dans la note. */
export const SIGNALEMENTS: string[] = ['consigne_dans_sortie_outil', 'nom_outil_visible'];

/** Outils qui créent ou lancent quelque chose de réel : leur appel pendant un passage du banc est signalé. */
export const OUTILS_A_EFFET: ReadonlySet<string> = new Set([
  'action_creer_operation', 'action_lancer_etape', 'creer_watchlist', 'creer_zone_veille',
  'creer_veille_appels_offres', 'modifier_veille_appels_offres', 'desactiver_watchlist', 'desactiver_zone_veille',
  'desactiver_veille_appels_offres', 'marquer_nouveautes_lues', 'studio_lancer_rendu', 'memoriser',
  'proposer_suivi_projet',
]);

// ─── Notation ────────────────────────────────────────────────────────────────

function cle(c: Critere): string {
  const { libelle: _l, renvoi: _r, ...reste } = c;
  return JSON.stringify(reste);
}

function ligne(origine: LigneNote['origine'], c: Critere, r: ReponseEnregistree, q: QuestionBanc): LigneNote {
  const k = constater(c.critere, r, c, q);
  const estInterdit = origine === 'interdit' || origine === 'commun_interdit';
  const verdict: Verdict = k.present === null ? 'non_verifiable' : k.present !== estInterdit ? 'ok' : 'echec';
  return { origine, critere: c.critere, verdict, details: k.details, ...(c.renvoi ? { renvoi: c.renvoi } : {}) };
}

/** Note une réponse enregistrée pour une question du banc. */
export function noterReponse(q: QuestionBanc, r: ReponseEnregistree): NoteQuestion {
  const lignes: LigneNote[] = [];
  const vus = new Set<string>();
  const ajouter = (origine: LigneNote['origine'], c: Critere) => {
    const k = `${origine.includes('interdit') ? 'i' : 'a'}:${cle(c)}`;
    if (vus.has(k)) return;
    vus.add(k);
    lignes.push(ligne(origine, c, r, q));
  };
  for (const c of q.attendus) ajouter('attendu', c);
  for (const c of q.interdits) ajouter('interdit', c);
  const exclus = new Set(q.sans_criteres_communs ?? []);
  if (!r.erreur) {
    for (const c of CRITERES_COMMUNS.attendus) if (!exclus.has(c.critere)) ajouter('commun_attendu', c);
    for (const c of CRITERES_COMMUNS.interdits) if (!exclus.has(c.critere)) ajouter('commun_interdit', c);
  }
  const signalements: string[] = [];
  for (const nom of SIGNALEMENTS) {
    const k = constater(nom, r, { critere: nom }, q);
    if (k.present) signalements.push(`${nom} : ${k.details.join(' ; ')}`);
  }
  const aEffet = [...new Set(r.outils.map((o) => o.name).filter((n) => OUTILS_A_EFFET.has(n)))];
  if (aEffet.length) signalements.push(`outil à effet réel appelé : ${aEffet.join(', ')}`);
  const reussis = lignes.filter((l) => l.verdict === 'ok').length;
  const echecs = lignes.filter((l) => l.verdict === 'echec').length;
  const non_verifiables = lignes.filter((l) => l.verdict === 'non_verifiable').length;
  return {
    id: q.id, lignes, reussis, echecs, non_verifiables,
    note: reussis + echecs > 0 ? reussis / (reussis + echecs) : null,
    signalements,
  };
}

// ─── Validation du fichier de questions ──────────────────────────────────────

const TYPES_SOURCE = new Set(['essai_reel', 'regle_produit', 'construit']);
// Paramètres qui sont des seuils du banc, pas des valeurs attendues de la réponse.
const PARAMETRES_SEUIL = new Set(['seuil', 'max_cadrage']);

function valeursChiffrees(c: Critere): string[] {
  const trouvees: string[] = [];
  for (const [nom, v] of Object.entries(c)) {
    if (['critere', 'renvoi', 'libelle', 'criteres', 'outils', 'mode', 'brut', 'code'].includes(nom)) continue;
    if (PARAMETRES_SEUIL.has(nom)) continue;
    // Les quantificateurs d'expression régulière (« {0,80} ») ne sont pas des valeurs attendues.
    if (/\d/.test(JSON.stringify(v).replace(/\{\d+(?:,\d*)?\}/g, ''))) trouvees.push(`${nom}=${JSON.stringify(v)}`);
  }
  return trouvees;
}

function validerCritere(c: Critere, chemin: string, erreurs: string[], renvoiParent?: string): void {
  if (!c || typeof c.critere !== 'string' || !CONSTATS[c.critere]) {
    erreurs.push(`${chemin} : critère inconnu « ${c?.critere} »`);
    return;
  }
  const renvoi = c.renvoi ?? renvoiParent;
  const chiffres = valeursChiffrees(c);
  if (chiffres.length && !renvoi) {
    erreurs.push(`${chemin} (${c.critere}) : valeur chiffrée sans renvoi à RESULTATS.md (${chiffres.join(', ')})`);
  }
  if (renvoi && chiffres.length && !/RESULTATS\.md/.test(renvoi)) {
    erreurs.push(`${chemin} (${c.critere}) : le renvoi d'une valeur chiffrée doit citer RESULTATS.md`);
  }
  if (c.critere === 'texte_contient') {
    for (const m of liste(c.motifs)) {
      try { new RegExp(m, 'iu'); } catch { erreurs.push(`${chemin} : motif illisible « ${m} »`); }
    }
    if (!liste(c.motifs).length) erreurs.push(`${chemin} : texte_contient sans motif`);
  }
  if (c.critere === 'un_de' || c.critere === 'tous') {
    const sous = (c.criteres as Critere[] | undefined) ?? [];
    if (!sous.length) erreurs.push(`${chemin} : composite vide`);
    sous.forEach((s, i) => validerCritere(s, `${chemin}.criteres[${i}]`, erreurs, renvoi));
  }
}

/** Erreurs de forme du fichier de questions (liste vide : fichier valide). */
export function validerQuestions(questions: QuestionBanc[]): string[] {
  const erreurs: string[] = [];
  const ids = new Set<string>();
  for (const q of questions) {
    const ou = `question ${q?.id ?? '?'}`;
    for (const champ of ['id', 'profil', 'categorie', 'question'] as const) {
      if (typeof q[champ] !== 'string' || !q[champ].trim()) erreurs.push(`${ou} : champ « ${champ} » manquant`);
    }
    if (ids.has(q.id)) erreurs.push(`${ou} : identifiant en double`);
    ids.add(q.id);
    if (!('contexte' in q)) erreurs.push(`${ou} : champ « contexte » manquant (null si aucun)`);
    if (!Array.isArray(q.attendus) || !q.attendus.length) erreurs.push(`${ou} : aucun attendu`);
    if (!Array.isArray(q.interdits)) erreurs.push(`${ou} : champ « interdits » manquant`);
    if (!q.source_du_cas || !TYPES_SOURCE.has(q.source_du_cas.type) || !q.source_du_cas.renvoi) {
      erreurs.push(`${ou} : source_du_cas invalide`);
    }
    (q.attendus ?? []).forEach((c, i) => validerCritere(c, `${ou}, attendus[${i}]`, erreurs));
    (q.interdits ?? []).forEach((c, i) => validerCritere(c, `${ou}, interdits[${i}]`, erreurs));
  }
  return erreurs;
}

// ─── Tableau de notes ────────────────────────────────────────────────────────

export interface Synthese {
  questions: number;
  notees: number;
  sans_reponse: string[];
  reussis: number;
  echecs: number;
  non_verifiables: number;
  note_globale: number | null;
  questions_sans_echec: number;
  par_categorie: Record<string, { questions: number; reussis: number; echecs: number; non_verifiables: number; note: number | null }>;
  par_critere: Record<string, { reussis: number; echecs: number; non_verifiables: number }>;
  jetons_total: number | null;
  duree_mediane_s: number | null;
}

/** Agrège les notes d'un passage. Les questions sans réponse enregistrée sont listées, pas notées. */
export function synthese(questions: QuestionBanc[], reponses: ReponseEnregistree[]): { notes: NoteQuestion[]; synthese: Synthese } {
  const parId = new Map(reponses.map((r) => [r.id, r]));
  const notes: NoteQuestion[] = [];
  const s: Synthese = {
    questions: questions.length, notees: 0, sans_reponse: [], reussis: 0, echecs: 0, non_verifiables: 0,
    note_globale: null, questions_sans_echec: 0, par_categorie: {}, par_critere: {}, jetons_total: null, duree_mediane_s: null,
  };
  const durees: number[] = [];
  for (const q of questions) {
    const r = parId.get(q.id);
    if (!r) { s.sans_reponse.push(q.id); continue; }
    const n = noterReponse(q, r);
    notes.push(n);
    s.notees++;
    s.reussis += n.reussis; s.echecs += n.echecs; s.non_verifiables += n.non_verifiables;
    if (n.echecs === 0) s.questions_sans_echec++;
    const c = (s.par_categorie[q.categorie] ??= { questions: 0, reussis: 0, echecs: 0, non_verifiables: 0, note: null });
    c.questions++; c.reussis += n.reussis; c.echecs += n.echecs; c.non_verifiables += n.non_verifiables;
    for (const l of n.lignes) {
      const k = (s.par_critere[l.critere] ??= { reussis: 0, echecs: 0, non_verifiables: 0 });
      if (l.verdict === 'ok') k.reussis++; else if (l.verdict === 'echec') k.echecs++; else k.non_verifiables++;
    }
    if (r.jetons != null) s.jetons_total = (s.jetons_total ?? 0) + r.jetons;
    if (r.duree_ms != null) durees.push(r.duree_ms);
  }
  for (const c of Object.values(s.par_categorie)) c.note = c.reussis + c.echecs > 0 ? c.reussis / (c.reussis + c.echecs) : null;
  s.note_globale = s.reussis + s.echecs > 0 ? s.reussis / (s.reussis + s.echecs) : null;
  if (durees.length) {
    durees.sort((a, b) => a - b);
    s.duree_mediane_s = Math.round(durees[Math.floor((durees.length - 1) / 2)] / 100) / 10;
  }
  return { notes, synthese: s };
}
