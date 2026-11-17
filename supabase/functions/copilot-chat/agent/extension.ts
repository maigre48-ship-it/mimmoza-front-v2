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
// LOT X3b : secteur protégé (Architecte des Bâtiments de France) — servitudes du Géoportail de l'urbanisme (AC1, AC2, AC4)
// et base Mérimée (monument à moins de 500 m), via les services internes injectés (`patrimoine`) ; calcul pur dans
// _shared/extension/secteurProtege.ts ; un service muet ou en panne → « non vérifié », jamais « hors secteur protégé ».
// =============================================================

import { lireProjetExtension, type DonneesBdnb, type ProjetExtension } from '../../_shared/extension/contrat.ts';
import {
  anneauParcelle, BATIMENTS_MEMORISES_MAX, batimentsSurParcelle, contourEnLambert93, lireLectureMemorisee, telechargerBatimentsParcelle,
  type BatimentBdTopo, type LectureBdTopoMemorisee,
} from '../../_shared/extension/bdtopoParcelle.ts';
import { lambert93VersWgs84 } from '../../_shared/extension/lambert93.ts';
import {
  avancerParcours, detecterIntentionExtension, lireEtat, OUTIL_EXTENSION_MAISON, Q, reponseAuParcours, suiteDuParcours,
  type ContexteParcours, type RegleSite, type SortieParcours,
} from '../../_shared/extension/parcours.ts';
import { evaluerSecteurProtege, lireSecteurEnregistre, type ReponseService, type SecteurProtege } from '../../_shared/extension/secteurProtege.ts';
import { chercherVoisinesParcelle, facadesVoieDeLaParcelle, type FacadeVoieFiche } from './voisines-parcelle.ts';
import type { OutilDef, ResultatOutil } from './types.ts';

export { detecterIntentionExtension, OUTIL_EXTENSION_MAISON, reponseAuParcours, suiteDuParcours };

export const SOURCE_EXTENSION = 'MimmozIA · Extension de maison';
export const DELAI_SOURCE_MS = 10_000;
/** Sorties d'outil relues pour retrouver l'état du parcours (les plus récentes d'abord). */
export const ETATS_RELUS_MAX = 10;
/**
 * Rendu (image, film, visite) d'un projet d'extension : OUVERT depuis le lot X4 (la machine de rendu dessine la maison
 * conservée, modélisée, et l'extension calculée par son moteur ; rien n'est effacé). Le devis porte
 * `fiche.projet_extension` pour TOUT type de rendu et, pour l'image, l'option `existant`. Repasser à `false` referme le
 * rendu d'extension (message MESSAGE_RENDU_EXTENSION_FERME), sans autre changement.
 */
export const RENDU_EXTENSION_OUVERT = true;
/** Réponse de l'outil de rendu tant que le rendu d'extension est fermé. */
export const MESSAGE_RENDU_EXTENSION_FERME =
  'RIEN N’A ÉTÉ LANCÉ. Cette conversation porte un projet d’EXTENSION (maison existante conservée) : la machine de rendu ' +
  'ne sait pas encore dessiner la maison conservée avec son extension (prochaine étape). Une image aujourd’hui montrerait un ' +
  'bâtiment neuf à la place : ne la propose pas. Dis-le simplement à l’utilisateur ; le projet (maison, extension, régime ' +
  'indicatif) reste enregistré dans la conversation.';

/**
 * LOT X4 site — décision d'Albé : la forme du toit de la maison conservée doit être CONFIRMÉE par l'utilisateur dans le
 * parcours avant tout rendu d'extension (la machine de rendu s'en sert pour dessiner la maison et calculer ce qu'elle
 * cache de l'extension). Vrai si chaque maison conservée du projet a `formeToit` au statut « confirmée ». Pur.
 */
export function toitConfirme(projet: ProjetExtension): boolean {
  const conservees = projet.existants.filter((e) => e.mode === 'conserver');
  return conservees.length > 0 && conservees.every((e) => e.formeToit?.statut === 'confirmee');
}

/** Réponse de l'outil de rendu quand le toit de la maison conservée n'a pas été confirmé dans le parcours. */
export const MESSAGE_TOIT_A_CONFIRMER =
  'RIEN N’A ÉTÉ LANCÉ. La forme du toit de la maison existante n’a pas été CONFIRMÉE dans le parcours d’extension : ' +
  'la machine de rendu en a besoin pour dessiner la maison conservée et ce qu’elle cache de l’extension. Dis à l’utilisateur ' +
  'en une phrase qu’il doit d’abord confirmer le toit de sa maison dans le parcours d’extension (il peut écrire « agrandir ma ' +
  'maison » pour le reprendre) ; ne propose aucune forme de toit toi-même.';

