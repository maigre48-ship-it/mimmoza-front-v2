// src/spaces/copilot/pieces-jointes/piecesJointesLogique.ts
// =============================================================
// V1.8 — Pièces jointes du chat MimmozIA : logique PURE (testée par
// piecesJointesLogique.test.ts, sans navigateur ni réseau).
//
// Deux voies d'envoi :
//   · « inline » (héritage V1.7) : petite IMAGE (≤ 3 Mo) encodée en base64 dans
//     la requête — inchangé, et toujours utilisé par la préparation 3D ;
//   · « stockage » : PDF (toute taille ≤ 50 Mo) et image de 3 à 5 Mo, TÉLÉVERSÉS
//     dans le bucket privé `copilot-pieces-jointes` ; la requête ne porte qu'une
//     référence. Pour un PDF, le texte extrait page par page (pdf.js, dans le
//     navigateur) est déposé à côté : le serveur lit alors seulement les pages
//     utiles d'un gros document (règlement de PLU : chapitre de la zone).
// Les plafonds et le chemin sont revérifiés côté serveur
// (supabase/functions/_shared/documents/piecesJointes.ts) et par la RLS du bucket.
// =============================================================

export const BUCKET_PIECES_JOINTES = 'copilot-pieces-jointes';
export const ACCEPT_FILES = 'image/png,image/jpeg,image/gif,image/webp,application/pdf';
export const TYPES_IMAGE = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/**
 * Plafond UNIQUE côté front (chat ET règlement de la mission conception) :
 * 50 Mo = maximum de Supabase Storage sur le plan Free (« For Free projects, the
 * limit can't exceed 50 MB »). Égal à la constante du serveur
 * (supabase/functions/_shared/documents/piecesJointes.ts) et au plafond des buckets.
 * Au-delà de 6 Mo, l'envoi passe en upload reprenable (televersementTus.ts).
 */
export const TAILLE_MAX_PIECE_JOINTE = 50 * 1024 * 1024;

/**
 * Avertissement affiché au moment de joindre un fichier (chat, drawer, mission
 * conception). Décision d'Albé : le coût suit le poids du document, on le dit
 * simplement ; l'estimation reste affichée sur la pièce jointe avant l'envoi.
 */
export const AVERTISSEMENT_TAILLE =
  'Plus le document est lourd, plus sa lecture consomme de jetons. Pour un règlement de PLU, seules les pages ' +
  'de votre zone sont lues ; l’estimation s’affiche sur la pièce jointe et seul le coût réel est débité.';

/** Au-delà, le texte extrait n'est plus envoyé page par page (limite du serveur). */
export const MAX_PAGES_TEXTE = 2000;
/** Limite de l'API Anthropic pour une image. */
export const TAILLE_MAX_IMAGE = 5 * 1024 * 1024;
/** Voie base64 (héritage) : par fichier, et cumulée (le base64 gonfle de ~33 %). */
export const TAILLE_MAX_INLINE = 3 * 1024 * 1024;
export const TOTAL_MAX_INLINE = 4 * 1024 * 1024;
export const MAX_PIECES = 5;

export type ModeEnvoi = 'inline' | 'stockage';

const mo = (o: number) => `${Math.round(o / 1048576)} Mo`;

/** Comment envoyer ce fichier — ou pourquoi le refuser (message pour l'utilisateur). */
export function modeEnvoi(f: { name: string; type: string; size: number }): { ok: true; mode: ModeEnvoi } | { ok: false; erreur: string } {
  if (f.type === 'application/pdf') {
    if (f.size > TAILLE_MAX_PIECE_JOINTE) {
      return { ok: false, erreur: `« ${f.name} » dépasse ${mo(TAILLE_MAX_PIECE_JOINTE)} : joignez seulement les pages utiles (pour un règlement de PLU : dispositions générales et chapitre de votre zone).` };
    }
    return { ok: true, mode: 'stockage' };
  }
  if (TYPES_IMAGE.includes(f.type)) {
    if (f.size <= TAILLE_MAX_INLINE) return { ok: true, mode: 'inline' };
    if (f.size <= TAILLE_MAX_IMAGE) return { ok: true, mode: 'stockage' };
    return { ok: false, erreur: `« ${f.name} » dépasse ${mo(TAILLE_MAX_IMAGE)} (limite des images) : réduisez-la ou exportez-la en PDF.` };
  }
  return { ok: false, erreur: `« ${f.name} » : format non pris en charge (images PNG, JPEG, GIF, WebP ou PDF).` };
}

/** Nom de fichier sûr pour le Storage : minuscules, sans accents, [a-z0-9._-], extension gardée. */
export function nomFichierStockage(nom: string, type: string): string {
  const ext = type === 'application/pdf' ? 'pdf' : type === 'image/jpeg' ? 'jpg' : type.split('/')[1] ?? 'bin';
  const base = nom.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/, '')
    .replace(/[^a-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, 100) || 'piece-jointe';
  return `${base}.${ext}`;
}

