// src/spaces/copilot/studio3d/FilmVisitePanel.tsx
//
// FILM, VISITE 360° OU IMAGE PHOTORÉALISTE EN 3 CLICS (contrat docs/studio/CONTRAT_FILM_VISITE.md).
//
// Dans le dossier de l'Espace 3D, sous « Voir en 3D » :
//   clic 1 — « Film », « Visite 360° » ou « Image photoréaliste » ;
//   clic 2 — « Lancer » sur une feuille d'options déjà remplie ;
//   suivi en direct (temps réel + sondage 5 s), bouton Annuler ;
//   clic 3 — « Voir le film » (lecteur intégré, URL signée),
//            « Voir l’image » (image affichée, JPEG et PNG à télécharger) ou
//            « Ouvrir la visite » (/visite/<id>, lien à copier).
// Facturation : aucune — le film et la visite ne débitent pas de jetons ; l'image non plus (02/11/2026).
// Le Studio travaille en coulisses : l'utilisateur ne l'ouvre pas.
// Si la file n'existe pas encore en base : « Bientôt disponible », sans erreur.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Check, Clapperboard, Copy, ExternalLink, Image as IconeImage, Loader2, Orbit, Play, X } from 'lucide-react';
import type { JarvisDraft } from './jarvisDraft';
import { parcelleRetenue, retenirParcelle } from './parcelleConfirmee';
import type { ConfirmedTerrain } from './terrainCadastre';
import { ConfirmerParcelle } from './ConfirmerParcelle';
import { avecProchaineRevision, modeleDeLaConversation, preparerChargeVoirEn3D } from './chargeVoirEn3D';
// VIS-26 lot D : le bâtiment DESSINÉ en vigueur part avec l'aperçu et les images (fiche.modele_batiment, lu par la machine de rendu).
import { travailAvecModele } from './modeleTravail';
import {
  AMBIANCES_IMAGE, annulerTravail, construireTravail, creerTravail, dateCourte, dureeEstimeeApercu, dureeEstimeeImage, estActif, LIBELLES_AMBIANCE, LIBELLES_TYPE,
  LIBELLES_QUALITE_IMAGE, LIBELLES_VUE, libelleStatut, lienVisite, listerTravaux, MENTION_MACHINE_RENDU, optionsParDefaut, phraseElementsOmis,
  phraseSuivi, QUALITES_IMAGE, resumeOptions, suivreTravail, urlSigneeRendu, VUES_IMAGE,
  type Ambiance, type AmbianceImage, type OptionsFilm, type OptionsImage, type OptionsVisite, type QualiteImage, type ResultatFilm,
  type ResultatImage, type ResultatVisite, type TravailStudio, type TypeTravail, type VueImage,
} from '@/lib/studio/travaux';
import './FilmVisitePanel.css';
// LOT X9 — image d'extension : jamais montrée sans vraie photo de la maison.
import { extensionSansPhotoReelle } from './suiviRenduChat';
import { photoRequiseDuResultat } from '@/lib/studio/photoReelle';
// VIS-04 — vues du catalogue (pack plaquette pré-coché, vues à venir grisées « bientôt ») et brief projet de l'étude.
import { catalogueVues, LIBELLES_GROUPE_VUE, MAX_VUES_PAR_IMAGE, vueCochable, vuesPreCochees, type GroupeVue } from '@/lib/studio/catalogueVues';
// VIS-10 — badge étude / photoréaliste et livraison commerciale dans la visionneuse du Dossier 3D.
import { BadgeRealisme, BlocLivraisonImage, DefinitionLivree } from './BlocLivraisonImage';
import { champsBriefDeLaConversation } from '@/spaces/promoteur/shared/briefProjet.store';
// VIS-17 — parcours guidé : ouverture commandée par une étape, réglages film / visite gardés, validation de l'aperçu.
import { lireMemoireParcours, majMemoireParcours } from './parcours.store';
import type { ReglagesFilm, ReglagesVisite } from '@/lib/studio/parcours';
// VIS-28 (24/11) : écran d'une étape du parcours — feuille du type ouverte d'office, « Déjà réalisés » filtré par type,
// « Relancer » sur un rendu en échec.
import { estApercu, HistoriqueRendus } from './HistoriqueRendus';
import type { FeuilleEtape } from './renduParcours';

/** VIS-17 — commande d'une étape du parcours : ouvrir une feuille (et sa définition) ou montrer les rendus réalisés. */
export interface CommandeRendu { feuille: TypeTravail | null; qualite?: QualiteImage; jeton: number }
/**
 * VIS-28 — écran d'une étape du parcours : type du parcours (pas de nouveau choix Film / Visite / Image), étape affichée
 * et feuille à ouvrir d'office (null : rendus à revoir ou étape bloquée).
 */
