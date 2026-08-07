import { useEffect, useMemo, useRef, useState } from 'react';
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

/**
 * États « ponctuels » : la page les positionne souvent le temps d'un tick
 * puis repasse à idle. Sans maintien, la transition de couleur (600 ms) n'a
 * pas le temps d'aboutir et le vert/rouge n'apparaît qu'un quart de seconde.
 */
const TRANSIENT_STATES: ReadonlySet<MimmozIAOrbState> = new Set<MimmozIAOrbState>([
  'success',
  'error',
]);

/** Durée minimale d'affichage d'un état ponctuel, en ms. */
const DEFAULT_TRANSIENT_HOLD_MS = 1800;

/**
 * Candidats de logo, du plus net au plus sûr. Le premier fichier qui se
 * charge gagne ; le DERNIER de la liste doit exister dans public/.
 *   1. logo_mimmoza_simple.svg    — vectoriel, net à toute densité (à créer)
 *   2. logo_mimmoza_simple@2x.png — ≥ 2048×2048, repli Retina (à créer)
 *   3. logo_mimmoza_simple.png    — fichier historique, garantie de secours
 */
const DEFAULT_LOGO_CANDIDATES = [
  '/Logo/logo_mimmoza_simple.svg',
  '/Logo/logo_mimmoza_simple@2x.png',
  '/Logo/logo_mimmoza_simple.png',
];

/**
 * Variante 'image' — l'orbe sombre fournie en fichier.
 *
 * Cette image contient DÉJÀ la sphère, l'anneau lumineux et le logo : elle
 * remplace donc le disque de verre blanc (`__disc`) et son logo, PAS l'orbe
 * entière. Les couches animées qui l'entourent (auras, ondes, particules,
 * anneaux) sont conservées : elles ne sont pas décoratives, elles reflètent
 * l'état réel du Copilot via --orb-color — écoute, recherche, succès, erreur.
 * Les figer aurait supprimé un retour visuel fonctionnel.
 *
 * Repli sur la version claire historique si le fichier sombre est absent.
 */
const DEFAULT_ORB_IMAGE_CANDIDATES = [
  '/Orbe/orbe-mimmozia-noir.png',
  '/Orbe/orbe-mimmozia.png',
];

export interface MimmozIAOrbProps {
  state?: MimmozIAOrbState;
  /**
   * Diamètre en px. Optionnel : si omis, la taille est pilotée par le CSS
   * (--orb-size), ce qui permet à la page de faire varier la taille par état
   * et par breakpoint sans écraser le style inline.
   */
  size?: number;
  className?: string;
  /**
   * Chemin du logo (public/). Si fourni, il est essayé EN PREMIER, puis la
   * chaîne de repli par défaut prend le relais si le fichier est absent.
   */
  logoSrc?: string;
  /**
   * srcSet optionnel pour un logo bitmap, ex. :
   * "/Logo/logo_mimmoza_simple.png 1x, /Logo/logo_mimmoza_simple@2x.png 2x".
   * Inutile avec un SVG. Ignoré dès qu'un repli s'est déclenché.
   */
  logoSrcSet?: string;
  /** Maintien minimal des états success/error, en ms. 0 pour désactiver. */
  transientHoldMs?: number;
  /**
   * Cœur de l'orbe :
   *   'image' (défaut) — l'orbe sombre fournie en fichier, sphère et logo inclus ;
   *   'glass'          — le disque de verre blanc historique, construit en CSS.
   * Dans les deux cas, les couches animées d'état sont identiques.
   */
  variant?: 'image' | 'glass';
}

/** PRNG déterministe (stable entre les rendus, pas de "jitter"). */
function rand(seed: number): number {
  const x = Math.sin(seed * 99.13) * 43758.5453;
  return x - Math.floor(x);
}

const PARTICLE_COUNT = 16;

/**
 * Maintient un état ponctuel (success/error) pendant au moins `holdMs`, même
 * si le parent est déjà repassé à idle. Les états continus (thinking,
 * responding…) s'appliquent dès que le maintien est écoulé, et un nouvel
 * état ponctuel réarme le maintien.
 */
function useHeldOrbState(state: MimmozIAOrbState, holdMs: number): MimmozIAOrbState {
  const [displayed, setDisplayed] = useState<MimmozIAOrbState>(state);
  const heldUntilRef = useRef(0);

  useEffect(() => {
    if (holdMs <= 0) {
      setDisplayed(state);
      return;
    }
    const now = Date.now();
    if (TRANSIENT_STATES.has(state)) {
      heldUntilRef.current = now + holdMs;
      setDisplayed(state);
      return;
    }
    const remaining = heldUntilRef.current - now;
    if (remaining <= 0) {
      setDisplayed(state);
      return;
    }
    const timer = window.setTimeout(() => setDisplayed(state), remaining);
    return () => window.clearTimeout(timer);
  }, [state, holdMs]);

  return displayed;
}

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
 *
 * NETTETÉ : tout est vectoriel (CSS/dégradés/masques) sauf le logo. Le repli
 * de source est géré EN STATE React (jamais par mutation du DOM) : un
 * re-rendu ne peut donc pas réinitialiser la source vers un fichier absent,
 * ce qui faisait clignoter le logo pendant le streaming.
 */
export function MimmozIAOrb({
  state = 'idle',
  size,
  className,
  logoSrc,
  logoSrcSet,
  transientHoldMs = DEFAULT_TRANSIENT_HOLD_MS,
  variant = 'image',
}: MimmozIAOrbProps) {
  const displayState = useHeldOrbState(state, transientHoldMs);
  const isImageVariant = variant === 'image';

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

  /**
   * Chaîne de sources : la prop d'abord, puis les replis par défaut.
   * La chaîne par défaut dépend de la variante — orbe complète en mode 'image',
   * logo seul en mode 'glass'. Le mécanisme de repli sur erreur est le même.
   */
  const logoCandidates = useMemo(() => {
    const defaults = isImageVariant ? DEFAULT_ORB_IMAGE_CANDIDATES : DEFAULT_LOGO_CANDIDATES;
    if (!logoSrc) return defaults;
    return [logoSrc, ...defaults.filter((c) => c !== logoSrc)];
  }, [logoSrc, isImageVariant]);

  const [logoIndex, setLogoIndex] = useState(0);
  useEffect(() => {
    setLogoIndex(0);
  }, [logoCandidates]);

  const resolvedLogo = logoCandidates[Math.min(logoIndex, logoCandidates.length - 1)];
  const isLastCandidate = logoIndex >= logoCandidates.length - 1;

  const style: React.CSSProperties = { ['--orb-color' as string]: ORB_COLORS[displayState] };
  if (size != null) (style as Record<string, string>)['--orb-size'] = `${size}px`;

  return (
    <div
      className={`mzia-orb${className ? ` ${className}` : ''}`}
      data-state={displayState}
      data-variant={variant}
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
        {/* La lentille de verre (reflet spéculaire blanc) n'a pas de sens sur une
            sphère sombre déjà éclairée dans l'image : on ne la rend qu'en 'glass'. */}
        {!isImageVariant && <span className="mzia-orb__lens" aria-hidden />}
        <img
          className="mzia-orb__logo"
          src={resolvedLogo}
          srcSet={logoIndex === 0 ? logoSrcSet : undefined}
          alt=""
          aria-hidden
          draggable={false}
          decoding="async"
          onError={() => {
            if (!isLastCandidate) setLogoIndex((i) => i + 1);
          }}
        />
        <span className="mzia-orb__sweep" aria-hidden />
      </span>
    </div>
  );
}

export default MimmozIAOrb;