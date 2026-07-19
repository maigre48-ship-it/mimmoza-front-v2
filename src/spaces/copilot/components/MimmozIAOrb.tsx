import { useMemo } from 'react';
import './MimmozIAOrb.css';

/** États visuels de l'orbe MimmozIA. */
export type MimmozIAOrbState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'searching'
  | 'responding'
  | 'success'
  | 'error';

/** Palette d'états — une seule couleur pilote toute l'orbe via --orb-color. */
export const ORB_COLORS: Record<MimmozIAOrbState, string> = {
  idle: '#8b5cf6',
  listening: '#a855f7',
  thinking: '#3b82f6',
  searching: '#06b6d4',
  responding: '#6366f1',
  success: '#7ddc6d',
  error: '#ff6b81',
};

export interface MimmozIAOrbProps {
  state?: MimmozIAOrbState;
  /**
   * Diamètre en px. Optionnel : si omis, la taille est pilotée par le CSS
   * (--orb-size), ce qui permet à la page de faire varier la taille par état
   * et par breakpoint sans écraser le style inline.
   */
  size?: number;
  className?: string;
  /** Chemin du logo (public/). Le fichier ne change jamais. */
  logoSrc?: string;
}

/** PRNG déterministe (stable entre les rendus, pas de "jitter"). */
function rand(seed: number): number {
  const x = Math.sin(seed * 99.13) * 43758.5453;
  return x - Math.floor(x);
}

const PARTICLE_COUNT = 16;

/**
 * Orbe vivante MimmozIA — couches indépendantes, 100 % CSS/SVG.
 *
 *   OrbContainer
 *   ├── AuraLayer1 / 2 / 3
 *   ├── ParticlesLayer
 *   ├── OuterRing / InnerRing
 *   ├── WhiteDisc
 *   └── MimmozaLogo (image officielle, jamais altérée)
 *
 * Le logo/disque sont le cœur immobile ; tout gravite autour.
 * Seule --orb-color change selon l'état (transition fluide).
 * Le rayon des particules est exprimé en % de l'orbe → responsive, aucun
 * débordement même quand la page réduit l'orbe.
 */
export function MimmozIAOrb({ state = 'idle', size, className, logoSrc = '/Logo/logo_mimmoza_simple.png' }: MimmozIAOrbProps) {
  const particles = useMemo(
    () =>
      Array.from({ length: PARTICLE_COUNT }, (_, i) => {
        const psize = 2 + rand(i) * 4; // 2 → 6 px
        const orbit = 60 + rand(i + 1) * 38; // 60% → 98% (rayon = moitié)
        const dur = 9 + rand(i + 2) * 14; // 9 → 23 s
        const op = 0.28 + rand(i + 3) * 0.5; // 0.28 → 0.78
        const delay = -(rand(i + 4) * dur);
        const reverse = rand(i + 5) > 0.62;
        return { psize, orbit, dur, op, delay, reverse };
      }),
    [],
  );

  const style: React.CSSProperties = { ['--orb-color' as string]: ORB_COLORS[state] };
  if (size != null) (style as Record<string, string>)['--orb-size'] = `${size}px`;

  return (
    <div
      className={`mzia-orb${className ? ` ${className}` : ''}`}
      data-state={state}
      style={style}
      role="img"
      aria-label="MimmozIA, agent immobilier IA"
    >
      <span className="mzia-orb__aura mzia-orb__aura--3" aria-hidden />
      <span className="mzia-orb__aura mzia-orb__aura--2" aria-hidden />
      <span className="mzia-orb__aura mzia-orb__aura--1" aria-hidden />

      {/* Flux énergétique organique (derrière les anneaux, devant les auras) */}
      <span className="mzia-orb__energy-flow mzia-orb__energy-flow--1" aria-hidden />
      <span className="mzia-orb__energy-flow mzia-orb__energy-flow--2" aria-hidden />
      <span className="mzia-orb__energy-flow mzia-orb__energy-flow--3" aria-hidden />

      <span className="mzia-orb__wave mzia-orb__wave--1" aria-hidden />
      <span className="mzia-orb__wave mzia-orb__wave--2" aria-hidden />
      <span className="mzia-orb__wave mzia-orb__wave--3" aria-hidden />

      <span className="mzia-orb__particles" aria-hidden>
        {particles.map((p, i) => (
          <span
            key={i}
            className="mzia-orb__particle"
            style={{
              ['--orbit' as string]: `${p.orbit.toFixed(2)}%`,
              ['--psize' as string]: `${p.psize.toFixed(2)}px`,
              ['--pop' as string]: p.op.toFixed(2),
              ['--dur' as string]: `${p.dur.toFixed(2)}s`,
              animationDelay: `${p.delay.toFixed(2)}s`,
              animationDirection: p.reverse ? 'reverse' : 'normal',
            }}
          />
        ))}
      </span>

      <span className="mzia-orb__ring mzia-orb__ring--outer" aria-hidden />
      <span className="mzia-orb__ring mzia-orb__ring--inner" aria-hidden />

      <span className="mzia-orb__disc">
        <span className="mzia-orb__lens" aria-hidden />
        <img className="mzia-orb__logo" src={logoSrc} alt="" aria-hidden draggable={false} />
        <span className="mzia-orb__sweep" aria-hidden />
      </span>
    </div>
  );
}

export default MimmozIAOrb;