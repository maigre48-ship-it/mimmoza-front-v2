// supabase/functions/_shared/maisonNeuve/parcoursMaison.ts
// =============================================================================
// LOT G10 (18/11/2026) — Parcours « construire une maison » dans le chat. Module PUR (aucun réseau, aucun LLM).
//
//   demande (photo du terrain + instructions) → valeurs reprises du message (dites, jamais devinées)
//   → questions fermées pour ce qui manque (surface habitable, niveaux, toit ; puis style et menuiseries, facultatifs)
//   → gabarit de maison individuelle (gabaritMaison.ts : reculs, emprise, hauteur ; R+1 au plus)
//   → refus expliqué avec propositions cliquables qui passent, ou synthèse + autorisation indicative
//   → suite : photo du terrain calée (repères du terrain), image et plans.
// Le serveur affiche lui-même le texte et les questions ; le modèle ne chiffre rien.
// =============================================================================

import type { Donnee, FormeToit, StatutDonnee } from '../extension/contrat.ts';
import { calculerGabaritMaison, type ParcelleMaison, type ReglesMaison, type ResultatGabaritMaison } from './gabaritMaison.ts';
import {
  BORNES_SURFACE_HABITABLE_M2, LIBELLES_TOIT, lireInstructionsMaison, lireMenuiseries, lireNiveaux, lireStyle, lireSurfaceHabitable, lireToit,
  normaliser, type DemandeMaison, type MenuiseriesMaison, type NiveauxMaison, type StyleMaison,
} from './instructionsMaison.ts';

export const OUTIL_MAISON_NEUVE = 'maison_neuve';
export const PREFIXE_QUESTION_MAISON = 'mn_';

export const QM = {
  surface: { id: 'mn_surface', libelle: 'Surface habitable', options: ['90 m²', '120 m²', '150 m²'] },
  niveaux: { id: 'mn_niveaux', libelle: 'Niveaux', options: ['Plain-pied', 'Un étage (R+1)'] },
  toit: { id: 'mn_toit', libelle: 'Toit', options: [LIBELLES_TOIT['deux-pans'], LIBELLES_TOIT['quatre-pans'], LIBELLES_TOIT.plat, LIBELLES_TOIT.monopente] },
  style: { id: 'mn_style', libelle: 'Style', options: ['Traditionnel', 'Contemporain'] },
  menuiseries: { id: 'mn_menuiseries', libelle: 'Menuiseries', options: ['Anthracite', 'Blanc', 'Bois'] },
  proposition: { id: 'mn_proposition', libelle: 'Maison proposée' },
} as const;

export interface EtatMaison {
  readonly v: 1;
  readonly demande: DemandeMaison;
  /** Questions facultatives déjà posées (une question posée et laissée sans réponse vaut « convention Mimmoza »). */
  readonly posees: readonly string[];
  readonly niveauxPlafonnes: boolean;
}

export const ETAT_INITIAL: EtatMaison = { v: 1, demande: {}, posees: [], niveauxPlafonnes: false };

export interface QuestionMaison { id: string; libelle: string; options: string[]; multiple: boolean }

export type EtapeMaison = 'programme' | 'sans_parcelle' | 'refus' | 'termine';

export interface ContexteMaison {
  /** Parcelle dans le repère de scène, limites classées ; null : parcelle inconnue (adresse à demander). */
  readonly parcelle: ParcelleMaison | null;
  readonly regles: ReglesMaison;
  /** Secteur protégé connu (abords MH, site) : allonge le délai et appelle l'ABF. null : non vérifié. */
  readonly secteurProtege: boolean | null;
}

export interface AutorisationMaison {
  readonly regime: 'PC';
  readonly architecte: 'obligatoire' | 'non-obligatoire' | 'a-confirmer';
  readonly delaiMois: number;
  readonly lignes: readonly string[];
  readonly sources: readonly { readonly titre: string; readonly url: string }[];
}

export interface SortieMaison {
  readonly etat: EtatMaison;
  readonly etape: EtapeMaison;
  readonly attendues: readonly string[];
  /** Texte affiché par le serveur (markdown, sans nom interne). */
  readonly texte: string;
  readonly blocChoix: string | null;
  readonly gabarit: ResultatGabaritMaison | null;
  readonly autorisation: AutorisationMaison | null;
  /** Consigne exacte pour le modèle (il recopie la phrase de relance, n'annonce rien d'autre). */
  readonly relance: string;
}

const D = <T,>(valeur: T, statut: StatutDonnee, source: string): Donnee<T> => ({ valeur, statut, source });
const fr = (v: number, d = 1): string => (Math.round(v * 10 ** d) / 10 ** d).toString().replace('.', ',');
const LIB_STATUT: Readonly<Record<StatutDonnee, string>> = { mesuree: 'mesurée', estimee: 'estimée', supposee: 'SUPPOSÉE', confirmee: 'dite par vous' };

