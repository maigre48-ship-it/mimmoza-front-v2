/**
 * VIS-45 (25/11/2026) — PONT « CHAT MIMMOZA → STUDIO » (protocole `mimmoza-commandes-studio`, version 1).
 *
 * UN SEUL CHAT : celui de Mimmoza. Le Studio n'a plus de discussion à lui ; il EXÉCUTE les commandes que le chat
 * Mimmoza lui envoie et lui RENVOIE ses comptes rendus. Le fil de la conversation Mimmoza est affiché dans le Studio.
 *
 * COPIE IDENTIQUE dans les deux dépôts (aucun import : le fichier se compile seul des deux côtés, et dans l'Edge) :
 *   - mimmozia-studio/src/core/echange/pontCommandesStudio.ts
 *   - mimmoza-front-v2/src/spaces/promoteur/shared/echangeStudio/pontCommandesStudio.ts
 * Le test du Studio vérifie le catalogue contre le VRAI registre des commandes du Studio ; les tests des deux dépôts
 * vérifient la même empreinte de catalogue (EMPREINTE_CATALOGUE recalculée).
 *
 * Canaux (BroadcastChannel `mimmoza-commandes-studio`, onglets de la MÊME origine : le Studio est servi sous /studio/) :
 *   site   → Studio : `commande.executer`      une commande décidée dans le chat Mimmoza (id du registre, ou phrase)
 *   Studio → site   : `commande.accuse`        reçue, en cours (le site sait qu'un Studio est ouvert)
 *   Studio → site   : `commande.compte-rendu`  fait / échec / confirmation requise (+ fichiers, surfaces des plans)
 *   Studio → site   : `studio.notification`    compte rendu AUTOMATIQUE du Studio (« Bâtiment posé… », « Relief… »)
 *   Studio → site   : `studio.pret`            un onglet Studio relié à ce projet vient de démarrer
 *   Studio → site   : `fil.demander`           le Studio veut le fil de la conversation Mimmoza
 *   site   → Studio : `fil.etat`               le fil (derniers messages, lecture) et si l'envoi est possible
 *   Studio → site   : `fil.envoyer`            texte saisi dans le Studio → envoyé DANS la conversation Mimmoza
 *   Studio → site   : `fil.revenir`            « Revenir au chat Mimmoza » : l'onglet du chat se met au premier plan
 *
 * File d'attente : Studio fermé → la commande est rangée dans `localStorage[CLE_COMMANDES_EN_ATTENTE]` (même origine)
 * et exécutée par le Studio à son ouverture ; un compte rendu que le site n'a pas reçu (onglet du chat fermé) attend
 * dans `localStorage[CLE_COMPTES_RENDUS_EN_ATTENTE]`.
 */

export const TYPE_PONT_COMMANDES = 'mimmoza-commandes-studio' as const;
export const VERSION_PONT_COMMANDES = 1 as const;
export const CANAL_DIFFUSION_COMMANDES = 'mimmoza-commandes-studio';
export const CLE_COMMANDES_EN_ATTENTE = 'mimmoza.studio.commandes-en-attente';
export const CLE_COMPTES_RENDUS_EN_ATTENTE = 'mimmoza.studio.comptes-rendus-en-attente';
/** Une commande en attente plus vieille que ça n'est plus exécutée (le chat a pu passer à autre chose). */
export const DUREE_VIE_ATTENTE_MS = 24 * 60 * 60 * 1000;
/** Accusé attendu d'un Studio ouvert ; au-delà, la commande est mise en attente. */
export const DELAI_ACCUSE_COMMANDE_MS = 1500;
/** Nom donné à l'onglet du chat Mimmoza (le Studio le ramène au premier plan par ce nom). */
export const NOM_ONGLET_CHAT_MIMMOZA = 'mimmoza-chat';
export const MAX_EN_ATTENTE = 20;
export const MAX_MESSAGES_FIL = 40;
export const MAX_TEXTE_FIL = 2000;

export type CanalCommandes =
  | 'commande.executer' | 'commande.accuse' | 'commande.compte-rendu' | 'studio.notification' | 'studio.pret'
  | 'fil.demander' | 'fil.etat' | 'fil.envoyer' | 'fil.revenir';
export const CANAUX_COMMANDES: readonly CanalCommandes[] = [
  'commande.executer', 'commande.accuse', 'commande.compte-rendu', 'studio.notification', 'studio.pret',
  'fil.demander', 'fil.etat', 'fil.envoyer', 'fil.revenir',
];

