// supabase/functions/copilot-chat/agent/studio.ts
// =============================================================
// LOT E1 — Mimmo pilote le Studio et les rendus.
//
// Trois outils (déclarés dans outils.ts) :
//   · studio_preparer_3d  : fiche de conception (agent_conceptions : parcelle
//     cadastrale, règles PLU, programme) → volume d'étude calculé par le code
//     PUR du Dossier 3D (studio-front.ts : volumeParcelle + implantationProgramme)
//     → table studio_preparations (ouverture en un clic dans le Dossier 3D).
//     Déterministe : mêmes entrées → même volume, même empreinte, même ligne.
//   · studio_lancer_rendu : film / visite 360° / image dans la file studio_jobs,
//     en DEUX TEMPS : devis (rien n'est lancé) puis confirmation dans un tour
//     SUIVANT, portée par un jeton signé (HMAC) lié à l'utilisateur, au type, aux
//     options et à la source. Insertion avec le JWT de l'utilisateur (RLS,
//     déclencheur de protection, plafond de 2 travaux actifs).
//   · studio_etat_rendu   : statut RÉEL (colonnes de studio_jobs écrites par le
//     worker), liens du résultat (URL signées studio-rendus, page publique visite).
//
// Règles tenues ici :
//   - aucune surface, hauteur ou SDP calculée par l'IA : tout vient du moteur ;
//   - jamais « conforme » : un contrôle n'est « dans la limite » que pour une
//     règle CONFIRMÉE et CITÉE (article) ; sinon « à vérifier » ;
//   - jamais un rendu sans accord : le serveur refuse la confirmation dans la
//     même requête que le devis, et une confirmation sans devis valide ;
//   - le devis présenté est retrouvé par le serveur (copilot_tool_calls de la
//     conversation) : la confirmation n'exige pas que le modèle recopie le jeton,
//     et un devis encore valable aux mêmes paramètres est renvoyé au lieu d'en
//     créer un nouveau (sinon : nouveau devis → refus « même requête » → boucle) ;
//   - statuts affichés = colonnes réelles ; la machine de rendu (PC du fondateur)
//     n'a pas de battement de cœur au repos : son état est DÉDUIT de la file
//     (dernière activité, attente) et présenté comme tel.
//
// Aucune dépendance à index.ts : l'accès aux données passe par DepotStudio
// (implémentation Supabase en bas de fichier, mémoire dans studio.test.ts).
// =============================================================

import {
  calculerVolumeProgramme, construireProjetChat, corpsAffiches, draftBrief, exigerPreparation3D, ficheStudioDepuisVolume,
  HYPOTHESES_VOLUME, libelleNiveaux, programmeBatiDepuisTexte, rotationContrat, studioCommand,
  studioComposition, studioSegmentedVolume, volumeBatimentsStudio,
  type GeometrieParcelle, type JarvisDraft, type ProgrammeVolume, type VolumePropose,
} from './studio-front.ts';
import { controlerVolume, lireRegles, niveauxDuGabarit, reglesVolume, type ControleVolume, type RegleLue } from './studio-front.ts';
import { boitesApercu } from './studio-front.ts';
// Lot C7b : côté voie et bandes de constructibilité, d'après les parcelles voisines conservées avec la conception.
import { bandePourMoteur, bandesDeLaConception, noteBandesNonMesurees, type BandesConception } from './voisines-parcelle.ts';
import type { MesureBandes } from '../../../../src/spaces/copilot/studio3d/coteVoie.ts';
// Lot C7c : revérification géométrique de la bande principale sur le volume final (forme choisie comprise).
import { verifierBandeVolume, type BandeVolume } from '../../../../src/spaces/copilot/studio3d/bandePrincipale.ts';
// Lot C10 : ce que les règles lues établissent du recul à la voie (alignement explicite seulement).
import { implantationDesRegles } from '../../../../src/spaces/copilot/studio3d/controlesVolume.ts';
// Lot formes-batiment : formes du bâtiment (L, U, cour, redans, plots) calculées, vérifiées et comparées par le moteur.
import {
  appliquerFormeDetail, comparerFormes, evaluerSaisie, FORMES, NOMS_FORME_AILES, saisieDepuisBloc, saisieDepuisVolume,
  FORME_BLOC_LANGUE, blocForme, type Forme, type PreparationFiche, type SaisieDimensions,
} from './studio-front.ts';
import type { ResultatOutil } from './types.ts';
// LOT P2 (11/11/2026) — image dans sa rue : options de fond (règles partagées avec le site et la base), couverture
// Panoramax (Licence Ouverte, instance IGN) et façades sur voie transmises à la machine de rendu.
import { CLES_FOND, fondDe, LIBELLES_FOND, validerFond, type OptionsFond } from '../../../../src/lib/studio/fondImage.ts';
import {
  contourDepuisGeometrie, phraseCouverture, verifierCouverture, type CouverturePhotoRue, type LonLat, type ResultatCouverture,
} from '../../../../src/lib/studio/couverturePhotoRue.ts';
import { facadesVoieDeLaParcelle, type FacadeVoieFiche } from './voisines-parcelle.ts';
// LOT P9 : volume d'étude posé au recul sur voie, règles PLU de la conception dans `charge.regles`.
import { ligneHauteurFiche, poserVolumeSurVoie } from '../../../../src/spaces/copilot/studio3d/implantationVoieVolume.ts';
import { reglesFicheDepuisReglesLues } from '../../../../src/spaces/copilot/studio3d/reglesFiche.ts';
import { validerProjet } from '../../../../src/spaces/promoteur/shared/echangeStudio/mimmozaProjetV2.ts';
import { MENTION_REGLES_ESTIMEES, regleValide, volumeParBatiments } from '../../../../src/spaces/copilot/studio3d/volumeParcelle.ts';

// Lot fiche-3d : déplacés dans src/spaces/copilot/studio3d/controlesVolume.ts (code pur partagé avec la fiche du chat).
export { controlerVolume, formuleRecul, lireRegles, regleCitee, type ControleVolume, type RegleLue, type Verdict } from './studio-front.ts';
// Lot formes-batiment : conversion règles de conception → règles du volume, partagée avec la fiche.
export { niveauxDuGabarit, reglesVolume } from './studio-front.ts';

export const SOURCE_STUDIO = 'MimmozIA · Studio 3D';
/**
 * Version du calcul (entre dans l'empreinte) : à incrémenter si la conversion conception → volume change.
 * `e1-studio-2` (lot C10) : pour une même conception, le volume peut changer — plafond d'emprise strict (plus
 * d'arrondi au-dessus du plafond), hauteur / niveaux / pleine terre les plus contraignants quand la bande
 * principale n'est pas appliquée, recul différencié voie / limites quand la bande l'est.
 * `e1-studio-3` (lot C11) : dans la bande principale, alignement retenu quand le recul sur voie est « non
 * réglementé » (confirmé, cité), implantation en limite séparative appliquée aux limites latérales quand la règle
 * lue la permet ; minimum de la formule de recul lu quand il suit le nombre (« H/2 et 3 mètres minimum ») ;
 * côté voie sondé par portions d'arête.
 */
export const VERSION_CALCUL = 'e1-studio-3';
export const TYPES_RENDU = ['film', 'visite360', 'image'] as const;
export type TypeRendu = typeof TYPES_RENDU[number];
/** Durée de validité d'un devis de rendu. */
export const DEVIS_VALIDITE_MS = 2 * 60 * 60_000;
/** Nombre de devis récents relus dans l'historique de la conversation. */
export const DEVIS_RELUS_MAX = 10;

/** Heure lisible en heure de Paris (« 17h47 »), jamais l'heure UTC. */
export function heureParis(ms: number): string {
  const p = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
  return `${v('hour')}h${v('minute')}`;
}
/** Au-delà, un travail en attente sans activité de la machine de rendu est signalé « machine probablement hors ligne ». */
export const ATTENTE_SUSPECTE_MS = 10 * 60_000;
/** Battement du worker pendant un rendu (worker/README : progression au moins toutes les 4 min). */
export const ACTIVITE_RECENTE_MS = 15 * 60_000;
export const NOMBRE_MAX_TRAVAUX_ACTIFS = 2;
export const ORIGINE_MIMMOZA_DEFAUT = 'https://mimmoza.vercel.app';

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const fini = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const txt = (v: unknown, max = 500): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const estUuid = (v: unknown): v is string => typeof v === 'string' && RE_UUID.test(v);
const RE_IDU = /^(2[AB]\d{3}|\d{5})\d{3}[0-9A-Z]{2}\d{4}$/;
const fr = (v: number, d = 0) => v.toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: 0 });

// =============================================================
// 1. Conception → entrées du moteur du Dossier 3D
// =============================================================

// RegleLue, lireRegles, regleCitee, formuleRecul, libelleRegle : déplacés dans le code PUR du front
// (src/spaces/copilot/studio3d/controlesVolume.ts, via studio-front.ts) pour que la fiche « Espace 3D »
// recalcule les vérifications avec EXACTEMENT les mêmes fonctions. Réexportés plus haut (imports).

// Lot formes-batiment : CLES_VOLUME, reglesVolume et niveauxDuGabarit déplacés TELS QUELS dans
// src/spaces/copilot/studio3d/controlesVolume.ts (la fiche « Espace 3D » en a besoin pour placer les
// formes du bâtiment avec les mêmes contraintes que le moteur). Réexportés plus haut (imports).

/** Programme de conception → programme du volume (lu par programmeBati.ts, le même lecteur que le chat). */
export function programmeVolume(p: unknown): ProgrammeVolume {
  const o = estObj(p) ? p : {};
  const n = fini(o.nb_logements) && o.nb_logements >= 1 ? Math.round(o.nb_logements) : null;
  if (n === null) return { logements: null, libelle: null, origine: null };
  const bati = programmeBatiDepuisTexte(`${n} logements`);
  return bati ? { ...bati, origine: 'fiche' } : { logements: n, libelle: `${n} logements`, origine: 'fiche' };
}

export interface ParcelleLue { idu: string; geometrie: GeometrieParcelle; surface_m2: number | null; source: string }

export function lireParcelle(p: unknown, iduDefaut: string): ParcelleLue | null {
  if (!estObj(p) || !estObj(p.geometrie)) return null;
  const g = p.geometrie;
  if ((g.type !== 'Polygon' && g.type !== 'MultiPolygon') || !Array.isArray(g.coordinates) || !g.coordinates.length) return null;
  return { idu: txt(p.idu, 40) ?? iduDefaut, geometrie: g as unknown as GeometrieParcelle, surface_m2: fini(p.surface_m2) ? p.surface_m2 : null, source: txt(p.source, 200) ?? 'non précisée' };
}

// =============================================================
// 2. Contrôles du volume (jamais « conforme ») : controlerVolume est dans controlesVolume.ts (front, pur),
//    réexporté ici ; la fiche « Espace 3D » l'appelle quand l'utilisateur modifie les dimensions.
// =============================================================

// =============================================================
// 3. Préparation déterministe
// =============================================================

export interface ConceptionLue {
  id: string;
  idu: string;
  commune: string | null;
  parcelle: unknown;
  regles_plu: unknown;
  programme: unknown;
}

export interface EntreePreparation {
  parcelle: ParcelleLue;
  commune: string | null;
  regles: RegleLue[];
  programme: unknown;
  programme_volume: ProgrammeVolume;
  gabarit_niveaux: number | null;
  /** Lot C7b : bandes mesurées depuis le côté voie présumé. Absent si non mesurées (empreinte alors inchangée). */
  bandes?: MesureBandes;
}

export interface ResumePreparation {
  statut: VolumePropose['statut'];
  surface_parcelle_m2: number;
  batiments: number;
  formes: string[];
  niveaux: number;
  gabarit: string;
  hauteur_indicative_m: number;
  emprise_batie_m2: number;
  emprise_pct: number | null;
  sdp_estimee_m2: number;
  logements_places: number | null;
  logements_vises: number | null;
  programme_atteint: boolean | null;
  recul_applique_m: number;
  mention_plu: string;
  hypotheses: string[];
  alertes: string[];
  regles_appliquees: string[];
  regles_non_appliquees: string[];
  controles: ControleVolume[];
  /** Lot formes-batiment : forme retenue (moteur, ou choisie dans la fiche / demandée) et comparaison du moteur. */
  forme?: ResumeForme;
}

/** Lot formes-batiment : forme du volume préparé et classement des formes par le moteur (suggestion). */
export interface ResumeForme {
  retenue: string;
  origine: 'moteur' | 'fiche' | 'demande' | 'suggestion';
  comparaison: { forme: string; libelle: string; dans_les_regles: boolean; logements: number; niveaux: number; sdp_m2: number; emprise_m2: number; facade_m: number; raison: string | null }[];
}

/** Lot formes-batiment : choix de forme transmis à la préparation (bloc de la fiche, ou paramètre `forme` de l'outil). */
export interface ChoixForme { saisie?: SaisieDimensions | null; forme?: Forme | 'auto' | null }

export type IssuePreparation =
  | { ok: true; entree: EntreePreparation; volume: VolumePropose; resume: ResumePreparation; empreinte: string }
  | { ok: false; raison: string };

