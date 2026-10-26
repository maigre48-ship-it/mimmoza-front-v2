// src/spaces/copilot/studio3d/chargeVoirEn3D.ts
//
// CHARGE STUDIO DE « VOIR EN 3D » — construite en UN SEUL endroit.
//
// Utilisée par « Voir en 3D » (MimmozIAPage.voirEn3D, Studio intégré à la page)
// ET par le film / la visite 360° (FilmVisitePanel → studio_jobs.fiche.charge) :
// le worker du Studio reçoit exactement le même projet Mimmoza v2 que le
// Studio ouvert dans la page (parcelle, relief connu, implantation, accès,
// brief, commande ou composition d'architecture, volume, plans PDF signés,
// panorama éventuel), sans dupliquer studioCommand ni construireProjetChat.

import { draftBrief, studioCommand, studioComposition, studioSegmentedVolume, type JarvisDraft } from './jarvisDraft';
import { listJarvisTransferFiles, type JarvisStoredFile } from './jarvisFiles';
import type { ConfirmedTerrain } from './terrainCadastre';
import { construireProjetChat, etudeDuChat, prochaineRevision, type IssueProjetChat, type StockageCle } from './projetChat';
import { getActiveStudyId } from '@/spaces/promoteur/shared/promoteurSnapshot.store';
import { memoriserRelief, reliefEnCache } from './reliefCache';
import { parcelId } from './parcelFromGps';
import { signerTransferts } from './transfertStudio';
import { adressesSignees, televerserPanorama } from '@/spaces/promoteur/shared/environnement360';
import type { ParcelleStudio, TerrainStudio } from '@/spaces/promoteur/shared/ouvrirStudio3D';
import type { ProjetMimmozaV2 } from '@/spaces/promoteur/shared/echangeStudio/mimmozaProjetV2';

/** Terrain retenu pour la conversation, ou celui qui vient d'être confirmé. */
export type TerrainCharge = Pick<ConfirmedTerrain, 'parcel' | 'point' | 'implantation' | 'accesses'> & { adresse?: string | null };

export interface PreparationChargeStudio {
  construit: IssueProjetChat;
  parcelles: ParcelleStudio[];
  insee: string | null;
  reliefConnu: TerrainStudio | null;
  conserves: JarvisStoredFile[];
  sessionId: string;
  etudeId: string | null;
}

export function stockageLocalSur(): StockageCle | null {
  try { return localStorage; } catch { return null; }
}

/**
 * Prépare la charge Studio de « Voir en 3D ». `terrainArg` (parcours photo/GPS
 * qui vient d'aboutir) apporte éventuellement le relief mesuré et un panorama.
 */
export async function preparerChargeVoirEn3D(
  fiche: JarvisDraft,
  conversationId: string,
  retenue: TerrainCharge,
  terrainArg?: ConfirmedTerrain & { adresse?: string | null },
): Promise<PreparationChargeStudio> {
  const parcelles: ParcelleStudio[] = [{ id: parcelId(retenue.parcel), feature: retenue.parcel }];
  const insee = typeof retenue.parcel.properties.code_insee === 'string' ? retenue.parcel.properties.code_insee : null;
  if (terrainArg?.terrainData) await memoriserRelief(parcelles, terrainArg.terrainData);
  const reliefConnu = terrainArg?.terrainData ?? await reliefEnCache(parcelles) ?? null;
  // Pièces du dossier : les PDF partent comme plans ; les images attendent d'être classées (mode détaillé).
  const conserves = await listJarvisTransferFiles(conversationId).catch(() => [] as JarvisStoredFile[]);
  const plans = await signerTransferts(conserves.filter(f => f.kind === 'pdf')).catch(() => []);
  const panoramas = terrainArg?.panorama
    ? await televerserPanorama(`chat-${crypto.randomUUID()}`, terrainArg.panorama).then(p => adressesSignees([p])).catch(() => [])
    : [];
  const composition = studioComposition(fiche);
  const sessionId = crypto.randomUUID();
  const pageSansAncre = new URL(window.location.href);
  pageSansAncre.hash = '';
  pageSansAncre.searchParams.set('conversation', conversationId);
  // R4/R5 — étude du projet (figée par conversation) : Studio relie son métré au bilan sans clic.
  const etudeId = etudeDuChat(conversationId, getActiveStudyId(), stockageLocalSur());
  const construit = construireProjetChat({
    conversationId, etudeId, sessionId, origine: window.location.origin, retourUrl: pageSansAncre.href,
    revision: 0, horodatage: new Date().toISOString(),
    parcelles, communeInsee: insee, adresse: retenue.adresse ?? fiche.localisation,
    pointAdresse: retenue.point, relief: reliefConnu,
    implantation: retenue.implantation ?? null, accesses: retenue.accesses,
    brief: draftBrief(fiche), commandeArchitecture: composition ? null : studioCommand(fiche),
    compositionArchitecture: composition, volumeAiles: studioSegmentedVolume(fiche), plans, panoramas,
  });
  return { construit, parcelles, insee, reliefConnu, conserves, sessionId, etudeId };
}

/** Le projet avec la révision suivante de la conversation (comme à chaque envoi à Studio). */
export function avecProchaineRevision(projet: ProjetMimmozaV2, conversationId: string): ProjetMimmozaV2 {
  return { ...projet, revision: prochaineRevision(conversationId, stockageLocalSur()) };
}
