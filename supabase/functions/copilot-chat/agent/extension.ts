// supabase/functions/copilot-chat/agent/extension.ts
// =============================================================
// LOT X3 (14/11/2026) — Mimmo et les EXTENSIONS DE MAISON (côté site).
//
// Un outil, `extension_maison`, appelé par le serveur (tour imposé) dès qu'une demande d'extension est détectée ou
// qu'une réponse au parcours arrive. Il ne prend AUCUNE valeur du modèle : la parcelle vient de la conception (ou de
// l'identifiant cadastral donné), les réponses viennent du message REÇU de l'utilisateur, l'état du parcours vient du
// tour précédent (copilot_tool_calls de la conversation). Tout le calcul est dans _shared/extension (pur, testé) :
//   BD TOPO (IGN) → estimation de la maison (règles X1) → questions (choix cliquables) → moteur d'extension (X2)
//   → régime indicatif DP / PC et architecte (F36777, F20568) → `fiche.projet_extension` (contrat X0).
// Le serveur affiche lui-même le texte et les questions (aucun chiffre écrit par le modèle).
// Lectures réseau (lecture seule, délais bornés, jamais bloquantes) : WFS Géoplateforme (BD TOPO), API BDNB (CSTB),
// API Carto IGN (zonage GPU ; cadastre si la conception manque).
// =============================================================

import { lireProjetExtension, type DonneesBdnb, type ProjetExtension } from '../../_shared/extension/contrat.ts';
import { anneauParcelle, contourEnLambert93, telechargerBatimentsParcelle, type BatimentBdTopo } from '../../_shared/extension/bdtopoParcelle.ts';
import { lambert93VersWgs84 } from '../../_shared/extension/lambert93.ts';
import {
  avancerParcours, detecterIntentionExtension, lireEtat, OUTIL_EXTENSION_MAISON, reponseAuParcours, suiteDuParcours,
  type ContexteParcours, type RegleSite, type SortieParcours,
} from '../../_shared/extension/parcours.ts';
import { facadesVoieDeLaParcelle } from './voisines-parcelle.ts';
import type { OutilDef, ResultatOutil } from './types.ts';

export { detecterIntentionExtension, OUTIL_EXTENSION_MAISON, reponseAuParcours, suiteDuParcours };

export const SOURCE_EXTENSION = 'MimmozIA · Extension de maison';
export const DELAI_SOURCE_MS = 10_000;
/** Sorties d'outil relues pour retrouver l'état du parcours (les plus récentes d'abord). */
export const ETATS_RELUS_MAX = 10;
/**
 * Rendu (image, film, visite) d'un projet d'extension : FERMÉ tant que la machine de rendu ne sait pas dessiner la maison
 * conservée et l'extension (lot X4). Ouvert, le devis porterait `fiche.projet_extension` et l'option `existant`.
 */
export const RENDU_EXTENSION_OUVERT = false;
/** Réponse de l'outil de rendu tant que le rendu d'extension est fermé. */
export const MESSAGE_RENDU_EXTENSION_FERME =
  'RIEN N’A ÉTÉ LANCÉ. Cette conversation porte un projet d’EXTENSION (maison existante conservée) : la machine de rendu ' +
  'ne sait pas encore dessiner la maison conservée avec son extension (prochaine étape). Une image aujourd’hui montrerait un ' +
  'bâtiment neuf à la place : ne la propose pas. Dis-le simplement à l’utilisateur ; le projet (maison, extension, régime ' +
  'indicatif) reste enregistré dans la conversation.';

/** Fiche du travail complétée du projet d'extension (contrat X0), au même niveau que `habillage_batiments`. */
export function ficheAvecProjetExtension<T extends Record<string, unknown>>(fiche: T, projet: ProjetExtension): T & { projet_extension: ProjetExtension } {
  return { ...fiche, projet_extension: JSON.parse(JSON.stringify(projet)) as ProjetExtension };
}

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_IDU = /^(2[AB]\d{3}|\d{5})\d{3}[0-9A-Z]{2}\d{4}$/;

