// src/spaces/copilot/studio3d/BlocLivraisonImage.tsx
// =============================================================================
// VIS-10 (19/11/2026) — résultats enrichis d'une IMAGE du projet (carte de suivi du chat, Dossier 3D) :
//   · badge « Photoréaliste » / « Étude » / « Réalisme non vérifié » (resultat.niveau_realisme, lot R2) ;
//   · brief du projet : ce qui a été appliqué / non appliqué (resultat.rendu_mimmoza : saison, heure, vues…) ;
//   · vues non produites avec leur raison (facultatif : la carte du chat les affiche déjà) ;
//   · livraison commerciale (resultat.livraison_commerciale, VIS-07) : ZIP, liens par vue et par format, plan de vente.
// Les URL signées expirent après 1 h : AUCUN lien n'est stocké ; chaque clic signe le fichier (urlSigneeRendu, avec
// nom de téléchargement) puis le télécharge. Logique pure : src/lib/studio/livraisonCommerciale.ts.
// =============================================================================
import { useState } from 'react';
import { Download, FileText, Package } from 'lucide-react';
import { phrasesVuesNonProduites, urlSigneeRendu, type ImageLivree, type ResultatImage } from '@/lib/studio/travaux';
import { badgeRealisme, nomTelechargement, RAPPEL_SANS_MENTION } from '@/lib/studio/livraisonCommerciale';
import './CarteSuiviRendu.css';

/**
 * Badge du niveau de réalisme (réutilisé sous chaque image). VIS-14 (I5) : `image` donnée et porteuse de son niveau →
 * badge PAR VUE (une vue intérieure n'est pas jugée sur la rue ni le voisinage) ; sinon niveau de l'image entière.
 */
export function BadgeRealisme({ resultat, image }: {
  resultat: Pick<ResultatImage, 'niveau_realisme' | 'manques_realisme'> | null | undefined;
  image?: Pick<ImageLivree, 'niveau_realisme' | 'manques_realisme'> | null;
}) {
  const parVue = image?.niveau_realisme ? image : null;
  const b = badgeRealisme(parVue?.niveau_realisme ?? resultat?.niveau_realisme ?? null, (parVue ? parVue.manques_realisme : resultat?.manques_realisme) ?? []);
  return <span className={`mz-livraison__badge is-${b.ton}`} title={b.detail ?? undefined}>{b.libelle}</span>;
}

/** VIS-14 — image du résultat d'après son libellé (cartes qui n'ont gardé que libellé + URL). */
export function imageDuLibelle(resultat: Pick<ResultatImage, 'images'> | null | undefined, libelle: string): ImageLivree | null {
  return resultat?.images?.find(i => i.libelle === libelle) ?? null;
}

/** VIS-14 (I1 a) — définition RÉELLEMENT livrée (« 2880 × 1620 px »), lue dans le résultat ; rien si inconnue. */
export function DefinitionLivree({ image }: { image: Pick<ImageLivree, 'largeur' | 'hauteur'> | null | undefined }) {
  if (!image?.largeur || !image.hauteur) return null;
  return <span className="mz-suivi-rendu__detail"> · {String(image.largeur)} × {String(image.hauteur)} px</span>;
}

