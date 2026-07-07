// src/components/HeroVideo.tsx
export function HeroVideo() {
  const SRC = "/videos/intro.mp4"; // ← dépose ton mp4 dans public/videos/
  const hasVideo = true;           // ← passe à false tant que le fichier n'existe pas

  return (
    <div
      style={{
        width: "100%",
        maxWidth: 1100,
        margin: "0 auto",
        aspectRatio: "16 / 9",
        borderRadius: 20,
        overflow: "hidden",
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.10)",
        boxShadow: "0 20px 60px rgba(2,6,23,0.35)",
      }}
    >
      {hasVideo ? (
        <video
          src={SRC}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          // poster="/videos/intro-poster.jpg"  // ← image affichée avant chargement (recommandé)
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "rgba(255,255,255,0.55)",
            fontSize: 14,
            letterSpacing: "0.02em",
          }}
        >
          Vidéo de présentation — à venir
        </div>
      )}
    </div>
  );
}