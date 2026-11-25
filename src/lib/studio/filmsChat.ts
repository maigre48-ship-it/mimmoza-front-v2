// src/lib/studio/filmsChat.ts
// =============================================================================
// VIS-46 (25/11/2026) — FILMS COMMANDÉS PAR LE CHAT : ce que le projet permet de filmer, les 3 scénarios proposés,
// la modification par phrase, les différences entre deux versions, le bloc ```mimmoza-scenario``` de la carte et la
// traduction vers les options « film » d'avant (repli sans migration). Module PUR (site + Edge, Deno).
//
// Règle d'or : AUCUN plan impossible. Chaque sujet est vérifié contre les capacités du PROJET EN VIGUEUR (bâtiment
// dessiné : éléments, ouvertures, toits ; sinon brief d'habillage) : pas de balcon sans balcon, pas de vue depuis la
// baie sans baie, pas de jardin pour un collectif, pas d'intérieur sans logement. Un plan refusé l'est AVEC sa raison.
// =============================================================================
import {
  DUREE_FILM_MAX_S, DUREE_FILM_MIN_S, DUREE_PLAN_MAX_S, DUREE_PLAN_MIN_S, LIBELLES_MOUVEMENT, LIBELLES_SUJET, PLANS_MAX, PLANS_MIN, PROMPT_MAX, VOIX_OFF_MAX,
  empreinteScenario, validerScenario, type MouvementPlan, type PlanFilm, type ScenarioFilm, type SujetPlan,
} from './scenarioFilm.ts';

/** Bornes du contrat (constantes de scenarioFilm.ts, copie identique Studio / site). */
const BORNES_SCENARIO = {
  plansMin: PLANS_MIN, plansMax: PLANS_MAX, planMinS: DUREE_PLAN_MIN_S, planMaxS: DUREE_PLAN_MAX_S, totalMinS: DUREE_FILM_MIN_S, totalMaxS: DUREE_FILM_MAX_S,
  promptMax: PROMPT_MAX, voixOffMax: VOIX_OFF_MAX,
} as const;
/** Libellé de sujet avec majuscule (les libellés du contrat sont en minuscules). */
const sujetLibelle = (s: SujetPlan): string => LIBELLES_SUJET[s].charAt(0).toUpperCase() + LIBELLES_SUJET[s].slice(1);

export const BLOC_SCENARIO = 'mimmoza-scenario';
export const OUTIL_PROPOSER_FILM = 'studio_proposer_film';
export const NOMBRE_PROPOSITIONS = 3;

/* ───────────────────────── Capacités du projet ───────────────────────── */

export interface CapacitesFilm {
  /** Nom du projet (bâtiment dessiné, sinon titre de la 3D préparée). */
  nom: string;
  type: 'maison' | 'collectif' | 'autre';
  /** Sujets filmables ; les autres ont leur raison dans `raisons`. */
  sujets: SujetPlan[];
  raisons: Partial<Record<SujetPlan, string>>;
  /** Empreinte du projet (dessin « mb1-… » ou préparation) : portée dans les scénarios proposés. */
  empreinte_projet: string | null;
  /** Lumière du brief, si elle est connue (reprise par la proposition 2). */
  ambiance_brief: ScenarioFilm['ambiance'] | null;
}

const estObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const sansAccents = (t: string): string => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’]/g, "'");

const INTERIEURS: readonly SujetPlan[] = ['sejour', 'cuisine', 'chambre', 'salle_de_bain'];

/**
 * Capacités d'un bâtiment DESSINÉ (ModeleBatiment, lu structurellement : aucun import lourd). `pieces` : pièces réelles
 * de l'intérieur (VIS-41) si l'appelant les connaît ; sinon le programme VIS-41 d'un logement (séjour, cuisine, chambre,
 * salle de bain — toujours posés par la distribution sur la forme).
 */
