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

import { exigerPreparation3D, exigerParcelle3D } from './preparation3D';
import { draftBrief, studioCommand, studioComposition, studioSegmentedVolume, type JarvisDraft } from './jarvisDraft';
import { listJarvisTransferFiles, type JarvisStoredFile } from './jarvisFiles';
import type { ConfirmedTerrain } from './terrainCadastre';
import { construireProjetChat, etudeDuChat, prochaineRevision, signatureFiche, transportParBatiments, type IssueProjetChat, type StockageCle, type VolumeBatimentsStudio } from './projetChat';
import { getActiveStudyId } from '@/spaces/promoteur/shared/promoteurSnapshot.store';
import { memoriserRelief, reliefEnCache } from './reliefCache';
import { parcelId } from './parcelFromGps';
import { signerTransferts } from './transfertStudio';
import { adressesSignees, televerserPanorama } from '@/spaces/promoteur/shared/environnement360';
import type { ParcelleStudio, TerrainStudio } from '@/spaces/promoteur/shared/ouvrirStudio3D';
import type { ProjetMimmozaV2 } from '@/spaces/promoteur/shared/echangeStudio/mimmozaProjetV2';
// VIS-04 : brief projet de l'étude rattachée (Style & tendances, programme, habillage, vues) — même charge pour
// « Voir en 3D », le film / la visite / l'image de FilmVisitePanel et le chat (construireProjetChat).
import { facadeDesChamps, type ChampsContratBrief } from '@/lib/studio/briefProjet';
import { champsBriefDeLaConversation } from '@/spaces/promoteur/shared/briefProjet.store';
// VIS-22 : bâtiment décrit dans le chat (texte ou photo) — ses clauses habillent la commande envoyée au Studio.
import { commandeAvecDescription, type DescriptionBatiment } from '@/lib/studio/descriptionBatiment';
import { descriptionCourante } from './descriptionBatimentChat';
// VIS-25 lot B : bâtiment DESSINÉ en vigueur (modèle composé) — complément `modeleBatiment` envoyé au Studio avec le projet.
import { modeleCourant } from './modeleBatimentChat';
import type { ModeleBatiment } from '@/lib/studio/modeleBatiment';
import { useCopilotStore } from '../store/copilotStore';

