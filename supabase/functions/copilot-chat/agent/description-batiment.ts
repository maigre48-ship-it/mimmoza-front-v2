// supabase/functions/copilot-chat/agent/description-batiment.ts
// =============================================================================
// VIS-22 — « Dessiner le bâtiment » depuis le chat principal de MimmozIA.
//
// Deux entrées, UN contrat (src/lib/studio/descriptionBatiment.ts) :
//   1. l'utilisateur décrit son bâtiment en langage naturel ;
//   2. l'utilisateur joint la photo d'un bâtiment qui ressemble (le modèle du chat voit l'image : c'est lui le
//      « modèle de vision ») — référence de STYLE, jamais un relevé ni une copie.
// Le modèle PROPOSE la description en appelant l'outil `studio_decrire_batiment` ; ce module la VALIDE sans confiance
// (listes fermées, bornes, cohérences), dit ce qui a été corrigé et ce qui n'est pas encore reproduit, et renvoie la
// description validée : le chat affiche la carte « Votre bâtiment » (modifiable, UN bouton « Reproduire en 3D »).
// Le bouton envoie un message avec un bloc ```mimmoza-batiment``` (+ le bloc d'habillage) : relu ICI dans le message
// REÇU (jamais dans les paramètres du modèle), il fait préparer la 3D avec la forme et la hauteur demandées
// (studio.ts::preparer3D) et habille les rendus (studio.ts::ficheDepuisPreparation).
// Module PUR (aucune E/S) : testé par description-batiment.test.ts.
// =============================================================================

import type { OutilDef, ResultatOutil } from './types.ts';
import {
  BALCONS_BATIMENT, bilanRendu, BORNES_DESCRIPTION, COTES, COULEURS_BOIS, COUVERTURES, DESCRIPTION_BLOC_LANGUE, descriptionDuMessage, ELEMENTS,
  FACADES_BATIMENT, FORMES_BATIMENT, FORMES_TOIT, GARDE_CORPS_BATIMENT, MENTION_PHOTO, MENUISERIES_BATIMENT, nonReproduits, OUTIL_DECRIRE_BATIMENT,
  OUVERTURES_BATIMENT, phraseDescription, RDC_BATIMENT, SOUBASSEMENTS_BATIMENT, STYLES_BATIMENT, TEINTES_BATIMENT, TETE_REPRODUIRE, TYPES_BATIMENT,
  validerDescription, VOLETS, type ValidationDescription,
} from '../../../../src/lib/studio/descriptionBatiment.ts';

export { descriptionDuMessage, OUTIL_DECRIRE_BATIMENT };

const SOURCE = 'MimmozIA · Studio 3D';
const TOUS_MODES: OutilDef['available_in_modes'] = ['quick', 'advanced', 'report'];

