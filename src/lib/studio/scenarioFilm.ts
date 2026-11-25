/**
 * VIS-46 / VIS-47 (25/11/2026) — CONTRAT PARTAGÉ « ScenarioFilm v1 » : le scénario d'un film proposé par le chat Mimmoza,
 * modifié ou validé par l'utilisateur, puis interprété par le Studio (aperçu animatique) et par la machine de rendu
 * (film Unreal).
 *
 * COPIE IDENTIQUE dans les deux dépôts (aucun import : le fichier se compile seul des deux côtés, et dans l'Edge) :
 *   - mimmozia-studio/src/core/echange/scenarioFilm.ts
 *   - mimmoza-front-v2/src/lib/studio/scenarioFilm.ts
 *
 * Bornes : 3 à 12 plans ; plan 2 à 15 s ; film 15 à 120 s (somme des plans = duree_s, corrigée ET dite) ;
 * prompt ≤ 280 caractères ; texte_ecran ≤ 60. `validerScenario` ne fait AUCUNE confiance à l'entrée : il refuse ce qui
 * est illisible (types, valeurs hors liste, nombre de plans) et CORRIGE ce qui peut l'être en le disant (durées
 * bornées, textes trop longs coupés, identifiants manquants ou en double, total recalculé).
 * Pur, déterministe.
 */

export type MouvementPlan = 'fixe' | 'travelling_avant' | 'travelling_lateral' | 'orbite' | 'panoramique' | 'drone_montee' | 'drone_survol' | 'grue' | 'approche_porte';
export type SujetPlan = 'exterieur_rue' | 'facade' | 'entree' | 'jardin' | 'terrasse' | 'balcon' | 'sejour' | 'cuisine' | 'chambre' | 'salle_de_bain' | 'vue_depuis_baie' | 'quartier' | 'aerien' | 'detail_matiere';
export interface PlanFilm { id: string; prompt: string; sujet: SujetPlan; mouvement: MouvementPlan; duree_s: number; texte_ecran?: string; transition?: 'coupe' | 'fondu' }
export interface ScenarioFilm {
  v: 1;
  titre: string;
  intention: string;
  duree_s: number;
  format: '16:9' | '9:16' | '1:1';
  ambiance: 'jour' | 'fin_de_journee' | 'nuit' | 'couvert';
  style: 'cinematique' | 'commercial' | 'reseaux' | 'documentaire';
  musique: { ambiance: 'douce' | 'energique' | 'elegante' | 'aucune' };
  voix_off: { texte: string } | null;
  plans: PlanFilm[];
  empreinte_projet?: string;
}

export const MOUVEMENTS_PLAN: readonly MouvementPlan[] = ['fixe', 'travelling_avant', 'travelling_lateral', 'orbite', 'panoramique', 'drone_montee', 'drone_survol', 'grue', 'approche_porte'];
export const SUJETS_PLAN: readonly SujetPlan[] = ['exterieur_rue', 'facade', 'entree', 'jardin', 'terrasse', 'balcon', 'sejour', 'cuisine', 'chambre', 'salle_de_bain', 'vue_depuis_baie', 'quartier', 'aerien', 'detail_matiere'];
export const FORMATS_FILM: readonly ScenarioFilm['format'][] = ['16:9', '9:16', '1:1'];
export const AMBIANCES_SCENARIO: readonly ScenarioFilm['ambiance'][] = ['jour', 'fin_de_journee', 'nuit', 'couvert'];
export const STYLES_FILM: readonly ScenarioFilm['style'][] = ['cinematique', 'commercial', 'reseaux', 'documentaire'];
export const MUSIQUES_FILM: readonly ScenarioFilm['musique']['ambiance'][] = ['douce', 'energique', 'elegante', 'aucune'];

export const PLANS_MIN = 3;
export const PLANS_MAX = 12;
export const DUREE_PLAN_MIN_S = 2;
export const DUREE_PLAN_MAX_S = 15;
export const DUREE_FILM_MIN_S = 15;
export const DUREE_FILM_MAX_S = 120;
export const PROMPT_MAX = 280;
export const TEXTE_ECRAN_MAX = 60;
export const TITRE_MAX = 80;
export const INTENTION_MAX = 500;
export const VOIX_OFF_MAX = 600;

