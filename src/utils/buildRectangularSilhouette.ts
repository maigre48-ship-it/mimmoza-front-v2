// src/utils/buildRectangularSilhouette.ts
// v2 — silhouette 2D pur, zéro indice de profondeur.
// Fond blanc, rectangle blanc, contour noir 2px, fenêtres gris très clair.
// Aucune ombre, aucun dégradé, aucun relief.

export function buildRectangularSilhouetteDataUrl(
  widthPx = 1536,
  heightPx = 1024,
  floors = 3,
  winCols = 5,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext("2d")!;

  // fond blanc pur
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, widthPx, heightPx);

  const bldLeft   = widthPx  * 0.12;
  const bldRight  = widthPx  * 0.88;
  const bldTop    = heightPx * 0.10;
  const bldBottom = heightPx * 0.82;
  const bldW = bldRight - bldLeft;
  const bldH = bldBottom - bldTop;

  // corps — blanc pur, pas de dégradé
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(bldLeft, bldTop, bldW, bldH);

  // fenêtres — gris très clair, alignement strict
  const marginH = bldW * 0.05;
  const spacing = (bldW - marginH * 2) / winCols;
  const floorH  = bldH / floors;
  const winW    = spacing * 0.70;
  const winH    = floorH  * 0.50;
  const winOffX = spacing * 0.15;
  const winOffY = floorH  * 0.25;

  ctx.fillStyle   = "#e0e8ec";
  ctx.strokeStyle = "#333333";
  ctx.lineWidth   = 1.5;

  for (let f = 0; f < floors; f++) {
    for (let c = 0; c < winCols; c++) {
      const wx = bldLeft + marginH + c * spacing + winOffX;
      const wy = bldTop  + f * floorH + winOffY;
      ctx.fillRect(wx, wy, winW, winH);
      ctx.strokeRect(wx, wy, winW, winH);
    }
  }

  // contour bâtiment — noir strict, pas d'ombre
  ctx.strokeStyle = "#000000";
  ctx.lineWidth   = 2;
  ctx.strokeRect(bldLeft, bldTop, bldW, bldH);

  // sol — ligne simple
  ctx.strokeStyle = "#aaaaaa";
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(bldLeft,  bldBottom);
  ctx.lineTo(bldRight, bldBottom);
  ctx.stroke();

  return canvas.toDataURL("image/png");
}