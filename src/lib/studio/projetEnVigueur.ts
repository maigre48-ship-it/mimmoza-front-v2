// src/lib/studio/projetEnVigueur.ts
// =============================================================================
// VIS-34 (24/11/2026) — LE PROJET EN VIGUEUR : une seule source de vérité, côté serveur.
//
// Constat (conversation 0113d281, Ascain) : la 3D préparée venait de la conception (« Plots », 3 bâtiments, 12 logements)
// et le bâtiment DESSINÉ ne vivait que dans la mémoire du chat ; les deux étaient réconciliés tard, par une heuristique
// (« le dessin remplace UN bâtiment »). Résultat : 2 plots collectifs + la maison dessinée dans le Studio, et un parcours
// qui décrivait toujours « Plots · 12 logements ».
//
// Désormais, quand un dessin est validé (« Reproduire en 3D », retouche ou dessin d'après photo — toujours le même
// bouton), le serveur l'ENREGISTRE avec la 3D préparée de la conversation :
//   · `studio_preparations.entree.projet_en_vigueur`  : le dessin complet (modèle revalidé), son empreinte, sa PORTÉE ;
//   · `studio_preparations.resume.projet_en_vigueur`  : sa description courte (nom, volumes, niveaux, surfaces), lue par
//     le parcours (chat et Espace 3D) et par la carte « 3D préparée ».
// Tout le reste LIT cette ligne : parcours (serveur et écran), charge envoyée au Studio (compléments `modeleBatiment`,
// `portee`, `empreinteModele`), fiche du rendu (`fiche.modele_batiment` : { v, empreinte, modele, portee }).
//
// PORTÉE (nom EXACT convenu avec VIS-35 / VIS-36) : `portee: 'projet' | 'batiment'` ; ABSENT = 'projet'.
//   · 'projet'   : le dessin EST le bâtiment du projet — il remplace tout ce qui était préparé (défaut) ;
//   · 'batiment' : le dessin remplace UN seul des bâtiments préparés, les autres sont gardés.
// La portée voyage À CÔTÉ du modèle (enveloppe) : le contrat ModeleBatiment v1 n'est pas modifié.
//
// Module PUR (imports relatifs en .ts : Vite, tsx, Deno). Aucune E/S.
// =============================================================================
import {
  aireVolume, contourVolume, empreinteModele, englobantTerrain, resumerModele, sommetVolume, validerModele, type ModeleBatiment,
} from './modeleBatiment.ts';

export const PORTEES_DESSIN = ['projet', 'batiment'] as const;
export type PorteeDessin = typeof PORTEES_DESSIN[number];
/** Absent = « projet » : le dessin validé remplace tout le projet préparé. */
export const PORTEE_DEFAUT: PorteeDessin = 'projet';
/** Lecture tolérante : tout ce qui n'est pas exactement « batiment » vaut « projet » (absent compris). */
export const lirePortee = (v: unknown): PorteeDessin => (v === 'batiment' ? 'batiment' : 'projet');

/** Clé commune à `studio_preparations.entree`, `studio_preparations.resume` et `studio_jobs.fiche`. */
export const CLE_PROJET_EN_VIGUEUR = 'projet_en_vigueur';
export const PROJET_EN_VIGUEUR_VERSION = 1;

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const fini = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const txt = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, max) : null);
const nf = (v: number): string => Math.round(v).toLocaleString('fr-FR').replace(/[  ]/g, ' ');
const fr1 = (x: number): string => String(Math.round(x * 10) / 10).replace('.', ',');
const gabarit = (n: number): string => (n <= 1 ? 'rez-de-chaussée' : `R+${n - 1}`);

// ---- Ce qui est enregistré avec la 3D préparée ---------------------------------------------------------------

