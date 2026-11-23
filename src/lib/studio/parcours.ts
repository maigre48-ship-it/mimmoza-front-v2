// src/lib/studio/parcours.ts
// =============================================================================
// VIS-17 (20/11/2026) — PARCOURS GUIDÉ « image / film / visite 360° ».
//
// Demande du fondateur (20/11) : « que le tchat et l'écran à droite avec Mimmo montrent toutes les étapes à réaliser
// pour créer une image ou un film […] qu'on puisse cliquer directement dessus. » Ce module PUR définit les trois
// parcours, CALCULE le statut de chaque étape depuis l'état réel (jamais déclaré par le modèle) et produit :
//   · la liste affichée dans le panneau Espace 3D et la carte « Votre parcours » du chat (mêmes étapes, mêmes actions) ;
//   · le bloc système « PARCOURS — FAIT FOI » relu par Mimmo à chaque message (copilot-chat).
//
// Sources (assemblées par l'appelant, jamais devinées ici) :
//   · base : mission de conception (agent_missions), 3D préparée (studio_preparations / outil studio_preparer_3d),
//     rendus (studio_jobs : aperçu / final, image / film / visite) ;
//   · conversation : habillage validé (bloc mimmoza-brief), aperçu validé (bloc mimmoza-parcours, message de
//     l'utilisateur, donc en base) ;
//   · écran : brief projet de l'étude (vues, lumière, saison, gamme — userStorage), réglages du film / de la visite.
// Code PUR, sans accès au navigateur : partagé par le front (node --test) et l'Edge Function (Deno).
// =============================================================================
import { libelleCourtVue, PACK_PLAQUETTE, VUES_CATALOGUE, type VueCatalogue } from './catalogueVues.ts';
// VIS-18b : fond de l'image choisi dans l'étape 6 (mêmes règles que la base et le serveur).
import { fondDe, validerFond, type OptionsFond } from './fondImage.ts';

export type TypeParcours = 'image' | 'film' | 'visite';
export const TYPES_PARCOURS: readonly TypeParcours[] = ['image', 'film', 'visite'];
export const LIBELLES_TYPE_PARCOURS: Readonly<Record<TypeParcours, string>> = { image: 'Images', film: 'Film', visite: 'Visite 360°' };

export type StatutEtape = 'fait' | 'en_cours' | 'a_faire' | 'facultative' | 'bloquee';
export const LIBELLES_STATUT_ETAPE: Readonly<Record<StatutEtape, string>> = {
  fait: 'Fait', en_cours: 'En cours', a_faire: 'À faire', facultative: 'Facultative', bloquee: 'Bloquée',
};

export type CleEtape = 'terrain' | 'conception' | 'volume' | 'style' | 'interieurs' | 'vues' | 'scenario' | 'pieces' | 'apercu' | 'final';

/**
 * Où mène le clic sur une étape — TOUJOURS un outil existant :
 *   chat             : message envoyé à Mimmo (valider / suivre la conception, préparation de la 3D) ;
 *   terrain          : VIS-20 — champ « adresse ou parcelle(s) » de l'étape 1 et carte cadastrale du panneau Espace 3D
 *                      (sélection multiple = assiette) ; la confirmation part en message à Mimmo, DANS le chat ;
 *   programme        : VIS-20 — champs de l'étape 2 (logements, niveaux, typologies) → mission de conception proposée
 *                      par Mimmo dans le chat (jamais la page Programmation) ;
 *   dimensions       : fiche « Forme et dimensions » de l'Espace 3D (volume du moteur, modifiable) ;
 *   studio-batiment  : Studio intégré, étape « Bâtiment » (édition du volume, façades, matériaux) ;
 *   habillage        : section « Style et habillage » de l'Espace 3D (carte Brief créatif) ;
 *   studio-interieur : Studio intégré, étape « Aménagement → Intérieur » (plan, meubles, finitions du logement témoin) ;
 *   reglages-rendu   : « Brief relié au rendu » (vues, lumière, saison, gamme) dans l'Espace 3D ;
 *   feuille-image / feuille-film / feuille-visite : feuille d'options « Film, visite 360° ou image » (FilmVisitePanel) ;
 *   apercu           : feuille image en « aperçu rapide » ;   final : feuille du rendu final ;
 *   resultats        : rendus déjà réalisés (voir, valider l'aperçu, télécharger).
 */
export type CibleParcours = 'chat' | 'terrain' | 'programme' | 'dimensions' | 'studio-batiment' | 'habillage' | 'studio-interieur' | 'reglages-rendu'
  | 'feuille-image' | 'feuille-film' | 'feuille-visite' | 'apercu' | 'final' | 'resultats';

export interface ActionParcours { cible: CibleParcours; libelle: string; message?: string }

export interface EtapeParcours {
  cle: CleEtape;
  numero: number;
  titre: string;
  statut: StatutEtape;
  /** Une ligne : ce qui a été choisi / produit, ou ce qui est proposé. */
  resume: string;
  /** Étape bloquée ou à faire : pourquoi, en clair. */
  raison: string | null;
  /** Étape bloquée : celle qui la débloque. */
  debloquePar: CleEtape | null;
  action: ActionParcours;
  /** Second accès utile (ex. gamme du logement témoin), facultatif. */
  actionSecondaire?: ActionParcours;
  /**
   * VIS-18b — petit réglage affiché DANS l'étape (pas de nouvel écran) : `cible` (étape 4) et `gamme` (étape 5) quand
   * aucune étude Style & tendances n'est rattachée ; `fond` (étape 6 du parcours Images : étude / photo de rue / photo).
   */
  reglage?: 'cible' | 'gamme' | 'fond' | 'terrain' | 'programme';
}