export const OUTIL_EXTENSION_MAISON_DEF: OutilDef = {
  name: OUTIL_EXTENSION_MAISON,
  description:
    "Parcours EXTENSION DE MAISON (agrandissement latéral ou arrière, surélévation, garage accolé) sur une parcelle : " +
    "lit la maison existante dans la base des bâtiments de l'IGN, l'estime (toit, hauteurs, niveaux, surface) avec les " +
    "statuts de chaque valeur, pose les questions (conserver la maison, confirmer l'estimation, type, façade vue de la rue, " +
    "dimensions, surface de plancher RÉELLE), fait tourner le moteur d'extension et donne le régime INDICATIF (déclaration " +
    "préalable / permis, architecte). Le SERVEUR lit lui-même les réponses de l'utilisateur et affiche le texte et les " +
    "questions : n'écris aucun chiffre, ne pose aucune question à sa place. À appeler à chaque message du parcours.",
  input_schema: {
    type: 'object',
    properties: {
      conception_id: { type: 'string', description: 'Identifiant (uuid) de la conception de la parcelle, si connu.' },
      idu: { type: 'string', description: 'Identifiant cadastral (14 caractères) de la parcelle, si l’utilisateur l’a donné.' },
    },
  },
  available_in_modes: ['quick', 'advanced', 'report'],
};

/** Consigne ajoutée au prompt système quand le parcours est en cours ou demandé. */
export const CONSIGNE_EXTENSION = [
  '# EXTENSION DE MAISON — PARCOURS GUIDÉ PAR LE SERVEUR',
  `Appelle \`${OUTIL_EXTENSION_MAISON}\` (sans inventer de paramètre ; \`idu\` seulement si l’utilisateur a donné la parcelle).`,
  '- Le serveur AFFICHE lui-même l’estimation, les verdicts et les questions à choix : n’écris ensuite qu’UNE phrase d’accompagnement, sans aucun chiffre, sans reposer les questions, sans bloc mimmoza-choix.',
  '- Ne calcule rien, ne place rien, n’affirme aucune conformité : le régime (déclaration préalable / permis) est INDICATIF et se vérifie en mairie.',
  '- Une valeur SUPPOSÉE ou estimée n’est jamais une mesure ; une règle PLU estimée n’a pas été lue dans le règlement.',
].join('\n');

// ── Accès aux données (injecté) ─────────────────────────────────────────────────────────────────────────────
export interface ConceptionExtension { id: string; idu: string; commune: string | null; parcelle: unknown; regles_plu: unknown }

export interface DepotExtension {
  conception(userId: string, q: { id?: string | null; idu?: string | null }): Promise<ConceptionExtension | null>;
  /** Conception de la dernière 3D préparée dans la conversation (si aucune parcelle n'est donnée). */
  conceptionDeLaConversation?(userId: string, conversationId: string): Promise<string | null>;
  /** Sorties `data` des appels précédents de l'outil dans la conversation, du plus récent au plus ancien. */
  sortiesPrecedentes(userId: string, conversationId: string): Promise<Obj[]>;
}

export interface EnvExtension {
  userId: string | null;
  conversationId: string | null;
  /** Message REÇU de l'utilisateur (jamais une valeur du modèle). */
  texteUtilisateur: string;
  depot: DepotExtension;
  fetch: typeof fetch;
  maintenant?: () => number;
}

// ── Sources externes (lecture seule) ────────────────────────────────────────────────────────────────────────
async function lireJson(f: typeof fetch, url: string, delaiMs = DELAI_SOURCE_MS): Promise<{ ok: true; data: unknown } | { ok: false; raison: string }> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), delaiMs);
  try {
    const r = await f(url, { headers: { Accept: 'application/json' }, signal: ac.signal });
    if (!r.ok) return { ok: false, raison: `HTTP ${r.status}` };
    return { ok: true, data: await r.json() };
  } catch (e) {
    return { ok: false, raison: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
  } finally { clearTimeout(t); }
}

