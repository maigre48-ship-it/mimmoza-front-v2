// src/components/MimmozaLogo.tsx
// Composant logo Mimmoza — cube isométrique
// Usage : <MimmozaLogo /> | <MimmozaLogo variant="white" /> | <MimmozaLogo iconOnly />

interface MimmozaLogoProps {
  variant?: "dark" | "white";  // dark = sur fond clair, white = sur fond sombre
  iconOnly?: boolean;           // true = cube seul (favicon / navbar compacte)
  width?: number;
}

export function MimmozaLogo({
  variant = "dark",
  iconOnly = false,
  width,
}: MimmozaLogoProps) {
  const isWhite = variant === "white";

  const wordmarkColor   = isWhite ? "#ffffff"              : "#0f172a";
  const taglineColor    = isWhite ? "rgba(255,255,255,.6)" : "#6d28d9";

  const topStart  = isWhite ? "#c4b5fd" : "#7c3aed";
  const topEnd    = isWhite ? "#a78bfa" : "#6d28d9";
  const leftStart = isWhite ? "#818cf8" : "#4f46e5";
  const leftEnd   = isWhite ? "#6366f1" : "#3730a3";
  const rightStart = isWhite ? "#67e8f9" : "#38bdf8";
  const rightEnd   = isWhite ? "#38bdf8" : "#0ea5e9";

  const uid = isWhite ? "w" : "d";

  if (iconOnly) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 42 48"
        width={width ?? 32}
        height={width ? (width * 48) / 42 : 37}
        role="img"
        aria-label="Mimmoza"
      >
        <defs>
          <linearGradient id={`iTop-${uid}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={topStart} />
            <stop offset="100%" stopColor={topEnd} />
          </linearGradient>
          <linearGradient id={`iLeft-${uid}`} x1="100%" y1="0%" x2="0%" y2="0%">
            <stop offset="0%" stopColor={leftStart} />
            <stop offset="100%" stopColor={leftEnd} />
          </linearGradient>
          <linearGradient id={`iRight-${uid}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={rightStart} />
            <stop offset="100%" stopColor={rightEnd} />
          </linearGradient>
        </defs>
        <polygon points="21,2 39,12 21,22 3,12"  fill={`url(#iTop-${uid})`} />
        <polygon points="3,12 21,22 21,46 3,36"  fill={`url(#iLeft-${uid})`} />
        <polygon points="39,12 21,22 21,46 39,36" fill={`url(#iRight-${uid})`} />
      </svg>
    );
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 240 60"
      width={width ?? 180}
      height={width ? (width * 60) / 240 : 45}
      role="img"
      aria-label="Mimmoza — Intelligence immobilière"
    >
      <defs>
        <linearGradient id={`top-${uid}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={topStart} />
          <stop offset="100%" stopColor={topEnd} />
        </linearGradient>
        <linearGradient id={`left-${uid}`} x1="100%" y1="0%" x2="0%" y2="0%">
          <stop offset="0%" stopColor={leftStart} />
          <stop offset="100%" stopColor={leftEnd} />
        </linearGradient>
        <linearGradient id={`right-${uid}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={rightStart} />
          <stop offset="100%" stopColor={rightEnd} />
        </linearGradient>
      </defs>

      {/* Cube */}
      <polygon points="28,5 46,15 28,25 10,15"  fill={`url(#top-${uid})`} />
      <polygon points="10,15 28,25 28,47 10,37" fill={`url(#left-${uid})`} />
      <polygon points="46,15 28,25 28,47 46,37" fill={`url(#right-${uid})`} />

      {/* Wordmark */}
      <text
        x="60" y="26"
        fontFamily="-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif"
        fontWeight="700"
        fontSize="22"
        fill={wordmarkColor}
        letterSpacing="-0.7"
      >
        Mimmoza
      </text>

      {/* Tagline */}
      <text
        x="61" y="42"
        fontFamily="-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif"
        fontWeight="400"
        fontSize="10.5"
        fill={taglineColor}
        letterSpacing="1.3"
      >
        Intelligence immobilière
      </text>
    </svg>
  );
}