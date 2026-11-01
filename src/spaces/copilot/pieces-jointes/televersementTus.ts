// src/spaces/copilot/pieces-jointes/televersementTus.ts
// =============================================================
// V1.8 — Téléversement REPRENABLE (protocole TUS) vers Supabase Storage.
//
// Pourquoi : la doc Supabase réserve l'upload standard aux fichiers « not larger
// than 6MB » et recommande TUS au-delà « for better reliability » (« Storage —
// Standard uploads » / « Resumable uploads »). Nos pièces jointes vont jusqu'à
// 50 Mo (maximum du plan Free) : un upload standard d'un seul bloc échouerait
// sur une connexion instable sans pouvoir reprendre.
//
// Client minimal, SANS dépendance (pas de tus-js-client) : création (POST),
// envoi par blocs de 6 Mo (PATCH — taille IMPOSÉE par Supabase : « it must be
// set to 6MB »), reprise sur erreur (HEAD → Upload-Offset), 3 essais par bloc.
// `fetchFn` injectable : testé par televersementTus.test.ts sans réseau.
// =============================================================

/** Au-delà de cette taille, upload TUS (doc Supabase : standard ≤ 6 Mo). */
export const SEUIL_UPLOAD_REPRENABLE = 6 * 1024 * 1024;
/** Taille de bloc imposée par Supabase pour TUS. */
export const TAILLE_BLOC_TUS = 6 * 1024 * 1024;
const ESSAIS_PAR_BLOC = 3;

/**
 * Point d'entrée TUS. Supabase recommande l'hôte de stockage direct
 * (`https://<ref>.storage.supabase.co`) ; pour un domaine personnalisé, on
 * retombe sur `<url>/storage/v1/upload/resumable`.
 */
export function urlTus(supabaseUrl: string): string {
  const u = supabaseUrl.replace(/\/+$/, '');
  const m = /^https:\/\/([a-z0-9]+)\.supabase\.co$/i.exec(u);
  return m ? `https://${m[1]}.storage.supabase.co/storage/v1/upload/resumable` : `${u}/storage/v1/upload/resumable`;
}

const base64Utf8 = (s: string) => {
  const octets = new TextEncoder().encode(s);
  let bin = '';
  for (const o of octets) bin += String.fromCharCode(o);
  return btoa(bin);
};

/** En-tête Upload-Metadata : `clé base64(valeur)` séparés par des virgules. */
export function metadonneesTus(m: { bucketName: string; objectName: string; contentType: string; cacheControl?: string }): string {
  return Object.entries({ cacheControl: '3600', ...m })
    .map(([k, v]) => `${k} ${base64Utf8(String(v))}`)
    .join(',');
}

export interface ParamsTus {
  supabaseUrl: string;
  /** Clé publique (anon / publishable). */
  apikey: string;
  /** Jeton d'accès de la session : la RLS du bucket s'applique comme pour un upload standard. */
  jeton: string;
  bucket: string;
  chemin: string;
  fichier: Blob;
  type: string;
  fetchFn?: typeof fetch;
  surProgres?: (envoye: number, total: number) => void;
  attendre?: (ms: number) => Promise<void>;
}

export async function televerserTus(p: ParamsTus): Promise<void> {
  const f = p.fetchFn ?? fetch;
  const attendre = p.attendre ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const entetes = { authorization: `Bearer ${p.jeton}`, apikey: p.apikey, 'tus-resumable': '1.0.0' };
  const point = urlTus(p.supabaseUrl);
  const creation = await f(point, {
    method: 'POST',
    headers: {
      ...entetes,
      'upload-length': String(p.fichier.size),
      'upload-metadata': metadonneesTus({ bucketName: p.bucket, objectName: p.chemin, contentType: p.type }),
      'x-upsert': 'false',
    },
  });
  if (creation.status === 409) throw new Error('Un fichier du même nom existe déjà. Réessayez.');
  if (creation.status === 403 || creation.status === 401) throw new Error('Envoi refusé (session expirée ou dossier non autorisé).');
  if (creation.status !== 201) throw new Error(`Création du téléversement refusée (HTTP ${creation.status}).`);
  const loc = creation.headers.get('location');
  if (!loc) throw new Error('Téléversement : adresse de reprise absente.');
  const url = new URL(loc, point).toString();

  let offset = 0;
  p.surProgres?.(0, p.fichier.size);
  while (offset < p.fichier.size) {
    let reussi = false;
    for (let essai = 0; essai < ESSAIS_PAR_BLOC && !reussi; essai++) {
      try {
        const r = await f(url, {
          method: 'PATCH',
          headers: { ...entetes, 'upload-offset': String(offset), 'content-type': 'application/offset+octet-stream' },
          body: p.fichier.slice(offset, Math.min(offset + TAILLE_BLOC_TUS, p.fichier.size)),
        });
        if (r.status === 204) {
          const n = Number(r.headers.get('upload-offset'));
          offset = Number.isFinite(n) && n > offset ? n : Math.min(offset + TAILLE_BLOC_TUS, p.fichier.size);
          reussi = true;
          break;
        }
        if (r.status === 401 || r.status === 403 || r.status === 413) throw new Error(`Envoi refusé (HTTP ${r.status}).`);
      } catch (e) {
        if (e instanceof Error && /Envoi refusé/.test(e.message)) throw e;
      }
      // Reprise : le serveur dit où il en est (un bloc a pu arriver malgré l'erreur).
      await attendre(500 * (essai + 1));
      try {
        const h = await f(url, { method: 'HEAD', headers: entetes });
        const n = Number(h.headers.get('upload-offset'));
        if (h.ok && Number.isFinite(n) && n >= offset) { if (n > offset) { offset = n; reussi = true; } }
      } catch { /* nouvel essai */ }
    }
    if (!reussi) throw new Error('Connexion interrompue pendant l’envoi du fichier. Réessayez.');
    p.surProgres?.(offset, p.fichier.size);
  }
}