/** URL BDNB (API ouverte CSTB) des groupes de bâtiments rattachés à la parcelle. */
export function urlBdnbParcelle(idu: string): string {
  const cols = 'batiment_groupe_id,nb_niveau,hauteur_mean,surface_emprise_sol,mat_toit_txt,annee_construction,l_parcelle_id';
  return `https://api.bdnb.io/v1/bdnb/donnees/batiment_groupe_complet?l_parcelle_id=cs.%7B${encodeURIComponent(idu)}%7D&select=${cols}&limit=5`;
}

/** Réponse BDNB → données du contrat X0. Un seul groupe exigé (sinon on ne choisit pas : note). Champs nuls ignorés. */
export function lireBdnb(data: unknown): { bdnb: DonneesBdnb | null; note: string | null } {
  const lignes = Array.isArray(data) ? data : estObj(data) && Array.isArray(data.value) ? data.value : null;
  if (!lignes) return { bdnb: null, note: 'BDNB : réponse illisible, non utilisée.' };
  if (lignes.length === 0) return { bdnb: null, note: 'BDNB : aucun bâtiment rattaché à cette parcelle ; seule la BD TOPO sert à l’estimation.' };
  if (lignes.length > 1) return { bdnb: null, note: `BDNB : ${lignes.length} groupes de bâtiments sur la parcelle ; aucun n’est choisi à l’aveugle (seule la BD TOPO sert).` };
  const b = estObj(lignes[0]) ? lignes[0] : {};
  const n = (v: unknown, min: number, max: number): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined);
  const out: { -readonly [K in keyof DonneesBdnb]: DonneesBdnb[K] } = {};
  if (typeof b.batiment_groupe_id === 'string' && b.batiment_groupe_id.length <= 80) out.batimentGroupeId = b.batiment_groupe_id;
  const niv = n(b.nb_niveau, 1, 60);
  if (niv !== undefined && Number.isInteger(niv)) out.nbNiveaux = niv;
  const h = n(b.hauteur_mean, 0.5, 200);
  if (h !== undefined) out.hauteurMoyenneM = Math.round(h * 100) / 100;
  const em = n(b.surface_emprise_sol, 1, 100_000);
  if (em !== undefined) out.empriseSolM2 = Math.round(em * 10) / 10;
  if (typeof b.mat_toit_txt === 'string' && b.mat_toit_txt.trim() && b.mat_toit_txt.length <= 120) out.materiauToit = b.mat_toit_txt.trim();
  const an = n(b.annee_construction, 1000, 2100);
  if (an !== undefined && Number.isInteger(an)) out.anneeConstruction = an;
  return Object.keys(out).length ? { bdnb: out, note: null } : { bdnb: null, note: 'BDNB : bâtiment trouvé, mais sans niveaux ni hauteur publiés.' };
}

/** URL API Carto (GPU) des zones du PLU au centre de la parcelle. */
export function urlZonage(lon: number, lat: number): string {
  return `https://apicarto.ign.fr/api/gpu/zone-urba?geom=${encodeURIComponent(JSON.stringify({ type: 'Point', coordinates: [lon, lat] }))}`;
}

/** Zonage GPU → zone U d'un PLU ? (U*, sauf AU) ; aucune zone publiée → inconnu (jamais « hors zone U » par défaut). */
export function lireZonage(data: unknown): { valeur: boolean | null; source: string } {
  const feats = estObj(data) && Array.isArray(data.features) ? data.features : null;
  if (!feats) return { valeur: null, source: 'zonage du Géoportail de l’urbanisme illisible' };
  if (!feats.length) return { valeur: null, source: 'aucune zone de PLU publiée au Géoportail de l’urbanisme pour ce point (commune sans PLU, ou PLU non publié)' };
  const p = estObj(feats[0]) && estObj(feats[0].properties) ? feats[0].properties : {};
  const type = typeof p.typezone === 'string' ? p.typezone.trim() : '';
  const lib = typeof p.libelle === 'string' ? p.libelle.trim().slice(0, 30) : '';
  if (!type) return { valeur: null, source: 'zone du PLU sans type publié' };
  const u = /^U/i.test(type) && !/^AU/i.test(type);
  return { valeur: u, source: `zone ${lib || type} du PLU (type ${type}), Géoportail de l’urbanisme` };
}

