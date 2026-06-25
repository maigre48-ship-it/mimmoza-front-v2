// src/components/backgrounds/AnimatedWaveBackground.tsx
// Fond image statique (vagues animees retirees).

const BG_IMAGE = "/illustrations/vagues_intro.png";

export default function AnimatedWaveBackground() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        overflow: "hidden",
        backgroundImage: `url(${BG_IMAGE})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }}
    />
  );
}