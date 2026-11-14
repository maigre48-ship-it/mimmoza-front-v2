// supabase/functions/servitudes-gpu-v1/logique.ts
// =============================================================
// LOT P11 — catégorie CNIG d'une servitude d'utilité publique (AC1, AC2, AC4, PM1…).
//
// Constat en production (copilot_tool_calls, août → novembre 2026) : le champ
// `categorie` renvoyé par l'API Carto (couches assiette-sup-*) est TOUJOURS vide.
// La catégorie se lit pourtant dans les identifiants, par exemple :
//   idass     « AC1-172014607-1907231266-1-2 »
//   idgen     « AC1-172014607-1907231266-1 »
//   partition « 172014607_SUP_64_AC1 »  ou  « 130010457_SUP_R75_AC2 »
// Conséquence avant correction : `categorie` et `categorie_label` à null pour
// tous les consommateurs (chat get_servitudes, dossier-terrain, api-gateway…),
// qui ne pouvaient pas distinguer des abords de monument (AC1) d'un PPR (PM1).
// =============================================================

const CODE_CNIG = /^[A-Z]{1,4}\d{1,2}$/;

export type OrigineCategorie = 'categorie' | 'idgen' | 'idass' | 'partition';

/** Code CNIG normalisé (« ac1 » → « AC1 ») ou null si la valeur n'a pas la forme d'un code. */
export function codeCnig(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const c = v.trim().toUpperCase();
  return CODE_CNIG.test(c) ? c : null;
}

/**
 * Catégorie d'une servitude : le champ `categorie` s'il est renseigné sous forme de code, sinon le
 * préfixe de `idgen` puis de `idass`, sinon le suffixe de `partition`. Rien d'autre n'est deviné.
 */
export function categorieServitude(champs: {
  categorie?: unknown;
  idgen?: unknown;
  idass?: unknown;
  partition?: unknown;
}): { code: string; origine: OrigineCategorie } | null {
  const direct = codeCnig(champs.categorie);
  if (direct) return { code: direct, origine: 'categorie' };
  for (const k of ['idgen', 'idass'] as const) {
    const v = champs[k];
    const m = typeof v === 'string' ? /^\s*([A-Za-z]{1,4}\d{1,2})-/.exec(v) : null;
    const c = m ? codeCnig(m[1]) : null;
    if (c) return { code: c, origine: k };
  }
  const p = champs.partition;
  const m = typeof p === 'string' ? /_SUP_[0-9A-Za-z]+_([A-Za-z]{1,4}\d{1,2})\s*$/.exec(p) : null;
  const c = m ? codeCnig(m[1]) : null;
  return c ? { code: c, origine: 'partition' } : null;
}