export interface Parcours {
  type: TypeParcours;
  etapes: EtapeParcours[];
  /** Première étape à faire / en cours (null : tout est fait). */
  courante: CleEtape | null;
  termine: boolean;
}

/** Rendu de la conversation (ligne studio_jobs normalisée). */
export interface TravailParcours {
  id: string;
  type: 'image' | 'film' | 'visite360';
  statut: string;
  /** VIS-18b : lue pour les trois types (film / visite : `options.qualite`, absente = finale). */
  qualite: 'apercu' | 'finale' | null;
  cree_le: string;
  vues: VueCatalogue[];
  nbImages: number;
  livraison: boolean;
}

export interface ReglagesFilm { duree_s: number; format: string; musique: boolean; interieurs: boolean; ambiance: string | null }
export interface ReglagesVisite { interieurs: boolean; resolution: string; ambiance: string | null }

export interface SourcesParcours {
  type: TypeParcours;
  /** « AI0001 + AI0002 (2 349 m²) · Ascain » ; null : aucun terrain connu. */
  terrain: string | null;
  /** Mission de conception (statut réel) ou fiche de projet décrite dans le chat (statut « fiche »). */
  conception: { statut: string; resume: string | null } | null;
  volume: { pret: boolean; resume: string | null };
  habillage: { resume: string | null; attenduParMimmo: boolean };
  /**
   * `gamme` : valeur du contrat (entree | standard | premium | luxe) ; `cible` : texte du brief (VIS-04).
   * VIS-18b — `origine` : « conversation » quand gamme / cible viennent du petit réglage du parcours (sans étude).
   */
  interieurs: {
    gamme: string | null; typologie: string | null; cible?: string | null; origine?: 'etude' | 'conversation' | null;
  };
  /**
   * VIS-18a / VIS-18b — logement témoin PERSONNALISÉ dans le Studio (src/spaces/copilot/studio3d/temoinStudio.ts :
   * lireTemoinPersonnalise / etatTemoinConversation ; serveur : ligne studio_temoins). `fait` : l'étape « Intérieurs »
   * est FAITE avec ce résumé, même sans gamme. Absent / null : règle d'avant (gamme).
   */
  temoinStudio?: { fait: boolean; resume: string | null } | null;
  rendu: { vues: VueCatalogue[]; vuesChoisies: boolean; ambiance: string | null; saison: string | null; fond: string | null; etudeRattachee: boolean };
  film: ReglagesFilm | null;
  visite: ReglagesVisite | null;
  travaux: TravailParcours[];
  /** Identifiant du rendu d'aperçu validé par l'utilisateur (bloc mimmoza-parcours), s'il y en a un. */
  apercuValide: string | null;
}

export function sourcesVides(type: TypeParcours = 'image'): SourcesParcours {
  return {
    type, terrain: null, conception: null, volume: { pret: false, resume: null },
    habillage: { resume: null, attenduParMimmo: false }, interieurs: { gamme: null, typologie: null, cible: null, origine: null },
    rendu: { vues: [], vuesChoisies: false, ambiance: null, saison: null, fond: null, etudeRattachee: false },
    film: null, visite: null, travaux: [], apercuValide: null, temoinStudio: null,
  };
}

// ── Petits libellés ─────────────────────────────────────────────────────────
const VUES_INTERIEURES: readonly string[] = ['sejour', 'chambre', 'vue_baie', 'hall'];
const AMBIANCES: Readonly<Record<string, string>> = { jour: 'en journée', fin_de_journee: 'fin de journée', crepuscule: 'crépuscule', nuit: 'de nuit' };
const SAISONS: Readonly<Record<string, string>> = { printemps: 'printemps', ete: 'été', automne: 'automne', hiver: 'hiver' };
const FONDS: Readonly<Record<string, string>> = { etude: 'fond d’étude', photo_rue: 'photo de la rue', photo_client: 'votre photo' };
const GAMMES: Readonly<Record<string, string>> = { entree: 'entrée de gamme', standard: 'gamme standard', premium: 'gamme premium', luxe: 'gamme luxe' };

/**
 * VIS-18b — petit réglage du parcours SANS étude rattachée (étapes 4 / 5) : trois gammes et quatre cibles, transmises
 * comme le brief projet (contrat v2 : `brief.gamme`, `brief.cible`, VIS-04). Les trois gammes sont les trois niveaux que
 * le moteur d'aménagement distingue (worker interieursImage.ts gammeDuBrief : économique / standard / premium) :
 * « Standard » = entree, « Confort » = standard, « Premium » = premium (« luxe » n'ajoute rien au moteur).
 * Les cibles sont des textes reconnus par le worker (cibleDuBrief : primo, famil, invest, senior).
 */