export function capacitesDepuisModele(modele: unknown, opts: { empreinte?: string | null; pieces?: readonly SujetPlan[] | null; ambiance?: ScenarioFilm['ambiance'] | null } = {}): CapacitesFilm {
  const m = estObj(modele) ? modele : {};
  const type = m.type === 'maison' || m.type === 'collectif' ? m.type : 'autre';
  const elements = Array.isArray(m.elements) ? m.elements.filter(estObj) : [];
  const ouvertures = Array.isArray(m.ouvertures) ? m.ouvertures.filter(estObj) : [];
  const volumes = Array.isArray(m.volumes) ? m.volumes.filter(estObj) : [];
  const aElement = (...t: string[]) => elements.some((e) => t.includes(String(e.type)));
  const raisons: Partial<Record<SujetPlan, string>> = {};
  const sujets: SujetPlan[] = ['exterieur_rue', 'facade', 'quartier', 'aerien', 'detail_matiere'];
  if (ouvertures.some((o) => o.type === 'porte')) sujets.push('entree'); else raisons.entree = 'aucune porte d’entrée dessinée';
  if (type === 'maison') sujets.push('jardin'); else raisons.jardin = type === 'collectif' ? 'immeuble collectif : pas de jardin privatif dessiné' : 'pas de jardin dans ce projet';
  const toitTerrasse = volumes.some((v) => estObj(v.toit) && v.toit.forme === 'terrasse');
  if (toitTerrasse || aElement('pergola', 'veranda')) sujets.push('terrasse'); else raisons.terrasse = 'pas de terrasse dans le bâtiment dessiné';
  if (aElement('balcon', 'loggia')) sujets.push('balcon'); else raisons.balcon = 'pas de balcon dans le bâtiment dessiné';
  const habitable = type === 'maison' || type === 'collectif';
  const pieces = opts.pieces?.length ? INTERIEURS.filter((p) => opts.pieces!.includes(p)) : habitable ? [...INTERIEURS] : [];
  for (const p of INTERIEURS) if (pieces.includes(p)) sujets.push(p); else raisons[p] = habitable ? 'pièce absente du plan intérieur' : 'pas de logement à l’intérieur';
  if (pieces.length && ouvertures.some((o) => o.type === 'baie' || o.type === 'porte_fenetre')) sujets.push('vue_depuis_baie');
  else raisons.vue_depuis_baie = pieces.length ? 'aucune baie ni porte-fenêtre dessinée' : 'pas de logement à l’intérieur';
  const nom = typeof m.nom === 'string' && m.nom.trim() ? m.nom.trim() : type === 'maison' ? 'la maison' : 'le bâtiment';
  return { nom, type, sujets, raisons, empreinte_projet: opts.empreinte ?? null, ambiance_brief: opts.ambiance ?? null };
}

/**
 * Capacités d'un projet SANS bâtiment dessiné (volume du moteur + brief d'habillage) : balcons selon le brief, terrasse
 * seulement avec un toit-terrasse demandé, jamais de jardin privatif (immeuble du programme), logement témoin (VIS-05).
 */
export function capacitesDepuisBrief(p: { nom?: string | null; balcons?: string | null; toiture?: string | null; empreinte?: string | null; ambiance?: ScenarioFilm['ambiance'] | null; maison?: boolean }): CapacitesFilm {
  const raisons: Partial<Record<SujetPlan, string>> = {};
  const sujets: SujetPlan[] = ['exterieur_rue', 'facade', 'entree', 'quartier', 'aerien', 'detail_matiere', ...INTERIEURS, 'vue_depuis_baie'];
  if (p.balcons && p.balcons !== 'aucun') sujets.push('balcon'); else raisons.balcon = p.balcons === 'aucun' ? 'habillage choisi sans balcon' : 'balcons non confirmés dans l’habillage';
  if (p.toiture === 'terrasse' || p.toiture === 'vegetalisee') sujets.push('terrasse'); else raisons.terrasse = 'pas de toit-terrasse dans l’habillage';
  if (p.maison) sujets.push('jardin'); else raisons.jardin = 'immeuble du programme : pas de jardin privatif';
  return { nom: p.nom?.trim() || 'le projet', type: p.maison ? 'maison' : 'collectif', sujets, raisons, empreinte_projet: p.empreinte ?? null, ambiance_brief: p.ambiance ?? null };
}

export function sujetPossible(c: CapacitesFilm, s: SujetPlan): { ok: true } | { ok: false; raison: string } {
  return c.sujets.includes(s) ? { ok: true } : { ok: false, raison: c.raisons[s] ?? 'sujet absent du projet' };
}

/** Plans impossibles pour CE projet (raison dite), dans l'ordre du scénario. */
export function plansImpossibles(s: ScenarioFilm, c: CapacitesFilm): { id: string; rang: number; sujet: SujetPlan; raison: string }[] {
  return s.plans.flatMap((p, i) => { const v = sujetPossible(c, p.sujet); return v.ok ? [] : [{ id: p.id, rang: i + 1, sujet: p.sujet, raison: v.raison }]; });
}

/* ───────────────────────── Prompts de plan ───────────────────────── */

const LUMIERE: Record<ScenarioFilm['ambiance'], string> = { jour: 'en pleine lumière', fin_de_journee: 'dans la lumière dorée du soir', nuit: 'de nuit, fenêtres éclairées', couvert: 'sous un ciel couvert, lumière douce' };