/* ───────────────────────── Catalogue : ce que le chat Mimmoza commande au Studio ───────────────────────── */

export interface ParamCatalogue {
  readonly type: 'texte' | 'choix' | 'nombre' | 'booleen';
  readonly description: string;
  readonly requis?: boolean;
  readonly valeurs?: readonly string[];
}

export interface EntreeCatalogueChat {
  /** Identifiant du REGISTRE du Studio (src/ui/commandes/registre.ts), vérifié par le test du Studio. */
  readonly id: string;
  readonly libelle: string;
  readonly quoi: string;
  /** Longue (rendu Unreal, plans) : le chat demande « oui » AVANT d'envoyer, puis envoie `confirme: true`. */
  readonly confirmation: boolean;
  /** Contrat d'un autre lot (la commande peut manquer dans un Studio plus ancien : le Studio le dit). */
  readonly contrat?: string;
  readonly params: Readonly<Record<string, ParamCatalogue>>;
}

const STYLES_INTERIEUR = ['contemporain', 'scandinave', 'industriel', 'japandi', 'classique_chic', 'mediterraneen'] as const;
const GAMMES = ['economique', 'standard', 'premium'] as const;
const CIBLES = ['famille', 'couple', 'primo_accedant', 'investisseur_locatif', 'senior', 'etudiant'] as const;
const ETENDUE = ['piece', 'logement'] as const;

