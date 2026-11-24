// supabase/functions/copilot-chat/agent/dessin-batiment.ts
// =============================================================================
// VIS-25 lot B — « Dessiner n'importe quoi » depuis le chat MimmozIA, puis le RETOUCHER en parlant.
//
// Deux outils, UN contrat (src/lib/studio/modeleBatiment.ts, lot A — jamais modifié ici) :
//   1. `studio_dessiner_batiment` : le modèle du chat ÉCRIT un ModeleBatiment (depuis le texte, ou depuis la photo
//      jointe qu'il voit : référence de STYLE, jamais un relevé) ; le code le VALIDE (validerModele : corrige et le
//      DIT) et renvoie la carte « Votre bâtiment » (aperçu en plan + façade, liste, « Ce que j'ai corrigé »,
//      pastilles honnêtes, UN bouton « Reproduire en 3D »).
//   2. `studio_retoucher_batiment` : « ajoute une lucarne », « décale le garage de 2 m », « un étage de plus »,
//      « toit en ardoise » → DIFFÉRENCES (appliquerRetouches) sur le DERNIER modèle de la conversation, relu dans
//      copilot_tool_calls (lecture bornée à l'utilisateur ET à la conversation) — jamais une reconstruction complète.
// Le bouton « Reproduire en 3D » envoie un message qui porte la description VIS-22 la plus proche (trajet VIS-22
// inchangé : forme et hauteur demandées au moteur, habillage) + la RÉFÉRENCE du modèle (empreinte) : la 3D préparée
// (studio.ts::preparer3D) en dit les écarts, et le rendu (studio.ts::ficheDepuisPreparation) emporte le modèle dans
// `studio_jobs.fiche.modele_batiment` : la machine de rendu construit le bâtiment À PARTIR DU MODÈLE.
// Module sans E/S directe (dépôt injecté) : testé par dessin-batiment.test.ts.
// =============================================================================

import type { OutilDef, ResultatOutil } from './types.ts';
import {
  appliquerRetouches, BORNES_MODELE, empreinteModele, LIBELLES_ELEMENT_MODELE, LIBELLES_OUVERTURE, LIBELLES_PLAN, resumerModele, validerModele,
  volumePrincipal, englobantLocal, type ModeleBatiment,
} from '../../../../src/lib/studio/modeleBatiment.ts';
import { EXEMPLE_MAISON_BASQUE } from '../../../../src/lib/studio/modeleBatimentExemples.ts';
import { MENTION_PHOTO } from '../../../../src/lib/studio/descriptionBatiment.ts';
import {
  avertissementsModele, MODELE_REF_LANGUE, OUTIL_DESSINER_BATIMENT, OUTIL_RETOUCHER_BATIMENT, OUTILS_MODELE, porteeModele, referenceModeleDuMessage,
  type ReferenceModele, type StatutsRendu,
} from '../../../../src/lib/studio/modeleBatimentMessage.ts';
import { CATALOGUE_EXTERIEUR } from '../../../../src/spaces/copilot/studio3d/catalogueExterieur.ts';
import { intentionDessinBatiment } from './description-batiment.ts';
import { modeleContraint as modeleContraintCommun } from '../../../../src/lib/studio/modeleBatimentFiche.ts';

export { OUTIL_DESSINER_BATIMENT, OUTIL_RETOUCHER_BATIMENT, OUTILS_MODELE, referenceModeleDuMessage };

/**
 * Interrupteur : vrai = le dessin COMPOSÉ remplace l'outil VIS-22 (studio_decrire_batiment) dans les consignes.
 * L'ancien outil reste servi pour les conversations passées (suite d'une ancienne carte VIS-22).
 */
export const DESSIN_MODELE_ACTIF = true;

const SOURCE = 'MimmozIA · Studio 3D';
const TOUS_MODES: OutilDef['available_in_modes'] = ['quick', 'advanced', 'report'];
/** Sorties d'outils relues pour retrouver le dernier modèle (plus récent d'abord). */
export const MODELES_RELUS = 20;

/** Références du catalogue extérieur (VIS-24) : une référence inconnue est retirée par la validation (couleur gardée). */
export const REFS_CATALOGUE: readonly string[] = CATALOGUE_EXTERIEUR.map((e) => e.refStudio).filter((r): r is string => typeof r === 'string' && /^(?:av|qm)-/.test(r));
/** Statut « dans les images » de chaque référence du catalogue (pastilles honnêtes des matières). */
export const STATUTS_CATALOGUE: StatutsRendu = Object.fromEntries(
  CATALOGUE_EXTERIEUR.filter((e) => typeof e.refStudio === 'string').map((e) => [e.refStudio as string, e.rendu]),
);

