// supabase/functions/copilot-chat/agent/briefing.ts
// ─────────────────────────────────────────────────────────────────────────────
// Agent autonome — conversion PURE d'un rapport de mission « veille » en
// briefing (table agent_briefings). Aucun accès réseau, aucune base : le moteur
// (mission.ts) appelle ces fonctions puis insère le résultat lui-même.
//
// Règle d'or : PRÉCISION > RAPPEL. Un élément sans titre, sans source traçable
// ou d'un genre inconnu est écarté ; un élément explicitement écarté par la
// mission (retenu === false, verdict « à écarter ») aussi. Zéro élément sûr →
// null → AUCUN briefing.
//
// Format d'un élément (contrat §1, agent_briefings.elements) :
//   { genre: opportunite|permis|plu|marche|alerte, titre, detail, lien?, mission_id?, source }
//
// Format attendu du rapport d'une mission « veille » (à produire par le moteur
// via terminer_mission) — tous les champs sont facultatifs :
//   { titre?, synthese?, elements?: [{ source, genre, titre, detail?, lien?, retenu? }],
//     terrains?: [{ idu, commune, verdict, points_forts[], points_bloquants[], sources[] }] }
// ─────────────────────────────────────────────────────────────────────────────

export const GENRES_BRIEFING = ['opportunite', 'permis', 'plu', 'marche', 'alerte'] as const;
export type GenreBriefing = typeof GENRES_BRIEFING[number];

export interface ElementBriefing {
  genre: GenreBriefing;
  titre: string;
  detail: string;
  lien?: string;
  mission_id?: string;
  source: string;
}

export interface Briefing {
  titre: string;
  resume: string;
  elements: ElementBriefing[];
  mission_id?: string;
}

export const MAX_ELEMENTS_BRIEFING = 20;
const MAX_TITRE = 160;
const MAX_DETAIL = 600;
const MAX_RESUME = 1000;
const MAX_TITRE_BRIEFING = 120;

const LIBELLES_GENRE: Record<GenreBriefing, [string, string]> = {
  opportunite: ['opportunité', 'opportunités'],
  permis: ['permis de construire', 'permis de construire'],
  plu: ['évolution du PLU', 'évolutions du PLU'],
  marche: ['signal de marché', 'signaux de marché'],
  alerte: ['alerte', 'alertes'],
};