export const CATALOGUE_COMMANDES_CHAT: readonly EntreeCatalogueChat[] = [
  { id: 'ouvrir-etape', libelle: 'Ouvrir une étape du Studio', quoi: 'Met le Studio sur une étape (projet, terrain, bâtiment, aménagement, images et visite, film).', confirmation: false,
    params: { etape: { type: 'choix', description: 'Étape', requis: true, valeurs: ['projet', 'terrain', 'batiment', 'amenagement', 'images-visite', 'film'] } } },
  { id: 'ouvrir-panneau', libelle: 'Ouvrir un panneau du Studio', quoi: 'Ouvre directement un sous-onglet (plans, style, matériaux, quartier, objets, images, visite, film, livraison…).', confirmation: false,
    params: { panneau: { type: 'choix', description: 'Panneau', requis: true, valeurs: ['resume', 'ensemble', 'terrain', 'batiment', 'plans', 'modeles', 'style', 'materiaux', 'quartier', 'voisinage', 'vegetation', 'objets', 'archviz', 'lumiere', 'images', 'visite', 'film', 'livraison'] } } },
  { id: 'interieur-amenager', libelle: 'Aménager / meubler le logement', quoi: 'Calcule l’aménagement du logement (moteur d’architecture intérieure) selon le style, les occupants et la gamme, et applique la variante recommandée.', confirmation: false,
    params: {
      style: { type: 'choix', description: 'Style d’intérieur', valeurs: STYLES_INTERIEUR },
      cible: { type: 'choix', description: 'Occupants visés', valeurs: CIBLES },
      personnes: { type: 'nombre', description: 'Nombre d’occupants (1 à 12)' },
      gamme: { type: 'choix', description: 'Gamme', valeurs: GAMMES },
    } },
  { id: 'interieur-style', libelle: 'Changer le style d’intérieur', quoi: 'Change le style du logement aménagé (palette, matériaux, mobilier).', confirmation: false,
    params: { style: { type: 'choix', description: 'Style', requis: true, valeurs: STYLES_INTERIEUR } } },
  { id: 'interieur-gamme', libelle: 'Changer la gamme', quoi: 'Change la gamme du mobilier et des finitions.', confirmation: false,
    params: { gamme: { type: 'choix', description: 'Gamme', requis: true, valeurs: GAMMES } } },
  { id: 'interieur-ajouter-meuble', libelle: 'Poser un meuble', quoi: 'Pose un meuble dans une pièce, à la meilleure place libre.', confirmation: false,
    params: { meuble: { type: 'texte', description: 'Meuble (bibliothèque, fauteuil, bureau…)', requis: true }, piece: { type: 'texte', description: 'Pièce (séjour, chambre 2…)', requis: true } } },
  { id: 'interieur-supprimer-meuble', libelle: 'Retirer un meuble', quoi: 'Retire un meuble (de la pièce nommée, ou le seul de ce type).', confirmation: false,
    params: { meuble: { type: 'texte', description: 'Meuble à retirer', requis: true }, piece: { type: 'texte', description: 'Pièce (facultative)' } } },
  { id: 'atelier-deplacer-meuble', libelle: 'Déplacer un meuble', quoi: 'Pousse un meuble d’une pièce vers la gauche, la droite, le haut ou le bas du plan (en mètres), ou le tourne d’un quart de tour.', confirmation: false,
    params: {
      meuble: { type: 'texte', description: 'Meuble à déplacer (canapé, lit, table…)', requis: true },
      piece: { type: 'texte', description: 'Pièce', requis: true },
      direction: { type: 'choix', description: 'Sens', requis: true, valeurs: ['gauche', 'droite', 'haut', 'bas', 'tourner'] },
      distance: { type: 'nombre', description: 'Distance en mètres (0,1 à 3 ; 0,5 par défaut)' },
    } },
  { id: 'interieur-sol', libelle: 'Changer un sol', quoi: 'Change le sol d’une pièce ou de tout le logement (pièces sèches).', confirmation: false,
    params: { finition: { type: 'texte', description: 'Sol (parquet chêne, carrelage, béton ciré…)', requis: true }, piece: { type: 'texte', description: 'Pièce' }, etendue: { type: 'choix', description: 'Pièce ou logement', valeurs: ETENDUE } } },
  { id: 'interieur-murs', libelle: 'Changer les murs', quoi: 'Peint ou habille les murs d’une pièce ou de tout le logement.', confirmation: false,
    params: { finition: { type: 'texte', description: 'Teinte ou matière', requis: true }, piece: { type: 'texte', description: 'Pièce' }, etendue: { type: 'choix', description: 'Pièce ou logement', valeurs: ETENDUE } } },
  { id: 'atelier-style', libelle: 'Changer l’ambiance d’une pièce', quoi: 'Remeuble une pièce (ou tout le logement) dans une ambiance.', confirmation: false,
    params: { style: { type: 'choix', description: 'Ambiance', requis: true, valeurs: ['contemporain', 'scandinave', 'industriel', 'classique', 'minimaliste'] }, piece: { type: 'texte', description: 'Pièce' }, etendue: { type: 'choix', description: 'Pièce ou logement', valeurs: ETENDUE } } },
  { id: 'interieur-voir', libelle: 'Montrer l’intérieur', quoi: 'Vue 3D plongeante du logement meublé.', confirmation: false, params: {} },
  { id: 'interieur-voir-exterieur', libelle: 'Montrer l’extérieur', quoi: 'Revient au bâtiment entier dans la vue 3D.', confirmation: false, params: {} },
  { id: 'style-architectural', libelle: 'Style architectural', quoi: 'Applique un style architectural sans changer les volumes.', confirmation: false,
    params: { style: { type: 'choix', description: 'Style', requis: true, valeurs: ['contemporary-minimal', 'contemporary-wood-glass', 'traditional-french', 'mediterranean', 'townhouse', 'haussmann-simplified', 'art-deco-simplified', 'urban-brick', 'industrial', 'contemporary-offices', 'contemporary-collective', 'contemporary-civic'] } } },
  { id: 'ambiance', libelle: 'Ambiance de la vue', quoi: 'Change l’ambiance d’éclairage de la vue 3D.', confirmation: false,
    params: { ambiance: { type: 'choix', description: 'Ambiance', requis: true, valeurs: ['studio-neutre', 'matin-clair', 'midi', 'coucher-de-soleil', 'nuit', 'temps-couvert', 'apres-la-pluie', 'presentation-architecturale'] } } },
  { id: 'lumiere', libelle: 'Lumière de la mise en scène', quoi: 'Grand jour, couvert, heure dorée, soirée, nuit.', confirmation: false,
    params: { lumiere: { type: 'choix', description: 'Lumière', requis: true, valeurs: ['clear-day', 'overcast', 'golden-hour', 'evening', 'night'] } } },
  { id: 'lumiere-interieure', libelle: 'Lumières intérieures', quoi: 'Allume ou éteint les éclairages intérieurs.', confirmation: false,
    params: { actif: { type: 'booleen', description: 'Allumées', requis: true } } },
  { id: 'lancer-visite', libelle: 'Lancer la visite temps réel', quoi: 'Prépare le bâtiment dans Unreal (PC de rendu) et ouvre la visite dans le Studio.', confirmation: true, params: {} },
  { id: 'produire-images', libelle: 'Produire les images Unreal', quoi: 'Images Unreal du projet ouvert dans le Studio (PC de rendu).', confirmation: true, params: {} },
  { id: 'interieur-images', libelle: 'Images de l’intérieur', quoi: 'Une caméra par pièce principale et production des images photoréalistes (PC de rendu).', confirmation: true,
    params: { piece: { type: 'texte', description: 'Une seule pièce (facultatif)' } } },
  { id: 'film', libelle: 'Film Unreal', quoi: 'Film de présentation Unreal (teaser 30 s, 60 s, 2 min) produit par le PC de rendu.', confirmation: true,
    params: { modele: { type: 'choix', description: 'Modèle', valeurs: ['teaser30', 'presentation60', 'complet120'] }, format: { type: 'choix', description: 'Format', valeurs: ['16x9', '9x16', '16x9+9x16'] } } },
  { id: 'plans-architecte', libelle: 'Plans d’architecte', contrat: 'VIS-44', confirmation: true,
    quoi: 'Dossier de plans du bâtiment du Studio : PDF (A3/A1), DXF AutoCAD, IFC4, SVG et tableau des surfaces (surface habitable, surface de plancher, emprise).',
    params: { format: { type: 'choix', description: 'Format du PDF', valeurs: ['A3', 'A1'] } } },
];

