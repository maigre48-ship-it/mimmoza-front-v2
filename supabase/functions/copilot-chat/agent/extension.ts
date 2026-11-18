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
// INTÉGRATION 18/11 — côté de la rue désigné par l'utilisateur, transmis à la machine de rendu.
import { candidatChoisi, candidatsCoteRue } from '../../_shared/extension/coteRue.ts';
import {
  avancerParcours, detecterIntentionExtension, lireEtat, OUTIL_EXTENSION_MAISON, Q, reponseAuParcours, suiteDuParcours,
  type ContexteParcours, type RegleSite, type SortieParcours,
} from '../../_shared/extension/parcours.ts';
import { evaluerSecteurProtege, lireSecteurEnregistre, type ReponseService, type SecteurProtege } from '../../_shared/extension/secteurProtege.ts';
import { chercherVoisinesParcelle, facadesVoieDeLaParcelle, type FacadeVoieFiche } from './voisines-parcelle.ts';
import type { OutilDef, ResultatOutil } from './types.ts';
// LOT G3 — photo de la maison jointe au message (avec les instructions) : parcelle par sa position, fond de l'image.
import {
  lignesPhotoProjet, parcelleDepuisPhoto, photoProjetDesSorties, pointDansContour, recevoirPhoto,
  type DepotPhotoProjet, type ParcelleDeLaPhoto, type PhotoDuTour, type PhotoProjet,
} from './photo-projet.ts';
// LOT G3 — dossier de parcelle minimal (contour + parcelles voisines du cadastre) pour qu'une extension placée ait son image.
import { chercherContourParcelle } from './conception.ts';
// LOT G6 — plan de la maison lu dans le Studio (contexte de la page), gardé dans l'état du parcours.
import { CONSIGNE_PLAN_JOINT, existantLuPourFiche, lirePlanLu, planJointAuMessage, type PlanLuParcours } from '../../_shared/extension/planLu.ts';
// LOT G7 — variantes : retouches écrites librement après un premier projet, historique V1, V2… rattaché au projet.
import { demandeRetouche } from '../../_shared/extension/retouchesExtension.ts';
import { avecVariante, empreinteProjet, variantesDesSorties } from '../../_shared/extension/variantesExtension.ts';

export { demandeRetouche, detecterIntentionExtension, OUTIL_EXTENSION_MAISON, reponseAuParcours, suiteDuParcours };

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

/**
 * Fiche du travail complétée du projet d'extension (contrat X0), au même niveau que `habillage_batiments`. LOT G6 :
 * avec le plan de la maison lu (`existant_lu`, valeurs et statuts), repris au cartouche des plans de l'extension.
 */
export function ficheAvecProjetExtension<T extends Record<string, unknown>>(fiche: T, projet: ProjetExtension, existantLu?: Record<string, unknown> | null): T & { projet_extension: ProjetExtension } {
  return { ...fiche, projet_extension: JSON.parse(JSON.stringify(projet)) as ProjetExtension, ...(existantLu ? { existant_lu: JSON.parse(JSON.stringify(existantLu)) as Record<string, unknown> } : {}) };
}

