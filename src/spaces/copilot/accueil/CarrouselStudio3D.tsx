// Carrousel du bandeau « Mimmoza Studio · 3D » de l'accueil MimmozIA.
//
// Remplace la maquette three.js (StudioHeroBuilding3D, toujours employée par
// la vitrine /decouvrir) par 1 à 4 IMAGES FIXES rendues avec Unreal
// (MimmozIA Studio). Les images et leur manifeste vivent dans
// public/accueil/studio-3d/ — logique pure : carrouselStudio3DLogique.ts.
//
// Comportement :
//  · fondu lent entre les images, lecture automatique toutes les 6,5 s ;
//  · pause au survol, au focus clavier, onglet masqué, et sans lecture
//    automatique du tout avec `prefers-reduced-motion` ;
//  · flèches discrètes (visibles au survol / focus, toujours au doigt),
//    pagination par points, flèches ← → du clavier, glissement tactile ;
//  · dimensions fixes (le cadre ne dépend pas du chargement) ; seules l'image
//    affichée, la suivante et les images déjà vues sont montées ;
//  · 1 image : ni flèches, ni points, ni défilement ; 0 image (manifeste
//    absent) : l'ancienne illustration fixe sert de repli.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  DELAI_DEFILEMENT_MS, HAUTEUR_1X, LARGEUR_1X, URL_MANIFESTE_STUDIO_3D,
  imagesAMonter, indiceVoisin, lireManifeste, sensGlissement, sourcesImage, type ImageCarrousel,
} from './carrouselStudio3DLogique';
import './CarrouselStudio3D.css';

const IMAGE_REPLI = '/illustrations/mimmoza-studio-building.webp';

function useMouvementReduit(): boolean {
  const [reduit, setReduit] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const suivre = () => setReduit(mq.matches);
    mq.addEventListener?.('change', suivre);
    return () => mq.removeEventListener?.('change', suivre);
  }, []);
  return reduit;
}

export function CarrouselStudio3D() {
  // null = manifeste en cours de lecture (le cadre est déjà à sa taille).
  const [images, setImages] = useState<ImageCarrousel[] | null>(null);
  const [indice, setIndice] = useState(0);
  const [vues, setVues] = useState<ReadonlySet<number>>(() => new Set());
  const [survol, setSurvol] = useState(false);
  const [focus, setFocus] = useState(false);
  const [ongletMasque, setOngletMasque] = useState(false);
  const mouvementReduit = useMouvementReduit();
  const depart = useRef<{ x: number; y: number; id: number } | null>(null);

  useEffect(() => {
    let annule = false;
    fetch(URL_MANIFESTE_STUDIO_3D)
      .then(r => (r.ok ? r.json() : null))
      .then(json => { if (!annule) setImages(lireManifeste(json)); })
      .catch(() => { if (!annule) setImages([]); });
    return () => { annule = true; };
  }, []);

  useEffect(() => {
    const suivre = () => setOngletMasque(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', suivre);
    return () => document.removeEventListener('visibilitychange', suivre);
  }, []);

  const total = images?.length ?? 0;
  const aller = useCallback((cible: number) => setIndice(cible), []);
  const decaler = useCallback((delta: number) => setIndice(courant => indiceVoisin(courant, total, delta)), [total]);
  // Une image affichée reste montée : revenir dessus ne la retélécharge pas.
  useEffect(() => {
    setVues(v => (v.has(indice) ? v : new Set(v).add(indice)));
  }, [indice]);

  const lectureAuto = total > 1 && !mouvementReduit && !survol && !focus && !ongletMasque;
  useEffect(() => {
    if (!lectureAuto) return;
    const t = window.setTimeout(() => decaler(1), DELAI_DEFILEMENT_MS);
    return () => window.clearTimeout(t);
  }, [lectureAuto, indice, decaler]);

  const montees = useMemo(() => imagesAMonter(indice, total, vues), [indice, total, vues]);

  const auClavier = (e: KeyboardEvent<HTMLDivElement>) => {
    if (total < 2) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); decaler(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); decaler(-1); }
  };
  const posePointeur = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' || total < 2) return;
    depart.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const levePointeur = (e: PointerEvent<HTMLDivElement>) => {
    const d = depart.current;
    depart.current = null;
    if (!d || d.id !== e.pointerId) return;
    const sens = sensGlissement(e.clientX - d.x, e.clientY - d.y);
    if (sens !== 0) decaler(sens);
  };

  if (images !== null && total === 0) {
    return (
      <div className="mzia-c3d mzia-c3d--repli">
        <img className="mzia-c3d__repli" src={IMAGE_REPLI} alt="Immeuble contemporain en trois dimensions"
          width={LARGEUR_1X} height={HAUTEUR_1X} loading="lazy" decoding="async" />
      </div>
    );
  }

  const courante = images?.[indice] ?? null;
  return (
    <div
      className={`mzia-c3d${mouvementReduit ? ' is-reduit' : ''}${total > 1 ? ' a-plusieurs' : ''}`}
      role="region"
      aria-roledescription="carrousel"
      aria-label="Rendus réalisés avec Mimmoza Studio"
      onMouseEnter={() => setSurvol(true)}
      onMouseLeave={() => setSurvol(false)}
      onFocus={() => setFocus(true)}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false); }}
      onKeyDown={auClavier}
    >
      <div
        className="mzia-c3d__cadre"
        aria-live={lectureAuto ? 'off' : 'polite'}
        onPointerDown={posePointeur}
        onPointerUp={levePointeur}
        onPointerCancel={() => { depart.current = null; }}
      >
        {images?.map((image, i) => {
          const s = sourcesImage(image);
          const active = i === indice;
          return (
            <figure
              key={image.fichier}
              className={`mzia-c3d__diapo${active ? ' is-active' : ''}`}
              role="group"
              aria-roledescription="diapositive"
              aria-label={`${i + 1} sur ${total}${image.titre ? ` : ${image.titre}` : ''}`}
              aria-hidden={!active}
            >
              {montees.has(i) && (
                <picture>
                  <source type="image/avif" srcSet={s.avif} />
                  <source type="image/webp" srcSet={s.webp} />
                  <img src={s.src} srcSet={s.jpeg} alt={image.alt} width={LARGEUR_1X} height={HAUTEUR_1X}
                    loading="lazy" decoding="async" draggable={false} />
                </picture>
              )}
              {image.demo && <span className="mzia-c3d__demo">Image de démonstration</span>}
            </figure>
          );
        })}
      </div>

      {courante?.titre && <p className="mzia-c3d__legende" aria-hidden="true">{courante.titre}</p>}

      {total > 1 && (
        <div className="mzia-c3d__commandes">
          <button type="button" className="mzia-c3d__fleche" onClick={() => decaler(-1)} aria-label="Image précédente">
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <div className="mzia-c3d__points">
            {images!.map((image, i) => (
              <button
                key={image.fichier}
                type="button"
                className="mzia-c3d__point"
                aria-label={`Afficher l’image ${i + 1}${image.titre ? ` : ${image.titre}` : ''}`}
                aria-current={i === indice ? 'true' : undefined}
                onClick={() => aller(i)}
              >
                <span className={i === indice && lectureAuto ? 'is-en-cours' : undefined}
                  style={i === indice && lectureAuto ? { animationDuration: `${DELAI_DEFILEMENT_MS}ms` } : undefined} />
              </button>
            ))}
          </div>
          <button type="button" className="mzia-c3d__fleche" onClick={() => decaler(1)} aria-label="Image suivante">
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