export interface ParcoursRendu { type: TypeTravail; cle: string; feuille: FeuilleEtape | null }
const reglagesFilm = (f: OptionsFilm): ReglagesFilm => ({ duree_s: f.duree_s, format: f.format, musique: f.musique, interieurs: f.interieurs, ambiance: f.ambiance });
const reglagesVisite = (v: OptionsVisite): ReglagesVisite => ({ interieurs: v.interieurs, resolution: v.resolution, ambiance: v.ambiance });

/**
 * VIS-14 (I1 e) — vues de départ : celles du brief projet si l'utilisateur en a ENREGISTRÉ (et qu'elles sont
 * produisibles), sinon UNE vue (3/4 gauche) comme avant le chantier. Le pack plaquette reste à un clic.
 */
function vuesInitiales(conversationId: string): VueImage[] {
  let duBrief: readonly VueImage[] = [];
  try { duBrief = champsBriefDeLaConversation(conversationId)?.brief.rendu.vues ?? []; } catch { duBrief = []; }
  const dispo = VUES_IMAGE.filter(v => duBrief.includes(v));
  return dispo.length ? dispo.slice(0, MAX_VUES_PAR_IMAGE) : [...optionsParDefaut('image').vues];
}

/** VIS-14 (I2) — ambiance du brief projet de l'étude (null : non renseignée ou nuit, non proposée pour l'image). */
function ambianceDuBrief(conversationId: string): AmbianceImage | null {
  try {
    const a = champsBriefDeLaConversation(conversationId)?.brief.rendu.ambiance ?? null;
    return a && (AMBIANCES_IMAGE as readonly string[]).includes(a) ? a as AmbianceImage : null;
  } catch { return null; }
}

const AMBIANCES: Ambiance[] = ['jour', 'fin_de_journee', 'nuit'];
/** VIS-28 — titre de l'écran quand le parcours a fixé le type. */
const TITRES_PARCOURS: Record<TypeTravail, string> = { film: 'Votre film', visite360: 'Votre visite 360°', image: 'Vos images photoréalistes' };

