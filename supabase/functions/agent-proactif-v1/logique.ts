// supabase/functions/agent-proactif-v1/logique.ts
// ─────────────────────────────────────────────────────────────────────────────
// Agent PROACTIF — logique pure + orchestration par injection de dépendances.
// Aucun appel LLM ici : on rassemble ce que les veilles EXISTANTES ont déjà
// détecté, puis on décide (règles déterministes) :
//   · rien de sûr               → rien du tout (0 jeton, aucun briefing) ;
//   · éléments + budget + solde → mission `origine='proactif', type='veille'`
//                                 déjà validée (`en_attente`), devis plafonné ;
//   · éléments sans budget      → briefing déterministe (0 jeton).
// Idempotence : curseur = max(dernier briefing, dernier `criteres.curseur` d'une
// mission proactive) ; seuls les événements créés après ce curseur et au plus
// tard à l'instant du passage sont pris. Une mission proactive encore active
// bloque la création d'une nouvelle (les événements attendent le passage suivant).
// ─────────────────────────────────────────────────────────────────────────────

import {
  briefingDeterministe,
  dedoublonner,
  lienSur,
  type Briefing,
  type ElementBriefing,
} from '../copilot-chat/agent/briefing.ts';

// ── Types des lignes réellement lues (colonnes vérifiées en base le 30/10/2026) ─

export interface PrefsProactif {
  user_id: string;
  learning_enabled: boolean;
  proactif_actif: boolean;
  budget_proactif_mensuel: number;
  proactif_consomme_mois: number;
  proactif_mois: string | null; // date 'YYYY-MM-01'
}

export interface WatchZone {
  id: string; label: string; city: string; postal_code: string | null;
  insee_code: string | null; iris_code: string | null; is_active: boolean;
}
export interface ZoneAlert {
  id: string; city: string; postal_code: string | null; iris_code: string | null;
  alert_type: string; alert_score: number | null; message: string | null; created_at: string | null;
}
export interface WatchlistMatch {
  id: string; first_matched_at: string; is_active: boolean;
  watchlist: { id: string; name: string; is_active: boolean };
  cluster: {
    id: string; normalized_title: string | null; normalized_address: string | null; city: string | null;
    zip_code: string | null; canonical_price: number | null; canonical_surface_m2: number | null; is_active: boolean;
  } | null;
}
export interface OpportunityEvent {
  id: string; event_type: string; title: string | null; url: string | null; price: number | null;
  previous_price: number | null; price_delta_pct: number | null; score: number | null; seen: boolean; created_at: string;
}
export interface AoEvent {
  id: string; avis_id: string; objet: string | null; acheteur: string | null; url: string | null;
  zone_incertaine: boolean; date_limite: string | null; is_read: boolean; created_at: string;
}
export interface ProjetLocalise { id: string; name: string; insee: string; lat: number | null; lon: number | null }
export interface PermisSitadel {
  id: string; numero_permis: string | null; date_autorisation: string | null; commune_insee: string;
  commune: string | null; nature_projet: string | null; destination: string | null; nb_logements: number | null;
  surface_plancher: number | null; latitude: number | null; longitude: number | null; created_at: string | null;
}

export interface SourcesBrutes {
  zones: WatchZone[];
  alertes: ZoneAlert[];
  matches: WatchlistMatch[];
  opportunites: OpportunityEvent[];
  appelsOffres: AoEvent[];
  projets: ProjetLocalise[];
  permis: PermisSitadel[];
}

export type Tier = 'haiku' | 'sonnet' | 'opus';