// ---- Définitions des outils ----------------------------------------------------

const GUIDE_FORMAT =
  'FORMAT `modele` (mètres ; repère du terrain vu de dessus : x vers la DROITE vu depuis la rue, y vers le FOND du terrain, z vers le haut) : ' +
  '{ nom, type (maison|collectif|autre), style (contemporain, basque, normand, haussmannien, art_deco, provencal, breton, landais, alsacien, savoyard, nord_brique, toulousain, meuliere, ou autre + styleLibre), ' +
  'matieres {murs, toiture, menuiseries, volets, soubassement, boiseries, garde_corps, sol : {refStudio (ex. av-enduit-blanc, av-brique-rouge, av-pierre-calcaire, av-bardage-bois-brun), couleur #rrggbb, famille (enduit, brique, pierre, beton, bois, metal, verre, tuile, ardoise, zinc, vegetal, autre)}}, ' +
  'volumes [{ id, nom, role (principal, aile, annexe, garage, tourelle, attique, autre), plan {type rectangle (largeur, profondeur) | L (largeur, profondeur, epaisseurX, epaisseurY, coinVide avant_gauche|avant_droit|arriere_gauche|arriere_droit) | polygone (points [[x,y]…]) | cercle (rayon) | arc (rayonExterieur, rayonInterieur, angleDebut, angleFin)}, ' +
  'position {x, y} (centre du plan), rotation (degrés), altitudeBase (0 = au sol ; sinon posé SUR un autre volume), niveaux (1 = rez-de-chaussée seul), hauteurEtage, soubassement, ' +
  'toit {forme plat|terrasse|un_pan|deux_pans|quatre_pans|mansart|conique|pyramide, pente, debord, faitage largeur|profondeur, basVers, acrotere, vegetalise, matiere}, matieres }], ' +
  'ouvertures [{ id, volume, facade (avant = côté rue, arriere, gauche, droite, ou numéro de côté), niveau (0 = rez-de-chaussée), type (fenetre, porte_fenetre, baie, porte, porte_garage, lucarne, oeil_de_boeuf), largeur, hauteur, allege, position (centre depuis la gauche de la façade vue de dehors ; absent = centré), nombre, entraxe, volets }], ' +
  'elements [{ id, type (balcon, loggia, garde_corps, auvent, pergola, veranda, porche, escalier_exterieur, cheminee, volets, tourelle, bow_window, colonnes, corniche, bandeau, colombages, autre), nom, volume, facade, niveau, position, point {x,y,z}, largeur, profondeur, hauteur, parametres, ' +
  'briques [{ forme boite|plaque|poteau|cylindre|cone|pyramide|prisme, x, y, z (centre du pied, repère du terrain), largeur, profondeur, hauteur, rotation, matiere }], matiere }], remarques }.';

export const OUTIL_DESSINER_BATIMENT_DEF: OutilDef = {
  name: OUTIL_DESSINER_BATIMENT,
  description:
    'DESSINER UN BÂTIMENT (ou n’importe quelle construction : phare, kiosque, chapelle, maison sur pilotis, tour, halle…) à partir de la ' +
    'description de l’utilisateur OU de la PHOTO jointe d’un bâtiment qui ressemble. Tu écris un MODÈLE COMPOSÉ : des volumes (autant qu’il faut), ' +
    'un toit par volume, des ouvertures par façade et par niveau, des matières, des éléments. Tout ce qui n’est pas un élément typé se COMPOSE ' +
    'avec des briques (élément « autre » avec un `nom` et des `briques`) : tu ne réponds JAMAIS qu’une forme n’est pas possible. ' +
    'Donne des dimensions plausibles (une maison : 9 à 14 m de large, 2,7 m par étage). PHOTO : référence de STYLE, pas un relevé — jamais « copie exacte », ' +
    'ne déduis ni adresse ni personnes. Le site valide et corrige (et le dit) puis affiche la carte « Votre bâtiment » avec UN bouton « Reproduire en 3D ». ' +
    'L’outil ne prépare aucune 3D et ne coûte rien. Pour MODIFIER un bâtiment déjà dessiné dans la conversation, utilise studio_retoucher_batiment (jamais celui-ci). ' +
    // VIS-26 lot D : demandes réelles qui appellent cet outil (rappel au modèle).
    'Demandes typiques : « dessine-moi une longère en pierre », « fais-moi un chalet en 3D », « je veux une maison comme ça » (+ photo), « reproduis ce bâtiment » (+ photo). ' +
    GUIDE_FORMAT + ` EXEMPLE (maison basque, garage accolé) : ${JSON.stringify(EXEMPLE_MAISON_BASQUE)}`,
  input_schema: {
    type: 'object',
    properties: {
      modele: { type: 'object', description: 'Le modèle composé du bâtiment (format ci-dessus). Champs absents : valeurs par défaut du site.' },
      origine: { type: 'string', enum: ['texte', 'photo'], description: '« photo » si le dessin s’inspire d’une image jointe.' },
    },
    required: ['modele'],
  },
  available_in_modes: TOUS_MODES,
};

