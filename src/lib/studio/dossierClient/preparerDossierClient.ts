/**
 * VIS-60 — Préparation du DOSSIER CLIENT dans le navigateur (I/O) : lit les travaux terminés de la conversation
 * (RLS : ceux de l'utilisateur), télécharge les fichiers (studio-rendus), construit le PDF puis le ZIP, et rend un Blob.
 *
 * Aucun débit, aucune écriture en base ni dans le stockage : le dossier est assemblé à partir de livrables déjà
 * produits (et déjà payés le cas échéant). Relancer la préparation ne coûte rien.
 * Logique pure : dossierClientLogique.ts, pdfDossier.ts, zipStocke.ts.
 */
import { supabase } from '@/lib/supabaseClient';
import { lienVisite } from '../travauxLogique';
import {
  collecterLivrables, etatDossier, MENTION_DOSSIER, nomFichierSur, noticeDossier, programmeDepuisResume, raccourciUrl, TITRE_DOSSIER,
  type EtatDossier, type FichierDossier, type ManifesteDossier, type TravailDossier,
} from './dossierClientLogique.ts';
import { construirePdfDossier, type PageQuartierDossier } from './pdfDossier.ts';
// VIS-71 : page « Le quartier » du dossier (atouts VIS-70 : ceux de la carte du chat s'ils sont en session, sinon recalculés).
import { chargerAtoutsQuartier, lireAtoutsSession, lireProjetConversation } from '../../quartier/chargerQuartier.ts';
import { texteDossierQuartier } from '../../quartier/texteAtouts.ts';
import { creerZipStocke, type EntreeZipStocke } from './zipStocke.ts';

/** Validité du lien du film inscrit dans le PDF (le MP4 est aussi dans le ZIP). */
export const VALIDITE_LIEN_FILM_S = 30 * 24 * 3600;
/** Au-delà, le film n'est pas mis dans le ZIP (mémoire du navigateur) ; le lien reste dans le PDF. */
export const FILM_MAX_OCTETS = 1_500_000_000;

export interface ProgresDossier { etape: string; fait: number; total: number }

export interface DossierPrepare {
  blob: Blob;
  nomFichier: string;
  etat: EtatDossier;
  manifeste: ManifesteDossier;
  /** Fichiers prévus mais non récupérés (dits à l'écran, jamais masqués). */
  manquants: string[];
}

const COLONNES = 'id,type,statut,resultat,cree_le,termine_le';

export async function lireTravauxDossier(conversationId: string): Promise<TravailDossier[]> {
  const { data, error } = await supabase.from('studio_jobs').select(COLONNES).eq('conversation_id', conversationId)
    .order('cree_le', { ascending: false }).limit(200);
  if (error) throw new Error(`Travaux illisibles : ${error.message}`);
  return (data ?? []) as TravailDossier[];
}

async function lireResume(conversationId: string): Promise<unknown> {
  const { data } = await supabase.from('studio_preparations').select('resume').eq('conversation_id', conversationId)
    .order('maj_le', { ascending: false }).limit(1);
  return (data?.[0] as { resume?: unknown } | undefined)?.resume ?? null;
}

async function telecharger(f: { bucket: string; chemin: string }): Promise<Uint8Array | null> {
  const { data, error } = await supabase.storage.from(f.bucket).download(f.chemin);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

/** Délai au-delà duquel la page quartier est omise (le dossier ne doit jamais attendre une source lente). */
export const DELAI_QUARTIER_MS = 25_000;

/** VIS-71 — page « Le quartier » : null si le projet n'est pas localisé ou si aucune source n'a répondu (jamais simulée). */
export async function lirePageQuartier(conversationId: string): Promise<PageQuartierDossier | null> {
  try {
    const projet = await lireProjetConversation(conversationId);
    if (!projet) return null;
    const atouts = lireAtoutsSession(projet) ?? await Promise.race([
      chargerAtoutsQuartier(projet),
      new Promise<null>((r) => setTimeout(() => r(null), DELAI_QUARTIER_MS)),
    ]);
    if (!atouts) return null;
    const t = texteDossierQuartier(atouts);
    return t.lignes.length ? t : null;
  } catch {
    return null;
  }
}

function dateFr(d = new Date()): string {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: 'long', year: 'numeric' }).format(d);
}