/** `studio_preparations.entree.projet_en_vigueur` : le dessin complet et sa portée (écrit par le serveur seulement). */
export interface ProjetEnVigueur {
  v: 1;
  source: 'dessin';
  /** Empreinte du dessin (`empreinteModele`, « mb1-xxxxxxxx ») : la MÊME dans la préparation, la charge Studio et la fiche. */
  empreinte: string;
  nom: string;
  portee: PorteeDessin;
  /** Vrai : l'utilisateur a répondu à la question de portée (elle n'est plus jamais reposée). */
  portee_choisie: boolean;
  /** Vrai : la question de portée a déjà été posée dans cette conversation (jamais deux fois). */
  question_posee: boolean;
  /** Contradiction avec le programme déjà DITE (texte) : elle n'est pas redite tant qu'elle ne change pas. */
  contradiction: string | null;
  /** Conversation du dessin : une ligne relue pour une AUTRE conversation ne donne jamais ce dessin. */
  conversation_id: string | null;
  modele: ModeleBatiment;
}

/** `studio_preparations.resume.projet_en_vigueur` : description courte, affichée telle quelle (parcours, carte). */
export interface ResumeProjetEnVigueur {
  v: 1;
  source: 'dessin';
  empreinte: string;
  nom: string;
  type: string;
  portee: PorteeDessin;
  portee_choisie: boolean;
  volumes: number;
  niveaux: number;
  hauteur_m: number;
  /** Emprise au sol des volumes posés au sol (m², recouvrements non déduits : ordre de grandeur). */
  emprise_m2: number;
  /** Surface de plancher approchée (emprise de chaque volume × ses niveaux). */
  plancher_m2: number;
  largeur_m: number;
  profondeur_m: number;
  /** Phrase complète du dessin (`resumerModele`), bornée. */
  description: string;
  /** Bâtiments de la 3D préparée qui porte ce dessin (1 : le dessin est seul). */
  batiments_prepares: number;
  /** Bâtiments que le moteur plaçait SANS le dessin (ce que la portée « projet » a remplacé). */
  batiments_moteur: number;
  contradiction: string | null;
}

/** Nom affiché du dessin (jamais vide). */
export function nomDuDessin(m: ModeleBatiment): string {
  return txt(m.nom, 120) ?? (m.type === 'maison' ? 'Maison dessinée' : m.type === 'collectif' ? 'Immeuble dessiné' : 'Bâtiment dessiné');
}