export const OUTIL_RETOUCHER_BATIMENT_DEF: OutilDef = {
  name: OUTIL_RETOUCHER_BATIMENT,
  description:
    'RETOUCHER le DERNIER bâtiment dessiné dans la conversation, par DIFFÉRENCES (jamais en le redessinant) : « ajoute une lucarne », ' +
    '« décale le garage de 2 m vers la gauche », « un étage de plus », « toit en ardoise », « enlève la véranda ». Le serveur relit lui-même le dernier ' +
    'modèle de la conversation ; tu n’envoies QUE les retouches, avec les identifiants donnés dans la consigne (ou la dernière carte). ' +
    'Retouches (dans l’ordre) : {action:"ajouter", quoi:"volume"|"ouverture"|"element", objet:{…format du modèle…}} ; {action:"retirer", id} ; ' +
    '{action:"deplacer", id, dx, dy, dz (m, repère du terrain : x vers la droite vu de la rue, y vers le fond) | vers {x,y} | decalage (m le long de la façade, + = vers la droite vu de dehors) | position | facade | niveau | volume} ; ' +
    '{action:"modifier", id, champs:{…}} (ex. {niveaux: 3}, {toit:{forme:"quatre_pans"}}, {matieres:{toiture:{famille:"ardoise", couleur:"#3c4148"}}}) ; ' +
    '{action:"modifier_modele", champs:{nom, type, style, styleLibre, matieres, remarques}} (ex. matières de TOUT le bâtiment). ' +
    'Ce qui n’a pas de type se compose avec des briques (élément « autre »). Le site revalide tout et affiche la carte mise à jour.',
  input_schema: {
    type: 'object',
    properties: {
      retouches: {
        type: 'array', minItems: 1, maxItems: 12,
        items: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['ajouter', 'retirer', 'deplacer', 'modifier', 'modifier_modele'] },
            quoi: { type: 'string', enum: ['volume', 'ouverture', 'element'] },
            objet: { type: 'object' }, id: { type: 'string' }, champs: { type: 'object' },
            dx: { type: 'number' }, dy: { type: 'number' }, dz: { type: 'number' }, vers: { type: 'object' },
            decalage: { type: 'number' }, position: { type: 'number' }, niveau: { type: 'integer' }, volume: { type: 'string' },
            facade: { description: 'avant, arriere, gauche, droite, ou numéro de côté.' },
          },
          required: ['action'],
        },
      },
    },
    required: ['retouches'],
  },
  available_in_modes: TOUS_MODES,
};

// ---- Lecture du dernier modèle de la conversation --------------------------------

/** Sorties (`tool_output`) des outils du modèle dans la conversation, plus récentes d'abord. Erreur → []. */
export interface DepotModele {
  sortiesModele(userId: string, conversationId: string): Promise<unknown[]>;
}
/** Modèles produits PENDANT la requête en cours (pas encore écrits dans copilot_tool_calls). */
export interface MemoireTour { dernier: ModeleBatiment | null }

const estObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Modèle d'une sortie d'outil, revalidé en mode STRICT (une sortie abîmée ne sert jamais de base). */
export function modeleDeLaSortie(sortie: unknown): ModeleBatiment | null {
  if (!estObj(sortie) || sortie.status !== 'ok' || !estObj(sortie.data) || sortie.data.carte !== 'modele') return null;
  const v = validerModele(sortie.data.modele, { strict: true });
  return v.ok ? v.modele : null;
}

/** Dernier modèle de la conversation (requête en cours d'abord, puis copilot_tool_calls). null : aucun. */
export async function dernierModele(depot: DepotModele, userId: string | null, conversationId: string | null, memoire?: MemoireTour | null): Promise<ModeleBatiment | null> {
  if (memoire?.dernier) return memoire.dernier;
  if (!userId || !conversationId) return null;
  let sorties: unknown[] = [];
  try { sorties = await depot.sortiesModele(userId, conversationId); } catch { return null; }
  for (const s of sorties) { const m = modeleDeLaSortie(s); if (m) return m; }
  return null;
}

