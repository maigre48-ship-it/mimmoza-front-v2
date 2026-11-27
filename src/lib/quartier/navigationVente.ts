// src/lib/quartier/navigationVente.ts
// =============================================================================
// VIS-70 — menu de navigation du bureau de vente « Plan masse · Situation · Extérieur · Plans · Intérieur · Galerie »,
// branché sur ce qui EXISTE déjà pour le projet :
//   · rendus Studio / Unreal (images extérieures et intérieures, film) et plans : collecterLivrables (VIS-60, lu tel quel) ;
//   · visite : lien public /visite/<id> (la nouvelle visionneuse est l'affaire de VIS-69 — même adresse) ;
//   · grille de vente (VIS-67) : simple lien, adresse ROUTE_GRILLE_VENTE (à confirmer avec VIS-67).
// Une entrée sans contenu reste visible mais « À venir » (jamais masquée, jamais simulée).
// Module PUR.
// =============================================================================
import type { FichierDossier, ManifesteDossier } from '../studio/dossierClient/dossierClientLogique.ts';

export type VueVente = 'plan-masse' | 'situation' | 'exterieur' | 'plans' | 'interieur' | 'galerie';
export const VUES_VENTE: readonly VueVente[] = ['plan-masse', 'situation', 'exterieur', 'plans', 'interieur', 'galerie'];
export const LIBELLES_VUE: Readonly<Record<VueVente, string>> = {
  'plan-masse': 'Plan masse', situation: 'Situation', exterieur: 'Extérieur', plans: 'Plans', interieur: 'Intérieur', galerie: 'Galerie',
};

/** Page Quartier (cette page) et grille de vente (VIS-67). */
export const ROUTE_PAGE_QUARTIER = '/mimmozia/quartier';
export const ROUTE_GRILLE_VENTE = '/mimmozia/vente';

export interface EntreeMenuVente {
  readonly vue: VueVente;
  readonly libelle: string;
  readonly disponible: boolean;
  /** Ce que la vue montre (« 4 images · film 45 s », « Visite 360° »…) ou pourquoi elle est à venir. */
  readonly detail: string;
  /** Lien externe à la page (visite) ; sinon la vue s'affiche dans la page. */
  readonly lien?: string;
}

export interface MenuVente {
  readonly entrees: readonly EntreeMenuVente[];
  readonly grilleVente: { readonly libelle: string; readonly lien: string };
  /** Meilleure vue aérienne rendue (fond « Plan masse » à la place de la carte, au choix). */
  readonly vueAerienne: FichierDossier | null;
  readonly imagesExterieures: readonly FichierDossier[];
  readonly imagesInterieures: readonly FichierDossier[];
  readonly plans: readonly FichierDossier[];
}

const VUES_AERIENNES = /a[ée]rien|drone|plan[ _-]?masse|vue[ _-]?de[ _-]?dessus|survol/i;

/** Adresse de la page Quartier d'une conversation (ouverte par le chat, le Studio ou l'Espace 3D). */
export function adressePageQuartier(o: { conversationId?: string | null; lat?: number | null; lon?: number | null; vue?: VueVente; idu?: string | null }): string {
  const q = new URLSearchParams();
  if (o.conversationId) q.set('conversation', o.conversationId);
  if (typeof o.lat === 'number' && typeof o.lon === 'number') { q.set('lat', o.lat.toFixed(6)); q.set('lon', o.lon.toFixed(6)); }
  if (o.idu) q.set('idu', o.idu);
  if (o.vue && o.vue !== 'situation') q.set('vue', o.vue);
  const s = q.toString();
  return s ? `${ROUTE_PAGE_QUARTIER}?${s}` : ROUTE_PAGE_QUARTIER;
}

export function lienGrilleVente(conversationId?: string | null): string {
  return conversationId ? `${ROUTE_GRILLE_VENTE}?conversation=${encodeURIComponent(conversationId)}` : ROUTE_GRILLE_VENTE;
}

const pluriel = (n: number, m: string) => `${n} ${m}${n > 1 ? 's' : ''}`;

export function construireMenuVente(m: ManifesteDossier | null, o: { conversationId?: string | null; origine?: string } = {}): MenuVente {
  const images = m?.images ?? [];
  const ext = images.filter((i) => i.famille !== 'interieur');
  const int = images.filter((i) => i.famille === 'interieur');
  const aerienne = ext.find((i) => VUES_AERIENNES.test(`${i.libelle} ${i.chemin}`)) ?? null;
  const film = m?.film ?? null;
  const visite = m?.visite ?? null;
  const plans = m?.plans ?? [];
  const origine = (o.origine ?? '').replace(/\/+$/, '');
  const entrees: EntreeMenuVente[] = [
    { vue: 'plan-masse', libelle: LIBELLES_VUE['plan-masse'], disponible: true, detail: aerienne ? 'Vue aérienne du projet et parcelle' : 'Projet et parcelle sur la vue aérienne' },
    { vue: 'situation', libelle: LIBELLES_VUE.situation, disponible: true, detail: 'Transports, commerces, écoles, santé, loisirs, restaurants, emploi' },
    { vue: 'exterieur', libelle: LIBELLES_VUE.exterieur, disponible: ext.length > 0 || film !== null,
      detail: ext.length || film ? [ext.length ? pluriel(ext.length, 'image') : '', film ? `film${film.dureeS ? ` ${Math.round(film.dureeS)} s` : ''}` : ''].filter(Boolean).join(' · ') : 'À venir : commandez des images ou un film dans le chat' },
    { vue: 'plans', libelle: LIBELLES_VUE.plans, disponible: plans.length > 0,
      detail: plans.length ? [...new Set(plans.map((p) => p.libelle))].join(' · ') : 'À venir : plans d’architecte non encore produits' },
    { vue: 'interieur', libelle: LIBELLES_VUE.interieur, disponible: visite !== null || int.length > 0,
      detail: visite ? `Visite 360°${visite.apercu ? ' (aperçu)' : ''}${int.length ? ` · ${pluriel(int.length, 'image')}` : ''}` : int.length ? pluriel(int.length, 'image') : 'À venir : visite ou images intérieures',
      ...(visite ? { lien: `${origine}/visite/${encodeURIComponent(visite.visiteId)}` } : {}) },
    { vue: 'galerie', libelle: LIBELLES_VUE.galerie, disponible: images.length > 0 || film !== null,
      detail: images.length || film ? `${pluriel(images.length, 'image')}${film ? ' · film' : ''}` : 'À venir' },
  ];
  return { entrees, grilleVente: { libelle: 'Grille de vente', lien: lienGrilleVente(o.conversationId) }, vueAerienne: aerienne, imagesExterieures: ext, imagesInterieures: int, plans };
}

export function vueDepuisAdresse(v: string | null): VueVente {
  return (VUES_VENTE as readonly string[]).includes(v ?? '') ? v as VueVente : 'situation';
}
