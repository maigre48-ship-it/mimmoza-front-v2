// src/spaces/copilot/studio3d/preparationStudio.ts
//
// LOT E1 — « 3D PRÉPARÉE PAR MIMMO » : logique PURE (testée par node --test).
//
// Le copilote (outil studio_preparer_3d, supabase/functions/copilot-chat/agent/studio.ts)
// calcule un volume d'étude à partir d'une fiche de conception avec CE code
// (volumeParcelle + implantationProgramme) et l'enregistre dans
// `studio_preparations`. Ici :
//   - repérer la dernière préparation réussie dans les appels d'outils de la conversation ;
//   - relire la ligne stockée sans lui faire confiance ;
//   - construire, avec les fonctions existantes, exactement ce que le bouton
//     « Voir en 3D » du volume d'étude remet à MimmozIAPage.voirEn3D
//     (VolumeParcelleSection.ouvrir) : fiche tirée du volume + terrain confirmé
//     (parcelle cadastrale de la conception) + bâtiments (plusieurs) ou pose (un seul).
// Aucune I/O ici.

import type { ConfirmedTerrain } from './terrainCadastre';
import type { TerrainParcel } from './parcelFromGps';
import type { JarvisDraft } from './jarvisDraft.ts';
import { implantationDepuisVolume, pointDansParcelle, terrainDepuisParcelle } from './confirmationRapide.ts';
import { volumeBatimentsStudio, type VolumeBatimentsStudio } from './batimentsStudio.ts';
import { ficheStudioDepuisVolume, type GeometrieParcelle, type ProgrammeVolume, type VolumePropose } from './volumeParcelle.ts';

export const OUTIL_PREPARATION = 'studio_preparer_3d';
export const OUTIL_RENDU = 'studio_lancer_rendu';

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const txt = (v: unknown, max = 300): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const fini = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MessageOutils {
  role: string;
  toolCalls?: { name: string; status: string; input?: unknown; output?: unknown }[];
}

/** Contrôle annoncé par Mimmo (verdict déterministe, jamais « conforme »). */
export interface ControleAnnonce { libelle: string; verdict: 'dans_la_limite' | 'au_dela' | 'a_verifier' | 'non_controle'; explication: string }

export interface ReferencePreparation {
  preparationId: string;
  conceptionId: string | null;
  idu: string;
  commune: string | null;
  batiments: number | null;
  gabarit: string | null;
  sdpM2: number | null;
  logementsPlaces: number | null;
  logementsVises: number | null;
  controles: ControleAnnonce[];
  alertes: string[];
}

const VERDICTS = ['dans_la_limite', 'au_dela', 'a_verifier', 'non_controle'] as const;

/** Dernière préparation RÉUSSIE (statut d'outil « success » ET sortie « ok ») de la conversation. */
export function dernierePreparation(messages: readonly MessageOutils[]): ReferencePreparation | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const appels = messages[i].toolCalls ?? [];
    for (let j = appels.length - 1; j >= 0; j--) {
      const a = appels[j];
      if (a.name !== OUTIL_PREPARATION || a.status !== 'success') continue;
      const sortie = estObj(a.output) ? a.output : null;
      if (sortie?.status !== 'ok' || !estObj(sortie.data)) continue;
      const d = sortie.data;
      const id = typeof d.preparation_id === 'string' && RE_UUID.test(d.preparation_id) ? d.preparation_id : null;
      const idu = txt(d.idu, 40);
      if (!id || !idu) continue;
      const v = estObj(d.volume) ? d.volume : {};
      const controles = (Array.isArray(v.controles) ? v.controles : []).filter(estObj).flatMap((c): ControleAnnonce[] => {
        const verdict = VERDICTS.find((x) => x === c.verdict);
        const libelle = txt(c.libelle, 80);
        return verdict && libelle ? [{ libelle, verdict, explication: txt(c.explication, 400) ?? '' }] : [];
      });
      return {
        preparationId: id, conceptionId: typeof d.conception_id === 'string' && RE_UUID.test(d.conception_id) ? d.conception_id : null,
        idu, commune: txt(d.commune, 120),
        batiments: fini(v.batiments) ? v.batiments : null, gabarit: txt(v.gabarit, 20), sdpM2: fini(v.sdp_estimee_m2) ? v.sdp_estimee_m2 : null,
        logementsPlaces: fini(v.logements_places) ? v.logements_places : null, logementsVises: fini(v.logements_vises) ? v.logements_vises : null,
        controles, alertes: (Array.isArray(v.alertes) ? v.alertes : []).map((x) => txt(x, 300)).filter((x): x is string => !!x).slice(0, 4),
      };
    }
  }
  return null;
}