export async function preparerDossierClient(o: {
  conversationId: string;
  titre: string;
  adresse?: string | null;
  origine?: string;
  surProgres?: (p: ProgresDossier) => void;
}): Promise<DossierPrepare> {
  const progres = (etape: string, fait: number, total: number) => o.surProgres?.({ etape, fait, total });
  progres('Lecture des livrables', 0, 1);
  const [travaux, resume] = await Promise.all([lireTravauxDossier(o.conversationId), lireResume(o.conversationId)]);
  // VIS-71 : lancé tout de suite, attendu au moment du PDF (en parallèle des téléchargements).
  const quartierP = lirePageQuartier(o.conversationId);
  const m = collecterLivrables(travaux);
  const etat = etatDossier(travaux, m);
  if (!etat.preparable) throw new Error(etat.phrase);

  // Fichiers à télécharger : ZIP (originaux) + aperçus pour le PDF.
  const aZip: FichierDossier[] = [
    ...(m.film ? [m.film.fichier, ...(m.film.affiche ? [m.film.affiche] : [])] : []),
    ...m.images, ...m.plans,
  ];
  const pourPdf = new Set<string>([...m.images.map((i) => i.cheminApercu ?? i.chemin), ...m.plans.filter((p) => p.genre === 'plan_apercu').map((p) => p.chemin)]);
  const tous = [...new Set([...aZip.map((f) => f.chemin), ...pourPdf])];
  const octets = new Map<string, Uint8Array>();
  const manquants: string[] = [];
  let fait = 0;
  for (const chemin of tous) {
    progres('Téléchargement des fichiers', fait++, tous.length);
    const f = aZip.find((x) => x.chemin === chemin);
    const b = await telecharger({ bucket: f?.bucket ?? 'studio-rendus', chemin });
    if (!b) { if (f) manquants.push(f.libelle); continue; }
    if (f?.genre === 'film' && b.length > FILM_MAX_OCTETS) { manquants.push('film (trop volumineux pour l’archive : lien dans le PDF)'); continue; }
    octets.set(chemin, b);
  }

  progres('Mise en page du PDF', 0, 1);
  const origine = o.origine ?? (typeof window !== 'undefined' ? window.location.origin : 'https://mimmoza.fr');
  const lienV = m.visite ? lienVisite(m.visite.visiteId, origine) : null;
  let lienF: string | null = null;
  if (m.film) {
    const { data } = await supabase.storage.from(m.film.fichier.bucket).createSignedUrl(m.film.fichier.chemin, VALIDITE_LIEN_FILM_S);
    lienF = data?.signedUrl ?? null;
  }
  const date = dateFr();
  const programme = programmeDepuisResume(resume, { titre: o.titre, adresse: o.adresse ?? null });
  const quartier = await quartierP;
  const pdf = construirePdfDossier({ titre: o.titre, adresse: o.adresse, date, programme, manifeste: m, octets, lienFilm: lienF, lienVisite: lienV, quartier });
  const nomPdf = `${nomFichierSur(`Dossier-presentation-${o.titre}`, 80)}.pdf`;

  progres('Assemblage de l’archive', 0, 1);
  const entrees: EntreeZipStocke[] = [{ nom: nomPdf, donnees: pdf }];
  for (const f of aZip) { const b = octets.get(f.chemin); if (b) entrees.push({ nom: f.nomZip, donnees: b }); }
  const enc = new TextEncoder();
  if (lienV) {
    entrees.push({ nom: '04-Visite-360/Visite-360.url', donnees: enc.encode(raccourciUrl(lienV)) });
    entrees.push({ nom: '04-Visite-360/lien-visite-360.txt', donnees: enc.encode(`Visite 360° : ${lienV}\r\n${MENTION_DOSSIER}.\r\n`) });
  }
  entrees.push({ nom: 'LISEZMOI.txt', donnees: enc.encode('﻿' + noticeDossier({ titre: o.titre, date, m, lienFilm: lienF, lienVisite: lienV, nomPdf })) });
  const zip = creerZipStocke(entrees);
  progres('Terminé', 1, 1);
  return {
    blob: new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' }),
    nomFichier: `${nomFichierSur(`${TITRE_DOSSIER}-${o.titre}`, 80)}.zip`,
    etat, manifeste: m, manquants,
  };
}
