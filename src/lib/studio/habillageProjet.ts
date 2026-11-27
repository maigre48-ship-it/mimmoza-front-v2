// src/lib/studio/habillageProjet.ts
// =============================================================================
// VIS-57 (26/11/2026) — « HABILLER LE PROJET » AVANT LE FILM, L'IMAGE OU LA VISITE 360°. Module PUR (site + Edge, Deno).
//
// Avant de lancer un rendu depuis le chat, Mimmo propose trois thèmes ; chacun est CHOISI par l'utilisateur (page dédiée
// du Studio, ouverte par le pont du parcours) ou DÉLÉGUÉ (« Laisser Mimmo choisir ») :
//   · matieres  : matières du bâtiment — façade (murs extérieurs), toiture (couverture), sols (pièces sèches du logement) ;
//   · deco      : décoration des pièces (tableaux, chevets, vases, tapis, plantes, luminaires) — Studio › Aménagement ;
//   · exterieur : aménagement extérieur et végétation (arbres, haies, massifs, allées) — Studio › Aménagement › Extérieurs.
// Le rendu n'est lancé que lorsque CHAQUE thème est choisi ou délégué (garde du serveur, studio.ts › lancerRendu, et
// boutons de lancement grisés côté site).
//
// TRANSPORT (aucune migration, aucun jeton) : chaque choix est une TRACE `copilot_action_runs` de la conversation
// (params.origine = « mimmoza-habillage », écrite par le site comme les comptes rendus du Studio) ; le serveur la relit
// (clé service) pour la garde, le rappel du devis et la fiche du travail (`fiche.habillage_projet`, et
// `fiche.amenagement_exterieur` = l'aménagement placé par l'utilisateur, format `mimmozia.amenagement-exterieur` v1).
// L'aménagement lui-même vient du Studio, publié dans le stockage local partagé (même origine) sous
// CLE_AMENAGEMENT_PARTAGE (mimmozia-studio › src/ui/exterieur/partageExterieur.ts — même clé, même forme).
// =============================================================================

export const ORIGINE_TRACE_HABILLAGE = 'mimmoza-habillage';
export const TYPE_TRACE_HABILLAGE = 'habillage-projet';
export const VERSION_HABILLAGE = 1;

export type ThemeHabillage = 'matieres' | 'deco' | 'exterieur';
export const THEMES_HABILLAGE: readonly ThemeHabillage[] = ['matieres', 'deco', 'exterieur'];
export type ModeTheme = 'choisi' | 'delegue';

export interface DefinitionTheme {
  theme: ThemeHabillage;
  titre: string;
  /** Ce que couvre le thème, et OÙ chaque choix s'applique. */
  detail: string;
  /** Page du Studio (pont du parcours : DemandeParcoursStudio). */
  studio: { etape: 'batiment' | 'amenagement'; sous: string; libelle: string };
  /** Commande du Studio envoyée par « Laisser Mimmo choisir » (registre du pont) ; null : rien à envoyer. */
  commandeMimmo: { id: string; params: Record<string, string | number | boolean>; libelle: string } | null;
  /** Ce que fait Mimmo quand le thème lui est délégué. */
  delegation: string;
  /** Accord de « choisi » avec le titre (« Matières : choisies », « Déco des pièces : choisie »). */
  choisi: string;
}