export const horodatage = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Dossier : la conversation si elle existe, sinon un brouillon (la conversation est créée à l'envoi). */
export function dossierConversation(conversationId: string | null | undefined, uuid: () => string): string {
  return conversationId && RE_UUID.test(conversationId) ? conversationId.toLowerCase() : `brouillon-${uuid().toLowerCase()}`;
}

/** `<uid>/<dossier>/<AAAAMMJJ-HHMMSS>-<nom>` — même motif que la politique RLS du bucket. */
export function cheminPieceJointe(uid: string, dossier: string, nom: string, type: string, maintenant = new Date()): string {
  return `${uid.toLowerCase()}/${dossier}/${horodatage(maintenant)}-${nomFichierStockage(nom, type)}`;
}

export const cheminTexte = (chemin: string) => `${chemin}.texte.json`;

/** Contenu du texte extrait déposé à côté du PDF (format lu par le serveur). */
export function texteExtraitJson(pages: readonly string[]): string {
  return JSON.stringify({ version: 1, pages });
}

/** PDF scanné (images sans couche texte) : pas de lecture ciblée possible. */
export function semblerScanne(pages: readonly string[]): boolean {
  if (!pages.length) return true;
  const longueurs = pages.map((p) => p.replace(/\s+/g, '').length);
  const moyenne = longueurs.reduce((s, l) => s + l, 0) / pages.length;
  return moyenne < 120 || longueurs.filter((l) => l < 40).length / pages.length > 0.6;
}

// ── Estimation du coût AVANT envoi ─────────────────────────────────────────
// Mêmes constantes que copilot-chat (TIER_RATES, MARGIN, JETON_VALUE_EUR,
// USD_TO_EUR, BUDGET_DOCUMENTS_TOKENS, TOURS_SUPPOSES_DOCUMENT). Ce n'est
// qu'un ORDRE DE GRANDEUR affiché : le serveur compte exactement et débite le réel.

export type NiveauModele = 'haiku' | 'sonnet' | 'opus';
const TARIF_ENTREE_USD_MTOK: Record<NiveauModele, number> = { haiku: 1, sonnet: 3, opus: 5 };
const BUDGET_TOKENS: Record<NiveauModele, number> = { haiku: 60_000, sonnet: 120_000, opus: 150_000 };
const TOKENS_PAR_PAGE_PDF = 3000;
const SEUIL_PAGES_PDF_ENTIER = 20;

export interface EstimationLecture {
  /** Tokens de document envoyés au modèle (borne haute). */
  tokens: number;
  /** Jetons en plus d'un message ordinaire (borne haute, 2 tours). */
  jetons: number;
  /** Le document dépasse le budget d'un tour : seule une partie sera lue (zone, pages demandées). */
  lectureCiblee: boolean;
}

export function estimerLecture(p: { nbPages: number | null; caracteres: number | null; scanne: boolean }, niveau: NiveauModele): EstimationLecture {
  const budget = BUDGET_TOKENS[niveau];
  let brut: number;
  if (p.nbPages != null && (p.nbPages <= SEUIL_PAGES_PDF_ENTIER || p.scanne)) brut = p.nbPages * TOKENS_PAR_PAGE_PDF;
  else if (p.caracteres != null) brut = Math.ceil(p.caracteres / 3);
  else brut = budget;
  const tokens = Math.min(brut, budget);
  const debit = (t: number) => Math.max(1, Math.ceil(((t * TARIF_ENTREE_USD_MTOK[niveau]) / 1e6) * 0.95 * 3 / 0.10));
  return { tokens, jetons: Math.max(0, debit(tokens * 2) - debit(0)), lectureCiblee: brut > budget };
}

/** Libellé court de la pastille : « 240 p. · lecture ciblée · ≤ ~12 jetons ». */
export function resumePiece(p: { nbPages: number | null; estimation: EstimationLecture | null; scanne: boolean }): string {
  const morceaux: string[] = [];
  if (p.nbPages) morceaux.push(`${p.nbPages} p.`);
  if (p.scanne) morceaux.push('scanné');
  if (p.estimation?.lectureCiblee) morceaux.push('lecture ciblée');
  if (p.estimation && p.estimation.jetons > 0) morceaux.push(`≤ ~${p.estimation.jetons} jeton${p.estimation.jetons > 1 ? 's' : ''}`);
  return morceaux.join(' · ');
}

/** Événement SSE `documents` de copilot-chat (V1.8). */
export interface EvenementDocuments {
  documents: Array<{ nom: string; mode: string; description: string; tokens: number; nouvelle: boolean }>;
  erreurs: string[];
  tokens: number;
  jetons_supplementaires: number;
}

/** Phrase affichée sous le composeur : ce qui est lu, comment, et ce que ça coûte en plus. */
export function avisDocuments(e: EvenementDocuments): string | null {
  const morceaux: string[] = [];
  for (const d of e.documents ?? []) morceaux.push(`${d.nouvelle ? '' : '(relu) '}${d.description}`);
  for (const x of e.erreurs ?? []) morceaux.push(`non lu : ${x}`);
  if (!morceaux.length) return null;
  const cout = e.jetons_supplementaires > 0
    ? ` — lecture d’un document volumineux : environ ${e.jetons_supplementaires} jeton${e.jetons_supplementaires > 1 ? 's' : ''} de plus qu’un message ordinaire (débit au réel).`
    : '';
  return `${morceaux.join(' ; ')}${cout}`;
}