/** Vrai si un rendu a été lancé (ou devisé) par Mimmo dans la conversation : le suivi des rendus est alors affiché. */
export function renduDemande(messages: readonly MessageOutils[]): boolean {
  return messages.some((m) => (m.toolCalls ?? []).some((a) => a.name === OUTIL_RENDU && a.status === 'success'));
}

export interface PreparationStockee {
  id: string;
  idu: string;
  commune: string | null;
  geometrie: GeometrieParcelle;
  programme: ProgrammeVolume | undefined;
  volume: VolumePropose;
}

/** Ligne `studio_preparations` relue sans confiance ; null si inexploitable. */
export function lirePreparationStockee(ligne: unknown): PreparationStockee | null {
  if (!estObj(ligne) || typeof ligne.id !== 'string' || !estObj(ligne.entree) || !estObj(ligne.volume)) return null;
  const entree = ligne.entree;
  const parcelle = estObj(entree.parcelle) ? entree.parcelle : null;
  const g = parcelle && estObj(parcelle.geometrie) ? parcelle.geometrie : null;
  if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon') || !Array.isArray(g.coordinates)) return null;
  const v = ligne.volume as unknown as VolumePropose;
  if (!v.emprise || !fini(v.niveaux) || v.niveaux < 1 || !estObj(v.origine)) return null;
  const idu = txt(ligne.idu, 40) ?? txt(parcelle?.idu, 40);
  if (!idu) return null;
  return {
    id: ligne.id, idu, commune: txt(entree.commune, 120), geometrie: g as unknown as GeometrieParcelle,
    programme: estObj(entree.programme_volume) ? entree.programme_volume as unknown as ProgrammeVolume : undefined, volume: v,
  };
}

export type TerrainOuverture = ConfirmedTerrain & { adresse: string | null; volumeBatiments: VolumeBatimentsStudio | null };
export type IssueOuverture = { ok: true; fiche: JarvisDraft; terrain: TerrainOuverture } | { ok: false; erreur: string };

/**
 * Ce que « Voir en 3D » du volume d'étude remet à MimmozIAPage.voirEn3D (même construction que
 * VolumeParcelleSection.ouvrir) : la parcelle de la conception tient lieu de parcelle confirmée.
 */
export function ouverturePreparation(p: PreparationStockee): IssueOuverture {
  const insee = /^(\d{5}|2[AB]\d{3})/.test(p.idu) ? p.idu.slice(0, 5) : null;
  const parcelle = {
    type: 'Feature', geometry: p.geometrie,
    properties: { id: p.idu, idu: p.idu, ...(insee ? { code_insee: insee } : {}), source: 'conception Mimmoza (cadastre IGN)' },
  } as unknown as TerrainParcel;
  const fiche = ficheStudioDepuisVolume(p.volume, { adresse: p.commune, reference: p.idu, programme: p.programme, base: null });
  if (!fiche) return { ok: false, erreur: 'Aucun volume à transmettre sur cette parcelle.' };
  let volumeBatiments: VolumeBatimentsStudio | null;
  try { volumeBatiments = volumeBatimentsStudio(p.volume, fiche); }
  catch (e) { return { ok: false, erreur: e instanceof Error ? e.message : 'Trop de bâtiments pour Studio.' }; }
  const base = terrainDepuisParcelle(parcelle, p.idu, pointDansParcelle(parcelle), p.commune);
  const pose = volumeBatiments ? null : implantationDepuisVolume(p.volume);
  const terrain: TerrainOuverture = volumeBatiments
    ? { ...base, implantation: undefined, volumeBatiments }
    : { ...base, ...(pose ? { implantation: pose } : {}), volumeBatiments: null };
  return { ok: true, fiche, terrain };
}

/** Lignes chiffrées de la carte (valeurs du moteur, présentées comme indicatives). */
export function lignesCarte(r: ReferencePreparation): string[] {
  const nf = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 0 });
  return [
    r.batiments !== null && r.gabarit ? `${r.batiments} bâtiment${r.batiments > 1 ? 's' : ''} en ${r.gabarit}` : null,
    r.sdpM2 !== null ? `≈ ${nf(r.sdpM2)} m² de surface de plancher (estimée)` : null,
    r.logementsPlaces !== null ? `${nf(r.logementsPlaces)} logements placés${r.logementsVises !== null ? ` sur ${nf(r.logementsVises)} visés` : ''}` : null,
  ].filter((x): x is string => !!x);
}

export const LIBELLES_VERDICT: Record<ControleAnnonce['verdict'], string> = {
  dans_la_limite: 'dans la limite de la règle citée', au_dela: 'au-delà de la règle', a_verifier: 'à vérifier', non_controle: 'non contrôlé',
};
