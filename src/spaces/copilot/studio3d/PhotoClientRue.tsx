// src/spaces/copilot/studio3d/PhotoClientRue.tsx
// =============================================================================
// LOT P2 (11/11/2026) — « Votre photo du trottoir » : la photo de l'utilisateur sert de fond à l'image du projet,
// quand aucune photo de rue sous Licence Ouverte n'existe (contrat agents-1111/CONTRAT-PHOTO-RUE.md, §1).
// Voisin de PhotoTerrainImplantation.tsx (dont la photo, elle, reste sur l'appareil).
//
//   1. consignes de prise de vue (paysage, objectif ×1, toute la façade sur rue, GPS actif) ;
//   2. lecture des EXIF DANS LE NAVIGATEUR (position, direction GPSImgDirection, focale, orientation) et messages clairs ;
//   3. si l'EXIF n'a pas la position ou la direction : saisie sur le plan de la parcelle (un clic = d'où, un second = vers où) ;
//   4. consentement EXPLICITE (case à cocher) ; seulement ensuite, envoi du fichier d'ORIGINE, sans recompression,
//      vers le seau privé `studio-transfert/<uid>/<uuid>.jpg`.
// Logique pure : src/lib/studio/photoClientLogique.ts.
// =============================================================================
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Upload, X } from 'lucide-react';
import {
  CONSIGNES_PHOTO, diagnostiquerPhoto, EXIF_ABSENT, lireExifPhoto, pointDeVueATransmettre, TEXTE_CONSENTEMENT,
  type ExifPhotoClient, type SaisiePlan,
} from '@/lib/studio/photoClientLogique';
import { distanceAuContourM, type LonLat } from '@/lib/studio/couverturePhotoRue';
import { televerserPhotoClient, type PhotoClientOption } from '@/lib/studio/travaux';
import './ChoixFondImage.css';

const M_LAT = 111_132;
/** Marge du plan autour de la parcelle (m) : le trottoir d'en face doit être cliquable. */
const MARGE_PLAN_M = 45;

interface PhotoLue { fichier: File; url: string; exif: ExifPhotoClient; largeur: number | null; hauteur: number | null }

function PlanPointDeVue({ contour, exif, saisie, onSaisie }: { contour: LonLat[]; exif: ExifPhotoClient; saisie: SaisiePlan; onSaisie: (s: SaisiePlan) => void }) {
  const o = contour[0];
  const kx = 111_320 * Math.cos(o[1] * Math.PI / 180);
  const loc = (lon: number, lat: number) => ({ x: (lon - o[0]) * kx, y: (lat - o[1]) * M_LAT });
  const pts = contour.map(([lon, lat]) => loc(lon, lat));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs) - MARGE_PLAN_M, x1 = Math.max(...xs) + MARGE_PLAN_M, y0 = Math.min(...ys) - MARGE_PLAN_M, y1 = Math.max(...ys) + MARGE_PLAN_M;
  const L = 320, H = Math.max(160, Math.min(360, L * (y1 - y0) / (x1 - x0)));
  const ech = Math.min(L / (x1 - x0), H / (y1 - y0));
  const sx = (x: number) => (x - x0) * ech, sy = (y: number) => H - (y - y0) * ech;
  const position = exif.gps ?? saisie.position;
  const clic = (e: MouseEvent<SVGSVGElement>) => {
    const m = e.currentTarget.getScreenCTM()?.inverse();
    if (!m) return;
    const c = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    const x = c.x / ech + x0, y = (H - c.y) / ech + y0;
    const p = { lon: o[0] + x / kx, lat: o[1] + y / M_LAT };
    if (!exif.gps && (!saisie.position || saisie.visee || exif.capDeg !== null)) onSaisie({ position: p, visee: null });
    else onSaisie({ ...saisie, visee: p });
  };
  const P = position ? loc(position.lon, position.lat) : null;
  const V = saisie.visee ? loc(saisie.visee.lon, saisie.visee.lat) : null;
  return (
    <svg className="mz-photo-client__plan" viewBox={`0 0 ${L} ${H}`} role="img" aria-label="Plan de la parcelle : cliquez d’où la photo a été prise, puis vers où vous visiez" onClick={clic}>
      <rect x="0" y="0" width={L} height={H} fill="#f8fafc" />
      <polygon points={pts.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')} fill="#c7d2fe" stroke="#4f46e5" strokeWidth="2" />
      <text x="6" y="14" fontSize="10" fill="#475569">N ↑ · parcelle en bleu</text>
      {P && <circle cx={sx(P.x)} cy={sy(P.y)} r="6" fill="#f0527f" stroke="#fff" strokeWidth="2" />}
      {P && V && <line x1={sx(P.x)} y1={sy(P.y)} x2={sx(V.x)} y2={sy(V.y)} stroke="#f0527f" strokeWidth="2.5" markerEnd="url(#mz-fleche)" />}
      <defs><marker id="mz-fleche" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#f0527f" /></marker></defs>
    </svg>
  );
}