/** Terrain retenu pour la conversation, ou celui qui vient d'être confirmé. */
export type TerrainCharge = Pick<ConfirmedTerrain, 'parcel' | 'point' | 'implantation' | 'accesses'> & {
  adresse?: string | null;
  /** Bâtiments du Dossier 3D (plusieurs) : repris seulement pour la fiche dont ils sont issus. */
  volumeBatiments?: VolumeBatimentsStudio | null;
};

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
  options: {
    autoriserEtudeActive?: boolean;
    /** VIS-04 : champs du brief projet ; absent → ceux de l'étude de la conversation ; null → aucun brief. */
    briefProjet?: ChampsContratBrief | null;
    /**
     * VIS-22 : description du bâtiment à appliquer ; absente → celle en vigueur dans la conversation AFFICHÉE (dernier
     * message « Reproduire en 3D », tant qu'aucun autre habillage n'a été choisi ensuite) ; null → aucune.
     */
    description?: DescriptionBatiment | null;
  } = {},
): Promise<PreparationChargeStudio> {
  // Également utilisé par le film et les rappels photo : contrôle avant stockage, signature ou upload.
  exigerPreparation3D(fiche);
  exigerParcelle3D(retenue?.parcel);
  const parcelles: ParcelleStudio[] = [{ id: parcelId(retenue.parcel), feature: retenue.parcel }];
  const insee = typeof retenue.parcel.properties?.code_insee === 'string' ? retenue.parcel.properties.code_insee : null;
  if (terrainArg?.terrainData) await memoriserRelief(parcelles, terrainArg.terrainData);
  const reliefConnu = terrainArg?.terrainData ?? await reliefEnCache(parcelles) ?? null;
  // Pièces du dossier : les PDF partent comme plans ; les images attendent d'être classées (mode détaillé).
  const conserves = await listJarvisTransferFiles(conversationId).catch(() => [] as JarvisStoredFile[]);
  const plans = await signerTransferts(conserves.filter(f => f.kind === 'pdf')).catch(() => []);
  const panoramas = terrainArg?.panorama
    ? await televerserPanorama(`chat-${crypto.randomUUID()}`, terrainArg.panorama).then(p => adressesSignees([p])).catch(() => [])
    : [];
  // VIS-04 — brief projet : la matière de façade du brief passe AVANT celle tirée du texte de la fiche (repli).
  const briefProjet = options.briefProjet !== undefined ? options.briefProjet
    : options.autoriserEtudeActive === false ? null : champsBriefDeLaConversation(conversationId)?.champs ?? null;
  const facadeBrief = facadeDesChamps(briefProjet);
  const composition = studioComposition(fiche, facadeBrief);
  // VIS-22 : un seul bâtiment simple → façade, ouvertures, balcons, toiture, style et éléments de la description sont
  // ajoutés à la commande de création (mêmes formulations que le rendu). Plusieurs bâtiments ou bâtiment à ailes : le
  // Studio reçoit le volume bâtiment par bâtiment, sans habillage (limite connue, dite dans la carte).
  const description = options.description !== undefined ? options.description : descriptionDeLaConversation(conversationId);
  // Volume multi-bâtiments du Dossier 3D : seulement pour la fiche tirée de ce volume (sinon bâtiment unique historique).
  // Lot formes-batiment : un seul bâtiment à ailes (L, U, cour, redans) part aussi par `batiments`.
  const volume = retenue.volumeBatiments && transportParBatiments(retenue.volumeBatiments.batiments)
    && retenue.volumeBatiments.signatureFiche === signatureFiche(fiche) ? retenue.volumeBatiments : null;
  const sessionId = crypto.randomUUID();
  const pageSansAncre = new URL(window.location.href);
  pageSansAncre.hash = '';
  pageSansAncre.searchParams.set('conversation', conversationId);
  // R4/R5 — étude du projet (figée par conversation) : Studio relie son métré au bilan sans clic.
  const etudeId = etudeDuChat(conversationId, options.autoriserEtudeActive === false ? null : getActiveStudyId(), stockageLocalSur());
  const construit = construireProjetChat({
    conversationId, etudeId, sessionId, origine: window.location.origin, retourUrl: pageSansAncre.href,
    revision: 0, horodatage: new Date().toISOString(),
    parcelles, communeInsee: insee, adresse: retenue.adresse ?? fiche.localisation,
    pointAdresse: retenue.point, relief: reliefConnu,
    implantation: volume ? null : retenue.implantation ?? null, accesses: volume ? undefined : retenue.accesses,
    brief: draftBrief(fiche), commandeArchitecture: composition ? null : commandeAvecDescription(studioCommand(fiche, facadeBrief), description),
    compositionArchitecture: composition, volumeAiles: studioSegmentedVolume(fiche), plans, panoramas,
    batiments: volume?.batiments ?? null, programmeVolume: volume,
    briefProjet,
  });
  return { construit, parcelles, insee, reliefConnu, conserves, sessionId, etudeId };
}

/** VIS-22 : description en vigueur dans la conversation affichée par le chat (null pour une autre conversation). */
function descriptionDeLaConversation(conversationId: string): DescriptionBatiment | null {
  try {
    const etat = useCopilotStore.getState();
    return etat.currentConversationId === conversationId ? descriptionCourante(etat.messages) : null;
  } catch { return null; }
}

/**
 * VIS-25 lot B : bâtiment DESSINÉ en vigueur dans la conversation affichée par le chat (dernier « Reproduire en 3D » de
 * la carte du modèle composé, tant qu'aucun autre habillage n'a été choisi ensuite) ; null pour une autre conversation.
 * À passer au Studio en COMPLÉMENT du projet : `voirEn3D(fiche, conversationId, undefined, { complements: { modeleBatiment } })`.
 * La description VIS-22 du même message reste appliquée à la commande (repli si le Studio ne lit pas le complément).
 */
export function modeleDeLaConversation(conversationId: string): ModeleBatiment | null {
  try {
    const etat = useCopilotStore.getState();
    return etat.currentConversationId === conversationId ? modeleCourant(etat.messages) : null;
  } catch { return null; }
}

/** Le projet avec la révision suivante de la conversation (comme à chaque envoi à Studio). */
export function avecProchaineRevision(projet: ProjetMimmozaV2, conversationId: string): ProjetMimmozaV2 {
  return { ...projet, revision: prochaineRevision(conversationId, stockageLocalSur()) };
}
