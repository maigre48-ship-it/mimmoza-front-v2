// src/spaces/copilot/studio3d/transfertStudio.ts
//
// CH2 — Fichiers joints dans le tchat MimmozIA pour la prévisualisation 3D :
// photos de façade et plans. Bucket privé « studio-transfert » (20 Mo),
// chemin <uid>/<session>/<uuid>-<nom>. Le studio les reçoit par adresses
// signées (1 h). Les photos 360° passent par « environnement-360 » (60 Mo).

import { supabase } from "@/lib/supabaseClient";

export const BUCKET_TRANSFERT = "studio-transfert";
const TAILLE_MAX = 20 * 1024 * 1024;
export const TYPES_FACADE = ["image/jpeg", "image/png", "image/webp"];
export const TYPES_PLAN = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export interface FichierTransfert { path: string; nom: string }

async function dossier(session: string): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Connectez-vous pour envoyer des fichiers au Studio 3D.");
  if (!/^[A-Za-z0-9-]{1,64}$/.test(session)) throw new Error("Session invalide.");
  return `${data.user.id}/${session}`;
}

export async function televerserTransfert(session: string, fichier: File, typesAdmis: readonly string[]): Promise<FichierTransfert> {
  if (!typesAdmis.includes(fichier.type)) throw new Error(`${fichier.name} : format non pris en charge.`);
  if (fichier.size > TAILLE_MAX) throw new Error(`${fichier.name} : plus de 20 Mo.`);
  const propre = fichier.name.normalize("NFD").replace(/[^A-Za-z0-9._-]/g, "_").slice(-80);
  const path = `${await dossier(session)}/${crypto.randomUUID()}-${propre}`;
  const { error } = await supabase.storage.from(BUCKET_TRANSFERT).upload(path, fichier, { contentType: fichier.type, upsert: false });
  if (error) throw new Error(`${fichier.name} : ${error.message}`);
  return { path, nom: fichier.name };
}

export async function signerTransferts(fichiers: readonly FichierTransfert[]): Promise<{ url: string; nom: string }[]> {
  if (fichiers.length === 0) return [];
  const { data, error } = await supabase.storage.from(BUCKET_TRANSFERT).createSignedUrls(fichiers.map((f) => f.path), 3600);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((d, i) => ({ url: d.signedUrl ?? "", nom: fichiers[i]?.nom ?? "fichier" }))
    .filter((d) => d.url.length > 0);
}