export const GAMMES_PARCOURS: readonly { valeur: 'entree' | 'standard' | 'premium'; libelle: string }[] = [
  { valeur: 'entree', libelle: 'Standard' }, { valeur: 'standard', libelle: 'Confort' }, { valeur: 'premium', libelle: 'Premium' },
];
export const CIBLES_PARCOURS: readonly string[] = ['Primo-accédants', 'Familles', 'Investisseurs', 'Seniors'];
const libelleGamme = (gamme: string, origine: string | null | undefined): string => (origine === 'conversation'
  ? `gamme ${(GAMMES_PARCOURS.find((g) => g.valeur === gamme)?.libelle ?? gamme).toLowerCase()}` : GAMMES[gamme] ?? gamme);
/** Gamme / cible du petit réglage, lues défensivement (stockage navigateur) ; valeurs hors liste écartées. */
export function lireReglageProjet(brut: unknown): { gamme: 'entree' | 'standard' | 'premium' | null; cible: string | null } {
  const o = typeof brut === 'object' && brut !== null && !Array.isArray(brut) ? brut as Record<string, unknown> : {};
  return {
    gamme: GAMMES_PARCOURS.some((g) => g.valeur === o.gamme) ? o.gamme as 'entree' | 'standard' | 'premium' : null,
    cible: CIBLES_PARCOURS.includes(o.cible as string) ? o.cible as string : null,
  };
}

/** « 3/4 gauche, aérienne et séjour ». */
export function phraseVuesCourte(vues: readonly string[]): string {
  const l = vues.filter((v) => (VUES_CATALOGUE as readonly string[]).includes(v)).map((v) => libelleCourtVue(v as VueCatalogue));
  return l.length <= 1 ? (l[0] ?? '') : `${l.slice(0, -1).join(', ')} et ${l[l.length - 1]}`;
}
const pluriel = (n: number, mot: string) => `${String(n)} ${mot}${n > 1 ? 's' : ''}`;
const ACTIFS = new Set(['en_attente', 'en_cours']);
const estActifStatut = (s: string) => ACTIFS.has(s);
const recents = (t: readonly TravailParcours[]) => [...t].sort((a, b) => Date.parse(b.cree_le) - Date.parse(a.cree_le));
const TYPE_TRAVAIL: Readonly<Record<TypeParcours, TravailParcours['type']>> = { image: 'image', film: 'film', visite: 'visite360' };

/** Vues qui partiront au rendu : celles choisies, sinon le pack plaquette proposé. */
export function vuesDuParcours(s: SourcesParcours): VueCatalogue[] {
  return s.rendu.vuesChoisies && s.rendu.vues.length ? [...s.rendu.vues] : [...PACK_PLAQUETTE];
}

/** Vue intérieure prévue par les choix du parcours (→ l'étape Intérieurs devient requise). */
export function interieurRequis(s: SourcesParcours): boolean {
  if (s.type === 'film') return s.film?.interieurs === true;
  if (s.type === 'visite') return s.visite?.interieurs === true;
  return vuesDuParcours(s).some((v) => VUES_INTERIEURES.includes(v));
}

const CONCEPTION_FAITE = new Set(['terminee', 'budget_atteint', 'fiche']);
const CONCEPTION_EN_COURS = new Set(['en_attente', 'en_cours', 'attente_utilisateur']);

export const MESSAGES_PARCOURS = {
  terrain: 'Aide-moi à choisir le terrain de mon projet (une parcelle ou une assiette de plusieurs parcelles).',
  conception: 'Lance la conception de mon projet sur ce terrain.',
  conceptionModifier: 'Je voudrais modifier le programme de mon projet.',
  volume: 'Prépare la 3D de mon projet à partir de la conception.',
} as const;

// ── Calcul ──────────────────────────────────────────────────────────────────