// ── Économie (copie EXACTE des constantes de copilot-chat au 30/10/2026) ──────
// Pire cas d'une ÉTAPE de mission (moteur, agent/mission.ts : ETAPE_MAX_TOKENS = 4096,
// pas de recherche web) = debitJetons(tier, 60 000 in, 4 096 out, 0) → haiku 3 / sonnet 7 / opus 12.
// Pire cas du RAPPORT final (tour sans outils) = debitJetons(tier, 60 000, 4 000, 0).
// Si le moteur ou index.ts change ces valeurs, le test « pire cas » échoue : mettre à jour ici.
const TIER_RATES: Record<Tier, { in: number; out: number }> = {
  haiku: { in: 1, out: 5 }, sonnet: { in: 3, out: 15 }, opus: { in: 5, out: 25 },
};
const JETON_VALUE_EUR = 0.10, MARGIN = 3, USD_TO_EUR = 0.95;
export function debitJetons(tier: Tier, entree: number, sortie: number, recherches = 0): number {
  const r = TIER_RATES[tier];
  const eur = ((entree * r.in + sortie * r.out) / 1_000_000) * USD_TO_EUR + recherches * 0.01 * USD_TO_EUR;
  return Math.max(1, Math.ceil((eur * MARGIN) / JETON_VALUE_EUR));
}
export const pireCasEtape = (tier: Tier) => debitJetons(tier, 60_000, 4_096, 0);
export const pireCasRapport = (tier: Tier) => debitJetons(tier, 60_000, 4_000, 0);

/** Plan → tier par défaut (même règle que PLAN_POLICY/normalizePlan de copilot-chat). */
export function tierDepuisPlan(planCode: string | null | undefined, statut: string | null | undefined): Tier {
  if (!['active', 'trialing'].includes(String(statut ?? ''))) return 'haiku';
  switch (String(planCode ?? '').toLowerCase().trim()) {
    case 'proplus': case 'pro': case 'avance': case 'advanced': case 'starter': return 'sonnet';
    default: return 'haiku';
  }
}

export const ETAPES_MAX_VEILLE = 10;
export const ETAPES_MIN_VEILLE = 3;
export const BUDGET_MAX = 20_000;
export const FENETRE_MAX_JOURS = 7;
export const RAYON_PERMIS_M = 1000;
export const LOGEMENTS_MIN_SANS_COORDS = 10;

export interface DevisVeille {
  jetons_min: number; jetons_max: number; etapes_max: number; duree_estimee_min: number; tier: Tier; explication: string;
  emis_le: string; expire_le: string;
}
export const VALIDITE_DEVIS_MS = 24 * 3600_000;

/**
 * Devis plafonné au budget restant (même convention que calculerDevis du moteur :
 * jetons_max = étapes × pire cas d'une étape, rapport final compris dans les étapes).
 * null si le budget ne permet pas ETAPES_MIN_VEILLE étapes, ou ne laisse pas
 * de quoi payer une étape ET le rapport final (garde du moteur).
 */
export function devisVeille(budgetRestant: number, tier: Tier, nElements: number, now: Date): DevisVeille | null {
  const pc = pireCasEtape(tier);
  const etapes = Math.min(ETAPES_MAX_VEILLE, Math.floor(Math.max(0, budgetRestant) / pc));
  if (etapes < ETAPES_MIN_VEILLE) return null;
  const jetons_max = etapes * pc;
  if (jetons_max < pc + pireCasRapport(tier) || jetons_max > budgetRestant) return null;
  return {
    jetons_min: Math.min(jetons_max, Math.max(pc, Math.ceil(jetons_max * 0.4))),
    jetons_max,
    etapes_max: etapes,
    duree_estimee_min: Math.max(2, Math.round((etapes * 45 * 0.6) / 60)),
    tier,
    explication: `Qualification de ${nElements} signal${nElements > 1 ? 'aux' : ''} de veille en ${etapes} étapes au plus ` +
      `(${pc} jetons au maximum par étape), plafonnée à ${jetons_max} jetons sur votre budget de veille restant ` +
      `(${budgetRestant}). Seul le réellement consommé est débité, le reste est rendu.`,
    emis_le: now.toISOString(),
    expire_le: new Date(now.getTime() + VALIDITE_DEVIS_MS).toISOString(),
  };
}

// ── Temps ─────────────────────────────────────────────────────────────────────

/** Début de la fenêtre : max(curseur, now − 7 j). */
export function debutFenetre(curseur: string | null, now: Date): string {
  const plancher = now.getTime() - FENETRE_MAX_JOURS * 86_400_000;
  const c = curseur ? Date.parse(curseur) : NaN;
  return new Date(Number.isFinite(c) ? Math.max(c, plancher) : plancher).toISOString();
}

export function dansFenetre(ts: string | null | undefined, depuis: string, jusqua: string): boolean {
  if (!ts) return false;
  const t = Date.parse(ts);
  return Number.isFinite(t) && t > Date.parse(depuis) && t <= Date.parse(jusqua);
}