export const LIBELLES_SUJET: Readonly<Record<SujetPlan, string>> = {
  exterieur_rue: 'vue depuis la rue', facade: 'façade', entree: 'entrée', jardin: 'jardin', terrasse: 'terrasse', balcon: 'balcon',
  sejour: 'séjour', cuisine: 'cuisine', chambre: 'chambre', salle_de_bain: 'salle de bain', vue_depuis_baie: 'vue depuis la baie',
  quartier: 'quartier', aerien: 'vue aérienne', detail_matiere: 'détail de matière',
};
export const LIBELLES_MOUVEMENT: Readonly<Record<MouvementPlan, string>> = {
  fixe: 'plan fixe', travelling_avant: 'travelling avant', travelling_lateral: 'travelling latéral', orbite: 'orbite', panoramique: 'panoramique',
  drone_montee: 'drone en montée', drone_survol: 'survol en drone', grue: 'mouvement de grue', approche_porte: 'approche de la porte',
};

const estObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const dans = <T extends string>(liste: readonly T[], v: unknown): v is T => typeof v === 'string' && (liste as readonly string[]).includes(v);
const dixieme = (x: number): number => Math.round(x * 10) / 10;
const RE_ID = /^[A-Za-z0-9_-]{1,40}$/;
const RE_EMPREINTE = /^[A-Za-z0-9:_.-]{1,80}$/;
const CLES_SCENARIO = ['v', 'titre', 'intention', 'duree_s', 'format', 'ambiance', 'style', 'musique', 'voix_off', 'plans', 'empreinte_projet'];
const CLES_PLAN = ['id', 'prompt', 'sujet', 'mouvement', 'duree_s', 'texte_ecran', 'transition'];

/** Texte nettoyé (espaces) et coupé à `max` caractères (dit dans `corrections`). */
function texte(v: string, max: number, quoi: string, corrections: string[]): string {
  const t = v.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  corrections.push(`${quoi} coupé à ${max} caractères`);
  return t.slice(0, max).trimEnd();
}

/**
 * Validation SANS CONFIANCE d'un scénario (venu du chat, de la base, d'un fichier). Rend le scénario normalisé et la
 * liste des corrections faites (en français, à dire à l'utilisateur), ou les erreurs qui empêchent de l'utiliser.
 */
