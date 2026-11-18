// src/spaces/copilot/studio3d/CartePlansExtension.tsx
// =============================================================================
// LOT G4 (17/11/2026) — Carte « Plans de votre extension » dans le fil du chat, sous l'image (ou sous la demande de
// photo quand l'image attend une vraie photo : les plans, eux, ne dépendent pas de la photo).
//
// Affiche l'aperçu de la 1re planche, propose le PDF (planches à imprimer) et les DXF (pour l'architecte), et
// « Modifier dans le Studio ». Rien n'est calculé ici : le bloc `resultat.extension.plans` de la machine de rendu
// est relu par plansExtension.ts, qui refuse des plans absents ou d'un autre modèle que l'image. Liens signés 1 h.
// =============================================================================
import { useEffect, useMemo, useState } from 'react';
import { Download, FileText, PenLine } from 'lucide-react';
import { urlSigneeRendu, type TravailStudio } from '@/lib/studio/travaux';
import { EVENEMENT_OUVRIR_PLANS_STUDIO, lignesPlanches, NOMS_TELECHARGEMENT, NOMS_TELECHARGEMENT_MAISON, plansDuTravail, TITRE_PLANS as TITRE_PLANS_EXTENSION, TITRE_PLANS_MAISON } from '@/lib/studio/plansExtension';
import './CarteSuiviRendu.css';

export function CartePlansExtension({ travail }: { travail: TravailStudio }) {
  // LOT G10b — maison neuve : même carte, bloc `resultat.maison.plans`.
  const lu = useMemo(() => plansDuTravail({ resultat_extension: travail.resultat_extension, resultat_maison: travail.resultat_maison }), [travail.resultat_extension, travail.resultat_maison]);
  const vue = lu?.vue ?? null;
  const TITRE_PLANS = lu?.genre === 'maison' ? TITRE_PLANS_MAISON : TITRE_PLANS_EXTENSION;
  const NOMS = lu?.genre === 'maison' ? NOMS_TELECHARGEMENT_MAISON : NOMS_TELECHARGEMENT;
  const [apercu, setApercu] = useState<string | null>(null);
  const [liens, setLiens] = useState<{ pdf: string; dxf: string | null } | null>(null);
  const [erreur, setErreur] = useState('');
  const [signature, setSignature] = useState(0);

  useEffect(() => {
    setApercu(null); setLiens(null); setErreur('');
    if (!vue || vue.etat !== 'disponibles') return;
    let vivant = true;
    Promise.all([
      urlSigneeRendu(vue.pdfPath, 3600, NOMS.pdf),
      vue.dxfPath ? urlSigneeRendu(vue.dxfPath, 3600, NOMS.dxf).catch(() => null) : Promise.resolve(null),
      vue.apercuPath ? urlSigneeRendu(vue.apercuPath, 3600).catch(() => null) : Promise.resolve(null),
    ]).then(([pdf, dxf, ap]) => { if (vivant) { setLiens({ pdf, dxf }); setApercu(ap); } })
      .catch(e => { if (vivant) setErreur(e instanceof Error ? e.message : 'Les plans ne sont pas accessibles pour l’instant.'); });
    return () => { vivant = false; };
  }, [vue, signature]);

  if (!vue) return null;
  if (vue.etat === 'indisponibles') {
    return <p className="mz-suivi-rendu__detail" role="note"><strong>{TITRE_PLANS} :</strong> {vue.raison}</p>;
  }
  const resigner = () => setSignature(n => (n < 1 ? n + 1 : n));
  return (
    <section className="mz-suivi-rendu__devis" aria-label={TITRE_PLANS}>
      <p className="mz-suivi-rendu__phrase"><FileText size={14} aria-hidden="true" /> <strong>{TITRE_PLANS}</strong></p>
      {apercu && liens && <a href={liens.pdf} target="_blank" rel="noopener noreferrer" title="Ouvrir les plans (PDF)">
        <img src={apercu} alt="Aperçu de la première planche (plan de masse)" loading="lazy" onError={resigner}
          style={{ display: 'block', maxWidth: '100%', border: '1px solid #e2e8f0', borderRadius: 6, background: '#fff' }} />
      </a>}
      {apercu && <p className="mz-suivi-rendu__mention">Aperçu simplifié : le PDF fait foi.</p>}
      <ul>{lignesPlanches(vue).map(l => <li key={l}>{l}</li>)}</ul>
      <div className="mz-suivi-rendu__actions">
        {liens && <a className="mz-suivi-rendu__bouton" href={liens.pdf} target="_blank" rel="noopener noreferrer" download={NOMS.pdf}>
          <Download size={14} aria-hidden="true" /> Télécharger les plans (PDF)
        </a>}
        {liens?.dxf && <a className="mz-suivi-rendu__bouton is-leger" href={liens.dxf} download={NOMS.dxf}>
          <Download size={14} aria-hidden="true" /> Fichiers DXF pour l’architecte
        </a>}
        <button type="button" className="mz-suivi-rendu__bouton is-leger" onClick={() => window.dispatchEvent(new CustomEvent(EVENEMENT_OUVRIR_PLANS_STUDIO, { detail: { jobId: travail.id } }))}>
          <PenLine size={14} aria-hidden="true" /> Modifier dans le Studio
        </button>
      </div>
      {!liens && !erreur && <p className="mz-suivi-rendu__detail">Préparation des liens…</p>}
      {erreur && <p className="mz-suivi-rendu__alerte" role="alert">{erreur}</p>}
      {vue.statuts.length > 0 && <details>
        <summary className="mz-suivi-rendu__detail">Origine des cotes</summary>
        <ul>{vue.statuts.map(s => <li key={s}>{s}</li>)}</ul>
      </details>}
      <p className="mz-suivi-rendu__detail">Même modèle que l’image (référence {vue.modele}, imprimée sur chaque planche).</p>
      <p className="mz-suivi-rendu__mention">{vue.mention} {vue.cout}</p>
    </section>
  );
}
