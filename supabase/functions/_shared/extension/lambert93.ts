// supabase/functions/_shared/extension/lambert93.ts
// =============================================================================
// LOT X3 (14/11/2026) — Conversion WGS 84 (RGF93 géographique) <-> Lambert-93 (EPSG:2154). Module PUR.
//
// Pourquoi : la BD TOPO est demandée en Lambert-93 (comme le Studio, src/core/voisinage/bdtopo.ts : « aucune
// conversion d'axes à deviner »), alors que le contour cadastral de la conception est en WGS 84 (lon, lat).
// Formules : projection conique conforme de Lambert à deux parallèles automécoïques (notes IGN ALG0003 / ALG0004),
// ellipsoïde IAG GRS 1980, φ0 = 46,5°, φ1 = 44°, φ2 = 49°, λ0 = 3°, X0 = 700 000 m, Y0 = 6 600 000 m.
// RGF93 et WGS 84 sont confondus à mieux qu'un mètre : aucune transformation de datum (même choix que proj4 pour
// EPSG:4326 -> EPSG:2154 sans grille).
// =============================================================================

const A = 6378137;
const F = 1 / 298.257222101;
const E2 = 2 * F - F * F;
const E = Math.sqrt(E2);
const RAD = Math.PI / 180;
const PHI0 = 46.5 * RAD;
const PHI1 = 44 * RAD;
const PHI2 = 49 * RAD;
const LAMBDA0 = 3 * RAD;
const X0 = 700000;
const Y0 = 6600000;

const m = (phi: number): number => Math.cos(phi) / Math.sqrt(1 - E2 * Math.sin(phi) ** 2);
const t = (phi: number): number => Math.tan(Math.PI / 4 - phi / 2) / ((1 - E * Math.sin(phi)) / (1 + E * Math.sin(phi))) ** (E / 2);

const N = (Math.log(m(PHI1)) - Math.log(m(PHI2))) / (Math.log(t(PHI1)) - Math.log(t(PHI2)));
const FF = m(PHI1) / (N * t(PHI1) ** N);
const RHO0 = A * FF * t(PHI0) ** N;

/** (lon, lat) en degrés → (E, N) Lambert-93 en mètres. */
export function wgs84VersLambert93(lon: number, lat: number): [number, number] {
  const rho = A * FF * t(lat * RAD) ** N;
  const theta = N * (lon * RAD - LAMBDA0);
  return [X0 + rho * Math.sin(theta), Y0 + RHO0 - rho * Math.cos(theta)];
}

/** (E, N) Lambert-93 en mètres → (lon, lat) en degrés. Latitude par itération (convergence < 1e-12 rad). */
export function lambert93VersWgs84(x: number, y: number): [number, number] {
  const dx = x - X0;
  const dy = RHO0 - (y - Y0);
  const rho = Math.sign(N) * Math.sqrt(dx * dx + dy * dy);
  const tt = (rho / (A * FF)) ** (1 / N);
  const theta = Math.atan2(dx, dy);
  const lambda = theta / N + LAMBDA0;
  let phi = Math.PI / 2 - 2 * Math.atan(tt);
  for (let i = 0; i < 20; i += 1) {
    const s = E * Math.sin(phi);
    const suivant = Math.PI / 2 - 2 * Math.atan(tt * ((1 - s) / (1 + s)) ** (E / 2));
    if (Math.abs(suivant - phi) < 1e-12) { phi = suivant; break; }
    phi = suivant;
  }
  return [lambda / RAD, phi / RAD];
}