/** Prompt par défaut d'un plan (français naturel, ≤ 280 caractères). */
export function promptParDefaut(sujet: SujetPlan, mouvement: MouvementPlan, nom: string, ambiance: ScenarioFilm['ambiance']): string {
  const l = LUMIERE[ambiance];
  const de = nom.startsWith('la ') || nom.startsWith('le ') || nom.startsWith('l’') ? nom : `« ${nom} »`;
  const quoi: Record<SujetPlan, string> = {
    exterieur_rue: `On arrive par la rue vers ${de}, ${l}, à hauteur de piéton`,
    facade: `La façade de ${de} se découvre, ${l}, verticales droites`,
    entree: `On s’approche de la porte d’entrée de ${de}, ${l}`,
    jardin: `Le jardin de ${de}, pelouse et plantations, ${l}`,
    terrasse: `La terrasse de ${de}, mobilier d’extérieur, ${l}`,
    balcon: `Le balcon de ${de} et sa vue, ${l}`,
    sejour: `Le séjour meublé et ses volumes, ${l}`,
    cuisine: 'La cuisine équipée, plans de travail et rangements, ambiance chaleureuse',
    chambre: 'La chambre principale, lit fait, lumière douce',
    salle_de_bain: 'La salle de bain, faïence et sanitaires, lumière claire',
    vue_depuis_baie: `Depuis la baie vitrée du séjour, la vue vers l’extérieur, ${l}`,
    quartier: `Le quartier autour de ${de}, rues et voisinage, ${l}`,
    aerien: `Vue aérienne de ${de} sur sa parcelle, ${l}`,
    detail_matiere: `Gros plan sur les matières de la façade de ${de} (enduit, menuiseries)`,
  };
  const mvt = LIBELLES_MOUVEMENT[mouvement];
  const t = `${quoi[sujet]} — ${mvt}.`;
  return t.length <= BORNES_SCENARIO.promptMax ? t : `${t.slice(0, BORNES_SCENARIO.promptMax - 1)}…`;
}

/** Mouvement naturel d'un sujet (ajout d'un plan sans précision). */
export const MOUVEMENT_PAR_DEFAUT: Readonly<Record<SujetPlan, MouvementPlan>> = {
  exterieur_rue: 'travelling_avant', facade: 'travelling_lateral', entree: 'approche_porte', jardin: 'panoramique', terrasse: 'panoramique',
  balcon: 'panoramique', sejour: 'travelling_avant', cuisine: 'travelling_lateral', chambre: 'panoramique', salle_de_bain: 'fixe',
  vue_depuis_baie: 'travelling_avant', quartier: 'drone_survol', aerien: 'drone_montee', detail_matiere: 'travelling_lateral',
};

type Gabarit = { sujet: SujetPlan; mouvement: MouvementPlan; duree_s: number; texte_ecran?: string; transition?: 'coupe' | 'fondu' };

function construire(c: CapacitesFilm, base: Omit<ScenarioFilm, 'plans' | 'duree_s' | 'v'>, gabarits: (Gabarit | null)[]): ScenarioFilm {
  const plans: PlanFilm[] = gabarits.filter((x): x is Gabarit => x !== null && c.sujets.includes(x.sujet)).slice(0, BORNES_SCENARIO.plansMax).map((x, i) => ({
    id: `p${i + 1}`, prompt: promptParDefaut(x.sujet, x.mouvement, c.nom, base.ambiance), sujet: x.sujet, mouvement: x.mouvement, duree_s: x.duree_s,
    ...(x.texte_ecran ? { texte_ecran: x.texte_ecran } : {}), ...(x.transition ? { transition: x.transition } : {}),
  }));
  const s: ScenarioFilm = { v: 1, ...base, duree_s: plans.reduce((a, p) => a + p.duree_s, 0), plans, ...(c.empreinte_projet ? { empreinte_projet: c.empreinte_projet } : {}) };
  const v = validerScenario(s);
  if (!v.ok) throw new Error(`scénario proposé invalide : ${v.erreurs.join(' ; ')}`);
  return v.scenario;
}

/** Nom cité dans une phrase : « Maison hexagonale… » (guillemets), sauf « la maison » / « le bâtiment » génériques. */
const cite = (nom: string): string => (/^(la |le |l’)/.test(nom) ? nom : `« ${nom} »`);

const premier = (c: CapacitesFilm, ...s: SujetPlan[]): SujetPlan | null => s.find((x) => c.sujets.includes(x)) ?? null;
const g = (sujet: SujetPlan | null, mouvement: MouvementPlan, duree_s: number, plus: Partial<Gabarit> = {}): Gabarit | null => (sujet ? { sujet, mouvement, duree_s, ...plus } : null);

/**
 * Les 3 scénarios proposés, construits sur les capacités du projet (aucun plan impossible) :
 *   1. « Arrivée par la rue au coucher du soleil » — cinématique 16:9, extérieurs puis entrée (et séjour s'il existe) ;
 *   2. « Visite intérieure lumineuse » — commercial 16:9, pièces réelles (sinon « Tour du bâtiment en plein jour ») ;
 *   3. « Format réseaux 9:16 de 20 s » — vertical, énergique, 4 plans de 5 s avec textes à l'écran.
 */