/** État budgétaire renvoyé par la RPC agent_proactif_etat (remise à zéro mensuelle faite en base). */
export interface EtatProactif { actif: boolean; learning_enabled: boolean; budget_mensuel: number; consomme_mois: number; restant: number }

/**
 * Reste réellement disponible : `restant` de la base (consommation RÉGLÉE du mois)
 * moins ce qui est encore engagé par des missions proactives non réglées
 * (le compteur n'est incrémenté qu'au règlement, par agent_mission_regler).
 */
export function budgetDisponible(etat: EtatProactif, engageNonRegle: number): number {
  const restant = Math.min(BUDGET_MAX, Math.max(0, Math.floor(Number(etat.restant) || 0)));
  return Math.max(0, restant - Math.max(0, engageNonRegle));
}

// ── Correspondances (précision > rappel) ─────────────────────────────────────

export function normaliserVille(v: string | null | undefined): string {
  return String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\b(saint)\b/g, 'st').replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Une alerte de zone appartient à une zone surveillée si :
 *  - IRIS des deux côtés → égalité stricte ;
 *  - sinon code postal des deux côtés → égalité ET même commune (un CP couvre parfois plusieurs communes) ;
 *  - sinon même commune, seulement si la zone n'a pas de code postal ni d'IRIS (zone « commune entière »).
 */
export function alerteDansZone(a: ZoneAlert, z: WatchZone): boolean {
  if (!z.is_active) return false;
  if (z.iris_code && a.iris_code) return z.iris_code === a.iris_code;
  const memeVille = normaliserVille(a.city) !== '' && normaliserVille(a.city) === normaliserVille(z.city);
  if (z.postal_code && a.postal_code) return z.postal_code === a.postal_code && memeVille;
  if (!z.postal_code && !z.iris_code) return memeVille;
  return false;
}

/** Distance haversine en mètres. */
export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const RE_INSEE = /^(\d{5}|2[AB]\d{3})$/;
const CLES_INSEE = ['code_insee', 'commune_insee', 'insee_code', 'codeInsee', 'insee', 'citycode'];
const CLES_LAT = ['lat', 'latitude'];
const CLES_LON = ['lon', 'lng', 'longitude'];
const SOUS_OBJETS = ['parcelle', 'terrain', 'adresse', 'address', 'localisation', 'location', 'commune', 'site', 'foncier'];

/** Localisation d'un projet à partir de `projects.data` (forme libre) : n'invente rien. */
export function localisationProjet(data: unknown): { insee: string; lat: number | null; lon: number | null } | null {
  const candidats: Record<string, unknown>[] = [];
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const d = data as Record<string, unknown>;
    candidats.push(d);
    for (const k of SOUS_OBJETS) {
      const s = d[k];
      if (s && typeof s === 'object' && !Array.isArray(s)) candidats.push(s as Record<string, unknown>);
    }
  }
  for (const c of candidats) {
    const insee = CLES_INSEE.map((k) => c[k]).find((v) => typeof v === 'string' && RE_INSEE.test(v.trim())) as string | undefined;
    if (!insee) continue;
    const num = (ks: string[]) => {
      for (const k of ks) {
        const v = typeof c[k] === 'string' ? Number(c[k]) : c[k];
        if (typeof v === 'number' && Number.isFinite(v)) return v;
      }
      return null;
    };
    let lat = num(CLES_LAT), lon = num(CLES_LON);
    if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) { lat = null; lon = null; }
    return { insee: insee.trim(), lat, lon };
  }
  return null;
}

// ── Mise en forme ─────────────────────────────────────────────────────────────

const fmtEur = (n: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' €';
const fmtNb = (n: number, d = 0) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: d }).format(n);
const fmtDate = (iso: string) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));

const LIBELLES_OPP: Record<string, string> = {
  new: 'Nouvelle annonce', nouvelle: 'Nouvelle annonce', new_listing: 'Nouvelle annonce',
  price_drop: 'Baisse de prix', baisse_prix: 'Baisse de prix',
};

/**
 * Transforme les lignes brutes en éléments de briefing sûrs, triés par priorité :
 * appels d'offres à échéance proche, permis près des projets, opportunités, marché.
 */
