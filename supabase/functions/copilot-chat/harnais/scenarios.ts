// supabase/functions/copilot-chat/harnais/scenarios.ts
// HARNAIS DE BOUT EN BOUT DES PARCOURS DU CHAT (18/11/2026) — les conversations rejouées.
// Chaque scénario écrit ses étapes dans un Journal (OK / ÉCHEC + détail) ; une exception arrête le scénario et devient
// une étape en échec. Données réelles figées : parcelle 930470000P0646 (Montfermeil, fixture X3), photo du trottoir
// construite avec un EXIF GPS + direction, résumé de plan RÉEL produit par le Studio (fixture G6).
import {
  C, controlerImage, controlerStatuts, controlerTour, Conversation, Journal, P0646, PLAN_LU_STUDIO, photoDepuisLaRue, SITE, USER, type Tour,
} from './banc.ts';
import { Q } from '../../_shared/extension/parcours.ts';
import { QR } from '../../_shared/extension/retouchesExtension.ts';
import { candidatsCoteRue } from '../../_shared/extension/coteRue.ts';
import { facadesVoieDeLaParcelle } from '../agent/voisines-parcelle.ts';
import { lirePhotoProjet, photoDuTourGardee, ACCORD_PHOTO_JOINTE } from '../agent/photo-projet.ts';
import { lirePlanLu, MARQUEUR_PLAN_JOINT } from '../../_shared/extension/planLu.ts';
import { lireProjetMaison } from '../../_shared/maisonNeuve/contratMaison.ts';
import { OUTIL_EXTENSION_MAISON } from '../agent/extension.ts';
import { facadesVoiePreparation } from '../agent/studio.ts';
import { OUTIL_MAISON_NEUVE } from '../agent/maison-neuve.ts';
import { confirmerValeur, contextePlanLu, lirePlanLuStudio } from '../../../../src/spaces/copilot/studio3d/planLuChat.ts';
import { decisionPhoto, notePhotoPreparee, OCTETS_MAX_CHAT } from '../../../../src/lib/studio/photoTelephone.ts';
import { acceptPourAppareil } from '../../../../src/spaces/copilot/pieces-jointes/piecesJointesLogique.ts';
import { photoRequiseDuResultat } from '../../../../src/lib/studio/photoReelle.ts';
import { lignesRetoucheRealisme } from '../../../../src/lib/studio/retoucheRealisme.ts';

type Obj = Record<string, unknown>;
export interface Scenario { id: string; titre: string; jouer: (j: Journal) => Promise<void> }

const vue = (t: Tour) => (t.parcours?.vue ?? {}) as { maison?: { lignes?: unknown[] } | null; extension?: { verdict?: string; refus?: string[]; dimensions?: string } | null; avertissements?: string[]; sources?: string[] };
const etat = (t: Tour) => (t.parcours?.etat ?? {}) as Obj;
const DEBUT_P0646 = 'Je voudrais agrandir ma maison, parcelle 930470000P0646';
const CONSERVER = 'Maison existante : Conserver la maison';
const PHOTO_ET_INSTRUCTIONS = 'Voici ma maison : ajoute une extension de 4 × 5 m à l’arrière, même hauteur, menuiseries anthracite avec baie vitrée. Je garde la maison.';