export const OUTIL_DECRIRE_BATIMENT_DEF: OutilDef = {
  name: OUTIL_DECRIRE_BATIMENT,
  description:
    "DESSINER LE BÂTIMENT : transforme la description que l'utilisateur fait de son bâtiment (texte), ou la PHOTO jointe d'un " +
    "bâtiment qui ressemble, en une description STRUCTURÉE que le site reproduit en 3D. À appeler dès que l'utilisateur décrit " +
    "l'allure du bâtiment qu'il veut (« une maison basque R+1, toit deux pans en tuiles, colombages rouges… », « un petit collectif " +
    "R+2 en L, toiture-terrasse, loggias, bardage bois ») ou demande un bâtiment « comme sur la photo ». Ne remplis QUE ce qui est " +
    "dit ou visible : un champ absent prend la valeur proposée par le site ; liste dans `incertains` ce que tu as dû estimer. " +
    "PHOTO : c'est une référence de STYLE, pas un relevé — ne promets jamais une copie exacte, ne déduis ni dimensions, ni adresse, " +
    "ni surface, ne décris pas les personnes. L'outil ne prépare RIEN et ne coûte rien : il affiche la carte « Votre bâtiment » " +
    "où l'utilisateur corrige chaque point puis clique « Reproduire en 3D ». Après l'outil : deux phrases au plus (ce que tu as " +
    "compris, ce qui n'est pas encore reproduit d'après `pas_encore_reproduit`), sans recopier la carte, sans appeler " +
    "studio_preparer_3d ni studio_lancer_rendu dans ce tour.",
  input_schema: {
    type: 'object',
    properties: {
      origine: { type: 'string', enum: ['texte', 'photo'], description: '« photo » si la description vient d’une image jointe, « texte » sinon.' },
      type: { type: 'string', enum: [...TYPES_BATIMENT] },
      forme: { type: 'string', enum: [...FORMES_BATIMENT], description: 'Forme en plan, seulement si elle est dite ou visible (plot = compact, barre = allongé). Sinon omettre : le moteur choisit.' },
      niveaux: { type: 'integer', minimum: BORNES_DESCRIPTION.niveauxMin, maximum: BORNES_DESCRIPTION.niveauxMax, description: 'Niveaux hors sol, rez-de-chaussée COMPRIS : plain-pied = 1, R+1 = 2, R+2 = 3. Omettre si non dit.' },
      style: { type: 'string', enum: [...STYLES_BATIMENT], description: 'Seuls contemporain, basque et normand sont reproduits aujourd’hui ; les autres sont notés et dits.' },
      toiture: {
        type: 'object',
        properties: {
          forme: { type: 'string', enum: [...FORMES_TOIT] },
          couverture: { type: 'string', enum: [...COUVERTURES], description: 'Seulement pour un toit en pente.' },
        },
      },
      facade: {
        type: 'object',
        properties: {
          materiau: { type: 'string', enum: [...FACADES_BATIMENT], description: 'Matière dominante de la façade (la plus proche).' },
          teinte: { type: 'string', enum: [...TEINTES_BATIMENT], description: 'claire : brique claire ou béton blanc ; foncee : bardage bois noirci ; sinon naturelle.' },
          couleur: { type: 'string', description: 'Couleur dite ou vue, #rrggbb (indicative).' },
        },
      },
      ouvertures: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: [...OUVERTURES_BATIMENT] },
          menuiseries: { type: 'string', enum: [...MENUISERIES_BATIMENT] },
          volets: { type: 'string', enum: [...VOLETS] },
          couleurVolets: { type: 'string', enum: [...COULEURS_BOIS] },
        },
      },
      balcons: {
        type: 'object',
        properties: { type: { type: 'string', enum: [...BALCONS_BATIMENT] }, gardeCorps: { type: 'string', enum: [...GARDE_CORPS_BATIMENT] } },
      },
      attique: { type: 'boolean', description: 'Dernier étage en retrait (jamais avec un toit en pente).' },
      rdc: { type: 'string', enum: [...RDC_BATIMENT] },
      soubassement: { type: 'string', enum: [...SOUBASSEMENTS_BATIMENT] },
      elements: {
        type: 'array', maxItems: BORNES_DESCRIPTION.elementsMax,
        description: 'Éléments remarquables dits ou visibles (colombages, lucarnes, cheminée, garage accolé, véranda…).',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: [...ELEMENTS] },
            couleur: { type: 'string', enum: [...COULEURS_BOIS] },
            cote: { type: 'string', enum: [...COTES], description: 'Côté vu depuis la rue.' },
            precision: { type: 'string', description: `${BORNES_DESCRIPTION.precisionMax} caractères au plus ; obligatoire pour « autre ».` },
          },
          required: ['type'],
        },
      },
      remarques: { type: 'string', description: `Autre souhait en clair, ${BORNES_DESCRIPTION.remarquesMax} caractères au plus (informatif).` },
      incertains: { type: 'array', items: { type: 'string' }, description: 'Champs estimés sans certitude (type, forme, niveaux, style, toiture, facade, ouvertures, menuiseries, volets, balcons, garde_corps, attique, rdc, soubassement, elements).' },
    },
  },
  available_in_modes: TOUS_MODES,
};

export interface EnvDescription {
  /** Une photo (JPEG / PNG) est jointe à CE message : posé par le handler, jamais par le modèle. */
  photoAuTour: boolean;
}