/** Modèle de la conversation dont l'empreinte est donnée (bouton « Reproduire en 3D », devis du rendu). */
export async function modeleParEmpreinte(depot: DepotModele, userId: string, conversationId: string, empreinte: string): Promise<ModeleBatiment | null> {
  let sorties: unknown[] = [];
  try { sorties = await depot.sortiesModele(userId, conversationId); } catch { return null; }
  for (const s of sorties) {
    const m = modeleDeLaSortie(s);
    if (m && empreinteModele(m) === empreinte) return m;
  }
  return null;
}

/** Lecture Supabase (service), bornée à l'utilisateur ET à la conversation ; le modèle est revalidé à la lecture. */
export function depotModeleSupabase(admin: { from(t: string): any }): DepotModele {
  return {
    async sortiesModele(userId, conversationId) {
      const { data, error } = await admin.from('copilot_tool_calls').select('tool_output')
        .eq('user_id', userId).eq('conversation_id', conversationId).in('tool_name', [...OUTILS_MODELE])
        .order('created_at', { ascending: false }).limit(MODELES_RELUS);
      if (error || !Array.isArray(data)) return [];
      return data.map((l: { tool_output?: unknown }) => l.tool_output);
    },
  };
}

// ---- Carte ---------------------------------------------------------------------

/** Données de la carte « Votre bâtiment » (modèle composé). */
export function donneesCarte(m: ModeleBatiment, corrections: readonly string[], avertissements: readonly string[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    carte: 'modele',
    empreinte: empreinteModele(m),
    resume: resumerModele(m),
    corrections: corrections.slice(0, 12),
    avertissements: avertissements.slice(0, 8),
    portee: porteeModele(m, STATUTS_CATALOGUE),
    ...(m.origine === 'photo' ? { mention_photo: MENTION_PHOTO } : {}),
    ...extra,
    // Le modèle EN DERNIER : un rappel tronqué des résultats garde d'abord le résumé.
    modele: m,
  };
}

/** Identifiants du modèle, pour que le modèle du chat retouche sans redessiner. */
export function sommaireIdentifiants(m: ModeleBatiment): string {
  const vols = m.volumes.map((v) => `${v.id} (${v.nom ?? v.role}, ${LIBELLES_PLAN[v.plan.type]}, ${v.niveaux} niv., centre ${v.position.x};${v.position.y})`);
  const ouv = m.ouvertures.map((o) => `${o.id} (${LIBELLES_OUVERTURE[o.type].toLowerCase()} ×${o.nombre}, ${o.volume}/${o.facade}/niv. ${o.niveau})`);
  const els = m.elements.map((e) => `${e.id} (${e.type === 'autre' ? e.nom ?? 'élément' : LIBELLES_ELEMENT_MODELE[e.type]}${e.volume ? `, ${e.volume}` : ''})`);
  return `Volumes : ${vols.join(' ; ')}. Ouvertures : ${ouv.join(' ; ') || 'aucune'}. Éléments : ${els.join(' ; ') || 'aucun'}.`.slice(0, 3000);
}

const MESSAGE_CARTE =
  'La carte « Votre bâtiment » est affichée sous ta réponse (aperçu en plan et en façade, liste, ce que le site a corrigé, ce qui ira dans les images). ' +
  'Réponds en DEUX phrases au plus, sans liste et sans recopier la carte : ce que tu as dessiné ; si `corrections` n’est pas vide, dis en quelques mots ce que le site a ajusté. ' +
  'Propose de retoucher en parlant (« ajoute une lucarne », « un étage de plus »…) ou de cliquer « Reproduire en 3D ». ' +
  'N’appelle NI studio_preparer_3d NI studio_lancer_rendu dans ce tour. Jamais « pas possible » pour une forme ; jamais « copie exacte ».';

// ---- Exécution -----------------------------------------------------------------

export interface EnvModele {
  userId: string | null;
  conversationId: string | null;
  /** Une photo est jointe à CE message : fait du tour, posé par le handler (jamais par le modèle). */
  photoAuTour: boolean;
  depot: DepotModele;
  memoire?: MemoireTour | null;
}