/** Côté proposé en puce qui porte la vraie limite sur rue de P0646 (milieu de segment à moins de 1 m). */
function coteReelP0646(): string {
  const reelles = facadesVoieDeLaParcelle(C.parcelle).facades;
  const milieu = (a: readonly number[], b: readonly number[]) => [(a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2];
  const pres = (p: number[], q: number[]) => Math.hypot((p[0]! - q[0]!) * 111_320 * Math.cos(q[1]! * Math.PI / 180), (p[1]! - q[1]!) * 110_540) < 1;
  const c = candidatsCoteRue(SITE.contourWgs84).find((x) => x.segments.some((s) => reelles.some((r) => pres(milieu(s.debut, s.fin), milieu(r.debut, r.fin)))));
  if (!c) throw new Error('la vraie limite sur rue ne fait pas partie des côtés proposés');
  return c.libelle;
}

/** Parcours photo + instructions jusqu'au gabarit (G3), sur une conversation donnée. */
async function parcoursPhoto(c: Conversation, j: Journal, nom: string): Promise<Tour[]> {
  const t: Tour[] = [];
  t.push(await c.tour(PHOTO_ET_INSTRUCTIONS, { photo: { octets: photoDepuisLaRue() } }));
  t.push(await c.tour('Toit de la maison : 2 pans · Niveaux de la maison : R+1'));
  t.push(await c.tour('Pente du toit de la maison : Je ne sais pas · Sens du faîtage : Je ne sais pas · Hauteur à l’égout de la maison : Je ne sais pas (estimation)'));
  t.push(await c.tour('Surface de plancher existante : Je ne sais pas · Demandeur : Particulier · Clôture sur rue : ≈ 1,5 m'));
  for (const x of t) controlerTour(j, x, nom);
  return t;
}

/** Image demandée puis acceptée (devis → accord), comme le ferait le modèle quand l'utilisateur dit « oui ». */
async function demanderImage(c: Conversation, j: Journal, nom: string): Promise<{ devis: Tour; accord: Tour }> {
  const devis = await c.tour('Oui, préparez l’image de l’extension sur ma photo', { studio: [{ outil: 'studio_preparer_3d' }, { outil: 'studio_lancer_rendu', input: { type: 'image' } }] });
  j.verifier(`${nom} : outils Studio proposés quand l’utilisateur demande l’image`, devis.studioRefuse.length === 0, `refusés : ${devis.studioRefuse.join(', ')}`);
  const r1 = c.dernier('studio_lancer_rendu')?.resultat;
  j.egal(`${nom} : devis présenté (rien n’est lancé sans accord)`, r1?.status, 'confirmation_requise');
  j.egal(`${nom} : aucun travail créé au devis`, devis.travauxCrees, 0);
  controlerTour(j, devis, nom);
  const accord = await c.tour('Oui, je confirme, lancez le rendu de l’image', { studio: [{ outil: 'studio_lancer_rendu', input: { confirmer: true } }] });
  j.egal(`${nom} : rendu lancé après l’accord`, c.dernier('studio_lancer_rendu')?.resultat.status, 'ok');
  j.egal(`${nom} : un seul travail créé`, accord.travauxCrees, 1);
  return { devis, accord };
}

export const SCENARIOS: Scenario[] = [
  // ── 1 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'S1', titre: 'Extension sur P0646, panne de la BD TOPO au 5e tour (X8)',
    jouer: async (j) => {
      const pannes = { actif: false };
      const c = new Conversation('00000000-0000-4000-8000-000000000001', { panneBdTopo: () => pannes.actif });
      c.base.ficheP0646();
      const t1 = await c.tour(DEBUT_P0646, { idu: P0646 });
      j.verifier('tour 1 : l’outil du parcours est imposé sur « agrandir ma maison »', t1.aiguillage.extensionImposee);
      j.egal('tour 1 : maison existante lue (BD TOPO)', (vue(t1).maison as Obj | null)?.id, 'BATIMENT0000000312986202');
      controlerStatuts(j, 'tour 1 : chaque valeur de la maison a un statut et une source', vue(t1).maison?.lignes);
      const t2 = await c.tour(CONSERVER);
      const t3 = await c.tour('Toit de la maison : 2 pans · Niveaux de la maison : R+1 · Type d’extension : Latérale · Façade (vue de la rue) : À gauche');
      const t4 = await c.tour('égout 5,2 m');
      j.verifier('tour 4 : « égout 5,2 m » relance bien le parcours', t4.appels.some((a) => a.outil === OUTIL_EXTENSION_MAISON),
        `aucun appel du parcours (imposé : ${t4.aiguillage.extensionImposee}, parcours en cours : ${t4.aiguillage.parcoursEnCours})`);
      for (const t of [t2, t3, t4]) if (t.aiguillage.parcoursSeulementPropose) j.remarque(`S1 tour ${t.n} « ${t.texteUtilisateur} » : outil du parcours PROPOSÉ mais pas imposé — en production, c'est le modèle qui décide de l'appeler.`);
      j.correspond('tour 3 : libellé de l’égout sans contradiction', t3.affiche, /sinon on garde 5 m \(valeur de la BD TOPO\)/);
      j.absent('tour 3 : jamais « estimée (5 m, mesurée) »', t3.affiche, /estimée \(5 m, mesurée\)/);
      pannes.actif = true;
      const wfsAvant = c.compteurs.wfs;
      const t5 = await c.tour('Dimensions (largeur × profondeur) : 4 × 5 m · Hauteur de l’extension : Sur 2 niveaux');
      j.egal('tour 5 (panne) : deux tentatives auprès de l’IGN', c.compteurs.wfs - wfsAvant, 2);
      j.verifier('tour 5 (panne) : le parcours ne retombe pas sur « sans BD TOPO »', t5.parcours?.etape !== 'sans_bdtopo', `étape ${t5.parcours?.etape}`);
      const e5 = etat(t5);
      j.egal('tour 5 (panne) : réponses gardées (égout, toit, dimensions, niveaux)', [e5.hauteurEgoutM, e5.toit, e5.largeurM, e5.profondeurM, e5.niveauxExtension], [5.2, 'deux-pans', 4, 5, 2]);
      j.verifier('tour 5 (panne) : la réutilisation de la lecture précédente est dite',
        (vue(t5).avertissements ?? []).some((a) => /n’a pas répondu à ce tour .* la lecture du 2026-11-18 est réutilisée/.test(a)), (vue(t5).avertissements ?? []).join(' | '));
      j.absent('tour 5 (panne) : aucune annonce d’un gabarit ou d’un régime non calculé', t5.affiche, /(?:a affiché|voici) le gabarit|régime indicatif de votre extension/i);
      pannes.actif = false;
      const t6 = await c.tour('Surface de plancher existante : Je ne sais pas · Demandeur : Particulier');
      j.verifier('tour 6 : le parcours reprend normalement après la panne', ['termine', 'type', 'dimensions'].includes(String(t6.parcours?.etape)), `étape ${t6.parcours?.etape}`);
      for (const t of [t1, t2, t3, t4, t5, t6]) controlerTour(j, t, 'S1');
    },
  },
  // ── 2 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'S2', titre: 'Photo + instructions dans le chat, jusqu’à l’image sur la photo (G3, X9)',
    jouer: async (j) => {
      const c = new Conversation('00000000-0000-4000-8000-000000000002');
      const t = await parcoursPhoto(c, j, 'S2');
      j.verifier('tour 1 : photo + « ajoute une extension » impose le parcours', t[0]!.aiguillage.extensionImposee);
      j.egal('tour 1 : parcelle retrouvée par la position de la photo', (t[0]!.parcours?.vue as Obj | undefined)?.idu, P0646);
      j.verifier('tour 1 : ce qui est repris du message est dit',
        (vue(t[0]!).avertissements ?? []).some((l) => /^Repris de votre message : 4 × 5 m, maison conservée, extension arrière/.test(l)), (vue(t[0]!).avertissements ?? []).join(' | '));
      j.egal('photo déposée une seule fois', c.base.photosDeposees.length, 1);
      const fin = t.at(-1)!;
      j.egal('dernier tour : gabarit placé', [fin.parcours?.etape, vue(fin).extension?.verdict], ['termine', 'ok']);
      j.correspond('dernier tour : l’image est proposée sur LA photo envoyée', fin.affiche, /préparer l’image de l’extension sur votre photo|même photo/);
      j.egal('dossier de parcelle créé une fois', c.base.conceptions.length, 1);
      const photo = lirePhotoProjet(fin.parcours?.photo_projet);
      j.verifier('la photo du projet est gardée d’un tour à l’autre', Boolean(photo && photo.idu === P0646));
      await demanderImage(c, j, 'S2');
      const travail = c.base.travaux.at(-1);
      j.egal('le rendu a pour fond la photo du client (jamais une image d’étude)', travail?.options.fond, 'photo_client');
      j.egal('le rendu porte l’extension (pas un immeuble)', (travail?.fiche.projet_extension as Obj | undefined)?.nature, 'extension');
      j.absent('aucun brief « logements » dans la fiche', JSON.stringify(travail?.fiche ?? {}), /"rdc"\s*:\s*"logements"/);
      // Machine de rendu : (a) placement trop imprécis → aucune image, photo demandée ; (b) photo calée, livrée → image.
      const sansCalage = { image_path: 'u/j/etude.jpg', images: [{ vue: 'face', jpeg_path: 'u/j/etude.jpg' }], extension: { ok: true, livrable: false },
        photomontage: { tente: true, statut: 'a_valider', source_photo: { type: 'client' }, atelier: { photo_path: 'u/j/atelier/photo.jpg', plan_path: 'u/j/atelier/plan.json' } },
        photo_requise: { code: 'calage_insuffisant', texte: 'Le placement de la maison sur votre photo est trop imprécis.', atelier: true } };
      c.base.terminerDernierTravail(sansCalage);
      const suivi1 = await c.tour('Où en est l’image ?', { studio: [{ outil: 'studio_etat_rendu' }] });
      controlerImage(j, '(a) calage insuffisant : aucune image donnée', c.dernier('studio_etat_rendu')?.resultat, sansCalage);
      j.egal('(a) calage insuffisant : photo demandée avec la bonne raison', ((c.dernier('studio_etat_rendu')?.resultat.data as Obj | undefined)?.photo_requise as Obj | undefined)?.code, 'calage_insuffisant');
      j.verifier('(a) la carte du chat propose d’ajuster le placement', photoRequiseDuResultat(sansCalage)?.atelier === true);
      controlerTour(j, suivi1, 'S2');
      const livre = { image_path: 'u/j/photo-client.jpg', images: [{ vue: 'photo_client', libelle: 'Votre photo', jpeg_path: 'u/j/photo-client.jpg' }],
        photomontage: { tente: true, statut: 'livre', source_photo: { type: 'client' } }, extension: { ok: true, livrable: true },
        harmonisation: { statut: 'non_harmonise', raisons: ['La retouche de réalisme n’est pas installée sur la machine de rendu.'] } };
      c.base.terminerDernierTravail(livre);
      await c.tour('Et maintenant, l’image est prête ?', { studio: [{ outil: 'studio_etat_rendu' }] });
      controlerImage(j, '(b) photo calée et livrée : l’image est donnée', c.dernier('studio_etat_rendu')?.resultat, livre);
      for (const l of lignesRetoucheRealisme(livre)) j.absent('(b) ligne « retouche de réalisme » sans nom interne', l, /\b(?:SDXL|ControlNet|IoU|worker|harmonisation)\b/i);
    },
  },
  // ── 3 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'S3', titre: 'Latérale gauche refusée (hors parcelle), l’arrière est proposé (X8b)',
    jouer: async (j) => {
      const c = new Conversation('00000000-0000-4000-8000-000000000003');
      c.base.ficheP0646();
      const ts: Tour[] = [];
      for (const m of [DEBUT_P0646, CONSERVER,
        'Toit de la maison : 2 pans · Niveaux de la maison : R+1 · Type d’extension : Latérale · Façade (vue de la rue) : À gauche', 'égout 5,2 m',
        'Dimensions (largeur × profondeur) : 4 × 5 m · Hauteur de l’extension : Sur 2 niveaux', 'Surface de plancher existante : Je ne sais pas · Demandeur : Particulier']) {
        ts.push(await c.tour(m, m === DEBUT_P0646 ? { idu: P0646 } : {}));
      }
      const g = ts.at(-1)!;
      j.absent('2 niveaux sur une maison R+1 : plus de refus de hauteur', g.affiche, /Réduisez la hauteur|cochez/i);
      j.correspond('le refus dit la vraie cause (hors parcelle)', g.affiche, /Hors parcelle/);
      j.correspond('les côtés qui passent sont proposés', g.affiche, /à l’arrière, côté rue\. Choisissez-en un ci-dessous/);
      j.correspond('puce « À l’arrière » proposée', g.affiche, /À l’arrière/);
      const fin = await c.tour('Façade (vue de la rue) : À l’arrière');
      j.egal('clic « À l’arrière » : extension placée', [fin.parcours?.etape, vue(fin).extension?.verdict], ['termine', 'ok']);
      j.correspond('égout aligné sur la maison (5,2 m) et dit', fin.affiche, /même hauteur que la maison|5,2 m/);
      j.correspond('l’image est proposée ensuite', fin.affiche, /préparer une image de l’extension/);
      for (const t of [...ts, fin]) controlerTour(j, t, 'S3');
    },
  },
  // ── 4 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'S4', titre: 'Plan de la maison joint et lu (G6)',
    jouer: async (j) => {
      const c = new Conversation('00000000-0000-4000-8000-000000000004');
      c.base.ficheP0646();
      const site = confirmerValeur(lirePlanLuStudio(PLAN_LU_STUDIO, 'plan.pdf', Date.UTC(2026, 10, 18))!, 'niveaux');
      const plan = lirePlanLu(contextePlanLu(site))!;
      j.verifier('le résumé réel du Studio est relu par le site', Boolean(plan));
      const t1 = await c.tour(DEBUT_P0646, { idu: P0646 });
      const t2 = await c.tour(`Voici le plan de ma maison\n\n${MARQUEUR_PLAN_JOINT} : « plan.pdf » — lu par Mimmoza dans le Studio, sans le modèle de langage]`, { planLu: plan });
      j.verifier('plan joint : le parcours reprend (tour imposé)', t2.aiguillage.extensionImposee);
      const t3 = await c.tour(CONSERVER, { planLu: plan });
      const av = vue(t3).avertissements ?? [];
      j.verifier('écart de plus de 10 % avec la BD TOPO signalé', av.some((x) => /écart -11 %, plus de 10 %/.test(x)), av.join(' | '));
      j.egal('niveaux confirmés sur le plan : repris (2)', etat(t3).niveaux, 2);
      j.verifier('les niveaux ne sont plus redemandés', !((t3.parcours?.attendues as string[] | undefined) ?? []).includes(Q.niveaux.id), String(t3.parcours?.attendues));
      j.egal('le plan n’est pas lu comme les dimensions de l’extension', [etat(t2).largeurM, etat(t2).profondeurM], [null, null]);
      for (const t of [t1, t2, t3]) controlerTour(j, t, 'S4');
    },
  },
  // ── 5 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'S5', titre: 'Trois retouches en parlant, dont une refusée (G7)',
    jouer: async (j) => {
      const c = new Conversation('00000000-0000-4000-8000-000000000005');
      const t = await parcoursPhoto(c, j, 'S5');
      j.egal('V1 placée', (t.at(-1)!.parcours?.variantes as { n: number; verdict: string }[] | undefined)?.map((v) => [v.n, v.verdict]), [[1, 'placee']]);
      const q = await c.tour('fais-la en bardage bois');
      j.verifier('« bardage bois » : retouche reconnue, tour imposé', q.aiguillage.retouche && q.aiguillage.extensionImposee);
      j.egal('ambigu (teinte) : question à puces, aucune variante créée', [etat(q).variante, q.parcours?.attendues], [1, [QR.facade.id]]);
      const v2 = await c.tour('Revêtement de l’extension : Bardage bois clair');
      j.egal('V2 créée', etat(v2).variante, 2);
      const v3 = await c.tour('plus large d’1 m');
      j.egal('V3 : 5 × 5 m, recalculée et placée', [etat(v3).largeurM, etat(v3).profondeurM, vue(v3).extension?.verdict], [5, 5, 'ok']);
      const v4 = await c.tour('15 m plus profonde');
      j.egal('V4 : 20 m de profondeur refusée par le calcul', [etat(v4).profondeurM, vue(v4).extension?.verdict], [20, 'refus']);
      j.verifier('V4 : le refus est expliqué', (vue(v4).extension?.refus ?? []).length > 0);
      j.absent('V4 refusée : aucune image proposée', v4.affiche, /préparer (?:une|l’)image/);
      const vs = (v4.parcours?.variantes as { n: number; verdict: string; empreinte_projet: string }[] | undefined) ?? [];
      j.egal('historique des variantes', vs.map((v) => [v.n, v.verdict]), [[1, 'placee'], [2, 'placee'], [3, 'placee'], [4, 'refusee']]);
      j.egal('empreintes toutes différentes', new Set(vs.map((v) => v.empreinte_projet)).size, 4);
      j.egal('même photo pour toutes les variantes', lirePhotoProjet(v4.parcours?.photo_projet)?.chemin, lirePhotoProjet(t[0]!.parcours?.photo_projet)?.chemin);
      for (const x of [q, v2, v3, v4]) controlerTour(j, x, 'S5');
    },
  },
  // ── 6 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'S6', titre: 'Maison neuve de 120 m² R+1 (G10b)',
    jouer: async (j) => {
      const c = new Conversation('00000000-0000-4000-8000-000000000006');
      c.base.ficheP0646();
      const t1 = await c.tour('Je veux construire une maison de 120 m² habitables, R+1, toit 2 pans en ardoise, menuiseries blanches, parcelle 930470000P0646', { idu: P0646 });
      j.verifier('« construire une maison » impose le parcours maison neuve (pas l’extension)', t1.aiguillage.maisonImposee && !t1.aiguillage.extensionImposee);
      j.egal('maison placée dès le premier message', t1.parcours?.etape, 'termine');
      const p = t1.parcours?.projet_maison;
      j.verifier('projet de maison transmissible', lireProjetMaison(p).ok, JSON.stringify(lireProjetMaison(p)).slice(0, 300));
      const pm = p as { maison: { niveaux: { valeur: number }; surfaceHabitableM2: { valeur: number } }; autorisation: { regime: string } };
      j.egal('demande reprise telle quelle', [pm?.maison?.niveaux?.valeur, pm?.maison?.surfaceHabitableM2?.valeur], [2, 120]);
      j.egal('autorisation indicative : permis de construire', pm?.autorisation?.regime, 'PC');
      j.correspond('architecte évoqué', t1.affiche, /architecte/i);
      const d = await c.tour('Oui, faites-moi l’image de la maison sur la photo de la rue', { studio: [{ outil: 'studio_preparer_3d' }, { outil: 'studio_lancer_rendu', input: { type: 'image', options: { fond: 'etude' } } }] });
      j.egal('aucune 3D d’immeuble préparée pour une maison neuve', c.dernier('studio_preparer_3d')?.resultat.status, 'partial');
      const devis = c.dernier('studio_lancer_rendu')?.resultat;
      j.egal('devis présenté', devis?.status, 'confirmation_requise');
      j.verifier('image d’étude demandée par le modèle : remplacée par une vraie photo', ((devis?.data as Obj | undefined)?.options as Obj | undefined)?.fond !== 'etude');
      j.absent('le devis ne parle ni de logements ni d’immeuble', JSON.stringify(devis?.data ?? {}), /logement|immeuble/i);
      controlerTour(j, t1, 'S6'); controlerTour(j, d, 'S6');
    },
  },
  // ── 7 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'S7', titre: 'Parcelle sans fiche, côté de la rue choisi par puce, transmis au rendu (X10, intégration)',
    jouer: async (j) => {
      const c = new Conversation('00000000-0000-4000-8000-000000000007', { voisinesEnPanne: true } as never);
      const ts: Tour[] = [];
      for (const m of [DEBUT_P0646, CONSERVER, 'Toit de la maison : 2 pans · Niveaux de la maison : R+1 · Type d’extension : Arrière · Façade (vue de la rue) : À l’arrière']) {
        ts.push(await c.tour(m, m === DEBUT_P0646 ? { idu: P0646 } : {}));
      }
      const q = ts.at(-1)!;
      j.verifier('sans fiche ni voisines : le côté de la rue est demandé en puces', ((q.parcours?.attendues as string[] | undefined) ?? []).includes(Q.coteRue.id), String(q.parcours?.attendues));
      j.absent('jamais « classez la limite sur rue »', q.affiche, /Classez la limite|désignez l’arête/);
      const cote = coteReelP0646();
      ts.push(await c.tour(`Côté de la rue : ${cote}`));
      ts.push(await c.tour('Dimensions (largeur × profondeur) : 5 × 4 m · Hauteur de l’extension : Plain-pied'));
      const fin = await c.tour('Surface de plancher existante : 118 m² · Demandeur : Particulier');
      ts.push(fin);
      j.egal('côté choisi : extension placée', [fin.parcours?.etape, vue(fin).extension?.verdict], ['termine', 'ok']);
      j.verifier('la source dit que le côté a été désigné par vous', (vue(fin).sources ?? []).some((s) => /désigné par vous/.test(s)), (vue(fin).sources ?? []).join(' | '));
      j.verifier('le côté choisi est gardé pour la suite (facades_voie_choisies)', Boolean(fin.parcours?.facades_voie_choisies));
      await c.tour('Oui, préparez l’image de l’extension', { studio: [{ outil: 'studio_preparer_3d' }, { outil: 'studio_lancer_rendu', input: { type: 'image' } }] });
      const devis = c.dernier('studio_lancer_rendu')?.resultat;
      const prep = c.dernier('studio_preparer_3d')?.resultat;
      j.egal('support de parcelle préparé pour l’image', prep?.status, 'ok');
      // Aucune photo du client et aucune photo de rue près de P0646 dans les données figées : l'image est refusée
      // honnêtement (photo demandée), jamais pour « façade sur voie inconnue ».
      j.egal('sans photo exploitable : rien n’est lancé', [devis?.status, c.base.travaux.length], ['partial', 0]);
      j.correspond('sans photo exploitable : une photo de la maison est demandée', devis?.message, /vraie photo de la maison/);
      j.absent('le refus n’invoque pas une façade sur voie inconnue', JSON.stringify(devis ?? {}), /façade sur voie non identifiée|limite sur rue inconnue/i);
      // Le côté choisi est bien la limite sur rue transmise à la machine de rendu (même lecture que le devis).
      const p = c.base.preparations.at(-1);
      const voie = p ? await facadesVoiePreparation({ userId: USER, depot: c.base.depotStudio(), secret: 's', requete: 'S7', conversationId: c.id, origine: 'https://mimmoza.vercel.app' } as never, USER, p as never) : null;
      j.verifier('limite sur rue transmise au rendu = côté désigné par vous', Boolean(voie && voie.facades.length > 0 && voie.facades.every((f: { source?: string }) => f.source === 'utilisateur')),
        JSON.stringify(voie).slice(0, 300));
      for (const t of ts) controlerTour(j, t, 'S7');
    },
  },
  // ── 8 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'S8', titre: 'Photo de téléphone de plus de 5 Mo et HEIC (G9)',
    jouer: async (j) => {
      const grande = decisionPhoto({ type: 'image/jpeg', octets: 12 * 1024 * 1024, orientation: 6 });
      j.egal('photo de 12 Mo tournée : réduite et redressée pour le chat, redressée pour le placement', [grande.chat, grande.calage], ['reencoder', 'reencoder']);
      j.verifier('raisons dites sans jargon', grande.raisons.length === 2 && grande.raisons.every((r) => !/exif|orientation|reencod/i.test(r)), grande.raisons.join(' | '));
      const droite = decisionPhoto({ type: 'image/jpeg', octets: OCTETS_MAX_CHAT - 1, orientation: 1 });
      j.egal('photo droite de moins de 5 Mo : envoyée telle quelle', [droite.chat, droite.calage], ['tel_quel', 'tel_quel']);
      j.verifier('HEIC accepté par le sélecteur hors iPhone', /image\/heic/.test(acceptPourAppareil(false)));
      j.verifier('sur iPhone, le système convertit lui-même (sélecteur JPEG/PNG)', !/heic/.test(acceptPourAppareil(true)));
      const note = notePhotoPreparee({ nom: 'IMG_1234.HEIC', octetsAvant: 12 * 1024 * 1024, octetsApres: 4 * 1024 * 1024, largeur: 4032, hauteur: 3024, raisons: grande.raisons } as never);
      j.absent('pastille de la pièce jointe sans jargon', note, /exif|orientation|reencod|jpeg/i);
      const g = photoDuTourGardee({ name: 'IMG_1234.jpg', mediaType: 'image/jpeg', data: 'AAAA', originalPath: `${USER}/original-IMG_1234.jpg`, originalMediaType: 'image/jpeg' }, USER);
      j.egal('l’original (pleine résolution) devient la photo du projet', g.storagePath, `${USER}/original-IMG_1234.jpg`);
      const autre = photoDuTourGardee({ name: 'x.jpg', mediaType: 'image/jpeg', data: 'AAAA', originalPath: '22222222-2222-4222-8222-222222222222/original-x.jpg', originalMediaType: 'image/jpeg' }, USER);
      j.verifier('l’original d’un autre compte n’est jamais pris', autre.storagePath === undefined && autre.data === 'AAAA');
      j.egal('accord sur la photo jointe : comportement actuel (décision en attente)', ACCORD_PHOTO_JOINTE, 'implicite');
      // De bout en bout : la photo préparée (JPEG droit, EXIF GPS gardé) suffit à retrouver la parcelle et lancer le parcours.
      const c = new Conversation('00000000-0000-4000-8000-000000000008');
      const t1 = await c.tour(PHOTO_ET_INSTRUCTIONS, { photo: { octets: photoDepuisLaRue(), nom: 'IMG_1234.jpg' } });
      j.egal('photo préparée : parcelle retrouvée', (t1.parcours?.vue as Obj | undefined)?.idu, P0646);
      controlerTour(j, t1, 'S8');
    },
  },
  // ── 9 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'S9', titre: 'Plans de l’extension sans image (photo demandée, plans prêts) (G4)',
    jouer: async (j) => {
      const c = new Conversation('00000000-0000-4000-8000-000000000009');
      await parcoursPhoto(c, j, 'S9');
      await demanderImage(c, j, 'S9');
      const EMP = '108bd93607064b3a29192a3c99c9f930d7e4dd1147ce8c0ea854c3cf1b8a6816';
      const base = `${USER}/${c.base.travaux.at(-1)!.id}`;
      const plans = { statut: 'envoye', empreinte_scene: EMP, pdf_path: `${base}/plans-extension.pdf`, dxf_path: `${base}/plans-extension-dxf.zip`, apercu_path: `${base}/plans-extension-apercu.png`,
        planches: [{ numero: 'PL-01', titre: 'Plan de masse', echelle: '1/200', format: 'A3 paysage' }], statuts: [], jetons: 0 };
      const resultat = { image_path: null, images: [], photo_requise: { code: 'aucune_photo', texte: 'Il faut une photo de votre maison.', atelier: false },
        extension: { ok: true, livrable: false, empreinte_scene: EMP, plans } };
      c.base.terminerDernierTravail(resultat);
      // Demande formulée sans « image » ni « rendu » : les outils Studio doivent quand même être proposés au modèle.
      const sansMot = await c.tour('Je voudrais les plans de l’extension', { studio: [{ outil: 'studio_etat_rendu' }] });
      j.verifier('« Je voudrais les plans de l’extension » : le suivi du rendu est proposé au modèle', sansMot.studioRefuse.length === 0,
        'outils Studio NON proposés : studioPertinent() ne reconnaît pas « plan(s) » (agent/studio.ts) — le modèle ne peut pas relire l’état des plans');
      controlerTour(j, sansMot, 'S9');
      const t = await c.tour('Je voudrais les plans de l’extension, même sans l’image', { studio: [{ outil: 'studio_etat_rendu' }] });
      const r = c.dernier('studio_etat_rendu')?.resultat;
      j.verifier('suivi du rendu appelé (outils Studio proposés sur « plans »)', t.studioRefuse.length === 0, `refusés : ${t.studioRefuse.join(', ')} — la demande « plans » ne propose pas les outils Studio`);
      if (r) {
        j.egal('plans prêts annoncés au modèle', ((r.data as Obj).plans as Obj | undefined)?.disponibles, true);
        controlerImage(j, 'aucune image sans photo calée', r, resultat);
        j.absent('aucun lien ni chemin de fichier donné au modèle', r.message, /https?:\/\/|plans-extension\.pdf/);
        // Plans d'un autre modèle que l'image : jamais promis.
        c.base.terminerDernierTravail({ ...resultat, extension: { ...resultat.extension, empreinte_scene: 'f'.repeat(64) } });
        await c.tour('Et les plans du rendu ?', { studio: [{ outil: 'studio_etat_rendu' }] });
        const r2 = c.dernier('studio_etat_rendu')?.resultat;
        j.egal('plans d’un autre modèle : indisponibles', ((r2?.data as Obj | undefined)?.plans as Obj | undefined)?.disponibles, false);
      }
      controlerTour(j, t, 'S9');
    },
  },
];

/** Joue un scénario ; une exception devient une étape en échec (le rapport continue). */
export async function jouerScenario(s: Scenario): Promise<Journal> {
  const j = new Journal();
  try { await s.jouer(j); } catch (e) { j.verifier('exécution sans exception', false, e instanceof Error ? `${e.message}\n${e.stack?.split('\n').slice(1, 4).join('\n')}` : String(e)); }
  return j;
}
export { OUTIL_MAISON_NEUVE };