export function PhotoClientRue({ contour, onPret, onFermer }: { contour: LonLat[] | null; onPret: (photo: PhotoClientOption) => void; onFermer: () => void }) {
  const [photo, setPhoto] = useState<PhotoLue | null>(null);
  const [saisie, setSaisie] = useState<SaisiePlan>({ position: null, visee: null });
  const [consentement, setConsentement] = useState(false);
  const [envoi, setEnvoi] = useState<{ enCours: boolean; progres: number; erreur: string }>({ enCours: false, progres: 0, erreur: '' });
  const entree = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);
  useEffect(() => {
    const fermer = (e: KeyboardEvent) => { if (e.key === 'Escape' && !envoi.enCours) onFermer(); };
    window.addEventListener('keydown', fermer);
    return () => window.removeEventListener('keydown', fermer);
  }, [onFermer, envoi.enCours]);

  const choisir = async (fichier?: File) => {
    if (!fichier) return;
    setSaisie({ position: null, visee: null });
    setEnvoi({ enCours: false, progres: 0, erreur: '' });
    const url = URL.createObjectURL(fichier);
    // Lecture LOCALE : rien n'est envoyé à ce stade.
    let exif = EXIF_ABSENT;
    try { exif = fichier.type === 'image/jpeg' ? lireExifPhoto(await fichier.arrayBuffer()) : EXIF_ABSENT; } catch { exif = EXIF_ABSENT; }
    const dims = await new Promise<{ l: number | null; h: number | null }>((resoudre) => {
      const img = new Image();
      img.onload = () => resoudre({ l: img.naturalWidth || null, h: img.naturalHeight || null });
      img.onerror = () => resoudre({ l: null, h: null });
      img.src = url;
    });
    setPhoto({ fichier, url, exif, largeur: dims.l, hauteur: dims.h });
  };

  const diagnostic = useMemo(() => (photo ? diagnostiquerPhoto({
    type: photo.fichier.type, octets: photo.fichier.size, exif: photo.exif, largeur: photo.largeur, hauteur: photo.hauteur,
    ecartParcelleM: photo.exif.gps && contour ? distanceAuContourM([photo.exif.gps.lon, photo.exif.gps.lat], contour) : null,
  }) : []), [photo, contour]);
  const bloque = diagnostic.some((l) => l.niveau === 'bloquant');
  const pdv = photo ? pointDeVueATransmettre(photo.exif, saisie) : null;
  const aSaisir = photo && (!photo.exif.gps || photo.exif.capDeg === null);

  const envoyer = async () => {
    if (!photo || !consentement || bloque || !pdv?.pret || envoi.enCours) return;
    setEnvoi({ enCours: true, progres: 0, erreur: '' });
    try {
      const r = await televerserPhotoClient(photo.fichier, (envoye, total) => setEnvoi((e) => ({ ...e, progres: total ? Math.round(envoye / total * 100) : 0 })));
      onPret({ chemin: r.chemin, octets: r.octets, ...(pdv.point ? { point_de_vue: pdv.point } : {}) });
    } catch (e) {
      setEnvoi({ enCours: false, progres: 0, erreur: e instanceof Error ? e.message : 'La photo n’a pas pu être envoyée. Réessayez.' });
    }
  };

  return createPortal(
    <div className="mz-photo-client__fond" onMouseDown={(e) => { if (e.target === e.currentTarget && !envoi.enCours) onFermer(); }}>
      <section className="mz-photo-client" role="dialog" aria-modal="true" aria-label="Votre photo du trottoir">
        <header><h2>Votre photo du trottoir</h2><button type="button" aria-label="Fermer" onClick={onFermer} disabled={envoi.enCours}><X size={18} /></button></header>
        <p>Votre photo sert de fond à l’image du projet. Pour qu’elle soit utilisable :</p>
        <ul className="mz-photo-client__consignes">{CONSIGNES_PHOTO.map((c) => <li key={c}>{c}</li>)}</ul>
        <input ref={entree} type="file" accept="image/jpeg,image/png" capture="environment" hidden onChange={(e) => { void choisir(e.target.files?.[0]); e.target.value = ''; }} />
        <button type="button" className="mz-photo-client__bouton" onClick={() => entree.current?.click()} disabled={envoi.enCours}>
          <Camera size={15} aria-hidden="true" /> {photo ? 'Changer de photo' : 'Prendre ou choisir la photo'}
        </button>
        {photo && <>
          <img className="mz-photo-client__apercu" src={photo.url} alt="Votre photo de la rue (aperçu local, pas encore envoyée)" />
          <ul className="mz-photo-client__diagnostic">
            {diagnostic.map((l) => <li key={l.texte} className={`is-${l.niveau}`}>{l.texte}</li>)}
          </ul>
          {aSaisir && (contour
            ? <>
              <p>{!photo.exif.gps ? 'Cliquez sur le plan l’endroit d’où la photo a été prise' : 'Position lue dans la photo'}
                {photo.exif.capDeg === null ? ', puis cliquez vers où vous visiez.' : '.'}</p>
              <PlanPointDeVue contour={contour} exif={photo.exif} saisie={saisie} onSaisie={setSaisie} />
              {pdv && !pdv.pret && <p className="mz-photo-client__manque">{pdv.manque}</p>}
              {pdv?.pret && pdv.point && <p className="mz-photo-client__ok">Point de vue retenu · direction {String(pdv.point.cap_deg).replace('.', ',')}° depuis le nord.</p>}
            </>
            : <p className="mz-photo-client__manque">Le plan de la parcelle n’est pas disponible : reprenez la photo avec la localisation de l’appareil photo activée.</p>)}
          <label className="mz-photo-client__accord">
            <input type="checkbox" checked={consentement} onChange={(e) => setConsentement(e.target.checked)} disabled={envoi.enCours} />
            <span>{TEXTE_CONSENTEMENT}</span>
          </label>
          <button type="button" className="mz-photo-client__bouton is-principal" onClick={() => void envoyer()}
            disabled={!consentement || bloque || !pdv?.pret || envoi.enCours}>
            <Upload size={15} aria-hidden="true" /> {envoi.enCours ? `Envoi… ${envoi.progres} %` : 'Envoyer la photo et demander le devis'}
          </button>
          {!consentement && !bloque && <p className="mz-photo-client__note">Rien n’est envoyé tant que la case n’est pas cochée.</p>}
          {envoi.erreur && <p className="mz-photo-client__manque" role="alert">{envoi.erreur}</p>}
        </>}
      </section>
    </div>,
    document.body,
  );
}
