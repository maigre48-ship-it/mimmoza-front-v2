// src/spaces/copilot/pieces-jointes/televersement.ts
// =============================================================
// V1.8 — Préparation des pièces jointes du chat MimmozIA (navigateur).
//
// Pour chaque fichier choisi :
//   · petite image (≤ 3 Mo) → base64 dans la requête (voie V1.7 inchangée) ;
//   · PDF (≤ 50 Mo) ou image de 3 à 5 Mo → téléversement dans le bucket privé
//     `copilot-pieces-jointes`, puis, pour un PDF, extraction du texte page par
//     page (pdf.js, dans un Web Worker) et dépôt de `<chemin>.texte.json` à côté.
//     L'extraction se fait ICI et non dans l'Edge Function : le parsing serveur
//     d'un gros PDF dépasse les 2 s de CPU d'une fonction (erreur 546, déjà vue
//     sur plu-parser). Si elle échoue (PDF protégé…), le PDF part quand même :
//     le serveur tentera sa propre extraction, par lots.
// Le PDF reste aussi lisible en base64 pour la préparation 3D s'il fait ≤ 3 Mo.
// V1.8 (50 Mo) : au-delà de 6 Mo, l'envoi est REPRENABLE (TUS, blocs de 6 Mo,
// recommandation Supabase) ; l'extraction pdf.js tourne dans un Web Worker et
// rend la main au navigateur entre deux pages (aucun blocage de l'interface),
// avec un compteur « page N / total ».
// =============================================================

import { supabase, SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/supabaseClient';
import {
  BUCKET_PIECES_JOINTES, cheminPieceJointe, cheminTexte, dossierConversation, estimerLecture, MAX_PAGES_TEXTE, MAX_PIECES, modeEnvoi,
  resumePiece, semblerScanne, TAILLE_MAX_INLINE, texteExtraitJson, TOTAL_MAX_INLINE, type NiveauModele,
} from './piecesJointesLogique';
import { SEUIL_UPLOAD_REPRENABLE, televerserTus } from './televersementTus';

/** Pièce jointe transmise à copilot-chat (base64 V1.7 OU référence Storage V1.8). */
export interface CopilotAttachment {
  mediaType: string;
  /** V1.7 : base64 SANS le préfixe data: (absent pour une pièce stockée de plus de 3 Mo). */
  data?: string;
  name?: string;
  /** V1.8 : chemin dans le bucket copilot-pieces-jointes. */
  storagePath?: string;
  size?: number;
  /** V1.8 : texte extrait (`storagePath + .texte.json`), PDF seulement. */
  textePath?: string;
}

/** Pièce jointe côté interface : de quoi afficher une pastille. */
export interface UiAttachment extends CopilotAttachment {
  id: string;
  name: string;
  size: number;
  /** Ligne d'information de la pastille (pages, lecture ciblée, coût estimé). */
  detail?: string;
}

/** Lit un fichier en base64 SANS le préfixe `data:…;base64,`. */
export function readAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const res = String(r.result);
      const comma = res.indexOf(',');
      resolve(comma >= 0 ? res.slice(comma + 1) : res);
    };
    r.onerror = () => reject(r.error ?? new Error('lecture impossible'));
    r.readAsDataURL(file);
  });
}

let pdfjsPromesse: Promise<typeof import('pdfjs-dist')> | null = null;
/** pdf.js chargé à la demande (il ne pèse pas sur l'ouverture de la page). */
function chargerPdfjs(): Promise<typeof import('pdfjs-dist')> {
  pdfjsPromesse ??= (async () => {
    const pdfjs = await import('pdfjs-dist');
    if (!pdfjs.GlobalWorkerOptions.workerPort && !pdfjs.GlobalWorkerOptions.workerSrc) {
      // @ts-ignore - import worker Vite (?worker), comme FoncierPluPage
      const { default: PdfJsWorker } = await import('pdfjs-dist/build/pdf.worker.min.mjs?worker');
      pdfjs.GlobalWorkerOptions.workerPort = new PdfJsWorker();
    }
    return pdfjs;
  })();
  return pdfjsPromesse;
}