export function entreeCatalogue(id: string): EntreeCatalogueChat | null {
  return CATALOGUE_COMMANDES_CHAT.find((e) => e.id === id) ?? null;
}

/** Empreinte FNV-1a du catalogue (ids, paramètres, valeurs) : les deux copies doivent la partager. */
export function empreinteCatalogue(): string {
  const s = JSON.stringify(CATALOGUE_COMMANDES_CHAT.map((e) => [e.id, e.confirmation, Object.entries(e.params).map(([k, p]) => [k, p.type, p.requis === true, p.valeurs ?? []])]));
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `fnv1a32:${h.toString(16).padStart(8, '0')}`;
}

/**
 * Valide une commande décidée par le chat contre le catalogue (forme seulement : le Studio revalide contre son
 * registre). Pur. Rend les paramètres nettoyés ou les erreurs, en français.
 */
export function validerCommandeChat(id: unknown, params: unknown): { ok: true; id: string; params: Record<string, string | number | boolean> } | { ok: false; erreur: string } {
  if (typeof id !== 'string') return { ok: false, erreur: 'commande absente' };
  const e = entreeCatalogue(id);
  if (!e) return { ok: false, erreur: `commande « ${id} » inconnue (commandes : ${CATALOGUE_COMMANDES_CHAT.map((x) => x.id).join(', ')})` };
  const brut = estObj(params) ? params : {};
  const sortie: Record<string, string | number | boolean> = {};
  const erreurs: string[] = [];
  for (const cle of Object.keys(brut)) if (!(cle in e.params)) erreurs.push(`paramètre inconnu « ${cle} »`);
  for (const [cle, spec] of Object.entries(e.params)) {
    const v = brut[cle];
    if (v === undefined || v === null || v === '') { if (spec.requis) erreurs.push(`paramètre « ${cle} » manquant (${spec.description})`); continue; }
    if (spec.type === 'texte') { if (typeof v !== 'string' || v.length > 120) erreurs.push(`« ${cle} » : texte de 120 caractères au plus`); else sortie[cle] = v.trim(); }
    else if (spec.type === 'choix') { if (typeof v !== 'string' || !(spec.valeurs ?? []).includes(v)) erreurs.push(`« ${cle} » doit valoir : ${(spec.valeurs ?? []).join(', ')}`); else sortie[cle] = v; }
    else if (spec.type === 'nombre') { const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : NaN; if (!Number.isFinite(n)) erreurs.push(`« ${cle} » doit être un nombre`); else sortie[cle] = n; }
    else if (typeof v !== 'boolean') erreurs.push(`« ${cle} » doit être vrai ou faux`);
    else sortie[cle] = v;
  }
  return erreurs.length > 0 ? { ok: false, erreur: erreurs.join(' ; ') } : { ok: true, id: e.id, params: sortie };
}

/* ───────────────────────── Charges ───────────────────────── */

export interface OrigineCommande {
  readonly conversationId: string | null;
  /** Message de Mimmo qui porte la commande (le compte rendu y est rattaché). */
  readonly messageId: string | null;
  /** Appel d'outil (`studio_commander`) ou clic d'un bouton : une commande n'est envoyée qu'UNE fois par appel. */
  readonly appelId: string | null;
}

export interface ChargeCommande {
  readonly requeteId: string;
  /** Projet du site (`mzchat-<conversation>`) : un Studio relié à un AUTRE projet ne l'exécute pas. */
  readonly projetId: string;
  /** Commande du registre (prioritaire), ou phrase française rejouée par le chemin déterministe du Studio (sans IA). */
  readonly commande?: { readonly id: string; readonly params: Readonly<Record<string, string | number | boolean>>; readonly confirme?: boolean };
  readonly phrase?: string;
  readonly libelle: string;
  readonly demandeLe: number;
  readonly origine: OrigineCommande;
}