/** Réponse de l'outil de rendu quand le rendu d'extension est demandé depuis une version de conception. */
export const MESSAGE_EXTENSION_VERSION =
  'RIEN N’A ÉTÉ LANCÉ. Le rendu d’une extension se lance depuis la 3D préparée par Mimmo : une version enregistrée dans ' +
  'l’Atelier 3D ne contient pas la maison conservée. Rappelle l’outil SANS la source « version » (la 3D préparée est prise).';

/** Lignes du devis d'un rendu d'extension (ce que la machine de rendu dessine, et ce qui reste estimé). Pur. */
export function avertissementsRenduExtension(projet: ProjetExtension, type: 'image' | 'film' | 'visite360'): string[] {
  const e0 = projet.existants.find((e) => e.id === projet.extension?.existantId) ?? projet.existants[0];
  const enPente = e0?.formeToit !== undefined && e0.formeToit.valeur !== 'plat';
  const penteEstimee = enPente && (e0?.penteToitDeg?.statut !== 'confirmee' || e0?.orientationFaitage?.statut !== 'confirmee');
  return [
    'Projet d’EXTENSION : la maison existante est CONSERVÉE (rien n’est effacé) ; la machine de rendu dessine l’extension placée par Mimmoza à partir des réponses du parcours. Si l’extension ne peut pas être placée, rien n’est rendu et la raison est dite.',
    `Maison conservée modélisée depuis la base des bâtiments de l’IGN (BD TOPO) : forme du toit confirmée par vous${penteEstimee ? ' ; pente du toit et orientation du faîtage ESTIMÉES' : ''} ; la maison réelle peut différer de ce modèle.`,
    'Le relief n’est pas transmis par Mimmo : la machine de rendu calcule sur un terrain supposé plat. Aucun habillage de bâtiment neuf (façade, balcons, toiture) ne s’applique à une extension.',
    // LOT X9 — photo réelle obligatoire : sans placement vérifié dans une vraie photo, aucune image (photo demandée).
    ...(type === 'image' ? ['Image dans une vraie photo de votre maison (photo de la rue, ou la vôtre) : là où la maison réelle est devant l’extension, la photo repasse devant. Si l’extension ne peut pas être placée avec précision dans la photo, ou si elle est presque entièrement cachée, aucune image n’est montrée : la raison est dite et une autre photo vous est demandée.'] : []),
  ];
}

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
    "préalable / permis, architecte). L'application lit elle-même les réponses de l'utilisateur et affiche le texte et les " +
    "questions : n'écris aucun chiffre, ne pose aucune question à sa place ; écris seulement la phrase de relance rendue. " +
    "À appeler à chaque message du parcours.",
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
  '# EXTENSION DE MAISON — PARCOURS GUIDÉ',
  `Appelle \`${OUTIL_EXTENSION_MAISON}\` (sans inventer de paramètre ; \`idu\` seulement si l’utilisateur a donné la parcelle).`,
  '- L’estimation, les verdicts et les questions à choix sont DÉJÀ affichés à l’utilisateur par l’application : écris ensuite EXACTEMENT la phrase de relance donnée par le résultat de l’outil, et rien d’autre (aucun chiffre, aucune question reposée, aucun bloc mimmoza-choix).',
  '- Ne parle jamais du « serveur », de « la fiche », du « moteur », d’un outil, d’un lot ou d’un nom technique : l’utilisateur ne connaît que Mimmo.',
  '- N’annonce un résultat (gabarit, régime, image, dossier) que s’il figure dans la sortie de l’outil de CE tour ; ne demande rien que l’outil n’a pas demandé à cette étape.',
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
  /**
   * LOT X3b — services internes de Mimmoza (servitudes du Géoportail de l'urbanisme, base Mérimée), appelés par le
   * serveur ; null ou absent = service non branché (secteur « non vérifié », jamais « hors secteur protégé »).
   */
  patrimoine?: ServicesPatrimoine | null;
}

/** Appels des services internes (corps JSON → réponse JSON ; LÈVE en cas d'échec). */
export interface ServicesPatrimoine {
  servitudes: ((corps: Obj) => Promise<unknown>) | null;
  merimee: ((corps: Obj) => Promise<unknown>) | null;
}

