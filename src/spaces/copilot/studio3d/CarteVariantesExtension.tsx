// src/spaces/copilot/studio3d/CarteVariantesExtension.tsx
// =============================================================================
// LOT G7 (18/11/2026) — Carte « Variantes de votre extension » dans le fil du chat : les versions du projet (V1, V2…)
// côte à côte, avec ce qui a changé, le verdict de placement (placée / non placée) et, quand une image a été lancée pour
// la variante, sa vignette et son état (en préparation, livrable, à valider, photo nécessaire).
//
// Rien n'est calculé ici : l'historique vient du parcours (serveur), l'état des images des travaux (`studio_jobs`, RLS,
// suivi temps réel). Garde-fou X9 conservé : une image d'extension sans vraie photo n'est jamais montrée.
// =============================================================================
import { useEffect, useMemo, useState } from 'react';
import { Layers } from 'lucide-react';
import { suivreTravail, urlSigneeRendu, type TravailStudio } from '@/lib/studio/travaux';
import { fichiersResultat, SONDAGE_SUIVI_CHAT_MS } from './suiviRenduChat';
import { etatVignette, titreVariante, type VarianteChat } from './variantesChat';
import './CarteSuiviRendu.css';

const COULEURS: Record<string, { fond: string; texte: string }> = {
  livrable: { fond: '#dcfce7', texte: '#166534' },
  a_valider: { fond: '#fef3c7', texte: '#92400e' },
  photo_requise: { fond: '#fef3c7', texte: '#92400e' },
  en_cours: { fond: '#e0e7ff', texte: '#3730a3' },
  echec: { fond: '#fee2e2', texte: '#991b1b' },
  aucune: { fond: '#f1f5f9', texte: '#475569' },
  chargement: { fond: '#f1f5f9', texte: '#475569' },
};

function VignetteVariante({ v }: { v: VarianteChat }) {
  const [travail, setTravail] = useState<TravailStudio | null>(null);
  const [image, setImage] = useState<string | null>(null);
  useEffect(() => {
    setTravail(null); setImage(null);
    if (!v.jobId) return;
    return suivreTravail(v.jobId, setTravail, { sondageMs: SONDAGE_SUIVI_CHAT_MS });
  }, [v.jobId]);
  const fichiers = useMemo(() => fichiersResultat(travail), [travail]);
  useEffect(() => {
    const f0 = fichiers.find((f) => f.genre === 'image');
    if (!f0 || f0.genre !== 'image') { setImage(null); return; }
    let vivant = true;
    urlSigneeRendu(f0.chemin, 3600).then((u) => { if (vivant) setImage(u); }).catch(() => { if (vivant) setImage(null); });
    return () => { vivant = false; };
  }, [fichiers]);
  const etat = etatVignette(v.jobId, travail);
  const c = COULEURS[etat.etat] ?? COULEURS.aucune;
  return (
    <article style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 10, background: '#fff', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
        <strong style={{ fontSize: 13 }}>{titreVariante(v)}</strong>
        <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 999, background: c.fond, color: c.texte, whiteSpace: 'nowrap' }}>{etat.libelle}</span>
      </header>
      {image
        ? <a href={image} target="_blank" rel="noopener noreferrer" title={`Ouvrir l’image de la variante V${v.n}`}>
            <img src={image} alt={`Image de la variante V${v.n}`} loading="lazy" style={{ display: 'block', width: '100%', aspectRatio: '3 / 2', objectFit: 'cover', borderRadius: 6 }} />
          </a>
        : <div aria-hidden="true" style={{ width: '100%', aspectRatio: '3 / 2', borderRadius: 6, background: '#f8fafc', border: '1px dashed #cbd5e1' }} />}
      <p style={{ margin: 0, fontSize: 12, color: '#334155' }}>{v.resume}</p>
      {v.changements.length > 0 && <p style={{ margin: 0, fontSize: 12, color: '#475569' }}><strong>Changé :</strong> {v.changements.join(' ; ')}</p>}
    </article>
  );
}

export function CarteVariantesExtension({ variantes }: { variantes: readonly VarianteChat[] }) {
  if (variantes.length < 2) return null;
  return (
    <section className="mz-suivi-rendu__devis" aria-label="Variantes de votre extension">
      <p className="mz-suivi-rendu__phrase"><Layers size={14} aria-hidden="true" /> <strong>Variantes de votre extension</strong></p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
        {[...variantes].reverse().map((v) => <VignetteVariante key={v.n} v={v} />)}
      </div>
      <p className="mz-suivi-rendu__mention">Chaque variante est recalculée avec les mêmes règles ; son image garde la même photo et le même placement. Écrivez simplement ce que vous voulez changer pour en créer une autre.</p>
    </section>
  );
}