export interface ChargeAccuseCommande { readonly requeteId: string; readonly projetId: string }

export type FormatFichier = 'pdf' | 'dxf' | 'ifc' | 'svg' | 'json' | 'autre';
export interface FichierCompteRendu {
  readonly nom: string;
  readonly mime: string;
  readonly format: FormatFichier;
  /** Octets du fichier (clonés par le canal) ; null s'ils n'ont pas pu passer (le Studio l'a téléchargé lui-même). */
  readonly octets: ArrayBuffer | null;
  readonly taille: number;
}

export interface LigneSurface { readonly libelle: string; readonly m2: number }
export interface SurfacesPlans {
  readonly surfaceHabitableM2: number | null;
  readonly surfacePlancherM2: number | null;
  readonly empriseM2: number | null;
  readonly lignes: readonly LigneSurface[];
}

export type StatutCompteRendu = 'fait' | 'echec' | 'confirmation' | 'autre-projet' | 'occupe' | 'invalide';
export interface ChargeCompteRendu {
  readonly requeteId: string;
  readonly projetId: string;
  readonly statut: StatutCompteRendu;
  /** Une phrase pour l'utilisateur (ce que le Studio a dit). */
  readonly message: string;
  readonly commandeId: string | null;
  readonly libelle: string;
  readonly origine: OrigineCommande;
  readonly fichiers: readonly FichierCompteRendu[];
  readonly surfaces: SurfacesPlans | null;
  readonly termineLe: number;
}

export interface ChargeNotification { readonly projetId: string; readonly id: string; readonly texte: string; readonly quand: number }
export interface ChargeProjet { readonly projetId: string }
export interface MessageFil { readonly id: string; readonly role: 'user' | 'assistant' | 'info'; readonly texte: string; readonly quand: string | null }
export interface ChargeFilEtat {
  readonly projetId: string;
  readonly conversationId: string;
  readonly messages: readonly MessageFil[];
  /** L'onglet du chat peut envoyer (pas de réponse en cours). */
  readonly envoiPossible: boolean;
  readonly enCours: boolean;
}
export interface ChargeFilEnvoyer { readonly projetId: string; readonly requeteId: string; readonly texte: string }

type Enveloppe<C extends CanalCommandes, T> = { readonly type: typeof TYPE_PONT_COMMANDES; readonly version: number; readonly canal: C; readonly charge: T };
export type MessageCommandes =
  | Enveloppe<'commande.executer', ChargeCommande>
  | Enveloppe<'commande.accuse', ChargeAccuseCommande>
  | Enveloppe<'commande.compte-rendu', ChargeCompteRendu>
  | Enveloppe<'studio.notification', ChargeNotification>
  | Enveloppe<'studio.pret', ChargeProjet>
  | Enveloppe<'fil.demander', ChargeProjet>
  | Enveloppe<'fil.etat', ChargeFilEtat>
  | Enveloppe<'fil.envoyer', ChargeFilEnvoyer>
  | Enveloppe<'fil.revenir', ChargeProjet>;

type ChargeDe<C extends CanalCommandes> = Extract<MessageCommandes, { canal: C }>['charge'];

export function creerMessageCommandes<C extends CanalCommandes>(canal: C, charge: ChargeDe<C>): Extract<MessageCommandes, { canal: C }> {
  return { type: TYPE_PONT_COMMANDES, version: VERSION_PONT_COMMANDES, canal, charge } as unknown as Extract<MessageCommandes, { canal: C }>;
}

/** Identifiant de requête (6 à 80 caractères sûrs). */
export function nouvelIdRequete(): string {
  try { return `cmd-${crypto.randomUUID()}`; } catch { return `cmd-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`; }
}

/* ───────────────────────── Lecture défensive ───────────────────────── */

const estObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const txt = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);
const RE_REQUETE = /^[A-Za-z0-9_-]{6,80}$/;
const RE_PROJET = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/;
const nombreOuNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const requeteDe = (v: unknown): string | null => (estObj(v) && typeof v.requeteId === 'string' && RE_REQUETE.test(v.requeteId) ? v.requeteId : null);
const projetDe = (v: unknown): string | null => (estObj(v) && typeof v.projetId === 'string' && RE_PROJET.test(v.projetId) ? v.projetId : null);