/** Calcule le parcours (statut, résumé, action de chaque étape) depuis l'état réel. Pur et déterministe. */
export function calculerParcours(s: SourcesParcours): Parcours {
  const etapes: EtapeParcours[] = [];
  const ajouter = (e: Omit<EtapeParcours, 'numero'>) => { etapes.push({ ...e, numero: etapes.length + 1 }); };
  const fait = (cle: CleEtape) => etapes.find((e) => e.cle === cle)?.statut === 'fait';

  // 1 — Terrain (une 3D préparée porte toujours sa parcelle)
  ajouter({
    cle: 'terrain', titre: 'Terrain', statut: s.terrain ? 'fait' : 'a_faire',
    resume: s.terrain ?? 'Parcelle ou assiette de plusieurs parcelles, à choisir avec Mimmo.',
    raison: null, debloquePar: null,
    // VIS-20 : le terrain se désigne DANS l'étape (champ + carte du panneau), jamais sur une autre page.
    action: { cible: 'terrain', libelle: s.terrain ? 'Modifier' : 'Choisir' },
    reglage: 'terrain',
  });

  // 2 — Programme & conception
  {
    const c = s.conception;
    const statut: StatutEtape = (c && CONCEPTION_FAITE.has(c.statut)) || (!c && s.volume.pret) ? 'fait'
      : c && CONCEPTION_EN_COURS.has(c.statut) ? 'en_cours'
      : !s.terrain && !c ? 'bloquee' : 'a_faire';
    const resume = statut === 'fait' ? (c?.resume ?? s.volume.resume ?? 'Conception terminée.')
      : statut === 'en_cours' ? 'Mission de conception en cours…'
      : c?.statut === 'devis' ? 'Mission de conception proposée : à valider (devis).'
      : c?.statut === 'echec' ? 'La dernière conception a échoué : à relancer.'
      : 'Programme (logements, niveaux) et conception sur le terrain.';
    ajouter({
      cle: 'conception', titre: 'Programme & conception', statut, resume,
      raison: statut === 'bloquee' ? 'Choisissez d’abord le terrain.' : null,
      debloquePar: statut === 'bloquee' ? 'terrain' : null,
      // VIS-20 : lancer / modifier = champs du programme de l'étape (mission proposée dans le chat) ; valider un devis ou
      // suivre une mission en cours = message à Mimmo.
      action: statut === 'fait' ? { cible: 'programme', libelle: 'Modifier' }
        : c?.statut === 'devis' || statut === 'en_cours'
          ? { cible: 'chat', libelle: c?.statut === 'devis' ? 'Valider' : 'Suivre', message: MESSAGES_PARCOURS.conception }
          : { cible: 'programme', libelle: 'Lancer' },
      ...(statut === 'en_cours' || c?.statut === 'devis' ? {} : { reglage: 'programme' as const }),
    });
  }

  // 3 — Volume 3D
  {
    const statut: StatutEtape = s.volume.pret ? 'fait' : fait('conception') ? 'a_faire' : 'bloquee';
    ajouter({
      cle: 'volume', titre: 'Volume 3D', statut,
      resume: s.volume.pret ? (s.volume.resume ?? '3D préparée.') : 'Le bâtiment en 3D, à voir et ajuster (forme, dimensions, niveaux).',
      raison: statut === 'bloquee' ? 'La 3D part de la conception terminée.' : null,
      debloquePar: statut === 'bloquee' ? 'conception' : null,
      action: s.volume.pret ? { cible: 'dimensions', libelle: 'Voir / ajuster' } : { cible: 'chat', libelle: 'Préparer', message: MESSAGES_PARCOURS.volume },
      ...(s.volume.pret ? { actionSecondaire: { cible: 'studio-batiment' as const, libelle: 'Ouvrir dans le Studio' } } : {}),
    });
  }

  // 4 — Style & façades
  {
    const h = s.habillage;
    const statut: StatutEtape = h.attenduParMimmo ? 'en_cours' : h.resume ? 'fait' : 'a_faire';
    // VIS-18b : cible du petit réglage (sans étude) rappelée dans le résumé ; celle d'une étude reste dans l'étude.
    const cible = s.interieurs.origine === 'conversation' && s.interieurs.cible ? ` · pour : ${s.interieurs.cible.toLowerCase()}` : '';
    ajouter({
      cle: 'style', titre: 'Style & façades', statut,
      resume: `${h.resume ?? 'Façade, teinte, menuiseries, balcons, toiture — ou laissez Mimmo proposer.'}${cible}`,
      raison: h.attenduParMimmo ? 'Mimmo attend votre habillage pour chiffrer le rendu.' : null, debloquePar: null,
      action: { cible: 'habillage', libelle: h.resume ? 'Modifier' : 'Choisir' },
      // VIS-18b : sans étude Style & tendances, la cible se règle ici (sinon : dans l'étude).
      ...(s.rendu.etudeRattachee ? {} : { reglage: 'cible' as const }),
    });
  }

  // 5 — Intérieurs (facultative sauf vue intérieure)
  {
    const requis = interieurRequis(s);
    const gamme = s.interieurs.gamme ? libelleGamme(s.interieurs.gamme, s.interieurs.origine) : null;
    const typo = s.interieurs.typologie ? `${s.interieurs.typologie}, ` : '';
    const perso = s.temoinStudio?.fait ? s.temoinStudio : null;
    const statut: StatutEtape = gamme || perso ? 'fait' : requis ? 'a_faire' : 'facultative';
    ajouter({
      cle: 'interieurs', titre: 'Intérieurs', statut,
      resume: perso
        ? `Logement témoin personnalisé dans le Studio${perso.resume ? ` : ${perso.resume}` : ''}${gamme ? ` (${gamme})` : ''}.`
        : gamme
        ? `Logement témoin ${typo}${gamme}, meublé par Mimmo — plan, meubles, sols et murs modifiables dans le Studio.`
        : requis ? 'Vos choix montrent l’intérieur d’un logement : choisissez la gamme du logement témoin (ou ajustez-le dans le Studio).'
        : 'Facultatif : utile seulement pour une vue intérieure (séjour, chambre…).',
      raison: requis && !gamme && !perso ? 'Vue intérieure prévue : le logement témoin doit être défini.' : null, debloquePar: null,
      action: { cible: 'studio-interieur', libelle: gamme || perso ? 'Modifier' : 'Ouvrir' },
      // VIS-18b : « Gamme » mène au brief de l'étude quand il y en a une ; sinon petit réglage dans l'étape.
      ...(s.rendu.etudeRattachee ? { actionSecondaire: { cible: 'reglages-rendu' as const, libelle: 'Gamme' } } : { reglage: 'gamme' as const }),
    });
  }

  // 6 — Vues & ambiance / Scénario / Pièces
  if (s.type === 'image') {
    const vues = vuesDuParcours(s);
    const detail = [
      s.rendu.ambiance ? AMBIANCES[s.rendu.ambiance] ?? s.rendu.ambiance : null,
      s.rendu.saison ? SAISONS[s.rendu.saison] ?? s.rendu.saison : null,
      s.rendu.fond ? FONDS[s.rendu.fond] ?? s.rendu.fond : null,
    ].filter(Boolean).join(' · ');
    ajouter({
      cle: 'vues', titre: 'Vues & ambiance', statut: s.rendu.vuesChoisies ? 'fait' : 'a_faire',
      resume: `${s.rendu.vuesChoisies ? '' : 'Proposé : '}${pluriel(vues.length, 'vue')} (${phraseVuesCourte(vues)})${detail ? ` · ${detail}` : ''}.`,
      raison: null, debloquePar: null,
      action: { cible: s.rendu.etudeRattachee ? 'reglages-rendu' : 'feuille-image', libelle: s.rendu.vuesChoisies ? 'Modifier' : 'Choisir' },
      // VIS-18b : fond de l'image (étude / photo de la rue / votre photo) choisi DANS l'étape, repris par le devis du chat.
      reglage: 'fond',
    });
  } else if (s.type === 'film') {
    const f = s.film;
    const aDeja = s.travaux.some((t) => t.type === 'film');
    ajouter({
      cle: 'scenario', titre: 'Scénario du film', statut: f || aDeja ? 'fait' : 'a_faire',
      resume: f ? [
        f.duree_s >= 60 ? `${String(Math.floor(f.duree_s / 60))} min${f.duree_s % 60 ? ` ${String(f.duree_s % 60)}` : ''}` : `${String(f.duree_s)} s`,
        f.format === '9:16' ? 'vertical (téléphone)' : 'paysage',
        f.ambiance ? AMBIANCES[f.ambiance] ?? f.ambiance : null,
        f.musique ? 'avec musique' : 'sans musique',
        f.interieurs ? 'avec les intérieurs' : 'extérieurs seulement',
      ].filter(Boolean).join(' · ') : 'Durée, format, lumière, musique, intérieurs (plans enchaînés par Mimmo).',
      raison: null, debloquePar: null,
      action: { cible: 'feuille-film', libelle: f ? 'Modifier' : 'Choisir' },
    });
  } else {
    const v = s.visite;
    const aDeja = s.travaux.some((t) => t.type === 'visite360');
    ajouter({
      cle: 'pieces', titre: 'Pièces & points de vue', statut: v || aDeja ? 'fait' : 'a_faire',
      resume: v ? [v.interieurs ? 'extérieurs et intérieurs' : 'extérieurs seulement', v.resolution === '8k' ? 'très haute qualité' : 'haute qualité',
        v.ambiance ? AMBIANCES[v.ambiance] ?? v.ambiance : null].filter(Boolean).join(' · ')
        : 'Points de vue autour du bâtiment, pièces du logement témoin, lumière.',
      raison: null, debloquePar: null,
      action: { cible: 'feuille-visite', libelle: v ? 'Modifier' : 'Choisir' },
    });
  }

  // 7 — Aperçu (rendu rapide) — VIS-18b : aperçu du MÊME type (image, film court ou panoramas basse définition).
  const apercus = recents(s.travaux.filter((t) => t.type === TYPE_TRAVAIL[s.type] && t.qualite === 'apercu'));
  const apercuValide = s.apercuValide ? apercus.find((t) => t.id === s.apercuValide && t.statut === 'termine') ?? null : null;
  {
    const enCours = apercus.find((t) => estActifStatut(t.statut));
    const pret = apercus.find((t) => t.statut === 'termine');
    const statut: StatutEtape = apercuValide && !enCours ? 'fait' : !s.volume.pret ? 'bloquee' : enCours || pret ? 'en_cours' : 'a_faire';
    const nb = apercuValide ? apercuValide.nbImages || apercuValide.vues.length : 0;
    const resumeValide = s.type === 'image' ? `Aperçu validé (${pluriel(nb, 'vue')}).` : s.type === 'film' ? 'Aperçu du film validé.' : 'Aperçu de la visite validé.';
    ajouter({
      cle: 'apercu', titre: 'Aperçu', statut,
      resume: statut === 'fait' ? resumeValide
        : enCours ? 'Aperçu rapide en calcul…'
        : pret ? 'Aperçu prêt : regardez-le, puis validez-le (ou corrigez une étape).'
        : s.type === 'image' ? 'Rendu rapide pour vérifier le cadrage et l’habillage avant le rendu final.'
        : s.type === 'film' ? 'Film court en basse définition (mêmes plans, 1,5 s par plan) pour vérifier le scénario avant le film final.'
        : 'Panoramas en basse définition (mêmes points de vue) pour vérifier la visite avant la version finale.',
      raison: statut === 'bloquee' ? 'L’aperçu se calcule sur la 3D préparée.' : null,
      debloquePar: statut === 'bloquee' ? 'volume' : null,
      action: statut === 'fait' ? { cible: 'resultats', libelle: 'Revoir' }
        : pret && !enCours ? { cible: 'resultats', libelle: 'Voir et valider' } : { cible: 'apercu', libelle: enCours ? 'Suivre' : 'Lancer l’aperçu' },
    });
  }

  // 8 — Final & livraison
  {
    const type = TYPE_TRAVAIL[s.type];
    const finals = recents(s.travaux.filter((t) => t.type === type && t.qualite !== 'apercu'));
    const termine = finals.find((t) => t.statut === 'termine');
    const enCours = finals.find((t) => estActifStatut(t.statut));
    const statut: StatutEtape = enCours ? 'en_cours' : termine ? 'fait' : !apercuValide ? 'bloquee' : 'a_faire';
    const titre = s.type === 'image' ? 'Images finales & livraison' : s.type === 'film' ? 'Film final' : 'Visite 360° finale';
    const n = termine ? termine.nbImages || termine.vues.length : 0;
    const resumeFait = !termine ? '' : s.type === 'image'
      ? `${pluriel(n, 'image')} livrée${n > 1 ? 's' : ''}${termine.livraison ? ' · formats, ZIP et plan de vente' : ''}.`
      : s.type === 'film' ? 'Film prêt à voir et télécharger.' : 'Visite prête : lien à partager.';
    ajouter({
      cle: 'final', titre, statut,
      resume: statut === 'fait' ? resumeFait : statut === 'en_cours' ? 'Rendu final en calcul…'
        : s.type === 'image' ? 'Haute définition, formats annonce et plaquette, ZIP, plan de vente.' : s.type === 'film' ? 'Film en qualité finale, prêt à partager.' : 'Visite 360° à partager par lien.',
      raison: statut === 'bloquee' ? 'Validez d’abord l’aperçu.' : null,
      debloquePar: statut === 'bloquee' ? 'apercu' : null,
      action: statut === 'fait' ? { cible: 'resultats', libelle: 'Voir' } : statut === 'en_cours' ? { cible: 'resultats', libelle: 'Suivre' } : { cible: 'final', libelle: 'Lancer' },
    });
  }

  const courante = etapes.find((e) => e.statut === 'en_cours' || e.statut === 'a_faire')?.cle ?? null;
  return { type: s.type, etapes, courante, termine: etapes.every((e) => e.statut === 'fait' || e.statut === 'facultative') };
}

