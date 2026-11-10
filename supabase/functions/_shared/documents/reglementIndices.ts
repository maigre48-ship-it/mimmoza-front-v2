// supabase/functions/_shared/documents/reglementIndices.ts
// =============================================================
// Lot C5 « règlement à indices » (essais témoins du 10/11/2026, Montreuil, PLUi Est Ensemble).
//
// Certains PLU intercommunaux ne rédigent pas un chapitre complet par zone : le code de zone
// (« UC91Jb2 ») est une SUITE D'INDICES, et chaque indice renvoie à une fiche (implantation sur
// voie, limites séparatives, emprise au sol, hauteur). Constats du 10/11 :
//   · la mission « conception » ne lisait que le chapitre de la zone mère → 0 règle sur 9 ;
//   · le chat découpait le code lui-même, différemment d'un essai à l'autre (UC·9·1·J·b2, juste,
//     puis UC·9·1·b·2, faux : emprise 70 % au lieu de 80 %/20 %, hauteur perdue).
//
// Ce module est PUR et DÉTERMINISTE. Il ne lit aucune règle : il établit, à partir du seul texte
// des pages, QUEL indice de QUELLE fiche s'applique, et quelles pages lire. La valeur des règles
// reste extraite ensuite (lecture ciblée), sur ces seules pages.
//
// Principe : le code est découpé en 4 segments consécutifs (voies, limites, emprise, hauteur —
// l'ordre des fiches dans le règlement). Un découpage n'est retenu que si CHAQUE segment est le
// nom d'un indice réellement présent dans une fiche de SA famille. Un seul découpage valide →
// « decoupe ». Aucun ou plusieurs → on ne tranche pas (« non_decoupe », « ambigu »).
// La casse compte : « B » (emprise) et « b2 » (hauteur) sont deux indices différents.
// =============================================================

export type FamilleIndice = 'voies' | 'limites' | 'emprise' | 'hauteur';

export const FAMILLES_INDICES: ReadonlyArray<{ famille: FamilleIndice; libelle: string; motif: RegExp }> = [
  { famille: 'voies', libelle: 'implantation par rapport aux voies et emprises publiques', motif: /voies et emprises publiques/i },
  { famille: 'limites', libelle: 'implantation par rapport aux limites séparatives', motif: /limites s[ée]paratives/i },
  { famille: 'emprise', libelle: 'emprise au sol et nature en ville', motif: /emprise au sol/i },
  { famille: 'hauteur', libelle: 'hauteur des constructions', motif: /hauteur des constructions/i },
];