function lireOrigine(v: unknown): OrigineCommande {
  const o = estObj(v) ? v : {};
  return { conversationId: txt(o.conversationId, 80), messageId: txt(o.messageId, 80), appelId: txt(o.appelId, 120) };
}

function lireParams(v: unknown): Record<string, string | number | boolean> | null {
  if (!estObj(v)) return null;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, x] of Object.entries(v).slice(0, 20)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(k)) return null;
    if (typeof x === 'string' && x.length <= 300) out[k] = x;
    else if (typeof x === 'number' && Number.isFinite(x)) out[k] = x;
    else if (typeof x === 'boolean') out[k] = x;
    else return null;
  }
  return out;
}

export function lireChargeCommande(v: unknown): ChargeCommande | null {
  if (!estObj(v)) return null;
  const requeteId = requeteDe(v);
  const projetId = projetDe(v);
  if (!requeteId || !projetId) return null;
  let commande: ChargeCommande['commande'];
  if (v.commande !== undefined) {
    if (!estObj(v.commande) || typeof v.commande.id !== 'string' || !/^[a-z0-9-]{2,60}$/.test(v.commande.id)) return null;
    const params = lireParams(v.commande.params ?? {});
    if (!params) return null;
    commande = { id: v.commande.id, params, ...(v.commande.confirme === true ? { confirme: true } : {}) };
  }
  const phrase = txt(v.phrase, 500) ?? undefined;
  if (!commande && !phrase) return null;
  return {
    requeteId, projetId, ...(commande ? { commande } : {}), ...(phrase ? { phrase } : {}),
    libelle: txt(v.libelle, 160) ?? (commande?.id ?? 'Demande du chat'), demandeLe: nombreOuNull(v.demandeLe) ?? 0, origine: lireOrigine(v.origine),
  };
}

const FORMATS: readonly FormatFichier[] = ['pdf', 'dxf', 'ifc', 'svg', 'json', 'autre'];
const STATUTS: readonly StatutCompteRendu[] = ['fait', 'echec', 'confirmation', 'autre-projet', 'occupe', 'invalide'];

export function lireSurfaces(v: unknown): SurfacesPlans | null {
  if (!estObj(v)) return null;
  const lignes = Array.isArray(v.lignes)
    ? v.lignes.slice(0, 60).flatMap((l) => (estObj(l) && txt(l.libelle, 120) && nombreOuNull(l.m2) !== null ? [{ libelle: l.libelle as string, m2: l.m2 as number }] : []))
    : [];
  return { surfaceHabitableM2: nombreOuNull(v.surfaceHabitableM2), surfacePlancherM2: nombreOuNull(v.surfacePlancherM2), empriseM2: nombreOuNull(v.empriseM2), lignes };
}

function lireFichiers(v: unknown): FichierCompteRendu[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 12).flatMap((f) => {
    if (!estObj(f)) return [];
    const nom = txt(f.nom, 160);
    if (!nom || /[\\/]|\.\./.test(nom)) return [];
    const octets = f.octets instanceof ArrayBuffer ? f.octets : null;
    const format = FORMATS.includes(f.format as FormatFichier) ? f.format as FormatFichier : 'autre';
    return [{ nom, mime: txt(f.mime, 100) ?? 'application/octet-stream', format, octets, taille: octets ? octets.byteLength : (nombreOuNull(f.taille) ?? 0) }];
  });
}

export function lireCompteRendu(v: unknown): ChargeCompteRendu | null {
  if (!estObj(v)) return null;
  const requeteId = requeteDe(v);
  const projetId = projetDe(v);
  if (!requeteId || !projetId || !STATUTS.includes(v.statut as StatutCompteRendu)) return null;
  return {
    requeteId, projetId, statut: v.statut as StatutCompteRendu,
    message: (typeof v.message === 'string' ? v.message : '').slice(0, 2000),
    commandeId: txt(v.commandeId, 60), libelle: txt(v.libelle, 160) ?? '', origine: lireOrigine(v.origine),
    fichiers: lireFichiers(v.fichiers), surfaces: lireSurfaces(v.surfaces), termineLe: nombreOuNull(v.termineLe) ?? 0,
  };
}

function lireMessagesFil(v: unknown): MessageFil[] {
  if (!Array.isArray(v)) return [];
  return v.slice(-MAX_MESSAGES_FIL).flatMap((m) => {
    if (!estObj(m) || !txt(m.id, 120) || !['user', 'assistant', 'info'].includes(m.role as string) || typeof m.texte !== 'string') return [];
    return [{ id: m.id as string, role: m.role as MessageFil['role'], texte: m.texte.slice(0, MAX_TEXTE_FIL), quand: txt(m.quand, 40) }];
  });
}