export function BlocLivraisonImage({ resultat, avecVuesNonProduites = false }: { resultat: ResultatImage | null | undefined; avecVuesNonProduites?: boolean }) {
  const [enCours, setEnCours] = useState<string | null>(null);
  const [erreur, setErreur] = useState('');
  if (!resultat) return null;
  const badge = badgeRealisme(resultat.niveau_realisme ?? null, resultat.manques_realisme ?? []);
  const brief = resultat.rendu_mimmoza ?? null;
  const lv = resultat.livraison_commerciale ?? null;
  const nonProduites = avecVuesNonProduites ? phrasesVuesNonProduites(resultat) : [];

  /** Signe le fichier AU CLIC (lien valable 1 h) puis le télécharge ; jamais de lien mort conservé. */
  const telecharger = async (chemin: string) => {
    setErreur('');
    setEnCours(chemin);
    try {
      const url = await urlSigneeRendu(chemin, 3600, nomTelechargement(chemin));
      window.location.assign(url);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Le fichier n’est pas accessible pour l’instant. Réessayez dans un instant.');
    } finally {
      setEnCours(c => (c === chemin ? null : c));
    }
  };
  const bouton = (chemin: string, libelle: string, titre?: string, principal = false) => (
    <button key={chemin} type="button" className={`mz-livraison__lien${principal ? ' is-principal' : ''}`} title={titre}
      disabled={enCours === chemin} onClick={() => void telecharger(chemin)}>
      {enCours === chemin ? 'Préparation…' : libelle}
    </button>
  );

  return (
    <div className="mz-livraison" aria-label="Résultat de l’image">
      <p className="mz-livraison__ligne">
        <span className={`mz-livraison__badge is-${badge.ton}`}>{badge.libelle}</span>
        {badge.detail && <span className="mz-suivi-rendu__detail">{badge.detail}</span>}
      </p>

      {brief && (brief.appliques.length > 0 || brief.nonAppliques.length > 0) && <div className="mz-livraison__brief">
        <strong>Brief du projet</strong>
        {brief.appliques.length > 0 && <p className="mz-suivi-rendu__detail">Appliqué : {brief.appliques.join(' ; ')}.</p>}
        {brief.nonAppliques.length > 0 && <ul className="mz-suivi-rendu__avertissements" aria-label="Non appliqué du brief">
          {brief.nonAppliques.map(n => <li key={n}>Non appliqué — {n}</li>)}
        </ul>}
      </div>}

      {/* VIS-14 (M3/M4) : livraison commerciale demandée mais non produite — la raison de la machine de rendu. */}
      {!lv && resultat.livraison_non_produite && <p className="mz-suivi-rendu__detail">Livraison commerciale non produite : {resultat.livraison_non_produite.replace(/\.$/, '')}.</p>}

      {nonProduites.length > 0 && <ul className="mz-suivi-rendu__avertissements" aria-label="Vues non produites">{nonProduites.map(a => <li key={a}>{a}</li>)}</ul>}

      {lv && <div className="mz-livraison__paquet">
        <p className="mz-livraison__ligne"><Package size={14} aria-hidden="true" /> <strong>Livraison commerciale</strong></p>
        {lv.zips.length > 0 && <div className="mz-livraison__liens">
          {lv.zips.map(z => bouton(z.chemin,
            lv.zips.length > 1 ? `Paquet ZIP — ${z.vues.join(', ') || 'vue'}` : 'Télécharger le paquet (ZIP)',
            z.tailleMo !== null ? `${String(z.tailleMo).replace('.', ',')} Mo` : undefined, true))}
        </div>}
        {lv.vues.map(v => <div key={v.vue} className="mz-livraison__vue">
          <span className="mz-livraison__vue-titre">{v.libelle}{v.centrage === 'image' ? ' · recadrage centré sur l’image' : ''}</span>
          <div className="mz-livraison__liens">
            {v.formats.map(f => bouton(f.chemin,
              `${f.libelle}${f.agrandi ? ' · agrandi' : ''}`,
              [f.largeur && f.hauteur ? `${String(f.largeur)} × ${String(f.hauteur)} px` : null, ...f.avertissements].filter(Boolean).join('\n') || undefined))}
          </div>
        </div>)}
        {lv.planVente?.present && <div className="mz-livraison__vue">
          <span className="mz-livraison__vue-titre"><FileText size={13} aria-hidden="true" /> Plan de vente — lot {lv.planVente.lot}{lv.planVente.typologie ? ` (${lv.planVente.typologie})` : ''}{lv.planVente.echelle ? ` · ${lv.planVente.echelle}` : ''}</span>
          <div className="mz-livraison__liens">
            {bouton(lv.planVente.pdf, 'PDF')}
            {lv.planVente.png && bouton(lv.planVente.png, 'PNG')}
          </div>
          {lv.planVente.surfaceIndicative && <p className="mz-suivi-rendu__detail">Surfaces indicatives (surface habitable légale non fournie, cloisons non déduites).</p>}
          {lv.planVente.avertissements.length > 0 && <ul className="mz-suivi-rendu__avertissements">{lv.planVente.avertissements.map(a => <li key={a}>{a}</li>)}</ul>}
        </div>}
        {lv.planVente && !lv.planVente.present && <p className="mz-suivi-rendu__detail">Plan de vente non produit : {lv.planVente.raison.replace(/\.$/, '')}.</p>}
        {lv.mention && <p className="mz-suivi-rendu__mention">Mention incrustée : « {lv.mention} »{lv.credit ? ` · ${lv.credit}` : ''}</p>}
        {lv.sansMentionDansZip && <p className="mz-suivi-rendu__alerte">{RAPPEL_SANS_MENTION}</p>}
        {lv.avertissements.length > 0 && <details className="mz-livraison__details">
          <summary>Avertissements de la livraison ({lv.avertissements.length})</summary>
          <ul className="mz-suivi-rendu__avertissements">{lv.avertissements.map(a => <li key={a}>{a}</li>)}</ul>
        </details>}
        <p className="mz-suivi-rendu__detail"><Download size={12} aria-hidden="true" /> Chaque lien est préparé au clic (valable 1 heure).</p>
      </div>}
      {erreur && <p className="mz-suivi-rendu__alerte" role="alert">{erreur}</p>}
    </div>
  );
}