/** Étape à proposer en bouton principal (la courante), ou null quand tout est fait. */
export function prochaineEtape(p: Parcours): EtapeParcours | null {
  return p.courante ? p.etapes.find((e) => e.cle === p.courante) ?? null : null;
}

/** Étape vers laquelle mène un clic : une étape bloquée mène à celle qui la débloque. */
export function etapeDuClic(p: Parcours, cle: CleEtape): EtapeParcours | null {
  let e = p.etapes.find((x) => x.cle === cle) ?? null;
  for (let i = 0; e && e.statut === 'bloquee' && e.debloquePar && i < 10; i++) {
    const suivante: CleEtape = e.debloquePar;
    e = p.etapes.find((x) => x.cle === suivante) ?? null;
  }
  return e;
}

/** Nombre d'étapes faites (facultatives non comptées) / à compter, pour « 3 sur 8 ». */
export function avancement(p: Parcours): { faites: number; total: number } {
  const comptees = p.etapes.filter((e) => e.statut !== 'facultative');
  return { faites: comptees.filter((e) => e.statut === 'fait').length, total: comptees.length };
}

// ── Lecture des sources ─────────────────────────────────────────────────────

/** Terrain d'une mission de conception (critères : idu, parcel_ids, idus, parcelles) : « AI0001 + AI0002 » ; null sinon. */
export function terrainDesCriteres(criteres: unknown): string | null {
  if (typeof criteres !== 'object' || criteres === null || Array.isArray(criteres)) return null;
  const c = criteres as Record<string, unknown>;
  const liste = [c.parcel_ids, c.idus, c.parcelles].find((v) => Array.isArray(v) && v.length) as unknown[] | undefined;
  const ids = (liste ?? (typeof c.idu === 'string' ? [c.idu] : [])).filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim()).map((v) => (/^\d[\dAB]\d{3}[\dA-Z]{3}[A-Z0-9]{2}\d{4}$/.test(v) ? v.slice(8) : v)); // IDU complet → section + numéro
  const commune = typeof c.commune === 'string' && c.commune.trim() ? ` · ${c.commune.trim()}` : '';
  return ids.length ? `${ids.slice(0, 6).join(' + ')}${commune}` : null;
}