export function proposerScenarios(c: CapacitesFilm): ScenarioFilm[] {
  const interieur = INTERIEURS.some((p) => c.sujets.includes(p));
  const s1 = construire(c, {
    titre: 'Arrivée par la rue au coucher du soleil',
    intention: `Un film cinématique qui fait arriver le spectateur par la rue, découvre ${cite(c.nom)} dans la lumière dorée du soir, s’approche de l’entrée${interieur ? ' et entre dans le séjour' : ''}, puis s’élève au-dessus de la parcelle.`,
    format: '16:9', ambiance: 'fin_de_journee', style: 'cinematique', musique: { ambiance: 'elegante' }, voix_off: null,
  }, [
    g('exterieur_rue', 'travelling_avant', 8, { texte_ecran: c.nom.length <= 60 ? c.nom : undefined }),
    g('facade', 'travelling_lateral', 8, { transition: 'fondu' }),
    g(premier(c, 'jardin', 'terrasse', 'balcon'), 'panoramique', 6),
    g(premier(c, 'entree', 'facade'), c.sujets.includes('entree') ? 'approche_porte' : 'orbite', 6),
    g(premier(c, 'sejour'), 'travelling_avant', 7),
    g('aerien', 'drone_montee', 10, { transition: 'fondu' }),
  ]);
  const s2 = interieur ? construire(c, {
    titre: 'Visite intérieure lumineuse',
    intention: `Une visite claire et rassurante de l’intérieur de ${cite(c.nom)} : on entre, on traverse les pièces de vie en lumière naturelle, on découvre la vue, puis on ressort sur la façade.`,
    format: '16:9', ambiance: c.ambiance_brief === 'nuit' ? 'jour' : c.ambiance_brief ?? 'jour', style: 'commercial', musique: { ambiance: 'douce' },
    voix_off: { texte: `Bienvenue dans ${cite(c.nom)}. Des pièces baignées de lumière, pensées pour la vie de tous les jours.` },
  }, [
    g(premier(c, 'entree', 'facade'), c.sujets.includes('entree') ? 'approche_porte' : 'travelling_avant', 6),
    g('sejour', 'travelling_avant', 10, { texte_ecran: 'Séjour lumineux' }),
    g(premier(c, 'vue_depuis_baie', 'terrasse', 'balcon', 'jardin'), 'travelling_avant', 7),
    g('cuisine', 'travelling_lateral', 8),
    g('chambre', 'panoramique', 8),
    g('salle_de_bain', 'fixe', 6),
    g('facade', 'orbite', 10, { transition: 'fondu' }),
  ]) : construire(c, {
    titre: 'Tour du bâtiment en plein jour',
    intention: `Un tour complet de ${cite(c.nom)} en plein jour : la rue, chaque façade, les matières de près, puis la vue d’ensemble sur le quartier.`,
    format: '16:9', ambiance: 'jour', style: 'documentaire', musique: { ambiance: 'douce' }, voix_off: null,
  }, [g('exterieur_rue', 'travelling_avant', 8), g('facade', 'orbite', 12), g('detail_matiere', 'travelling_lateral', 6), g('entree', 'approche_porte', 6), g('quartier', 'drone_survol', 10), g('aerien', 'drone_montee', 8)]);
  const s3 = construire(c, {
    titre: 'Format réseaux 9:16 de 20 s',
    intention: `Un format vertical court et rythmé pour Instagram et TikTok : le projet ${cite(c.nom)} vu du ciel, sa façade, ${interieur ? 'son séjour' : 'son entrée'}, et un détail qui donne envie.`,
    format: '9:16', ambiance: 'jour', style: 'reseaux', musique: { ambiance: 'energique' }, voix_off: null,
  }, [
    g('aerien', 'drone_survol', 5, { texte_ecran: 'Découvrez le projet' }),
    g('facade', 'orbite', 5),
    g(premier(c, 'sejour', 'entree', 'jardin'), 'travelling_avant', 5, { texte_ecran: interieur ? 'Des volumes généreux' : 'Une entrée soignée' }),
    g('detail_matiere', 'travelling_lateral', 5, { texte_ecran: 'Bientôt disponible' }),
  ]);
  return [s1, s2, s3];
}

/* ───────────────────────── Modification par phrase ───────────────────────── */