/** studio_dessiner_batiment : valide le modèle écrit par le modèle du chat (jamais de confiance) et renvoie la carte. */
export function executerOutilDessinerBatiment(input: Record<string, unknown>, env: Pick<EnvModele, 'photoAuTour' | 'memoire'>): ResultatOutil {
  const brut0 = estObj(input.modele) ? input.modele : estObj(input) && Array.isArray(input.volumes) ? input : null;
  if (!brut0) return { status: 'error', source: SOURCE, message: 'Aucun modèle lisible : rappelle l’outil avec `modele` (au moins un volume). Rien n’est affiché.' };
  // L'origine suit les FAITS du tour : une photo jointe fait foi ; « photo » sans photo reste possible (photo d'un message précédent).
  const photo = env.photoAuTour || input.origine === 'photo' || brut0.origine === 'photo';
  const brut = { ...brut0, origine: photo ? 'photo' : 'texte' };
  const v = validerModele(brut, { refsConnues: REFS_CATALOGUE });
  if (!v.ok) {
    return { status: 'error', source: SOURCE, message: `${'erreur' in v ? v.erreur : 'Modèle illisible.'} Rien n’est affiché. Rappelle l’outil avec un modèle lisible (au moins un volume avec un plan) ; ne dis pas à l’utilisateur que c’est impossible.` };
  }
  if (env.memoire) env.memoire.dernier = v.modele;
  return {
    status: 'ok', source: SOURCE,
    data: donneesCarte(v.modele, v.corrections, v.avertissements),
    message: MESSAGE_CARTE + (photo ? ` PHOTO — dis-le tel quel : « ${MENTION_PHOTO} »` : ''),
  };
}

/** studio_retoucher_batiment : différences appliquées au DERNIER modèle de la conversation (jamais une reconstruction). */
export async function executerOutilRetoucherBatiment(input: Record<string, unknown>, env: EnvModele): Promise<ResultatOutil> {
  const retouches = Array.isArray(input.retouches) ? input.retouches.slice(0, 12) : null;
  if (!retouches || retouches.length === 0) return { status: 'error', source: SOURCE, message: 'Aucune retouche lisible : rappelle l’outil avec `retouches` (au moins une).' };
  const base = await dernierModele(env.depot, env.userId, env.conversationId, env.memoire);
  if (!base) {
    return { status: 'not_found', source: SOURCE, message: 'Aucun bâtiment dessiné dans cette conversation : dessine-le d’abord avec studio_dessiner_batiment (en reprenant la demande de l’utilisateur), sans lui demander de recommencer.' };
  }
  const r = appliquerRetouches(base, retouches, { refsConnues: REFS_CATALOGUE });
  if (!r.ok) {
    return {
      status: 'error', source: SOURCE,
      message: `Retouche non appliquée : ${'erreur' in r ? r.erreur : ''} Le bâtiment n’a pas changé. Identifiants disponibles — ${sommaireIdentifiants(base)} ` +
        'Rappelle l’outil avec une retouche corrigée ; si la demande est ambiguë, pose UNE question courte. Jamais « pas possible » pour une forme : compose avec des briques.',
    };
  }
  if (env.memoire) env.memoire.dernier = r.modele;
  return {
    status: 'ok', source: SOURCE,
    data: donneesCarte(r.modele, r.corrections, r.avertissements, { fait: r.fait.slice(0, 12), retouche_de: empreinteModele(base) }),
    message: 'Retouche appliquée au bâtiment (le reste est inchangé) ; la carte « Votre bâtiment » mise à jour est affichée. ' +
      'Réponds en UNE ou DEUX phrases : ce qui a changé (d’après `fait`) et, si `corrections` n’est pas vide, ce que le site a ajusté. ' +
      'Le bouton « Reproduire en 3D » de la nouvelle carte envoie cette version. N’appelle NI studio_preparer_3d NI studio_lancer_rendu dans ce tour.',
  };
}

// ---- Détection (texte REÇU de l'utilisateur) -----------------------------------

const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’‘]/g, "'").toLowerCase();
/** « dessine-moi un phare », « modélise une chapelle », « fais-moi en 3D une maison sur pilotis » : dessin libre. */
const RE_DESSIN_LIBRE = /\b(?:dessin\w*|modelis\w*|esquiss\w*|croqu\w*)\b(?:[\s-]+(?:moi|nous))?[\s\S]{0,40}\b(?:un|une|des|le|la|ce|cette|mon|ma)\b/;
const RE_EN_3D = /\b(?:fais|faites|cree\w*|genere\w*|construi\w*)\b(?:[\s-]+(?:moi|nous))?[\s\S]{0,30}\ben 3\s?d\b/;
/** Ce qui ne se dessine pas : plan financier, bilan, rapport, graphique… */
const RE_PAS_UN_BATIMENT = /\b(?:bilan|graphique|tableau|rapport|courbe|schema financier|organigramme|logo)\b/;

/** L'utilisateur demande-t-il de DESSINER une construction (description, photo, ou dessin libre) ? */
export function intentionDessinModele(texte: string | null | undefined, photoJointe: boolean): boolean {
  if (typeof texte !== 'string' || !texte.trim()) return false;
  if (texte.includes('```' + MODELE_REF_LANGUE)) return false;
  if (intentionDessinBatiment(texte, photoJointe)) return true;
  const t = norm(texte);
  if (RE_PAS_UN_BATIMENT.test(t)) return false;
  return RE_DESSIN_LIBRE.test(t) || RE_EN_3D.test(t);
}