/** JSON canonique (clés triées) : base de l'empreinte. */
export function jsonCanonique(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (estObj(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
}

export async function sha256Hex(s: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function resumerVolume(v: VolumePropose, controles: ControleVolume[], programme: ProgrammeVolume): ResumePreparation {
  const emprise = v.kpi?.empriseTotaleM2 ?? v.emprise?.surfaceM2 ?? 0;
  const batiments = v.batiments?.length ?? (v.emprise ? 1 : 0);
  // Lot formes-batiment : un bâtiment à ailes est nommé par sa forme (« immeuble en L »…).
  const formes = v.batiments?.length ? [...new Set(v.batiments.map((b) => (b.formeAiles ? `immeuble ${NOMS_FORME_AILES[b.formeAiles]}` : b.forme)))] : v.emprise ? ['volume unique'] : [];
  return {
    statut: v.statut,
    surface_parcelle_m2: Math.round(v.surfaceParcelleM2),
    batiments, formes, niveaux: v.niveaux, gabarit: libelleNiveaux(v.niveaux),
    hauteur_indicative_m: Math.round(v.hauteurM * 10) / 10,
    emprise_batie_m2: Math.round(emprise),
    emprise_pct: v.surfaceParcelleM2 > 0 ? Math.round(emprise / v.surfaceParcelleM2 * 1000) / 10 : null,
    sdp_estimee_m2: Math.round(v.sdpM2),
    logements_places: v.logementsEstimes,
    logements_vises: programme.logements,
    programme_atteint: v.programmeAtteint,
    recul_applique_m: v.reculM,
    mention_plu: v.mentionPlu,
    hypotheses: v.hypotheses.slice(0, 12),
    alertes: v.alertes.slice(0, 8),
    regles_appliquees: v.reglesAppliquees.slice(0, 12),
    regles_non_appliquees: v.reglesNonAppliquees.slice(0, 12),
    controles,
  };
}

/** Résumé court (mission : résultat d'outil plafonné à 3 000 caractères). */
export function resumeCompact(r: ResumePreparation): Obj {
  return {
    batiments: r.batiments, formes: r.formes, gabarit: r.gabarit, hauteur_indicative_m: r.hauteur_indicative_m,
    emprise_batie_m2: r.emprise_batie_m2, emprise_pct: r.emprise_pct, sdp_estimee_m2: r.sdp_estimee_m2,
    logements_places: r.logements_places, logements_vises: r.logements_vises, programme_atteint: r.programme_atteint,
    alertes: r.alertes.slice(0, 3), controles: r.controles.map((c) => `${c.libelle} : ${c.verdict}`),
    recul_applique_m: r.recul_applique_m,
    // Lot C11 — programme NON atteint : de quoi dire POURQUOI le volume a cette taille (implantation retenue, plafonds
    // opposés), sans rien conclure — le rapport d'une mission ne doit pas juger la parcelle à la place des données.
    // Programme atteint : ces champs sont omis (le résultat d'outil d'une mission est plafonné à 3 000 caractères).
    ...(r.programme_atteint === false ? {
      implantation: (r.hypotheses[0] ?? '').slice(0, 420) || null,
      plafonds: r.controles.filter((c) => ['emprise_sol_max_pct', 'hauteur_max_m', 'niveaux_max'].includes(c.cle) && c.regle)
        .map((c) => `${c.libelle} : ${c.valeur_volume ?? '?'} pour ${c.regle}`.slice(0, 200)),
    } : {}),
  };
}

/** Fiche de conception → volume d'étude (code du Dossier 3D), contrôles et empreinte. Aucune I/O. */
export async function preparerVolume(c: ConceptionLue, choix: ChoixForme = {}): Promise<IssuePreparation> {
  const parcelle = lireParcelle(c.parcelle, c.idu);
  if (!parcelle) return { ok: false, raison: 'Le contour cadastral de la parcelle manque dans la conception : relancez l’étape « parcelle » de la mission de conception (recuperer_parcelle).' };
  const regles = lireRegles(c.regles_plu);
  const pv = programmeVolume(c.programme);
  const gabarit = niveauxDuGabarit(estObj(c.programme) ? c.programme.gabarit : null);
  // Lot C7b : règle d'emprise PAR BANDE → côté voie cherché sur le cadastre (parcelles voisines de la conception),
  // bandes mesurées à la profondeur lue dans la règle. Non mesurées : emprise prudente du lot C6, raison dite.
  const bandes: BandesConception = bandesDeLaConception(c.parcelle, regles);
  const noteBandes = noteBandesNonMesurees(bandes);
  // Lot C7c — cohérence de bout en bout : le plafond « bande principale » (45 % à Montreuil) n'est utilisé QUE
  // si les bâtiments sont réellement dans la bande principale. Le moteur reçoit la bande (côté voie, profondeur,
  // plafond en m²) ; s'il répond « non appliquée », ou si la forme choisie sort de la bande, tout est recalculé
  // avec le plafond prudent du lot C6 (taux le plus contraignant sur toute la parcelle) et la raison est notée.
  // Lot C10 : la bande porte aussi l'implantation établie par les règles LUES (recul à la voie de 0 m = alignement,
  // seulement s'il est écrit, confirmé et cité ; sinon le moteur garde son recul prudent côté voie et le dit).
  // Lot C11 : recul sur voie « non réglementé » confirmé et cité → alignement retenu ; « sur limite séparative ou
  // en retrait » confirmé et cité → implantation en limite appliquée aux limites latérales (implantationDesRegles).
  // Hors bande (calcul prudent) : rien de tout cela ne s'applique.
  const bandeMoteur = bandes.mesure ? bandePourMoteur(bandes) : null;
  const demande = bandeMoteur ? { ...bandeMoteur, implantation: implantationDesRegles(regles) } : null;
  /** Calcul prudent : règles sans bandes mesurées, implantation habituelle, raison notée. */
  const prudent = (raison: string | null) => {
    const rv = reglesVolume(regles, gabarit, null);
    if (noteBandes) rv.nonAppliquees.push(noteBandes);
    if (raison) rv.nonAppliquees.push(raison);
    const v = calculerVolumeProgramme(parcelle.geometrie, pv, rv);
    // La bande a été demandée et écartée : le volume le porte (statut et raison), pour les contrôles et la suite.
    const etat: BandeVolume | null = raison ? { statut: 'non-appliquee', raison, profondeurM: bandes.profondeurM, longueurFacadeM: null, angleVoieDeg: null, distanceMaxVoieM: null, empriseMaxM2: demande?.empriseMaxM2 ?? null } : null;
    return etat ? { ...v, bande: etat } : v;
  };
  const sansRepli = (texte: string) => texte.replace(/^Bande principale non appliquée : /u, '').replace(/\s*(?:Volume placé|Bâtiments placés) sans tenir compte de la bande\.$/u, '');
  const mesuree = bandes.mesure ? `Bande principale mesurée (${bandes.mesure.bandePrincipaleM2} m² à moins de ${String(bandes.mesure.profondeurM).replace('.', ',')} m de la voie) mais non retenue pour ce volume` : '';
  const plafondPrudent = 'plafond d’emprise prudent appliqué à toute la parcelle';
  let moteur: VolumePropose;
  let dansBande = false;
  if (bandes.mesure && demande) {
    const rv = reglesVolume(regles, gabarit, bandes.mesure, { implantationDansBande: true });
    const v = calculerVolumeProgramme(parcelle.geometrie, pv, rv, demande);
    if (v.bande?.statut === 'appliquee' && verifierBandeVolume(v).prouvee) { moteur = v; dansBande = true; }
    else moteur = prudent(`${mesuree} — ${sansRepli(v.bande?.statut === 'non-appliquee' && v.bande.raison ? v.bande.raison : 'implantation dans la bande non prouvée.')} ${plafondPrudent[0].toUpperCase()}${plafondPrudent.slice(1)}.`);
  } else if (bandes.mesure) {
    moteur = prudent(`${mesuree} — maximum d’emprise de la bande principale non calculable : ${plafondPrudent}.`);
  } else moteur = prudent(null);
  if (!moteur.emprise || moteur.niveaux < 1) {
    return { ok: false, raison: `Aucun volume ne tient sur la parcelle avec les règles connues : ${moteur.alertes[0] ?? moteur.mentionPlu ?? moteur.statut}.` };
  }
  // Lot formes-batiment : forme choisie dans la fiche (saisie relue et RÉÉVALUÉE ici) ou demandée (placée par le moteur).
  let pf: PreparationFiche = { idu: c.idu, commune: c.commune, volume: moteur, regles, programme: pv, gabaritNiveaux: gabarit };
  let f = appliquerChoixForme(pf, choix);
  // Lot C7c : une forme choisie remplace les bâtiments du moteur. Si elle n'est pas PROUVÉE dans la bande
  // principale (ou si elle échoue sur le volume en bande), on repart du calcul prudent : jamais de plafond
  // « bande principale » avec des bâtiments hors bande.
  if (dansBande && (!f.ok || f.volume !== moteur)) {
    const preuve = f.ok ? verifierBandeVolume(f.volume) : null;
    if (f.ok && preuve?.prouvee) {
      f = { ...f, volume: { ...f.volume, bande: f.volume.bande ? { ...f.volume.bande, distanceMaxVoieM: preuve.distanceMaxVoieM } : f.volume.bande } };
    } else {
      // Lot C10 : la forme est maintenant cherchée DANS la bande (formesBatiment.placerForme) ; si elle n'y tient pas, la raison du placement est reprise.
      const pourquoi = preuve?.raison ?? (!f.ok && f.raison ? f.raison.replace(/[.\s]+$/u, '') : null);
      moteur = prudent(`${mesuree} — forme choisie non contenue dans la bande principale${pourquoi ? ` (${pourquoi})` : ''} : ${plafondPrudent}.`);
      dansBande = false;
      if (!moteur.emprise || moteur.niveaux < 1) {
        return { ok: false, raison: `Aucun volume ne tient sur la parcelle avec les règles connues : ${moteur.alertes[0] ?? moteur.mentionPlu ?? moteur.statut}.` };
      }
      pf = { ...pf, volume: moteur };
      f = appliquerChoixForme(pf, choix);
    }
  }
  if (!f.ok) return { ok: false, raison: f.raison };
  let volume = f.volume;
  // Lot P9 : un seul bâtiment, hors bande, forme non saisie à la main → posé parallèle à la voie, façade au recul
  // (règle lue/estimée, sinon 4 m SUPPOSÉS), dans la parcelle. Façade sur voie absente : volume inchangé.
  if (!choix.saisie && volume.bande?.statut !== 'appliquee' && !volumeParBatiments(volume)) {
    const fv = facadesVoieDeLaParcelle(c.parcelle);
    if (fv.facades.length) volume = poserVolumeSurVoie(volume, parcelle.geometrie, fv.facades, reglesVolume(regles, gabarit, null)).volume;
  }
  const controles = controlerVolume(volume, regles, volume.logementsEstimes ?? pv.logements);
  const entree: EntreePreparation = { parcelle, commune: c.commune, regles, programme: c.programme ?? null, programme_volume: pv, gabarit_niveaux: gabarit,
    ...(bandes.mesure ? { bandes: bandes.mesure } : {}) };
  // Sans choix de forme, empreinte inchangée (mêmes lignes qu'avant ce lot) ; avec, la forme saisie y entre.
  const empreinte = await sha256Hex(jsonCanonique({ version: VERSION_CALCUL, conception_id: c.id, entree, ...(f.cle ? { forme: f.cle } : {}) }));
  return { ok: true, entree, volume, resume: { ...resumerVolume(volume, controles, pv), forme: f.resume }, empreinte };
}

/** Lot formes-batiment : applique le choix de forme au volume du moteur (code PUR de la fiche, aucune seconde implémentation). */
export function appliquerChoixForme(pf: PreparationFiche, choix: ChoixForme):
  { ok: true; volume: VolumePropose; resume: ResumeForme; cle: unknown } | { ok: false; raison: string } {
  const comparees = comparerFormes(pf);
  const comparaison = comparees.map((x) => ({ forme: x.forme, libelle: x.libelle, dans_les_regles: x.dansLesRegles, logements: x.logements, niveaux: x.niveaux,
    sdp_m2: x.sdpM2, emprise_m2: x.empriseM2, facade_m: x.facadeM, raison: x.raison }));
  const base = saisieDepuisVolume(pf.volume);
  const libelle = (f: string) => FORMES.find((x) => x.valeur === f)?.libelle ?? (f === 'moteur' ? 'forme du moteur' : f);
  let saisie: SaisieDimensions | null = null;
  let origine: ResumeForme['origine'] = 'moteur';
  if (choix.saisie) { saisie = choix.saisie; origine = 'fiche'; }
  else if (choix.forme) {
    const voulue = choix.forme === 'auto' ? comparees.find((x) => x.ev)?.forme ?? null : choix.forme;
    if (!voulue) return { ok: false, raison: 'Aucune forme calculable sur cette parcelle.' };
    const r = appliquerFormeDetail(pf, base, voulue);
    if (r.raison) return { ok: false, raison: `${libelle(voulue)} : ${r.raison}` };
    saisie = r.saisie; origine = choix.forme === 'auto' ? 'suggestion' : 'demande';
  }
  if (!saisie) return { ok: true, volume: pf.volume, resume: { retenue: libelle(base.forme), origine, comparaison }, cle: null };
  const ev = evaluerSaisie(pf, saisie);
  const bloquante = ev.alertes.find((a) => /déborde|chevauchent/.test(a));
  if (bloquante) return { ok: false, raison: `La forme choisie ne tient pas dans la parcelle : ${bloquante}` };
  return { ok: true, volume: ev.volume, resume: { retenue: libelle(saisie.forme), origine, comparaison }, cle: ev.modifie ? blocForme(saisie) : null };
}

/**
 * Lot formes-batiment : bloc ```mimmoza-forme``` d'un message utilisateur (fiche « Espace 3D ») → saisie
 * validée. null : pas de bloc. Présent mais refusé : `ok: false` (dit à l'utilisateur, jamais deviné).
 */
export function formeDuMessage(texte: unknown): Validation<SaisieDimensions> | null {
  if (typeof texte !== 'string') return null;
  const m = new RegExp('```' + FORME_BLOC_LANGUE + '[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n?```').exec(texte);
  if (!m) return null;
  let brut: unknown;
  try { brut = JSON.parse(m[1]); } catch { return { ok: false, erreur: 'Bloc de forme illisible (JSON invalide).' }; }
  const r = saisieDepuisBloc(brut);
  return r.ok ? { ok: true, valeur: r.saisie } : { ok: false, erreur: r.erreur };
}

/** Lot formes-batiment : consigne ajoutée au système quand le message porte un bloc de forme (index.ts). */
export function consigneFormeCarte(c: Validation<SaisieDimensions> | null): string {
  if (!c) return '';
  if (!c.ok) return `FORME DU BÂTIMENT : le dernier message contient un bloc de forme REFUSÉ par le serveur (${c.erreur}). Dis-le simplement ; ne devine aucune dimension.`;
  return 'FORME DU BÂTIMENT CHOISIE dans la fiche du projet (dernier message de l’utilisateur) : appelle MAINTENANT studio_preparer_3d ' +
    '(sans `forme` : le serveur lit lui-même la forme et les dimensions dans le message et les recalcule avec le moteur). ' +
    'Reprends ensuite les chiffres et les vérifications renvoyés tels quels ; ne recalcule rien de tête ; jamais « conforme ».';
}

// =============================================================
// 4. Rendus : options, devis, jeton, fiche
// =============================================================

export type Validation<T> = { ok: true; valeur: T } | { ok: false; erreur: string };
const AMBIANCES = ['jour', 'fin_de_journee', 'nuit'];
const VUES = ['trois_quarts_gauche', 'trois_quarts_droite', 'face'];

/**
 * Mêmes règles que _studio_job_options_valides (SQL) et travauxLogique.validerOptions (front). Absentes : défauts.
 * LOT P2 : une image accepte aussi `fond`, `photo_rue`, `photo_client`, `calage_client` (fondImage.ts) ;
 * `proprietaire` (utilisateur du JWT) : la photo du client doit être dans SON dossier du seau.
 */
export function validerOptionsRendu(type: unknown, brut: unknown, proprietaire: string | null = null): Validation<Obj> {
  if (type !== 'film' && type !== 'visite360' && type !== 'image') return { ok: false, erreur: 'Type de rendu inconnu (film, visite360 ou image).' };
  if (brut !== undefined && brut !== null && !estObj(brut)) return { ok: false, erreur: 'Options illisibles.' };
  const o = (brut ?? {}) as Obj;
  const permises = type === 'film' ? ['duree_s', 'ambiance', 'format', 'interieurs', 'musique'] : type === 'visite360' ? ['ambiance', 'interieurs', 'resolution'] : ['vues', 'ambiance', ...CLES_FOND];
  const inconnue = Object.keys(o).find((k) => !permises.includes(k));
  if (inconnue) return { ok: false, erreur: `Option inconnue : ${inconnue}.` };
  if (type === 'image') {
    const vues = o.vues ?? ['trois_quarts_gauche'];
    if (!Array.isArray(vues) || vues.length < 1 || vues.length > 3 || new Set(vues).size !== vues.length || vues.some((v) => !VUES.includes(v as string))) {
      return { ok: false, erreur: 'Choisissez de 1 à 3 vues : 3/4 gauche, 3/4 droite ou face.' };
    }
    const ambiance = o.ambiance ?? 'jour';
    if (ambiance !== 'jour' && ambiance !== 'fin_de_journee') return { ok: false, erreur: 'Choisissez une lumière : journée ou fin de journée.' };
    const fond = validerFond(o, proprietaire);
    if (!fond.ok) return fond;
    return { ok: true, valeur: { vues: VUES.filter((v) => (vues as unknown[]).includes(v)), ambiance, ...fond.valeur } };
  }
  const ambiance = o.ambiance ?? 'jour';
  if (!AMBIANCES.includes(ambiance as string)) return { ok: false, erreur: 'Choisissez une ambiance : journée, fin de journée ou nuit.' };
  const interieurs = o.interieurs ?? true;
  if (typeof interieurs !== 'boolean') return { ok: false, erreur: 'Indiquez si les intérieurs sont inclus.' };
  if (type === 'film') {
    const duree = o.duree_s ?? 60;
    if (duree !== 30 && duree !== 60 && duree !== 90) return { ok: false, erreur: 'La durée du film doit être de 30, 60 ou 90 secondes.' };
    const format = o.format ?? '16:9';
    if (format !== '16:9' && format !== '9:16') return { ok: false, erreur: 'Le format doit être paysage (16:9) ou vertical (9:16).' };
    const musique = o.musique ?? true;
    if (typeof musique !== 'boolean') return { ok: false, erreur: 'Indiquez si le film a une musique.' };
    return { ok: true, valeur: { duree_s: duree, ambiance, format, interieurs, musique } };
  }
  const resolution = o.resolution ?? '6k';
  if (resolution !== '6k' && resolution !== '8k') return { ok: false, erreur: 'La qualité doit être 6K ou 8K.' };
  return { ok: true, valeur: { ambiance, interieurs, resolution } };
}

// LOT P2 : « Image du projet » — le résultat peut être une image d'étude ou une image insérée dans une photo de rue.
const LIBELLE_TYPE: Record<TypeRendu, string> = { film: 'Film', visite360: 'Visite 360°', image: 'Image du projet' };

/** Durée annoncée : formule du front pour l'image (travauxLogique.dureeEstimeeImage) ; délais MAXIMAUX du worker sinon. */
export function dureeAnnoncee(type: TypeRendu, options: Obj): string {
  if (type === 'image') {
    const n = Array.isArray(options.vues) ? Math.max(1, Math.min(3, options.vues.length)) : 1;
    const h = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}`);
    return `environ ${h(10 + 7 + 20 * n)} à ${h(10 + 7 + 60 * n)} une fois le rendu démarré (préparation, aperçu de contrôle, puis 20 à 60 min par vue)`;
  }
  return type === 'film'
    ? 'plusieurs heures possibles une fois le rendu démarré (aucune estimation fiable ; arrêt automatique au-delà de 12 h de rendu, 18 h au total)'
    : 'plusieurs heures possibles une fois le rendu démarré (aucune estimation fiable ; arrêt automatique au-delà de 6 h de rendu, 18 h au total)';
}

export function resumeOptions(type: TypeRendu, o: Obj): string {
  const amb: Record<string, string> = { jour: 'en journée', fin_de_journee: 'fin de journée', nuit: 'de nuit' };
  if (type === 'image') {
    const fond = fondDe(o);
    return `${(o.vues as string[]).map((v) => ({ trois_quarts_gauche: '3/4 gauche', trois_quarts_droite: '3/4 droite', face: 'face' } as Obj)[v]).join(', ')} · ${amb[String(o.ambiance)]}` +
      (fond !== 'etude' ? ` · fond : ${LIBELLES_FOND[fond].toLowerCase()}` : '') + (o.calage_client ? ' · placement ajusté' : '');
  }
  if (type === 'film') return [`${String(o.duree_s)} s`, amb[String(o.ambiance)], o.format === '9:16' ? 'vertical' : 'paysage', o.interieurs ? 'intérieurs' : null, o.musique ? 'musique' : null].filter(Boolean).join(' · ');
  return [amb[String(o.ambiance)], String(o.resolution).toUpperCase(), o.interieurs ? 'intérieurs' : null].filter(Boolean).join(' · ');
}

// ── Brief d'habillage (E1-brief) ───────────────────────────────────────────
// Avant le PREMIER devis d'un rendu de 3D préparée, Mimmo pose UNE question groupée (style, façade,
// balcons, attique, rez-de-chaussée, ambiance). Le brief validé entre dans le jeton de devis et dans
// la commande de création transmise au Studio (`commandeArchitecture`), seule entrée que le Studio
// interprète quand une commande existe (preparationMimmoza.ts : le `brief` texte y est informatif).
// Chaque valeur ci-dessous a été vérifiée sur le lecteur du Studio (parseArchitectureRequest, nl.ts) :
// une valeur sans effet est DITE sans effet, jamais promise.

export const BRIEF_STYLES = ['contemporain', 'haussmannien', 'art_deco'] as const;
export const BRIEF_FACADES = ['enduit_clair', 'enduit_blanc', 'brique', 'pierre', 'beton', 'bardage_bois', 'verre'] as const;
export const BRIEF_OUVERTURES = ['fenetres_verticales', 'baies_vitrees', 'fenetres_horizontales'] as const;
export const BRIEF_BALCONS = ['balcons', 'balcons_filants', 'loggias', 'aucun'] as const;
export const BRIEF_RDC = ['logements', 'commerces', 'hall'] as const;
export const BRIEF_AMBIANCES = ['jour', 'fin_de_journee', 'nuit'] as const;
// Lot brief-unifié (06/11/2026) — détails du brief, tous vérifiés sur le Studio (CHOIX.md du lot) :
//   - toiture : clause de création lue par `roofOf` / `lireMatieresDeCreation` (nl.ts) → flat-green +
//     toiture-vegetalisee, gable 35° + tuile-rouge / ardoise / zinc ; décor Unreal R1 (image_photo.toiture_decor) ;
//   - teinte : matériau distinct du Studio (LEGACY_TO_ARCHVIZ) — brique claire, béton blanc, bois brûlé (noirci) ;
//   - garde-corps, menuiseries, soubassement : posés par le worker APRÈS la création (`habillage_batiments.details`,
//     worker/src/batimentsScene.ts::habillerDetails), le lecteur de phrases du Studio ne sachant pas les lire.
// Non proposés (montrés « bientôt » par le front) : volets / brise-soleil (non dessinés par le Studio),
// entrée porche / renfoncée / auvent (scène refusée, mesuré le 06/11), enduit ocre (absent du catalogue).
export const BRIEF_TOITURES = ['terrasse', 'vegetalisee', 'deux_pans_tuiles', 'deux_pans_ardoise', 'deux_pans_zinc'] as const;
export const BRIEF_TEINTES = ['naturelle', 'claire', 'foncee'] as const;
export const BRIEF_GARDE_CORPS = ['metal', 'verre', 'plein'] as const;
export const BRIEF_MENUISERIES = ['gris', 'anthracite', 'blanc', 'bronze'] as const;
export const BRIEF_SOUBASSEMENTS = ['aucun', 'pierre', 'beton', 'brique'] as const;
/** Teintes réellement distinctes dans le Studio, par matière (une seule = pas de choix). */
export const TEINTES_PAR_FACADE: Record<typeof BRIEF_FACADES[number], readonly typeof BRIEF_TEINTES[number][]> = {
  enduit_clair: ['naturelle'], enduit_blanc: ['naturelle'], brique: ['naturelle', 'claire'], pierre: ['naturelle'],
  beton: ['naturelle', 'claire'], bardage_bois: ['naturelle', 'foncee'], verre: ['naturelle'],
};
/** Toits à deux pans (35°, au-dessus du dernier niveau) : pas d'attique avec eux. */
export const toitEnPente = (t: string): boolean => t.startsWith('deux_pans_');
const CHAMPS_BRIEF = ['style', 'facade', 'ouvertures', 'balcons', 'attique', 'rdc', 'ambiance', 'toiture', 'teinte', 'garde_corps', 'menuiseries', 'soubassement'] as const;
type ChampBrief = typeof CHAMPS_BRIEF[number];
/** Longueur maximale des précisions libres (informatives : le Studio ne les interprète pas). */
export const BRIEF_PRECISIONS_MAX = 100;

export interface BriefRendu {
  style: typeof BRIEF_STYLES[number];
  facade: typeof BRIEF_FACADES[number];
  ouvertures: typeof BRIEF_OUVERTURES[number];
  balcons: typeof BRIEF_BALCONS[number];
  attique: boolean;
  rdc: typeof BRIEF_RDC[number];
  ambiance: typeof BRIEF_AMBIANCES[number];
  toiture: typeof BRIEF_TOITURES[number];
  teinte: typeof BRIEF_TEINTES[number];
  garde_corps: typeof BRIEF_GARDE_CORPS[number];
  menuiseries: typeof BRIEF_MENUISERIES[number];
  soubassement: typeof BRIEF_SOUBASSEMENTS[number];
  precisions: string | null;
  /** Champs pris par défaut (non précisés par l'utilisateur ou « à toi de choisir »), dans l'ordre de CHAMPS_BRIEF. */
  defauts: ChampBrief[];
}

/** Valeurs par défaut : immeuble de logements collectifs en zone urbaine (aucune hypothèse PLU). */
export const BRIEF_DEFAUT: Omit<BriefRendu, 'precisions' | 'defauts'> = {
  style: 'contemporain', facade: 'enduit_clair', ouvertures: 'fenetres_verticales', balcons: 'balcons',
  attique: false, rdc: 'logements', ambiance: 'jour',
  toiture: 'terrasse', teinte: 'naturelle', garde_corps: 'metal', menuiseries: 'gris', soubassement: 'aucun',
};

const LIB_BRIEF = {
  style: { contemporain: 'contemporain', haussmannien: 'haussmannien', art_deco: 'Art déco' },
  facade: { enduit_clair: 'enduit clair (beige)', enduit_blanc: 'enduit blanc', brique: 'brique', pierre: 'pierre claire', beton: 'béton brut', bardage_bois: 'bardage bois', verre: 'verre (façade vitrée)' },
  ouvertures: { fenetres_verticales: 'fenêtres verticales', baies_vitrees: 'baies vitrées', fenetres_horizontales: 'fenêtres horizontales (bandeaux)' },
  balcons: { balcons: 'balcons', balcons_filants: 'balcons filants', loggias: 'loggias', aucun: 'aucun balcon' },
  rdc: { logements: 'logements', commerces: 'commerces', hall: 'hall d’entrée' },
  ambiance: { jour: 'lumière de journée', fin_de_journee: 'fin de journée', nuit: 'nuit' },
  toiture: { terrasse: 'toit-terrasse', vegetalisee: 'toiture végétalisée', deux_pans_tuiles: 'toit à deux pans en tuiles', deux_pans_ardoise: 'toit à deux pans en ardoise', deux_pans_zinc: 'toit à deux pans en zinc' },
  garde_corps: { metal: 'garde-corps métal', verre: 'garde-corps en verre', plein: 'garde-corps pleins' },
  menuiseries: { gris: 'menuiseries alu gris', anthracite: 'menuiseries anthracite', blanc: 'menuiseries blanches', bronze: 'menuiseries bronze' },
  soubassement: { aucun: 'sans soubassement', pierre: 'soubassement en pierre', beton: 'soubassement en béton', brique: 'soubassement en brique' },
} as const;

/** Façade et teinte → libellé (« brique claire », « béton blanc », « bardage bois noirci »). */
function libelleFacade(b: Pick<BriefRendu, 'facade' | 'teinte'>): string {
  if (b.facade === 'brique' && b.teinte === 'claire') return 'brique claire';
  if (b.facade === 'beton' && b.teinte === 'claire') return 'béton blanc';
  if (b.facade === 'bardage_bois' && b.teinte === 'foncee') return 'bardage bois noirci';
  return LIB_BRIEF.facade[b.facade];
}

/** Clauses ajoutées à la commande du Studio — formulations vérifiées sur parseArchitectureRequest. */
const CLAUSE_FACADE: Record<BriefRendu['facade'], string> = {
  enduit_clair: 'façade en enduit', enduit_blanc: 'façade en enduit blanc', brique: 'façade en brique', pierre: 'façade en pierre',
  beton: 'façade en béton', bardage_bois: 'façade en bardage bois', verre: 'façade en verre',
};
/** Teinte : formulations vérifiées sur le lexique du Studio (intentionMaterielle.ts LEXIQUE_MATIERES, essai du 06/11). */
function clauseFacade(b: Pick<BriefRendu, 'facade' | 'teinte'>): string {
  if (b.facade === 'brique' && b.teinte === 'claire') return 'façade en brique claire';
  if (b.facade === 'beton' && b.teinte === 'claire') return 'façade en béton blanc';
  if (b.facade === 'bardage_bois' && b.teinte === 'foncee') return 'façade en bois brûlé';
  return CLAUSE_FACADE[b.facade];
}
/** Toiture : `roofOf` (nl.ts) → flat-green / gable 35° ; la matière suit le rôle « toiture » (lireMatieresDeCreation). */
const CLAUSE_TOITURE: Record<BriefRendu['toiture'], string | null> = {
  terrasse: null, vegetalisee: 'toiture végétalisée', deux_pans_tuiles: 'toiture à deux pans en tuiles',
  deux_pans_ardoise: 'toiture à deux pans en ardoise', deux_pans_zinc: 'toiture à deux pans en zinc',
};
const CLAUSE_OUVERTURES: Record<BriefRendu['ouvertures'], string> = {
  fenetres_verticales: 'fenêtres verticales', baies_vitrees: 'baies vitrées', fenetres_horizontales: 'fenêtres horizontales',
};

/** Question groupée renvoyée par la garde (un seul message, une ligne par point, valeur proposée). */
export function questionBrief(type: TypeRendu): string {
  const amb = type === 'image' ? 'journée ou fin de journée' : 'journée, fin de journée ou nuit';
  return [
    'Avant d’établir le devis, quelques choix pour habiller le bâtiment (je propose une valeur pour chacun) :',
    '- Style architectural : contemporain (haussmannien et Art déco : pas encore disponibles dans le Studio)',
    '- Façade et matériaux : enduit clair, fenêtres verticales (ou enduit blanc, brique, pierre, béton, bardage bois, verre ; baies vitrées, fenêtres en bandeaux)',
    '- Balcons / loggias : balcons (ou balcons filants, loggias, aucun)',
    '- Attique : non (oui = un niveau en retrait AU-DESSUS du volume d’étude)',
    '- Rez-de-chaussée : logements (ou commerces, hall d’entrée)',
    `- Ambiance : journée (${amb})`,
    '- Détails (facultatif) : toit-terrasse (ou toiture végétalisée, toit à deux pans en tuiles, ardoise ou zinc) ; teinte (brique rouge ou claire, béton brut ou blanc, bois brun ou noirci) ; garde-corps métal (ou verre, plein) ; menuiseries alu gris (ou anthracite, blanc, bronze) ; sans soubassement (ou pierre, béton, brique)',
    'Répondez point par point, ou « à toi de choisir » et je prends ces valeurs.',
  ].join('\n');
}

const ENUMS_BRIEF: Record<ChampBrief, readonly (string | boolean)[]> = {
  style: BRIEF_STYLES, facade: BRIEF_FACADES, ouvertures: BRIEF_OUVERTURES, balcons: BRIEF_BALCONS,
  attique: [false, true], rdc: BRIEF_RDC, ambiance: BRIEF_AMBIANCES,
  toiture: BRIEF_TOITURES, teinte: BRIEF_TEINTES, garde_corps: BRIEF_GARDE_CORPS, menuiseries: BRIEF_MENUISERIES, soubassement: BRIEF_SOUBASSEMENTS,
};

/**
 * Brief fourni par le modèle → brief normalisé. Champs absents : valeur par défaut (listée dans `defauts`).
 * Un objet vide n'est accepté qu'avec `a_toi_de_choisir: true`. Valeurs fermées ; texte libre borné.
 */
export function validerBrief(brut: unknown): Validation<BriefRendu> {
  if (!estObj(brut)) return { ok: false, erreur: 'Brief illisible : objet attendu (style, facade, ouvertures, balcons, attique, rdc, ambiance, toiture, teinte, garde_corps, menuiseries, soubassement, precisions, a_toi_de_choisir).' };
  const permises = [...CHAMPS_BRIEF, 'precisions', 'a_toi_de_choisir'];
  const inconnue = Object.keys(brut).find((k) => !permises.includes(k));
  if (inconnue) return { ok: false, erreur: `Champ de brief inconnu : ${inconnue}.` };
  if (brut.a_toi_de_choisir !== undefined && typeof brut.a_toi_de_choisir !== 'boolean') return { ok: false, erreur: 'a_toi_de_choisir doit être un booléen.' };
  const fournis = CHAMPS_BRIEF.filter((c) => brut[c] !== undefined && brut[c] !== null);
  if (!fournis.length && brut.a_toi_de_choisir !== true) return { ok: false, erreur: 'Brief vide : donnez au moins un choix, ou a_toi_de_choisir: true si l’utilisateur laisse Mimmo choisir.' };
  const b: Obj = { ...BRIEF_DEFAUT };
  for (const c of fournis) {
    const v = brut[c];
    if (c === 'attique') {
      if (typeof v !== 'boolean') return { ok: false, erreur: 'attique doit être true ou false.' };
    } else if (typeof v !== 'string' || !ENUMS_BRIEF[c].includes(v)) {
      return { ok: false, erreur: `Valeur refusée pour ${c} : ${ENUMS_BRIEF[c].join(', ')}.` };
    }
    b[c] = v;
  }
  // Lot brief-unifié : combinaisons que le Studio ne rend pas (jamais devinées : refusées et dites).
  if (!(TEINTES_PAR_FACADE[b.facade as BriefRendu['facade']] as readonly unknown[]).includes(b.teinte)) {
    if (fournis.includes('teinte')) return { ok: false, erreur: `teinte « ${String(b.teinte)} » indisponible pour la façade ${String(b.facade)} (teintes : ${TEINTES_PAR_FACADE[b.facade as BriefRendu['facade']].join(', ')}).` };
    b.teinte = 'naturelle';
  }
  if (b.attique === true && toitEnPente(String(b.toiture))) {
    if (fournis.includes('attique') && fournis.includes('toiture')) return { ok: false, erreur: 'Un toit à deux pans ne se combine pas avec un attique : choisissez l’un ou l’autre.' };
    if (fournis.includes('toiture')) b.attique = false; else b.toiture = 'terrasse';
  }
  if (b.rdc === 'commerces' && b.soubassement !== 'aucun') {
    if (fournis.includes('soubassement') && fournis.includes('rdc')) return { ok: false, erreur: 'Pas de soubassement avec des commerces en rez-de-chaussée (il couperait les vitrines).' };
    if (fournis.includes('soubassement')) b.rdc = 'logements'; else b.soubassement = 'aucun';
  }
  let precisions: string | null = null;
  if (brut.precisions !== undefined && brut.precisions !== null) {
    if (typeof brut.precisions !== 'string') return { ok: false, erreur: 'precisions doit être un texte court.' };
    const t = Array.from(brut.precisions, (ch) => (ch.charCodeAt(0) < 32 ? ' ' : ch)).join('').replace(/\s+/g, ' ').trim();
    if (t.length > BRIEF_PRECISIONS_MAX) return { ok: false, erreur: `precisions : ${BRIEF_PRECISIONS_MAX} caractères au plus.` };
    precisions = t || null;
  }
  return { ok: true, valeur: { ...(b as Omit<BriefRendu, 'precisions' | 'defauts'>), precisions, defauts: CHAMPS_BRIEF.filter((c) => !fournis.includes(c)) } };
}


/**
 * Forme compacte du brief dans le jeton de devis (le jeton doit rester lisible dans les 900 premiers
 * caractères du rappel des résultats). Lot brief-unifié : forme « 2: » — un caractère base 36 par champ
 * (rang dans sa liste fermée, 12 champs), « . », champs pris par défaut (masque hexadécimal), puis « . » et
 * les précisions s'il y en a. Ex. « 2:010000000000.fff » … L'ancienne forme (7 chiffres, devis émis avant
 * ce lot, valables 2 h) reste relue : les 5 nouveaux champs y prennent leur valeur par défaut.
 */
export function encoderBrief(b: BriefRendu): string {
  const rangs = CHAMPS_BRIEF.map((c) => ENUMS_BRIEF[c].indexOf(b[c]).toString(36)).join('');
  const masque = CHAMPS_BRIEF.reduce((m, c, i) => (b.defauts.includes(c) ? m | (1 << i) : m), 0).toString(16);
  return `2:${rangs}.${masque}${b.precisions ? `.${b.precisions}` : ''}`;
}

/** Relit le brief compact d'un jeton signé (forme « 2: » ou ancienne) ; null si absent ou d'une forme inattendue. */
export function briefDuJeton(b: unknown): BriefRendu | null {
  if (typeof b !== 'string') return null;
  const m2 = /^2:([0-9a-z]{12})\.([0-9a-f]{1,3})(?:\.([\s\S]+))?$/.exec(b);
  const m1 = m2 ? null : /^(\d{7})\.([0-9a-f]{1,2})(?:\.([\s\S]+))?$/.exec(b);
  const m = m2 ?? m1;
  if (!m) return null;
  const champs = m2 ? CHAMPS_BRIEF : CHAMPS_BRIEF.slice(0, 7);
  const brut: Obj = {};
  for (const [i, c] of champs.entries()) {
    const v = ENUMS_BRIEF[c][parseInt(m[1][i], 36)];
    if (v === undefined) return null;
    brut[c] = v;
  }
  if (m[3] !== undefined) brut.precisions = m[3];
  const v = validerBrief(brut);
  if (!v.ok) return null;
  const masque = parseInt(m[2], 16) | (m1 ? 0xf80 : 0);
  return { ...v.valeur, defauts: CHAMPS_BRIEF.filter((_, i) => (masque & (1 << i)) !== 0) };
}

/** Clauses de la commande de création du Studio. `plusieurs` : composition de bâtiments nommés. */
export function clausesBrief(b: BriefRendu, plusieurs = false): string[] {
  return [
    clauseFacade(b),
    // Façade vitrée : le Studio pose déjà de grandes baies ; une ouverture nommée les remplacerait.
    b.facade === 'verre' ? null : CLAUSE_OUVERTURES[b.ouvertures],
    // archAddBalconies et archSetStylePack visent le PREMIER bâtiment de la scène (commands.ts,
    // targetBuildingId) : jamais répétés pour une composition, ils s'empileraient sur le bâtiment A.
    plusieurs ? null : b.balcons === 'balcons' ? 'avec balcons' : b.balcons === 'balcons_filants' ? 'avec balcons filants' : b.balcons === 'loggias' ? 'avec loggias' : null,
    // Jamais « sans attique » : le lecteur du Studio voit le mot « attique » et en crée un.
    b.attique ? 'avec attique' : null,
    b.rdc === 'commerces' ? 'commerces en rez-de-chaussée' : null,
    // Lot brief-unifié : toiture (terrasse = dessin par défaut du Studio, aucune clause).
    CLAUSE_TOITURE[b.toiture],
    // E1-rendu : JAMAIS de clause de style. Les packs haussmannien et Art déco du Studio sont au stade
    // « manifest » (registry.ts) : archSetStylePack est BLOQUÉ et, dans une commande de création, le
    // Studio ne crée RIEN et attend un « oui » (mesuré par submitPrompt sur le vrai magasin, 05/11) —
    // impossible pour un rendu sans personne devant l'écran. Le devis le dit (reservesBrief).
  ].filter((c): c is string => !!c);
}

/**
 * E1-rendu — habillage d'un projet À PLUSIEURS BÂTIMENTS (`batiments` du contrat v2). Le worker du
 * Studio construit alors chaque bâtiment depuis le contrat et retire `commandeArchitecture` (seul
 * porteur du brief jusqu'ici) : l'habillage voyage donc à part, dans `fiche.habillage_batiments`,
 * déjà traduit pour le Studio (worker/src/fiche.ts::lireHabillage, worker/src/batimentsScene.ts) :
 *   - `clauses` : ajoutées à la commande de création de CHAQUE bâtiment (façade, ouvertures,
 *     attique, commerces en rez) ;
 *   - `balcons` : posés par le worker sur chaque bâtiment, identifiant explicite (jamais dans la
 *     phrase : `archAddBalconies` viserait le premier bâtiment de la scène).
 * Pas de style : voir clausesBrief (packs non disponibles dans le Studio).
 */
export function habillageBatiments(b: BriefRendu): { clauses: string[]; balcons: 'individual' | 'running' | 'loggia' | null; details?: DetailsHabillage } {
  const details = detailsHabillage(b);
  return {
    // Sans balcons ni style (`plusieurs`) : seulement ce que le Studio lit dans la demande de création
    // du bâtiment (materials, windowType, attic, programType/retailArea, roofType d'archCreateBuilding, nl.ts).
    clauses: clausesBrief(b, true),
    balcons: b.balcons === 'balcons' ? 'individual' : b.balcons === 'balcons_filants' ? 'running' : b.balcons === 'loggias' ? 'loggia' : null,
    ...(details ? { details } : {}),
  };
}

/** Détails posés par le worker après la création (valeurs du Studio ; worker/src/fiche.ts::lireDetails, listes fermées). */
export interface DetailsHabillage {
  gardeCorps?: 'metal' | 'glass' | 'solid';
  menuiseries?: 'av-aluminium-noir' | 'av-aluminium-blanc' | 'av-aluminium-bronze';
  soubassement?: 'pierre-claire-contemp' | 'beton-brut' | 'brique-rouge';
}

/**
 * Lot brief-unifié — détails du brief traduits pour le Studio ; null s'il n'y a rien à poser.
 * Garde-corps : TOUJOURS envoyé quand il y a des balcons (même « métal ») : pour un bâtiment seul, le lecteur
 * du Studio rendait des garde-corps vitrés dès que la phrase contenait « vitrées » (baies vitrées).
 */
export function detailsHabillage(b: BriefRendu): DetailsHabillage | null {
  const d: DetailsHabillage = {};
  if (b.balcons !== 'aucun') d.gardeCorps = ({ metal: 'metal', verre: 'glass', plein: 'solid' } as const)[b.garde_corps];
  if (b.menuiseries !== 'gris') d.menuiseries = ({ anthracite: 'av-aluminium-noir', blanc: 'av-aluminium-blanc', bronze: 'av-aluminium-bronze' } as const)[b.menuiseries];
  if (b.soubassement !== 'aucun') d.soubassement = ({ pierre: 'pierre-claire-contemp', beton: 'beton-brut', brique: 'brique-rouge' } as const)[b.soubassement];
  return Object.keys(d).length ? d : null;
}

/** « Crée un immeuble R+4 de 30 m sur 14 m. » + brief → « Crée un immeuble R+4 de 30 m sur 14 m, façade en brique, … . » */
export function commandeAvecBrief(commande: string | null, b: BriefRendu | null, plusieurs = false): string | null {
  if (!commande || !b) return commande;
  const clauses = clausesBrief(b, plusieurs);
  return clauses.length ? `${commande.trim().replace(/\.+$/, '')}, ${clauses.join(', ')}.` : commande;
}

/** Ligne lisible du brief (devis, brief texte transmis au Studio). */
export function libelleBrief(b: BriefRendu): string {
  const d = (c: ChampBrief) => (b.defauts.includes(c) ? ' (par défaut)' : '');
  return [
    `style ${LIB_BRIEF.style[b.style]}${d('style')}`,
    `façade ${libelleFacade(b)}${d('facade')}`,
    `${LIB_BRIEF.ouvertures[b.ouvertures]}${d('ouvertures')}`,
    `${LIB_BRIEF.balcons[b.balcons]}${d('balcons')}`,
    `${b.attique ? 'avec attique' : 'sans attique'}${d('attique')}`,
    `rez-de-chaussée : ${LIB_BRIEF.rdc[b.rdc]}${d('rdc')}`,
    `${LIB_BRIEF.ambiance[b.ambiance]}${d('ambiance')}`,
    // Lot brief-unifié : les détails ne sont écrits que s'ils changent le dessin par défaut du Studio.
    b.toiture !== 'terrasse' ? `${LIB_BRIEF.toiture[b.toiture]}${d('toiture')}` : null,
    b.balcons !== 'aucun' && b.garde_corps !== 'metal' ? `${LIB_BRIEF.garde_corps[b.garde_corps]}${d('garde_corps')}` : null,
    b.menuiseries !== 'gris' ? `${LIB_BRIEF.menuiseries[b.menuiseries]}${d('menuiseries')}` : null,
    b.soubassement !== 'aucun' ? `${LIB_BRIEF.soubassement[b.soubassement]}${d('soubassement')}` : null,
  ].filter((x): x is string => !!x).join(' · ') + (b.precisions ? ` · précisions : « ${b.precisions} »` : '');
}

/**
 * Ce que le Studio ne prend PAS (ou pas entièrement) en compte : dit dans le devis, jamais promis.
 * `plusieurs` : composition de bâtiments nommés (A à H, une commande par bâtiment) ; `batiments` :
 * nombre de bâtiments du contrat v2 (≥ 2 : chacun reçoit l'habillage, E1-rendu).
 */
export function reservesBrief(b: BriefRendu, source: 'version' | 'preparation', plusieurs = false, batiments = 0): string[] {
  if (source === 'version') {
    return ['Habillage : la version enregistrée dans l’Atelier 3D est rendue TELLE QUELLE ; style, façade, balcons, attique et rez-de-chaussée du brief ne la modifient pas (seule l’ambiance de lumière s’applique).'];
  }
  const r: string[] = [];
  if (batiments >= 2) r.push(`Ensemble de ${String(batiments)} bâtiments : l’habillage (façade, ouvertures, balcons ou loggias, attique, rez-de-chaussée, toiture, garde-corps, menuiseries, soubassement) est appliqué à chacun des ${String(batiments)} bâtiments, sans changer leur position, leurs dimensions ni leurs niveaux.`);
  if (b.style === 'contemporain') r.push('Style contemporain : pas de jeu de style dédié dans le Studio, c’est son dessin par défaut (seuls façade, ouvertures, balcons, attique et rez-de-chaussée le personnalisent).');
  else r.push(`Style ${LIB_BRIEF.style[b.style]} : prévu dans le Studio mais pas encore disponible (aucun décor régional) — NON appliqué : le bâtiment est rendu dans le dessin contemporain par défaut, avec la façade, les ouvertures, les balcons, l’attique et le rez-de-chaussée demandés.`);
  if (plusieurs && b.balcons !== 'aucun') r.push('Ensemble de plusieurs bâtiments : balcons non pris en compte par le Studio pour l’instant (il les poserait sur le seul premier bâtiment).');
  if (b.facade === 'verre' && b.ouvertures !== 'fenetres_verticales') r.push('Façade vitrée : le Studio pose de grandes baies, le choix d’ouvertures n’est pas appliqué.');
  if (b.rdc === 'hall') r.push('Rez-de-chaussée « hall d’entrée » : non pris en compte par le Studio pour l’instant (il dessine son entrée par défaut, rez-de-chaussée traité comme les étages).');
  if (b.rdc === 'commerces') r.push('Commerces en rez-de-chaussée : le Studio transforme le rez en surface commerciale avec vitrines ; le nombre de logements du volume d’étude n’est pas recalculé.');
  if (b.attique) r.push(`Attique : le Studio l’ajoute AU-DESSUS des niveaux du volume d’étude (retrait de 2 m)${batiments >= 2 ? ', sur chaque bâtiment' : ''} — la hauteur totale dépasse celle du volume calculé, à vérifier au regard du PLU.`);
  if (toitEnPente(b.toiture)) r.push(`Toit à deux pans (pente de 35°) : le Studio l’ajoute AU-DESSUS du dernier niveau (≈ 5,9 m au faîtage pour 16 m de profondeur)${batiments >= 2 ? ', sur chaque bâtiment' : ''} — la hauteur totale dépasse celle du volume calculé, à vérifier au regard du PLU.`);
  if (b.soubassement !== 'aucun') r.push('Soubassement : bandeau de 60 cm au pied des façades (matière demandée), interrompu devant les portes.');
  if (b.facade === 'brique' && b.teinte === 'claire') r.push('Brique claire : matière dessinée par le Studio (sans texture photographique, contrairement à la brique rouge).');
  if (b.precisions) r.push('Précisions libres : transmises au Studio à titre informatif, non interprétées pour l’instant.');
  return r;
}

// ── Brief créatif (carte du chat) ─────────────────────────────────────────
// La carte « Brief créatif » du chat (src/spaces/copilot/studio3d/CarteBriefCreatif.tsx) remplace
// la question texte. « Valider le brief » envoie un message utilisateur qui contient, après une ligne
// lisible, un bloc ```mimmoza-brief``` (JSON). index.ts le relit dans le message REÇU (jamais dans
// une sortie du modèle) et le passe à l'outil (`EnvStudio.briefCarte`) : le brief arrive structuré,
// sans reformulation par le modèle, et repasse par validerBrief (listes fermées ci-dessus).

/** Langue du bloc de code qui porte le brief dans le message utilisateur (même valeur côté front : briefCreatif.ts). */
export const BRIEF_BLOC_LANGUE = 'mimmoza-brief';
/** Version du bloc. */
export const BRIEF_BLOC_VERSION = 1;
/** Messages utilisateur relus pour retrouver le dernier brief choisi (fiche ou carte). */
export const BRIEF_MESSAGES_RELUS = 20;

/**
 * Lot fiche-3d — dernier brief VALIDE envoyé dans la conversation (bloc d'un message utilisateur,
 * carte ou fiche), avec son heure ; null sinon. Les blocs refusés sont ignorés (jamais devinés).
 */
export async function briefDuFil(depot: DepotStudio, userId: string, conversationId: string): Promise<{ brief: BriefRendu; ms: number } | null> {
  if (!depot.briefsMessages) return null;
  let lignes: { texte: string; cree_le: string }[] = [];
  try { lignes = await depot.briefsMessages(userId, conversationId); } catch { return null; }
  for (const l of lignes) {
    const v = briefDuMessage(l.texte);
    const ms = Date.parse(l.cree_le);
    if (v?.ok && Number.isFinite(ms)) return { brief: v.valeur.brief, ms };
  }
  return null;
}

export interface BriefCarte {
  brief: BriefRendu;
  type: TypeRendu | null;
  /**
   * LOT P2 — fond choisi dans la carte « Fond de l'image » sous le devis d'une image (bloc `fond`, relu ici dans le
   * message REÇU, jamais fourni par le modèle) : options de fond normalisées. Le dossier de la photo est revérifié
   * avec l'utilisateur du JWT dans lancerRendu.
   */
  fond?: OptionsFond;
}

/**
 * Bloc de brief d'un message utilisateur → brief validé. null : pas de bloc (cas normal).
 * Bloc présent mais illisible ou hors listes : `ok: false` (dit à l'utilisateur, jamais deviné).
 */
export function briefDuMessage(texte: unknown): Validation<BriefCarte> | null {
  if (typeof texte !== 'string') return null;
  const m = new RegExp('```' + BRIEF_BLOC_LANGUE + '[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n?```').exec(texte);
  if (!m) return null;
  let brut: unknown;
  try { brut = JSON.parse(m[1]); } catch { return { ok: false, erreur: 'Bloc de brief illisible (JSON invalide).' }; }
  if (!estObj(brut) || brut.v !== BRIEF_BLOC_VERSION) return { ok: false, erreur: 'Bloc de brief d’une version inconnue.' };
  const inconnue = Object.keys(brut).find((k) => !['v', 'type', 'brief', 'fond'].includes(k));
  if (inconnue) return { ok: false, erreur: `Bloc de brief : champ inconnu ${inconnue}.` };
  if (brut.type !== undefined && !(TYPES_RENDU as readonly unknown[]).includes(brut.type)) return { ok: false, erreur: 'Bloc de brief : type de rendu inconnu.' };
  const v = validerBrief(brut.brief);
  if (!v.ok) return { ok: false, erreur: v.erreur };
  // LOT P2 : fond de l'image (carte sous le devis). Seulement pour une image ; mêmes règles que la base.
  let fond: OptionsFond | undefined;
  if (brut.fond !== undefined) {
    if (brut.type !== 'image') return { ok: false, erreur: 'Bloc de brief : un fond ne se choisit que pour une image.' };
    if (!estObj(brut.fond) || Object.keys(brut.fond).some((k) => !(CLES_FOND as readonly string[]).includes(k))) return { ok: false, erreur: 'Bloc de brief : fond illisible.' };
    const f = validerFond(brut.fond);
    if (!f.ok) return { ok: false, erreur: f.erreur };
    fond = f.valeur;
  }
  return { ok: true, valeur: { brief: v.valeur, type: (brut.type as TypeRendu | undefined) ?? null, ...(fond ? { fond } : {}) } };
}

/** Consigne ajoutée au système quand le message de l'utilisateur porte un bloc de brief (index.ts). */
export function consigneBriefCarte(c: Validation<BriefCarte> | null): string {
  if (!c) return '';
  if (!c.ok) {
    return `BRIEF CRÉATIF : le dernier message contient un bloc de brief REFUSÉ par le serveur (${c.erreur}). ` +
      'Dis-le simplement et propose de refaire les choix dans l’Espace 3D (section habillage) ; ne devine aucune valeur.';
  }
  // Lot fiche-3d : brief choisi dans la fiche « Espace 3D » (bloc SANS type de rendu) — aucun rendu demandé.
  if (!c.valeur.type) {
    return 'HABILLAGE CHOISI dans la fiche du projet (Espace 3D ; dernier message de l’utilisateur) : ' + libelleBrief(c.valeur.brief) + '. ' +
      'Il est enregistré dans la conversation : le serveur le reprendra lui-même au prochain rendu (inutile de le recopier). ' +
      'N’appelle PAS studio_lancer_rendu et ne propose aucun devis, sauf si ce même message demande un rendu ; ' +
      'réponds en une phrase courte qui confirme l’habillage, sans reposer de question d’habillage.';
  }
  if (c.valeur.fond) {
    return `FOND DE L’IMAGE CHOISI sous le devis (dernier message de l’utilisateur) : ${LIBELLES_FOND[fondDe(c.valeur.fond)]}. ` +
      'Rappelle IMMÉDIATEMENT studio_lancer_rendu (type « image ») pour établir le NOUVEAU devis : le serveur lit lui-même le fond et l’habillage ' +
      'dans le message (ne recopie ni chemin de photo ni options) ; présente le devis et attends l’accord.';
  }
  return 'BRIEF CRÉATIF VALIDÉ dans l’Espace 3D (section habillage ; dernier message de l’utilisateur) : ' + libelleBrief(c.valeur.brief) + '. ' +
    `Rappelle IMMÉDIATEMENT studio_lancer_rendu${c.valeur.type ? ` (type « ${c.valeur.type} »)` : ''} pour établir le devis : ` +
    'le serveur lit ce brief lui-même dans le message (inutile de le recopier dans `brief`, ne le reformule pas) ; ' +
    'ne repose aucune question d’habillage.';
}

/** Corps de bâtiment de l'aperçu (mètres locaux, x vers l'est, y vers le nord ; angle du grand côté depuis l'est). */
export interface CorpsApercu { cx: number; cy: number; l: number; p: number; a: number; n: number; /** Lot formes-batiment : côtés accolés d'une aile. */ int?: number[] }
const FORMES_AILES: readonly string[] = ['l', 'u', 'cour', 'redans'];
export interface ApercuVolume { corps: CorpsApercu[]; contour: [number, number][] | null }
/** Points du contour de parcelle transmis au plus (aperçu seulement). */
export const APERCU_CONTOUR_MAX = 48;
/** Corps transmis au plus (même plafond que le Studio pour les bâtiments v2). */
export const APERCU_CORPS_MAX = 12;

/**
 * Aperçu du volume préparé pour la carte « Brief créatif » : les MÊMES corps que la vue 3D du
 * Dossier 3D (corpsAffiches), arrondis au décimètre, et le contour de la parcelle (allégé).
 * Aucune donnée inventée : null si le volume n'a pas d'emprise.
 */
export function apercuVolume(volume: unknown): ApercuVolume | null {
  if (!estObj(volume)) return null;
  let corps: ReturnType<typeof corpsAffiches>;
  try { corps = corpsAffiches(volume as unknown as VolumePropose); } catch { return null; }
  const r1 = (x: number) => Math.round(x * 10) / 10;
  // Lot formes-batiment : un bâtiment à ailes (L, U, cour, redans) → une boîte par aile (boitesApercu, même code que la fiche).
  const ailesLisibles = (c: (typeof corps)[number]) => Array.isArray(c.ailes) && c.ailes.length >= 2 && FORMES_AILES.includes(c.formeAiles as string)
    && c.ailes.every((a) => estObj(a) && fini(a.du) && fini(a.dv) && fini(a.lu) && fini(a.lv) && fini(a.niveaux) && a.lu > 0 && a.lv > 0);
  const liste = corps
    .filter((c) => fini(c.centre?.x) && fini(c.centre?.y) && fini(c.largeurM) && fini(c.profondeurM) && fini(c.angleDeg) && fini(c.niveaux) && c.largeurM > 0 && c.profondeurM > 0)
    .flatMap((c) => boitesApercu({ centre: c.centre, angleDeg: c.angleDeg, largeurM: c.largeurM, profondeurM: c.profondeurM, niveaux: c.niveaux,
      ...(ailesLisibles(c) ? { ailes: c.ailes, formeAiles: c.formeAiles } : {}) }))
    .slice(0, APERCU_CORPS_MAX);
  if (!liste.length) return null;
  const brut = Array.isArray(volume.contour) ? (volume.contour as unknown[]).filter((q): q is { x: number; y: number } => estObj(q) && fini(q.x) && fini(q.y)) : [];
  const pas = Math.max(1, Math.ceil(brut.length / APERCU_CONTOUR_MAX));
  const contour = brut.length >= 3 ? brut.filter((_, i) => i % pas === 0).slice(0, APERCU_CONTOUR_MAX).map((q) => [r1(q.x), r1(q.y)] as [number, number]) : null;
  return { corps: liste, contour: contour && contour.length >= 3 ? contour : null };
}

/** Ce que la carte doit savoir des limites du Studio pour CE projet (aucune promesse au-delà). */
export interface LimitesBrief {
  /** Nombre de bâtiments du volume préparé (≥ 2 : l'habillage est appliqué à chacun). */
  batiments: number;
  /** Faux pour une composition de bâtiments nommés A à H : le Studio ne poserait les balcons que sur le premier. */
  balcons: boolean;
  /**
   * Lot brief-formes : vrai si un bâtiment a des ailes (en L, en U, cour fermée, redans). Le Studio couvre
   * alors chaque aile d'un toit à deux pans SÉPARÉ (pas de noue, pignons à la jonction des ailes, faîtages
   * de hauteurs différentes sur une cour — mesuré le 06/11 sur AE0414) : le toit à deux pans n'est pas proposé.
   */
  ailes: boolean;
}

/** Lot brief-formes : un des bâtiments du contrat v2 a-t-il au moins deux ailes ? PUR. */
export function batimentsAAiles(charge: unknown): boolean {
  const bats = estObj(charge) && Array.isArray(charge.batiments) ? charge.batiments : [];
  return bats.some((b) => estObj(b) && Array.isArray(b.ailes) && b.ailes.length >= 2);
}

/** Lot brief-formes : raison du refus du toit à deux pans pour un bâtiment à ailes (même phrase que la carte). */
export const RAISON_PENTE_AILES = 'Toit à deux pans : pas encore disponible pour un bâtiment à ailes (en L, en U, cour fermée, redans) — le Studio couvrirait chaque aile d’un toit séparé, sans noue entre les ailes.';

function limitesPreparation(p: PreparationLue, conversationId: string, origine: string): LimitesBrief {
  const f = ficheDepuisPreparation(p, conversationId, new Date(0).toISOString(), crypto.randomUUID(), origine, null);
  if (!f.ok) return { batiments: 1, balcons: true, ailes: false };
  const charge = f.valeur.charge as { compositionArchitecture?: unknown[]; batiments?: unknown[] };
  const nb = charge.batiments?.length ?? 0;
  return { batiments: Math.max(1, nb), balcons: (charge.compositionArchitecture?.length ?? 0) < 2, ailes: batimentsAAiles(charge) };
}

/** Statistiques GLOBALES et anonymes de la file (aucune donnée d'un autre utilisateur n'est renvoyée). */
export interface StatsFile {
  attente: number;
  plusAncienneAttente: string | null;
  enCours: number;
  /** Dernière écriture du worker (progression d'un rendu en cours ou dernière fin), ISO. */
  derniereActivite: string | null;
}

export type EtatMachine = 'occupee' | 'active_recemment' | 'silencieuse' | 'inconnue';

/** État DÉDUIT de la machine de rendu (pas de battement de cœur au repos) — formulé comme une déduction. */
export function etatMachine(s: StatsFile | null, maintenant: number): { etat: EtatMachine; phrase: string } {
  if (!s) return { etat: 'inconnue', phrase: 'État de la machine de rendu inconnu (file illisible) : le rendu démarrera quand elle prendra le travail.' };
  const depuis = (iso: string | null) => (iso ? maintenant - Date.parse(iso) : Number.POSITIVE_INFINITY);
  const activite = depuis(s.derniereActivite);
  const attente = depuis(s.plusAncienneAttente);
  const duree = (ms: number) => (ms < 3_600_000 ? `${Math.max(1, Math.round(ms / 60_000))} min` : ms < 172_800_000 ? `${Math.round(ms / 3_600_000)} h` : `${Math.round(ms / 86_400_000)} jours`);
  if (s.enCours > 0 && activite <= ACTIVITE_RECENTE_MS) {
    return { etat: 'occupee', phrase: `La machine de rendu est en ligne et occupée (${s.enCours} rendu en cours, ${s.attente} en attente) : un seul rendu à la fois.` };
  }
  if (s.attente > 0 && attente > ATTENTE_SUSPECTE_MS && activite > ATTENTE_SUSPECTE_MS) {
    return { etat: 'silencieuse', phrase: `La machine de rendu ne donne pas signe de vie (${s.attente} rendu(s) en attente depuis ${duree(attente)}, dernière activité ${Number.isFinite(activite) ? `il y a ${duree(activite)}` : 'inconnue'}) : elle est probablement éteinte. Le rendu restera EN ATTENTE jusqu’à sa reprise.` };
  }
  if (activite <= ACTIVITE_RECENTE_MS) return { etat: 'active_recemment', phrase: `La machine de rendu a été active il y a ${duree(activite)}.` };
  return { etat: 'inconnue', phrase: `Dernière activité connue de la machine de rendu : ${Number.isFinite(activite) ? `il y a ${duree(activite)}` : 'aucune'}. Elle peut être éteinte : le rendu démarre dès qu’elle prend le travail (elle n’envoie aucun signal au repos).` };
}

// ── Jeton de devis (HMAC-SHA256) ───────────────────────────────────────────

export interface ChargeJeton {
  v: 1;
  id: string;
  u: string;
  t: TypeRendu;
  o: Obj;
  s: { genre: 'version'; conception_id: string; n: number; modele_ref: string } | { genre: 'preparation'; preparation_id: string };
  c: string;
  iat: number;
  exp: number;
  rq: string;
  /** Brief d'habillage validé, forme compacte (encoderBrief) ; absent des devis antérieurs à E1-brief. */
  b?: string;
}

const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

async function cleHmac(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey('raw', new TextEncoder().encode(`studio-devis-v1:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signerJeton(charge: ChargeJeton, secret: string): Promise<string> {
  const corps = b64u(new TextEncoder().encode(jsonCanonique(charge)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await cleHmac(secret), new TextEncoder().encode(corps)));
  return `${corps}.${b64u(sig)}`;
}

export async function lireJeton(jeton: unknown, secret: string): Promise<ChargeJeton | null> {
  if (typeof jeton !== 'string' || jeton.length > 4000) return null;
  const [corps, sig] = jeton.split('.');
  if (!corps || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await cleHmac(secret), deB64u(sig), new TextEncoder().encode(corps));
    if (!ok) return null;
    const c = JSON.parse(new TextDecoder().decode(deB64u(corps))) as ChargeJeton;
    return c && c.v === 1 && typeof c.id === 'string' && typeof c.u === 'string' ? c : null;
  } catch { return null; }
}

// ── Fiche du travail ───────────────────────────────────────────────────────

export interface PreparationLue {
  id: string;
  conception_id: string | null;
  conversation_id: string | null;
  idu: string;
  empreinte: string;
  entree: unknown;
  volume: unknown;
  resume: unknown;
  cree_le?: string | null;
}

/** Pose du volume unique : même conversion que confirmationRapide.implantationDepuisVolume (rotationContrat). */
export function poseDepuisVolume(v: Pick<VolumePropose, 'emprise'>): { lon: number; lat: number; orientationDeg: number; entryOffsetM: number } | null {
  const e = v.emprise;
  if (!e || !fini(e.centreWgs84.lon) || !fini(e.centreWgs84.lat) || !fini(e.angleDeg)) return null;
  // Lot P9 : orientation de la LONGUEUR (le Studio prend le plus grand côté de « 11 m x 16 m »).
  const axe = e.profondeurM > e.largeurM + 1e-9 ? e.angleDeg + 90 : e.angleDeg;
  return { lon: e.centreWgs84.lon, lat: e.centreWgs84.lat, orientationDeg: rotationContrat(axe), entryOffsetM: 0 };
}

export function titreRendu(draft: JarvisDraft): string {
  const parties = [draft.programme, draft.localisation].map((v) => v?.trim()).filter((v): v is string => Boolean(v));
  const t = (parties.length ? parties.join(' — ') : draft.objectif?.trim() || 'Projet Mimmoza').replace(/\s+/g, ' ');
  return t.length > 120 ? `${t.slice(0, 119)}…` : t;
}

/**
 * Fiche `studio_jobs` d'une 3D préparée : le projet v2 que « Voir en 3D » construirait (même code :
 * ficheStudioDepuisVolume, volumeBatimentsStudio, construireProjetChat), sans relief (le worker le
 * signale : terrain supposé plat) ni pièces jointes.
 */
export function ficheDepuisPreparation(p: PreparationLue, conversationId: string, horodatage: string, sessionId: string, origine: string, brief: BriefRendu | null = null, facadesVoie: readonly FacadeVoieFiche[] | null = null,
  options: { /** Lot P9 : façades recopiées dans `charge.site` (contrat photo-rue §2) ; sinon seulement pour poser le volume. */ facadesDansSite?: boolean } = {}): Validation<Obj> {
  const entree = (estObj(p.entree) ? p.entree : {}) as Partial<EntreePreparation>;
  const v0 = p.volume as VolumePropose;
  const parcelle = lireParcelle(entree.parcelle, p.idu);
  if (!parcelle || !estObj(p.volume) || !v0.emprise) return { ok: false, erreur: 'La 3D préparée est illisible : relancez la préparation.' };
  const reglesLues: RegleLue[] = Array.isArray(entree.regles) ? entree.regles : [];
  const rv = reglesVolume(reglesLues, entree.gabarit_niveaux ?? null, null);
  // Lot P9 : préparation antérieure au lot (sans `poseVoie`) → posée ici ; une préparation récente est rendue telle quelle.
  const vPose = facadesVoie && facadesVoie.length && !v0.poseVoie ? poserVolumeSurVoie(v0, parcelle.geometrie, facadesVoie, rv).volume : v0;
  // Lot P9 : mention d'une préparation antérieure au lot recalculée avec la règle du moteur (règles toutes estimées → dit).
  const valides = rv.regles.filter(regleValide);
  const v = valides.length && valides.every((r) => r.statut === 'estimee') && vPose.mentionPlu !== MENTION_REGLES_ESTIMEES ? { ...vPose, mentionPlu: MENTION_REGLES_ESTIMEES } : vPose;
  const draft = ficheStudioDepuisVolume(v, { adresse: entree.commune ?? null, reference: p.idu, programme: entree.programme_volume, base: null });
  if (!draft) return { ok: false, erreur: 'Aucun volume à transmettre.' };
  try { exigerPreparation3D(draft); } catch (e) { return { ok: false, erreur: e instanceof Error ? e.message : 'Fiche 3D incomplète.' }; }
  let vb: ReturnType<typeof volumeBatimentsStudio> = null;
  try { vb = volumeBatimentsStudio(v, draft); } catch (e) { return { ok: false, erreur: e instanceof Error ? e.message : 'Trop de bâtiments pour le Studio.' }; }
  const insee = /^\d{5}|^2[AB]\d{3}/.test(p.idu) ? p.idu.slice(0, 5) : null;
  // E1-brief : le brief habille la commande de création (seule entrée interprétée par le Studio
  // quand une commande existe) ; le texte `brief` le reprend à titre informatif.
  const composition = studioComposition(draft)?.map((c) => ({ ...c, commande: commandeAvecBrief(c.commande, brief, true) ?? c.commande })) ?? null;
  // Lot P9 : comment la hauteur est comptée (acrotère compris, décision de prudence) et où le volume est posé.
  const lignesP9 = [ligneHauteurFiche(v, rv), ...(v.poseVoie ? [v.poseVoie.message] : [])].join('\n');
  const texteBrief = `${brief ? `${draftBrief(draft)}\nhabillage demandé : ${libelleBrief(brief)}` : draftBrief(draft)}\n${lignesP9}`;
  const construit = construireProjetChat({
    conversationId, etudeId: null, sessionId, origine, retourUrl: null, revision: 0, horodatage,
    parcelles: [{ id: p.idu, feature: { type: 'Feature', properties: { id: p.idu, ...(insee ? { code_insee: insee } : {}) }, geometry: parcelle.geometrie } }],
    communeInsee: insee, adresse: entree.commune ?? null, pointAdresse: null, relief: null,
    implantation: vb ? null : poseDepuisVolume(v),
    brief: texteBrief, commandeArchitecture: composition ? null : commandeAvecBrief(studioCommand(draft), brief),
    compositionArchitecture: composition, volumeAiles: studioSegmentedVolume(draft),
    batiments: vb?.batiments ?? null, programmeVolume: vb,
  });
  if (!construit.ok) return { ok: false, erreur: `Projet Studio refusé par le contrat v2 : ${construit.erreur}` };
  // E1-rendu : plusieurs bâtiments → la commande est retirée par le worker ; l'habillage voyage à part.
  const multi = (vb?.batiments.length ?? 0) > 0;
  // LOT P2 — contrat CONTRAT-PHOTO-RUE.md §2 : `charge.site.facadesVoie` (côté voie déduit du cadastre) ; ABSENT si
  // non identifié (jamais une façade devinée). Ajouté après la validation du contrat v2 (clé lue par la machine de rendu).
  // Lot P9 : règles PLU de la conception dans `charge.regles` (source + statut lue / estimée), validées par le contrat v2.
  const regles = reglesFicheDepuisReglesLues(reglesLues);
  let projet = construit.projet;
  if (regles.length) {
    const lu = validerProjet({ ...construit.projet, regles });
    if (!lu.ok) return { ok: false, erreur: `Règles PLU refusées par le contrat v2 : ${'erreur' in lu ? lu.erreur : 'raison inconnue'}` };
    projet = lu.projet;
  }
  const charge = facadesVoie && facadesVoie.length && options.facadesDansSite !== false
    ? { ...projet, site: { ...projet.site, facadesVoie: facadesVoie.map((f) => ({ ...f, debut: [...f.debut], fin: [...f.fin] })) } }
    : projet;
  return { ok: true, valeur: {
    version: 1, charge, draft, titre: titreRendu(draft), conversation_id: conversationId, origine: 'mimmo', preparation_id: p.id,
    ...(brief ? { brief_rendu: brief } : {}),
    ...(brief && multi ? { habillage_batiments: habillageBatiments(brief) } : {}),
    // Lot brief-unifié : bâtiment seul ou composition nommée — clauses et balcons sont déjà dans la commande ;
    // seuls les DÉTAILS (garde-corps, menuiseries, soubassement) voyagent à part, posés par le worker (scene.mts).
    ...(brief && !multi && detailsHabillage(brief) ? { habillage_batiments: { clauses: [], balcons: null, details: detailsHabillage(brief) } } : {}),
  } };
}

// =============================================================
// 5. Accès aux données (injecté)
// =============================================================

export interface TravailLu {
  id: string;
  conversation_id: string | null;
  type: string;
  statut: string;
  progression: number;
  etape: string | null;
  resultat: unknown;
  elements_omis: unknown;
  erreur: string | null;
  cree_le: string;
  demarre_le: string | null;
  termine_le: string | null;
}

export interface DepotStudio {
  conception(userId: string, q: { id?: string | null; idu?: string | null }): Promise<ConceptionLue | null>;
  derniereVersion(userId: string, conceptionId: string): Promise<{ n: number; modele_ref: string } | null>;
  /** Upsert idempotent par (user_id, empreinte) ; renvoie l'id. */
  enregistrerPreparation(userId: string, ligne: Omit<PreparationLue, 'id' | 'cree_le'> & { origine: 'chat' | 'mission'; version_calcul: string }): Promise<string>;
  preparation(userId: string, q: { id?: string | null; conceptionId?: string | null; conversationId?: string | null }): Promise<PreparationLue | null>;
  /** _studio_job_options_valides(type, options) : true / false ; null si la base n'a pas pu répondre. */
  typeRenduAutorise(type: TypeRendu, options: Obj): Promise<boolean | null>;
  statsFile(): Promise<StatsFile | null>;
  travauxActifs(userId: string): Promise<number>;
  travailParDevis(userId: string, devisId: string): Promise<TravailLu | null>;
  /**
   * Jetons des devis déjà présentés dans la conversation (sorties de studio_lancer_rendu
   * enregistrées dans copilot_tool_calls), du plus récent au plus ancien. Ces lignes ne sont
   * écrites qu'en fin de requête : un devis de la requête en cours n'y figure jamais.
   * Erreur de lecture → [] (on retombe sur le jeton fourni par le modèle).
   */
  jetonsDevis(userId: string, conversationId: string): Promise<string[]>;
  /**
   * E1-brief : la question groupée du brief a-t-elle déjà été posée dans la conversation (sortie
   * `data.brief_requis` de studio_lancer_rendu dans copilot_tool_calls, requêtes précédentes) ?
   * Erreur de lecture → false (on repose la question plutôt que d'imposer des valeurs).
   */
  questionBriefPosee(userId: string, conversationId: string): Promise<boolean>;
  /**
   * Lot fiche-3d : messages UTILISATEUR récents de la conversation qui portent un bloc ```mimmoza-brief```
   * (carte « Brief créatif » ou fiche « Espace 3D »), du plus récent au plus ancien. Relus par
   * briefDuMessage : le brief choisi dans la fiche, sans rendu, est repris au rendu suivant.
   * Facultatif (anciens dépôts) ; erreur de lecture → [].
   */
  briefsMessages?(userId: string, conversationId: string): Promise<{ texte: string; cree_le: string }[]>;
  /** Insertion SOUS L'IDENTITÉ de l'utilisateur (RLS) ; lève une Error portant le message Postgres. */
  insererTravail(userId: string, ligne: { conversation_id: string; type: TypeRendu; fiche: Obj; options: Obj }): Promise<TravailLu>;
  travail(userId: string, q: { id?: string | null; conversationId?: string | null }): Promise<TravailLu | null>;
  /** Nombre de travaux en attente créés avant `creeLe` (toute la file, anonyme). */
  positionFile(creeLe: string): Promise<number | null>;
  urlSigneeRendu(chemin: string, secondes: number): Promise<string | null>;
  /**
   * LOT P2 — photos de rue sous Licence Ouverte (Panoramax, instance IGN) à 60 m au plus du contour.
   * Facultatif (dépôt de test) ; ne lève jamais (échec → `{ ok: false, raison }`, couverture « non vérifiée »).
   */
  couverturePhotoRue?(contour: LonLat[]): Promise<ResultatCouverture>;
}

export interface EnvStudio {
  /** Utilisateur du JWT vérifié (chat) ou de la mission ; jamais une valeur du modèle. */
  userId: string | null;
  depot: DepotStudio;
  /** Secret HMAC des devis ; null = rendus indisponibles. */
  secret: string | null;
  /** Identifiant de la requête HTTP en cours (un message utilisateur = une requête). */
  requete: string;
  conversationId: string | null;
  origine: string;
  /** Vrai en mission (aucun rendu possible). */
  mission?: boolean;
  /** Mission : conception déjà en mémoire (évite une relecture). */
  conception?: ConceptionLue | null;
  maintenant?: () => number;
  /**
   * Brief validé dans la carte « Brief créatif » : lu par index.ts dans le message REÇU de
   * l'utilisateur (briefDuMessage), jamais fourni par le modèle. Prioritaire sur `input.brief`.
   */
  briefCarte?: Validation<BriefCarte> | null;
  /**
   * Lot formes-batiment : forme choisie dans la fiche « Espace 3D » (bloc ```mimmoza-forme``` du message REÇU,
   * relu par index.ts avec formeDuMessage), jamais fournie par le modèle. Prioritaire sur `input.forme`.
   */
  formeCarte?: Validation<SaisieDimensions> | null;
}

/** Identifiant stable de la requête : le même objet de contexte est passé à chaque outil d'une requête. */
const REQUETES = new WeakMap<object, string>();
export function idRequete(ctx: unknown): string {
  if (!ctx || typeof ctx !== 'object') return crypto.randomUUID();
  let id = REQUETES.get(ctx);
  if (!id) { id = crypto.randomUUID(); REQUETES.set(ctx, id); }
  return id;
}

// ── Lot choix-cliquables : la question d'habillage n'est JAMAIS posée par le modèle ─────────────
// Incident du 06/11/2026 : après studio_preparer_3d, le modèle a écrit lui-même « Façade : enduit clair,
// brique… ? Balcons : … ? » sans appeler studio_lancer_rendu — la carte « Brief créatif » (sortie
// brief_requis de l'outil) n'est donc jamais apparue.

/** Consigne ajoutée au système quand les outils Studio sont proposés au tour (index.ts). */
export const CONSIGNE_RENDU_STUDIO =
  'RENDUS STUDIO — HABILLAGE : ne pose JAMAIS toi-même la question d’habillage (façade, ouvertures, balcons ou loggias, attique, ' +
  'rez-de-chaussée, ambiance), ni en texte ni en bloc mimmoza-choix. Dès que l’utilisateur demande un rendu (film, visite 360°, image), ' +
  'appelle studio_lancer_rendu dans le même tour (après studio_preparer_3d si la 3D n’est pas encore préparée), sans `brief` sauf si ' +
  'ses choix d’habillage sont déjà écrits dans son message : c’est l’outil qui ouvre la carte « Brief créatif » dans l’Espace 3D (ou reprend l’habillage ' +
  'déjà choisi) puis le devis. Seul le TYPE de rendu peut se demander, s’il n’est pas précisé (bloc mimmoza-choix : Film, Visite 360°, Image).';

const RE_RENDU_TYPE = /(^|[^\p{L}])(films?|vid[ée]os?|visites?\s+(?:virtuelles?|immersives?|360|3\s?d)|360\s?°|image\s+photo|images\s+photo|photo-?r[ée]alis\p{L}*)(?![\p{L}])/iu;
const RE_RENDU_NIE = /(^|[^\p{L}])(pas|sans|aucun|aucune|ni)\s+(?:de\s+|d['’]\s*|la\s+|le\s+|l['’]\s*)?(films?|vid[ée]os?|visites?|images?|rendus?)(?![\p{L}])/iu;

/** Le message demande-t-il un rendu d'un TYPE précis (film, vidéo, visite virtuelle / 360°, image photoréaliste) ? */
export function renduTypeDemande(texte: string): boolean {
  if (!texte) return false;
  return RE_RENDU_TYPE.test(texte) && !RE_RENDU_NIE.test(texte);
}

/**
 * Garde-fou serveur (index.ts) : après une préparation 3D RÉUSSIE dans cette requête, si l'utilisateur a demandé
 * un rendu typé et que studio_lancer_rendu n'a pas encore été appelé, le tour suivant est IMPOSÉ sur cet outil
 * (tool_choice) — le modèle ne peut plus écrire la question d'habillage à sa place. Une seule fois par requête.
 * Rien n'est lancé ni chiffré par ce seul appel : sans brief, l'outil renvoie la carte « Brief créatif » ;
 * avec un brief connu, un DEVIS (le lancement exige toujours un accord dans un tour suivant).
 */
export function doitForcerLancerRendu(p: {
  texteUtilisateur: string;
  appels: readonly { name: string; status?: string }[];
  outilDisponible: boolean;
  dejaForce: boolean;
  briefCarte: boolean;
}): boolean {
  if (!p.outilDisponible || p.dejaForce || p.briefCarte) return false;
  if (!renduTypeDemande(p.texteUtilisateur)) return false;
  if (p.appels.some((a) => a.name === 'studio_lancer_rendu')) return false;
  return p.appels.some((a) => a.name === 'studio_preparer_3d' && a.status === 'success');
}

/** Les outils Studio méritent-ils d'être proposés à ce tour ? (dernier message utilisateur, dernière réponse) */
export function studioPertinent(textes: readonly string[]): boolean {
  const RE = /\b(3\s?d|studio|maquette|volume|implantation|rendu|rendus|image|images|film|vid[ée]o|visite|360|perspective|photor[ée]alist)/i;
  return textes.some((t) => RE.test(t ?? ''));
}

// =============================================================
// 6. Exécution des outils
// =============================================================

function erreur(message: string, status: ResultatOutil['status'] = 'error'): ResultatOutil {
  return { status, source: SOURCE_STUDIO, message };
}

export async function executerOutilStudio(nom: string, input: Obj, env: EnvStudio): Promise<ResultatOutil | null> {
  if (!['studio_preparer_3d', 'studio_lancer_rendu', 'studio_etat_rendu'].includes(nom)) return null;
  if (!env.userId) return erreur("Session requise : l'utilisateur n'est pas authentifié. Ne prétends pas que l'action a été faite.");
  try {
    if (nom === 'studio_preparer_3d') return await preparer3D(input, env);
    if (env.mission) return erreur('Les rendus ne se lancent jamais depuis une mission : proposez-les dans le chat (accord explicite requis).');
    if (nom === 'studio_lancer_rendu') return await lancerRendu(input, env);
    return await etatRendu(input, env);
  } catch (e) {
    return erreur(`Service Studio indisponible : ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`);
  }
}

async function resoudreConception(input: Obj, env: EnvStudio): Promise<ConceptionLue | null> {
  if (env.conception) return env.conception;
  const id = estUuid(input.conception_id) ? input.conception_id : null;
  const idu = typeof input.idu === 'string' ? input.idu.replace(/\s/g, '').toUpperCase() : null;
  return await env.depot.conception(env.userId!, { id, idu: idu && RE_IDU.test(idu) ? idu : null });
}

async function preparer3D(input: Obj, env: EnvStudio): Promise<ResultatOutil> {
  const c = await resoudreConception(input, env);
  if (!c) {
    return erreur('Aucune conception trouvée pour cet utilisateur' + (input.idu ? ` sur ${String(input.idu)}` : '') +
      ". Une conception (parcelle, règles PLU, programme) se prépare par une mission de conception (proposer_mission, type « conception »).", 'not_found');
  }
  // Lot formes-batiment : forme choisie dans la fiche (bloc du message, relu par index.ts) ou paramètre `forme`.
  const carte = env.formeCarte ?? null;
  if (carte && !carte.ok) return erreur(`Forme choisie dans la fiche refusée : ${carte.erreur}`, 'partial');
  const formeVoulue = typeof input.forme === 'string' && (input.forme === 'auto' || FORMES.some((f) => f.valeur === input.forme)) ? input.forme as Forme | 'auto' : null;
  const p = await preparerVolume(c, carte?.ok ? { saisie: carte.valeur } : { forme: formeVoulue });
  if (!p.ok) return erreur(p.raison, 'partial');
  const id = await env.depot.enregistrerPreparation(env.userId!, {
    conception_id: c.id, conversation_id: env.conversationId, idu: c.idu, empreinte: p.empreinte,
    entree: p.entree, volume: p.volume, resume: p.resume, origine: env.mission ? 'mission' : 'chat', version_calcul: VERSION_CALCUL,
  });
  return {
    status: 'ok', source: SOURCE_STUDIO,
    data: {
      preparation_id: id, conception_id: c.id, idu: c.idu, commune: c.commune, empreinte: p.empreinte,
      calcul: 'déterministe — moteur du Dossier 3D (volumeParcelle + implantationProgramme), aucune IA',
      volume: env.mission ? resumeCompact(p.resume) : p.resume,
      // Lot formes-batiment : forme retenue et classement des formes par le moteur (suggestion, l'utilisateur choisit).
      // (Mission : résultat plafonné à 3 000 caractères → seulement la suggestion.)
      ...(p.resume.forme ? { forme_retenue: p.resume.forme.retenue, origine_forme: p.resume.forme.origine,
        ...(env.mission ? { forme_suggeree: p.resume.forme.comparaison.find((x) => !x.raison)?.libelle ?? null }
          : { formes_comparees: p.resume.forme.comparaison.slice(0, 8) }) } : {}),
      ouverture: env.mission
        ? "Enregistrée : l'utilisateur l'ouvre depuis le chat (« ouvre la 3D préparée de ma conception »)."
        : "Bouton « Ouvrir la 3D préparée » dans le Dossier 3D, à droite du chat (un clic).",
    },
    message:
      'Volume d’étude INDICATIF, calculé par le moteur (ne recalcule rien de tête, cite ces chiffres tels quels). ' +
      'Reprends chaque vérification avec son verdict : « dans la limite de la règle citée » seulement si verdict dans_la_limite, sinon « à vérifier » ou « non contrôlé » ; ' +
      'n’écris jamais « conforme ». Rien n’a été envoyé au Studio : l’utilisateur ouvre la 3D d’un clic. ' +
      // Lot C11 — mission : le message s'arrête ici. La suite ne concerne que le chat (fiche, habillage, rendu — interdit
      // en mission —, comparaison des formes non transmise en mission) et faisait dépasser le plafond du résultat d'outil.
      (env.mission ? '' :
      'Dans la fiche ```mimmoza-3d```, programme et dimensions sont ceux de CE volume (bâtiments, gabarit, SDP estimée, logements) : ' +
      'n’y écris aucun autre chiffre (le gabarit du programme est un plafond, pas le volume ; aucune SHAB n’est calculée) — la fiche du chat affiche les chiffres du moteur. ' +
      'HABILLAGE : ne pose JAMAIS toi-même la question d’habillage (façade, ouvertures, balcons ou loggias, attique, rez-de-chaussée, ambiance), ' +
      'ni en texte ni en bloc ```mimmoza-choix```. Si l’utilisateur a demandé un rendu (film, visite 360°, image), appelle MAINTENANT ' +
      'studio_lancer_rendu (sans `brief`, sauf choix d’habillage déjà donnés en texte) : l’outil ouvre la carte « Brief créatif » dans l’Espace 3D ou reprend ' +
      'l’habillage déjà choisi, puis le devis. Sinon, propose un rendu en une phrase, sans détailler l’habillage. ' +
      'FORME : `forme_retenue` est la forme de CE volume ; `formes_comparees` est le classement du moteur (dans les règles, logements, niveaux, ' +
      'façade, emprise) : présente la première comme une SUGGESTION en une phrase — l’utilisateur choisit dans la fiche (« Forme et dimensions ») ' +
      'ou te le demande (paramètre `forme`). Les formes à ailes (L, U, cour, redans) partent au Studio aile par aile.'),
  };
}

interface SourceRendu { genre: 'version'; conception_id: string; n: number; modele_ref: string }
interface SourcePrep { genre: 'preparation'; preparation: PreparationLue }

async function resoudreSource(input: Obj, env: EnvStudio): Promise<{ ok: true; source: SourceRendu | SourcePrep; conceptionId: string | null } | { ok: false; res: ResultatOutil }> {
  const voulu = input.source === 'version' || input.source === 'preparation' ? input.source : 'auto';
  const uid = env.userId!;
  let prep: PreparationLue | null = null;
  if (estUuid(input.preparation_id)) {
    prep = await env.depot.preparation(uid, { id: input.preparation_id });
    if (!prep) return { ok: false, res: erreur('3D préparée introuvable pour cet utilisateur.', 'not_found') };
  }
  const conceptionId = prep?.conception_id ?? (estUuid(input.conception_id) ? input.conception_id : null);
  const conception = conceptionId ? { id: conceptionId } : (await env.depot.conception(uid, {}));
  if (voulu !== 'preparation' && conception?.id) {
    const v = await env.depot.derniereVersion(uid, conception.id);
    if (v) return { ok: true, source: { genre: 'version', conception_id: conception.id, n: v.n, modele_ref: v.modele_ref }, conceptionId: conception.id };
    if (voulu === 'version') return { ok: false, res: erreur('Aucune version enregistrée dans l’Atelier 3D pour cette conception : enregistrez une version, ou rendez la 3D préparée (source « preparation »).', 'not_found') };
  }
  prep ??= await env.depot.preparation(uid, { conceptionId: conception?.id ?? null, conversationId: conception?.id ? null : env.conversationId });
  if (!prep) return { ok: false, res: erreur('Rien à rendre : préparez d’abord la 3D de la conception (studio_preparer_3d), ou enregistrez une version dans l’Atelier 3D.', 'not_found') };
  return { ok: true, source: { genre: 'preparation', preparation: prep }, conceptionId: prep.conception_id };
}

function libelleSource(s: SourceRendu | SourcePrep): string {
  return s.genre === 'version'
    ? `version ${s.n} enregistrée dans l’Atelier 3D (le modèle exact du Studio est rendu)`
    : `3D préparée par Mimmo (volume d’étude, ${s.preparation.idu})`;
}

function avertissementsSource(s: SourceRendu | SourcePrep): string[] {
  if (s.genre === 'version') return [];
  const v = s.preparation.volume as VolumePropose | null;
  const n = v?.batiments?.length ?? 1;
  // E1-fidélité : le gabarit du programme (R+n) PLAFONNE les niveaux (reglesVolume) ; le moteur
  // commence en R+2 et ne monte que si nécessaire. Le rendu montre le volume préparé, pas le gabarit.
  const entree = (estObj(s.preparation.entree) ? s.preparation.entree : {}) as Partial<EntreePreparation>;
  const gabarit = typeof entree.gabarit_niveaux === 'number' && fini(entree.gabarit_niveaux) ? entree.gabarit_niveaux : null;
  const niveaux = v && fini(v.niveaux) ? v.niveaux : null;
  return [
    'Le relief n’est pas transmis par Mimmo : la machine de rendu calcule sur un terrain supposé plat (elle le signale dans le résultat).',
    ...(n > 1 ? [`La 3D préparée compte ${n} bâtiments : chacun est reconstruit à sa place, avec l’orientation, les dimensions et le nombre de niveaux du volume préparé.`] : []),
    ...(gabarit !== null && niveaux !== null && niveaux < gabarit
      ? [`Le gabarit du programme (${libelleNiveaux(gabarit)}) est un plafond, pas une cible : le volume préparé, et donc le rendu, est en ${libelleNiveaux(niveaux)} (${n} bâtiment${n > 1 ? 's' : ''}).`]
      : []),
  ];
}

/**
 * Dernier devis présenté dans la conversation (copilot_tool_calls) qui satisfait `filtre` :
 * jeton signé par le serveur, même utilisateur, même conversation. `nonLance` écarte les devis
 * déjà transformés en travail (pour la réutilisation d'un devis, pas pour la confirmation,
 * qui doit pouvoir répondre « déjà lancé »).
 */
async function devisDeLaConversation(
  env: EnvStudio, uid: string, filtre: (c: ChargeJeton) => boolean, nonLance = false,
): Promise<{ jeton: string; charge: ChargeJeton } | null> {
  if (!env.secret || !env.conversationId) return null;
  let jetons: string[] = [];
  try { jetons = await env.depot.jetonsDevis(uid, env.conversationId); } catch { return null; }
  for (const jeton of jetons.slice(0, DEVIS_RELUS_MAX)) {
    const c = await lireJeton(jeton, env.secret);
    if (!c || c.u !== uid || c.c !== env.conversationId || !filtre(c)) continue;
    if (nonLance && await env.depot.travailParDevis(uid, c.id)) continue;
    return { jeton, charge: c };
  }
  return null;
}

async function lancerRendu(input: Obj, env: EnvStudio): Promise<ResultatOutil> {
  if (!env.secret) return erreur('Rendus indisponibles : secret de devis non configuré côté serveur.', 'not_configured');
  if (!env.conversationId) return erreur('Ouvrez d’abord une conversation : le rendu est rattaché au chat.');
  const maintenant = (env.maintenant ?? Date.now)();
  const uid = env.userId!;

  // ── Temps 2 : confirmation ───────────────────────────────────
  if (input.confirmer === true) {
    const lu = await lireJeton(input.jeton_devis, env.secret);
    const fourni = lu && lu.u === uid ? lu : null;
    const confirmable = (c: ChargeJeton) => c.exp >= maintenant && c.rq !== env.requete
      && (input.type === undefined || input.type === c.t);
    // Le jeton recopié par le modèle d'abord ; sinon (absent, expiré, du même tour, autre type),
    // le dernier devis présenté dans la conversation et encore confirmable.
    let j: ChargeJeton | null = fourni && confirmable(fourni) ? fourni : null;
    j ??= (await devisDeLaConversation(env, uid, confirmable))?.charge ?? null;
    if (!j) {
      if (!fourni) return erreur('Confirmation refusée : aucun devis valable dans cette conversation. RIEN N’A ÉTÉ LANCÉ. Rappelle l’outil SANS confirmer pour établir un devis, présente-le et attends l’accord.');
      if (fourni.exp < maintenant) return erreur(`Devis expiré (validité ${DEVIS_VALIDITE_MS / 3_600_000} h). RIEN N’A ÉTÉ LANCÉ. Rappelle l’outil SANS confirmer : présente le nouveau devis ; un simple accord dans le message suivant suffira.`);
      if (fourni.rq === env.requete) {
        return erreur("Confirmation refusée : elle doit venir d'un message SUIVANT de l'utilisateur, après lecture du devis. RIEN N'A ÉTÉ LANCÉ. Présente le devis et attends sa réponse.");
      }
      return erreur('Le type demandé ne correspond pas au devis : établis un nouveau devis. RIEN N’A ÉTÉ LANCÉ.');
    }
    const deja = await env.depot.travailParDevis(uid, j.id);
    if (deja) return { status: 'ok', source: SOURCE_STUDIO, data: { deja_lance: true, ...vueTravail(deja) }, message: 'Ce devis a déjà été lancé : rien n’a été relancé.' +
        ' Le suivi puis le résultat (images, film ou lien de visite) s’affichent dans une carte du chat sous ce message : inutile de recopier les liens ou les images dans ta réponse.' +
        MESSAGE_ETAT_EN_DIRECT };
    if (j.t === 'image' && (await env.depot.typeRenduAutorise('image', j.o)) === false) return fondPhoto(j.o) ? refusFondPhoto() : refusImage();
    let fiche: Obj;
    if (j.s.genre === 'version') {
      fiche = { version: 1, conception: { conception_id: j.s.conception_id, n: j.s.n, modele_ref: j.s.modele_ref }, titre: `Conception — version ${j.s.n}`, conversation_id: j.c, origine: 'mimmo', ...(briefDuJeton(j.b) ? { brief_rendu: briefDuJeton(j.b) } : {}) };
    } else {
      const prep = await env.depot.preparation(uid, { id: j.s.preparation_id });
      if (!prep) return erreur('La 3D préparée du devis n’existe plus. RIEN N’A ÉTÉ LANCÉ.', 'not_found');
      // LOT P2 : façades sur voie (contrat §2) dans le site pour toute image ; LOT P9 : lues pour tout rendu, pour poser
      // le volume au recul sur voie (film et visite compris), recopiées dans le site seulement pour l'image.
      const facades = (await facadesVoiePreparation(env, uid, prep)).facades;
      const f = ficheDepuisPreparation(prep, j.c, new Date(maintenant).toISOString(), crypto.randomUUID(), env.origine, briefDuJeton(j.b), facades, { facadesDansSite: j.t === 'image' });
      if (!f.ok) return erreur(`${f.erreur} RIEN N’A ÉTÉ LANCÉ.`);
      fiche = f.valeur;
    }
    fiche.devis_id = j.id;
    let t: TravailLu;
    try {
      t = await env.depot.insererTravail(uid, { conversation_id: j.c, type: j.t, fiche, options: j.o });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (/déjà 2 films ou visites|studio_jobs_plafond/.test(m)) return erreur(`Vous avez déjà ${NOMBRE_MAX_TRAVAUX_ACTIFS} rendus en préparation : attendez qu’un se termine. RIEN N’A ÉTÉ LANCÉ.`);
      if (/studio_jobs_type_check/.test(m)) return refusImage();
      if (/Options du travail invalides/.test(m)) return erreur('Options refusées par la base. RIEN N’A ÉTÉ LANCÉ.');
      return erreur(`Le lancement n’a pas abouti (${m.slice(0, 200)}). RIEN N’A ÉTÉ LANCÉ.`);
    }
    const machine = etatMachine(await env.depot.statsFile(), maintenant);
    return {
      status: 'ok', source: SOURCE_STUDIO,
      data: { lance: true, ...vueTravail(t), machine: machine.phrase, suivi: 'studio_etat_rendu (sans argument : le plus récent de la conversation)' },
      message: 'Rendu ENREGISTRÉ dans la file (statut « en attente » tant que la machine de rendu ne l’a pas pris). ' +
        'Dis qu’il est enregistré ; n’annonce aucun démarrage ni délai qui ne soit pas renvoyé. Le suivi s’affiche aussi dans le Dossier 3D.' +
        ' Le suivi puis le résultat (images, film ou lien de visite) s’affichent dans une carte du chat sous ce message : inutile de recopier les liens ou les images dans ta réponse.' +
        MESSAGE_ETAT_EN_DIRECT,
    };
  }

  // ── Temps 1 : devis, AUCUNE écriture ─────────────────────────
  // Brief créatif : bloc du message de l'utilisateur, relu par le serveur (prioritaire sur le modèle).
  const carte = env.briefCarte ?? null;
  if (carte && !carte.ok) return erreur(`Le brief de la carte n’a pas été accepté (${carte.erreur}). RIEN N’A ÉTÉ LANCÉ. Propose à l’utilisateur de refaire ses choix dans la carte d’habillage de l’Espace 3D.`);
  const type = (input.type ?? (carte?.ok ? carte.valeur.type : undefined)) as TypeRendu;
  // LOT P2 : le fond choisi dans la carte (lu dans le message reçu) l'emporte sur celui du modèle.
  const optionsDemandees: unknown = type === 'image' && carte?.ok && carte.valeur.fond
    ? { ...Object.fromEntries(Object.entries(estObj(input.options) ? input.options : {}).filter(([k]) => !(CLES_FOND as readonly string[]).includes(k))), ...carte.valeur.fond }
    : input.options;
  const opts0 = validerOptionsRendu(type, optionsDemandees, uid);
  if (!opts0.ok) return erreur(`${opts0.erreur} RIEN N’A ÉTÉ LANCÉ.`);
  if (type === 'image') {
    const autorise = await env.depot.typeRenduAutorise('image', opts0.valeur);
    if (autorise === false) return fondPhoto(opts0.valeur) ? refusFondPhoto() : refusImage();
  }
  const src = await resoudreSource(input, env);
  if (!src.ok) return src.res;
  if (type === 'image' && fondPhoto(opts0.valeur) && src.source.genre !== 'preparation') {
    return erreur('L’image sur une photo de rue ne se fait pour l’instant qu’à partir de la 3D préparée par Mimmo (la fiche d’une version enregistrée ne transmet pas la façade sur voie). RIEN N’A ÉTÉ LANCÉ. Propose l’image d’étude, ou la 3D préparée (source « preparation »).');
  }

  // ── Brief d'habillage (E1-brief) : fourni, déjà connu dans la conversation, ou question groupée ──
  let brief: BriefRendu | null = null;
  let origineBrief: 'fourni' | 'connu' | 'defaut_impose' | null = null;
  const briefCarteLu = !!carte?.ok;
  if (carte?.ok) {
    brief = carte.valeur.brief; origineBrief = 'fourni';
  } else if (input.brief !== undefined && input.brief !== null) {
    const v = validerBrief(input.brief);
    if (!v.ok) return erreur(`${v.erreur} RIEN N’A ÉTÉ LANCÉ.`);
    brief = v.valeur; origineBrief = 'fourni';
  } else {
    const connu = await devisDeLaConversation(env, uid, (c) => briefDuJeton(c.b) !== null);
    // Lot fiche-3d : un brief choisi dans la fiche (ou la carte) APRÈS le dernier devis l'emporte.
    const duFil = await briefDuFil(env.depot, uid, env.conversationId);
    if (duFil && (!connu || duFil.ms > connu.charge.iat)) { brief = duFil.brief; origineBrief = 'connu'; }
    else if (connu) { brief = briefDuJeton(connu.charge.b); origineBrief = 'connu'; }
  }
  // « Modifier l'habillage » demandé dans le chat : la carte s'ouvre, préremplie du brief connu.
  if (input.ouvrir_brief === true && src.source.genre === 'preparation' && !briefCarteLu) {
    const p = src.source.preparation;
    return demandeBrief(type, { actuel: brief, apercu: apercuVolume(p.volume), limites: limitesPreparation(p, env.conversationId, env.origine) });
  }
  if (!brief && src.source.genre === 'preparation') {
    let posee = false;
    try { posee = await env.depot.questionBriefPosee(uid, env.conversationId); } catch { posee = false; }
    const p = src.source.preparation;
    if (!posee) return demandeBrief(type, { actuel: null, apercu: apercuVolume(p.volume), limites: limitesPreparation(p, env.conversationId, env.origine) });
    // Jamais la même question deux fois : déjà posée dans un message précédent → valeurs par défaut, dites.
    brief = { ...BRIEF_DEFAUT, precisions: null, defauts: [...CHAMPS_BRIEF] }; origineBrief = 'defaut_impose';
  }
  // Ambiance : une seule valeur, celle des options du rendu (lue par la machine de rendu). Le brief la
  // fournit quand les options ne la précisent pas ; sinon il prend celle des options.
  const ambianceExplicite = estObj(optionsDemandees) && optionsDemandees.ambiance !== undefined;
  let optsEntree = optionsDemandees;
  if (brief && !ambianceExplicite) {
    if (type === 'image' && brief.ambiance === 'nuit' && !brief.defauts.includes('ambiance') && origineBrief === 'fourni') {
      return erreur('L’image se rend de jour ou en fin de journée (pas de nuit) : demande lequel des deux, ou propose un film / une visite 360° de nuit. RIEN N’A ÉTÉ LANCÉ.');
    }
    if (!(type === 'image' && brief.ambiance === 'nuit')) optsEntree = { ...(estObj(optionsDemandees) ? optionsDemandees : {}), ambiance: brief.ambiance };
  }
  const opts = validerOptionsRendu(type, optsEntree, uid);
  if (!opts.ok) return erreur(opts.erreur);
  if (brief && brief.ambiance !== opts.valeur.ambiance) {
    brief = { ...brief, ambiance: opts.valeur.ambiance as BriefRendu['ambiance'], defauts: ambianceExplicite ? brief.defauts.filter((c) => c !== 'ambiance') : brief.defauts };
  }

  // Composition de bâtiments nommés (A à H) : balcons et style ne sont pas transmis (voir clausesBrief).
  // Bâtiments du contrat v2 (≥ 2) : l'habillage est appliqué à chacun (habillageBatiments, E1-rendu).
  let plusieurs = false;
  let nbBatiments = 0;
  let aAiles = false;
  if (src.source.genre === 'preparation') {
    const f = ficheDepuisPreparation(src.source.preparation, env.conversationId, new Date(maintenant).toISOString(), crypto.randomUUID(), env.origine, brief);
    if (!f.ok) return erreur(f.erreur);
    plusieurs = ((f.valeur.charge as { compositionArchitecture?: unknown[] }).compositionArchitecture?.length ?? 0) >= 2;
    nbBatiments = (f.valeur.charge as { batiments?: unknown[] }).batiments?.length ?? 0;
    aAiles = batimentsAAiles(f.valeur.charge);
    // Lot brief-formes : jamais de toit à deux pans promis sur un bâtiment à ailes (le Studio ne le rend pas proprement).
    if (aAiles && brief && toitEnPente(brief.toiture)) {
      const p = src.source.preparation;
      if (origineBrief === 'fourni') return erreur(`${RAISON_PENTE_AILES} RIEN N’A ÉTÉ LANCÉ. Propose un toit-terrasse ou une toiture végétalisée (carte d’habillage de l’Espace 3D).`);
      return demandeBrief(type, { actuel: brief, apercu: apercuVolume(p.volume), limites: limitesPreparation(p, env.conversationId, env.origine) });
    }
  }
  const actifs = await env.depot.travauxActifs(uid);
  if (actifs >= NOMBRE_MAX_TRAVAUX_ACTIFS) return erreur(`Vous avez déjà ${actifs} rendus en préparation (${NOMBRE_MAX_TRAVAUX_ACTIFS} au plus) : attendez qu’un se termine.`);
  // LOT P2 — fond de l'image : couverture Panoramax et façade sur voie, dites dans le devis (rien n'est promis).
  const fondImage = type === 'image' && src.source.genre === 'preparation' ? await fondDuDevis(env, uid, src.source.preparation, opts.valeur) : null;
  const stats = await env.depot.statsFile();
  const machine = etatMachine(stats, maintenant);
  const sourceJeton: ChargeJeton['s'] = src.source.genre === 'version' ? src.source : { genre: 'preparation', preparation_id: src.source.preparation.id };
  // Un devis encore valable, aux mêmes paramètres (brief compris), a-t-il déjà été présenté dans un message précédent ?
  // Alors on le renvoie tel quel (même jeton) : l'accord donné après l'avoir lu reste confirmable.
  const memeDevis = (c: ChargeJeton) => c.exp >= maintenant && c.rq !== env.requete && c.t === type
    && jsonCanonique(c.o) === jsonCanonique(opts.valeur) && jsonCanonique(c.s) === jsonCanonique(sourceJeton)
    && (c.b ?? null) === (brief ? encoderBrief(brief) : null);
  const existant = await devisDeLaConversation(env, uid, memeDevis, true);
  const charge: ChargeJeton = existant?.charge ?? {
    v: 1, id: crypto.randomUUID(), u: uid, t: type, o: opts.valeur, s: sourceJeton,
    c: env.conversationId, iat: maintenant, exp: maintenant + DEVIS_VALIDITE_MS, rq: env.requete,
    ...(brief ? { b: encoderBrief(brief) } : {}),
  };
  const devis = {
    rendu: `${LIBELLE_TYPE[type]} — ${resumeOptions(type, opts.valeur)}`,
    source: libelleSource(src.source),
    ...(brief ? { habillage: libelleBrief(brief) } : {}),
    jetons: 0,
    cout_jetons: 'Aucun jeton débité pour ce rendu : les rendus ne sont pas facturés aujourd’hui (seul ce message du chat est compté, comme d’habitude).',
    calcul_gpu: 'Calcul sur la machine de rendu Mimmoza (carte graphique, Unreal), un rendu à la fois ; aucun service payant externe.',
    duree: dureeAnnoncee(type, opts.valeur),
    file_attente: stats ? `${stats.attente} rendu(s) en attente, ${stats.enCours} en cours` : 'inconnue',
    machine_de_rendu: machine.phrase,
    ...(type === 'image' ? { fond: LIBELLES_FOND[fondDe(opts.valeur)] } : {}),
    avertissements: [...avertissementsSource(src.source), ...(brief ? reservesBrief(brief, src.source.genre, plusieurs, nbBatiments) : []), ...(fondImage?.avertissements ?? [])],
    valable_jusqu_a: `${heureParis(charge.exp)} (heure de Paris)`,
  };
  const noteFond = type !== 'image' ? ''
    : ' FOND DE L’IMAGE : dans le devis, écris le fond retenu et, s’il est « étude seule », propose en une phrase l’image dans la photo de la rue ' +
      '(si `fond_image.couverture.couverte` est vrai : photo Panoramax / IGN sous Licence Ouverte) ou, sinon, avec la photo de l’utilisateur prise du trottoir d’en face ' +
      '(il la dépose dans la carte « Fond de l’image » sous le devis : jamais de chemin de photo inventé). Pour la photo de la rue, rappelle l’outil avec options.fond = "photo_rue". ' +
      'Ne promets jamais une image « insérée dans la rue » : la machine de rendu ne la livre ainsi que si le placement est vérifié, sinon image d’étude avec la raison.';
  const noteBrief = !brief ? ''
    : origineBrief === 'defaut_impose'
      ? ' La question du brief a DÉJÀ été posée : les valeurs par défaut sont appliquées (ne la repose pas) ; écris-le dans le devis. Si l’utilisateur avait donné des choix, rappelle l’outil avec `brief`.'
      : brief.defauts.length
        ? ' Dans le devis, écris l’habillage tel que renvoyé : les points marqués « par défaut » ont été choisis par Mimmo (dis-le).'
        : ' Dans le devis, écris l’habillage tel que renvoyé.';
  const noteReserves = brief ? ' Reprends les avertissements d’habillage tels quels (ce que le Studio ne prend pas en compte) : ne promets rien au-delà.' : '';
  const jeton = existant?.jeton ?? await signerJeton(charge, env.secret);
  // Brief créatif : de quoi rouvrir la carte (« Modifier l'habillage ») sous le devis, APRÈS le jeton
  // (le rappel des résultats ne garde que les 900 premiers caractères).
  const carteDevis = brief && src.source.genre === 'preparation'
    ? { brief_actuel: brief, apercu: apercuVolume(src.source.preparation.volume), limites: { batiments: Math.max(1, nbBatiments), balcons: !plusieurs, ailes: aAiles } }
    : {};
  const noteCarte = briefCarteLu
    ? ' Le brief vient de la carte « Brief créatif » de l’Espace 3D, validée par l’utilisateur (lu par le serveur dans son message) : présente-le tel quel ; une ligne « Modifier l’habillage » s’affiche sous le devis.'
    : '';
  if (existant) {
    return {
      status: 'confirmation_requise', source: SOURCE_STUDIO,
      data: { jeton_devis: jeton, confirmation_requise: true, deja_presente: true, type, options: opts.valeur, devis, ...carteDevis, ...(fondImage ? { fond_image: fondImage.donnees } : {}) },
      message:
        "RIEN N'A ÉTÉ LANCÉ. Ce devis a DÉJÀ été présenté à l'utilisateur dans un message précédent et reste valable " +
        `jusqu'à ${heureParis(charge.exp)} (heure de Paris). Si le DERNIER message de l'utilisateur donne son accord (« go », « oui », « vas-y », « confirme »…), ` +
        "rappelle IMMÉDIATEMENT studio_lancer_rendu avec confirmer: true, dans ce même tour, sans redemander l'accord. " +
        "Sinon, rappelle brièvement le devis et attends sa réponse. N'annonce jamais le rendu comme lancé avant un statut ok.",
    };
  }
  return {
    status: 'confirmation_requise', source: SOURCE_STUDIO,
    // jeton_devis EN PREMIER : le rappel des résultats précédents (index.ts) ne garde que les 900 premiers caractères.
    data: { jeton_devis: jeton, confirmation_requise: true, type, options: opts.valeur, devis, ...carteDevis, ...(fondImage ? { fond_image: fondImage.donnees } : {}) },
    message:
      "RIEN N'A ÉTÉ LANCÉ. Ceci est un DEVIS. Présente-le (rendu, source, habillage, jetons, temps de calcul, file, état de la machine de rendu, avertissements, " +
      "heure limite en heure de Paris) et demande l'accord. Si l'utilisateur répond OUI dans son PROCHAIN message, rappelle studio_lancer_rendu avec " +
      "confirmer: true (le jeton_devis est facultatif : le serveur retrouve ce devis). Ne refais pas de devis avant de confirmer. " +
      "N'annonce jamais le rendu comme lancé avant un statut ok." + noteBrief + noteReserves + noteCarte + noteFond,
  };
}

// ── LOT P2 (11/11/2026) — image dans sa rue ────────────────────────────────

/** Les options demandent-elles une image sur photo (rue ou client) ou un calage ? */
function fondPhoto(o: unknown): boolean {
  return estObj(o) && (fondDe(o) !== 'etude' || o.calage_client !== undefined);
}

function refusFondPhoto(): ResultatOutil {
  return erreur('L’image sur une photo de rue n’est pas encore activée dans la base (migration 20261111120000_studio_image_photo_rue non appliquée). RIEN N’A ÉTÉ LANCÉ. L’image d’étude reste disponible.', 'not_configured');
}

/** Points du contour transmis au plus dans le devis (plan de la carte « Fond de l'image »). */
export const CONTOUR_FOND_MAX = 48;

/**
 * Façades sur voie de la 3D préparée : relues dans la conception (parcelles voisines conservées au lot C7b).
 * Ne lève jamais : conception absente ou illisible → liste vide et raison.
 */
export async function facadesVoiePreparation(env: EnvStudio, uid: string, p: PreparationLue): Promise<{ facades: FacadeVoieFiche[]; raison: string | null }> {
  if (!p.conception_id) return { facades: [], raison: 'La 3D préparée n’est rattachée à aucune conception : parcelles voisines inconnues, façade sur voie non identifiée.' };
  let c: ConceptionLue | null = null;
  try { c = env.conception?.id === p.conception_id ? env.conception : await env.depot.conception(uid, { id: p.conception_id }); } catch { c = null; }
  if (!c) return { facades: [], raison: 'Conception de la 3D préparée introuvable : façade sur voie non identifiée.' };
  return facadesVoieDeLaParcelle(c.parcelle);
}

/** Ce que le devis d'une image dit du fond : données pour la carte et le modèle, avertissements. */
export async function fondDuDevis(env: EnvStudio, uid: string, p: PreparationLue, options: Obj): Promise<{ donnees: Obj; avertissements: string[] }> {
  const entree = (estObj(p.entree) ? p.entree : {}) as Partial<EntreePreparation>;
  const contour = contourDepuisGeometrie(estObj(entree.parcelle) ? entree.parcelle.geometrie : null);
  const fond = fondDe(options);
  const [voie, couv] = await Promise.all([
    facadesVoiePreparation(env, uid, p),
    contour && env.depot.couverturePhotoRue ? env.depot.couverturePhotoRue(contour).catch((): ResultatCouverture => ({ ok: false, raison: 'Couverture Panoramax non vérifiée.' })) : Promise.resolve(null),
  ]);
  const couverture: CouverturePhotoRue | null = couv?.ok ? couv.couverture : null;
  const longueur = Math.round(voie.facades.reduce((s, f) => s + f.longueurM, 0) * 100) / 100;
  const avertissements: string[] = [];
  if (fond !== 'etude') {
    avertissements.push('Insertion dans la photo : la machine de rendu propose un placement ; l’image n’est livrée « insérée dans la rue » que si ce placement est vérifié (ou validé par vous dans l’atelier). Sinon : image d’étude, avec la raison, et « Ajuster le placement ».');
    if (!voie.facades.length) avertissements.push(`Façade sur voie non identifiée (${(voie.raison ?? 'raison inconnue').replace(/[.\s]+$/u, '')}) : la machine de rendu ne pourra pas chercher la photo de la rue ; l’image d’étude sera livrée.`);
    if (fond === 'photo_rue' && couverture && !couverture.couverte) avertissements.push(`${phraseCouverture(couverture)} L’image d’étude sera livrée ; votre photo du trottoir reste possible.`);
    if (fond === 'photo_client') avertissements.push('Votre photo est conservée dans votre espace privé et n’est utilisée que pour ce rendu ; visages et plaques ne sont pas floutés.');
  }
  const r7 = (v: number) => Math.round(v * 1e7) / 1e7;
  const pas = contour ? Math.max(1, Math.ceil(contour.length / CONTOUR_FOND_MAX)) : 1;
  return {
    donnees: {
      choisi: fond,
      couverture: couverture ?? { verifiee: false, raison: couv && !couv.ok ? couv.raison : 'Couverture Panoramax non vérifiée.' },
      ...(couverture ? { couverture_phrase: phraseCouverture(couverture) } : {}),
      facade_sur_voie: voie.facades.length ? `identifiée : ${String(longueur).replace('.', ',')} m de limite sans parcelle mitoyenne (déduite du cadastre)` : `non identifiée — ${voie.raison ?? 'raison inconnue'}`,
      ...(contour ? { contour: contour.filter((_, i) => i % pas === 0).map(([lon, lat]) => [r7(lon), r7(lat)]) } : {}),
    },
    avertissements,
  };
}

/**
 * Garde E1-brief : aucun devis sans brief pour une 3D préparée. Le front affiche la carte « Brief
 * créatif » (CarteBriefCreatif) à la place de la carte d'outil ; la question texte reste le repli.
 * `actuel` : brief connu (modification) ; `apercu` : volume réel pour l'aperçu 3D de la carte.
 */
function demandeBrief(type: TypeRendu, carte: { actuel: BriefRendu | null; apercu: ApercuVolume | null; limites: LimitesBrief }): ResultatOutil {
  const modification = carte.actuel !== null;
  return {
    status: 'partial', source: SOURCE_STUDIO,
    data: {
      brief_requis: true, type, carte: 'brief_creatif', ...(modification ? { modification: true, actuel: carte.actuel } : {}),
      champs: {
        style: { valeurs: BRIEF_STYLES, defaut: BRIEF_DEFAUT.style },
        facade: { valeurs: BRIEF_FACADES, defaut: BRIEF_DEFAUT.facade },
        ouvertures: { valeurs: BRIEF_OUVERTURES, defaut: BRIEF_DEFAUT.ouvertures },
        balcons: { valeurs: BRIEF_BALCONS, defaut: BRIEF_DEFAUT.balcons },
        attique: { valeurs: [false, true], defaut: BRIEF_DEFAUT.attique },
        rdc: { valeurs: BRIEF_RDC, defaut: BRIEF_DEFAUT.rdc },
        ambiance: { valeurs: type === 'image' ? ['jour', 'fin_de_journee'] : BRIEF_AMBIANCES, defaut: BRIEF_DEFAUT.ambiance },
        toiture: { valeurs: BRIEF_TOITURES, defaut: BRIEF_DEFAUT.toiture },
        teinte: { valeurs: BRIEF_TEINTES, defaut: BRIEF_DEFAUT.teinte, par_facade: TEINTES_PAR_FACADE },
        garde_corps: { valeurs: BRIEF_GARDE_CORPS, defaut: BRIEF_DEFAUT.garde_corps },
        menuiseries: { valeurs: BRIEF_MENUISERIES, defaut: BRIEF_DEFAUT.menuiseries },
        soubassement: { valeurs: BRIEF_SOUBASSEMENTS, defaut: BRIEF_DEFAUT.soubassement },
        precisions: `texte libre facultatif, ${BRIEF_PRECISIONS_MAX} caractères au plus (informatif)`,
      },
      question: questionBrief(type),
      limites: carte.limites,
      ...(carte.apercu ? { apercu: carte.apercu } : {}),
    },
    message:
      (modification
        ? "RIEN N'A ÉTÉ LANCÉ. Le panneau « Espace 3D » (à droite du chat) s'ouvre sur l'habillage du projet (carte « Brief créatif »), préremplie avec l'habillage actuel : "
        : "RIEN N'A ÉTÉ LANCÉ, AUCUN DEVIS ÉTABLI : il manque le brief d'habillage. Le panneau « Espace 3D » (à droite du chat) s'ouvre de lui-même sur l'habillage du projet (carte « Brief créatif ») : ") +
      "l'utilisateur y choisit façade, ouvertures, balcons ou loggias, attique, rez-de-chaussée, ambiance et, s'il le souhaite, les détails (toiture, teinte, garde-corps, menuiseries, soubassement), avec un aperçu de son volume. " +
      "Écris UN SEUL message court : invite-le à faire ses choix dans l'Espace 3D, section habillage (ou à répondre en texte, ou « à toi de choisir ») ; " +
      "ne recopie pas la liste des choix, ne pose aucune autre question. Quand il valide l'habillage, son message contient un bloc " +
      "« mimmoza-brief » : rappelle alors studio_lancer_rendu (même type), le serveur lit ce brief lui-même. S'il répond en texte, " +
      "rappelle studio_lancer_rendu avec `brief` : ses choix (les points non précisés prennent la valeur proposée) ; " +
      "« à toi de choisir » ou équivalent → brief: { a_toi_de_choisir: true }. Ne repose JAMAIS cette question.",
  };
}

function refusImage(): ResultatOutil {
  return erreur('Le rendu « image » n’est pas encore activé dans la base (migration du lot E0 non appliquée). RIEN N’A ÉTÉ LANCÉ. Film et visite 360° sont disponibles.', 'not_configured');
}

export function vueTravail(t: TravailLu): Obj {
  return {
    job_id: t.id, type: t.type, statut: t.statut, progression: t.progression, etape: t.etape,
    cree_le: t.cree_le, demarre_le: t.demarre_le, termine_le: t.termine_le, erreur: t.erreur,
  };
}

const LIBELLES_STATUT: Record<string, string> = {
  en_attente: 'en attente (pas encore pris par la machine de rendu)', en_cours: 'en cours de calcul', termine: 'terminé', echec: 'en échec', annule: 'annulé',
};

async function etatRendu(input: Obj, env: EnvStudio): Promise<ResultatOutil> {
  const uid = env.userId!;
  const t = await env.depot.travail(uid, estUuid(input.job_id) ? { id: input.job_id } : { conversationId: env.conversationId });
  if (!t) return erreur('Aucun rendu trouvé' + (input.job_id ? ' pour cet identifiant.' : ' dans cette conversation.'), 'not_found');
  const maintenant = (env.maintenant ?? Date.now)();
  const data: Obj = { ...vueTravail(t), statut_libelle: LIBELLES_STATUT[t.statut] ?? t.statut };
  if (t.statut === 'en_attente') {
    const [pos, stats] = await Promise.all([env.depot.positionFile(t.cree_le), env.depot.statsFile()]);
    data.position_file = pos;
    data.attente_depuis_min = Math.max(0, Math.round((maintenant - Date.parse(t.cree_le)) / 60_000));
    data.machine = etatMachine(stats, maintenant).phrase;
  }
  const omis = Array.isArray(t.elements_omis) ? t.elements_omis.filter(estObj).map((e) => txt(e.categorie, 80)).filter(Boolean) : [];
  if (omis.length) data.elements_omis = omis;
  if (t.statut === 'termine' && estObj(t.resultat)) {
    const r = t.resultat;
    const liens: Obj = {};
    if (t.type === 'film' && typeof r.video_path === 'string') {
      liens.video = await env.depot.urlSigneeRendu(r.video_path, 3600);
      if (typeof r.poster_path === 'string') liens.affiche = await env.depot.urlSigneeRendu(r.poster_path, 3600);
    } else if (t.type === 'image') {
      const images = Array.isArray(r.images) ? r.images.filter(estObj) : [];
      const chemins = images.length ? images.map((i) => i.jpeg_path).filter((x): x is string => typeof x === 'string') : typeof r.image_path === 'string' ? [r.image_path] : [];
      liens.images = (await Promise.all(chemins.slice(0, 3).map((c) => env.depot.urlSigneeRendu(c, 3600)))).filter(Boolean);
    } else if (t.type === 'visite360' && typeof r.visite_id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(r.visite_id)) {
      liens.visite = `${env.origine.replace(/\/+$/, '')}/visite/${encodeURIComponent(r.visite_id)}`;
    }
    data.liens = liens;
    data.liens_valables = 'URL signées valables 1 h (rappelle l’outil pour en obtenir de nouvelles) ; la visite 360° a un lien public permanent.';
    if (Array.isArray(r.avertissements)) data.avertissements = r.avertissements.filter((a) => typeof a === 'string').slice(0, 6);
  }
  return {
    status: 'ok', source: SOURCE_STUDIO, data,
    message: 'Statut lu en base (écrit par la machine de rendu) à cet instant ; n’invente ni progression ni délai.' +
      ' Le suivi puis le résultat (images, film ou lien de visite) s’affichent dans une carte du chat sous ce message : inutile de recopier les liens ou les images dans ta réponse.' +
      MESSAGE_ETAT_EN_DIRECT,
  };
}

/**
 * LOT P2 — défaut vu le 10/11 : sous l'image livrée, le texte de Mimmo disait encore « en attente » et « machine sans
 * signe de vie depuis 4 jours ». La carte du chat, elle, suit l'état réel ; le texte écrit au moment de l'outil ne
 * bouge plus. Le modèle ne fige donc dans son texte ni le statut ni l'état de la machine.
 */
export const MESSAGE_ETAT_EN_DIRECT =
  ' La carte affiche EN DIRECT le statut, la position dans la file et l’état de la machine de rendu, et se met à jour seule : ' +
  'ne recopie dans ton texte ni le statut (« en attente », « en cours »…), ni la phrase sur la machine de rendu, ni une durée d’attente ' +
  '(ils deviendraient faux dès que le rendu avance) ; renvoie simplement vers la carte.';

// =============================================================
// 7. Implémentation Supabase
// =============================================================

// deno-lint-ignore no-explicit-any
type ClientSb = any;

const COLONNES_TRAVAIL = 'id,conversation_id,type,statut,progression,etape,resultat,elements_omis,erreur,cree_le,demarre_le,termine_le';
const COLONNES_PREP = 'id,conception_id,conversation_id,idu,empreinte,entree,volume,resume,cree_le';

function lever(e: { message?: string; code?: string; details?: string } | null): void {
  if (e) throw new Error(`${e.message ?? 'erreur'}${e.code ? ` (${e.code})` : ''}${e.details ? ` ${e.details}` : ''}`);
}

/**
 * `utilisateur` : client au JWT de l'utilisateur (RLS) — lectures et écritures de SES données (chat).
 * `admin` : service_role — statistiques anonymes de la file et sonde du type « image » ; en mission
 * (pas de JWT), il sert aussi aux lectures/écritures, toujours filtrées par user_id explicite.
 */
export function depotStudioSupabase(admin: ClientSb, utilisateur: ClientSb | null): DepotStudio {
  const db = utilisateur ?? admin;
  return {
    // LOT P2 : lecture seule, API publique Panoramax (instance IGN), délai borné ; ne lève jamais.
    couverturePhotoRue: (contour) => verifierCouverture(contour, fetch),
    async conception(userId, q) {
      let r = db.from('agent_conceptions').select('id,idu,commune,parcelle,regles_plu,programme,maj_le').eq('user_id', userId).neq('statut', 'archive');
      if (q.id) r = r.eq('id', q.id);
      else if (q.idu) r = r.eq('idu', q.idu);
      const { data, error } = await r.order('maj_le', { ascending: false }).limit(1);
      lever(error);
      return (data?.[0] ?? null) as ConceptionLue | null;
    },
    async derniereVersion(userId, conceptionId) {
      const { data, error } = await db.from('agent_conception_versions').select('n,modele_ref').eq('user_id', userId).eq('conception_id', conceptionId).order('n', { ascending: false }).limit(1);
      lever(error);
      const v = data?.[0];
      return v && typeof v.modele_ref === 'string' && v.modele_ref ? { n: Number(v.n), modele_ref: v.modele_ref } : null;
    },
    async enregistrerPreparation(userId, l) {
      const { data, error } = await db.from('studio_preparations').upsert({ ...l, user_id: userId }, { onConflict: 'user_id,empreinte', ignoreDuplicates: false }).select('id').single();
      lever(error);
      return String(data.id);
    },
    async preparation(userId, q) {
      let r = db.from('studio_preparations').select(COLONNES_PREP).eq('user_id', userId);
      if (q.id) r = r.eq('id', q.id);
      else if (q.conceptionId) r = r.eq('conception_id', q.conceptionId);
      else if (q.conversationId) r = r.eq('conversation_id', q.conversationId);
      else return null;
      const { data, error } = await r.order('cree_le', { ascending: false }).limit(1);
      lever(error);
      return (data?.[0] ?? null) as PreparationLue | null;
    },
    async typeRenduAutorise(type, options) {
      try {
        const { data, error } = await admin.rpc('_studio_job_options_valides', { p_type: type, p_options: options });
        return error ? null : data === true;
      } catch { return null; }
    },
    async statsFile() {
      try {
        const [att, enc, act] = await Promise.all([
          admin.from('studio_jobs').select('cree_le', { count: 'exact' }).eq('statut', 'en_attente').order('cree_le', { ascending: true }).limit(1),
          admin.from('studio_jobs').select('id', { count: 'exact', head: true }).eq('statut', 'en_cours'),
          admin.from('studio_jobs').select('maj_le').not('worker_id', 'is', null).order('maj_le', { ascending: false }).limit(1),
        ]);
        if (att.error || enc.error || act.error) return null;
        return { attente: att.count ?? 0, plusAncienneAttente: att.data?.[0]?.cree_le ?? null, enCours: enc.count ?? 0, derniereActivite: act.data?.[0]?.maj_le ?? null };
      } catch { return null; }
    },
    async travauxActifs(userId) {
      const { count, error } = await db.from('studio_jobs').select('id', { count: 'exact', head: true }).eq('user_id', userId).in('statut', ['en_attente', 'en_cours']);
      lever(error);
      return count ?? 0;
    },
    async travailParDevis(userId, devisId) {
      const { data, error } = await db.from('studio_jobs').select(COLONNES_TRAVAIL).eq('user_id', userId).eq('fiche->>devis_id', devisId).limit(1);
      lever(error);
      return (data?.[0] ?? null) as TravailLu | null;
    },
    async jetonsDevis(userId, conversationId) {
      // Lecture serveur (service) bornée à l'utilisateur ET à la conversation ; aucun jeton
      // n'est accepté sans vérification de sa signature HMAC par lireJeton.
      const { data, error } = await admin.from('copilot_tool_calls').select('tool_output')
        .eq('user_id', userId).eq('conversation_id', conversationId).eq('tool_name', 'studio_lancer_rendu')
        .order('created_at', { ascending: false }).limit(DEVIS_RELUS_MAX);
      if (error || !Array.isArray(data)) return [];
      return data.map((l) => ((l as { tool_output?: { data?: { jeton_devis?: unknown } } }).tool_output?.data?.jeton_devis))
        .filter((j): j is string => typeof j === 'string');
    },
    async questionBriefPosee(userId, conversationId) {
      const { data, error } = await admin.from('copilot_tool_calls').select('tool_output')
        .eq('user_id', userId).eq('conversation_id', conversationId).eq('tool_name', 'studio_lancer_rendu')
        .order('created_at', { ascending: false }).limit(DEVIS_RELUS_MAX);
      if (error || !Array.isArray(data)) return false;
      return data.some((l) => (l as { tool_output?: { data?: { brief_requis?: unknown } } }).tool_output?.data?.brief_requis === true);
    },
    async briefsMessages(userId, conversationId) {
      // Lecture serveur (service) bornée à l'utilisateur ET à la conversation ; le bloc est revalidé par briefDuMessage.
      const { data, error } = await admin.from('copilot_messages').select('content,created_at')
        .eq('user_id', userId).eq('conversation_id', conversationId).eq('role', 'user')
        .order('created_at', { ascending: false }).limit(BRIEF_MESSAGES_RELUS);
      if (error || !Array.isArray(data)) return [];
      return data.flatMap((l) => {
        const ligne = l as { content?: unknown; created_at?: unknown };
        const texte = Array.isArray(ligne.content)
          ? ligne.content.map((c) => (estObj(c) && c.type === 'text' && typeof c.text === 'string' ? c.text : '')).join('\n') : '';
        return texte.includes('```' + BRIEF_BLOC_LANGUE) && typeof ligne.created_at === 'string' ? [{ texte, cree_le: ligne.created_at }] : [];
      });
    },
    async insererTravail(userId, l) {
      if (!utilisateur) throw new Error('Insertion de travail refusée sans session utilisateur.');
      const { data, error } = await utilisateur.from('studio_jobs').insert({ ...l, user_id: userId }).select(COLONNES_TRAVAIL).single();
      lever(error);
      return data as TravailLu;
    },
    async travail(userId, q) {
      let r = db.from('studio_jobs').select(COLONNES_TRAVAIL).eq('user_id', userId);
      if (q.id) r = r.eq('id', q.id);
      else if (q.conversationId) r = r.eq('conversation_id', q.conversationId);
      else return null;
      const { data, error } = await r.order('cree_le', { ascending: false }).limit(1);
      lever(error);
      return (data?.[0] ?? null) as TravailLu | null;
    },
    async positionFile(creeLe) {
      const { count, error } = await admin.from('studio_jobs').select('id', { count: 'exact', head: true }).eq('statut', 'en_attente').lt('cree_le', creeLe);
      return error ? null : (count ?? 0);
    },
    async urlSigneeRendu(chemin, secondes) {
      const { data, error } = await db.storage.from('studio-rendus').createSignedUrl(chemin, secondes);
      return error ? null : (data?.signedUrl ?? null);
    },
  };
}