const RE_FICHE = /fiches? d[’'`]indices?/i;
const RE_LEGENDE = /syst[èe]me d[’'`]indices?/i;
const RE_LEGENDE_DETAIL = /se rapportant/i;
/** Longueur de l'en-tête de page examinée pour reconnaître la famille d'une fiche. */
const TETE = 320;
const SUFFIXE_MIN = 4;
const SUFFIXE_MAX = 10;
/** Pages lues au plus par indice (la fiche peut tenir sur deux ou trois pages). */
const PAGES_PAR_INDICE = 4;

const aplatir = (t: string) => (t ?? '').replace(/\s+/g, ' ').trim();

/** Famille d'une page de fiche d'indices, ou null (page hors fiches, ou fiche d'une autre nature). */
export function familleDeLaPage(texte: string): FamilleIndice | null {
  const t = aplatir(texte);
  if (!RE_FICHE.test(t)) return null;
  const tete = t.slice(0, TETE);
  for (const f of FAMILLES_INDICES) if (f.motif.test(tete)) return f.famille;
  return null;
}

/** Pages (numérotées à partir de 1) des fiches d'indices, par famille. */
export function pagesFiches(pages: readonly string[]): Record<FamilleIndice, number[]> {
  const out: Record<FamilleIndice, number[]> = { voies: [], limites: [], emprise: [], hauteur: [] };
  pages.forEach((p, i) => {
    const f = familleDeLaPage(p);
    if (f) out[f].push(i + 1);
  });
  return out;
}

/** Pages qui expliquent le système d'indices (hors simple mention au sommaire). */
export function pagesLegendeIndices(pages: readonly string[], max = 2): number[] {
  const out: number[] = [];
  pages.forEach((p, i) => {
    const t = aplatir(p);
    if (RE_LEGENDE.test(t) && RE_LEGENDE_DETAIL.test(t) && familleDeLaPage(p) == null) out.push(i + 1);
  });
  return out.slice(-max);
}

/**
 * Vrai si `indice` figure dans `texte` comme NOM D'INDICE : isolé, puis suivi d'une majuscule
 * (début de sa disposition : « 9 Il n'est pas fixé… », « J Dans la bande… », « b2 BP : 19,5 »).
 * Sensible à la casse. Un chiffre au milieu d'une phrase (« 3 mètres ») n'est pas un nom d'indice.
 */
export function indicePresent(texte: string, indice: string): boolean {
  if (!indice) return false;
  const esc = indice.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[\\s.:])${esc}\\s+(?=[A-ZÀÂÉÈÊÎÔÛ«])`).test(aplatir(texte));
}

export interface IndiceRetenu { famille: FamilleIndice; libelle: string; indice: string; pages: number[] }

export interface DecoupageZone {
  statut: 'sans_indices' | 'non_decoupe' | 'ambigu' | 'decoupe';
  /** Raison lisible, pour les journaux (jamais affichée telle quelle à l'utilisateur). */
  motif: string;
  code?: string;
  zoneMere?: string;
  suffixe?: string;
  indices?: IndiceRetenu[];
  pagesLegende?: number[];
  /** Pages à lire : légende + fiches des indices retenus, triées, sans doublon. */
  pages?: number[];
}

/**
 * Découpe un code de zone à indices. `zonesChapitres` : zones mères connues du règlement (« UC », « UM »…).
 * Ne retient un découpage que s'il est UNIQUE et entièrement attesté par les fiches.
 */
export function decouperCodeZone(pages: readonly string[], codeBrut: string | null | undefined, zonesChapitres: readonly string[]): DecoupageZone {
  const code = (codeBrut ?? '').trim().replace(/^zone\s+/i, '').replace(/\s+/g, '');
  if (!code) return { statut: 'sans_indices', motif: 'code de zone absent' };
  const fiches = pagesFiches(pages);
  const manquantes = FAMILLES_INDICES.filter((f) => fiches[f.famille].length === 0).map((f) => f.famille);
  if (manquantes.length) return { statut: 'sans_indices', motif: `pas de fiche d'indices pour : ${manquantes.join(', ')}`, code };

  const haut = code.toUpperCase();
  const zoneMere = [...zonesChapitres].map((z) => z.toUpperCase()).filter((z) => z && haut.startsWith(z) && haut.length > z.length)
    .sort((a, b) => b.length - a.length)[0];
  if (!zoneMere) return { statut: 'non_decoupe', motif: 'zone mère introuvable parmi les chapitres du règlement', code };
  const suffixe = code.slice(zoneMere.length);
  if (suffixe.length < SUFFIXE_MIN || suffixe.length > SUFFIXE_MAX) {
    return { statut: 'non_decoupe', motif: `suffixe « ${suffixe} » hors bornes (${SUFFIXE_MIN} à ${SUFFIXE_MAX} caractères)`, code, zoneMere, suffixe };
  }

  const pagesDe = (famille: FamilleIndice, indice: string) =>
    fiches[famille].filter((n) => indicePresent(pages[n - 1] ?? '', indice));
  const solutions: IndiceRetenu[][] = [];
  const n = suffixe.length;
  for (let i = 1; i <= n - 3; i++) {
    for (let j = i + 1; j <= n - 2; j++) {
      for (let k = j + 1; k <= n - 1; k++) {
        const segments = [suffixe.slice(0, i), suffixe.slice(i, j), suffixe.slice(j, k), suffixe.slice(k)];
        const retenus: IndiceRetenu[] = [];
        for (let f = 0; f < 4; f++) {
          const def = FAMILLES_INDICES[f];
          const p = pagesDe(def.famille, segments[f]);
          if (!p.length) break;
          retenus.push({ famille: def.famille, libelle: def.libelle, indice: segments[f], pages: p.slice(0, PAGES_PAR_INDICE) });
        }
        if (retenus.length === 4) solutions.push(retenus);
      }
    }
  }
  if (solutions.length === 0) return { statut: 'non_decoupe', motif: 'aucun découpage attesté par les fiches', code, zoneMere, suffixe };
  if (solutions.length > 1) {
    const liste = solutions.map((s) => s.map((x) => x.indice).join('·')).join(' | ');
    return { statut: 'ambigu', motif: `plusieurs découpages attestés : ${liste}`, code, zoneMere, suffixe };
  }
  const indices = solutions[0];
  const pagesLegende = pagesLegendeIndices(pages);
  const aLire = Array.from(new Set([...pagesLegende, ...indices.flatMap((x) => x.pages)])).sort((a, b) => a - b);
  return {
    statut: 'decoupe', motif: `découpage unique : ${zoneMere}·${indices.map((x) => x.indice).join('·')}`,
    code, zoneMere, suffixe, indices, pagesLegende, pages: aLire,
  };
}

/**
 * En-tête placé AVANT le texte des pages : dit au lecteur (modèle ou humain) quel indice s'applique,
 * et que les autres indices présents sur les mêmes pages ne s'appliquent pas.
 */
export function enteteDecoupage(d: DecoupageZone): string {
  if (d.statut !== 'decoupe' || !d.indices) return '';
  const lignes = d.indices.map((x) => `- ${x.libelle} : indice « ${x.indice} » (fiche p. ${x.pages.join(', ')})`);
  return [
    `[Découpage du code de zone — établi par Mimmoza à partir des fiches d'indices de ce règlement, sans interprétation]`,
    `Le code « ${d.code} » se lit : zone ${d.zoneMere}, puis quatre indices dans l'ordre des fiches.`,
    ...lignes,
    `Seules les dispositions de CES indices s'appliquent à la parcelle. Les autres indices qui figurent sur les mêmes pages ` +
      `(même fiche, autre nom d'indice) ne s'appliquent PAS : ne les cite pas comme règles de la parcelle. ` +
      `Cite chaque règle avec le nom de son indice et sa page (ex. « indice ${d.indices[2].indice}, p. ${d.indices[2].pages[0]} »). ` +
      `Les dispositions propres à une commune, quand la fiche en prévoit, priment pour cette commune.`,
  ].join('\n');
}