/** Programme demandé dans les critères d'une mission (« petit collectif R+2 ») ; null sinon. */
export function programmeDesCriteres(criteres: unknown): string | null {
  const p = typeof criteres === 'object' && criteres !== null ? (criteres as Record<string, unknown>).programme : null;
  return typeof p === 'string' && p.trim() ? `Programme demandé : ${p.trim().slice(0, 120)}.` : null;
}

const estObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Ligne studio_jobs (front ou base) → rendu du parcours ; null si illisible. */
export function travailParcours(brut: unknown): TravailParcours | null {
  if (!estObj(brut)) return null;
  const type = brut.type === 'image' || brut.type === 'film' || brut.type === 'visite360' ? brut.type : null;
  const id = typeof brut.id === 'string' ? brut.id : null;
  if (!type || !id || typeof brut.statut !== 'string') return null;
  const o = estObj(brut.options) ? brut.options : {};
  const r = estObj(brut.resultat) ? brut.resultat : {};
  // VIS-18b : film et visite ont aussi un aperçu (`options.qualite`) ; absente = finale.
  const qualite = o.qualite === 'apercu' ? 'apercu' : 'finale';
  const vues = (Array.isArray(o.vues) ? o.vues : []).filter((v): v is VueCatalogue => (VUES_CATALOGUE as readonly unknown[]).includes(v));
  return {
    id, type, statut: brut.statut, qualite, cree_le: typeof brut.cree_le === 'string' ? brut.cree_le : new Date(0).toISOString(),
    vues, nbImages: Array.isArray(r.images) ? r.images.length : 0, livraison: estObj(r.livraison_commerciale),
  };
}