// VIS-26 lot D : « le garage plus large », « plus haut d’un niveau », « la tourelle plus haute » (plus|moins + dimension).
const RE_RETOUCHE_VERBE = /\b(?:ajout\w*|rajout\w*|retir\w*|enlev\w*|supprim\w*|decal\w*|deplac\w*|pouss\w*|recul\w*|avanc\w*|agrandi\w*|retreci\w*|elargi\w*|allong\w*|raccourci\w*|rehauss\w*|baiss\w*|remplac\w*|chang\w*|mets|mettez|met|passe[rz]?|transform\w*|tourn\w*|pivot\w*|plutot|monte[rz]?|descend\w*|(?:plus|moins)\s+(?:haut|bas|larg|long|profond|grand|petit|etroit|epais)\w*)\b/;
const RE_RETOUCHE_NIVEAUX = /\b(?:un|une|deux|trois|\d+)\s+(?:etages?|niveaux?)\s+de\s+(?:plus|moins)\b|\bde\s+(?:plus|moins)\b.*\b(?:etages?|niveaux?)\b/;
const RE_RETOUCHE_MATIERE = /\b(?:toit|toiture|facade|murs?|volets?|menuiseries?|soubassement)\s+(?:en|a|au|de couleur)\b|\ben\s+(?:ardoise|tuiles?|zinc|briques?|pierre|bois|enduit|beton)\b/;
const RE_RETOUCHE_OBJET = /\b(?:lucarnes?|fenetres?|portes?|baies?|balcons?|garage|veranda|pergola|cheminee|tourelle|volume|aile|etage|niveau|toit|toiture|facade|terrasse|auvent|porche|escalier|colonnes?|corniche|bandeau|colombages?|volets?|loggias?|garde-corps|ouvertures?|annexe|piscine|abri)\b/;
/** Un mot qui laisse la main à un autre parcours (extension d'une maison EXISTANTE). */
const RE_EXISTANT = /\b(?:ma maison|notre maison|maison existante|extension de ma|agrandir ma)\b/;

/** Ce message RETOUCHE-t-il le bâtiment dessiné (à n'utiliser que si un modèle existe dans la conversation) ? */
export function intentionRetoucheModele(texte: string | null | undefined): boolean {
  if (typeof texte !== 'string' || !texte.trim() || texte.includes('```')) return false;
  const t = norm(texte);
  if (RE_EXISTANT.test(t)) return false;
  if (RE_RETOUCHE_NIVEAUX.test(t) || RE_RETOUCHE_MATIERE.test(t)) return true;
  return RE_RETOUCHE_VERBE.test(t) && RE_RETOUCHE_OBJET.test(t);
}

/** Un NOUVEAU bâtiment est demandé (« dessine-moi plutôt un autre bâtiment ») : dessin, pas retouche. */
export function nouveauDessinDemande(texte: string | null | undefined): boolean {
  if (typeof texte !== 'string') return false;
  return /\b(?:autre|nouveau|nouvelle|recommence\w*|repars?|de zero|completement different\w*)\b/.test(norm(texte));
}

// ---- Consignes (index.ts) -------------------------------------------------------

/** Consigne ajoutée au système quand le tour demande de dessiner. */
export function consigneDessinModele(photoAuTour: boolean): string {
  return 'DESSINER (modèle composé) : l’utilisateur ' + (photoAuTour ? 'joint la photo d’un bâtiment qui ressemble à ce qu’il veut (ou le décrit)' : 'décrit ce qu’il veut construire') +
    `. Appelle MAINTENANT ${OUTIL_DESSINER_BATIMENT} avec un \`modele\` complet : volumes (plan, position, niveaux, toit), ouvertures façade par façade, matières, éléments. ` +
    'Tout ce qui n’est pas un élément typé se compose avec des BRIQUES (élément « autre » avec un nom) : ne réponds JAMAIS que ce n’est pas possible, ne propose pas une forme plus simple à la place. ' +
    (photoAuTour ? 'La photo est une RÉFÉRENCE DE STYLE, pas un relevé : jamais « copie exacte », ne déduis ni adresse ni personnes. ' : '') +
    'Ne pose pas de question avant l’outil (l’utilisateur retouchera en parlant) ; ne prépare aucune 3D et ne lance aucun rendu dans ce tour.';
}