export type LectureCommandes = { readonly ok: true; readonly message: MessageCommandes } | { readonly ok: false; readonly erreur: string };

function enveloppe<C extends CanalCommandes>(version: number, canal: C, charge: ChargeDe<C>): LectureCommandes {
  return { ok: true, message: { type: TYPE_PONT_COMMANDES, version, canal, charge } as unknown as MessageCommandes };
}

/** Valide la FORME d'un message (le canal de diffusion garantit la même origine). Pur, ne lève jamais. */
export function lireMessageCommandes(data: unknown): LectureCommandes {
  if (!estObj(data) || data.type !== TYPE_PONT_COMMANDES) return { ok: false, erreur: 'pas un message du pont des commandes' };
  if (typeof data.version !== 'number' || !Number.isInteger(data.version) || data.version < 1) return { ok: false, erreur: 'version invalide' };
  if (data.version > VERSION_PONT_COMMANDES) return { ok: false, erreur: `version ${data.version} non prise en charge : rechargez l’onglet` };
  const ch = data.charge;
  const v = data.version;
  switch (data.canal) {
    case 'commande.executer': { const c = lireChargeCommande(ch); return c ? enveloppe(v, 'commande.executer', c) : { ok: false, erreur: 'commande illisible' }; }
    case 'commande.accuse': {
      const p = projetDe(ch); const r = requeteDe(ch);
      return p && r ? enveloppe(v, 'commande.accuse', { requeteId: r, projetId: p }) : { ok: false, erreur: 'accusé illisible' };
    }
    case 'commande.compte-rendu': { const c = lireCompteRendu(ch); return c ? enveloppe(v, 'commande.compte-rendu', c) : { ok: false, erreur: 'compte rendu illisible' }; }
    case 'studio.notification': {
      const p = projetDe(ch);
      if (!p || !estObj(ch) || !txt(ch.id, 120) || !txt(ch.texte, 2000)) return { ok: false, erreur: 'notification illisible' };
      return enveloppe(v, 'studio.notification', { projetId: p, id: ch.id as string, texte: ch.texte as string, quand: nombreOuNull(ch.quand) ?? 0 });
    }
    case 'studio.pret': case 'fil.demander': case 'fil.revenir': {
      const p = projetDe(ch);
      return p ? enveloppe(v, data.canal, { projetId: p }) : { ok: false, erreur: 'projet absent' };
    }
    case 'fil.etat': {
      const p = projetDe(ch);
      if (!p || !estObj(ch) || !txt(ch.conversationId, 80)) return { ok: false, erreur: 'fil illisible' };
      return enveloppe(v, 'fil.etat', { projetId: p, conversationId: ch.conversationId as string, messages: lireMessagesFil(ch.messages), envoiPossible: ch.envoiPossible === true, enCours: ch.enCours === true });
    }
    case 'fil.envoyer': {
      const p = projetDe(ch); const r = requeteDe(ch);
      const t = estObj(ch) && typeof ch.texte === 'string' ? ch.texte.trim() : '';
      if (!p || !r || t.length === 0 || t.length > 4000) return { ok: false, erreur: 'envoi illisible' };
      return enveloppe(v, 'fil.envoyer', { projetId: p, requeteId: r, texte: t });
    }
    default: return { ok: false, erreur: `canal « ${String(data.canal)} » inconnu` };
  }
}

/* ───────────────────────── File d'attente (Studio fermé) ───────────────────────── */

export interface StockageSimple { getItem(k: string): string | null; setItem(k: string, v: string): void }

/** Commandes en attente (lecture défensive, périmées retirées). Pur sur le texte. */
export function lireEnAttente(brut: string | null, maintenant: number): ChargeCommande[] {
  let v: unknown;
  try { v = JSON.parse(brut ?? '[]'); } catch { return []; }
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => { const c = lireChargeCommande(x); return c && maintenant - c.demandeLe <= DUREE_VIE_ATTENTE_MS ? [c] : []; }).slice(-MAX_EN_ATTENTE);
}

