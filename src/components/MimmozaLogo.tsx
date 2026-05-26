// src/components/MimmozaLogo.tsx
// Logo Mimmoza — M isométrique 3D + wordmark + baseline
// Usage : <MimmozaLogo /> | <MimmozaLogo variant="white" /> | <MimmozaLogo iconOnly />

interface MimmozaLogoProps {
  variant?: "dark" | "white";
  iconOnly?: boolean;
  width?: number;
}

export function MimmozaLogo({
  variant = "dark",
  iconOnly = false,
  width,
}: MimmozaLogoProps) {
  const isWhite = variant === "white";

  const uid = isWhite ? "w" : "d";

  const wordmarkColor = isWhite ? "#ffffff" : "#0f172a";
  const taglineColor = isWhite ? "rgba(255,255,255,.78)" : "#5a4fcf";
  const lineColor = isWhite ? "rgba(196,181,253,.85)" : "#5a4fcf";

  const topStart = isWhite ? "#ddd6fe" : "#c4b5fd";
  const topEnd = isWhite ? "#a78bfa" : "#8b5cf6";

  const leftStart = isWhite ? "#818cf8" : "#6d5dfc";
  const leftEnd = isWhite ? "#4f46e5" : "#4338ca";

  const rightStart = isWhite ? "#a78bfa" : "#8b5cf6";
  const rightEnd = isWhite ? "#7c3aed" : "#6d28d9";

  if (iconOnly) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 96 96"
        width={width ?? 34}
        height={width ?? 34}
        role="img"
        aria-label="Mimmoza"
      >
        <defs>
          <linearGradient id={`mTopIcon-${uid}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={topStart} />
            <stop offset="100%" stopColor={topEnd} />
          </linearGradient>

          <linearGradient id={`mLeftIcon-${uid}`} x1="100%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={leftStart} />
            <stop offset="100%" stopColor={leftEnd} />
          </linearGradient>

          <linearGradient id={`mRightIcon-${uid}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={rightStart} />
            <stop offset="100%" stopColor={rightEnd} />
          </linearGradient>
        </defs>

        {/* M isométrique sans cube supérieur */}
        <polygon points="8,28 48,8 88,28 48,48" fill={`url(#mTopIcon-${uid})`} />

        <polygon points="8,28 24,36 24,74 8,66" fill={`url(#mLeftIcon-${uid})`} />
        <polygon points="88,28 72,36 72,74 88,66" fill={`url(#mRightIcon-${uid})`} />

        <polygon points="24,36 48,48 48,64 24,52" fill={`url(#mLeftIcon-${uid})`} />
        <polygon points="72,36 48,48 48,64 72,52" fill={`url(#mRightIcon-${uid})`} />

        <polygon points="40,68 48,64 48,88 40,84" fill={`url(#mLeftIcon-${uid})`} />
        <polygon points="56,68 48,64 48,88 56,84" fill={`url(#mRightIcon-${uid})`} />
      </svg>
    );
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 360 100"
      width={width ?? 220}
      height={width ? (width * 100) / 360 : 61}
      role="img"
      aria-label="Mimmoza — Intelligence immobilière"
    >
      <defs>
        <linearGradient id={`mTop-${uid}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={topStart} />
          <stop offset="100%" stopColor={topEnd} />
        </linearGradient>

        <linearGradient id={`mLeft-${uid}`} x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={leftStart} />
          <stop offset="100%" stopColor={leftEnd} />
        </linearGradient>

        <linearGradient id={`mRight-${uid}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={rightStart} />
          <stop offset="100%" stopColor={rightEnd} />
        </linearGradient>
      </defs>

      {/* Logo M isométrique */}
      <g transform="translate(4 6)">
        <polygon points="8,28 48,8 88,28 48,48" fill={`url(#mTop-${uid})`} />

        <polygon points="8,28 24,36 24,74 8,66" fill={`url(#mLeft-${uid})`} />
        <polygon points="88,28 72,36 72,74 88,66" fill={`url(#mRight-${uid})`} />

        <polygon points="24,36 48,48 48,64 24,52" fill={`url(#mLeft-${uid})`} />
        <polygon points="72,36 48,48 48,64 72,52" fill={`url(#mRight-${uid})`} />

        <polygon points="40,68 48,64 48,88 40,84" fill={`url(#mLeft-${uid})`} />
        <polygon points="56,68 48,64 48,88 56,84" fill={`url(#mRight-${uid})`} />
      </g>

      {/* Wordmark */}
      <text
        x="115"
        y="43"
        fontFamily="-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,system-ui,sans-serif"
        fontWeight="800"
        fontSize="40"
        fill={wordmarkColor}
        letterSpacing="-2.2"
      >
        mimmoza
      </text>

      {/* Baseline line */}
      <line
        x1="117"
        y1="57"
        x2="342"
        y2="57"
        stroke={lineColor}
        strokeWidth="2.5"
        strokeLinecap="round"
      />

      {/* Tagline */}
      <text
        x="117"
        y="82"
        fontFamily="-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,system-ui,sans-serif"
        fontWeight="500"
        fontSize="21"
        fill={taglineColor}
        letterSpacing="-0.3"
      >
        Intelligence immobilière
      </text>
    </svg>
  );
}