/** Consigne ajoutée au système quand le tour RETOUCHE le dernier bâtiment dessiné. */
export function consigneRetoucheModele(m: ModeleBatiment): string {
  return `RETOUCHE DU BÂTIMENT DESSINÉ : l’utilisateur modifie le dernier bâtiment de la conversation. Appelle MAINTENANT ${OUTIL_RETOUCHER_BATIMENT} ` +
    'avec SEULEMENT les différences (jamais le bâtiment entier, jamais studio_dessiner_batiment). Repère : x vers la droite vu de la rue, y vers le fond. ' +
    `« Un étage de plus » = modifier {niveaux: n+1} sur chaque volume concerné (en général le principal). Identifiants — ${sommaireIdentifiants(m)}`;
}

/** Consigne ajoutée au système quand le message porte la référence du bouton « Reproduire en 3D ». */
export function consigneModeleCarte(ref: ReferenceModele | null, trouve: boolean | null): string {
  if (!ref) return '';
  if (!ref.ok || trouve === false) {
    return 'BÂTIMENT À REPRODUIRE : la référence du bâtiment dessiné est introuvable dans cette conversation. Dis-le simplement et propose de le redessiner ; ne devine rien.';
  }
  return 'BÂTIMENT DESSINÉ À REPRODUIRE EN 3D (carte « Votre bâtiment », dernier message de l’utilisateur) : appelle MAINTENANT studio_preparer_3d (sans `forme` : le serveur lit lui-même ' +
    'le bâtiment dans le message ; le moteur garde la main sur ce que le terrain et le PLU permettent). Ensuite, réponds court : ce qui a été retenu, les écarts renvoyés par l’outil TELS QUELS ' +
    '(`batiment_decrit.ecarts` et `batiment_decrit.modele.ecarts`), et que le bâtiment dessiné sera construit tel quel dans le Studio et dans les images (sauf ce que l’outil dit). ' +
    'L’habillage est enregistré : ne le redemande pas ; n’appelle pas studio_lancer_rendu (sauf si ce même message demande un rendu). Jamais « conforme », jamais « copie exacte ». ' +
    'Si l’outil répond qu’aucune conception n’existe, dis que le dessin est gardé dans la conversation et qu’il faut d’abord choisir le terrain et le programme (étapes 1 et 2) — sans proposer d’autre page.';
}

/**
 * VIS-34 — consigne ajoutée au système quand le message REÇU répond à la question de portée (« Ce dessin remplace tout le
 * projet » / « Il remplace un seul bâtiment ») : la 3D est préparée à nouveau avec cette portée, qui est enregistrée.
 */
export function consignePorteeDessin(portee: 'projet' | 'batiment' | null | undefined): string {
  if (portee !== 'projet' && portee !== 'batiment') return '';
  return `PORTÉE DU DESSIN choisie par l’utilisateur (dernier message) : ${portee === 'batiment' ? 'le dessin remplace UN SEUL bâtiment du projet préparé, les autres sont gardés' : 'le dessin remplace TOUT le projet préparé'}. ` +
    'Appelle MAINTENANT studio_preparer_3d SANS aucun paramètre (le serveur relit lui-même le dessin et ce choix, et les enregistre). ' +
    'Ensuite, confirme en UNE ou DEUX phrases ce que le projet contient désormais (d’après `projet_en_vigueur`), sans reposer la question et sans bloc de choix. ' +
    'Si l’outil ne renvoie pas `projet_en_vigueur`, dis simplement qu’aucun bâtiment dessiné n’est en cours dans cette conversation. N’appelle pas studio_lancer_rendu.';
}

// ---- Écarts entre le dessin et la 3D préparée -------------------------------------

const fr = (x: number): string => String(Math.round(x * 10) / 10).replace('.', ',');
const lib = (n: number): string => (n <= 1 ? 'rez-de-chaussée seul' : `R+${n - 1}`);

/**
 * VIS-26 lot D — ce que la 3D préparée reprend du dessin : plan du volume principal (rectangle englobant, x = façade sur rue,
 * y = profondeur) et hauteur (niveaux du plus haut volume posé au sol, ou de l'attique). Le moteur plafonne (studio.ts).
 */
export function dimensionsDessin(m: ModeleBatiment): { largeurM: number; profondeurM: number; niveaux: number } {
  const p = volumePrincipal(m);
  const e = englobantLocal(p.plan);
  const niveaux = Math.max(...m.volumes.filter((x) => x.altitudeBase === 0 || x.role === 'attique').map((x) => x.niveaux), p.niveaux);
  return { largeurM: e.maxX - e.minX, profondeurM: e.maxY - e.minY, niveaux };
}

/** Volume préparé (sous-ensemble lu). */
export interface VolumePrepareLu { niveaux?: number | null; emprise?: { largeurM?: number; profondeurM?: number } | null; batiments?: unknown[] | null }

/**
 * Écarts honnêtes entre le bâtiment dessiné et la 3D préparée par le moteur (qui garde la main : terrain, PLU, gabarit).
 * La 3D préparée est un volume d'étude ; le Studio et les images partent du DESSIN, posé sur ce terrain.
 */