/**
 * Texte de chaque page (retour à la ligne quand la ligne de base change : les
 * titres restent repérables). Le parsing a lieu dans le Web Worker de pdf.js ;
 * on rend la main au navigateur toutes les 10 pages pour garder l'interface
 * fluide sur un PDF de 50 Mo (plusieurs centaines de pages).
 */
export async function extrairePagesPdf(file: Blob, surPage?: (n: number, total: number) => void): Promise<string[]> {
  const pdfjs = await chargerPdfjs();
  const tache = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await tache.promise;
  const pages: string[] = [];
  try {
    const total = Math.min(pdf.numPages, MAX_PAGES_TEXTE);
    for (let n = 1; n <= total; n++) {
      if (n % 10 === 0) {
        surPage?.(n, pdf.numPages);
        await new Promise<void>((r) => setTimeout(r, 0));
      }
      const page = await pdf.getPage(n);
      const contenu = await page.getTextContent();
      let t = '';
      let dernierY: number | undefined;
      for (const it of contenu.items as Array<{ str?: string; hasEOL?: boolean; transform?: number[] }>) {
        if (typeof it.str !== 'string') continue;
        const y = it.transform?.[5];
        if (dernierY !== undefined && y !== undefined && y !== dernierY && !t.endsWith('\n')) t += '\n';
        t += it.str;
        if (it.hasEOL) t += '\n';
        if (y !== undefined) dernierY = y;
      }
      pages.push(t.trim());
      page.cleanup();
    }
  } finally {
    try { await tache.destroy(); } catch { /* ignore */ }
  }
  return pages;
}

/**
 * Dépôt dans un bucket : upload standard jusqu'à 6 Mo, REPRENABLE (TUS) au-delà
 * (doc Supabase). Partagé avec le dépôt du règlement de la mission conception.
 */
export async function deposerDansBucket(
  bucket: string, chemin: string, contenu: Blob, type: string, surProgres?: (envoye: number, total: number) => void,
): Promise<void> {
  if (contenu.size > SEUIL_UPLOAD_REPRENABLE && SUPABASE_URL && SUPABASE_ANON_KEY) {
    const { data } = await supabase.auth.getSession();
    const jeton = data.session?.access_token;
    if (!jeton) throw new Error('Session expirée : reconnectez-vous pour joindre un fichier.');
    await televerserTus({ supabaseUrl: SUPABASE_URL, apikey: SUPABASE_ANON_KEY, jeton, bucket, chemin, fichier: contenu, type, surProgres });
    return;
  }
  const { error } = await supabase.storage.from(bucket).upload(chemin, contenu, { contentType: type, upsert: false });
  if (error) {
    if (/bucket not found/i.test(error.message)) throw new Error('Le dépôt des fichiers n’est pas encore activé. Réessayez plus tard.');
    throw new Error('Le fichier n’a pas pu être envoyé. Réessayez.');
  }
}

const televerser = (chemin: string, contenu: Blob, type: string, surProgres?: (envoye: number, total: number) => void) =>
  deposerDansBucket(BUCKET_PIECES_JOINTES, chemin, contenu, type, surProgres);

/**
 * Prépare les fichiers choisis. Renvoie les pièces acceptées et, le cas échéant,
 * UN message d'erreur (le premier refus) pour l'utilisateur.
 */