export function FilmVisitePanel({ draft, conversationId, assurerValidation, commande, terrainParDefaut, onValiderApercu, apercuValide, parcoursRendu }: {
  draft: JarvisDraft;
  conversationId: string;
  /** Valide la fiche si elle ne l'est pas encore (comme « Voir en 3D »). */
  assurerValidation?: () => Promise<void>;
  /** VIS-17 : étape du parcours cliquée (feuille à ouvrir, ou rendus réalisés si `feuille` est null). */
  commande?: CommandeRendu | null;
  /** VIS-17 : terrain de la 3D préparée (parcours mission), retenu pour la conversation s'il n'y en a pas. */
  terrainParDefaut?: ConfirmedTerrain & { adresse?: string | null };
  /** VIS-17 : « Valider cet aperçu » (étape 7) — envoie la validation dans la conversation. */
  onValiderApercu?: (travailId: string) => void;
  apercuValide?: string | null;
  /** VIS-28 : parcours choisi (Images, Film, Visite 360°) et étape affichée — null : écran libre (trois choix). */
  parcoursRendu?: ParcoursRendu | null;
}) {
  const [disponible, setDisponible] = useState<boolean | null>(null);
  const [travaux, setTravaux] = useState<TravailStudio[]>([]);
  const [feuille, setFeuille] = useState<TypeTravail | null>(null);
  // VIS-17 : réglages film / visite repris de la mémoire du parcours (personnalisation gardée d'une visite à l'autre).
  const [film, setFilm] = useState<OptionsFilm>(() => ({ ...optionsParDefaut('film'), ...(lireMemoireParcours(conversationId).film as Partial<OptionsFilm> | null ?? {}) }));
  const [visite, setVisite] = useState<OptionsVisite>(() => ({ ...optionsParDefaut('visite360'), ...(lireMemoireParcours(conversationId).visite as Partial<OptionsVisite> | null ?? {}) }));
  // VIS-18b : définition du film / de la visite (aperçu court basse définition ou finale) — jamais mémorisée : chaque
  // lancement la choisit (l'étape 7 ouvre la feuille en « aperçu », l'étape 8 en « finale »).
  const [definitionFV, setDefinitionFV] = useState<QualiteImage>('finale');
  const changerFilm = (maj: Partial<OptionsFilm>) => { const n = { ...film, ...maj }; setFilm(n); majMemoireParcours(conversationId, { film: reglagesFilm(n) }); };
  const changerVisite = (maj: Partial<OptionsVisite>) => { const n = { ...visite, ...maj }; setVisite(n); majMemoireParcours(conversationId, { visite: reglagesVisite(n) }); };
  const racine = useRef<HTMLElement | null>(null);
  const [image, setImage] = useState<OptionsImage>(() => ({ ...optionsParDefaut('image'), vues: vuesInitiales(conversationId), ambiance: ambianceDuBrief(conversationId) ?? 'jour' }));
  // VIS-14 (I2) : l'ambiance n'est envoyée que si l'utilisateur l'a CHOISIE ; sinon le worker applique celle du brief.
  const [ambianceChoisie, setAmbianceChoisie] = useState(false);
  const [visionneuse, setVisionneuse] = useState<{ id: string; images: { libelle: string; url: string; jpeg: string; png: string | null; vue: VueImage }[]; avertissements: string[]; resultat: ResultatImage } | null>(null);
  // 23/11 — image vue EN GRAND (plein écran, par-dessus toute la page) : index dans la visionneuse ; Échap, ← → .
  const [grand, setGrand] = useState<number | null>(null);
  useEffect(() => {
    if (grand === null) return;
    const n = visionneuse?.images.length ?? 0;
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setGrand(null);
      else if (e.key === 'ArrowRight' && n > 1) setGrand((g) => (g === null ? g : (g + 1) % n));
      else if (e.key === 'ArrowLeft' && n > 1) setGrand((g) => (g === null ? g : (g - 1 + n) % n));
    };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, [grand, visionneuse]);
  const [terrainManquant, setTerrainManquant] = useState(false);
  const [lancement, setLancement] = useState(false);
  /** VIS-28 : rendu en échec en cours de relance (identifiant). */
  const [relance, setRelance] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [annonce, setAnnonce] = useState<TravailStudio | null>(null);
  const [lecteur, setLecteur] = useState<{ id: string; url: string; poster: string | null; apercu?: boolean } | null>(null);
  const [copie, setCopie] = useState<string | null>(null);
  const suivis = useRef(new Map<string, () => void>());

  // Historique de la conversation (et détection « file pas encore installée »).
  useEffect(() => {
    let vivant = true;
    void listerTravaux(conversationId).then(r => {
      if (!vivant) return;
      setDisponible(r.disponible);
      if (r.disponible) setTravaux(r.valeur);
    }).catch(() => { if (vivant) setDisponible(true); });
    const actifs = suivis.current;
    return () => { vivant = false; actifs.forEach(arreter => arreter()); actifs.clear(); };
  }, [conversationId]);

  const recevoir = useCallback((t: TravailStudio) => {
    setTravaux(liste => {
      const avant = liste.find(x => x.id === t.id);
      if (avant && estActif(avant.statut) && t.statut === 'termine') setAnnonce(t);
      return avant ? liste.map(x => (x.id === t.id ? t : x)) : [t, ...liste];
    });
    if (!estActif(t.statut)) suivis.current.delete(t.id);
  }, []);

  // Suivi en direct de chaque travail actif.
  useEffect(() => {
    for (const t of travaux) {
      if (estActif(t.statut) && !suivis.current.has(t.id)) suivis.current.set(t.id, suivreTravail(t.id, recevoir));
    }
  }, [travaux, recevoir]);

  const ouvrirFeuille = (type: TypeTravail) => {
    // VIS-17 : parcours « mission » — le terrain de la 3D préparée vaut parcelle de la conversation.
    if (!parcelleRetenue(conversationId) && terrainParDefaut) retenirParcelle(conversationId, terrainParDefaut);
    setFeuille(type);
    setMessage('');
    setTerrainManquant(!parcelleRetenue(conversationId));
  };
  // VIS-17 : une étape du parcours ouvre la feuille voulue (aperçu rapide ou définition finale) ou montre les rendus.
  const jetonCommande = commande?.jeton ?? 0;
  const dernierJetonCommande = useRef(0);
  useEffect(() => {
    if (!commande || jetonCommande === 0 || jetonCommande === dernierJetonCommande.current) return;
    dernierJetonCommande.current = jetonCommande;
    if (commande.feuille) {
      ouvrirFeuille(commande.feuille);
      if (commande.feuille === 'image' && commande.qualite) setImage(o => ({ ...o, qualite: commande.qualite! }));
      // VIS-18b : film / visite — l'étape 7 ouvre la feuille en aperçu, l'étape 8 en finale.
      if (commande.feuille !== 'image') setDefinitionFV(commande.qualite ?? 'finale');
    } else setFeuille(null);
    racine.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jetonCommande]);
  // VIS-28 : l'écran d'une étape de rendu s'ouvre DIRECTEMENT sur la feuille du type du parcours — à l'arrivée (étape
  // courante par défaut), au clic d'une pastille de l'en-tête ou d'une étape du chat. Une fois par étape affichée
  // (fermer la feuille la laisse fermée jusqu'au prochain changement d'étape).
  const cleParcours = parcoursRendu ? `${parcoursRendu.cle}|${parcoursRendu.feuille?.feuille ?? '-'}|${parcoursRendu.feuille?.qualite ?? '-'}` : null;
  useEffect(() => {
    const f = parcoursRendu?.feuille;
    // Étape de rendu sans feuille (rendus à revoir, étape bloquée) : la feuille d'une autre étape ne reste pas ouverte.
    if (!f) { if (parcoursRendu?.cle) setFeuille(null); return; }
    ouvrirFeuille(f.feuille);
    if (f.qualite) {
      if (f.feuille === 'image') setImage(o => ({ ...o, qualite: f.qualite! }));
      else setDefinitionFV(f.qualite);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleParcours]);

  /**
   * Lancement d'un rendu (clic « Lancer » de la feuille, ou VIS-28 « Relancer » d'un rendu en échec avec ses options).
   * Aucun jeton débité : l'insertion dans studio_jobs n'appelle aucune facturation (rendus non facturés aujourd'hui).
   */
  const lancerTravail = async (type: TypeTravail, options: unknown, relanceDe?: string) => {
    if (lancement) return;
    const terrain = parcelleRetenue(conversationId);
    if (!terrain) { if (relanceDe) ouvrirFeuille(type); else setTerrainManquant(true); return; }
    setLancement(true);
    if (relanceDe) setRelance(relanceDe);
    setMessage('');
    try {
      await assurerValidation?.().catch(() => undefined);
      // Même charge Studio que « Voir en 3D » (terrain, relief connu, architecture, plans).
      const { construit } = await preparerChargeVoirEn3D(draft, conversationId, terrain);
      if (!construit.ok) { setMessage(`Le projet n’a pas pu être préparé : ${construit.erreur}.`); return; }
      const charge = avecProchaineRevision(construit.projet, conversationId);
      const travail = construireTravail(type, draft, conversationId, charge, options);
      if (!travail.ok) { setMessage(travail.erreur); return; }
      // VIS-26 lot D : même dessin que « Voir en 3D » (dernier « Reproduire en 3D »), ramené à la hauteur de la 3D préparée.
      const avecDessin = travailAvecModele(travail.valeur, modeleDeLaConversation(conversationId));
      const r = await creerTravail(avecDessin.travail);
      if (!r.disponible) { setDisponible(false); setFeuille(null); return; }
      setTravaux(liste => [r.valeur, ...liste.filter(x => x.id !== r.valeur.id)]);
      if (!relanceDe) setFeuille(null);
      if (avecDessin.note) setMessage(avecDessin.note);
    } catch (erreur) {
      setMessage(erreur instanceof Error ? erreur.message : 'Le lancement n’a pas abouti.');
    } finally {
      setLancement(false);
      setRelance(null);
    }
  };

  const lancer = async () => {
    if (!feuille || lancement) return;
    // VIS-14 (I2) : image — `ambiance` retirée si elle n'a pas été choisie (brief projet, sinon journée, côté worker).
    const optionsImage: OptionsImage = ambianceChoisie ? image : (({ ambiance: _a, ...reste }) => reste)(image);
    if (feuille === 'film') majMemoireParcours(conversationId, { film: reglagesFilm(film) });
    if (feuille === 'visite360') majMemoireParcours(conversationId, { visite: reglagesVisite(visite) });
    // VIS-18b : `qualite: "apercu"` seulement pour un aperçu (finale : options identiques à avant).
    const apercuFV = definitionFV === 'apercu' ? { qualite: 'apercu' as const } : {};
    await lancerTravail(feuille, feuille === 'film' ? { ...film, ...apercuFV } : feuille === 'image' ? optionsImage : { ...visite, ...apercuFV });
  };

  /** VIS-28 — « Relancer » : même rendu, mêmes options que le rendu en échec (un clic, pas de nouvelle feuille). */
  const relancer = (t: TravailStudio) => { void lancerTravail(t.type, t.options, t.id); };

  const annuler = async (id: string) => {
    try {
      const t = await annulerTravail(id);
      if (t) recevoir(t);
    } catch (erreur) {
      setMessage(erreur instanceof Error ? erreur.message : 'Annulation impossible.');
    }
  };

  const voirFilm = async (t: TravailStudio) => {
    const r = t.resultat as ResultatFilm | null;
    if (!r?.video_path) return;
    setMessage('');
    try {
      const [url, poster] = await Promise.all([
        urlSigneeRendu(r.video_path),
        r.poster_path ? urlSigneeRendu(r.poster_path).catch(() => null) : Promise.resolve(null),
      ]);
      setLecteur({ id: t.id, url, poster, apercu: estApercu(t) });
      setAnnonce(null);
    } catch (erreur) {
      setMessage(erreur instanceof Error ? erreur.message : 'Le film n’est pas accessible.');
    }
  };

  const voirImage = async (t: TravailStudio) => {
    const r = t.resultat as ResultatImage | null;
    if (extensionSansPhotoReelle(t)) { setMessage(photoRequiseDuResultat(t.resultat)?.texte ?? ''); return; }
    if (!r?.images?.length) return;
    setMessage('');
    try {
      const images = await Promise.all(r.images.map(async i => {
        const nom = `mimmoza-${i.vue}`;
        const [url, jpeg, png] = await Promise.all([
          urlSigneeRendu(i.jpeg_path),
          urlSigneeRendu(i.jpeg_path, 3600, `${nom}.jpg`),
          i.png_path ? urlSigneeRendu(i.png_path, 3600, `${nom}.png`).catch(() => null) : Promise.resolve(null),
        ]);
        return { libelle: i.libelle, url, jpeg, png, vue: i.vue };
      }));
      setVisionneuse({ id: t.id, images, avertissements: r.avertissements ?? [], resultat: r });
      setAnnonce(null);
    } catch (erreur) {
      setMessage(erreur instanceof Error ? erreur.message : 'L’image n’est pas accessible.');
    }
  };

  // VIS-14 (M5) : le calcul se fait sur l'état courant, l'écriture du brief (store) HORS de l'updater de setState
  // (un updater doit rester pur : React peut le rejouer en mode strict).
  const choisirVues = (vues: VueImage[]) => {
    setImage(o => ({ ...o, vues }));
    // VIS-04 : le choix des vues est enregistré dans le brief projet de l'étude (repris par le chat et les relances).
    try { champsBriefDeLaConversation(conversationId, { reglages: { vues } }); } catch { /* sans étude : choix local */ }
  };
  const basculerVue = (v: VueImage) => {
    const avec = image.vues.includes(v);
    if (avec && image.vues.length === 1) return; // au moins une vue
    if (!avec && image.vues.length >= MAX_VUES_PAR_IMAGE) return; // au plus 6 vues par image (machine de rendu)
    choisirVues(VUES_IMAGE.filter(x => (x === v ? !avec : image.vues.includes(x))));
  };
  /** VIS-14 (I1 e) — pack plaquette (produisible) en un clic, durée totale affichée avant lancement. */
  const packPlaquette = vuesPreCochees();

  const copierLien = async (visiteId: string) => {
    const lien = lienVisite(visiteId, window.location.origin);
    try {
      await navigator.clipboard.writeText(lien);
      setCopie(visiteId);
      window.setTimeout(() => setCopie(c => (c === visiteId ? null : c)), 2500);
    } catch {
      window.prompt('Copiez ce lien :', lien);
    }
  };

  const confirmerTerrain = (terrain: ConfirmedTerrain & { adresse: string | null }) => {
    retenirParcelle(conversationId, terrain);
    setTerrainManquant(!parcelleRetenue(conversationId));
  };

  const actifs = travaux.filter(t => estActif(t.statut));
  const historique = travaux.filter(t => !estActif(t.statut));
  const typeParcours = parcoursRendu?.type ?? null;
  const indispo = disponible === false;

  return (
    <section className="mzia-rendu" aria-label={typeParcours ? TITRES_PARCOURS[typeParcours] : 'Film, visite 360° ou image'} ref={racine}>
      {/* VIS-28 : avec un parcours, le type est DÉJÀ choisi (sélecteur de la carte du chat) — l'écran porte son nom, sans
          les trois cartes Film / Visite 360° / Image. */}
      <div className="mzia-rendu__entete">
        <strong>{typeParcours ? TITRES_PARCOURS[typeParcours] : 'Film, visite 360° ou image'}</strong>
        <span>{typeParcours ? 'Type choisi dans « Votre parcours » (conversation). Calculé en qualité photo, prêt à partager.' : 'Calculés en qualité photo, prêts à partager.'}</span>
      </div>

      {indispo && <p className="mzia-rendu__bientot" role="status">Films, visites 360° et images : bientôt disponible.</p>}

      {typeParcours && !feuille && parcoursRendu?.feuille && !indispo && <button type="button" className="mzia-rendu__rouvrir"
        onClick={() => ouvrirFeuille(typeParcours)}>Ouvrir les réglages — {LIBELLES_TYPE[typeParcours]}</button>}

      {!typeParcours && <div className="mzia-rendu__choix">
        <button type="button" className={feuille === 'film' ? 'is-actif' : ''} disabled={indispo || disponible === null}
          aria-pressed={feuille === 'film'} onClick={() => ouvrirFeuille('film')}>
          <Clapperboard size={22} strokeWidth={1.6} /><b>Film</b><small>Vidéo de présentation</small>
        </button>
        <button type="button" className={feuille === 'visite360' ? 'is-actif' : ''} disabled={indispo || disponible === null}
          aria-pressed={feuille === 'visite360'} onClick={() => ouvrirFeuille('visite360')}>
          <Orbit size={22} strokeWidth={1.6} /><b>Visite 360°</b><small>À parcourir dans le navigateur</small>
        </button>
        <button type="button" className={feuille === 'image' ? 'is-actif' : ''} disabled={indispo || disponible === null}
          aria-pressed={feuille === 'image'} onClick={() => ouvrirFeuille('image')}>
          <Camera size={22} strokeWidth={1.6} /><b>Image photoréaliste</b><small>Vue depuis la rue, JPEG et PNG</small>
        </button>
      </div>}

      {annonce && <div className="mzia-rendu__annonce" role="status">
        <Check size={16} /> <span>{phraseSuivi(annonce)}</span>
        {annonce.type === 'film'
          ? <button type="button" className="is-primaire" onClick={() => void voirFilm(annonce)}><Play size={14} /> Voir le film</button>
          : annonce.type === 'image'
          ? <button type="button" className="is-primaire" onClick={() => void voirImage(annonce)}><IconeImage size={14} /> Voir l’image</button>
          : annonce.resultat && <>
            <a className="mzia-rendu__bouton is-primaire" href={`/visite/${encodeURIComponent((annonce.resultat as ResultatVisite).visite_id)}`} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Ouvrir la visite</a>
            <button type="button" onClick={() => void copierLien((annonce.resultat as ResultatVisite).visite_id)}>{copie === (annonce.resultat as ResultatVisite).visite_id ? <><Check size={13} /> Copié</> : <><Copy size={13} /> Copier le lien</>}</button>
          </>}
        <button type="button" className="mzia-rendu__fermer" aria-label="Fermer la notification" onClick={() => setAnnonce(null)}><X size={14} /></button>
        {phraseElementsOmis(annonce.elements_omis) && <small className="mzia-rendu__omis">{phraseElementsOmis(annonce.elements_omis)}</small>}
      </div>}

      {feuille && <div className="mzia-rendu__feuille" role="dialog" aria-label={`Options — ${LIBELLES_TYPE[feuille]}`}>
        <div className="mzia-rendu__feuille-barre">
          <span>{feuille === 'film' ? 'Votre film' : feuille === 'image' ? 'Votre image photoréaliste' : 'Votre visite 360°'}</span>
          <button type="button" className="mzia-rendu__fermer" aria-label="Fermer" onClick={() => setFeuille(null)}><X size={14} /></button>
        </div>
        <div className="mzia-rendu__feuille-corps">
          {feuille === 'film' && <Choix titre="Durée" valeur={film.duree_s} options={[[30, '30 s'], [60, '1 min'], [90, '1 min 30']]}
            onChange={v => changerFilm({ duree_s: v })} />}
          {feuille === 'image' && (['exterieur', 'privatif', 'interieur'] as GroupeVue[]).map(groupe => (
            <fieldset key={groupe} className="mzia-rendu__groupe">
              <legend>{groupe === 'exterieur' ? `Vues · ${LIBELLES_GROUPE_VUE[groupe]} (1 à ${String(Math.min(MAX_VUES_PAR_IMAGE, VUES_IMAGE.length))})` : LIBELLES_GROUPE_VUE[groupe]}</legend>
              <div>{catalogueVues().filter(c => c.groupe === groupe).map(c => vueCochable(c)
                ? <button key={c.id} type="button" aria-pressed={image.vues.includes(c.id)} title={c.condition ? `Produite ${c.condition} ; sinon refusée avec sa raison.` : undefined}
                  className={image.vues.includes(c.id) ? 'is-actif' : ''} onClick={() => basculerVue(c.id)}>{LIBELLES_VUE[c.id]}{c.statut === 'sous_condition' ? ' · selon projet' : ''}</button>
                : <button key={c.id} type="button" disabled aria-disabled="true" title="Vue prévue, pas encore produite par la machine de rendu"
                  style={{ opacity: 0.5, cursor: 'not-allowed' }}>{c.libelle} · bientôt</button>)}</div>
            </fieldset>))}
          {feuille === 'image' && <p className="mzia-rendu__estimation">
            <button type="button" aria-pressed={packPlaquette.length === image.vues.length && packPlaquette.every(v => image.vues.includes(v))}
              onClick={() => choisirVues(packPlaquette)}>Pack plaquette</button>{' '}
            {packPlaquette.map(v => LIBELLES_VUE[v]).join(', ')} — {String(packPlaquette.length)} vue{packPlaquette.length > 1 ? 's' : ''}, durée totale {dureeEstimeeImage(packPlaquette.length, image.qualite, undefined, packPlaquette)}.
          </p>}
          {feuille === 'image'
            ? <Choix titre="Lumière" valeur={image.ambiance ?? 'jour'}
              options={AMBIANCES_IMAGE.map(a => [a, LIBELLES_AMBIANCE[a]] as [AmbianceImage, string])}
              onChange={v => {
                setAmbianceChoisie(true); setImage(o => ({ ...o, ambiance: v }));
                // VIS-17 : la lumière choisie rejoint le brief projet (étape 6 « Vues & ambiance »).
                try { champsBriefDeLaConversation(conversationId, { reglages: { ambiance: v } }); } catch { /* sans étude : choix local */ }
              }} />
            : <Choix titre="Lumière" valeur={feuille === 'film' ? film.ambiance : visite.ambiance}
              options={AMBIANCES.map(a => [a, LIBELLES_AMBIANCE[a]] as [Ambiance, string])}
              onChange={v => (feuille === 'film' ? changerFilm({ ambiance: v }) : changerVisite({ ambiance: v }))} />}
          {feuille === 'film' && <Choix titre="Format" valeur={film.format} options={[['16:9', 'Paysage'], ['9:16', 'Vertical (téléphone)']]}
            onChange={v => changerFilm({ format: v })} />}
          {feuille === 'visite360' && definitionFV === 'finale' && <Choix titre="Qualité" valeur={visite.resolution} options={[['6k', 'Haute'], ['8k', 'Très haute (plus long)']]}
            onChange={v => changerVisite({ resolution: v })} />}
          {/* VIS-18b : aperçu du film (court, basse définition, mêmes plans) / de la visite (panoramas basse définition). */}
          {feuille !== 'image' && <Choix titre="Définition" valeur={definitionFV}
            options={[['apercu', feuille === 'film' ? 'Aperçu (film court, basse définition)' : 'Aperçu (panoramas basse définition)'], ['finale', feuille === 'film' ? 'Film final' : 'Visite finale']] as [QualiteImage, string][]}
            onChange={setDefinitionFV} />}
          {feuille !== 'image' && definitionFV === 'apercu' && <p className="mzia-rendu__estimation" role="note">
            Durée estimée : {dureeEstimeeApercu(feuille)}. {feuille === 'film' ? 'Mêmes plans que le film final, 1,5 s par plan, sans musique ni format vertical' : 'Mêmes points de vue que la visite finale'} : de quoi vérifier avant le rendu final.
          </p>}
          {feuille === 'image' && <Choix titre="Définition" valeur={image.qualite}
            options={QUALITES_IMAGE.map(q => [q, LIBELLES_QUALITE_IMAGE[q]] as [QualiteImage, string])}
            onChange={v => setImage(o => ({ ...o, qualite: v }))} />}
          {feuille === 'image' && <p className="mzia-rendu__estimation" role="note">
            Durée estimée : {dureeEstimeeImage(image.vues.length, image.qualite, undefined, image.vues)}. {!ambianceChoisie && ambianceDuBrief(conversationId) ? 'Lumière du brief projet. ' : ''}{MENTION_MACHINE_RENDU} Seuls les éléments disposant d’un modèle photoréaliste figurent sur l’image ; les autres sont omis et listés.
          </p>}
          {feuille !== 'image' && <label className="mzia-rendu__case">
            <input type="checkbox" checked={feuille === 'film' ? film.interieurs : visite.interieurs}
              onChange={e => (feuille === 'film' ? changerFilm({ interieurs: e.target.checked }) : changerVisite({ interieurs: e.target.checked }))} />
            Montrer aussi l’intérieur des logements
          </label>}
          {feuille === 'film' && <label className="mzia-rendu__case">
            <input type="checkbox" checked={film.musique} onChange={e => changerFilm({ musique: e.target.checked })} />
            Ajouter une musique d’ambiance
          </label>}
          {terrainManquant && <div className="mzia-rendu__terrain">
            <p>Il manque l’emplacement du terrain.</p>
            <ConfirmerParcelle adresseInitiale={draft.localisation} libelleConfirmer="Confirmer ce terrain"
              onConfirmer={confirmerTerrain} onAnnuler={() => setFeuille(null)} />
          </div>}
          {message && <p className="mzia-rendu__erreur" role="alert">{message}</p>}
          <button type="button" className="mzia-rendu__lancer" disabled={lancement || terrainManquant} onClick={() => void lancer()}>
            {lancement ? <><Loader2 size={16} className="mzia-rendu__tourne" /> Lancement…</> : 'Lancer'}
          </button>
          <small>Vous serez prévenu ici quand ce sera prêt. Vous pouvez continuer à travailler.</small>
        </div>
      </div>}

      {!feuille && message && <p className="mzia-rendu__erreur" role="alert">{message}</p>}

      {actifs.map(t => <div key={t.id} className="mzia-rendu__suivi">
        <div className="mzia-rendu__suivi-titre"><b>{LIBELLES_TYPE[t.type]}</b><span>{libelleStatut(t.statut)}</span></div>
        <div className="mzia-rendu__barre" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={t.progression}>
          <i style={{ width: `${String(t.statut === 'en_attente' ? 3 : Math.max(3, t.progression))}%` }} className={t.statut === 'en_attente' ? 'is-attente' : ''} />
        </div>
        <p>{phraseSuivi(t)}</p>
        <button type="button" onClick={() => void annuler(t.id)}>Annuler</button>
      </div>)}

      {lecteur && <div className="mzia-rendu__lecteur">
        <video src={lecteur.url} poster={lecteur.poster ?? undefined} controls autoPlay playsInline preload="metadata" />
        <div><a className="mzia-rendu__bouton" href={lecteur.url} download target="_blank" rel="noreferrer">Télécharger</a>
          <button type="button" onClick={() => setLecteur(null)}>Fermer le lecteur</button></div>
        {/* VIS-18b : étape 7 du parcours Film — l'aperçu regardé se valide ici (message dans la conversation). */}
        {lecteur.apercu && onValiderApercu && (apercuValide === lecteur.id
          ? <p className="mzia-rendu__estimation" role="status"><Check size={13} /> Aperçu validé : passez au film final.</p>
          : <p className="mzia-rendu__estimation">C’est bon ? <button type="button" className="is-primaire" onClick={() => onValiderApercu(lecteur.id)}>Valider cet aperçu</button> — sinon, corrigez l’étape voulue (style, scénario…) et relancez un aperçu.</p>)}
      </div>}

      {visionneuse && grand !== null && visionneuse.images[grand] && createPortal(
        <div className="mzia-grand" role="dialog" aria-modal="true" aria-label="Image en grand" onClick={() => setGrand(null)}>
          <img src={visionneuse.images[grand].url} alt={`Image du projet — vue ${visionneuse.images[grand].libelle}`} onClick={(e) => e.stopPropagation()} />
          <div className="mzia-grand__barre" onClick={(e) => e.stopPropagation()}>
            {visionneuse.images.length > 1 && <button type="button" onClick={() => setGrand((grand - 1 + visionneuse.images.length) % visionneuse.images.length)}>← Précédente</button>}
            <strong>{visionneuse.images[grand].libelle}{visionneuse.images.length > 1 ? ` · ${String(grand + 1)} / ${String(visionneuse.images.length)}` : ''}</strong>
            {visionneuse.images.length > 1 && <button type="button" onClick={() => setGrand((grand + 1) % visionneuse.images.length)}>Suivante →</button>}
            <a href={visionneuse.images[grand].url} target="_blank" rel="noreferrer">Ouvrir dans un onglet</a>
            <button type="button" onClick={() => setGrand(null)}>Fermer (Échap)</button>
          </div>
        </div>, document.body)}
      {visionneuse && <div className="mzia-rendu__lecteur mzia-rendu__images">
        {visionneuse.images.map((i, n) => <figure key={i.url}>
          <button type="button" className="mzia-rendu__agrandir" onClick={() => setGrand(n)} title="Voir en grand" aria-label={`Voir en grand — vue ${i.libelle}`}>
            <img src={i.url} alt={`Image du projet — vue ${i.libelle}`} loading="lazy" />
            <span>Voir en grand</span>
          </button>
          {/* VIS-14 : badge PAR VUE et définition réellement livrée. */}
          <figcaption>{i.libelle} <BadgeRealisme resultat={visionneuse.resultat} image={visionneuse.resultat.images.find(x => x.vue === i.vue)} /><DefinitionLivree image={visionneuse.resultat.images.find(x => x.vue === i.vue)} /> — <a href={i.jpeg} download>JPEG</a>{i.png && <> · <a href={i.png} download>PNG</a></>}</figcaption>
        </figure>)}
        {/* VIS-10 : brief appliqué, vues non produites, livraison commerciale (liens signés au clic). */}
        <BlocLivraisonImage resultat={visionneuse.resultat} avecVuesNonProduites />
        {/* VIS-17 : étape 7 du parcours — l'aperçu regardé se valide ici (message dans la conversation). */}
        {visionneuse.resultat.qualite === 'apercu' && onValiderApercu && (apercuValide === visionneuse.id
          ? <p className="mzia-rendu__estimation" role="status"><Check size={13} /> Aperçu validé : passez au rendu final.</p>
          : <p className="mzia-rendu__estimation">C’est bon ? <button type="button" className="is-primaire" onClick={() => onValiderApercu(visionneuse.id)}>Valider cet aperçu</button> — sinon, corrigez l’étape voulue (style, vues…) et relancez un aperçu.</p>)}
        {visionneuse.avertissements.length > 0 && <ul className="mzia-rendu__avertissements">
          {visionneuse.avertissements.map(a => <li key={a}>{a}</li>)}
        </ul>}
        <div><button type="button" onClick={() => setVisionneuse(null)}>Fermer</button></div>
      </div>}

      {/* VIS-28 : rendus du type du parcours seulement (les autres derrière « Autres rendus (n) ») ; « Relancer » en échec. */}
      <HistoriqueRendus travaux={historique} type={typeParcours} onVoirFilm={t => void voirFilm(t)} onVoirImage={t => void voirImage(t)}
        onCopierLien={id => void copierLien(id)} copie={copie} onValiderApercu={onValiderApercu} apercuValide={apercuValide}
        onRelancer={indispo ? undefined : relancer} relance={relance} />
    </section>
  );
}

function Choix<T extends string | number>({ titre, valeur, options, onChange }: {
  titre: string; valeur: T; options: [T, string][]; onChange: (v: T) => void;
}) {
  return <fieldset className="mzia-rendu__groupe">
    <legend>{titre}</legend>
    <div>{options.map(([v, libelle]) => <button key={String(v)} type="button" aria-pressed={v === valeur}
      className={v === valeur ? 'is-actif' : ''} onClick={() => onChange(v)}>{libelle}</button>)}</div>
  </fieldset>;
}
