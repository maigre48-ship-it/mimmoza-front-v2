/// <reference lib="dom" />
// supabase/functions/copilot-chat/agent/studio-front.ts
// =============================================================
// LOT E1 — pont vers le code PUR du front (src/spaces/copilot/studio3d).
//
// Le volume d'étude proposé par Mimmo est calculé par EXACTEMENT les mêmes
// fonctions que le Dossier 3D du chat (volumeParcelle.ts, implantationProgramme.ts,
// programmeBati.ts) et transformé en projet `mimmoza-projet-v2` par le même code
// que « Voir en 3D » (batimentsStudio.ts, projetChat.ts, jarvisDraft.ts) :
// aucune seconde implémentation, donc aucun écart possible entre ce que Mimmo
// annonce et ce que le Studio reçoit.
//
// Pourquoi `/// <reference lib="dom" />` : projetChat.ts importe (en type
// seulement) ouvrirStudio3D.ts, écrit pour le navigateur ; sans la bibliothèque
// DOM, la vérification de types de Deno échoue. À l'exécution, Deno n'évalue
// pas les imports de type : aucun code navigateur n'est chargé.
//
// Déploiement : ces fichiers sont HORS de supabase/functions. Le déploiement
// doit embarquer les imports relatifs hors du dossier (CLI Supabase avec
// `--use-api`, voir CODEX.md). Un échec d'embarquement fait échouer le
// déploiement (l'ancienne version reste en ligne) : jamais un copilote muet.
// =============================================================

export {
  calculerVolumeProgramme, HYPOTHESES_PROGRAMME, LIMITE_BATIMENTS_STUDIO,
} from '../../../../src/spaces/copilot/studio3d/implantationProgramme.ts';
export { programmeBatiDepuisTexte } from '../../../../src/spaces/copilot/studio3d/programmeBati.ts';
export {
  corpsAffiches, ficheStudioDepuisVolume, HYPOTHESES_VOLUME, libelleNiveaux, regleValide,
  type GeometrieParcelle, type ProgrammeVolume, type ReglePlu, type ReglesPluVolume, type VolumePropose,
} from '../../../../src/spaces/copilot/studio3d/volumeParcelle.ts';
export { rotationContrat, volumeBatimentsStudio } from '../../../../src/spaces/copilot/studio3d/batimentsStudio.ts';
export { construireProjetChat, projetIdChat } from '../../../../src/spaces/copilot/studio3d/projetChat.ts';
export {
  draftBrief, studioCommand, studioComposition, studioSegmentedVolume, type JarvisDraft,
} from '../../../../src/spaces/copilot/studio3d/jarvisDraft.ts';
export { exigerPreparation3D } from '../../../../src/spaces/copilot/studio3d/preparation3D.ts';
// Lot fiche-3d : vérifications PLU du volume, partagées avec la fiche « Espace 3D » du chat.
export {
  controlerVolume, formuleRecul, libelleRegle, lireRegles, regleCitee,
  type ControleVolume, type RegleLue, type Verdict,
} from '../../../../src/spaces/copilot/studio3d/controlesVolume.ts';
export type { ProjetMimmozaV2 } from '../../../../src/spaces/promoteur/shared/echangeStudio/mimmozaProjetV2.ts';