/** Ajoute une commande à la file (une seule fois par requête ET par appel d'outil). */
export function ajouterEnAttente(s: StockageSimple, c: ChargeCommande, maintenant: number): ChargeCommande[] {
  const liste = lireEnAttente(s.getItem(CLE_COMMANDES_EN_ATTENTE), maintenant)
    .filter((x) => x.requeteId !== c.requeteId && !(c.origine.appelId && x.origine.appelId === c.origine.appelId));
  const out = [...liste, c].slice(-MAX_EN_ATTENTE);
  try { s.setItem(CLE_COMMANDES_EN_ATTENTE, JSON.stringify(out)); } catch { /* stockage plein */ }
  return out;
}

/** Retire de la file les commandes d'un projet et les rend (dans l'ordre), pour exécution par le Studio. */
export function prendreEnAttente(s: StockageSimple, projetId: string, maintenant: number): ChargeCommande[] {
  const liste = lireEnAttente(s.getItem(CLE_COMMANDES_EN_ATTENTE), maintenant);
  try { s.setItem(CLE_COMMANDES_EN_ATTENTE, JSON.stringify(liste.filter((c) => c.projetId !== projetId))); } catch { /* ignoré */ }
  return liste.filter((c) => c.projetId === projetId);
}

export function retirerEnAttente(s: StockageSimple, requeteId: string, maintenant: number): void {
  const liste = lireEnAttente(s.getItem(CLE_COMMANDES_EN_ATTENTE), maintenant);
  try { s.setItem(CLE_COMMANDES_EN_ATTENTE, JSON.stringify(liste.filter((c) => c.requeteId !== requeteId))); } catch { /* ignoré */ }
}

/** Comptes rendus non reçus par un onglet du chat (octets retirés : seuls le texte et les surfaces attendent). */
export function lireComptesRendusEnAttente(brut: string | null): ChargeCompteRendu[] {
  let v: unknown;
  try { v = JSON.parse(brut ?? '[]'); } catch { return []; }
  return Array.isArray(v) ? v.flatMap((x) => { const c = lireCompteRendu(x); return c ? [c] : []; }).slice(-MAX_EN_ATTENTE) : [];
}
export function garderCompteRenduEnAttente(s: StockageSimple, c: ChargeCompteRendu): void {
  const liste = lireComptesRendusEnAttente(s.getItem(CLE_COMPTES_RENDUS_EN_ATTENTE)).filter((x) => x.requeteId !== c.requeteId);
  const sansOctets: ChargeCompteRendu = { ...c, fichiers: c.fichiers.map((f) => ({ ...f, octets: null })) };
  try { s.setItem(CLE_COMPTES_RENDUS_EN_ATTENTE, JSON.stringify([...liste, sansOctets].slice(-MAX_EN_ATTENTE))); } catch { /* ignoré */ }
}
export function prendreComptesRendusEnAttente(s: StockageSimple, projetId: string): ChargeCompteRendu[] {
  const liste = lireComptesRendusEnAttente(s.getItem(CLE_COMPTES_RENDUS_EN_ATTENTE));
  try { s.setItem(CLE_COMPTES_RENDUS_EN_ATTENTE, JSON.stringify(liste.filter((c) => c.projetId !== projetId))); } catch { /* ignoré */ }
  return liste.filter((c) => c.projetId === projetId);
}

/* ───────────────────────── Textes ───────────────────────── */

/** Conversation Mimmoza d'un projet `mzchat-<conversation>` (null : projet d'un autre type). */
export function conversationDuProjet(projetId: string | null | undefined): string | null {
  return typeof projetId === 'string' && projetId.startsWith('mzchat-') && projetId.length > 7 ? projetId.slice(7) : null;
}

export const PHRASE_EN_ATTENTE = 'Le Studio n’est pas ouvert : la commande est mise en attente et s’exécutera dès son ouverture.';

/** Une ligne pour le chat Mimmoza à partir d'un compte rendu. */
export function phraseCompteRendu(c: Pick<ChargeCompteRendu, 'statut' | 'message' | 'libelle'>): string {
  const m = c.message.trim();
  switch (c.statut) {
    case 'fait': return m || `${c.libelle} : fait dans le Studio.`;
    case 'confirmation': return `${c.libelle} : action longue, le Studio attend votre accord. Répondez « oui » dans ce chat pour la lancer.`;
    case 'autre-projet': return 'Le Studio ouvert montre un autre projet : la commande n’a pas été exécutée. Ouvrez le Studio depuis cette conversation.';
    case 'occupe': return 'Le Studio est occupé par une autre action : redemandez dans un instant.';
    case 'invalide': return `Le Studio a refusé la commande${m ? ` : ${m}` : ''}.`;
    default: return m || `${c.libelle} : le Studio n’a pas pu le faire.`;
  }
}
