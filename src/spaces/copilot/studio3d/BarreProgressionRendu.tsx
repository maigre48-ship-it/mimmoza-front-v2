// src/spaces/copilot/studio3d/BarreProgressionRendu.tsx
// =============================================================================
// VIS-57 — barre de progression d'un rendu (carte du chat, suivi du parcours / Dossier 3D) : étape en clair,
// pourcentage écrit par la machine de rendu, temps restant ESTIMÉ (progressionRendu.ts). Mise à jour en direct par
// l'abonnement / le sondage existants (suivreTravail) : ce composant ne lit rien, il affiche la ligne reçue.
// =============================================================================
import { vueProgression, type TravailProgression } from '@/lib/studio/progressionRendu';
import './BarreProgressionRendu.css';

export function BarreProgressionRendu({ travail, maintenant }: { travail: TravailProgression | null; maintenant: number }) {
  const v = vueProgression(travail, maintenant);
  if (!v.visible) return null;
  return (
    <div className="mz-barre-rendu">
      <div className="mz-barre-rendu__ligne">
        <span className="mz-barre-rendu__etape">{v.etape}</span>
        <strong className="mz-barre-rendu__pourcent">{v.pourcentage === null ? 'En attente' : `${v.pourcentage} %`}</strong>
      </div>
      <div className="mz-barre-rendu__piste" role="progressbar" aria-label="Progression du rendu" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={v.pourcentage ?? undefined} aria-valuetext={v.texte}>
        <i className={v.pourcentage === null ? 'is-attente' : ''} style={{ width: `${v.pourcentage === null ? 3 : Math.max(3, v.pourcentage)}%` }} />
      </div>
      {v.reste && <small className="mz-barre-rendu__reste">{v.reste}</small>}
    </div>
  );
}
