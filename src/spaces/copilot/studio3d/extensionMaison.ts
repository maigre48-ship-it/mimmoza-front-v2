// src/spaces/copilot/studio3d/extensionMaison.ts
// =============================================================================
// LOT X3 (14/11/2026) — Extensions de maison : logique PURE d'affichage (testée par extensionMaison.test.ts, node --test).
//
//   · `lireVueExtension` : sortie du parcours « extension de maison » de Mimmo (serveur, déterministe) → vue de la carte
//     du chat et de la section du Dossier 3D : maison existante ESTIMÉE avec le statut de chaque valeur (mesurée,
//     estimée, SUPPOSÉE, confirmée), extension (type, façade vue de la rue, dimensions, surface créée ESTIMÉE, refus du
//     moteur expliqués), régime INDICATIF (déclaration préalable / permis, architecte) avec ses sources ;
//   · `existantDuTravail` : rendu (`studio_jobs`) d'un projet d'extension → « maison existante conservée », extension
//     demandée (fiche.projet_extension, contrat X0) et, quand la machine de rendu le fournira (lot X4), ses refus.
// Lecture défensive : une valeur absente ou illisible n'est jamais remplacée par une valeur inventée.
// =============================================================================

import { libelleStatut, lireProjetExtension, type ProjetExtension, type StatutDonnee } from '../../../../supabase/functions/_shared/extension/contrat.ts';

export const OUTIL_EXTENSION_MAISON = 'extension_maison';
/** Début de la mention écrite par la machine de rendu quand l'existant est conservé (worker, lot X2). */
export const PREFIXE_MENTION_CONSERVE = 'Bâtiment existant CONSERVÉ';

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const txt = (v: unknown, max = 600): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const STATUTS: readonly StatutDonnee[] = ['mesuree', 'estimee', 'supposee', 'confirmee'];
const statutDe = (v: unknown): StatutDonnee | null => (STATUTS.includes(v as StatutDonnee) ? v as StatutDonnee : null);
const textes = (v: unknown, n = 20): string[] => (Array.isArray(v) ? v.map((x) => txt(x, 600)).filter((x): x is string => !!x).slice(0, n) : []);
const fr = (v: number, d = 1): string => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('fr-FR', { maximumFractionDigits: d }).replace(/ | /g, ' ');

export interface LigneStatut { libelle: string; valeur: string; statut: StatutDonnee | null; statutLibelle: string | null; source: string }

export interface VueCarteExtension {
  etape: string;
  idu: string;
  commune: string | null;
  maison: { id: string; conservee: boolean | null; lignes: LigneStatut[]; hypotheses: string[] } | null;
  extension: {
    type: string; facade: string | null; dimensions: string | null; verdict: 'ok' | 'refus' | 'non-calcule';
    refus: string[]; alertes: string[]; empriseCreeeM2: number | null;
    sdpCreee: { valeur: number; min: number; max: number; source: string } | null; suggestion: string | null;
  } | null;
  regles: string[];
  regime: { libelle: string; architecte: string; ferme: boolean; lignes: string[]; sources: { titre: string; url: string }[]; mention: string } | null;
  avertissements: string[];
  sources: string[];
  /** Projet transmissible (contrat X0 validé) : « Projet enregistré ». */
  projetEnregistre: boolean;
}

const LIBELLES_ETAPE: Record<string, string> = {
  conserver: 'Maison existante trouvée — à conserver ?',
  confirmer: 'Estimation de la maison à confirmer',
  type: 'Type d’extension à choisir',
  dimensions: 'Dimensions de l’extension',
  surface: 'Surface existante et demandeur',
  termine: 'Projet d’extension',
  neuf: 'Projet neuf (maison démolie)',
  aucun_batiment: 'Aucune maison sur la parcelle',
  sans_bdtopo: 'Base des bâtiments indisponible',
  sans_parcelle: 'Parcelle inconnue',
};
export const libelleEtape = (e: string): string => LIBELLES_ETAPE[e] ?? 'Extension de maison';

function lireLigne(v: unknown): LigneStatut | null {
  if (!estObj(v)) return null;
  const libelle = txt(v.libelle, 80), valeur = txt(v.valeur, 120);
  if (!libelle || !valeur) return null;
  const statut = statutDe(v.statut);
  return { libelle, valeur, statut, statutLibelle: statut ? libelleStatut(statut) : null, source: txt(v.source, 300) ?? '' };
}

