// src/lib/visiteInteractive/capture.ts
// =============================================================================
// VIS-69 — Capture PNG de la vue courante (navigateur). La visionneuse three.js ne
// conserve pas son tampon d'image (preserveDrawingBuffer: false) : l'image est lue
// JUSTE APRÈS le rendu, dans le rappel `surImage`, puis composée ici avec un
// bandeau (titre, pièce, ambiance, mention légale obligatoire).
// =============================================================================

export interface LegendeCapture {
  readonly titre: string;
  readonly piece: string;
  readonly ambiance: "jour" | "nuit";
  readonly mention: string;
}

function chargerImage(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, ko) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => ko(new Error("capture illisible"));
    img.src = src;
  });
}

/** Image de la vue (data URL PNG du canevas WebGL) → PNG légendé (data URL). */
export async function composerCapture(vue: string, legende: LegendeCapture): Promise<string> {
  const img = await chargerImage(vue);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const bande = Math.round(Math.max(56, h * 0.075));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h + bande;
  const ctx = c.getContext("2d");
  if (!ctx) return vue;
  ctx.drawImage(img, 0, 0);
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, h, w, bande);
  const marge = Math.round(bande * 0.4);
  const corps = Math.round(bande * 0.3);
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#f8fafc";
  ctx.font = `600 ${corps}px Georgia, "Times New Roman", serif`;
  const gauche = `${legende.titre} — ${legende.piece}`;
  ctx.fillText(gauche.length > 90 ? `${gauche.slice(0, 88)}…` : gauche, marge, h + bande / 2);
  ctx.textAlign = "right";
  ctx.fillStyle = "#cbd5e1";
  ctx.font = `400 ${Math.round(corps * 0.78)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.fillText(`${legende.ambiance === "nuit" ? "Ambiance nuit" : "Ambiance jour"} · ${legende.mention}`, w - marge, h + bande / 2);
  return c.toDataURL("image/png");
}

/** Téléchargement d'une data URL sous un nom donné. */
export function telecharger(dataUrl: string, nom: string): void {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = nom;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