/** Délai maximal d'un service patrimoine (le parcours ne l'attend jamais plus longtemps). */
export const DELAI_PATRIMOINE_MS = 15_000;

async function appelBorne(f: ((corps: Obj) => Promise<unknown>) | null | undefined, corps: Obj): Promise<ReponseService> {
  if (!f) return null;
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    const data = await Promise.race([
      f(corps),
      new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error('délai dépassé')), DELAI_PATRIMOINE_MS); }),
    ]);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, raison: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
  } finally { if (t) clearTimeout(t); }
}

/**
 * LOT X3b — secteur protégé de la parcelle : servitudes (AC1, AC2, AC4) et monuments à moins de 500 m, interrogés en
 * parallèle au centre de la parcelle. Lecture seule, jamais bloquant.
 */
export async function consulterSecteurProtege(idu: string, lon: number, lat: number, services: ServicesPatrimoine | null | undefined, date: string): Promise<SecteurProtege> {
  const [gpu, mh] = await Promise.all([
    appelBorne(services?.servitudes, { lat, lon, cadastral_ref: idu }),
    appelBorne(services?.merimee, { lat, lon }),
  ]);
  return evaluerSecteurProtege(idu, date, gpu, mh);
}

/** Dernier secteur évalué pour cette parcelle dans la conversation (réutilisé sauf s'il était « non vérifié »). */
export function secteurDesSorties(sorties: readonly Obj[], idu: string): SecteurProtege | null {
  for (const d of sorties) {
    const vue = estObj(d) && estObj(d.vue) ? d.vue : null;
    if (!vue || vue.idu !== idu) continue;
    const s = lireSecteurEnregistre(vue.secteur);
    return s && s.idu === idu && s.etat !== 'non_verifie' ? s : null;
  }
  return null;
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
export function projetDesSorties(sorties: readonly Obj[]): { projet: ProjetExtension; existant: 'conserver' | 'effacer'; placee: boolean } | null {
  for (const d of sorties) {
    // LOT X4 site : la maison a été déclarée « à démolir » APRÈS le dernier projet (parcours arrêté, projet neuf) :
    // l'ancien projet d'extension ne vaut plus (le rendu étant ouvert, il dessinerait une extension non voulue).
    if (estObj(d) && (d.projet_extension === undefined || d.projet_extension === null) && estObj(d.etat) && d.etat.conserver === false) return null;
    if (!estObj(d) || d.projet_extension === undefined || d.projet_extension === null) continue;
    const lu = lireProjetExtension(d.projet_extension);
    if (!lu.ok || lu.projet.nature !== 'extension') return null;
    const opt = estObj(d.option_travail) && (d.option_travail.existant === 'conserver' || d.option_travail.existant === 'effacer') ? d.option_travail.existant : 'conserver';
    // LOT X10 — l'extension de ce projet a-t-elle été PLACÉE (verdict du moteur affiché) ? Un refus affiché la rend
    // impossible à rendre (aucune 3D, aucun rendu) ; une sortie sans verdict (antérieure au lot) est lue comme placée.
    const verdict = estObj(d.vue) && estObj(d.vue.extension) ? d.vue.extension.verdict : undefined;
    return { projet: lu.projet, existant: opt, placee: verdict !== 'refus' };
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

/**
 * LOT X8 — phrase de relance EXACTE écrite par le modèle après l'affichage du parcours (une par étape). Sans chiffre,
 * sans nom interne, sans annoncer un résultat absent. Le modèle ne l'improvise plus (essai du 17/11 : « le serveur a
 * affiché le gabarit » alors que rien n'avait été calculé).
 */
export function phraseDeRelance(s: Pick<SortieParcours, 'etape' | 'projet' | 'resultatMoteur'> & { readonly attendues?: readonly string[] }): string {
  switch (s.etape) {
    case 'sans_parcelle': return 'Donnez-moi l’adresse ou la référence cadastrale de la maison, et je reprends.';
    case 'sans_bdtopo': return 'Vos réponses sont gardées : cliquez « Réessayer » dans un instant pour reprendre au même point.';
    case 'aucun_batiment': return 'Vérifiez la référence de la parcelle : si elle est juste, la maison n’est pas encore dans la base de l’IGN.';
    case 'conserver': return 'Dites-moi, avec le choix ci-dessous, si vous conservez la maison.';
    case 'neuf': return 'Dites-moi si vous voulez préparer le projet neuf.';
    case 'confirmer': return 'Confirmez ou corrigez ces valeurs avec les choix ci-dessous.';
    case 'type': return 'Choisissez le type d’agrandissement et son côté avec les choix ci-dessous.';
    case 'dimensions': return 'Répondez avec les choix ci-dessous, ou écrivez directement vos valeurs.';
    case 'surface': return 'Répondez aux dernières questions ci-dessous.';
    case 'termine':
      if (!RENDU_EXTENSION_OUVERT) return 'Le projet d’extension est enregistré dans cette conversation.';
      // LOT X8b — extension plus haute que la maison : les choix de hauteur sont proposés en puces.
      if (s.attendues?.includes(Q.hauteur.id)) return 'Choisissez la hauteur de l’extension ci-dessous, et je la replace.';
      if (s.attendues?.includes(Q.facade.id)) return 'Choisissez un autre côté ci-dessous, et je replace l’extension.';
      if (s.projet && s.resultatMoteur?.ok) return 'Si vous le souhaitez, je peux maintenant préparer une image de l’extension dans la photo de la rue.';
      // LOT X10 — la VRAIE cause et la VRAIE action (essai du 17/11 : « modifiez les dimensions » alors que le blocage
      // était le côté rue).
      if (s.resultatMoteur && !s.resultatMoteur.ok && s.resultatMoteur.refus.some((r) => /^Côté rue inconnu/.test(r))) {
        return 'Je ne sais pas encore de quel côté de la parcelle se trouve la rue : sans elle, je ne peux pas placer l’extension.';
      }
      if (s.resultatMoteur?.suggestion) return 'L’extension ne se place pas ainsi : réduisez sa profondeur comme indiqué ci-dessus, ou choisissez un autre côté, et je la replace.';
      return 'L’extension ne se place pas ainsi, pour les raisons ci-dessus : changez ses dimensions ou son côté, et je la replace.';
  }
}

/** Résultat d'outil : données pour le front (vue, projet) et consigne courte pour le modèle. */
export function resultatParcours(s: SortieParcours, lectureBdTopo: LectureBdTopoMemorisee | null = null): ResultatOutil {
  const relance = phraseDeRelance(s);
  return {
    status: 'ok', source: SOURCE_EXTENSION,
    data: {
      etape: s.etape, etat: s.etat, attendues: s.attendues, vue: s.vue,
      texte_affiche: s.texte, bloc_choix: s.blocChoix, phrase_relance: relance,
      ...(s.projet ? { projet_extension: s.projet, option_travail: s.optionTravail } : {}),
      ...(s.erreursProjet.length ? { erreurs_projet: s.erreursProjet } : {}),
      // LOT X8 — lecture BD TOPO de la parcelle, réutilisée si la BD TOPO ne répond pas à un tour suivant.
      ...(lectureBdTopo ? { bdtopo_lue: lectureBdTopo } : {}),
    },
    message:
      'DÉJÀ AFFICHÉ À L’UTILISATEUR : ' + (s.etape === 'sans_bdtopo' || s.etape === 'sans_parcelle' || s.etape === 'aucun_batiment'
        ? 'pourquoi le parcours ne peut pas avancer à ce tour. '
        : 'l’estimation, les verdicts' + (s.blocChoix ? ' et les questions à choix (puces sous ta réponse). ' : ' et la synthèse. ')) +
      `Écris EXACTEMENT cette phrase, et rien d’autre : « ${relance} » ` +
      'N’ajoute aucun chiffre, aucune question, aucun bloc mimmoza-choix ; ne parle ni de « serveur », ni de « fiche », ni de « moteur » ; ' +
      'n’annonce aucun résultat (gabarit, régime, image) qui ne figure pas dans cette sortie.' +
      (s.etape === 'termine' && RENDU_EXTENSION_OUVERT && s.projet && s.resultatMoteur?.ok
        ? ' Si l’utilisateur accepte l’image (à un message SUIVANT) : appelle studio_lancer_rendu avec type « image », SANS brief (s’il répond « aucune 3D préparée », appelle d’abord studio_preparer_3d sans argument, puis studio_lancer_rendu) ; ' +
          'l’image part de CETTE extension (maison existante conservée + extension placée), jamais d’un immeuble ni de logements. Ne promets ni délai ni image « insérée dans la rue » : la machine de rendu le vérifie elle-même.'
        : '') +
      // LOT X10 — extension NON placée : aucun lancement ne doit être annoncé (essai du 17/11 : « Parfait ! Je lance la
      // préparation de la maquette 3D… » alors que le placement était refusé).
      (s.etape === 'termine' && !s.resultatMoteur?.ok
        ? ' L’extension N’EST PAS PLACÉE : n’appelle aucun outil de 3D ni de rendu (studio_preparer_3d, studio_lancer_rendu), et n’annonce aucune préparation, maquette, image ni lancement.'
        : ''),
  };
}

// ── LOT X10 : limite sur rue lue au cadastre (parcelles voisines) quand la fiche de la parcelle ne l'a pas ─────────
/** Façades sur voie lues au cadastre à un tour précédent (même parcelle), réutilisées sans nouvel appel. */
export interface FacadesVoieLues { readonly idu: string; readonly date: string; readonly facades: readonly FacadeVoieFiche[] }

/** Attente avant la seconde demande des parcelles voisines (même tolérance que la BD TOPO, lot X8). */
export const ATTENTE_VOISINES_MS = 800;

/**
 * Parcelles voisines au cadastre (API Carto IGN) puis côté voie déduit (même calcul que la fiche de parcelle, lot C7b).
 * Une seconde demande si le cadastre n'a pas répondu ou a refusé. Ne lève jamais.
 */
export async function facadesParVoisines(idu: string, geometrie: unknown, f: typeof fetch, attenteMs = ATTENTE_VOISINES_MS): Promise<{ facades: FacadeVoieFiche[]; raison: string | null }> {
  let v = await chercherVoisinesParcelle(idu, geometrie, f);
  if (v.statut !== 'disponibles' && /n’a pas répondu|a refusé/.test(v.raison ?? '')) {
    await new Promise((r) => setTimeout(r, attenteMs));
    v = await chercherVoisinesParcelle(idu, geometrie, f);
  }
  return facadesVoieDeLaParcelle({ geometrie, voisines: v });
}

/** Relit une limite sur rue mémorisée (sortie d'un tour précédent) ; tout objet mal formé est écarté. */
export function lireFacadesLues(v: unknown): FacadesVoieLues | null {
  if (!estObj(v) || typeof v.idu !== 'string' || !RE_IDU.test(v.idu) || typeof v.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.date)) return null;
  if (!Array.isArray(v.facades) || !v.facades.length || v.facades.length > 50) return null;
  const point = (p: unknown): p is [number, number] => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0] as number) <= 180 && Math.abs(p[1] as number) <= 90;
  const out: FacadeVoieFiche[] = [];
  for (const x of v.facades) {
    if (!estObj(x) || !point(x.debut) || !point(x.fin) || typeof x.longueurM !== 'number' || !Number.isFinite(x.longueurM) || x.source !== 'cadastre-voisines') return null;
    out.push({ debut: [x.debut[0], x.debut[1]], fin: [x.fin[0], x.fin[1]], longueurM: x.longueurM, source: 'cadastre-voisines' });
  }
  return { idu: v.idu, date: v.date, facades: out };
}