/** Bloc de choix cliquables (même format que les autres parcours du chat). Pur. */
export function blocChoixMaison(questions: readonly QuestionMaison[]): string | null {
  if (!questions.length) return null;
  const qs = questions.slice(0, 6).map((q) => ({ id: q.id, libelle: q.libelle, options: q.options.slice(0, 10), multiple: q.multiple }));
  return '```mimmoza-choix\n' + JSON.stringify({ v: 1, questions: qs, libre: true, a_toi_de_choisir: false }) + '\n```';
}

/** Le dernier message de Mimmo portait-il une question de ce parcours ? */
export function suiteDuParcoursMaison(texteAssistant: string | null | undefined): boolean {
  return typeof texteAssistant === 'string' && /```mimmoza-choix[\s\S]*?"id"\s*:\s*"mn_/.test(texteAssistant);
}

function valeurDe(texte: string, libelle: string): string | null {
  const l = normaliser(libelle);
  for (const s of texte.split(/[·\n;]/)) {
    const i = s.indexOf(':');
    if (i >= 0 && normaliser(s.slice(0, i)) === l) return s.slice(i + 1).trim();
  }
  return null;
}

/**
 * Lit les réponses (puces « Libellé : option » ou texte libre) et met à jour l'état. Une valeur déjà dite n'est
 * remplacée que par une nouvelle réponse explicite. Pur.
 */
export function lireReponsesMaison(etat: EtatMaison, texte: string): EtatMaison {
  if (!texte) return etat;
  const d: { -readonly [K in keyof DemandeMaison]: DemandeMaison[K] } = { ...etat.demande };
  let niveauxPlafonnes = etat.niveauxPlafonnes;
  const lu = lireInstructionsMaison(texte);
  Object.assign(d, lu.demande);
  if (lu.niveauxPlafonnes) niveauxPlafonnes = true;
  const src = 'votre réponse';
  const s = valeurDe(texte, QM.surface.libelle);
  if (s) { const v = lireSurfaceHabitable(normaliser(s)); if (v !== null) d.surfaceHabitableM2 = D(v, 'confirmee', src); }
  const n = valeurDe(texte, QM.niveaux.libelle);
  if (n) { const v = lireNiveaux(normaliser(n)); if (v === 1 || v === 2) d.niveaux = D(v, 'confirmee', src); else if (v === 3) niveauxPlafonnes = true; }
  const t = valeurDe(texte, QM.toit.libelle);
  if (t) {
    const nt = normaliser(t);
    const v = lireToit(nt) ?? (Object.entries(LIBELLES_TOIT).find(([, l]) => normaliser(l) === nt)?.[0] as FormeToit | undefined) ?? null;
    if (v) d.toit = D(v, 'confirmee', src);
  }
  const st = valeurDe(texte, QM.style.libelle);
  if (st) { const v = lireStyle(normaliser(st)); if (v) d.style = D(v, 'confirmee', src); }
  const me = valeurDe(texte, QM.menuiseries.libelle);
  if (me) { const v = lireMenuiseries(`menuiseries ${normaliser(me)}`); if (v) d.menuiseries = D(v, 'confirmee', src); }
  // Proposition cliquée après un refus : « 120 m² sur 2 niveaux (R+1) » / « 95 m² de plain-pied ».
  const p = valeurDe(texte, QM.proposition.libelle);
  if (p) {
    const np = normaliser(p);
    const v = lireSurfaceHabitable(np);
    if (v !== null) d.surfaceHabitableM2 = D(v, 'confirmee', 'proposition retenue');
    if (/plain/.test(np)) d.niveaux = D(1 as NiveauxMaison, 'confirmee', 'proposition retenue');
    else if (/r\s*\+\s*1|2 niveaux/.test(np)) d.niveaux = D(2 as NiveauxMaison, 'confirmee', 'proposition retenue');
  }
  return { ...etat, demande: d, niveauxPlafonnes };
}

/** Autorisation INDICATIVE d'une maison individuelle neuve. Pur. */
export function autorisationMaison(sdpM2: number, fourchette: readonly [number, number], secteurProtege: boolean | null): AutorisationMaison {
  const seuil = 150;
  const architecte = fourchette[0] > seuil ? 'obligatoire' : fourchette[1] <= seuil ? 'non-obligatoire' : 'a-confirmer';
  const delaiMois = secteurProtege ? 3 : 2;
  const lignes = [
    'Construction d’une maison individuelle neuve : permis de construire.',
    architecte === 'obligatoire'
      ? `Surface de plancher estimée ≈ ${sdpM2} m² (> 150 m²) : architecte OBLIGATOIRE pour un particulier.`
      : architecte === 'non-obligatoire'
        ? `Surface de plancher estimée ≈ ${sdpM2} m² (≤ 150 m²) : architecte non obligatoire pour un particulier.`
        : `Surface de plancher estimée ≈ ${sdpM2} m² (entre ${fourchette[0]} et ${fourchette[1]} m²), proche du seuil de 150 m² : l’obligation d’architecte est à confirmer sur plans.`,
    secteurProtege === true
      ? 'Secteur protégé : délai d’instruction de 3 mois et avis de l’Architecte des Bâtiments de France.'
      : secteurProtege === false
        ? 'Délai d’instruction : 2 mois.'
        : 'Délai d’instruction : 2 mois, 3 mois en secteur protégé (non vérifié ici).',
  ];
  return {
    regime: 'PC',
    architecte,
    delaiMois,
    lignes,
    sources: [
      { titre: 'Service-public.gouv.fr — Permis de construire (F1986)', url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F1986' },
      { titre: 'Service-public.gouv.fr — Recours à l’architecte (F20568)', url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F20568' },
    ],
  };
}

const MENTION = '_Indicatif : à vérifier auprès du service urbanisme de la mairie. Les règles non lues dans le règlement du PLU sont SUPPOSÉES. Ce n’est pas un avis juridique._';

function questionsManquantes(e: EtatMaison): QuestionMaison[] {
  const q: QuestionMaison[] = [];
  const d = e.demande;
  if (!d.surfaceHabitableM2) q.push({ ...QM.surface, options: [...QM.surface.options], multiple: false });
  if (!d.niveaux) q.push({ ...QM.niveaux, options: [...QM.niveaux.options], multiple: false });
  if (!d.toit) q.push({ ...QM.toit, options: [...QM.toit.options], multiple: false });
  // Facultatives : posées une fois, avec les obligatoires (une seule série si possible).
  if (!d.style && !e.posees.includes(QM.style.id)) q.push({ ...QM.style, options: [...QM.style.options], multiple: false });
  if (!d.menuiseries && !e.posees.includes(QM.menuiseries.id)) q.push({ ...QM.menuiseries, options: [...QM.menuiseries.options], multiple: false });
  return q;
}

/**
 * Avance le parcours d'un tour : lit le message, pose ce qui manque, ou calcule le gabarit. Pur.
 */
export function avancerParcoursMaison(etatPrecedent: EtatMaison | null, texteUtilisateur: string, ctx: ContexteMaison): SortieMaison {
  let etat = lireReponsesMaison(etatPrecedent ?? ETAT_INITIAL, texteUtilisateur);
  const repris = etatPrecedent ? [] : lireInstructionsMaison(texteUtilisateur).reprises;
  const entete: string[] = [];
  if (repris.length) entete.push(`Repris de votre message : ${repris.join(', ')}.`);
  if (etat.niveauxPlafonnes && !etat.demande.niveaux) entete.push('Une maison individuelle est proposée ici jusqu’à un étage (R+1) : choisissez plain-pied ou R+1.');

  const manquantes = questionsManquantes(etat);
  const obligatoiresManquantes = manquantes.filter((q) => q.id === QM.surface.id || q.id === QM.niveaux.id || q.id === QM.toit.id);
  if (obligatoiresManquantes.length) {
    etat = { ...etat, posees: [...new Set([...etat.posees, ...manquantes.map((q) => q.id)])] };
    const texte = [...entete, 'Pour dessiner votre maison, il me faut encore :', ...manquantes.map((q) => `- ${q.libelle}`), '', `Surface habitable entre ${BORNES_SURFACE_HABITABLE_M2[0]} et ${BORNES_SURFACE_HABITABLE_M2[1]} m² ; vous pouvez aussi écrire directement vos valeurs.`].join('\n');
    return { etat, etape: 'programme', attendues: manquantes.map((q) => q.id), texte, blocChoix: blocChoixMaison(manquantes), gabarit: null, autorisation: null, relance: 'Réponds seulement : « Choisissez ci-dessous ce qui manque pour dessiner votre maison. » N’annonce aucun calcul ni aucune image.' };
  }
  // Facultatives restantes : on les marque posées (non bloquantes) et on continue.
  etat = { ...etat, posees: [...new Set([...etat.posees, QM.style.id, QM.menuiseries.id])] };
  if (!ctx.parcelle) {
    return { etat, etape: 'sans_parcelle', attendues: [], texte: [...entete, 'Il me faut l’adresse ou la référence cadastrale du terrain pour placer la maison et lire ses règles.'].join('\n'), blocChoix: null, gabarit: null, autorisation: null, relance: 'Demande seulement l’adresse ou la référence cadastrale du terrain, en une phrase. N’annonce aucun calcul.' };
  }
  const d = etat.demande;
  const g = calculerGabaritMaison({ parcelle: ctx.parcelle, regles: ctx.regles, surfaceHabitableM2: d.surfaceHabitableM2!, niveaux: d.niveaux!, toit: d.toit! });
  if (!g.ok || !g.gabarit) {
    const q: QuestionMaison[] = g.propositions.length ? [{ id: QM.proposition.id, libelle: QM.proposition.libelle, options: g.propositions.map((p) => p.libelle), multiple: false }] : [];
    const texte = [
      ...entete,
      `La maison demandée ne peut pas être placée : ${g.refus.join(' ; ')}.`,
      g.propositions.length ? 'Voici ce qui tient sur la parcelle, à choisir ci-dessous :' : 'Aucune maison de plus de 30 m² habitables ne tient avec ces règles : vérifiez le côté de la rue ou les règles du terrain.',
      '',
      ...g.hypotheses.map((h) => `- ${h}`),
    ].join('\n');
    return { etat, etape: 'refus', attendues: q.map((x) => x.id), texte, blocChoix: blocChoixMaison(q), gabarit: g, autorisation: null, relance: g.propositions.length ? 'Recopie seulement : « La maison demandée ne tient pas sur le terrain ; choisissez ci-dessous une version qui tient. » N’annonce ni 3D ni image.' : 'Dis seulement que la maison ne tient pas sur le terrain avec les règles connues, sans rien lancer.' };
  }
  const m = g.gabarit;
  const aut = autorisationMaison(m.surfacePlancherM2.valeur, m.surfacePlancherFourchette, ctx.secteurProtege);
  const lignes = [
    ...entete,
    '**Votre maison**',
    '',
    '| | Valeur | Statut |',
    '|---|---|---|',
    `| Surface habitable | ${d.surfaceHabitableM2!.valeur} m² | ${LIB_STATUT[d.surfaceHabitableM2!.statut]} |`,
    `| Niveaux | ${m.niveaux.valeur === 1 ? 'plain-pied' : 'R+1'} | ${LIB_STATUT[m.niveaux.statut]} |`,
    `| Dimensions au sol | ${fr(m.longueurM)} × ${fr(m.largeurM)} m (emprise ${Math.round(m.empriseM2)} m²) | estimées |`,
    `| Toit | ${LIBELLES_TOIT[m.toit.valeur]}${m.toit.valeur === 'plat' ? '' : `, pente ${fr(m.penteDeg.valeur, 0)}°`} | ${LIB_STATUT[m.toit.statut]}${m.toit.valeur === 'plat' ? '' : ` ; pente ${LIB_STATUT[m.penteDeg.statut]}`} |`,
    `| Hauteur à l’égout | ${fr(m.egoutM.valeur)} m | ${LIB_STATUT[m.egoutM.statut]} |`,
    `| Hauteur au faîtage | ${fr(m.faitageM.valeur)} m | ${LIB_STATUT[m.faitageM.statut]} |`,
    `| Surface de plancher | ≈ ${m.surfacePlancherM2.valeur} m² (${m.surfacePlancherFourchette[0]} à ${m.surfacePlancherFourchette[1]} m²) | estimée |`,
    `| Façade sur rue | ${m.facadeSurRue ? 'façade longue' : 'pignon'} | calculée |`,
    '',
    '**Reculs respectés**',
    ...m.reculs.map((r) => `- ${r.categorie === 'voie' ? 'Rue' : r.categorie === 'fond' ? 'Fond de parcelle' : 'Limite séparative'} : ${fr(r.mesureM, 2)} m pour ${fr(r.requis.valeur, 2)} m requis (${LIB_STATUT[r.requis.statut]} — ${r.requis.source})`),
    '',
    `**Autorisation (indicatif)** : ${aut.lignes.join(' ')}`,
    '',
    ...g.hypotheses.map((h) => `- ${h}`),
    '',
    `Style : ${d.style ? d.style.valeur : 'non précisé (convention Mimmoza, dite sur l’image)'} · Menuiseries : ${d.menuiseries ? d.menuiseries.valeur : 'anthracite (convention Mimmoza)'}.`,
    '',
    MENTION,
  ];
  return {
    etat,
    etape: 'termine',
    attendues: [],
    texte: lignes.join('\n'),
    blocChoix: null,
    gabarit: g,
    autorisation: aut,
    relance: 'Recopie seulement : « Votre maison est placée sur le terrain, avec les reculs indiqués. » N’annonce ni 3D, ni image, ni plan : rien de cela n’est lancé à ce tour.',
  };
}

export type { MenuiseriesMaison, NiveauxMaison, StyleMaison };