export function validerScenario(brut: unknown): { ok: true; scenario: ScenarioFilm; corrections: string[] } | { ok: false; erreurs: string[] } {
  if (!estObj(brut)) return { ok: false, erreurs: ['scénario illisible (objet attendu)'] };
  const erreurs: string[] = [];
  const corrections: string[] = [];
  if (brut['v'] === undefined) corrections.push('version absente : v1 supposée');
  else if (brut['v'] !== 1) erreurs.push(`version ${String(brut['v'])} inconnue (v: 1 attendu)`);
  for (const k of Object.keys(brut)) if (!CLES_SCENARIO.includes(k)) corrections.push(`champ « ${k} » inconnu, ignoré`);

  let titre = '';
  if (typeof brut['titre'] !== 'string' || !brut['titre'].trim()) erreurs.push('titre manquant');
  else titre = texte(brut['titre'], TITRE_MAX, 'titre', corrections);
  let intention = '';
  if (brut['intention'] === undefined || brut['intention'] === null) corrections.push('intention absente');
  else if (typeof brut['intention'] !== 'string') erreurs.push('intention : texte attendu');
  else intention = texte(brut['intention'], INTENTION_MAX, 'intention', corrections);

  const format = brut['format'] ?? '16:9';
  if (brut['format'] === undefined) corrections.push('format absent : 16:9 retenu');
  if (!dans(FORMATS_FILM, format)) erreurs.push(`format « ${String(format)} » inconnu (${FORMATS_FILM.join(', ')})`);
  const ambiance = brut['ambiance'] ?? 'jour';
  if (brut['ambiance'] === undefined) corrections.push('ambiance absente : jour retenu');
  if (!dans(AMBIANCES_SCENARIO, ambiance)) erreurs.push(`ambiance « ${String(ambiance)} » inconnue (${AMBIANCES_SCENARIO.join(', ')})`);
  const style = brut['style'] ?? 'cinematique';
  if (brut['style'] === undefined) corrections.push('style absent : cinématique retenu');
  if (!dans(STYLES_FILM, style)) erreurs.push(`style « ${String(style)} » inconnu (${STYLES_FILM.join(', ')})`);
  let musique: ScenarioFilm['musique'] = { ambiance: 'douce' };
  if (brut['musique'] === undefined || brut['musique'] === null) corrections.push('musique absente : ambiance douce retenue');
  else if (!estObj(brut['musique']) || !dans(MUSIQUES_FILM, brut['musique']['ambiance'])) erreurs.push(`musique : { ambiance: ${MUSIQUES_FILM.join(' | ')} } attendu`);
  else musique = { ambiance: brut['musique']['ambiance'] as ScenarioFilm['musique']['ambiance'] };
  let voix_off: ScenarioFilm['voix_off'] = null;
  const vo = brut['voix_off'];
  if (vo !== undefined && vo !== null) {
    if (!estObj(vo) || typeof vo['texte'] !== 'string') erreurs.push('voix_off : { texte } ou null attendu');
    else {
      const t = texte(vo['texte'], VOIX_OFF_MAX, 'texte de la voix off', corrections);
      voix_off = t ? { texte: t } : null;
      if (!t) corrections.push('voix off vide : retirée');
    }
  }
  let empreinte_projet: string | undefined;
  if (brut['empreinte_projet'] !== undefined && brut['empreinte_projet'] !== null) {
    if (typeof brut['empreinte_projet'] === 'string' && RE_EMPREINTE.test(brut['empreinte_projet'])) empreinte_projet = brut['empreinte_projet'];
    else corrections.push('empreinte du projet illisible : ignorée');
  }

  const plansBruts = brut['plans'];
  const plans: PlanFilm[] = [];
  if (!Array.isArray(plansBruts)) erreurs.push('plans : liste attendue');
  else if (plansBruts.length < PLANS_MIN || plansBruts.length > PLANS_MAX) erreurs.push(`${plansBruts.length} plan(s) : ${PLANS_MIN} à ${PLANS_MAX} attendus`);
  else {
    const ids = new Set<string>();
    plansBruts.forEach((p, i) => {
      const n = i + 1;
      if (!estObj(p)) { erreurs.push(`plan ${n} illisible`); return; }
      for (const k of Object.keys(p)) if (!CLES_PLAN.includes(k)) corrections.push(`plan ${n} : champ « ${k} » inconnu, ignoré`);
      let id = typeof p['id'] === 'string' && RE_ID.test(p['id']) ? p['id'] : '';
      if (!id) { id = `p${n}`; corrections.push(`plan ${n} : identifiant absent ou illisible, « ${id} » retenu`); }
      if (ids.has(id)) { let k = n; while (ids.has(`p${k}`)) k++; corrections.push(`plan ${n} : identifiant « ${id} » en double, « p${k} » retenu`); id = `p${k}`; }
      ids.add(id);
      if (typeof p['prompt'] !== 'string' || !p['prompt'].trim()) { erreurs.push(`plan ${n} : prompt manquant`); return; }
      const prompt = texte(p['prompt'], PROMPT_MAX, `plan ${n} : prompt`, corrections);
      if (!dans(SUJETS_PLAN, p['sujet'])) { erreurs.push(`plan ${n} : sujet « ${String(p['sujet'])} » inconnu (${SUJETS_PLAN.join(', ')})`); return; }
      if (!dans(MOUVEMENTS_PLAN, p['mouvement'])) { erreurs.push(`plan ${n} : mouvement « ${String(p['mouvement'])} » inconnu (${MOUVEMENTS_PLAN.join(', ')})`); return; }
      const d = p['duree_s'];
      if (typeof d !== 'number' || !Number.isFinite(d)) { erreurs.push(`plan ${n} : durée (secondes) attendue`); return; }
      let duree_s = dixieme(d);
      if (duree_s < DUREE_PLAN_MIN_S || duree_s > DUREE_PLAN_MAX_S) {
        const b = Math.min(DUREE_PLAN_MAX_S, Math.max(DUREE_PLAN_MIN_S, duree_s));
        corrections.push(`plan ${n} : durée ${duree_s} s ramenée à ${b} s (${DUREE_PLAN_MIN_S} à ${DUREE_PLAN_MAX_S} s)`);
        duree_s = b;
      }
      const plan: PlanFilm = { id, prompt, sujet: p['sujet'] as SujetPlan, mouvement: p['mouvement'] as MouvementPlan, duree_s };
      if (p['texte_ecran'] !== undefined && p['texte_ecran'] !== null) {
        if (typeof p['texte_ecran'] !== 'string') corrections.push(`plan ${n} : texte à l’écran illisible, ignoré`);
        else {
          const t = texte(p['texte_ecran'], TEXTE_ECRAN_MAX, `plan ${n} : texte à l’écran`, corrections);
          if (t) plan.texte_ecran = t;
        }
      }
      if (p['transition'] !== undefined && p['transition'] !== null) {
        if (p['transition'] === 'coupe' || p['transition'] === 'fondu') plan.transition = p['transition'] as 'coupe' | 'fondu';
        else corrections.push(`plan ${n} : transition « ${String(p['transition'])} » inconnue, fondu retenu`);
      }
      plans.push(plan);
    });
  }
  if (erreurs.length) return { ok: false, erreurs };

  // Total : somme des plans, ramenée dans 15–120 s en étirant / resserrant les plans (bornes par plan respectées).
  const somme = (): number => dixieme(plans.reduce((a, p) => a + p.duree_s, 0));
  const total0 = somme();
  const cible = Math.min(DUREE_FILM_MAX_S, Math.max(DUREE_FILM_MIN_S, total0));
  if (cible !== total0) {
    for (let tour = 0; tour < 6 && Math.abs(somme() - cible) > 0.05; tour++) {
      const libres = plans.filter((p) => (cible > somme() ? p.duree_s < DUREE_PLAN_MAX_S : p.duree_s > DUREE_PLAN_MIN_S));
      const base = libres.reduce((a, p) => a + p.duree_s, 0);
      if (!libres.length || base <= 0) break;
      const k = (base + cible - somme()) / base;
      for (const p of libres) p.duree_s = dixieme(Math.min(DUREE_PLAN_MAX_S, Math.max(DUREE_PLAN_MIN_S, p.duree_s * k)));
    }
    // Reste d'arrondi sur le plan le plus long (dans ses bornes).
    const reste = dixieme(cible - somme());
    if (reste !== 0) {
      const p = [...plans].sort((a, b) => b.duree_s - a.duree_s)[0]!;
      p.duree_s = dixieme(Math.min(DUREE_PLAN_MAX_S, Math.max(DUREE_PLAN_MIN_S, p.duree_s + reste)));
    }
    corrections.push(`durée des plans ${total0} s ${total0 < cible ? 'allongée' : 'raccourcie'} à ${somme()} s (film de ${DUREE_FILM_MIN_S} à ${DUREE_FILM_MAX_S} s)`);
  }
  const total = somme();
  const declare = brut['duree_s'];
  if (typeof declare !== 'number' || !Number.isFinite(declare)) corrections.push(`durée du film absente : ${total} s (somme des plans)`);
  else if (Math.abs(declare - total) > 0.05) corrections.push(`durée du film ${declare} s corrigée en ${total} s (somme des plans)`);

  const scenario: ScenarioFilm = {
    v: 1, titre, intention, duree_s: total, format: format as ScenarioFilm['format'], ambiance: ambiance as ScenarioFilm['ambiance'],
    style: style as ScenarioFilm['style'], musique, voix_off, plans, ...(empreinte_projet ? { empreinte_projet } : {}),
  };
  return { ok: true, scenario, corrections };
}

