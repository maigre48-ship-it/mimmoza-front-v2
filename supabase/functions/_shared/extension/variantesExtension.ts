// supabase/functions/_shared/extension/variantesExtension.ts
// =============================================================================
// LOT G7 (18/11/2026) — Historique des VARIANTES d'un projet d'extension (V1, V2…), rattaché au projet (sorties du
// parcours dans la conversation). Module PUR, partagé par le serveur (Deno) et le site (navigateur).
//
// Chaque variante porte : son numéro, ce qui a changé depuis la précédente, un résumé lisible, le verdict de placement
// du moteur (placée / refusée) et l'EMPREINTE du projet (SHA-256 d'un JSON canonique, clés triées) : deux variantes
// différentes ont des empreintes différentes ; la même variante relue (base, temps réel) garde la même empreinte.
// =============================================================================

export interface VarianteHistorique {
  readonly n: number;
  readonly cree_le: string;
  readonly changements: readonly string[];
  readonly resume: string;
  readonly verdict: 'placee' | 'refusee';
  /** SHA-256 (hex) du projet d'extension en JSON canonique ; null si le projet n'est pas transmissible. */
  readonly empreinte_projet: string | null;
}

/** Nombre de variantes gardées (les plus récentes). */
export const VARIANTES_MAX = 12;

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** JSON canonique : clés triées à tous les niveaux (l'ordre des clés change après un passage en base jsonb). */
export function jsonCanonique(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(jsonCanonique).join(',')}]`;
  if (estObj(v)) return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${jsonCanonique(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

/** Empreinte d'un projet d'extension (SHA-256 hex du JSON canonique). */
export async function empreinteProjet(projet: unknown): Promise<string> {
  const o = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(jsonCanonique(projet))));
  return Array.from(o).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const txt = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** Liste de variantes relue (sortie d'outil, base) ; entrées illisibles ignorées. */
export function lireVariantes(v: unknown): VarianteHistorique[] {
  if (!Array.isArray(v)) return [];
  const out: VarianteHistorique[] = [];
  for (const x of v.slice(-VARIANTES_MAX)) {
    if (!estObj(x) || typeof x.n !== 'number' || !Number.isInteger(x.n) || x.n < 1 || x.n > 999) continue;
    const emp = typeof x.empreinte_projet === 'string' && /^[0-9a-f]{64}$/.test(x.empreinte_projet) ? x.empreinte_projet : null;
    out.push({
      n: x.n,
      cree_le: txt(x.cree_le, 40) ?? '',
      changements: Array.isArray(x.changements) ? x.changements.map((c) => txt(c, 200)).filter((c): c is string => !!c).slice(0, 12) : [],
      resume: txt(x.resume, 400) ?? '',
      verdict: x.verdict === 'refusee' ? 'refusee' : 'placee',
      empreinte_projet: emp,
    });
  }
  return out;
}

/** Historique des variantes de la conversation : celui de la sortie la plus récente qui en porte un. */
export function variantesDesSorties(sorties: readonly unknown[]): VarianteHistorique[] {
  for (const d of sorties) if (estObj(d) && Array.isArray(d.variantes)) return lireVariantes(d.variantes);
  return [];
}

/**
 * Historique après ce tour : une variante de même numéro que la dernière la REMPLACE (même variante recalculée, sa date
 * de création est gardée) ; un nouveau numéro s'ajoute. Pur.
 */
export function avecVariante(historique: readonly VarianteHistorique[], v: VarianteHistorique): VarianteHistorique[] {
  const derniere = historique.at(-1);
  if (derniere && derniere.n === v.n) return [...historique.slice(0, -1), { ...v, cree_le: derniere.cree_le || v.cree_le, changements: v.changements.length ? v.changements : derniere.changements }];
  return [...historique.filter((x) => x.n !== v.n), v].slice(-VARIANTES_MAX);
}