export function construireElements(s: SourcesBrutes, depuis: string, jusqua: string, now: Date): ElementBriefing[] {
  const ao: ElementBriefing[] = [], permis: ElementBriefing[] = [], opp: ElementBriefing[] = [], marche: ElementBriefing[] = [];

  // 1. Appels d'offres : non lus, zone certaine, échéance non dépassée.
  const aoTries = s.appelsOffres
    .filter((e) => !e.is_read && !e.zone_incertaine && dansFenetre(e.created_at, depuis, jusqua))
    .filter((e) => !e.date_limite || Date.parse(e.date_limite) > now.getTime())
    .filter((e) => (e.objet ?? '').trim())
    .sort((a, b) => (a.date_limite ? Date.parse(a.date_limite) : Infinity) - (b.date_limite ? Date.parse(b.date_limite) : Infinity));
  for (const e of aoTries) {
    const morceaux: string[] = [];
    if (e.acheteur) morceaux.push(`Acheteur : ${e.acheteur}.`);
    if (e.date_limite) morceaux.push(`Date limite de réponse : ${fmtDate(e.date_limite)}.`);
    const el: ElementBriefing = { genre: 'opportunite', titre: `Appel d'offres : ${e.objet!.trim()}`, detail: morceaux.join(' '), source: `ao_watch_events:${e.id}` };
    const l = lienSur(e.url); if (l) el.lien = l;
    ao.push(el);
  }

  // 2. Permis Sitadel autour des projets (≤ 1 km si coordonnées des deux côtés ;
  //    sinon même commune ET opération d'au moins 10 logements).
  for (const p of s.projets) {
    let n = 0;
    for (const pc of s.permis) {
      if (n >= 10) break;
      if (pc.commune_insee !== p.insee || !dansFenetre(pc.created_at, depuis, jusqua)) continue;
      let distance: number | null = null;
      if (p.lat !== null && p.lon !== null && pc.latitude !== null && pc.longitude !== null) {
        distance = distanceM(p.lat, p.lon, pc.latitude, pc.longitude);
        if (distance > RAYON_PERMIS_M) continue;
      } else if ((pc.nb_logements ?? 0) < LOGEMENTS_MIN_SANS_COORDS) {
        continue;
      }
      const morceaux: string[] = [];
      if (pc.nature_projet) morceaux.push(`Nature : ${pc.nature_projet}.`);
      if (pc.destination) morceaux.push(`Destination : ${pc.destination}.`);
      if (pc.nb_logements) morceaux.push(`${fmtNb(pc.nb_logements)} logement${pc.nb_logements > 1 ? 's' : ''}.`);
      if (pc.surface_plancher) morceaux.push(`Surface de plancher : ${fmtNb(pc.surface_plancher)} m².`);
      if (pc.date_autorisation) morceaux.push(`Autorisé le ${fmtDate(pc.date_autorisation)}.`);
      morceaux.push(distance !== null ? `À environ ${fmtNb(Math.round(distance / 10) * 10)} m du projet.` : 'Même commune que le projet (position exacte inconnue).');
      morceaux.push('Source : Sitadel.');
      permis.push({
        genre: 'permis',
        titre: `Permis ${pc.numero_permis ?? 'de construire'} près de « ${p.name} »${pc.commune ? ` (${pc.commune})` : ''}`,
        detail: morceaux.join(' '),
        source: `sitadel_permis:${pc.id}`,
      });
      n++;
    }
  }

  // 3. Opportunités : événements non vus, puis nouveaux biens correspondant aux listes de surveillance.
  for (const e of s.opportunites.filter((x) => !x.seen && dansFenetre(x.created_at, depuis, jusqua))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))) {
    const titre = (e.title ?? '').trim();
    const lien = lienSur(e.url);
    if (!titre && !lien) continue;
    const morceaux: string[] = [];
    if (e.price !== null) morceaux.push(`Prix : ${fmtEur(e.price)}.`);
    if (e.previous_price !== null && e.price !== null && e.previous_price > e.price) {
      morceaux.push(`Ancien prix : ${fmtEur(e.previous_price)}${e.price_delta_pct !== null ? ` (${fmtNb(e.price_delta_pct, 1)} %)` : ''}.`);
    }
    if (e.score !== null) morceaux.push(`Score Mimmoza : ${e.score}/100.`);
    const el: ElementBriefing = {
      genre: 'opportunite',
      titre: `${LIBELLES_OPP[e.event_type] ?? 'Annonce'} : ${titre || 'voir l’annonce'}`,
      detail: morceaux.join(' '),
      source: `opportunity_watch_events:${e.id}`,
    };
    if (lien) el.lien = lien;
    opp.push(el);
  }
  for (const m of s.matches) {
    if (!m.is_active || !m.watchlist.is_active || !m.cluster || !m.cluster.is_active) continue;
    if (!dansFenetre(m.first_matched_at, depuis, jusqua)) continue;
    const c = m.cluster;
    const libelle = (c.normalized_title ?? '').trim() || (c.normalized_address ?? '').trim();
    if (!libelle) continue;
    const morceaux: string[] = [`Liste de surveillance : ${m.watchlist.name}.`];
    if (c.city) morceaux.push(`Commune : ${c.city}${c.zip_code ? ` (${c.zip_code})` : ''}.`);
    if (c.canonical_price !== null) morceaux.push(`Prix : ${fmtEur(Number(c.canonical_price))}.`);
    if (c.canonical_surface_m2 !== null) morceaux.push(`Surface : ${fmtNb(Number(c.canonical_surface_m2))} m².`);
    opp.push({ genre: 'opportunite', titre: `Nouveau bien correspondant : ${libelle}`, detail: morceaux.join(' '), source: `user_watchlist_matches:${m.id}` });
  }

  // 4. Alertes de marché sur les zones surveillées (message obligatoire).
  for (const a of s.alertes) {
    if (!dansFenetre(a.created_at, depuis, jusqua) || !(a.message ?? '').trim()) continue;
    const zone = s.zones.find((z) => alerteDansZone(a, z));
    if (!zone) continue;
    marche.push({
      genre: 'marche',
      titre: `${zone.label} : ${a.alert_type.replace(/_/g, ' ')}`,
      detail: a.message!.trim(),
      source: `zone_alerts:${a.id}`,
    });
  }

  return dedoublonner([...ao, ...permis, ...opp, ...marche]);
}