const RE_BLOC = /```mimmoza-parcours\s*\n([\s\S]*?)\n?```/;

/** Bloc ```mimmoza-parcours``` d'un message de l'utilisateur (validation d'aperçu) ; texte visible sans le bloc. */
export function lireBlocParcours(texte: string): { visible: string; apercuValide: string | null; present: boolean } {
  const t = texte ?? '';
  const m = RE_BLOC.exec(t);
  if (!m) return { visible: t, apercuValide: null, present: false };
  let id: string | null = null;
  try {
    const o = JSON.parse(m[1]) as unknown;
    if (estObj(o) && typeof o.apercu_valide === 'string' && /^[0-9a-f-]{36}$/i.test(o.apercu_valide)) id = o.apercu_valide;
  } catch { id = null; }
  return { visible: t.replace(RE_BLOC, '').trim(), apercuValide: id, present: true };
}

/** Message envoyé par « Valider l'aperçu » : phrase lisible + bloc relu par l'écran et par le serveur. */
export function messageValidationApercu(travailId: string, type: TypeParcours): string {
  const suite = type === 'image' ? 'les images finales' : type === 'film' ? 'le film final' : 'la visite 360° finale';
  return `J’ai regardé l’aperçu et je le valide : on peut passer à ${suite}.\n\n\`\`\`mimmoza-parcours\n${JSON.stringify({ apercu_valide: travailId })}\n\`\`\``;
}

/** Dernier aperçu validé dans les messages de l'utilisateur (textes, du plus ancien au plus récent). */
export function apercuValideDesMessages(textes: readonly string[]): string | null {
  for (let i = textes.length - 1; i >= 0; i--) { const id = lireBlocParcours(textes[i]).apercuValide; if (id) return id; }
  return null;
}

const RE_FILM = /(^|[^\p{L}])(films?|vid[ée]os?|clips?)(?![\p{L}])/iu;
const RE_VISITE = /(^|[^\p{L}])(visites?\s*(?:virtuelles?|360)|360\s*°?)(?![\p{L}\d])/iu;
const RE_IMAGE = /(^|[^\p{L}])(images?|visuels?|perspectives?|plaquettes?|rendus?)(?![\p{L}])/iu;

/** Type de parcours demandé par un message (null : le message ne parle pas de visuels). */
export function typeParcoursDuTexte(texte: string | null | undefined): TypeParcours | null {
  const t = texte ?? '';
  if (RE_VISITE.test(t)) return 'visite';
  if (RE_FILM.test(t)) return 'film';
  if (RE_IMAGE.test(t)) return 'image';
  return null;
}

/** Dernier type de parcours demandé dans la conversation (textes de l'utilisateur), sinon « image ». */
export function typeParcoursDesMessages(textes: readonly string[]): TypeParcours {
  for (let i = textes.length - 1; i >= 0; i--) { const t = typeParcoursDuTexte(lireBlocParcours(textes[i]).visible); if (t) return t; }
  return 'image';
}

/** Instantané envoyé par l'écran (context.parcours) : ce que seul l'écran connaît (brief projet local, réglages). */
export interface InstantaneParcours {
  type: TypeParcours | null;
  habillage: string | null;
  interieurs: { gamme: string | null; typologie: string | null; cible?: string | null; origine?: 'etude' | 'conversation' | null };
  /** VIS-18b — `fond` : fond de l'image choisi dans l'étape 6 (options normalisées, validées comme par la base). */
  rendu: { vues: VueCatalogue[]; vuesChoisies: boolean; ambiance: string | null; saison: string | null; etudeRattachee: boolean; fond?: OptionsFond | null };
  film: ReglagesFilm | null;
  visite: ReglagesVisite | null;
}

const txt = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, max) : null);

/** Lecture DÉFENSIVE de l'instantané (côté serveur) : tout ce qui est hors format est écarté. */
export function lireInstantaneParcours(brut: unknown): InstantaneParcours | null {
  if (!estObj(brut)) return null;
  const r = estObj(brut.rendu) ? brut.rendu : {};
  const i = estObj(brut.interieurs) ? brut.interieurs : {};
  const f = estObj(brut.film) ? brut.film : null;
  const v = estObj(brut.visite) ? brut.visite : null;
  const vues = (Array.isArray(r.vues) ? r.vues : []).filter((x): x is VueCatalogue => (VUES_CATALOGUE as readonly unknown[]).includes(x)).slice(0, 6);
  const duree = f && typeof f.duree_s === 'number' && [30, 60, 90].includes(f.duree_s) ? f.duree_s : null;
  return {
    type: (TYPES_PARCOURS as readonly unknown[]).includes(brut.type) ? brut.type as TypeParcours : null,
    habillage: txt(brut.habillage, 300),
    // VIS-18b : cible / origine / fond ajoutés SEULEMENT s'ils sont présents (instantané d'avant : lecture identique).
    interieurs: {
      gamme: txt(i.gamme, 20), typologie: txt(i.typologie, 10),
      ...(txt(i.cible, 60) ? { cible: txt(i.cible, 60) } : {}),
      ...(i.origine === 'etude' || i.origine === 'conversation' ? { origine: i.origine } : {}),
    },
    rendu: {
      vues, vuesChoisies: r.vuesChoisies === true && vues.length > 0, ambiance: txt(r.ambiance, 20), saison: txt(r.saison, 20), etudeRattachee: r.etudeRattachee === true,
      ...(fondLu(r.fond) ? { fond: fondLu(r.fond) } : {}),
    },
    film: f && duree !== null ? { duree_s: duree, format: f.format === '9:16' ? '9:16' : '16:9', musique: f.musique === true, interieurs: f.interieurs === true, ambiance: txt(f.ambiance, 20) } : null,
    visite: v ? { interieurs: v.interieurs === true, resolution: v.resolution === '8k' ? '8k' : '6k', ambiance: txt(v.ambiance, 20) } : null,
  };
}