/** Forme canonique (ordre des clés fixe) : base de l'empreinte. */
function canonique(s: ScenarioFilm): string {
  return JSON.stringify([
    s.v, s.titre, s.intention, s.duree_s, s.format, s.ambiance, s.style, s.musique.ambiance, s.voix_off ? s.voix_off.texte : null, s.empreinte_projet ?? null,
    s.plans.map((p) => [p.id, p.prompt, p.sujet, p.mouvement, p.duree_s, p.texte_ecran ?? null, p.transition ?? null]),
  ]);
}

/** Empreinte FNV-1a 32 bits du scénario : « sf1-xxxxxxxx ». */
export function empreinteScenario(s: ScenarioFilm): string {
  const t = canonique(s);
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `sf1-${h.toString(16).padStart(8, '0')}`;
}

const sec = (x: number): string => `${String(x).replace('.', ',')} s`;

/** Résumé lisible (français), une ligne par plan. */
export function resumerScenario(s: ScenarioFilm): string {
  const amb: Record<ScenarioFilm['ambiance'], string> = { jour: 'jour', fin_de_journee: 'fin de journée', nuit: 'nuit', couvert: 'ciel couvert' };
  const tete = `« ${s.titre} » — ${sec(s.duree_s)}, ${s.format}, ${amb[s.ambiance]}, ${s.plans.length} plans`
    + `${s.musique.ambiance === 'aucune' ? ', sans musique' : `, musique ${s.musique.ambiance === 'energique' ? 'énergique' : s.musique.ambiance === 'elegante' ? 'élégante' : 'douce'}`}`
    + `${s.voix_off ? ', voix off' : ''}`;
  const lignes = s.plans.map((p, i) => `${i + 1}. ${LIBELLES_SUJET[p.sujet]} — ${LIBELLES_MOUVEMENT[p.mouvement]}, ${sec(p.duree_s)}${p.texte_ecran ? ` — « ${p.texte_ecran} »` : ''}`);
  return [tete, ...lignes].join('\n');
}