export const DEFINITIONS_THEMES: Readonly<Record<ThemeHabillage, DefinitionTheme>> = {
  matieres: {
    theme: 'matieres', titre: 'Matières',
    detail: 'Façade (murs extérieurs), toiture (couverture du toit) et sols (pièces sèches du logement).',
    studio: { etape: 'batiment', sous: 'materiaux', libelle: 'Bâtiment › Matériaux' },
    commandeMimmo: null,
    delegation: 'matières proposées par Mimmo (habillage par défaut du projet)',
    choisi: 'choisies',
  },
  deco: {
    theme: 'deco', titre: 'Déco des pièces',
    detail: 'Tableaux, objets sur les chevets, vases, tapis, grandes plantes et luminaires, pièce par pièce.',
    studio: { etape: 'amenagement', sous: 'interieur', libelle: 'Aménagement › Intérieur (onglet Déco)' },
    commandeMimmo: { id: 'interieur-decorer', params: {}, libelle: 'Mimmo décore le logement' },
    delegation: 'Mimmo décore chaque pièce selon le style et la gamme',
    choisi: 'choisie',
  },
  exterieur: {
    theme: 'exterieur', titre: 'Extérieurs et végétation',
    detail: 'Arbres, haies en limite, massifs au pied des façades, allée jusqu’à la porte, pots.',
    studio: { etape: 'amenagement', sous: 'vegetation', libelle: 'Aménagement › Extérieurs' },
    commandeMimmo: { id: 'exterieur-mimmo-plante', params: { densite: 'standard' }, libelle: 'Mimmo plante les extérieurs' },
    delegation: 'Mimmo plante le jardin (densité standard)',
    choisi: 'choisis',
  },
};

export interface ChoixTheme { mode: ModeTheme; resume: string | null; le: string }
export interface HabillageProjet {
  themes: Partial<Record<ThemeHabillage, ChoixTheme>>;
  /** Aménagement extérieur placé par l'utilisateur (thème « exterieur » choisi) ; null : composition automatique. */
  amenagement: Record<string, unknown> | null;
}

export const habillageVide = (): HabillageProjet => ({ themes: {}, amenagement: null });

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const txt = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, max) : null);
const estTheme = (v: unknown): v is ThemeHabillage => typeof v === 'string' && (THEMES_HABILLAGE as readonly string[]).includes(v);

/* ───────────────────────── Aménagement extérieur transporté ───────────────────────── */

export const FORMAT_AMENAGEMENT = 'mimmozia.amenagement-exterieur';
/** JSON au plus (600 éléments du Studio tiennent largement) : au-delà, refusé et DIT. */
export const AMENAGEMENT_MAX_CARACTERES = 200_000;
export const AMENAGEMENT_MAX_ELEMENTS = 600;

export type LectureAmenagement = { ok: true; amenagement: Obj; elements: number } | { ok: false; raison: string };

/** Contrôle de forme (le worker le relit en strict : normaliserAmenagement du Studio). */
export function amenagementTransportable(brut: unknown): LectureAmenagement {
  if (!estObj(brut)) return { ok: false, raison: 'aménagement illisible' };
  if (brut.format !== FORMAT_AMENAGEMENT || brut.version !== 1) return { ok: false, raison: 'format d’aménagement inconnu' };
  if (!Array.isArray(brut.elements)) return { ok: false, raison: 'aménagement sans liste d’éléments' };
  if (brut.elements.length > AMENAGEMENT_MAX_ELEMENTS) return { ok: false, raison: `plus de ${AMENAGEMENT_MAX_ELEMENTS} éléments placés` };
  let taille = 0;
  try { taille = JSON.stringify(brut).length; } catch { return { ok: false, raison: 'aménagement illisible' }; }
  if (taille > AMENAGEMENT_MAX_CARACTERES) return { ok: false, raison: 'aménagement trop volumineux' };
  return { ok: true, amenagement: brut, elements: brut.elements.length };
}

const FAMILLES: Readonly<Record<string, [string, string]>> = {
  arbre: ['arbre', 'arbres'], arbuste: ['arbuste', 'arbustes'], pot: ['pot', 'pots'], haie: ['haie', 'haies'],
  massif: ['massif', 'massifs'], surface: ['surface', 'surfaces'], allee: ['allée', 'allées'], cloture: ['clôture', 'clôtures'],
};

/** « 3 arbres, 2 haies, 1 allée » ; « aucun élément placé ». */
export function resumeAmenagement(a: unknown): string {
  const els = estObj(a) && Array.isArray(a.elements) ? a.elements.filter(estObj) : [];
  if (!els.length) return 'aucun élément placé';
  const n = new Map<string, number>();
  for (const e of els) { const f = typeof e.famille === 'string' && FAMILLES[e.famille] ? e.famille : 'autre'; n.set(f, (n.get(f) ?? 0) + 1); }
  return [...n.entries()].map(([f, k]) => (f === 'autre' ? `${k} autre${k > 1 ? 's' : ''}` : `${k} ${FAMILLES[f]![k > 1 ? 1 : 0]}`)).join(', ');
}