/** Métré simple du dessin : volumes, niveaux, hauteur, emprise et plancher approchés, encombrement. */
export function metreDessin(m: ModeleBatiment): { volumes: number; niveaux: number; hauteurM: number; empriseM2: number; plancherM2: number; largeurM: number; profondeurM: number } {
  const auSol = m.volumes.filter((v) => v.altitudeBase === 0);
  const base = auSol.length ? auSol : m.volumes;
  const niveaux = Math.max(1, ...m.volumes.map((v) => Math.round(v.altitudeBase / (v.hauteurEtage || 2.8)) + v.niveaux));
  const pts = m.volumes.flatMap((v) => contourVolume(v));
  const e = pts.length ? englobantTerrain(pts) : { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  return {
    volumes: m.volumes.length, niveaux,
    hauteurM: Math.round(Math.max(0, ...m.volumes.map((v) => sommetVolume(v))) * 10) / 10,
    empriseM2: Math.round(base.reduce((s, v) => s + aireVolume(v), 0)),
    plancherM2: Math.round(m.volumes.reduce((s, v) => s + aireVolume(v) * v.niveaux, 0)),
    largeurM: Math.round((e.maxX - e.minX) * 10) / 10, profondeurM: Math.round((e.maxY - e.minY) * 10) / 10,
  };
}

/**
 * Le dessin contredit-il le programme enregistré ? (maison individuelle dessinée pour un programme de plusieurs
 * logements, ou immeuble collectif dessiné pour un seul logement). Une phrase, dite UNE fois par Mimmo ; null sinon.
 */
export function contradictionProgramme(m: ModeleBatiment, programme: { logements?: number | null; libelle?: string | null } | null | undefined): string | null {
  const n = programme && fini(programme.logements) ? Math.round(programme.logements) : null;
  if (n === null) return null;
  const libelle = txt(programme?.libelle, 80) ?? `${n} logement${n > 1 ? 's' : ''}`;
  if (m.type === 'maison' && n > 1) return `Le dessin est une maison individuelle, alors que le programme enregistré prévoit ${libelle}.`;
  if (m.type === 'collectif' && n === 1) return `Le dessin est un immeuble collectif, alors que le programme enregistré prévoit ${libelle}.`;
  return null;
}

export function creerProjetEnVigueur(m: ModeleBatiment, o: {
  portee?: PorteeDessin | null; porteeChoisie?: boolean; questionPosee?: boolean; contradiction?: string | null; conversationId?: string | null;
} = {}): ProjetEnVigueur {
  return {
    v: 1, source: 'dessin', empreinte: empreinteModele(m), nom: nomDuDessin(m), portee: lirePortee(o.portee),
    portee_choisie: o.porteeChoisie === true, question_posee: o.questionPosee === true, contradiction: o.contradiction ?? null,
    conversation_id: o.conversationId ?? null, modele: m,
  };
}

export function resumerProjetEnVigueur(p: ProjetEnVigueur, o: { batimentsPrepares?: number | null; batimentsMoteur?: number | null } = {}): ResumeProjetEnVigueur {
  const x = metreDessin(p.modele);
  const prepares = fini(o.batimentsPrepares) && o.batimentsPrepares >= 1 ? Math.round(o.batimentsPrepares) : 1;
  return {
    v: 1, source: 'dessin', empreinte: p.empreinte, nom: p.nom, type: p.modele.type, portee: p.portee, portee_choisie: p.portee_choisie,
    volumes: x.volumes, niveaux: x.niveaux, hauteur_m: x.hauteurM, emprise_m2: x.empriseM2, plancher_m2: x.plancherM2,
    largeur_m: x.largeurM, profondeur_m: x.profondeurM, description: resumerModele(p.modele).slice(0, 900),
    batiments_prepares: prepares, batiments_moteur: fini(o.batimentsMoteur) && o.batimentsMoteur >= 1 ? Math.round(o.batimentsMoteur) : prepares,
    contradiction: p.contradiction,
  };
}

// ---- Lecture SANS confiance -----------------------------------------------------------------------------------

/**
 * `entree.projet_en_vigueur` (ou l'objet lui-même) → projet en vigueur. Le modèle est REVALIDÉ (strict) et son empreinte
 * RECALCULÉE : une ligne abîmée ou falsifiée ne donne rien. `conversationId` donné : la ligne doit être celle de cette
 * conversation (une préparation relue ailleurs ne transporte jamais le dessin d'une autre conversation).
 */
export function lireProjetEnVigueur(entreeOuProjet: unknown, conversationId?: string | null): ProjetEnVigueur | null {
  const brut = estObj(entreeOuProjet) && estObj(entreeOuProjet[CLE_PROJET_EN_VIGUEUR]) ? entreeOuProjet[CLE_PROJET_EN_VIGUEUR] : entreeOuProjet;
  if (!estObj(brut) || brut.v !== PROJET_EN_VIGUEUR_VERSION || brut.source !== 'dessin' || typeof brut.empreinte !== 'string') return null;
  const v = validerModele(brut.modele, { strict: true });
  if (!v.ok || empreinteModele(v.modele) !== brut.empreinte) return null;
  const conv = typeof brut.conversation_id === 'string' ? brut.conversation_id : null;
  if (conversationId !== undefined && conversationId !== null && conv !== null && conv !== conversationId) return null;
  return {
    v: 1, source: 'dessin', empreinte: brut.empreinte, nom: txt(brut.nom, 120) ?? nomDuDessin(v.modele), portee: lirePortee(brut.portee),
    portee_choisie: brut.portee_choisie === true, question_posee: brut.question_posee === true,
    contradiction: txt(brut.contradiction, 300), conversation_id: conv, modele: v.modele,
  };
}

/** `resume.projet_en_vigueur` (ou l'objet lui-même) → description courte ; null si absente ou illisible. */
export function lireResumeProjet(resumeOuProjet: unknown): ResumeProjetEnVigueur | null {
  const b = estObj(resumeOuProjet) && estObj(resumeOuProjet[CLE_PROJET_EN_VIGUEUR]) ? resumeOuProjet[CLE_PROJET_EN_VIGUEUR] : resumeOuProjet;
  if (!estObj(b) || b.v !== PROJET_EN_VIGUEUR_VERSION || b.source !== 'dessin' || typeof b.empreinte !== 'string' || !/^mb1-[0-9a-f]{8}$/.test(b.empreinte)) return null;
  const num = (k: string, defaut: number) => (fini(b[k]) && (b[k] as number) >= 0 ? b[k] as number : defaut);
  return {
    v: 1, source: 'dessin', empreinte: b.empreinte, nom: txt(b.nom, 120) ?? 'Bâtiment dessiné', type: txt(b.type, 20) ?? 'autre',
    portee: lirePortee(b.portee), portee_choisie: b.portee_choisie === true,
    volumes: Math.max(1, Math.round(num('volumes', 1))), niveaux: Math.max(1, Math.round(num('niveaux', 1))), hauteur_m: num('hauteur_m', 0),
    emprise_m2: num('emprise_m2', 0), plancher_m2: num('plancher_m2', 0), largeur_m: num('largeur_m', 0), profondeur_m: num('profondeur_m', 0),
    description: txt(b.description, 900) ?? '', batiments_prepares: Math.max(1, Math.round(num('batiments_prepares', 1))),
    batiments_moteur: Math.max(1, Math.round(num('batiments_moteur', 1))), contradiction: txt(b.contradiction, 300),
  };
}

// ---- Textes affichés (parcours du chat, Espace 3D, carte « 3D préparée ») ---------------------------------------

/** Vrai si le dessin n'est qu'UN des bâtiments du projet (portée « batiment » et plusieurs bâtiments préparés). */
export const dessinPartiel = (r: Pick<ResumeProjetEnVigueur, 'portee' | 'batiments_prepares'>): boolean => r.portee === 'batiment' && r.batiments_prepares > 1;

/** « 3 volumes · R+1 · ≈ 93 m² au sol · ≈ 120 m² de plancher ». */
export function chiffresProjet(r: ResumeProjetEnVigueur): string {
  return [
    `${String(r.volumes)} volume${r.volumes > 1 ? 's' : ''}`, gabarit(r.niveaux),
    r.hauteur_m > 0 ? `${fr1(r.hauteur_m)} m au sommet` : null,
    r.emprise_m2 > 0 ? `≈ ${nf(r.emprise_m2)} m² au sol` : null,
    r.plancher_m2 > 0 ? `≈ ${nf(r.plancher_m2)} m² de plancher` : null,
  ].filter(Boolean).join(' · ');
}

/** Ce que le dessin remplace, en clair. */
export function phrasePortee(r: Pick<ResumeProjetEnVigueur, 'portee' | 'batiments_prepares'>): string {
  return dessinPartiel(r)
    ? `Il remplace un seul des ${String(r.batiments_prepares)} bâtiments préparés ; les autres sont gardés.`
    : 'C’est le bâtiment du projet : il remplace tout ce qui était préparé.';
}

/** Lignes de la carte « 3D préparée » et du résumé de l'Espace 3D quand un dessin est en vigueur. */
export function lignesProjet(r: ResumeProjetEnVigueur): string[] {
  return [`Bâtiment dessiné : « ${r.nom} »`, chiffresProjet(r), phrasePortee(r)];
}

/** Étape 2 du parcours (« Programme & conception ») : le projet EST le dessin ; le programme contredit est signalé. */
export function resumeConceptionProjet(r: ResumeProjetEnVigueur, programme: string | null = null): string {
  const tete = dessinPartiel(r)
    ? `${programme ? `${programme} · ` : ''}un bâtiment dessiné : « ${r.nom} » (${String(r.volumes)} volume${r.volumes > 1 ? 's' : ''}, ${gabarit(r.niveaux)})`
    : `Projet dessiné : « ${r.nom} » (${String(r.volumes)} volume${r.volumes > 1 ? 's' : ''}, ${gabarit(r.niveaux)})`;
  return r.contradiction && !dessinPartiel(r) ? `${tete} · ${r.contradiction} Programme à mettre à jour.` : tete;
}

/** Étape 3 du parcours (« Volume 3D ») : le volume EST le dessin. */
export function resumeVolumeProjet(r: ResumeProjetEnVigueur): string {
  return `${dessinPartiel(r) ? `Bâtiment dessiné « ${r.nom} » à la place d’un des ${String(r.batiments_prepares)} bâtiments` : `Bâtiment dessiné « ${r.nom} »`} · ${chiffresProjet(r)}`;
}

// ---- Question de portée (une seule fois, à boutons) -----------------------------------------------------------

export const LIBELLE_QUESTION_PORTEE = 'Ce dessin';
export const OPTION_PORTEE_PROJET = 'Ce dessin remplace tout le projet';
export const OPTION_PORTEE_BATIMENT = 'Il remplace un seul bâtiment';

/** Bloc ```mimmoza-choix``` de la question de portée (validé par utils/choixCliquables.ts ; défaut : tout le projet). */
export function blocChoixPortee(): string {
  const json = {
    v: 1,
    questions: [{ id: 'portee_dessin', libelle: LIBELLE_QUESTION_PORTEE, options: [OPTION_PORTEE_PROJET, OPTION_PORTEE_BATIMENT], multiple: false, defaut: OPTION_PORTEE_PROJET }],
    libre: false, a_toi_de_choisir: false,
  };
  return '```mimmoza-choix\n' + JSON.stringify(json) + '\n```';
}

const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').toLowerCase();

/**
 * Réponse de l'utilisateur à la question de portée (« Ce dessin : Il remplace un seul bâtiment », ou la même chose écrite
 * à la main). null : ce message ne répond pas à la question. Jamais lu dans un message qui porte un bloc (carte).
 */
export function porteeDuMessage(texte: unknown): PorteeDessin | null {
  if (typeof texte !== 'string' || !texte.trim() || texte.includes('```') || texte.length > 400) return null;
  const t = norm(texte);
  if (/\bremplace(?:r|ra)?\s+(?:qu')?\s*(?:un|1)\s+seul\s+(?:des\s+)?batiments?\b/.test(t) || /\bun\s+seul\s+batiment\b.*\bdessin\b|\bdessin\b.*\bun\s+seul\s+batiment\b/.test(t)) return 'batiment';
  if (/\bremplace(?:r|ra)?\s+tout\s+le\s+projet\b/.test(t) || /\bdessin\b.*\btout\s+le\s+projet\b/.test(t)) return 'projet';
  return null;
}

// ---- Charge envoyée au Studio et fiche du rendu ------------------------------------------------------------------

/**
 * Compléments du projet envoyés au Studio (poignée de main) : noms EXACTS lus par VIS-35.
 *   · `modeleBatiment`  : le dessin (contrat ModeleBatiment v1, inchangé) ;
 *   · `portee`          : 'projet' | 'batiment' (absent = 'projet') ;
 *   · `empreinteModele` : empreinte du dessin (cohérence : la même que dans la préparation et la fiche).
 */
export interface ComplementsDessin { modeleBatiment: ModeleBatiment; portee: PorteeDessin; empreinteModele: string }
export function complementsDessin(p: Pick<ProjetEnVigueur, 'modele' | 'portee' | 'empreinte'>): ComplementsDessin {
  return { modeleBatiment: p.modele, portee: p.portee, empreinteModele: p.empreinte };
}

/** Rappel court du projet en vigueur, joint à la fiche du rendu (`fiche.projet_en_vigueur`) à côté de `modele_batiment`. */
export function rappelProjetFiche(p: Pick<ProjetEnVigueur, 'empreinte' | 'nom' | 'portee'>): { v: 1; source: 'dessin'; empreinte: string; nom: string; portee: PorteeDessin } {
  return { v: 1, source: 'dessin', empreinte: p.empreinte, nom: p.nom, portee: p.portee };
}

// ---- Carte « Votre bâtiment » : étiquettes vraies -------------------------------------------------------------------

/**
 * Où en est CE dessin (empreinte de la carte) par rapport au projet en vigueur de la conversation :
 *   · 'projet'        : c'est le bâtiment du projet → « Dans la 3D et les images » est VRAI ;
 *   · 'batiment'      : il remplace un seul bâtiment → vrai pour ce bâtiment seulement (dit) ;
 *   · 'pas_en_vigueur': pas (encore) le projet — rien n'est dans la 3D ni dans les images : on dit « prévu ».
 */
export type PlaceDessin = 'projet' | 'batiment' | 'pas_en_vigueur';
export function placeDuDessin(empreinteCarte: string, r: ResumeProjetEnVigueur | null | undefined): PlaceDessin {
  if (!r || r.empreinte !== empreinteCarte) return 'pas_en_vigueur';
  return dessinPartiel(r) ? 'batiment' : 'projet';
}
