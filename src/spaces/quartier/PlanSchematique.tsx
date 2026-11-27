// src/spaces/quartier/PlanSchematique.tsx
// =============================================================================
// VIS-70 — plan de situation dessiné (SVG), sans tuiles : utilisé quand la carte (MapLibre + orthophoto IGN) ne peut
// pas s'afficher (hors ligne, WebGL absent, tuiles refusées) et en vignette dans la carte du chat. Projet au centre,
// contour de la parcelle, isochrones simples 5 / 10 / 15 min à pied, lieux placés à leur vraie position relative.
// =============================================================================
import { DEFINITIONS_CATEGORIES, type CategorieQuartier } from '../../lib/quartier/categoriesQuartier.ts';
import { rayonIsochroneM } from '../../lib/quartier/tempsTrajet.ts';
import type { AtoutsQuartier, LieuQuartier } from '../../lib/quartier/atoutsQuartier.ts';

interface Props {
  atouts: AtoutsQuartier;
  categorie: CategorieQuartier | null;
  lieuActif?: string | null;
  onLieu?: (l: LieuQuartier) => void;
  compact?: boolean;
  /** Rayon affiché (m) ; défaut : isochrone 15 min à pied. */
  rayonM?: number;
}

export function PlanSchematique({ atouts, categorie, lieuActif, onLieu, compact = false, rayonM }: Props) {
  const T = 1000;               // côté du carré SVG
  const c = T / 2;
  const r15 = rayonIsochroneM(15, 'pied', atouts.urbain);
  const R = rayonM ?? (compact ? rayonIsochroneM(10, 'pied', atouts.urbain) * 1.25 : r15 * 1.08);
  const k = (c - (compact ? 18 : 40)) / R;
  const cosLat = Math.cos((atouts.projet.lat * Math.PI) / 180);
  const xy = (lat: number, lon: number): [number, number] => [c + (lon - atouts.projet.lon) * cosLat * 111_320 * k, c - (lat - atouts.projet.lat) * 111_320 * k];
  const lieux = atouts.categories.filter((x) => categorie === null || x.id === categorie).flatMap((x) => x.lieux)
    .filter((l) => l.lat !== null && l.lon !== null);
  const contour = atouts.projet.contour?.map(([lon, lat]) => xy(lat, lon).map((v) => v.toFixed(1)).join(',')).join(' ');
  const anneaux = [5, 10, 15].map((m) => ({ m, r: rayonIsochroneM(m, 'pied', atouts.urbain) * k }));
  return (
    <svg overflow="hidden" className={`mz-qr-plan${compact ? " is-compact" : ""}`} viewBox={`0 0 ${T} ${T}`} preserveAspectRatio={compact ? "xMidYMid slice" : "xMidYMid meet"} role="img"
      aria-label={`Plan de situation : ${atouts.projet.libelle ?? 'projet'} et ${lieux.length} lieux`}>
      <defs>
        <radialGradient id="mzqr-fond" cx="50%" cy="50%" r="70%"><stop offset="0%" stopColor="#1b2b4a" /><stop offset="100%" stopColor="#0b1324" /></radialGradient>
        <pattern id="mzqr-grille" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M50 0H0V50" fill="none" stroke="#ffffff" strokeOpacity=".05" strokeWidth="1" /></pattern>
      </defs>
      {compact && <rect width={T} height={T} fill="url(#mzqr-fond)" />}
      <rect width={T} height={T} fill="url(#mzqr-grille)" />
      {anneaux.map((a) => (
        <g key={a.m}>
          <circle cx={c} cy={c} r={a.r} fill={a.m === 5 ? '#c8a96a' : 'none'} fillOpacity={a.m === 5 ? 0.08 : 0} stroke="#c8a96a" strokeOpacity={0.55 - a.m / 50} strokeWidth={compact ? 3 : 2} strokeDasharray={a.m === 5 ? undefined : '10 10'} />
          {!compact && <text x={c} y={c - a.r - 8} textAnchor="middle" className="mz-qr-plan__anneau">{a.m} min à pied</text>}
        </g>
      ))}
      {lieux.map((l) => {
        const [x, y] = xy(l.lat!, l.lon!);
        const dedans = Math.hypot(x - c, y - c) <= c - 10;
        if (!dedans) return null;
        const actif = l.id === lieuActif;
        const coul = DEFINITIONS_CATEGORIES[l.categorie].couleur;
        return (
          <g key={l.id} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`} className={onLieu ? 'mz-qr-plan__lieu is-cliquable' : 'mz-qr-plan__lieu'}
            onClick={onLieu ? () => onLieu(l) : undefined}>
            <circle r={actif ? 17 : compact ? 22 : 11} fill={coul} stroke="#ffffff" strokeWidth={actif ? 4 : 2.5} />
            {actif && !compact && <text y={-26} textAnchor="middle" className="mz-qr-plan__etiquette">{l.nom.length > 34 ? `${l.nom.slice(0, 33)}…` : l.nom}</text>}
            <title>{`${l.nom} — ${l.sousType} · ${l.pied_min} min à pied`}</title>
          </g>
        );
      })}
      {contour
        ? <polygon points={contour} fill="#c8a96a" fillOpacity=".35" stroke="#f5e6c4" strokeWidth="3" />
        : null}
      <g transform={`translate(${c} ${c})`}>
        <circle r={compact ? 44 : 26} fill="#c8a96a" fillOpacity=".25" className="mz-qr-plan__pulse" />
        <circle r={compact ? 24 : 12} fill="#f5e6c4" stroke="#0b1324" strokeWidth="3" />
        {!compact && <text y={40} textAnchor="middle" className="mz-qr-plan__projet">{atouts.projet.libelle ?? 'Le projet'}</text>}
      </g>
      {!compact && <text x={T - 24} y={T - 22} textAnchor="end" className="mz-qr-plan__nord">N ↑ · plan schématique, bord du plan à {(R / 1000).toFixed(1).replace(".", ",")} km</text>}
    </svg>
  );
}