/** LOT X10 — dernière limite sur rue mémorisée pour CETTE parcelle dans la conversation (la plus récente). */
export function facadesLuesDesSorties(sorties: readonly Obj[], idu: string): FacadesVoieLues | null {
  for (const d of sorties) {
    if (!estObj(d) || d.facades_voie_lues === undefined) continue;
    const l = lireFacadesLues(d.facades_voie_lues);
    if (l && l.idu === idu) return l;
  }
  return null;
}

/** LOT X8 — dernière lecture BD TOPO mémorisée pour CETTE parcelle dans la conversation (la plus récente). */
export function lectureBdTopoDesSorties(sorties: readonly Obj[], idu: string): LectureBdTopoMemorisee | null {
  for (const d of sorties) {
    if (!estObj(d) || d.bdtopo_lue === undefined) continue;
    const l = lireLectureMemorisee(d.bdtopo_lue);
    if (l && l.idu === idu) return l;
  }
  return null;
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
  let lecture: LectureBdTopoMemorisee | null = null;
  let bdtopoReutilisee: string | null = null;
  let bdnb: DonneesBdnb | null = null;
  let noteBdnb: string | null = null;
  let zoneU: ContexteParcours['zoneU'] = { valeur: null, source: 'zonage non lu' };
  const dateJour = new Date((env.maintenant ?? Date.now)()).toISOString().slice(0, 10);
  let dateBdTopo = dateJour;
  let secteur: SecteurProtege | null = null;
  if (anneau) {
    const l93 = contourEnLambert93(anneau);
    const [lonC, latC] = lambert93VersWgs84(l93.reduce((a, p) => a + p[0], 0) / l93.length, l93.reduce((a, p) => a + p[1], 0) / l93.length);
    const secteurConnu = secteurDesSorties(sorties, iduRetenu);
    const [bd, bn, zo, sp] = await Promise.all([
      telechargerBatimentsParcelle(l93, env.fetch),
      lireJson(env.fetch, urlBdnbParcelle(iduRetenu)),
      lireJson(env.fetch, urlZonage(lonC, latC)),
      secteurConnu ? Promise.resolve(secteurConnu) : consulterSecteurProtege(iduRetenu, lonC, latC, env.patrimoine, dateJour),
    ]);
    secteur = sp;
    if (bd.ok) {
      batiments = bd.batiments;
      // LOT X8 — mémorise les bâtiments de la parcelle (lus à ce tour) pour un tour où la BD TOPO ne répondrait pas.
      const surParcelle = batimentsSurParcelle(bd.batiments, l93);
      if (surParcelle.length && surParcelle.length <= BATIMENTS_MEMORISES_MAX) lecture = { idu: iduRetenu, date: dateJour, batiments: surParcelle };
    } else {
      raisonBdTopo = bd.raison;
      // LOT X8 — erreur passagère après deux tentatives : la lecture d'un tour précédent (même parcelle) est réutilisée,
      // datée et signalée ; sans lecture précédente, le parcours s'arrête sans rien estimer (réponses gardées).
      lecture = lectureBdTopoDesSorties(sorties, iduRetenu);
      if (lecture) { batiments = [...lecture.batiments]; dateBdTopo = lecture.date; bdtopoReutilisee = bd.raison; }
    }
    if ('data' in bn) { const l = lireBdnb(bn.data); bdnb = l.bdnb; noteBdnb = l.note; } else noteBdnb = `BDNB injoignable (${bn.raison}) : seule la BD TOPO sert à l’estimation.`;
    zoneU = 'data' in zo ? lireZonage(zo.data) : { valeur: null, source: `Géoportail de l’urbanisme injoignable (${zo.raison})` };
  }
  // Limite sur rue : fiche de la parcelle (voisines enregistrées) ; LOT X10 — sinon lue ici au cadastre (parcelles
  // voisines, API Carto IGN, 2 tentatives), mémorisée d'un tour à l'autre ; sinon le parcours demande le côté de la rue.
  let facades: { facades: FacadeVoieFiche[]; raison: string | null } = c ? facadesVoieDeLaParcelle(c.parcelle) : { facades: [], raison: null };
  let sourceFacades: string | null = facades.facades.length ? 'Limite sur rue : déduite du cadastre et des parcelles voisines (fiche de la parcelle)' : null;
  let facadesLues: FacadesVoieLues | null = null;
  if (!facades.facades.length && anneau) {
    const memo = facadesLuesDesSorties(sorties, iduRetenu);
    if (memo) {
      facadesLues = memo;
      facades = { facades: [...memo.facades], raison: null };
    } else {
      const lu = await facadesParVoisines(iduRetenu, geometrie, env.fetch);
      if (lu.facades.length) { facadesLues = { idu: iduRetenu, date: dateJour, facades: lu.facades }; facades = lu; }
      else facades = { facades: [], raison: lu.raison ?? facades.raison };
    }
    if (facadesLues) sourceFacades = `Limite sur rue : déduite du cadastre et des parcelles voisines (API Carto IGN, lue le ${facadesLues.date})`;
  }
  const ctx: ContexteParcours = {
    idu: iduRetenu, commune: c?.commune ?? null, contourWgs84: anneau, surfaceParcelleM2: surface,
    batiments, raisonBdTopo, dateBdTopo, secteur, bdtopoReutilisee,
    bdnb, noteBdnb, zoneU, regles: reglesDeLaConception(c?.regles_plu),
    facadesVoie: facades.facades.map((f) => ({ debut: f.debut, fin: f.fin })), raisonFacades: facades.raison, sourceFacades,
  };
  const s = avancerParcours(prec.etat, env.texteUtilisateur ?? '', prec.attendues, ctx);
  const r = resultatParcours(s, lecture);
  return facadesLues && r.data ? { ...r, data: { ...(r.data as Obj), facades_voie_lues: facadesLues } } : r;
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
