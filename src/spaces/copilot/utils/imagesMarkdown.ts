// src/spaces/copilot/utils/imagesMarkdown.ts
// =============================================================================
// LOT E1-suivi — Images dans les réponses du chat (logique PURE, testée par
// imagesMarkdown.test.ts avec `node --test`).
//
// Constat (05/11/2026) : Mimmo écrit les rendus Studio en Markdown d'image
// « ![Vue 3/4 gauche](https://…/storage/v1/object/sign/studio-rendus/…?token=…) ».
// Le rendu Markdown du chat (`markdownToSafeHtml`) ne connaissait que les liens :
// la partie « [Vue 3/4 gauche](url) » devenait un lien et le « ! » restait seul
// à l'écran (« !Vue 3/4 gauche »).
//
// Règle : une image n'est AFFICHÉE que si son adresse est une URL https du
// stockage Supabase du projet (objet signé ou public). Toute autre image reste
// un simple lien (même règle que les liens existants) — jamais d'image d'un
// domaine tiers (pistage, contenu arbitraire).
// =============================================================================

/** Origine du stockage Supabase du projet (même valeur que conception.ts / PREFIXE_URL_SIGNEE). */
export const ORIGINE_STOCKAGE_PROJET = 'https://fwvrqngbafqdaekbdfnm.supabase.co';
/** Chemins d'objets de stockage acceptés pour une image affichée. */
const CHEMINS_AUTORISES = ['/storage/v1/object/sign/', '/storage/v1/object/public/'];

/**
 * Vrai si `url` (texte BRUT, non échappé) peut être affichée en <img> : https,
 * hôte exact du projet, port par défaut, sans identifiants, chemin d'objet de
 * stockage signé ou public, sans « .. ».
 */
export function urlImageAutorisee(url: string): boolean {
  if (typeof url !== 'string' || url.length > 4000 || /[\s"'<>`\\]/.test(url)) return false;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' || u.origin !== ORIGINE_STOCKAGE_PROJET || u.username || u.password) return false;
  if (u.pathname.includes('..') || /%2e%2e/i.test(u.pathname)) return false;
  return CHEMINS_AUTORISES.some((p) => u.pathname.startsWith(p) && u.pathname.length > p.length);
}

/** Inverse de l'échappement HTML appliqué par markdownToSafeHtml (pour valider l'URL réelle). */
export function desechapperHtml(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** Échappement HTML (texte et valeurs d'attribut entre guillemets doubles). */
export function echapperHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const STYLE_LIEN = 'color:#4f46e5;text-decoration:underline;';
const STYLE_IMAGE = 'display:block;max-width:100%;height:auto;margin:8px 0;border-radius:10px;border:1px solid #e2e8f0;';

/**
 * HTML d'un lien Markdown [texte](url) — `texteEchappe` et `urlEchappee` viennent
 * d'un texte DÉJÀ échappé. Seules les URL http(s) deviennent des liens (règle existante).
 */
export function htmlLien(texteEchappe: string, urlEchappee: string): string {
  return `<a href="${urlEchappee}" target="_blank" rel="noopener noreferrer" style="${STYLE_LIEN}">${texteEchappe}</a>`;
}

/**
 * HTML d'une image Markdown ![alt](url) (entrées déjà échappées) : <img> cliquable
 * (ouvre l'image en grand) si l'URL est autorisée, sinon simple lien portant le
 * texte alternatif (le « ! » disparaît dans les deux cas).
 */
export function htmlImage(altEchappe: string, urlEchappee: string): string {
  const brute = desechapperHtml(urlEchappee);
  if (!urlImageAutorisee(brute)) return htmlLien(altEchappe || 'Image', urlEchappee);
  const src = echapperHtml(brute);
  return `<a href="${src}" target="_blank" rel="noopener noreferrer" class="copilot-markdown-image-lien"><img src="${src}" alt="${altEchappe}" loading="lazy" referrerpolicy="no-referrer" class="copilot-markdown-image" style="${STYLE_IMAGE}"></a>`;
}