/** URL API Carto du cadastre pour un identifiant de parcelle (si aucune conception). */
export function urlCadastre(idu: string): string {
  const insee = idu.slice(0, 5), prefixe = idu.slice(5, 8), section = idu.slice(8, 10), numero = idu.slice(10, 14);
  return `https://apicarto.ign.fr/api/cadastre/parcelle?code_insee=${insee}&section=${section}&numero=${numero}${prefixe !== '000' ? `&com_abs=${prefixe}` : ''}`;
}

/** Règles PLU de la conception (même lecture tolérante que le moteur du Dossier 3D). */
export function reglesDeLaConception(brut: unknown): RegleSite[] {
  if (!Array.isArray(brut)) return [];
  return brut.flatMap((e): RegleSite[] => {
    if (!estObj(e) || typeof e.cle !== 'string') return [];
    const statut = e.statut === 'confirme' || e.statut === 'estime' ? e.statut : 'manquant';
    const valeur = typeof e.valeur === 'number' && Number.isFinite(e.valeur) ? e.valeur : null;
    return [{ cle: e.cle, valeur, statut, source: typeof e.source === 'string' ? e.source.slice(0, 200) : 'source non précisée',
      article: typeof e.article === 'string' ? e.article.slice(0, 120) : null, nature: typeof e.nature === 'string' ? e.nature : null }];
  });
}

/** Dernier état du parcours et questions posées, relus dans les sorties précédentes de l'outil. */
export function etatPrecedent(sorties: readonly Obj[]): { etat: ReturnType<typeof lireEtat>; attendues: string[] } {
  for (const d of sorties) {
    if (estObj(d) && estObj(d.etat)) {
      return { etat: lireEtat(d.etat), attendues: Array.isArray(d.attendues) ? d.attendues.filter((x): x is string => typeof x === 'string').slice(0, 6) : [] };
    }
  }
  return { etat: lireEtat(null), attendues: [] };
}

/** Dernier `projet_extension` VALIDE de la conversation (contrat X0), avec l'option de travail. */
export function projetDesSorties(sorties: readonly Obj[]): { projet: ProjetExtension; existant: 'conserver' | 'effacer' } | null {
  for (const d of sorties) {
    if (!estObj(d) || d.projet_extension === undefined || d.projet_extension === null) continue;
    const lu = lireProjetExtension(d.projet_extension);
    if (!lu.ok || lu.projet.nature !== 'extension') return null;
    const opt = estObj(d.option_travail) && (d.option_travail.existant === 'conserver' || d.option_travail.existant === 'effacer') ? d.option_travail.existant : 'conserver';
    return { projet: lu.projet, existant: opt };
  }
  return null;
}

/**
 * Options d'un rendu d'image pour un projet d'extension : `existant` ajouté ; REFUS de `existant: conserver` avec
 * `masque_existant` (la zone à effacer n'a pas de sens si la maison est conservée) — même règle que la base (migration
 * X3) et que le worker (lot X2).
 */
export function optionsAvecExistant(options: Obj, existant: 'conserver' | 'effacer'): { ok: true; valeur: Obj } | { ok: false; erreur: string } {
  if (existant === 'conserver' && options.masque_existant !== undefined && options.masque_existant !== null) {
    return { ok: false, erreur: 'La maison existante est CONSERVÉE (projet d’extension) : une zone à effacer n’a pas de sens. Retirez la zone corrigée.' };
  }
  return { ok: true, valeur: { ...options, existant } };
}

function erreur(message: string, status = 'error'): ResultatOutil {
  return { status, source: SOURCE_EXTENSION, message };
}