/** LOT G6 — emprise BD TOPO relue dans la ligne « Emprise au sol » de la vue (« 104 m² »). Pur. */
export function empriseBdTopoDeLaVue(lignes: readonly unknown[]): number | null {
  const l = lignes.find((x) => typeof x === 'object' && x !== null && (x as Record<string, unknown>).libelle === 'Emprise au sol') as Record<string, unknown> | undefined;
  const m = typeof l?.valeur === 'string' ? /(\d[\d\s  ]*(?:[.,]\d+)?)\s*m²/.exec(l.valeur) : null;
  const v = m ? Number(m[1]!.replace(/[\s  ]/g, '').replace(',', '.')) : NaN;
  return Number.isFinite(v) && v > 0 ? v : null;
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
  /**
   * LOT G3 — crée le dossier MINIMAL de la parcelle (contour et parcelles voisines lus au cadastre ; aucune règle,
   * aucun programme) quand une extension est placée sur une parcelle qui n'en a pas. Renvoie son identifiant, ou null.
   */
  creerDossierParcelle?(userId: string, d: { idu: string; commune: string | null; parcelle: Obj }): Promise<string | null>;
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
  /** LOT G3 — photo jointe au message de CE tour (pièce jointe du chat, posée par le serveur) ; absente sinon. */
  photoDuTour?: PhotoDuTour | null;
  /** LOT G3 — dépôt de la photo d'origine dans l'espace privé de l'utilisateur (seau `studio-transfert`). */
  depotPhoto?: DepotPhotoProjet | null;
  /** LOT G6 — plan de la maison lu dans le Studio (ou cotes saisies), transmis par le site à ce tour ; absent sinon. */
  planLu?: PlanLuParcours | null;
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
export function projetDesSorties(sorties: readonly Obj[]): { projet: ProjetExtension; existant: 'conserver' | 'effacer'; placee: boolean; existantLu?: Record<string, unknown> | null } | null {
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
    // LOT G6 — plan de la maison lu (état du parcours) : repris par les plans de l'extension (`fiche.existant_lu`).
    const planLu = estObj(d.etat) ? lirePlanLu(d.etat.planLu) : null;
    const emprise = lu.projet.existants[0] && estObj(d.vue) && estObj(d.vue.maison) && Array.isArray(d.vue.maison.lignes)
      ? empriseBdTopoDeLaVue(d.vue.maison.lignes) : null;
    return { projet: lu.projet, existant: opt, placee: verdict !== 'refus', ...(planLu ? { existantLu: existantLuPourFiche(planLu, emprise) } : {}) };
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
export function phraseDeRelance(s: Pick<SortieParcours, 'etape' | 'projet' | 'resultatMoteur'> & { readonly attendues?: readonly string[]; readonly photoFournie?: boolean; readonly variante?: SortieParcours['variante'] }): string {
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
      // LOT G7 — retouche ambiguë : une précision à puces, puis la variante est recalculée.
      if (s.attendues?.some((a) => a.startsWith('x3_ret_'))) return 'Choisissez ci-dessous, et je recalcule la variante.';
      if (s.variante && s.variante.n >= 2 && s.variante.changements.length && s.projet && s.resultatMoteur?.ok) {
        return `Voici la variante V${s.variante.n}. Si vous le souhaitez, je peux maintenant préparer une image de l’extension (avec ses plans), sur la même photo et avec le même placement.`;
      }
      // LOT G3 — photo de la maison envoyée dans la conversation : c'est elle qui sert de fond.
      if (s.projet && s.resultatMoteur?.ok && s.photoFournie) return 'Si vous le souhaitez, je peux maintenant préparer l’image de l’extension sur votre photo.';
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
export function resultatParcours(s: SortieParcours, lectureBdTopo: LectureBdTopoMemorisee | null = null, photoFournie = false): ResultatOutil {
  const relance = phraseDeRelance({ ...s, photoFournie });
  const variante = s.etape === 'termine' && s.variante ? s.variante : null;
  return {
    status: 'ok', source: SOURCE_EXTENSION,
    data: {
      etape: s.etape, etat: s.etat, attendues: s.attendues, vue: s.vue,
      texte_affiche: s.texte, bloc_choix: s.blocChoix, phrase_relance: relance,
      ...(s.projet ? { projet_extension: s.projet, option_travail: s.optionTravail } : {}),
      ...(s.erreursProjet.length ? { erreurs_projet: s.erreursProjet } : {}),
      // LOT X8 — lecture BD TOPO de la parcelle, réutilisée si la BD TOPO ne répond pas à un tour suivant.
      ...(lectureBdTopo ? { bdtopo_lue: lectureBdTopo } : {}),
      // LOT G7 — variante affichée (numéro, changements, demandes non appliquées, point de vue).
      ...(variante ? { variante } : {}),
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
          'l’image part de CETTE extension (maison existante conservée + extension placée), jamais d’un immeuble ni de logements. Ne promets ni délai ni image « insérée dans la rue » : la machine de rendu le vérifie elle-même.' +
          // LOT G7 — variante demandée en parlant : si une image de l'extension existe déjà dans la conversation, la
          // nouvelle image est proposée tout de suite (devis à confirmer), sur la même photo et avec le même placement.
          (variante && variante.n >= 2 && variante.changements.length
            ? ` C’EST LA VARIANTE V${variante.n} DU PROJET : si une image de l’extension a déjà été préparée dans cette conversation, appelle MAINTENANT studio_lancer_rendu avec type « image », SANS brief et SANS fond (la même photo et le même placement sont repris automatiquement) : il présente le devis, à confirmer par l’utilisateur ; n’annonce aucun délai.`
            : '')
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
export function lireFacadesLues(v: unknown, source: FacadeVoieFiche['source'] = 'cadastre-voisines'): FacadesVoieLues | null {
  if (!estObj(v) || typeof v.idu !== 'string' || !RE_IDU.test(v.idu) || typeof v.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.date)) return null;
  if (!Array.isArray(v.facades) || !v.facades.length || v.facades.length > 50) return null;
  const point = (p: unknown): p is [number, number] => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0] as number) <= 180 && Math.abs(p[1] as number) <= 90;
  const out: FacadeVoieFiche[] = [];
  for (const x of v.facades) {
    if (!estObj(x) || !point(x.debut) || !point(x.fin) || typeof x.longueurM !== 'number' || !Number.isFinite(x.longueurM) || x.source !== source) return null;
    out.push({ debut: [x.debut[0], x.debut[1]], fin: [x.fin[0], x.fin[1]], longueurM: x.longueurM, source });
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

/**
 * INTÉGRATION 18/11 — côté de la rue DÉSIGNÉ par l'utilisateur (puces « Côté de la rue », lot X10) pour CETTE parcelle,
 * mémorisé comme limite sur rue (source « utilisateur ») : la machine de rendu le reçoit comme une limite lue.
 */
export function facadesChoisiesDesSorties(sorties: readonly Obj[], idu: string): FacadesVoieLues | null {
  for (const d of sorties) {
    if (!estObj(d) || d.facades_voie_choisies === undefined) continue;
    const l = lireFacadesLues(d.facades_voie_choisies, 'utilisateur');
    if (l && l.idu === idu) return l;
  }
  return null;
}

/** Longueur (m) d'une arête WGS 84 courte (approximation équirectangulaire, écart < 0,1 % à cette échelle). */
export function longueurAreteM(debut: readonly [number, number], fin: readonly [number, number]): number {
  const lat = ((debut[1] + fin[1]) / 2) * Math.PI / 180;
  const dx = (fin[0] - debut[0]) * 111_320 * Math.cos(lat);
  const dy = (fin[1] - debut[1]) * 110_574;
  return Math.round(Math.hypot(dx, dy) * 100) / 100;
}

/** Côté du contour cadastral désigné par l'utilisateur → limite sur rue (source « utilisateur »), ou null. */
export function facadesDuCoteChoisi(idu: string, date: string, anneau: readonly (readonly [number, number])[] | null, rueChoix: string | null | undefined): FacadesVoieLues | null {
  if (!anneau || !rueChoix) return null;
  const choix = candidatChoisi(candidatsCoteRue(anneau), rueChoix);
  if (!choix || !choix.segments.length) return null;
  return {
    idu, date,
    facades: choix.segments.map((s) => ({ debut: [s.debut[0], s.debut[1]], fin: [s.fin[0], s.fin[1]], longueurM: longueurAreteM(s.debut, s.fin), source: 'utilisateur' as const })),
  };
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
  const dateJour = new Date((env.maintenant ?? Date.now)()).toISOString().slice(0, 10);

  // LOT G3 — photo de la maison jointe à CE message : lue (EXIF) et déposée dans l'espace privé de l'utilisateur ;
  // sinon, photo d'un tour précédent de la conversation. Elle servira de fond à l'image de l'extension.
  const photoPrecedente = photoProjetDesSorties(sorties);
  const recue = env.photoDuTour ? await recevoirPhoto(env.photoDuTour, env.userId, env.depotPhoto, dateJour, prec.etat.idu) : null;
  let photo: PhotoProjet | null = recue?.photo ?? photoPrecedente;
  const lignesPhoto: string[] = recue?.raison ? [`Votre photo n’a pas pu être gardée pour l’image : ${recue.raison}.`] : [];

  // Parcelle : conception donnée, sinon identifiant donné, sinon celle du parcours en cours, sinon la 3D de la conversation.
  const iduDonne = typeof input.idu === 'string' ? input.idu.replace(/\s/g, '').toUpperCase() : null;
  let idu = iduDonne && RE_IDU.test(iduDonne) ? iduDonne : prec.etat.idu;
  // LOT G3 — aucune parcelle connue : la position (et la direction) enregistrées dans la photo la retrouvent au cadastre.
  let parcellePhoto: ParcelleDeLaPhoto | null = null;
  if (!idu && recue?.photo?.position) {
    const r = await parcelleDepuisPhoto(recue.photo.position, recue.photo.cap_deg, env.fetch);
    if ('parcelle' in r) { parcellePhoto = r.parcelle; idu = r.parcelle.idu; }
    else lignesPhoto.push(`Je n’ai pas pu retrouver la maison d’après la photo : ${r.raison}.`);
  }
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
    // LOT G3 — la photo reçue est GARDÉE (sortie « ok » relue au tour suivant) ; l'adresse est demandée.
    if (photo) {
      const relance = 'J’ai bien votre photo. Donnez-moi l’adresse ou la référence cadastrale de la maison, et je reprends.';
      return {
        status: 'ok', source: SOURCE_EXTENSION,
        data: { etape: 'sans_parcelle', photo_projet: photo, phrase_relance: relance, lignes_photo: [...lignesPhoto, ...lignesPhotoProjet(photo, !!recue?.photo, null)] },
        message: `Parcelle inconnue. Écris EXACTEMENT cette phrase, et rien d’autre : « ${relance} » ${lignesPhoto.length ? `Ajoute seulement, en une phrase, pourquoi la photo n’a pas suffi : ${lignesPhoto.join(' ')} ` : ''}N’annonce aucune estimation, aucune image, aucun lancement.`,
      };
    }
    return erreur('Parcelle inconnue : demande à l’utilisateur l’adresse ou la référence cadastrale de sa maison (une seule question, en texte). Ne propose aucune estimation.', 'partial');
  }
  if (photo && photo.idu !== iduRetenu) photo = { ...photo, idu: iduRetenu, depuis_terrain: parcellePhoto ? parcellePhoto.depuisTerrain : photo.idu === null ? photo.depuis_terrain : null };

  // Contour cadastral.
  let geometrie: unknown = estObj(c?.parcelle) ? (c!.parcelle as Obj).geometrie : parcellePhoto?.geometrie ?? null;
  let surface: number | null = estObj(c?.parcelle) && typeof (c!.parcelle as Obj).surface_m2 === 'number' ? (c!.parcelle as Obj).surface_m2 as number : parcellePhoto?.surfaceM2 ?? null;
  if (!geometrie) {
    const r = await lireJson(env.fetch, urlCadastre(iduRetenu));
    const f = 'data' in r && estObj(r.data) && Array.isArray(r.data.features) ? r.data.features[0] : null;
    if (estObj(f)) {
      geometrie = f.geometry;
      if (estObj(f.properties) && typeof f.properties.contenance === 'number') surface = f.properties.contenance;
    }
  }
  const anneau = anneauParcelle(geometrie);
  // LOT G3 — photo prise depuis la parcelle (position dans le contour) : « gauche / droite » restent vus de la rue (dit).
  if (photo && photo.position && photo.depuis_terrain === null && anneau) photo = { ...photo, depuis_terrain: pointDansContour(photo.position, anneau) };

  // Sources en parallèle (lecture seule, jamais bloquantes).
  let batiments: BatimentBdTopo[] | null = null;
  let raisonBdTopo: string | null = null;
  let lecture: LectureBdTopoMemorisee | null = null;
  let bdtopoReutilisee: string | null = null;
  let bdnb: DonneesBdnb | null = null;
  let noteBdnb: string | null = null;
  let zoneU: ContexteParcours['zoneU'] = { valeur: null, source: 'zonage non lu' };
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
    ...(env.planLu ? { planLu: env.planLu } : {}),
  };
  const s = avancerParcours(prec.etat, env.texteUtilisateur ?? '', prec.attendues, ctx);
  const r0 = resultatParcours(s, lecture, photo !== null);
  // LOT G6 — plan joint au message : lu dans le Studio, jamais par le modèle (aucune cote citée ni estimée).
  const r = planJointAuMessage(env.texteUtilisateur ?? '') ? { ...r0, message: `${r0.message}${CONSIGNE_PLAN_JOINT}` } : r0;
  if (!r.data) return r;
  // INTÉGRATION 18/11 — sans limite lue, le côté de la rue désigné par l'utilisateur est mémorisé pour la machine de rendu.
  const facadesChoisies = !facadesLues && !ctx.facadesVoie.length ? facadesDuCoteChoisi(iduRetenu, dateJour, anneau, s.etat.rueChoix) : null;
  let data: Obj = { ...(r.data as Obj), ...(facadesLues ? { facades_voie_lues: facadesLues } : {}), ...(facadesChoisies ? { facades_voie_choisies: facadesChoisies } : {}) };
  // LOT G7 — historique des variantes (V1, V2…) rattaché au projet : numéro, changements, verdict, empreinte du projet.
  const historique = variantesDesSorties(sorties);
  if (s.etape === 'termine' && s.variante) {
    let empreinte: string | null = null;
    try { empreinte = s.projet ? await empreinteProjet(s.projet) : null; } catch { empreinte = null; }
    const liste = avecVariante(historique, {
      n: s.variante.n, cree_le: new Date((env.maintenant ?? Date.now)()).toISOString(), changements: s.variante.changements,
      resume: s.variante.resume, verdict: s.resultatMoteur?.ok ? 'placee' : 'refusee', empreinte_projet: empreinte,
    });
    data = { ...data, variantes: liste };
  } else if (historique.length) data = { ...data, variantes: historique };
  // LOT G3 — extension PLACÉE sur une parcelle sans dossier dans Mimmoza (essai du 17/11, 64065000AI0002 : « aucune
  // image sans dossier ») : le dossier minimal est créé (contour et parcelles voisines lus au cadastre, rien d'autre).
  if (s.etape === 'termine' && s.resultatMoteur?.ok && !c && env.depot.creerDossierParcelle) {
    let id: string | null = null;
    try {
      const p = await chercherContourParcelle(iduRetenu, env.fetch);
      if (p) id = await env.depot.creerDossierParcelle(env.userId, { idu: iduRetenu, commune: null, parcelle: p as unknown as Obj });
    } catch { id = null; }
    const vue = estObj(data.vue) ? data.vue : null;
    const ligne = id
      ? `Dossier de la parcelle ${iduRetenu} créé dans Mimmoza pour préparer l’image (contour et parcelles voisines lus au cadastre le ${dateJour} ; aucune règle d’urbanisme lue).`
      : `Le dossier de la parcelle ${iduRetenu} n’a pas pu être créé : l’image de l’extension ne pourra pas encore être préparée.`;
    data = { ...data, ...(id ? { dossier_parcelle_id: id } : {}), ...(vue ? { vue: { ...vue, avertissements: [...(Array.isArray(vue.avertissements) ? vue.avertissements : []), ligne] } } : {}) };
  }
  // LOT G3 — photo du projet : mémorisée d'un tour à l'autre et dite sous la carte (avertissements de la vue).
  if (photo) {
    const lignes = [...lignesPhoto, ...lignesPhotoProjet(photo, !!recue?.photo, parcellePhoto)];
    const vue = estObj(data.vue) ? data.vue : null;
    data = { ...data, photo_projet: photo, ...(vue && lignes.length ? { vue: { ...vue, avertissements: [...(Array.isArray(vue.avertissements) ? vue.avertissements : []), ...lignes] } } : {}) };
  } else if (lignesPhoto.length && estObj(data.vue)) {
    const vue = data.vue;
    data = { ...data, vue: { ...vue, avertissements: [...(Array.isArray(vue.avertissements) ? vue.avertissements : []), ...lignesPhoto] } };
  }
  return { ...r, data };
}

/** LOT G3 — dépôt de la photo d'origine dans `studio-transfert/<uid>/<uuid>.<ext>` (clé de service, dossier de l'utilisateur). */
export function depotPhotoProjetSupabase(admin: ClientSb): DepotPhotoProjet {
  return {
    async deposer(userId, octets, mediaType) {
      const uid = userId.toLowerCase();
      if (!/^[0-9a-f-]{36}$/.test(uid)) return null;
      const chemin = `${uid}/${crypto.randomUUID()}.${mediaType === 'image/png' ? 'png' : 'jpg'}`;
      const { error } = await admin.storage.from('studio-transfert').upload(chemin, new Blob([new Uint8Array(octets)], { type: mediaType }), { contentType: mediaType, upsert: false });
      return error ? null : chemin;
    },
  };
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
    async creerDossierParcelle(userId, d) {
      // Client UTILISATEUR (RLS : insertion par le propriétaire) ; aucune mission liée, statut « regles » (rien de lu).
      const { data, error } = await db.from('agent_conceptions')
        .insert({ user_id: userId, idu: d.idu, commune: d.commune, parcelle: d.parcelle, regles_plu: [], statut: 'regles' }).select('id').single();
      return error || !data?.id ? null : String(data.id);
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