const LEXIQUE_SUJETS: readonly [RegExp, SujetPlan][] = [
  [/\bcuisine/, 'cuisine'], [/\bsalle (de bain|d'eau)|\bsdb\b/, 'salle_de_bain'], [/\bchambre/, 'chambre'], [/\bsejour|\bsalon|\bpiece de vie/, 'sejour'],
  [/\bbaie|\bvue depuis/, 'vue_depuis_baie'], [/\bbalcon|\bloggia/, 'balcon'], [/\bterrasse/, 'terrasse'], [/\bjardin|\bpelouse/, 'jardin'],
  [/\bentree|\bporte d'entree/, 'entree'], [/\bfacade/, 'facade'], [/\bquartier|\bvoisinage|\balentours/, 'quartier'], [/\baerien|\bdu ciel|\bvue d'avion|\bvue du dessus/, 'aerien'],
  [/\bmatiere|\bdetail/, 'detail_matiere'], [/\brue\b|\barrivee/, 'exterieur_rue'],
];
const sujetDe = (t: string): SujetPlan | null => LEXIQUE_SUJETS.find(([re]) => re.test(t))?.[1] ?? null;
const EXTERIEURS_DRONE: readonly SujetPlan[] = ['facade', 'exterieur_rue', 'jardin', 'quartier', 'aerien', 'terrasse'];
const arrondi = (n: number): number => Math.round(n * 10) / 10;
const somme = (p: readonly PlanFilm[]): number => arrondi(p.reduce((a, x) => a + x.duree_s, 0));

export interface IssueModification { ok: boolean; scenario: ScenarioFilm; changements: string[]; refus: string[] }

/** Rééchelonne les durées des plans pour viser `cible` secondes (2–15 s par plan, au dixième ; plans retirés si besoin). */
export function viserDuree(plans: readonly PlanFilm[], cible: number): PlanFilm[] {
  let p = plans.map((x) => ({ ...x }));
  // Trop de plans pour une durée courte (moins de 4 s par plan) : on retire l'avant-dernier (le final reste le final).
  while (p.length > BORNES_SCENARIO.plansMin && cible / p.length < 4) p.splice(p.length - 2, 1);
  const total = somme(p);
  p = p.map((x) => ({ ...x, duree_s: Math.min(BORNES_SCENARIO.planMaxS, Math.max(BORNES_SCENARIO.planMinS, arrondi(x.duree_s * cible / total))) }));
  // Ajustement fin, plan par plan, sur ceux qui ont de la marge, pour tomber juste.
  for (let tour = 0, i = 0; tour < 200; tour++, i = (i + 1) % p.length) {
    const ecart = arrondi(cible - somme(p));
    if (ecart === 0) break;
    const marge = ecart > 0 ? BORNES_SCENARIO.planMaxS - p[i].duree_s : BORNES_SCENARIO.planMinS - p[i].duree_s;
    if (marge === 0) continue;
    const pas = ecart > 0 ? Math.min(ecart, marge, 1) : Math.max(ecart, marge, -1);
    p[i] = { ...p[i], duree_s: arrondi(p[i].duree_s + pas) };
  }
  return p;
}

const nouvelId = (plans: readonly PlanFilm[]): string => { let n = plans.length + 1; while (plans.some((p) => p.id === `p${n}`)) n++; return `p${n}`; };

/**
 * Applique une phrase de l'utilisateur au scénario (sans IA, déterministe) : durée (« raccourcis à 30 s », « 1 min »),
 * ajout / retrait de plan (« ajoute un plan sur la cuisine », « enlève le plan 3 », « retire la chambre »), drone
 * (« plus de drone », « sans drone »), format (vertical / paysage / carré), lumière (nuit, coucher de soleil, jour,
 * couvert), musique (« sans musique », « musique énergique »), voix off (« ajoute une voix off », « sans voix off »).
 * Un ajout impossible pour le projet est REFUSÉ avec sa raison. `ok` faux si rien n'a été appliqué.
 */
export function modifierScenarioParPhrase(s: ScenarioFilm, phrase: string, c: CapacitesFilm): IssueModification {
  const t = sansAccents(phrase);
  let plans = s.plans.map((p) => ({ ...p }));
  const sc: ScenarioFilm = { ...s, musique: { ...s.musique }, voix_off: s.voix_off ? { ...s.voix_off } : null };
  const changements: string[] = [];
  const refus: string[] = [];
  const ajout = /\b(ajoute|ajouter|rajoute|rajouter|ajout|insere|inserer)\b|\b(mets|mettre|montre|montrer)\b[^.!?]*\bplans?\b/.test(t);
  const retrait = /\b(supprime|supprimer|enleve|enlever|retire|retirer|vire|virer|coupe le plan)\b/.test(t);
  const sujetVise = sujetDe(t);
  if (retrait && !/\bdrone|musique|voix/.test(t)) {
    const num = /\bplans?\s*(?:n[°o]\s*)?(\d{1,2})\b/.exec(t);
    const idx = num ? Number(num[1]) - 1 : sujetVise ? plans.findIndex((p) => p.sujet === sujetVise) : -1;
    if (idx < 0 || idx >= plans.length) refus.push(num ? `il n’y a pas de plan ${num[1]}` : 'plan à retirer introuvable dans le scénario');
    else if (plans.length <= BORNES_SCENARIO.plansMin) refus.push(`il faut garder au moins ${BORNES_SCENARIO.plansMin} plans`);
    else { changements.push(`plan ${idx + 1} retiré (${sujetLibelle(plans[idx].sujet)})`); plans.splice(idx, 1); }
  } else if (ajout && sujetVise && !/\bdrone\b/.test(t)) {
    const v = sujetPossible(c, sujetVise);
    if (!v.ok) refus.push(`${sujetLibelle(sujetVise)} : ${v.raison} — plan non ajouté`);
    else if (plans.length >= BORNES_SCENARIO.plansMax) refus.push(`${BORNES_SCENARIO.plansMax} plans au plus`);
    else {
      const mouvement = MOUVEMENT_PAR_DEFAUT[sujetVise];
      const plan: PlanFilm = { id: nouvelId(plans), prompt: promptParDefaut(sujetVise, mouvement, c.nom, sc.ambiance), sujet: sujetVise, mouvement, duree_s: 6 };
      plans.splice(Math.max(1, plans.length - 1), 0, plan); // avant le dernier plan : le final reste le final
      changements.push(`plan ajouté : ${sujetLibelle(sujetVise)} (${LIBELLES_MOUVEMENT[mouvement].toLowerCase()}, 6 s)`);
    }
  }
  if (/\b(plus de|davantage de|beaucoup de|encore du)\s+drone|\bplus aerien/.test(t)) {
    let n = 0;
    plans = plans.map((p) => {
      if (n < 2 && EXTERIEURS_DRONE.includes(p.sujet) && p.mouvement !== 'drone_survol' && p.mouvement !== 'drone_montee') { n++; return { ...p, mouvement: (p.sujet === 'aerien' ? 'drone_montee' : 'drone_survol') as MouvementPlan }; }
      return p;
    });
    if (n) changements.push(`${n} plan${n > 1 ? 's' : ''} extérieur${n > 1 ? 's' : ''} passé${n > 1 ? 's' : ''} en drone`);
    else if (plans.length < BORNES_SCENARIO.plansMax && c.sujets.includes('aerien')) {
      plans.push({ id: nouvelId(plans), prompt: promptParDefaut('aerien', 'drone_survol', c.nom, sc.ambiance), sujet: 'aerien', mouvement: 'drone_survol', duree_s: 6 });
      changements.push('plan de drone ajouté à la fin (6 s)');
    } else refus.push('aucun plan extérieur à passer en drone');
  } else if (/\b(moins de|sans|pas de)\s+drone/.test(t)) {
    let n = 0;
    plans = plans.map((p) => (p.mouvement === 'drone_survol' || p.mouvement === 'drone_montee' ? (n++, { ...p, mouvement: (p.sujet === 'aerien' ? 'grue' : 'orbite') as MouvementPlan }) : p));
    if (n) changements.push(`${n} plan${n > 1 ? 's' : ''} de drone remplacé${n > 1 ? 's' : ''} (orbite ou grue)`); else refus.push('aucun plan de drone dans le scénario');
  }
  const format: ScenarioFilm['format'] | null = /\b9\s*[:/x]\s*16\b|\bvertical|\bstory|\breels?\b|\btiktok/.test(t) ? '9:16' : /\b16\s*[:/x]\s*9\b|\bpaysage|\bhorizontal/.test(t) ? '16:9' : /\b1\s*[:/x]\s*1\b|\bcarre\b/.test(t) ? '1:1' : null;
  if (format && format !== sc.format) { changements.push(`format ${sc.format} → ${format}`); sc.format = format; }
  const amb: ScenarioFilm['ambiance'] | null = /\bde nuit\b|\bla nuit\b|\bnocturne|\ben nuit\b/.test(t) ? 'nuit' : /\bcoucher|\bfin de journee|\bsoir\b|\bdore/.test(t) ? 'fin_de_journee' : /\bcouvert|\bnuageux|\bgris\b/.test(t) ? 'couvert' : /\bplein jour|\ben journee|\bde jour\b|\bensoleille/.test(t) ? 'jour' : null;
  if (amb && amb !== sc.ambiance) { changements.push(`lumière : ${sc.ambiance} → ${amb}`); sc.ambiance = amb; }
  const mus: ScenarioFilm['musique']['ambiance'] | null = /\bsans musique|\bpas de musique|\bcoupe la musique/.test(t) ? 'aucune'
    : /\bmusique\b[^.!?]*\b(energique|dynamique|rythmee)|\b(energique|dynamique|rythmee)\b[^.!?]*\bmusique/.test(t) ? 'energique'
    : /\bmusique\b[^.!?]*\b(douce|calme)|\b(douce|calme)\b[^.!?]*\bmusique/.test(t) ? 'douce'
    : /\bmusique\b[^.!?]*\b(elegante|chic|classe)/.test(t) ? 'elegante' : null;
  if (mus && mus !== sc.musique.ambiance) { changements.push(`musique : ${sc.musique.ambiance} → ${mus}`); sc.musique = { ambiance: mus }; }
  if (/\b(sans|pas de|retire|enleve|supprime)\s+(la\s+)?voix/.test(t)) { if (sc.voix_off) { sc.voix_off = null; changements.push('voix off retirée'); } }
  else if (/\b(ajoute|mets|avec|rajoute)\b[^.!?]*\bvoix/.test(t) && !sc.voix_off) {
    sc.voix_off = { texte: `${sc.titre}. ${sc.intention}`.slice(0, BORNES_SCENARIO.voixOffMax) };
    changements.push('voix off ajoutée (texte tiré de l’intention, modifiable)');
  }
  const m = /(\d{1,3}(?:[.,]\d)?)\s*(secondes?|sec\b|s\b|minutes?|min\b|mn\b)/.exec(t);
  if (m && !/\bplan\s*\d/.test(t.slice(Math.max(0, m.index - 8), m.index))) {
    const cible = arrondi(Number(m[1].replace(',', '.')) * (/^m/.test(m[2]) ? 60 : 1));
    if (cible < BORNES_SCENARIO.totalMinS || cible > BORNES_SCENARIO.totalMaxS) refus.push(`durée de ${cible} s impossible (de ${BORNES_SCENARIO.totalMinS} à ${BORNES_SCENARIO.totalMaxS} s)`);
    else {
      const avant = plans.length;
      const avantS = somme(plans);
      plans = viserDuree(plans, cible);
      const obtenu = somme(plans);
      const retires = avant - plans.length;
      changements.push(`durée ${avantS} s → ${obtenu} s${retires ? ` (${retires} plan${retires > 1 ? 's' : ''} retiré${retires > 1 ? 's' : ''} pour tenir)` : ''}`);
      if (obtenu !== cible) refus.push(`${cible} s visées : ${obtenu} s obtenues (de ${BORNES_SCENARIO.planMinS} à ${BORNES_SCENARIO.planMaxS} s par plan)`);
    }
  }
  const total = somme(plans);
  if (total > BORNES_SCENARIO.totalMaxS) return { ok: false, scenario: s, changements: [], refus: [...refus, `le film dépasserait ${BORNES_SCENARIO.totalMaxS} s : modification annulée`] };
  const v = validerScenario({ ...sc, plans, duree_s: total });
  if (!v.ok) return { ok: false, scenario: s, changements: [], refus: [...refus, ...v.erreurs] };
  return { ok: changements.length > 0, scenario: v.scenario, changements, refus };
}

/* ───────────────────────── Différences entre deux versions ───────────────────────── */

export interface DifferencesScenario {
  /** Champs globaux changés (titre, intention, duree_s, format, ambiance, style, musique, voix_off). */
  champs: string[];
  /** Plans de la NOUVELLE version : ajouté, modifié (champs), déplacé. */
  plans: { id: string; statut: 'ajoute' | 'modifie' | 'deplace'; champs: string[] }[];
  /** Plans de l'ancienne version absents de la nouvelle. */
  retires: { id: string; sujet: SujetPlan }[];
}

export function differencesScenarios(avant: ScenarioFilm | null, apres: ScenarioFilm): DifferencesScenario {
  if (!avant) return { champs: [], plans: [], retires: [] };
  const champs = (['titre', 'intention', 'duree_s', 'format', 'ambiance', 'style'] as const).filter((k) => avant[k] !== apres[k]) as string[];
  if (avant.musique.ambiance !== apres.musique.ambiance) champs.push('musique');
  if ((avant.voix_off?.texte ?? null) !== (apres.voix_off?.texte ?? null)) champs.push('voix_off');
  const plans: DifferencesScenario['plans'] = [];
  const restants = avant.plans.filter((q) => apres.plans.some((p) => p.id === q.id)).map((q) => q.id);
  const communs = apres.plans.filter((p) => restants.includes(p.id)).map((p) => p.id);
  apres.plans.forEach((p) => {
    const q = avant.plans.find((x) => x.id === p.id);
    if (!q) { plans.push({ id: p.id, statut: 'ajoute', champs: [] }); return; }
    const ch = (['prompt', 'sujet', 'mouvement', 'duree_s', 'texte_ecran', 'transition'] as const).filter((k) => (q[k] ?? null) !== (p[k] ?? null)) as string[];
    if (ch.length) plans.push({ id: p.id, statut: 'modifie', champs: ch });
    else if (restants.indexOf(p.id) !== communs.indexOf(p.id)) plans.push({ id: p.id, statut: 'deplace', champs: [] });
  });
  const retires = avant.plans.filter((q) => !apres.plans.some((p) => p.id === q.id)).map((q) => ({ id: q.id, sujet: q.sujet }));
  return { champs, plans, retires };
}

/* ───────────────────────── Bloc ```mimmoza-scenario``` (message de la carte) ───────────────────────── */

export type ActionScenario = 'lancer' | 'modifier' | 'choisir';
export interface BlocScenario { action: ActionScenario; scenario: ScenarioFilm; /** Version affichée par la carte (1, 2…). */ version: number; corrections: string[] }

const PHRASES_ACTION: Record<ActionScenario, string> = {
  lancer: 'Je valide ce scénario : lance le film',
  modifier: 'J’ai modifié le scénario du film',
  choisir: 'Je choisis ce scénario de film',
};

/** Message envoyé par la carte : une phrase lisible + le bloc technique (masqué dans la bulle, relu par le serveur). */
export function messageScenario(action: ActionScenario, scenario: ScenarioFilm, version: number, phrase?: string): string {
  const corps = JSON.stringify({ v: 1, action, version, scenario });
  return `${phrase?.trim() || PHRASES_ACTION[action]} « ${scenario.titre} » (${String(scenario.duree_s).replace('.', ',')} s, ${scenario.plans.length} plans).\n\n\`\`\`${BLOC_SCENARIO}\n${corps}\n\`\`\``;
}

const RE_BLOC = new RegExp('```' + BLOC_SCENARIO + '[ \\t]*\\r?\\n([\\s\\S]*?)```');

/** Lit le bloc d'un message (null : pas de bloc ; `ok: false` : bloc présent mais refusé, avec les erreurs). */
export function lireBlocScenario(texte: unknown): { ok: true; valeur: BlocScenario } | { ok: false; erreurs: string[] } | null {
  if (typeof texte !== 'string') return null;
  const m = RE_BLOC.exec(texte);
  if (!m) return null;
  let brut: unknown;
  try { brut = JSON.parse(m[1]); } catch { return { ok: false, erreurs: ['bloc de scénario illisible (JSON)'] }; }
  if (!estObj(brut) || brut.v !== 1) return { ok: false, erreurs: ['bloc de scénario : version inconnue'] };
  const action = brut.action;
  if (action !== 'lancer' && action !== 'modifier' && action !== 'choisir') return { ok: false, erreurs: ['bloc de scénario : action inconnue'] };
  const v = validerScenario(brut.scenario);
  if (!v.ok) return { ok: false, erreurs: v.erreurs };
  const version = typeof brut.version === 'number' && Number.isInteger(brut.version) && brut.version > 0 ? brut.version : 1;
  return { ok: true, valeur: { action, scenario: v.scenario, version, corrections: v.corrections } };
}

/** Texte du message sans le bloc (bulle de l'utilisateur). */
export function sansBlocScenario(texte: string): string {
  return texte.replace(new RegExp('\\n*```' + BLOC_SCENARIO + '[\\s\\S]*?```', 'g'), '').trim();
}

/* ───────────────────────── Vers les options « film » d'avant ───────────────────────── */

export interface OptionsFilmScenario { duree_s: 30 | 60 | 90; ambiance: 'jour' | 'fin_de_journee' | 'nuit'; format: '16:9' | '9:16'; interieurs: boolean; musique: boolean }

/**
 * Options « film » historiques (contrôlées par _studio_job_options_valides) qui décrivent AU MIEUX le scénario : elles
 * partent toujours (le worker d'avant VIS-47 les lit) ; le scénario part EN PLUS dans `options.scenario` quand la base
 * l'accepte. Écarts DITS dans `ecarts` (jamais tus) : durée au palier, couvert → jour, carré → 16:9.
 */
export function optionsFilmDepuisScenario(s: ScenarioFilm): { options: OptionsFilmScenario; ecarts: string[] } {
  const ecarts: string[] = [];
  const palier: 30 | 60 | 90 = s.duree_s <= 45 ? 30 : s.duree_s <= 75 ? 60 : 90;
  if (palier !== s.duree_s) ecarts.push(`durée au palier le plus proche : ${palier} s (scénario : ${String(s.duree_s).replace('.', ',')} s)`);
  const ambiance = s.ambiance === 'couvert' ? 'jour' : s.ambiance;
  if (s.ambiance === 'couvert') ecarts.push('temps couvert : rendu en journée');
  const format = s.format === '9:16' ? '9:16' : '16:9';
  if (s.format === '1:1') ecarts.push('format carré : rendu en 16:9 (le carré n’est pas encore produit)');
  return { options: { duree_s: palier, ambiance, format, interieurs: s.plans.some((p) => INTERIEURS.includes(p.sujet) || p.sujet === 'vue_depuis_baie'), musique: s.musique.ambiance !== 'aucune' }, ecarts };
}

/** Identité d'un rendu de scénario : scénario + projet (un seul travail par identité, jamais deux). */
export function identiteRenduScenario(s: ScenarioFilm, empreinteProjet: string | null): string {
  return `${empreinteScenario(s)}:${empreinteProjet ?? 'projet-inconnu'}`;
}
