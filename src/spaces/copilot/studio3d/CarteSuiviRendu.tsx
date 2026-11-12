// src/spaces/copilot/studio3d/CarteSuiviRendu.tsx
// =============================================================================
// LOT E1-suivi — Carte « Rendu en cours » dans le fil du chat.
//
// Affichée sous la réponse de Mimmo qui a lancé (ou vérifié) un rendu Studio :
// elle suit le travail `studio_jobs` sous l'identité de l'utilisateur (RLS,
// temps réel + sondage toutes les 12 s via suivreTravail ; arrêt automatique à
// la fin) et, dès que le rendu est terminé, affiche directement les images, le
// film ou le lien de la visite 360° — sans que l'utilisateur ait à demander.
// Toute la logique (états, phrases, fichiers du résultat) est dans
// suiviRenduChat.ts ; les URL signées (1 h) viennent de travaux.ts, comme dans
// le Dossier 3D. Aucune clé de service côté front.
// =============================================================================
import { useEffect, useMemo, useState } from 'react';
import { Clapperboard, ExternalLink, Image as IconeImage, Loader2, Orbit } from 'lucide-react';
import { lienVisite, suivreTravail, urlSigneeRendu, type TravailStudio } from '@/lib/studio/travaux';
import { fichiersResultat, SONDAGE_SUIVI_CHAT_MS, vueCarteSuivi, type IndiceSuivi } from './suiviRenduChat';
// LOT P2 (11/11/2026) — image dans sa rue : atelier « Ajuster le placement » puis nouveau travail avec le calage.
import { AtelierPlacement } from './AtelierPlacement';
import './CarteSuiviRendu.css';

type Liens =
  | { genre: 'images'; images: { libelle: string; url: string }[] }
  | { genre: 'film'; url: string; affiche: string | null }
  | { genre: 'visite'; url: string };

/** Rafraîchissement de l'horloge (durées d'attente, signal « machine éteinte »). */
const HORLOGE_MS = 30_000;