/** Clé du stockage local partagé avec le Studio (même origine). Valeur : { v: 1, projetId, amenagement, le }. */
export const CLE_AMENAGEMENT_PARTAGE = 'mimmoza.studio.amenagement-exterieur';
export interface StockageLecture { getItem(cle: string): string | null }

/** Aménagement publié par le Studio relié au projet `projetId` (`mzchat-<conversation>`) ; null sinon. */
export function lireAmenagementPartage(s: StockageLecture | null, projetId: string): { amenagement: Obj; elements: number; le: string } | null {
  if (!s) return null;
  let brut: unknown;
  try { brut = JSON.parse(s.getItem(`${CLE_AMENAGEMENT_PARTAGE}.${projetId}`) ?? 'null'); } catch { return null; }
  if (!estObj(brut) || brut.v !== 1 || brut.projetId !== projetId) return null;
  const l = amenagementTransportable(brut.amenagement);
  if (!l.ok) return null;
  return { amenagement: l.amenagement, elements: l.elements, le: typeof brut.le === 'string' ? brut.le : '' };
}

/* ───────────────────────── Traces (copilot_action_runs) ───────────────────────── */

/** `params` de la trace d'un choix de thème (écrite par le site ; relue par le serveur). */
export function paramsTraceHabillage(theme: ThemeHabillage, mode: ModeTheme, o: { resume?: string | null; amenagement?: Obj | null; le: string }): Obj {
  return {
    origine: ORIGINE_TRACE_HABILLAGE, type: TYPE_TRACE_HABILLAGE, v: VERSION_HABILLAGE, theme, mode,
    resume: txt(o.resume, 300), le: o.le,
    ...(theme === 'exterieur' && mode === 'choisi' && o.amenagement ? { amenagement: o.amenagement } : {}),
  };
}

export function estTraceHabillage(p: unknown): boolean {
  return estObj(p) && p.origine === ORIGINE_TRACE_HABILLAGE && p.type === TYPE_TRACE_HABILLAGE;
}

/**
 * État de l'habillage d'après les traces (params), dans n'importe quel ordre : le choix le PLUS RÉCENT (`le`) de chaque
 * thème l'emporte. Traces illisibles ignorées (jamais devinées).
 */
export function habillageDesTraces(traces: readonly unknown[]): HabillageProjet {
  const h = habillageVide();
  let amenagementLe = '';
  for (const p of traces) {
    if (!estTraceHabillage(p)) continue;
    const t = p as Obj;
    if (!estTheme(t.theme) || (t.mode !== 'choisi' && t.mode !== 'delegue') || typeof t.le !== 'string') continue;
    const avant = h.themes[t.theme];
    if (avant && avant.le >= t.le) continue;
    h.themes[t.theme] = { mode: t.mode, resume: txt(t.resume, 300), le: t.le };
    if (t.theme === 'exterieur') {
      const l = t.mode === 'choisi' ? amenagementTransportable(t.amenagement) : null;
      if (t.le >= amenagementLe) { h.amenagement = l?.ok ? l.amenagement : null; amenagementLe = t.le; }
    }
  }
  return h;
}

export function themesManquants(h: HabillageProjet): ThemeHabillage[] {
  return THEMES_HABILLAGE.filter((t) => !h.themes[t]);
}
export const habillageComplet = (h: HabillageProjet): boolean => themesManquants(h).length === 0;

/** Une ligne par thème, pour le rappel (carte de scénario, devis, fiche). */
export function rappelHabillage(h: HabillageProjet): string[] {
  return THEMES_HABILLAGE.map((t) => {
    const d = DEFINITIONS_THEMES[t];
    const c = h.themes[t];
    if (!c) return `${d.titre} : à choisir`;
    if (c.mode === 'delegue') return `${d.titre} : ${d.delegation}`;
    if (t === 'exterieur') {
      return `${d.titre} : ${d.choisi} par vous dans le Studio — ${h.amenagement ? `${resumeAmenagement(h.amenagement)}, posés tels quels au rendu` : 'aucun élément placé transmis, jardin composé automatiquement'}`;
    }
    return `${d.titre} : ${d.choisi} par vous dans le Studio${c.resume ? ` — ${c.resume}` : ''}`;
  });
}