// ── Orchestration ────────────────────────────────────────────────────────────

export interface NouvelleMission {
  user_id: string; origine: 'proactif'; type: 'veille'; objectif: string; criteres: Record<string, unknown>;
  statut: 'en_attente'; devis: DevisVeille; etapes_max: number;
}
/** cree_le = instant du passage : sert de curseur (les briefings du moteur, avec mission_id, n'en servent pas). */
export interface NouveauBriefing { user_id: string; titre: string; resume: string; elements: ElementBriefing[]; lu: false; cree_le: string }

export interface DepotProactif {
  /** Lignes user_ai_preferences avec proactif_actif ET learning_enabled (le filtre est refait ici). */
  utilisateursCandidats(userIds?: string[]): Promise<PrefsProactif[]>;
  /** RPC agent_proactif_etat (service_role) : fait aussi la remise à zéro au changement de mois. */
  etat(userId: string): Promise<EtatProactif>;
  /** Jetons engagés par les missions proactives pas encore réglées (max(réservé, devis.jetons_max)). */
  engageNonRegle(userId: string): Promise<number>;
  /** Dernier horodatage traité : max(cree_le du dernier briefing SANS mission_id, criteres.curseur de la dernière mission proactive). */
  curseur(userId: string): Promise<string | null>;
  missionProactiveActive(userId: string): Promise<boolean>;
  sources(userId: string, depuis: string, jusqua: string): Promise<SourcesBrutes>;
  tier(userId: string): Promise<Tier>;
  /** credit_accounts.current_credits ; null si inconnu. */
  solde(userId: string): Promise<number | null>;
  creerMission(m: NouvelleMission): Promise<string | null>;
  creerBriefing(b: NouveauBriefing): Promise<string | null>;
}

export type Resultat =
  | { user_id: string; resultat: 'ignore'; raison: string }
  | { user_id: string; resultat: 'rien'; depuis: string }
  | { user_id: string; resultat: 'mission_deja_active'; n_elements: number }
  | { user_id: string; resultat: 'mission'; mission_id: string; n_elements: number; jetons_max: number }
  | { user_id: string; resultat: 'briefing'; briefing_id: string | null; n_elements: number; raison: string }
  | { user_id: string; resultat: 'erreur'; message: string };

