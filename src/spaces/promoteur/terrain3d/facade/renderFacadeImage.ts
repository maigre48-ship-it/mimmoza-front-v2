// src/spaces/promoteur/terrain3d/facade/renderFacadeImage.ts

import type { FacadeRenderOptions } from "./facadeRenderer.types";
import { resolveFacadeRenderOptions } from "./facadeRenderPresets";

export interface RenderFacadeImageInput {
  svg: string;
  options?: FacadeRenderOptions;
}

export interface RenderFacadeImageResult {
  dataUrl: string;
  blob: Blob;
  width: number;
  height: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function createSvgBlobUrl(svg: string): string {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  return URL.createObjectURL(blob);
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = "async";

  const done = new Promise<HTMLImageElement>((resolve, reject) => {
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Impossible de charger l'image: ${src}`));
  });

  img.src = src;
  return done;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function applySoftVignette(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
) {
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.max(width, height) * 0.72;

  const grad = ctx.createRadialGradient(cx, cy, r * 0.35, cx, cy, r);
  grad.addColorStop(0, "rgba(255,255,255,0)");
  grad.addColorStop(1, "rgba(120,100,70,0.08)");

  ctx.save();
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function applyPaperTexture(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  opacity: number,
  fiberDensity: number
) {
  const count = Math.round(width * height * 0.00004 * clamp(fiberDensity, 0.05, 1));

  ctx.save();
  ctx.globalAlpha = clamp(opacity, 0, 1);

  for (let i = 0; i < count; i += 1) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const w = 4 + Math.random() * 22;
    const h = 1 + Math.random() * 3;
    const a = 0.015 + Math.random() * 0.05;

    ctx.fillStyle = `rgba(120,100,80,${a})`;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((Math.random() - 0.5) * 0.8);
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  for (let i = 0; i < count * 0.18; i += 1) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const r = 6 + Math.random() * 28;
    const a = 0.012 + Math.random() * 0.03;

    ctx.beginPath();
    ctx.fillStyle = `rgba(160,145,120,${a})`;
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawSky(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  skyTop: string,
  skyBottom: string
) {
  const grad = ctx.createLinearGradient(0, 0, 0, height * 0.62);
  grad.addColorStop(0, skyTop);
  grad.addColorStop(1, skyBottom);

  ctx.save();
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height * 0.72);

  ctx.globalAlpha = 0.18;
  for (let i = 0; i < 7; i += 1) {
    const x = Math.random() * width;
    const y = 40 + Math.random() * height * 0.25;
    const rx = 80 + Math.random() * 170;
    const ry = 20 + Math.random() * 45;

    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fill();
  }

  ctx.restore();
}

function drawGround(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  groundColor: string
) {
  const groundY = height * 0.79;

  ctx.save();
  ctx.fillStyle = groundColor;
  ctx.fillRect(0, groundY, width, height - groundY);

  ctx.globalAlpha = 0.07;
  for (let i = 0; i < 12; i += 1) {
    const y = groundY + i * 12;
    ctx.fillStyle = "rgba(120,110,95,0.25)";
    ctx.fillRect(0, y, width, 1);
  }
  ctx.restore();
}

function drawSimpleTree(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  scale: number
) {
  const trunkW = 7 * scale;
  const trunkH = 38 * scale;

  ctx.save();

  ctx.fillStyle = "#927652";
  ctx.fillRect(x - trunkW / 2, baseY - trunkH, trunkW, trunkH);

  const greens = [
    "rgba(143,185,117,0.72)",
    "rgba(119,164,96,0.72)",
    "rgba(160,203,132,0.58)",
  ];

  for (let i = 0; i < 3; i += 1) {
    ctx.beginPath();
    ctx.fillStyle = greens[i];
    ctx.arc(
      x + (i - 1) * 10 * scale,
      baseY - trunkH - 18 * scale - i * 2,
      (28 - i * 3) * scale,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }

  ctx.restore();
}

function drawForegroundTrees(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  count: number
) {
  const baseY = height * 0.79;
  const safePad = width * 0.1;

  if (count <= 0) return;

  if (count === 1) {
    drawSimpleTree(ctx, safePad, baseY, 0.9);
    return;
  }

  if (count === 2) {
    drawSimpleTree(ctx, safePad, baseY, 0.9);
    drawSimpleTree(ctx, width - safePad, baseY, 0.75);
    return;
  }

  drawSimpleTree(ctx, safePad, baseY, 0.9);
  drawSimpleTree(ctx, width - safePad, baseY, 0.75);
  drawSimpleTree(ctx, width * 0.82, baseY, 0.62);
}

function getContentRect(
  canvasWidth: number,
  canvasHeight: number,
  padding: number
) {
  const x = padding;
  const y = padding;
  const w = canvasWidth - padding * 2;
  const h = canvasHeight - padding * 2;
  return { x, y, w, h };
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  frameColor: string
) {
  ctx.save();

  drawRoundedRect(ctx, x, y, w, h, 18);
  ctx.fillStyle = "rgba(255,255,255,0.62)";
  ctx.fill();

  ctx.lineWidth = 1.5;
  ctx.strokeStyle = frameColor;
  ctx.stroke();

  ctx.restore();
}

function drawFacadeShadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  opacity: number
) {
  ctx.save();
  ctx.fillStyle = `rgba(90, 80, 65, ${clamp(opacity, 0, 1)})`;
  ctx.beginPath();
  ctx.ellipse(
    x + w * 0.52,
    y + h * 0.92,
    w * 0.28,
    h * 0.045,
    0,
    0,
    Math.PI * 2
  );
  ctx.fill();
  ctx.restore();
}

export async function renderFacadeImage(
  input: RenderFacadeImageInput
): Promise<RenderFacadeImageResult> {
  const resolved = resolveFacadeRenderOptions(input.options);
  const width = Math.round(resolved.width * resolved.exportScale);
  const height = Math.round(resolved.height * resolved.exportScale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const bg = resolved.palette.paper || resolved.backgroundColor;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  if (resolved.scene.showSky) {
    drawSky(ctx, width, height, resolved.palette.skyTop, resolved.palette.skyBottom);
  }

  if (resolved.scene.showGround) {
    drawGround(ctx, width, height, resolved.palette.ground);
  }

  const inner = getContentRect(width, height, resolved.padding * resolved.exportScale);

  drawFrame(ctx, inner.x, inner.y, inner.w, inner.h, resolved.palette.frame);

  const svgUrl = createSvgBlobUrl(input.svg);

  try {
    const facadeImg = await loadImage(svgUrl);

    const facadeMaxW = inner.w * 0.88;
    const facadeMaxH = inner.h * 0.78;

    const ratio = Math.min(
      facadeMaxW / facadeImg.width,
      facadeMaxH / facadeImg.height
    );

    const drawW = facadeImg.width * ratio;
    const drawH = facadeImg.height * ratio;
    const drawX = inner.x + (inner.w - drawW) / 2;
    const drawY = inner.y + inner.h * 0.10;

    drawFacadeShadow(ctx, drawX, drawY, drawW, drawH, resolved.scene.shadowOpacity);

    if (resolved.style === "watercolor" || resolved.style === "haussmann-soft") {
      ctx.save();
      ctx.globalAlpha = 0.08;
      ctx.filter = "blur(3px)";
      ctx.drawImage(facadeImg, drawX - 2, drawY + 2, drawW, drawH);
      ctx.restore();
    }

    ctx.save();
    if (resolved.style === "brochure") {
      ctx.filter = "contrast(1.02) saturate(0.98)";
    } else if (resolved.style === "watercolor") {
      ctx.filter = "saturate(0.94) contrast(0.98)";
    } else if (resolved.style === "haussmann-soft") {
      ctx.filter = "saturate(0.92) contrast(0.99)";
    }
    ctx.drawImage(facadeImg, drawX, drawY, drawW, drawH);
    ctx.restore();

    if (resolved.scene.showTrees) {
      drawForegroundTrees(ctx, width, height, resolved.scene.treeCount);
    }

    if (resolved.paper.enabled) {
      applyPaperTexture(
        ctx,
        width,
        height,
        resolved.paper.opacity,
        resolved.paper.fiberDensity
      );
    }

    if (resolved.scene.vignette) {
      applySoftVignette(ctx, width, height);
    }

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error("Impossible de générer le PNG"));
      }, "image/png");
    });

    const dataUrl = canvas.toDataURL("image/png");

    return {
      dataUrl,
      blob,
      width,
      height,
    };
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

export async function downloadRenderedFacadePng(
  input: RenderFacadeImageInput,
  fileName = "facade-render-v1.png"
): Promise<void> {
  const result = await renderFacadeImage(input);
  const url = URL.createObjectURL(result.blob);

  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}