/** Sortie de l'outil (status « ok », data.vue) → vue de la carte ; null si illisible. */
export function lireVueExtension(sortie: unknown): VueCarteExtension | null {
  if (!estObj(sortie) || sortie.status !== 'ok' || !estObj(sortie.data) || !estObj(sortie.data.vue)) return null;
  const d = sortie.data;
  const v = d.vue as Obj;
  const etape = txt(v.etape, 30);
  const idu = txt(v.idu, 20);
  if (!etape || !idu) return null;
  const m = estObj(v.maison) ? v.maison : null;
  const e = estObj(v.extension) ? v.extension : null;
  const r = estObj(v.regime) ? v.regime : null;
  const sdp = e && estObj(e.sdpCreee) && num(e.sdpCreee.valeur) !== null ? e.sdpCreee : null;
  return {
    etape, idu, commune: txt(v.commune, 80),
    maison: m && txt(m.id, 64) ? {
      id: txt(m.id, 64)!, conservee: typeof m.conservee === 'boolean' ? m.conservee : null,
      lignes: (Array.isArray(m.lignes) ? m.lignes : []).map(lireLigne).filter((x): x is LigneStatut => !!x).slice(0, 12),
      hypotheses: textes(m.hypotheses, 8),
    } : null,
    extension: e && txt(e.type, 40) ? {
      type: txt(e.type, 40)!, facade: txt(e.facade, 40), dimensions: txt(e.dimensions, 120),
      verdict: e.verdict === 'ok' || e.verdict === 'refus' ? e.verdict : 'non-calcule',
      refus: textes(e.refus, 10), alertes: textes(e.alertes, 10), empriseCreeeM2: num(e.empriseCreeeM2),
      sdpCreee: sdp ? { valeur: num(sdp.valeur)!, min: num(sdp.min) ?? num(sdp.valeur)!, max: num(sdp.max) ?? num(sdp.valeur)!, source: txt(sdp.source, 300) ?? '' } : null,
      suggestion: txt(e.suggestion, 200),
    } : null,
    regles: textes(v.regles, 8),
    regime: r && txt(r.libelle, 120) ? {
      libelle: txt(r.libelle, 120)!, architecte: txt(r.architecte, 80) ?? '', ferme: r.ferme === true, lignes: textes(r.lignes, 10),
      sources: (Array.isArray(r.sources) ? r.sources : []).flatMap((s) => (estObj(s) && txt(s.titre, 200) && typeof s.url === 'string' && /^https:\/\/www\.service-public\.gouv\.fr\//.test(s.url) ? [{ titre: txt(s.titre, 200)!, url: s.url }] : [])).slice(0, 4),
      mention: txt(r.mention, 600) ?? '',
    } : null,
    avertissements: textes(v.avertissements, 10),
    sources: textes(v.sources, 6),
    projetEnregistre: d.projet_extension !== undefined && d.projet_extension !== null && lireProjetExtension(d.projet_extension).ok,
  };
}

export interface MessageAvecOutils { toolCalls?: readonly { name: string; status: string; output?: unknown }[] }

/** Dernière vue du parcours dans la conversation (Dossier 3D) ; null si aucun parcours. */
export function derniereVueExtension(messages: readonly MessageAvecOutils[]): VueCarteExtension | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const appels = messages[i]!.toolCalls ?? [];
    for (let j = appels.length - 1; j >= 0; j--) {
      const a = appels[j]!;
      if (a.name !== OUTIL_EXTENSION_MAISON || a.status !== 'success') continue;
      const v = lireVueExtension(a.output);
      if (v) return v;
    }
  }
  return null;
}

/** Ligne courte de l'extension (« Arrière, côté arrière vu de la rue — 5 × 4 m, plain-pied »). */
export function ligneExtension(v: NonNullable<VueCarteExtension['extension']>): string {
  return [v.type, v.facade ? `${v.facade.toLowerCase()} (vu de la rue)` : null].filter(Boolean).join(', ') + (v.dimensions ? ` — ${v.dimensions}` : '');
}

/** Surface créée ESTIMÉE, dite comme telle. */
export function ligneSurfaceCreee(v: NonNullable<VueCarteExtension['extension']>): string | null {
  const parts: string[] = [];
  if (v.sdpCreee) parts.push(`surface de plancher créée ESTIMÉE ≈ ${fr(v.sdpCreee.valeur)} m² (entre ${fr(v.sdpCreee.min, 0)} et ${fr(v.sdpCreee.max, 0)} m²)`);
  if (v.empriseCreeeM2 !== null) parts.push(`emprise au sol créée ${fr(v.empriseCreeeM2)} m²`);
  return parts.length ? parts.join(' ; ') : null;
}

