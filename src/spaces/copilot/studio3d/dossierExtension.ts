// src/spaces/copilot/studio3d/dossierExtension.ts
// =============================================================================
// LOT D9 (16/11/2026) — « PRÉPARER MON DOSSIER » sur la carte « Extension de maison » : logique PURE (node --test).
//
//   · `lireVueDossier` : aperçu des pièces établi par le SERVEUR à la fin du parcours (_shared/extension/dossier.ts) —
//     la carte l'affiche tel quel, le modèle de langage n'écrit rien ;
//   · `etatPreparerDossier` : le bouton n'apparaît qu'une fois le parcours terminé (extension placée par le moteur,
//     projet transmissible) ; régime « DP ou PC » → DEUX boutons (la personne choisit) ; régime inconnu → aucun ;
//   · `rendusLivresPourDossier` : photomontages LIVRÉS (et non « à valider ») de la conversation, proposés comme image
//     d'insertion ; aucun n'est choisi d'office (le choix se fait dans le Studio) ;
//   · `blocDossierPourStudio` : bloc `dossier` (format `mimmoza-dossier-extension` v1) joint au message « projet » du
//     Studio intégré, avec `projetExtension` (contrat X0). Surface existante : seulement si elle a été SAISIE.
// Coût : gratuit (aucun calcul serveur facturé pour le dossier), affiché sur la carte.
// =============================================================================

import type { ProjetExtension } from '../../../../supabase/functions/_shared/extension/contrat.ts';
import type { TravailStudio, ResultatImage } from '../../../lib/studio/travauxLogique.ts';

export const EVENEMENT_PREPARER_DOSSIER = 'mimmoza:preparer-dossier';
export const FORMAT_BLOC_DOSSIER = 'mimmoza-dossier-extension';

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const txt = (v: unknown, n = 400): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);

export type RegimeIndicatifCarte = 'DP' | 'PC' | 'DP ou PC' | 'inconnu';
export interface PieceCarte { code: string; intitule: string; origine: string; condition: string | null }
export interface VueDossierCarte {
  regimeIndicatif: RegimeIndicatifCarte;
  choix: ('DP' | 'PC')[];
  question: string | null;
  pieces: { DP?: PieceCarte[]; PC?: PieceCarte[] };
  cout: string;
  mention: string;
}

const ORIGINES: Record<string, string> = { studio: 'produite par le Studio', personne: 'à fournir par vous', 'studio-et-personne': 'Studio + vos précisions' };
const REGIMES: readonly RegimeIndicatifCarte[] = ['DP', 'PC', 'DP ou PC', 'inconnu'];

function lirePieces(v: unknown): PieceCarte[] {
  return (Array.isArray(v) ? v : []).flatMap((p) => {
    if (!estObj(p)) return [];
    const code = txt(p.code, 8), intitule = txt(p.intitule, 160);
    if (!code || !/^(PCMI|DP)\d{1,2}$/.test(code) || !intitule) return [];
    return [{ code, intitule, origine: ORIGINES[String(p.origine)] ?? 'à préciser', condition: txt(p.condition, 200) }];
  }).slice(0, 12);
}

/** `vue.dossier` du serveur → aperçu de la carte ; null si absent ou illisible (jamais complété ici). */
export function lireVueDossier(v: unknown): VueDossierCarte | null {
  if (!estObj(v) || v.v !== 1) return null;
  const regime = REGIMES.includes(v.regimeIndicatif as RegimeIndicatifCarte) ? v.regimeIndicatif as RegimeIndicatifCarte : null;
  if (!regime) return null;
  const choix = (Array.isArray(v.choix) ? v.choix : []).filter((c): c is 'DP' | 'PC' => c === 'DP' || c === 'PC');
  const p = estObj(v.pieces) ? v.pieces : {};
  return {
    regimeIndicatif: regime, choix: [...new Set(choix)], question: txt(v.question, 400),
    pieces: { ...(choix.includes('DP') ? { DP: lirePieces(p.DP) } : {}), ...(choix.includes('PC') ? { PC: lirePieces(p.PC) } : {}) },
    cout: txt(v.cout, 200) ?? '', mention: txt(v.mention, 600) ?? '',
  };
}

export interface EtatPreparerDossier {
  visible: boolean;
  /** Un bouton par régime proposé (deux si « DP ou PC » : la personne choisit). */
  boutons: { regime: 'DP' | 'PC'; libelle: string }[];
  question: string | null;
}

/** Bouton « Préparer mon dossier » : parcours terminé, extension placée, projet transmissible, aperçu du serveur. Pur. */
export function etatPreparerDossier(v: { etape: string; projetEnregistre: boolean; extension: { verdict: string } | null; dossier: VueDossierCarte | null }): EtatPreparerDossier {
  const d = v.dossier;
  if (v.etape !== 'termine' || !v.projetEnregistre || v.extension?.verdict !== 'ok' || !d) return { visible: false, boutons: [], question: null };
  const boutons = d.choix.map((r) => ({ regime: r, libelle: d.choix.length === 1 ? 'Préparer mon dossier' : `Préparer un dossier ${r}` }));
  return { visible: boutons.length > 0, boutons, question: d.question };
}

export interface RenduLivreSite { id: string; libelle: string; chemin: string; date: string | null; statut: string }

const dateFr = (iso: string | null): string | null => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : null);