/** Bloc écrit dans `studio_jobs.fiche.habillage_projet` (lisible par la machine de rendu et l'historique). */
export function ficheHabillage(h: HabillageProjet): Obj {
  return {
    v: VERSION_HABILLAGE,
    themes: Object.fromEntries(THEMES_HABILLAGE.filter((t) => h.themes[t]).map((t) => [t, { mode: h.themes[t]!.mode, resume: h.themes[t]!.resume }])),
    rappel: rappelHabillage(h),
  };
}

export const TYPES_RENDU_HABILLAGE = ['film', 'image', 'visite360'] as const;
export type TypeRenduHabillage = typeof TYPES_RENDU_HABILLAGE[number];
const QUOI: Record<TypeRenduHabillage, string> = { film: 'le film', image: 'l’image', visite360: 'la visite 360°' };

/** Message envoyé par la carte une fois tout choisi (image, visite : un seul message, le devis suit). */
export function messageHabillageTermine(type: TypeRenduHabillage): string {
  return `Habillage du projet choisi : établis le devis pour ${QUOI[type]}.`;
}

/** Garde du serveur : null si tout est choisi ou délégué ; sinon la sortie partielle de l'outil (aucun devis, rien lancé). */
export function gardeHabillage(h: HabillageProjet, type: TypeRenduHabillage): { status: 'partial'; data: Obj; message: string } | null {
  const manquants = themesManquants(h);
  if (!manquants.length) return null;
  return {
    status: 'partial',
    data: { habillage_requis: true, carte: 'habillage_projet', type, manquants, rappel: rappelHabillage(h) },
    message: `RIEN N’A ÉTÉ LANCÉ, AUCUN DEVIS. Avant ${QUOI[type]}, Mimmo propose l’étape « Habiller le projet » : ` +
      `${manquants.map((t) => DEFINITIONS_THEMES[t].titre.toLowerCase()).join(', ')} restent à choisir. La carte « Habiller le projet » s’affiche sous ta réponse : ` +
      'chaque thème a un bouton qui ouvre sa page dans le Studio et un bouton « Laisser Mimmo choisir ». Dis-le en UNE phrase, ne pose aucune autre question, ' +
      'n’établis aucun devis : le rendu sera proposé dès que chaque thème sera choisi ou délégué.',
  };
}

/** Sortie de l'outil studio_lancer_rendu demandant l'habillage (lue par la carte du chat) ; null sinon. */
export function lireDemandeHabillage(tc: { name: string; status?: string; output?: unknown }): { type: TypeRenduHabillage } | null {
  if (tc.name !== 'studio_lancer_rendu' || tc.status === 'running') return null;
  const o = tc.output;
  if (!estObj(o) || !estObj(o.data) || o.data.habillage_requis !== true || o.data.carte !== 'habillage_projet') return null;
  const type = (TYPES_RENDU_HABILLAGE as readonly unknown[]).includes(o.data.type) ? o.data.type as TypeRenduHabillage : 'image';
  return { type };
}

/**
 * Fiche du travail complétée par l'habillage (site : lancement direct depuis l'Espace 3D ; serveur : studio.ts).
 * `amenagement_exterieur` : l'aménagement placé par l'utilisateur, relu par la machine de rendu et transmis à l'étape
 * scène comme `charge.amenagementExterieurMimmoza` (worker/src/fiche.ts — voir le rapport VIS-57).
 */
export function ficheAvecHabillage<F extends object>(fiche: F, h: HabillageProjet): F {
  if (!THEMES_HABILLAGE.some((t) => h.themes[t])) return fiche;
  return { ...fiche, habillage_projet: ficheHabillage(h), ...(h.amenagement ? { amenagement_exterieur: h.amenagement } : {}) } as F;
}
