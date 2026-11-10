// interior-architect-v1/handler.ts
// Gestionnaire HTTP, dépendances injectées (environnement, fetch, horloge) pour
// être testé sans réseau ni Supabase. Aucune dépendance réseau dans le calcul :
// le seul appel sortant est la vérification de session d'un utilisateur.
//
// Contrat : toujours HTTP 200 pour un résultat métier (ok, plan requis, entrée
// invalide), afin que copilot-chat (callInternalFunction tronque le corps des
// erreurs HTTP à 200 caractères) transmette le motif complet au LLM.
// HTTP ≠ 200 seulement pour : OPTIONS (204), méthode (405), authentification
// (401/500/503), corps trop volumineux (413), corps illisible (400).

import { verifierAppelant, type EnvAuth } from './auth.ts';
import { RequeteSchema, erreursZod, validerBrief, validerPlan, type ErreurValidation } from './schemas.ts';
import { calculerVariantes, BUDGET_CALCUL_MS_DEFAUT, MAX_CANDIDATS_DEFAUT, VERSION_FONCTION, VERSION_MOTEUR } from './pipeline.ts';
import {
  bloquantesLogement, choixPrincipaux, COMMENT_OBTENIR_UN_PLAN, lireDescription, manquesVariante, resumeTexte,
  texteRefusDescription, texteRefusRoomPlan, verdictsParPiece,
} from './resume.ts';

export const TAILLE_MAX_OCTETS = 1_000_000;

export function cors(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { ...cors(), 'Content-Type': 'application/json; charset=utf-8' } });
}

const MOTEUR = { version: VERSION_MOTEUR, fonction: VERSION_FONCTION };

/** Questions à poser quand le brief manque ou est incomplet (reprises par l'outil copilot). */
export const QUESTIONS_BRIEF = [
  'Pour qui : famille, couple, primo-accédant, investisseur locatif, senior ou étudiant ?',
  'Combien d\'occupants : adultes et enfants ?',
  'Quel style : contemporain, scandinave, industriel, japandi, classique chic ou méditerranéen ?',
  'Quelle gamme : économique, standard ou premium ?',
  'Faut-il un poste de télétravail ?',
  'Faut-il un aménagement accessible (PMR) ?',
];

function invalide(erreurs: ErreurValidation[], message: string, extra: Record<string, unknown> = {}): Response {
  return json({ status: 'entree_invalide', variantes: [], resumeTexte: message, erreurs, moteur: MOTEUR, ...extra }, 200);
}

export interface Deps {
  env: EnvAuth;
  fetchFn?: typeof fetch;
  maintenant?: () => number;
}