export function ecartsModeleVolume(m: ModeleBatiment, v: VolumePrepareLu | null, portee: 'projet' | 'batiment' = 'projet'): string[] {
  if (!v) return [];
  const out: string[] = [];
  const p = volumePrincipal(m);
  const e = englobantLocal(p.plan);
  const largeur = e.maxX - e.minX; const profondeur = e.maxY - e.minY;
  const niveauxDessin = Math.max(...m.volumes.filter((x) => x.altitudeBase === 0 || x.role === 'attique').map((x) => x.niveaux), p.niveaux);
  if (typeof v.niveaux === 'number' && v.niveaux > 0 && v.niveaux < niveauxDessin) {
    out.push(`Hauteur : le dessin monte à ${lib(niveauxDessin)} ; sur ce terrain, la 3D préparée est limitée à ${lib(v.niveaux)} (règles et gabarit) — le bâtiment construit pour les images est ramené à cette hauteur.`);
  }
  const em = v.emprise;
  // VIS-26 lot D : la 3D préparée SUIT le plan du volume principal (rectangle englobant, plafonné par le moteur) ; un
  // écart restant est dit : plafond du terrain (plus grand) ou côté minimal / forme imposée (plus petit).
  const plan = p.plan.type === 'rectangle' ? '' : ' (rectangle englobant)';
  if (em && typeof em.largeurM === 'number' && typeof em.profondeurM === 'number') {
    const [a, b] = [Math.max(largeur, profondeur), Math.min(largeur, profondeur)];
    const [c, d] = [Math.max(em.largeurM, em.profondeurM), Math.min(em.largeurM, em.profondeurM)];
    if (a > c + 0.5 || b > d + 0.5) {
      out.push(`Emprise : le volume principal dessiné fait ${fr(largeur)} × ${fr(profondeur)} m${plan} ; la 3D préparée est ramenée à ${fr(em.largeurM)} × ${fr(em.profondeurM)} m, le maximum retenu par le moteur sur ce terrain — dans le Studio et les images, le dessin est posé à ses dimensions : à vérifier.`);
    } else if (a < c - 0.5 || b < d - 0.5) {
      out.push(`Emprise : le volume principal dessiné fait ${fr(largeur)} × ${fr(profondeur)} m${plan} ; la 3D préparée fait ${fr(em.largeurM)} × ${fr(em.profondeurM)} m (côté minimal du moteur ou forme retenue) — dans le Studio et les images, c’est le dessin qui est gardé.`);
    }
  }
  if (Array.isArray(v.batiments) && v.batiments.length > 1) {
    // VIS-34 : la PORTÉE dit ce que le dessin remplace (plus d'heuristique « seul l'habillage est appliqué »).
    out.push(portee === 'batiment'
      ? `Le projet préparé compte ${v.batiments.length} bâtiments : le dessin en remplace UN seul (votre choix) ; les autres sont gardés tels que le moteur les a placés.`
      : `Le moteur n’a pas pu ramener le projet à un seul bâtiment sur ce terrain (${v.batiments.length} bâtiments préparés) : dans le Studio et les images, le dessin remplace quand même TOUT le projet.`);
  }
  if (m.volumes.length > 1 || m.elements.length > 0) {
    out.push(`La 3D préparée du chat reprend le plan et la hauteur du volume principal${plan} ; elle reste un volume d’étude simple : ${m.volumes.length > 1 ? 'les autres volumes, ' : ''}les toits, les ouvertures et les éléments du dessin sont construits dans le Studio et dans les images.`);
  }
  return out;
}

/**
 * Le dessin CONTRAINT par la 3D préparée : jamais plus haut que ce que le moteur retient sur ce terrain (règles, gabarit).
 * VIS-26 lot D : la règle vit dans src/lib/studio/modeleBatimentFiche.ts, partagée avec l'Espace 3D du site (aperçu et
 * images lancés depuis FilmVisitePanel) — même résultat qu'avant, mêmes notes.
 */
export function modeleContraint(m: ModeleBatiment, niveauxMax: number | null | undefined): { modele: ModeleBatiment; notes: string[] } {
  return modeleContraintCommun(m, niveauxMax, REFS_CATALOGUE);
}

/** Avertissements du devis du rendu pour un modèle (repris tels quels par Mimmo). */
export function reservesModele(m: ModeleBatiment): string[] {
  return avertissementsModele(m, STATUTS_CATALOGUE);
}

/** Borne utile aux tests (plafond du contrat). */
export const BRIQUES_MAX = BORNES_MODELE.briquesMax;
