// src/spaces/promoteur/shared/environnement360.ts
//
// ENV1 — Photos 360° prises autour de la parcelle, rattachées à l'étude.
// Stockage : bucket privé « environnement-360 », chemin <uid>/<étude>/<fichier>
// (voir supabase/migrations/20261007_environnement_360.sql). Le studio 3D les
// reçoit par adresses signées, avec les parcelles.

import { supabase } from "../../../supabaseClient";

export const BUCKET_360 = "environnement-360";
const TAILLE_MAX = 60 * 1024 * 1024;

export interface Panorama360 {
  path: string;
  nom: string;
  taille: number | null;
  ajouteLe: string | null;
}

async function dossierEtude(studyId: string): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Connectez-vous pour enregistrer des photos 360°.");
  if (!/^[A-Za-z0-9-]{1,64}$/.test(studyId)) throw new Error("Étude invalide.");
  return `${data.user.id}/${studyId}`;
}

/** Contrôle qu'une image est bien une photo 360° complète (rapport 2:1). */
export function verifierRapport360(largeur: number, hauteur: number): string | null {
  if (largeur < 1024 || hauteur < 512) return `image trop petite (${largeur} × ${hauteur} px)`;
  const r = largeur / hauteur;
  if (Math.abs(r - 2) > 0.12) {
    return r > 2
      ? `rapport ${r.toFixed(2)}:1 — c'est un panorama partiel ; utilisez le mode Photo Sphere / 360° (image 2:1)`
      : `rapport ${r.toFixed(2)}:1 — ce n'est pas une photo 360° (attendu 2:1)`;
  }
  return null;
}

function dimensionsImage(fichier: File): Promise<{ largeur: number; hauteur: number }> {
  return new Promise((ok, ko) => {
    const url = URL.createObjectURL(fichier);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); ok({ largeur: img.naturalWidth, hauteur: img.naturalHeight }); };
    img.onerror = () => { URL.revokeObjectURL(url); ko(new Error("image illisible")); };
    img.src = url;
  });
}

export async function listerPanoramas(studyId: string): Promise<Panorama360[]> {
  const dossier = await dossierEtude(studyId);
  const { data, error } = await supabase.storage.from(BUCKET_360).list(dossier, { limit: 50, sortBy: { column: "created_at", order: "asc" } });
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((f) => f.name && !f.name.startsWith("."))
    .map((f) => ({
      path: `${dossier}/${f.name}`,
      nom: (f.metadata as { nomOrigine?: string } | null)?.nomOrigine ?? f.name.replace(/^[0-9a-f-]{36}-/, ""),
      taille: (f.metadata as { size?: number } | null)?.size ?? null,
      ajouteLe: f.created_at ?? null,
    }));
}

export async function televerserPanorama(studyId: string, fichier: File): Promise<Panorama360> {
  if (!/^image\/(jpeg|png)$/.test(fichier.type)) throw new Error(`${fichier.name} : JPEG ou PNG attendu.`);
  if (fichier.size > TAILLE_MAX) throw new Error(`${fichier.name} : plus de 60 Mo.`);
  const { largeur, hauteur } = await dimensionsImage(fichier);
  const refus = verifierRapport360(largeur, hauteur);
  if (refus) throw new Error(`${fichier.name} : ${refus}.`);
  const dossier = await dossierEtude(studyId);
  const propre = fichier.name.normalize("NFD").replace(/[^A-Za-z0-9._-]/g, "_").slice(-80);
  const path = `${dossier}/${crypto.randomUUID()}-${propre}`;
  const { error } = await supabase.storage.from(BUCKET_360).upload(path, fichier, { contentType: fichier.type, upsert: false });
  if (error) throw new Error(`${fichier.name} : ${error.message}`);
  return { path, nom: fichier.name, taille: fichier.size, ajouteLe: new Date().toISOString() };
}

export async function supprimerPanorama(path: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET_360).remove([path]);
  if (error) throw new Error(error.message);
}

/** Adresses signées (1 h) pour le studio 3D. */
export async function adressesSignees(panoramas: Panorama360[]): Promise<{ url: string; nom: string }[]> {
  if (panoramas.length === 0) return [];
  const { data, error } = await supabase.storage.from(BUCKET_360).createSignedUrls(panoramas.map((p) => p.path), 3600);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((d, i) => ({ url: d.signedUrl ?? "", nom: panoramas[i]?.nom ?? "Panorama 360°" }))
    .filter((d) => d.url.length > 0);
}