// ── Rendu d'un projet d'extension (carte de résultat, Dossier 3D) ───────────────────────────────────────────
const TYPES: Record<string, string> = { laterale: 'Extension latérale', arriere: 'Extension arrière', surelevation: 'Surélévation', garage: 'Garage accolé', veranda: 'Véranda' };
const COTES: Record<string, string> = { gauche: 'côté gauche', droite: 'côté droit', arriere: 'à l’arrière', rue: 'côté rue' };
const TOITS: Record<string, string> = { 'deux-pans': '2 pans', 'quatre-pans': '4 pans', plat: 'toit plat', monopente: 'monopente' };

export interface ExistantTravail {
  titre: string;
  phrase: string;
  extension: string | null;
  /** Valeurs de la maison telles que transmises (statut compris) : toit, égout, niveaux, surface. */
  maison: LigneStatut[];
  /** Refus de la machine de rendu (lot X4, `resultat.extension.refus`), s'il y en a. */
  refus: string[];
  /** Surface créée calculée par la machine de rendu (lot X4), si fournie. */
  surfaceCreee: string | null;
}

/**
 * Travail de rendu → bloc « maison existante conservée » ; null pour un projet neuf (existant effacé ou absent).
 * Sources : `options.existant` (colonne options), `projet_extension` (fiche, contrat X0), `resultat_extension`
 * (= `resultat.extension` écrit par la machine de rendu au lot X4 : `{ refus?: string[], surface_plancher_creee_m2?: number }`).
 */
export function existantDuTravail(t: { options?: unknown; projet_extension?: unknown; resultat_extension?: unknown } | null | undefined): ExistantTravail | null {
  if (!t) return null;
  const opt = estObj(t.options) ? t.options.existant : undefined;
  const lu = t.projet_extension !== undefined && t.projet_extension !== null ? lireProjetExtension(t.projet_extension) : null;
  const projet: ProjetExtension | null = lu && lu.ok && lu.projet.nature === 'extension' ? lu.projet : null;
  if (opt !== 'conserver' && !projet) return null;
  const ex = projet?.extension ?? null;
  const dims = ex?.dimensions;
  const extension = ex ? [
    `${TYPES[ex.type] ?? ex.type}${ex.facade ? `, ${COTES[ex.facade.cote] ?? ex.facade.cote} (vu de la rue)` : ''}`,
    dims?.largeurM && dims.profondeurM ? `${fr(dims.largeurM.valeur, 2)} × ${fr(dims.profondeurM.valeur, 2)} m` : null,
    dims?.niveaux ? (ex.type === 'surelevation' ? `${dims.niveaux.valeur} niveau(x) ajouté(s)` : dims.niveaux.valeur === 1 ? 'plain-pied' : `${dims.niveaux.valeur} niveaux`) : null,
  ].filter(Boolean).join(' — ') : null;
  const e0 = projet?.existants.find((e) => e.id === ex?.existantId) ?? projet?.existants[0] ?? null;
  const ligne = (libelle: string, valeur: string | null, d: { statut: StatutDonnee; source: string } | undefined): LigneStatut[] =>
    valeur && d ? [{ libelle, valeur, statut: d.statut, statutLibelle: libelleStatut(d.statut), source: d.source }] : [];
  const maison = e0 ? [
    ...ligne('Toit', e0.formeToit ? TOITS[e0.formeToit.valeur] ?? e0.formeToit.valeur : null, e0.formeToit),
    ...ligne('Hauteur à l’égout', e0.hauteurEgoutM ? `${fr(e0.hauteurEgoutM.valeur)} m` : null, e0.hauteurEgoutM),
    ...ligne('Niveaux', e0.niveaux ? String(e0.niveaux.valeur) : null, e0.niveaux),
    ...ligne('Surface de plancher', e0.surfacePlancherM2 ? `${fr(e0.surfacePlancherM2.valeur, 0)} m²` : null, e0.surfacePlancherM2),
  ] : [];
  const rx = estObj(t.resultat_extension) ? t.resultat_extension : null;
  const sdpX4 = rx ? num(rx.surface_plancher_creee_m2) : null;
  return {
    titre: 'Maison existante conservée (projet d’extension)',
    phrase: 'La maison existante est gardée telle quelle : rien n’est effacé de l’image.',
    extension,
    maison,
    refus: rx ? textes(rx.refus, 10) : [],
    surfaceCreee: sdpX4 !== null ? `Surface de plancher créée ESTIMÉE par le moteur : ≈ ${fr(sdpX4)} m²` : null,
  };
}

/** Avertissements du résultat sans la mention de conservation (elle a son bloc). */
export function avertissementsSansConservation(avertissements: readonly string[], existant: ExistantTravail | null): string[] {
  return existant ? avertissements.filter((a) => !a.startsWith(PREFIXE_MENTION_CONSERVE)) : [...avertissements];
}