export function creerHandler(deps: Deps): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
    if (req.method !== 'POST') return json({ status: 'erreur', resumeTexte: 'POST uniquement.' }, 405);

    const auth = await verifierAppelant(req, deps.env, deps.fetchFn ?? fetch);
    if (!auth.ok) return json({ status: 'non_autorise', resumeTexte: auth.message }, auth.status);

    const texte = await req.text();
    if (new TextEncoder().encode(texte).length > TAILLE_MAX_OCTETS) {
      return json({ status: 'erreur', resumeTexte: `Requête trop volumineuse (max ${TAILLE_MAX_OCTETS} octets).` }, 413);
    }
    let corps: unknown;
    try { corps = JSON.parse(texte); } catch { return json({ status: 'erreur', resumeTexte: 'Corps JSON illisible.' }, 400); }

    const req0 = RequeteSchema.safeParse(corps);
    if (!req0.success) return invalide(erreursZod(req0.error), 'Requête invalide : voir « erreurs ».');
    const r = req0.data;

    const sources = [r.plan !== undefined, r.description !== undefined, r.roomPlan !== undefined].filter(Boolean).length;
    if (sources === 0) {
      return json({
        status: 'plan_requis', variantes: [], moteur: MOTEUR,
        resumeTexte: texteRefusDescription({ typologie: null, surface_m2: null }),
        comment_obtenir_un_plan: COMMENT_OBTENIR_UN_PLAN,
      });
    }
    if (sources > 1) return invalide([{ chemin: '(racine)', message: 'fournir UNE seule source : plan, description ou roomPlan' }], 'Requête ambiguë : une seule source de plan est acceptée.');

    // (b) Description typologique seule : REFUS honnête, aucun plan n'est inventé.
    if (r.description !== undefined) {
      const compris = lireDescription(r.description);
      return json({
        status: 'plan_requis', variantes: [], moteur: MOTEUR,
        compris, resumeTexte: texteRefusDescription(compris),
        comment_obtenir_un_plan: COMMENT_OBTENIR_UN_PLAN,
        manques: ['plan structuré du logement (pièces, murs, ouvertures)'],
      });
    }
    if (r.roomPlan !== undefined) {
      return json({
        status: 'plan_studio_non_converti', variantes: [], moteur: MOTEUR,
        resumeTexte: texteRefusRoomPlan(), comment_obtenir_un_plan: COMMENT_OBTENIR_UN_PLAN,
      });
    }

    // (a) PlanInput JSON.
    const vp = validerPlan(r.plan);
    if (!vp.ok) return invalide(vp.erreurs, 'Plan invalide : il ne respecte pas le contrat PlanInput (voir « erreurs »). Rien n\'a été aménagé.');
    if (r.brief === undefined) {
      return invalide([{ chemin: 'brief', message: 'brief requis' }], 'Brief manquant : il faut d\'abord connaître la cible, les occupants, le style, la gamme, le télétravail et le besoin PMR.', { questions: QUESTIONS_BRIEF });
    }
    const vb = validerBrief(r.brief);
    if (!vb.ok) return invalide(vb.erreurs, 'Brief invalide (voir « erreurs »).', { questions: QUESTIONS_BRIEF });

    const plan = vp.plan, brief = vb.brief;
    const budgetEnv = Number(deps.env.get('INTERIOR_BUDGET_MS'));
    const candidatsEnv = Number(deps.env.get('INTERIOR_MAX_CANDIDATS'));
    try {
      const res = calculerVariantes(plan, brief, {
        seed: r.seed ?? 1,
        nombre: r.variants ?? 3,
        budgetMs: Number.isFinite(budgetEnv) && budgetEnv > 0 ? budgetEnv : BUDGET_CALCUL_MS_DEFAUT,
        maxCandidats: Number.isInteger(candidatsEnv) && candidatsEnv >= 1 ? candidatsEnv : MAX_CANDIDATS_DEFAUT,
        ...(deps.maintenant ? { maintenant: deps.maintenant } : {}),
      });
      const best = res.variantes[0]!;
      return json({
        status: 'ok',
        variantes: res.variantes.map((v) => ({
          libelle: v.libelle, seed: v.seed, verdict: v.verdict, score: v.score,
          layout: v.layout, rapport: v.rapport, feuilleDeStyle: v.feuilleDeStyle, pointsEauSupposes: v.pointsEauSupposes,
          choixGaines: v.choixGaines, duree_ms: v.duree_ms,
        })),
        resumeTexte: resumeTexte(plan, brief, res),
        synthese: {
          variante: best.libelle,
          verdict: best.verdict,
          score: best.score,
          verdictsParPiece: verdictsParPiece(plan, best),
          bloquantesLogement: bloquantesLogement(best),
          choixPrincipaux: choixPrincipaux(best),
          pointsEauSupposes: best.pointsEauSupposes,
          manques: manquesVariante(plan, best),
          hypotheses: [...new Set([...res.hypothesesPointsEau, ...best.rapport.assumptions, ...best.feuilleDeStyle.assumptions])],
          recommandations: best.rapport.recommendations,
        },
        ecartees: res.ecartees,
        moteur: MOTEUR,
        duree_ms: res.duree_ms,
        ...(r.dossier_id ? { dossier_id: r.dossier_id } : {}),
      });
    } catch (e) {
      // Une erreur du moteur n'est jamais maquillée en aménagement.
      return json({ status: 'erreur', variantes: [], moteur: MOTEUR, resumeTexte: `Le moteur n'a pas pu aménager ce plan : ${e instanceof Error ? e.message : String(e)}` });
    }
  };
}