/** Résultat d'outil : données pour le front (vue, projet) et consigne courte pour le modèle. */
export function resultatParcours(s: SortieParcours): ResultatOutil {
  return {
    status: 'ok', source: SOURCE_EXTENSION,
    data: {
      etape: s.etape, etat: s.etat, attendues: s.attendues, vue: s.vue,
      texte_affiche: s.texte, bloc_choix: s.blocChoix,
      ...(s.projet ? { projet_extension: s.projet, option_travail: s.optionTravail } : {}),
      ...(s.erreursProjet.length ? { erreurs_projet: s.erreursProjet } : {}),
    },
    message:
      'DÉJÀ AFFICHÉ À L’UTILISATEUR par le serveur : l’estimation, les verdicts et ' + (s.blocChoix ? 'les questions à choix (puces sous ta réponse). ' : 'la synthèse. ') +
      'Écris au plus UNE phrase d’accompagnement, SANS aucun chiffre, sans reposer de question ni écrire de bloc mimmoza-choix. ' +
      (s.etape === 'termine'
        ? 'Rendu photoréaliste d’une extension : pas encore disponible (la machine de rendu ne dessine pas encore la maison conservée) — ne propose pas de rendu.'
        : ''),
  };
}

// ── Exécution ───────────────────────────────────────────────────────────────────────────────────────────────
export async function executerOutilExtension(input: Obj, env: EnvExtension): Promise<ResultatOutil> {
  if (!env.userId) return erreur("Session requise : l'utilisateur n'est pas authentifié.");
  if (!env.conversationId) return erreur('Ouvrez d’abord une conversation : le parcours d’extension y est rattaché.');
  let sorties: Obj[] = [];
  try { sorties = await env.depot.sortiesPrecedentes(env.userId, env.conversationId); } catch { sorties = []; }
  const prec = etatPrecedent(sorties);

  // Parcelle : conception donnée, sinon identifiant donné, sinon celle du parcours en cours, sinon la 3D de la conversation.
  const iduDonne = typeof input.idu === 'string' ? input.idu.replace(/\s/g, '').toUpperCase() : null;
  const idu = iduDonne && RE_IDU.test(iduDonne) ? iduDonne : prec.etat.idu;
  let c: ConceptionExtension | null = null;
  try {
    if (typeof input.conception_id === 'string' && RE_UUID.test(input.conception_id)) c = await env.depot.conception(env.userId, { id: input.conception_id });
    if (!c && idu) c = await env.depot.conception(env.userId, { idu });
    if (!c && !idu && env.depot.conceptionDeLaConversation) {
      const id = await env.depot.conceptionDeLaConversation(env.userId, env.conversationId);
      if (id) c = await env.depot.conception(env.userId, { id });
    }
  } catch { c = null; }
  const iduRetenu = c?.idu ?? idu;
  if (!iduRetenu) {
    return erreur('Parcelle inconnue : demande à l’utilisateur l’adresse ou la référence cadastrale de sa maison (une seule question, en texte). Ne propose aucune estimation.', 'partial');
  }

  // Contour cadastral.
  let geometrie: unknown = estObj(c?.parcelle) ? (c!.parcelle as Obj).geometrie : null;
  let surface: number | null = estObj(c?.parcelle) && typeof (c!.parcelle as Obj).surface_m2 === 'number' ? (c!.parcelle as Obj).surface_m2 as number : null;
  if (!geometrie) {
    const r = await lireJson(env.fetch, urlCadastre(iduRetenu));
    const f = 'data' in r && estObj(r.data) && Array.isArray(r.data.features) ? r.data.features[0] : null;
    if (estObj(f)) {
      geometrie = f.geometry;
      if (estObj(f.properties) && typeof f.properties.contenance === 'number') surface = f.properties.contenance;
    }
  }
  const anneau = anneauParcelle(geometrie);

  // Sources en parallèle (lecture seule, jamais bloquantes).
  let batiments: BatimentBdTopo[] | null = null;
  let raisonBdTopo: string | null = null;
  let bdnb: DonneesBdnb | null = null;
  let noteBdnb: string | null = null;
  let zoneU: ContexteParcours['zoneU'] = { valeur: null, source: 'zonage non lu' };
  if (anneau) {
    const l93 = contourEnLambert93(anneau);
    const [lonC, latC] = lambert93VersWgs84(l93.reduce((a, p) => a + p[0], 0) / l93.length, l93.reduce((a, p) => a + p[1], 0) / l93.length);
    const [bd, bn, zo] = await Promise.all([
      telechargerBatimentsParcelle(l93, env.fetch),
      lireJson(env.fetch, urlBdnbParcelle(iduRetenu)),
      lireJson(env.fetch, urlZonage(lonC, latC)),
    ]);
    if ('batiments' in bd) batiments = bd.batiments; else raisonBdTopo = bd.raison;
    if ('data' in bn) { const l = lireBdnb(bn.data); bdnb = l.bdnb; noteBdnb = l.note; } else noteBdnb = `BDNB injoignable (${bn.raison}) : seule la BD TOPO sert à l’estimation.`;
    zoneU = 'data' in zo ? lireZonage(zo.data) : { valeur: null, source: `Géoportail de l’urbanisme injoignable (${zo.raison})` };
  }
  const facades = c ? facadesVoieDeLaParcelle(c.parcelle) : { facades: [], raison: 'aucune fiche de parcelle avec ses voisines : côté rue non identifié' };
  const ctx: ContexteParcours = {
    idu: iduRetenu, commune: c?.commune ?? null, contourWgs84: anneau, surfaceParcelleM2: surface,
    batiments, raisonBdTopo, dateBdTopo: new Date((env.maintenant ?? Date.now)()).toISOString().slice(0, 10),
    bdnb, noteBdnb, zoneU, regles: reglesDeLaConception(c?.regles_plu),
    facadesVoie: facades.facades.map((f) => ({ debut: f.debut, fin: f.fin })), raisonFacades: facades.raison,
  };
  const s = avancerParcours(prec.etat, env.texteUtilisateur ?? '', prec.attendues, ctx);
  return resultatParcours(s);
}