/** Exécute l'outil : valide la proposition du modèle (jamais de confiance) et renvoie la carte « Votre bâtiment ». */
export function executerOutilDecrireBatiment(input: Record<string, unknown>, env: EnvDescription): ResultatOutil {
  // L'origine suit les FAITS du tour : une photo jointe à ce message fait foi ; « photo » sans photo jointe reste
  // possible (photo d'un message précédent de la conversation, que le modèle voit encore).
  const brut = { ...input, origine: env.photoAuTour ? 'photo' : input.origine === 'photo' ? 'photo' : 'texte' };
  const v = validerDescription(brut, false);
  if (!v.ok) {
    return { status: 'error', source: SOURCE, message: `${v.erreur} Rien n’est affiché. Rappelle l’outil avec une description lisible, ou demande à l’utilisateur de préciser.` };
  }
  const d = v.valeur;
  const non = nonReproduits(d);
  const photo = d.origine === 'photo';
  return {
    status: 'ok', source: SOURCE,
    data: {
      carte: 'batiment',
      description: d,
      resume: phraseDescription(d),
      bilan: bilanRendu(d),
      corrections: v.corrections,
      pas_encore_reproduit: non,
      a_verifier: d.incertains,
      ...(photo ? { mention_photo: MENTION_PHOTO } : {}),
    },
    message:
      'La carte « Votre bâtiment » est affichée sous ta réponse : l’utilisateur y corrige chaque point puis clique « Reproduire en 3D » ' +
      '(c’est ce bouton, et lui seul, qui prépare la 3D). Réponds en DEUX phrases au plus, sans liste et sans recopier la carte : ce que tu as compris' +
      (non.length ? ` ; dis simplement que ceci n’est pas encore reproduit en 3D : ${non.join(' ; ')}` : '') +
      (v.corrections.length ? ` ; signale en quelques mots ce que le site a dû ajuster (${v.corrections.slice(0, 3).join(' ; ')})` : '') +
      (photo ? `. PHOTO — dis-le tel quel : « ${MENTION_PHOTO} »` : '') +
      '. N’appelle NI studio_preparer_3d NI studio_lancer_rendu dans ce tour ; ne pose aucune question d’habillage ; jamais « copie exacte », « identique » ou « fidèle à la photo ».',
  };
}

// ---- Détection (texte REÇU de l'utilisateur) -----------------------------------