export const MAX_EVENEMENTS_MISSION = 30;

export function objectifVeille(elements: ElementBriefing[]): string {
  const n = elements.length;
  return (
    `Veille de nuit : qualifier ${n} signal${n > 1 ? 'aux' : ''} relevé${n > 1 ? 's' : ''} par les veilles de l'utilisateur ` +
    `(liste dans criteres.evenements). Pour chacun, vérifier avec les outils s'il est réellement utile ` +
    `(pertinence, chiffres sourcés) ; ne retenir que ce qui est sûr. Terminer par un rapport dont ` +
    `« elements » reprend chaque signal retenu au format {source, genre, titre, detail, lien?, retenu}. ` +
    `Aucune action externe, aucun courrier.`
  ).slice(0, 2000);
}

export async function traiterUtilisateur(depot: DepotProactif, prefs: PrefsProactif, now: Date): Promise<Resultat> {
  const uid = prefs.user_id;
  try {
    if (prefs.learning_enabled !== true) return { user_id: uid, resultat: 'ignore', raison: 'learning_desactive' };
    if (prefs.proactif_actif !== true) return { user_id: uid, resultat: 'ignore', raison: 'proactif_inactif' };

    const jusqua = now.toISOString();
    const depuis = debutFenetre(await depot.curseur(uid), now);
    const elements = construireElements(await depot.sources(uid, depuis, jusqua), depuis, jusqua, now);
    if (elements.length === 0) return { user_id: uid, resultat: 'rien', depuis };

    if (await depot.missionProactiveActive(uid)) {
      return { user_id: uid, resultat: 'mission_deja_active', n_elements: elements.length };
    }

    // Contrôle d'autorité côté base (remise à zéro mensuelle comprise).
    const etat = await depot.etat(uid);
    if (etat.learning_enabled !== true) return { user_id: uid, resultat: 'ignore', raison: 'learning_desactive' };
    if (etat.actif !== true) return { user_id: uid, resultat: 'ignore', raison: 'proactif_inactif' };
    const restant = budgetDisponible(etat, await depot.engageNonRegle(uid));
    const tier = await depot.tier(uid);
    const devis = devisVeille(restant, tier, elements.length, now);
    const solde = devis ? await depot.solde(uid) : null;

    let raison = 'budget_insuffisant';
    if (devis && solde !== null && solde < devis.jetons_max) raison = 'solde_insuffisant';
    if (devis && solde === null) raison = 'solde_inconnu';
    if (devis && solde !== null && solde >= devis.jetons_max) {
      const evenements = elements.slice(0, MAX_EVENEMENTS_MISSION);
      const missionId = await depot.creerMission({
        user_id: uid, origine: 'proactif', type: 'veille', statut: 'en_attente',
        objectif: objectifVeille(evenements),
        criteres: { curseur: jusqua, depuis, evenements, nb_evenements_total: elements.length },
        devis, etapes_max: devis.etapes_max,
      });
      if (missionId) {
        // Pas d'incrément du compteur ici : agent_mission_regler le fait au règlement.
        return { user_id: uid, resultat: 'mission', mission_id: missionId, n_elements: elements.length, jetons_max: devis.jetons_max };
      }
      raison = 'creation_mission_refusee';
    }

    const b: Briefing | null = briefingDeterministe(elements);
    if (!b) return { user_id: uid, resultat: 'rien', depuis };
    const id = await depot.creerBriefing({ user_id: uid, titre: b.titre, resume: b.resume, elements: b.elements, lu: false, cree_le: jusqua });
    return { user_id: uid, resultat: 'briefing', briefing_id: id, n_elements: b.elements.length, raison };
  } catch (e) {
    return { user_id: uid, resultat: 'erreur', message: e instanceof Error ? e.message : String(e) };
  }
}

export async function executerProactif(depot: DepotProactif, now: Date, userIds?: string[]): Promise<Resultat[]> {
  const prefs = await depot.utilisateursCandidats(userIds);
  const out: Resultat[] = [];
  for (const p of prefs) out.push(await traiterUtilisateur(depot, p, now)); // séquentiel : charge base modérée
  return out;
}