export async function preparerPiecesJointes(
  fichiers: readonly File[],
  existantes: readonly UiAttachment[],
  p: { conversationId: string | null; niveau: NiveauModele; surEtape?: (texte: string) => void },
): Promise<{ acceptees: UiAttachment[]; erreur: string | null }> {
  const acceptees: UiAttachment[] = [];
  let erreur: string | null = null;
  let totalInline = existantes.filter((a) => a.data && !a.storagePath).reduce((s, a) => s + a.size, 0);
  let nb = existantes.length;
  let uid: string | null = null;
  // Un même dossier pour toutes les pièces d'un message.
  const dossier = dossierConversation(p.conversationId, () => crypto.randomUUID());

  for (const file of fichiers) {
    const id = `${file.name}-${file.lastModified}-${file.size}`;
    if (existantes.some((a) => a.id === id)) continue;
    if (nb >= MAX_PIECES) { erreur ??= `${MAX_PIECES} pièces jointes au plus par message.`; break; }
    const m = modeEnvoi(file);
    if (!m.ok) { erreur ??= m.erreur; continue; }
    try {
      if (m.mode === 'inline') {
        if (totalInline + file.size > TOTAL_MAX_INLINE) { erreur ??= 'Taille cumulée des images dépassée (4 Mo) : envoyez-les en plusieurs messages.'; continue; }
        acceptees.push({ id, name: file.name, size: file.size, mediaType: file.type, data: await readAsBase64(file) });
        totalInline += file.size;
        nb++;
        continue;
      }
      if (!uid) {
        const { data } = await supabase.auth.getUser();
        uid = data.user?.id ?? null;
        if (!uid) throw new Error('Session expirée : reconnectez-vous pour joindre un fichier.');
      }
      const chemin = cheminPieceJointe(uid, dossier, file.name, file.type);
      await televerser(chemin, file, file.type, (e, t) =>
        p.surEtape?.(`Envoi de « ${file.name} » : ${Math.round((100 * e) / Math.max(1, t))} %`));
      const piece: UiAttachment = { id, name: file.name, size: file.size, mediaType: file.type, storagePath: chemin };
      if (file.type === 'application/pdf') {
        let pages: string[] | null = null;
        try {
          pages = await extrairePagesPdf(file, (n, total) => p.surEtape?.(`Lecture de « ${file.name} » : page ${n} / ${total}`));
        } catch (e) { console.warn('[MimmozIA] extraction pdf.js impossible :', e); }
        const scanne = pages ? semblerScanne(pages) : false;
        if (pages && pages.length && !scanne) {
          try {
            await televerser(cheminTexte(chemin), new Blob([texteExtraitJson(pages)], { type: 'application/json' }), 'application/json');
            piece.textePath = cheminTexte(chemin);
          } catch (e) { console.warn('[MimmozIA] texte extrait non déposé :', e); }
        }
        const estimation = estimerLecture({ nbPages: pages?.length ?? null, caracteres: pages ? pages.reduce((s, x) => s + x.length + 16, 0) : null, scanne }, p.niveau);
        piece.detail = resumePiece({ nbPages: pages?.length ?? null, estimation, scanne });
        // Préparation 3D (plans) : le base64 reste disponible pour les PDF légers.
        if (file.size <= TAILLE_MAX_INLINE) piece.data = await readAsBase64(file);
      }
      acceptees.push(piece);
      nb++;
    } catch (e) {
      erreur ??= e instanceof Error ? e.message : `Envoi impossible : ${file.name}`;
    }
  }
  return { acceptees, erreur };
}

/** Charge utile pour copilot-chat : une pièce stockée part en RÉFÉRENCE (jamais avec son base64). */
export function versPayload(pieces: readonly UiAttachment[]): CopilotAttachment[] {
  return pieces.map((a) => (a.storagePath
    ? { mediaType: a.mediaType, name: a.name, storagePath: a.storagePath, size: a.size, ...(a.textePath ? { textePath: a.textePath } : {}) }
    : { mediaType: a.mediaType, data: a.data, name: a.name }));
}

/** Pièces encore disponibles en base64 (préparation 3D, conservation des plans). */
export function piecesBase64(pieces: readonly UiAttachment[]): Array<{ mediaType: string; data: string; name?: string }> {
  return pieces.filter((a): a is UiAttachment & { data: string } => typeof a.data === 'string')
    .map(({ mediaType, data, name }) => ({ mediaType, data, name }));
}