function texte(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  // Espaces normalisés, caractères de contrôle retirés.
  // deno-lint-ignore no-control-regex
  const t = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

/** Lien accepté seulement s'il est http(s) ou un chemin interne commençant par « / ». */
export function lienSur(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const l = v.trim();
  if (!l || l.length > 2000) return undefined;
  if (l.startsWith('/') && !l.startsWith('//')) return l;
  try {
    const u = new URL(l);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

function estUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/** Valide et normalise un élément ; renvoie null s'il n'est pas sûr. */
export function normaliserElement(brut: unknown, missionId?: string): ElementBriefing | null {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return null;
  const e = brut as Record<string, unknown>;
  if (e.retenu === false) return null;
  const genre = typeof e.genre === 'string' ? e.genre.trim().toLowerCase() : '';
  if (!(GENRES_BRIEFING as readonly string[]).includes(genre)) return null;
  const titre = texte(e.titre, MAX_TITRE);
  const source = texte(e.source, 200);
  if (!titre || !source) return null;
  const out: ElementBriefing = { genre: genre as GenreBriefing, titre, detail: texte(e.detail, MAX_DETAIL), source };
  const lien = lienSur(e.lien);
  if (lien) out.lien = lien;
  const mid = estUuid(e.mission_id) ? e.mission_id : missionId;
  if (estUuid(mid)) out.mission_id = mid;
  return out;
}

const VERDICTS_ECARTES = /(écart|ecart|rejet|abandon|défavorable|defavorable|non retenu|bloqu|inconstructible)/i;

/** Un terrain qualifié par la mission devient une « opportunité » seulement s'il est sourcé et non écarté. */
function terrainVersElement(brut: unknown, missionId?: string): ElementBriefing | null {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return null;
  const t = brut as Record<string, unknown>;
  const sources = Array.isArray(t.sources) ? t.sources.filter((s) => typeof s === 'string' && s.trim()) as string[] : [];
  const idu = texte(t.idu, 40);
  const verdict = texte(t.verdict, 120);
  if (!idu || sources.length === 0 || !verdict || VERDICTS_ECARTES.test(verdict)) return null;
  const commune = texte(t.commune, 80);
  const forts = Array.isArray(t.points_forts) ? t.points_forts.map((x) => texte(x, 160)).filter(Boolean).slice(0, 3) : [];
  const bloquants = Array.isArray(t.points_bloquants) ? t.points_bloquants.map((x) => texte(x, 160)).filter(Boolean).slice(0, 2) : [];
  const morceaux = [`Verdict : ${verdict}.`];
  if (forts.length) morceaux.push(`Points forts : ${forts.join(' ; ')}.`);
  if (bloquants.length) morceaux.push(`Points de vigilance : ${bloquants.join(' ; ')}.`);
  morceaux.push(`Sources : ${sources.slice(0, 4).map((s) => texte(s, 60)).join(', ')}.`);
  return normaliserElement({
    genre: 'opportunite',
    titre: commune ? `Terrain ${idu} (${commune})` : `Terrain ${idu}`,
    detail: morceaux.join(' '),
    source: `parcelle:${idu}`,
  }, missionId);
}

/** Dédoublonne (même source + même titre), garde l'ordre, plafonne. */
export function dedoublonner(elements: ElementBriefing[], max = MAX_ELEMENTS_BRIEFING): ElementBriefing[] {
  const vus = new Set<string>();
  const out: ElementBriefing[] = [];
  for (const e of elements) {
    const k = `${e.source}|${e.titre.toLowerCase()}`;
    if (vus.has(k)) continue;
    vus.add(k);
    out.push(e);
    if (out.length >= max) break;
  }
  return out;
}

/** « 2 opportunités et 1 permis de construire » — décompte déterministe par genre. */
export function decompteParGenre(elements: ElementBriefing[]): string {
  const parties: string[] = [];
  for (const g of GENRES_BRIEFING) {
    const n = elements.filter((e) => e.genre === g).length;
    if (n > 0) parties.push(`${n} ${LIBELLES_GENRE[g][n > 1 ? 1 : 0]}`);
  }
  if (parties.length <= 1) return parties.join('');
  return parties.slice(0, -1).join(', ') + ' et ' + parties[parties.length - 1];
}

/** Briefing déterministe (0 jeton) à partir d'éléments déjà sûrs. null si vide. */
export function briefingDeterministe(elements: ElementBriefing[], missionId?: string): Briefing | null {
  const propres = dedoublonner(elements.map((e) => normaliserElement(e, missionId)).filter((e): e is ElementBriefing => e !== null));
  if (propres.length === 0) return null;
  const n = propres.length;
  const b: Briefing = {
    titre: n > 1 ? `Pendant votre absence : ${n} nouveautés` : 'Pendant votre absence : 1 nouveauté',
    resume: `Vos veilles ont relevé ${decompteParGenre(propres)}.`,
    elements: propres,
  };
  if (missionId && estUuid(missionId)) b.mission_id = missionId;
  return b;
}

/**
 * Convertit le rapport d'une mission « veille » en briefing.
 * - prend `rapport.elements` (validés un par un) puis `rapport.terrains` (sourcés, non écartés) ;
 * - titre/résumé repris du rapport s'ils existent, sinon générés ;
 * - renvoie null s'il ne reste AUCUN élément sûr (pas de briefing vide ni « rien à signaler »).
 */
export function rapportVeilleVersBriefing(rapport: unknown, options: { mission_id?: string } = {}): Briefing | null {
  if (!rapport || typeof rapport !== 'object' || Array.isArray(rapport)) return null;
  const r = rapport as Record<string, unknown>;
  const missionId = estUuid(options.mission_id) ? options.mission_id : undefined;
  const elements: ElementBriefing[] = [];
  if (Array.isArray(r.elements)) {
    for (const e of r.elements) {
      const n = normaliserElement(e, missionId);
      if (n) elements.push(n);
    }
  }
  if (Array.isArray(r.terrains)) {
    for (const t of r.terrains) {
      const n = terrainVersElement(t, missionId);
      if (n) elements.push(n);
    }
  }
  const propres = dedoublonner(elements);
  if (propres.length === 0) return null;
  const n = propres.length;
  const titre = texte(r.titre, MAX_TITRE_BRIEFING) ||
    (n > 1 ? `Pendant votre absence : ${n} nouveautés` : 'Pendant votre absence : 1 nouveauté');
  const resume = texte(r.synthese, MAX_RESUME) || `La veille a retenu ${decompteParGenre(propres)}.`;
  const b: Briefing = { titre, resume, elements: propres };
  if (missionId) b.mission_id = missionId;
  return b;
}

/**
 * Aide pour le moteur, en fin de mission `veille` (quel que soit le statut final) :
 * 1. rapport exploitable → briefing qualifié ;
 * 2. mission terminée avec un rapport qui écarte tout → null (la mission a jugé : rien de sûr) ;
 * 3. mission interrompue (echec, budget_atteint, annulee) sans rapport exploitable →
 *    repli sur les éléments bruts déjà vérifiés par les veilles (criteres.evenements),
 *    pour ne pas perdre les signaux détectés.
 */
export function briefingPourMissionVeille(mission: {
  id?: string; statut?: string; rapport?: unknown; criteres?: unknown;
}): Briefing | null {
  const qualifie = rapportVeilleVersBriefing(mission.rapport, { mission_id: mission.id });
  if (qualifie) return qualifie;
  if (mission.statut === 'terminee') return null;
  const c = (mission.criteres && typeof mission.criteres === 'object') ? mission.criteres as Record<string, unknown> : {};
  const bruts = Array.isArray(c.evenements) ? c.evenements : [];
  const elements = bruts.map((e) => normaliserElement(e, mission.id)).filter((e): e is ElementBriefing => e !== null);
  return briefingDeterministe(elements, mission.id);
}