const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’‘]/g, "'").toLowerCase();
const RE_VERBE = /\b(?:dessin\w*|reprodui\w*|modelis\w*|imagin\w*|concoi\w*|represent\w*|fais|faire|faites|cree\w*|genere\w*|construi\w*|je (?:veux|voudrais|souhaite)|j'aimerais|il me faut)\b/;
const RE_NOM = /\b(?:batiments?|immeubles?|maisons?|collectifs?|residences?|villas?|pavillons?|chalets?|longeres?|facades?)\b/;
const DESCRIPTEURS: readonly RegExp[] = [
  /\btoit(?:ure)?s?\b/, /\btuiles?\b/, /\bardoises?\b/, /\bzinc\b/, /\bcolombages?\b/, /\bbardage\b/, /\benduit\b/, /\bbriques?\b/, /\bpierres?\b/,
  /\bbalcons?\b/, /\bloggias?\b/, /\bvolets?\b/, /\br\s*\+\s*\d/, /\b(?:etages?|niveaux|plain[- ]pied)\b/, /\bstyle\b/, /\b(?:basque|normande?|haussmannien\w*|provencale?|bretonne?|alsacienne?|art deco)\b/,
  /\blucarnes?\b/, /\bgarage\b/, /\bbaies?\b/, /\b(?:deux|quatre|2|4) pans\b/, /\b(?:en l|en u|plot|barre)\b/, /\bmenuiseries?\b/, /\battique\b/, /\bbeton\b/, /\bverre\b/,
];
const RE_RESSEMBLE = /\b(?:ressembl\w*|inspir\w*|similaire|pareil(?:le)?|meme style|(?:dans|de) (?:le|ce) style|comme (?:ca|ceci|cela|celui|celle|sur|cette|la photo|l'image)|reprodui\w*|a l'image de)\b/;

/**
 * L'utilisateur demande-t-il de DESSINER un bâtiment (description de son allure, ou photo d'un bâtiment qui ressemble) ?
 * Volontairement prudent : il faut un bâtiment ET une vraie description (au moins deux traits d'architecture avec un
 * verbe de demande, trois sans), ou une photo jointe avec « qui ressemble / comme ça / dans ce style ». Le message du
 * bouton « Reproduire en 3D » (bloc) n'en est pas une : il est traité par `consigneBatimentCarte`.
 */
export function intentionDessinBatiment(texte: string | null | undefined, photoJointe: boolean): boolean {
  if (typeof texte !== 'string' || !texte.trim()) return false;
  if (texte.includes('```' + DESCRIPTION_BLOC_LANGUE)) return false;
  const t = norm(texte);
  const nom = RE_NOM.test(t);
  const traits = DESCRIPTEURS.filter((r) => r.test(t)).length;
  if (photoJointe && RE_RESSEMBLE.test(t) && (nom || /\b(?:photo|image)\b/.test(t) || traits >= 1)) return true;
  if (photoJointe && nom && RE_VERBE.test(t) && /\b(?:photo|image)\b/.test(t)) return true;
  if (!nom) return false;
  return RE_VERBE.test(t) ? traits >= 2 : traits >= 3;
}

/**
 * La description d'un bâtiment ENTIER cite un garage accolé ou une véranda (« maison basque R+1…, garage accolé à gauche ») :
 * ce n'est pas une demande d'extension. Vrai seulement si le message est une demande de dessin ET ne parle ni d'agrandir,
 * ni d'extension, ni de surélévation, ni d'ajouter une pièce (ces mots laissent la main au parcours d'extension).
 */
export function dessinPlutotQuExtension(texte: string | null | undefined, photoJointe: boolean): boolean {
  if (!intentionDessinBatiment(texte, photoJointe)) return false;
  const t = norm(texte ?? '');
  if (/\b(?:agrandi\w*|extension|surelev\w*|rehauss\w*|ajout\w*|existante?|ma maison|notre maison)\b/.test(t)) return false;
  // Sans photo : il faut une vraie description (au moins trois traits) ; avec photo : la demande « qui ressemble » suffit.
  return photoJointe ? RE_RESSEMBLE.test(t) : DESCRIPTEURS.filter((r) => r.test(t)).length >= 3;
}

/** La réponse précédente de Mimmo présentait la carte « Votre bâtiment » : l'outil reste proposé (« plutôt en ardoise »). */
export function suiteDuDessin(texteAssistant: string | null | undefined): boolean {
  return typeof texteAssistant === 'string' && /Reproduire en 3D|Votre b[âa]timent/.test(texteAssistant);
}

/** Consigne ajoutée au système quand le tour demande de dessiner un bâtiment (index.ts). */
export function consigneDessinBatiment(photoAuTour: boolean): string {
  return 'DESSINER LE BÂTIMENT : l’utilisateur ' + (photoAuTour ? 'joint la photo d’un bâtiment qui ressemble à ce qu’il veut (ou le décrit)' : 'décrit l’allure du bâtiment qu’il veut') +
    `. Appelle MAINTENANT ${OUTIL_DECRIRE_BATIMENT} avec ce que tu as compris, champ par champ ; ne remplis que ce qui est dit ou visible, ` +
    'liste dans `incertains` ce que tu as estimé. Niveaux : rez-de-chaussée compris (R+1 = 2). ' +
    (photoAuTour ? 'La photo est une RÉFÉRENCE DE STYLE, pas un relevé : ne promets jamais une copie exacte, ne déduis ni dimensions ni adresse, ne décris pas les personnes. ' : '') +
    'Ne pose pas de questions avant l’outil (l’utilisateur corrigera dans la carte) ; ne prépare aucune 3D et ne lance aucun rendu dans ce tour.';
}

/** Consigne ajoutée au système quand le message porte le bloc du bouton « Reproduire en 3D » (index.ts). */
export function consigneBatimentCarte(c: ValidationDescription | null): string {
  if (!c) return '';
  if (!c.ok) {
    return `BÂTIMENT À REPRODUIRE : le dernier message contient une description REFUSÉE par le serveur (${c.erreur}). ` +
      'Dis-le simplement et propose de décrire à nouveau le bâtiment ; ne devine aucune valeur.';
  }
  return `BÂTIMENT À REPRODUIRE EN 3D (carte « Votre bâtiment », dernier message de l’utilisateur) : ${phraseDescription(c.valeur)}. ` +
    'Appelle MAINTENANT studio_preparer_3d (sans `forme` : le serveur lit lui-même la forme, la hauteur et l’habillage dans le message ; le moteur garde la main sur ce que le terrain permet). ' +
    'L’habillage est ENREGISTRÉ pour les prochains rendus : ne le redemande pas, n’appelle pas studio_lancer_rendu (sauf si ce même message demande un rendu). ' +
    'Ensuite, réponds court : ce qui a été retenu, les écarts renvoyés par l’outil tels quels, ce qui n’est pas encore reproduit ; ' +
    'jamais « conforme », jamais « copie exacte ». Si l’outil répond qu’aucune conception n’existe pour ce terrain, dis que la description est ' +
    'gardée dans la conversation et qu’il faut d’abord choisir le terrain et le programme (étapes 1 et 2 du parcours) — sans proposer d’autre page.' +
    (c.valeur.origine === 'photo' ? ` Rappelle en une phrase : « ${MENTION_PHOTO} »` : '');
}

/** Le message du bouton « Reproduire en 3D » doit faire proposer les outils du Studio au tour (index.ts). */
export function messageReproduireEn3D(texte: string | null | undefined): boolean {
  return typeof texte === 'string' && (texte.includes('```' + DESCRIPTION_BLOC_LANGUE) || texte.trimStart().startsWith(TETE_REPRODUIRE));
}