// ── Supabase ────────────────────────────────────────────────────────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
type ClientSb = any;

/** Lectures bornées à l'utilisateur ET à la conversation ; l'état relu est revalidé (lireEtat, lireProjetExtension). */
export function depotExtensionSupabase(admin: ClientSb, utilisateur: ClientSb | null): DepotExtension {
  const db = utilisateur ?? admin;
  return {
    async conception(userId, q) {
      let r = db.from('agent_conceptions').select('id,idu,commune,parcelle,regles_plu,maj_le').eq('user_id', userId).neq('statut', 'archive');
      if (q.id) r = r.eq('id', q.id);
      else if (q.idu) r = r.eq('idu', q.idu);
      else return null;
      const { data, error } = await r.order('maj_le', { ascending: false }).limit(1);
      if (error) throw new Error(error.message);
      return (data?.[0] ?? null) as ConceptionExtension | null;
    },
    async conceptionDeLaConversation(userId, conversationId) {
      const { data, error } = await db.from('studio_preparations').select('conception_id').eq('user_id', userId).eq('conversation_id', conversationId)
        .order('cree_le', { ascending: false }).limit(1);
      if (error) return null;
      const id = data?.[0]?.conception_id;
      return typeof id === 'string' ? id : null;
    },
    async sortiesPrecedentes(userId, conversationId) {
      const { data, error } = await admin.from('copilot_tool_calls').select('tool_output')
        .eq('user_id', userId).eq('conversation_id', conversationId).eq('tool_name', OUTIL_EXTENSION_MAISON)
        .order('created_at', { ascending: false }).limit(ETATS_RELUS_MAX);
      if (error || !Array.isArray(data)) return [];
      return data.flatMap((l: { tool_output?: { status?: unknown; data?: unknown } }) =>
        l.tool_output?.status === 'ok' && estObj(l.tool_output.data) ? [l.tool_output.data as Obj] : []);
    },
  };
}