/**
 * Photomontages LIVRÉS de la conversation (image terminée, photomontage « livré », pas « à valider » par la machine de
 * rendu X7), d'un projet d'extension. Chemins du seau privé : à signer juste avant l'envoi. Pur.
 */
export function rendusLivresPourDossier(travaux: readonly TravailStudio[]): RenduLivreSite[] {
  const out: RenduLivreSite[] = [];
  for (const t of travaux) {
    if (t.type !== 'image' || t.statut !== 'termine' || !t.resultat || t.projet_extension === undefined) continue;
    const r = t.resultat as ResultatImage;
    if (!r.photomontage || r.photomontage.statut !== 'livre') continue;
    const rx = estObj(t.resultat_extension) ? t.resultat_extension : null;
    if (rx && (rx.livrable === false || (typeof rx.statut_x7 === 'string' && rx.statut_x7 !== 'livrable'))) continue;
    const statut = r.photomontage.verdict === 'cale' ? 'photomontage livré (calé)' : r.photomontage.verdict === 'approximatif' ? 'photomontage livré (calage approximatif)' : 'photomontage livré';
    for (const i of r.images ?? []) {
      if (!i.jpeg_path) continue;
      out.push({ id: `${t.id}:${i.vue}`, libelle: `${i.libelle}`.slice(0, 120), chemin: i.jpeg_path, date: dateFr(t.termine_le), statut });
    }
  }
  return out.slice(0, 12);
}

export interface BlocDossier {
  format: typeof FORMAT_BLOC_DOSSIER;
  version: 1;
  regime: 'DP' | 'PC';
  regimeIndicatif: RegimeIndicatifCarte;
  provenance: string;
  secteurProtege: { valeur: boolean | null; source: string } | null;
  surfaceExistanteM2: number | null;
  demandeur: 'particulier' | 'personne-morale' | null;
  rendus: { id: string; libelle: string; url: string; date: string | null; statut: string }[];
}

/** Bloc `dossier` du message « projet » (Studio intégré). Rien n'est estimé ici. Pur. */
export function blocDossierPourStudio(e: {
  regime: 'DP' | 'PC';
  dossier: VueDossierCarte;
  secteur: { etat: 'oui' | 'non_trouve' | 'non_verifie'; date: string | null } | null;
  projet: ProjetExtension;
  rendus: readonly { id: string; libelle: string; url: string; date: string | null; statut: string }[];
}): BlocDossier {
  const ex = e.projet.existants.find((x) => x.id === e.projet.extension?.existantId) ?? e.projet.existants.find((x) => x.mode === 'conserver') ?? null;
  const s = ex?.surfacePlancherM2;
  return {
    format: FORMAT_BLOC_DOSSIER, version: 1, regime: e.regime, regimeIndicatif: e.dossier.regimeIndicatif,
    provenance: e.dossier.choix.length > 1
      ? `parcours d’extension de Mimmo : régime indicatif « DP ou PC », ${e.regime} choisi par la personne`
      : `parcours d’extension de Mimmo : régime indicatif ${e.regime}`,
    secteurProtege: e.secteur ? { valeur: e.secteur.etat === 'oui' ? true : e.secteur.etat === 'non_trouve' ? false : null, source: `servitudes du Géoportail de l’urbanisme et base Mérimée${e.secteur.date ? `, consultées le ${e.secteur.date}` : ''} (indicatif)` } : null,
    surfaceExistanteM2: s && s.statut === 'confirmee' && Number.isFinite(s.valeur) && s.valeur > 0 ? s.valeur : null,
    demandeur: e.projet.demandeur ?? null,
    rendus: e.rendus.filter((r) => /^https:\/\//.test(r.url)).slice(0, 12).map((r) => ({ ...r })),
  };
}

export type PreparationDossier =
  | { ok: true; projet: ProjetExtension; dossier: VueDossierCarte }
  | { ok: false; message: string };

/**
 * Contrôles avant d'ouvrir le Studio sur l'espace Dossier (messages dits à la personne, sans nom d'outil interne). Pur.
 * `ficheDisponible` : la conversation a une préparation 3D (le Studio intégré en a besoin pour la parcelle).
 */
export function verifierPreparationDossier(e: {
  conversationId: string | null;
  vue: { etape: string; projetEnregistre: boolean; extension: { verdict: string } | null; dossier: VueDossierCarte | null; projetExtension: ProjetExtension | null } | null;
  ficheDisponible: boolean;
  regime: 'DP' | 'PC';
}): PreparationDossier {
  if (!e.conversationId) return { ok: false, message: 'Ouvrez d’abord la conversation du projet d’extension.' };
  const v = e.vue;
  if (!v || !etatPreparerDossier(v).visible || !v.dossier) return { ok: false, message: 'Le parcours d’extension n’est pas terminé : terminez-le avec Mimmo avant de préparer le dossier.' };
  if (!v.dossier.choix.includes(e.regime)) return { ok: false, message: `Le régime ${e.regime} ne correspond pas au parcours (indicatif : ${v.dossier.regimeIndicatif}).` };
  if (!v.projetExtension) return { ok: false, message: 'Le projet d’extension n’est plus lisible dans la conversation : reprenez le parcours (« agrandir ma maison »).' };
  if (!e.ficheDisponible) return { ok: false, message: 'Le Studio a besoin de la préparation 3D de la parcelle : demandez d’abord « voir en 3D » à Mimmo, puis cliquez de nouveau « Préparer mon dossier ».' };
  return { ok: true, projet: v.projetExtension, dossier: v.dossier };
}
