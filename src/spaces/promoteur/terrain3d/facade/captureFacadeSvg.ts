// src/spaces/promoteur/terrain3d/facade/captureFacadeSvg.ts

export interface CaptureFacadeSvgInput {
  svgElement: SVGSVGElement;
  width?: number;
  height?: number;
}

function ensureSvgNamespaces(svgText: string): string {
  let out = svgText;

  if (!out.includes('xmlns="http://www.w3.org/2000/svg"')) {
    out = out.replace(
      "<svg",
      '<svg xmlns="http://www.w3.org/2000/svg"'
    );
  }

  if (!out.includes('xmlns:xlink="http://www.w3.org/1999/xlink"')) {
    out = out.replace(
      "<svg",
      '<svg xmlns:xlink="http://www.w3.org/1999/xlink"'
    );
  }

  return out;
}

function resolvePositiveNumber(...values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return null;
}

export function captureFacadeSvg({
  svgElement,
  width,
  height,
}: CaptureFacadeSvgInput): string {
  const clone = svgElement.cloneNode(true) as SVGSVGElement;

  const bbox = svgElement.viewBox?.baseVal;

  const attrWidthRaw = Number(svgElement.getAttribute("width"));
  const attrHeightRaw = Number(svgElement.getAttribute("height"));

  const rect = svgElement.getBoundingClientRect();

  const renderedWidth =
    resolvePositiveNumber(
      width,
      attrWidthRaw,
      Math.round(rect.width),
    ) ?? 1200;

  const renderedHeight =
    resolvePositiveNumber(
      height,
      attrHeightRaw,
      Math.round(rect.height),
    ) ?? 800;

  clone.setAttribute("width", String(renderedWidth));
  clone.setAttribute("height", String(renderedHeight));

  if (!clone.getAttribute("viewBox")) {
    if (bbox && bbox.width > 0 && bbox.height > 0) {
      clone.setAttribute(
        "viewBox",
        `${bbox.x} ${bbox.y} ${bbox.width} ${bbox.height}`
      );
    } else {
      clone.setAttribute("viewBox", `0 0 ${renderedWidth} ${renderedHeight}`);
    }
  }

  clone.setAttribute("preserveAspectRatio", "xMidYMid meet");

  const serializer = new XMLSerializer();
  const raw = serializer.serializeToString(clone);

  return ensureSvgNamespaces(raw);
}

export function captureFacadeSvgFromSelector(
  selector: string,
  width?: number,
  height?: number
): string {
  const svgElement = document.querySelector(selector);

  if (!(svgElement instanceof SVGSVGElement)) {
    throw new Error(`Aucun SVG trouvé pour le sélecteur: ${selector}`);
  }

  return captureFacadeSvg({
    svgElement,
    width,
    height,
  });
}