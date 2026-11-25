// src/spaces/copilot/studio3d/scenarioFilmChat.ts
// =============================================================================
// VIS-46 — logique PURE de la carte « Scénario du film » (chat ET Espace 3D) : lecture de la sortie de l'outil
// `studio_proposer_film`, retouches à la main (texte, durée, mouvement, sujet, ordre, ajout / retrait de plan,
// ambiance, format, musique, voix off) avec total recalculé, différences à surligner. Aucun envoi ici.
// =============================================================================
import {
  DUREE_FILM_MAX_S, DUREE_FILM_MIN_S, DUREE_PLAN_MAX_S, DUREE_PLAN_MIN_S, PLANS_MAX, PLANS_MIN, SUJETS_PLAN, validerScenario,
  type PlanFilm, type ScenarioFilm, type SujetPlan,
} from '../../../lib/studio/scenarioFilm.ts';
import { MOUVEMENT_PAR_DEFAUT, OUTIL_PROPOSER_FILM, promptParDefaut, type DifferencesScenario } from '../../../lib/studio/filmsChat.ts';

export interface ProjetCarteFilm { nom: string; sujets: SujetPlan[]; raisons: Partial<Record<SujetPlan, string>> }
export interface CarteScenarios {
  appelId: string;
  version: number;
  propositions: ScenarioFilm[];
  choisi: number | null;
  differences: DifferencesScenario[];
  changements: string[];
  refus: string[];
  projet: ProjetCarteFilm;
  cout: string;
}

const estObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const textes = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Carte d'un appel `studio_proposer_film` terminé (null : autre outil, en cours, refus). Scénarios REVALIDÉS. */
export function lireCarteScenarios(tc: { id: string; name: string; status?: string; output?: unknown }): CarteScenarios | null {
  if (tc.name !== OUTIL_PROPOSER_FILM || tc.status === 'running') return null;
  const o = tc.output;
  if (!estObj(o) || o.status !== 'ok' || !estObj(o.data) || o.data.carte !== 'scenarios-film' || !Array.isArray(o.data.propositions)) return null;
  const d = o.data;
  const propositions = (d.propositions as unknown[]).map((p) => validerScenario(p)).flatMap((v) => (v.ok ? [v.scenario] : []));
  if (!propositions.length) return null;
  const pr = estObj(d.projet) ? d.projet : {};
  const sujets = Array.isArray(pr.sujets) ? (pr.sujets as unknown[]).filter((s): s is SujetPlan => SUJETS_PLAN.includes(s as SujetPlan)) : [...SUJETS_PLAN];
  return {
    appelId: tc.id,
    version: typeof d.version === 'number' ? d.version : 1,
    propositions,
    choisi: typeof d.choisi === 'number' && d.choisi >= 0 && d.choisi < propositions.length ? d.choisi : null,
    differences: Array.isArray(d.differences) ? (d.differences as DifferencesScenario[]) : [],
    changements: textes(d.changements), refus: textes(d.refus),
    projet: { nom: typeof pr.nom === 'string' ? pr.nom : 'le projet', sujets, raisons: estObj(pr.raisons) ? (pr.raisons as ProjetCarteFilm['raisons']) : {} },
    cout: typeof d.cout === 'string' ? d.cout : '',
  };
}

/** Dernière carte de scénarios d'une liste de messages (Espace 3D : même carte, aucune commande en double). */
export function derniereCarteScenarios(messages: readonly { role: string; toolCalls?: readonly { id: string; name: string; status?: string; output?: unknown }[] }[]): CarteScenarios | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'assistant' || !m.toolCalls) continue;
    for (let j = m.toolCalls.length - 1; j >= 0; j--) { const c = lireCarteScenarios(m.toolCalls[j]); if (c) return c; }
  }
  return null;
}

const dixieme = (n: number): number => Math.round(n * 10) / 10;
export const totalPlans = (plans: readonly PlanFilm[]): number => dixieme(plans.reduce((a, p) => a + p.duree_s, 0));
const avecTotal = (s: ScenarioFilm, plans: PlanFilm[]): ScenarioFilm => ({ ...s, plans, duree_s: totalPlans(plans) });