/** VIS-18b — fond de l'instantané : mêmes règles que la base (validerFond) ; illisible ou hors format → null. */
function fondLu(brut: unknown): OptionsFond | null {
  if (!estObj(brut) || Object.keys(brut).some((k) => !['fond', 'photo_rue', 'photo_client'].includes(k))) return null;
  const v = validerFond(brut);
  return v.ok ? v.valeur : null; // étude seule : {} (fond par défaut, jamais recopié)
}

/**
 * VIS-18b — fond choisi dans l'étape 6 du parcours (instantané envoyé par l'écran), pour le devis d'une image
 * (studio_lancer_rendu) quand ni la carte ni la demande ne fixent de fond. null : rien de choisi.
 */
export function fondDuParcours(instantaneBrut: unknown): OptionsFond | null {
  return lireInstantaneParcours(instantaneBrut)?.rendu.fond ?? null;
}

/** Instantané de l'écran → sources (le reste vient de la base, côté serveur). */
export function sourcesDeLInstantane(i: InstantaneParcours | null, type: TypeParcours): SourcesParcours {
  const s = sourcesVides(i?.type ?? type);
  if (!i) return s;
  return {
    ...s,
    habillage: { resume: i.habillage, attenduParMimmo: false },
    interieurs: { ...i.interieurs },
    rendu: { ...s.rendu, ...i.rendu, fond: i.rendu.fond ? fondDe(i.rendu.fond) : null },
    film: i.film, visite: i.visite,
  };
}

// ── Bloc système (copilot-chat) ─────────────────────────────────────────────

const STATUT_MAJ: Readonly<Record<StatutEtape, string>> = { fait: 'FAIT', en_cours: 'EN COURS', a_faire: 'À FAIRE', facultative: 'FACULTATIVE', bloquee: 'BLOQUÉE' };

/** Bloc « PARCOURS — FAIT FOI », relu à chaque message. */
export function blocParcoursSysteme(p: Parcours): string {
  const prochaine = prochaineEtape(p);
  const lignes = p.etapes.map((e) => `${String(e.numero)}. ${e.titre} — ${STATUT_MAJ[e.statut]} — ${e.resume}${e.raison ? ` (${e.raison})` : ''}`);
  return [
    '---',
    `# PARCOURS ${LIBELLES_TYPE_PARCOURS[p.type].toUpperCase()} — FAIT FOI (calculé à l’instant depuis l’état réel : missions, 3D préparée, rendus, brief du projet)`,
    'L’écran montre ce parcours (panneau Espace 3D et carte « Votre parcours » du chat, étapes cliquables).',
    ...lignes,
    prochaine ? `PROCHAINE ÉTAPE : ${String(prochaine.numero)}. ${prochaine.titre}.` : 'Toutes les étapes sont faites.',
    'CONSIGNES : guide l’utilisateur PAS À PAS dans cet ordre. Quand tu parles d’image, de film, de visite ou de plaquette, termine ta réponse en',
    'proposant UNE prochaine étape (celle ci-dessus), en une phrase, avec son numéro et son nom (« Étape 4 — Style & façades : … »).',
    'Ne saute pas la personnalisation (style, intérieurs si une vue intérieure est prévue, vues) sans le dire. Ne lance JAMAIS de rendu final de toi-même',
    '(qualité finale, film, visite) tant que l’étape « Aperçu » n’est pas FAITE (aperçu validé) : propose d’abord l’aperçu. Une demande directe',
    '(« lance le pack plaquette ») reste possible : fais-la, mais signale en une phrase les étapes NON FAITES qui comptent (vue intérieure sans',
    'logement témoin, habillage non choisi, aperçu non validé). Ne déclare jamais une étape faite toi-même : seul ce bloc fait foi.',
    'L’aperçu se lance avec studio_lancer_rendu et options.qualite = "apercu" : type « image » (mêmes vues que le rendu final prévu), « film »',
    '(film court basse définition, mêmes plans) ou « visite360 » (panoramas basse définition) — mêmes autres options que le rendu final prévu ;',
    'l’utilisateur le valide ensuite d’un clic sur l’écran. Pas de mots techniques (aucun nom d’outil) en parlant des étapes à l’utilisateur.',
    '---',
  ].join('\n');
}