export function CarteSuiviRendu({ indice }: { indice: IndiceSuivi }) {
  const [travail, setTravail] = useState<TravailStudio | null>(null);
  const [introuvable, setIntrouvable] = useState(false);
  const [maintenant, setMaintenant] = useState(() => Date.now());
  const [liens, setLiens] = useState<Liens | null>(null);
  const [erreurLiens, setErreurLiens] = useState('');
  // Les URL signées expirent après 1 h : une image qui ne se charge plus déclenche UNE nouvelle signature.
  const [signature, setSignature] = useState(0);

  useEffect(() => {
    setTravail(null);
    setIntrouvable(false);
    return suivreTravail(indice.jobId, setTravail, { sondageMs: SONDAGE_SUIVI_CHAT_MS, surAbsent: () => setIntrouvable(true) });
  }, [indice.jobId]);

  const vue = useMemo(() => vueCarteSuivi(travail, indice, maintenant, introuvable), [travail, indice, maintenant, introuvable]);

  useEffect(() => {
    if (!vue.actif) return;
    const h = window.setInterval(() => setMaintenant(Date.now()), HORLOGE_MS);
    return () => window.clearInterval(h);
  }, [vue.actif]);

  const fichiers = useMemo(() => fichiersResultat(travail), [travail]);
  useEffect(() => {
    if (!fichiers.length) { setLiens(null); return; }
    let vivant = true;
    setErreurLiens('');
    const preparer = async (): Promise<Liens> => {
      const f0 = fichiers[0];
      if (f0.genre === 'visite') return { genre: 'visite', url: lienVisite(f0.visiteId, window.location.origin) };
      if (f0.genre === 'video') {
        const [url, affiche] = await Promise.all([urlSigneeRendu(f0.chemin), f0.affiche ? urlSigneeRendu(f0.affiche).catch(() => null) : Promise.resolve(null)]);
        return { genre: 'film', url, affiche };
      }
      const images = await Promise.all(fichiers.flatMap(f => (f.genre === 'image'
        ? [urlSigneeRendu(f.chemin).then(url => ({ libelle: f.libelle, url })).catch(() => null)] : [])));
      const lisibles = images.filter((i): i is { libelle: string; url: string } => i !== null);
      if (!lisibles.length) throw new Error('Les images ne sont pas encore accessibles. Réessayez dans un instant.');
      return { genre: 'images', images: lisibles };
    };
    preparer().then(l => { if (vivant) setLiens(l); })
      .catch(e => { if (vivant) setErreurLiens(e instanceof Error ? e.message : 'Le résultat n’est pas accessible.'); });
    return () => { vivant = false; };
  }, [fichiers, signature]);

  // LOT P5-SITE (12/11/2026) — bâtiment existant effacé : lien signé vers l'image des zones reconstituées, si le
  // résultat en donne une (jamais d'adresse devinée).
  const zonesPath = vue.etat === 'termine' ? vue.image?.effacement?.zonesPath ?? null : null;
  const [zonesUrl, setZonesUrl] = useState<string | null>(null);
  const [zonesErreur, setZonesErreur] = useState(false);
  useEffect(() => {
    setZonesUrl(null);
    setZonesErreur(false);
    if (!zonesPath) return;
    let vivant = true;
    urlSigneeRendu(zonesPath).then(u => { if (vivant) setZonesUrl(u); }).catch(() => { if (vivant) setZonesErreur(true); });
    return () => { vivant = false; };
  }, [zonesPath, signature]);

  const resigner = () => setSignature(n => (n < 1 ? n + 1 : n));
  const Icone = travail?.type === 'film' || indice.type === 'film' ? Clapperboard : travail?.type === 'visite360' || indice.type === 'visite360' ? Orbit : IconeImage;

  return (
    <section className={`mz-suivi-rendu is-${vue.etat}`} aria-label={`Suivi du rendu : ${vue.titre}`}>
      <header className="mz-suivi-rendu__tete">
        <Icone size={16} aria-hidden="true" />
        <strong>{vue.titre}</strong>
        <span className="mz-suivi-rendu__pastille">{vue.actif && vue.etat !== 'chargement' && <Loader2 size={12} className="mz-suivi-rendu__tourne" aria-hidden="true" />}{vue.pastille}</span>
      </header>

      {(vue.etat === 'en_attente' || vue.etat === 'en_cours') && (
        <div className="mz-suivi-rendu__barre" role="progressbar" aria-label="Progression du rendu" aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={vue.progression ?? undefined} aria-valuetext={vue.progression === null ? 'En attente' : `${vue.progression} %`}>
          <i className={vue.progression === null ? 'is-attente' : ''} style={{ width: `${vue.progression === null ? 3 : Math.max(3, vue.progression)}%` }} />
        </div>
      )}

      <p className="mz-suivi-rendu__phrase" role="status" aria-live="polite">{vue.phrase}</p>
      {vue.alerte && <p className="mz-suivi-rendu__alerte">{vue.alerte}</p>}
      {vue.details.map(d => <p key={d} className="mz-suivi-rendu__detail">{d}</p>)}
      {vue.actif && vue.etat !== 'chargement' && <p className="mz-suivi-rendu__detail">Le résultat s’affichera ici dès qu’il sera prêt ; vous pouvez continuer à échanger avec Mimmo.</p>}

      {vue.etat === 'termine' && liens?.genre === 'images' && <div className="mz-suivi-rendu__images">
        {liens.images.map(i => <figure key={i.url}>
          <a href={i.url} target="_blank" rel="noopener noreferrer" title="Ouvrir l’image en grand">
            <img src={i.url} alt={`${vue.image?.titre ?? 'Image du projet'} — vue ${i.libelle}`} loading="lazy" onError={resigner} />
          </a>
          <figcaption>{i.libelle}</figcaption>
        </figure>)}
      </div>}
      {vue.etat === 'termine' && vue.image?.mention && <p className="mz-suivi-rendu__mention">{vue.image.mention}</p>}
      {vue.etat === 'termine' && vue.image?.effacement && <div className="mz-suivi-rendu__effacement" role="note">
        <p className="mz-suivi-rendu__mention"><strong>{vue.image.effacement.mention}</strong></p>
        {vue.image.effacement.masque && <p className="mz-suivi-rendu__detail">{vue.image.effacement.masque}</p>}
        {zonesUrl && <a href={zonesUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} aria-hidden="true" /> Voir les zones reconstituées</a>}
        {zonesErreur && <p className="mz-suivi-rendu__detail">L’image des zones reconstituées n’est pas accessible pour l’instant. Réessayez dans un instant.</p>}
      </div>}
      {vue.etat === 'termine' && vue.image && !vue.image.inseree && vue.image.raison && <p className="mz-suivi-rendu__detail">
        <strong>Image d’étude :</strong> {vue.image.raison}
      </p>}
      {vue.etat === 'termine' && vue.image?.inseree && vue.image.raison && <p className="mz-suivi-rendu__detail">Insertion indicative : {vue.image.raison}.</p>}
      {vue.etat === 'termine' && vue.image?.aValider && travail && <AtelierPlacement travail={travail} />}
      {vue.etat === 'termine' && liens?.genre === 'film' && <div className="mz-suivi-rendu__film">
        <video src={liens.url} poster={liens.affiche ?? undefined} controls playsInline preload="metadata" onError={resigner} />
        <a href={liens.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} aria-hidden="true" /> Ouvrir le film</a>
      </div>}
      {vue.etat === 'termine' && liens?.genre === 'visite' && <a className="mz-suivi-rendu__bouton" href={liens.url} target="_blank" rel="noopener noreferrer">
        <ExternalLink size={14} aria-hidden="true" /> Ouvrir la visite 360°
      </a>}
      {vue.etat === 'termine' && fichiers.length > 0 && !liens && !erreurLiens && <p className="mz-suivi-rendu__detail">Préparation des liens…</p>}
      {erreurLiens && <p className="mz-suivi-rendu__alerte" role="alert">{erreurLiens}</p>}
      {vue.omis && <p className="mz-suivi-rendu__detail">{vue.omis}</p>}
      {vue.avertissements.length > 0 && <ul className="mz-suivi-rendu__avertissements">{vue.avertissements.map(a => <li key={a}>{a}</li>)}</ul>}
      {vue.etat === 'termine' && liens && liens.genre !== 'visite' && <p className="mz-suivi-rendu__detail">Liens valables 1 heure ; le rendu reste disponible dans le Dossier 3D.</p>}
    </section>
  );
}