/** Modifie un plan (durée bornée 2–15 s au dixième) ; total recalculé. */
export function majPlan(s: ScenarioFilm, i: number, patch: Partial<PlanFilm>): ScenarioFilm {
  const plans = s.plans.map((p, k) => {
    if (k !== i) return p;
    const n: PlanFilm = { ...p, ...patch };
    if (patch.duree_s !== undefined) n.duree_s = dixieme(Math.min(DUREE_PLAN_MAX_S, Math.max(DUREE_PLAN_MIN_S, patch.duree_s)));
    if (patch.texte_ecran !== undefined && !patch.texte_ecran) delete n.texte_ecran;
    return n;
  });
  return avecTotal(s, plans);
}

export function deplacerPlan(s: ScenarioFilm, de: number, vers: number): ScenarioFilm {
  if (de === vers || de < 0 || vers < 0 || de >= s.plans.length || vers >= s.plans.length) return s;
  const plans = [...s.plans];
  const [p] = plans.splice(de, 1);
  plans.splice(vers, 0, p);
  return avecTotal(s, plans);
}

export function supprimerPlan(s: ScenarioFilm, i: number): ScenarioFilm {
  if (s.plans.length <= PLANS_MIN) return s;
  return avecTotal(s, s.plans.filter((_, k) => k !== i));
}

/** Ajoute un plan (avant le dernier : le final reste le final) ; sujet impossible ou 12 plans : inchangé. */
export function ajouterPlan(s: ScenarioFilm, sujet: SujetPlan, projet: ProjetCarteFilm): ScenarioFilm {
  if (s.plans.length >= PLANS_MAX || !projet.sujets.includes(sujet)) return s;
  let n = s.plans.length + 1;
  while (s.plans.some((p) => p.id === `p${n}`)) n++;
  const mouvement = MOUVEMENT_PAR_DEFAUT[sujet];
  const plan: PlanFilm = { id: `p${n}`, prompt: promptParDefaut(sujet, mouvement, projet.nom, s.ambiance), sujet, mouvement, duree_s: 5 };
  const plans = [...s.plans];
  plans.splice(Math.max(1, plans.length - 1), 0, plan);
  return avecTotal(s, plans);
}

/** État affiché sous la carte : total, bornes, erreurs (bouton de lancement désactivé si non valide). */
export function etatScenario(s: ScenarioFilm): { total: number; dansLesBornes: boolean; ok: boolean; erreurs: string[] } {
  const total = totalPlans(s.plans);
  const v = validerScenario(s);
  const dansLesBornes = total >= DUREE_FILM_MIN_S && total <= DUREE_FILM_MAX_S;
  const erreurs = v.ok ? [] : v.erreurs;
  if (!dansLesBornes) erreurs.push(`durée totale ${String(total).replace('.', ',')} s : le film fait de ${DUREE_FILM_MIN_S} à ${DUREE_FILM_MAX_S} s`);
  return { total, dansLesBornes, ok: v.ok && dansLesBornes, erreurs };
}

/** Marques de surlignage d'une version (plans ajoutés / modifiés / déplacés, champs globaux changés). */
export function marques(d: DifferencesScenario | undefined): { plans: Record<string, 'ajoute' | 'modifie' | 'deplace'>; champs: Set<string> } {
  const plans: Record<string, 'ajoute' | 'modifie' | 'deplace'> = {};
  for (const p of d?.plans ?? []) plans[p.id] = p.statut;
  return { plans, champs: new Set(d?.champs ?? []) };
}

/** Le scénario a-t-il été retouché à la main par rapport à la version reçue ? */
export function estRetouche(recu: ScenarioFilm, local: ScenarioFilm): boolean {
  return JSON.stringify(recu) !== JSON.stringify(local);
}

/**
 * Scénario d'un film déjà demandé (historique) : `options.scenario` (base migrée), sinon `fiche.scenario_film` (le scénario
 * lui-même, toujours écrit par copilot-chat ; seul porteur sans migration, lu par le worker VIS-47). Revalidé ; null sinon.
 * `transmis` : vrai si le scénario est dans les options (sinon il dépend d'une machine de rendu à jour).
 */
export function scenarioDuTravail(t: { type: string; options?: Record<string, unknown> | null; scenario_film?: unknown }): { scenario: ScenarioFilm; transmis: boolean } | null {
  if (t.type !== 'film') return null;
  const o = t.options && estObj(t.options.scenario) ? validerScenario(t.options.scenario) : null;
  if (o?.ok) return { scenario: o.scenario, transmis: true };
  const memo = estObj(t.scenario_film) ? validerScenario(t.scenario_film) : null;
  return memo?.ok ? { scenario: memo.scenario, transmis: false } : null;
}
