// src/spaces/copilot/studio3d/VignetteTravee.tsx
// LOT BRIEF-CRÉATIF — Vignette d'une option : trois travées de façade en élévation, dessinées aux
// dimensions et dans la teinte des matériaux du Studio (logique : briefCreatif.ts::dessinTravee).
import { useId } from 'react';
import { dessinTravee, type ChoixBrief } from './briefCreatif';

export function VignetteTravee({ choix, titre, className }: { choix: ChoixBrief; titre?: string; className?: string }) {
  const d = dessinTravee(choix);
  const id = useId().replace(/:/g, '');
  const motif = d.motif ? `url(#mz-motif-${id})` : null;
  const corps = d.rects[1];
  return (
    <svg className={className} viewBox={`-0.6 -0.2 ${d.largeur + 1.2} ${d.hauteur}`} role={titre ? 'img' : undefined} aria-hidden={titre ? undefined : true} aria-label={titre} preserveAspectRatio="xMidYMax meet">
      {d.motif && (
        <defs>
          {d.motif === 'brique' && <pattern id={`mz-motif-${id}`} width="0.9" height="0.3" patternUnits="userSpaceOnUse">
            <path d="M0 0.3H0.9M0.45 0V0.15M0 0.15H0.9M0 0.15V0.3" stroke="#ffffff" strokeOpacity="0.28" strokeWidth="0.035" fill="none" />
          </pattern>}
          {d.motif === 'bois' && <pattern id={`mz-motif-${id}`} width="1" height="0.19" patternUnits="userSpaceOnUse">
            <path d="M0 0.19H1" stroke="#2b1a0b" strokeOpacity="0.35" strokeWidth="0.03" />
          </pattern>}
          {d.motif === 'pierre' && <pattern id={`mz-motif-${id}`} width="1.2" height="0.6" patternUnits="userSpaceOnUse">
            <path d="M0 0.6H1.2M0.6 0V0.6" stroke="#6b6250" strokeOpacity="0.22" strokeWidth="0.03" fill="none" />
          </pattern>}
        </defs>
      )}
      {d.rects.map((r, i) => (
        <g key={i}>
          <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={r.fill} fillOpacity={r.opacite ?? 1} stroke={r.trait ?? 'none'} strokeWidth={r.trait ? 0.04 : 0} />
          {/* Motif de la matière sur les volumes (corps et attique) seulement. */}
          {motif && r.fill === corps.fill && r.w > 4 && <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={motif} />}
        </g>
      ))}
    </svg>
  );
}
