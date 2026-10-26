// src/pages/visite/visionneuse.ts
// =============================================================================
// Visionneuse 360° (three.js, déjà présent dans le dépôt : aucune dépendance
// ajoutée). Sphère inversée texturée par l'équirectangulaire, regard libre
// (souris, doigt, molette, pincement, clavier), gyroscope du téléphone,
// fondu enchaîné entre panoramas. Les repères cliquables sont des BOUTONS HTML
// posés par la page à partir de `projeter()` (accessibles au clavier et aux
// lecteurs d'écran) : la visionneuse ne sait rien de la visite.
//
// Orientation : nord = −Z, est = +X, haut = +Y ; le centre de l'image
// équirectangulaire est au nord (voir manifeste.ts).
// =============================================================================

import * as THREE from "three";
import { bornerInclinaison, directionVue, largeurTexture, type Vec3 } from "./manifeste";

const RAYON = 100;
const CHAMP_DEFAUT = 75;
const CHAMP_MIN = 35;
const CHAMP_MAX = 100;
/** Champ HORIZONTAL visé au repos : un téléphone en portrait voit au moins ~55° autour du regard. */
const CHAMP_HORIZONTAL_VISE = 70;
const DUREE_FONDU_MS = 550;

export interface Projection {
  readonly x: number;
  readonly y: number;
  readonly visible: boolean;
}

interface Calque {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
}

function sphere(): THREE.SphereGeometry {
  const g = new THREE.SphereGeometry(RAYON, 96, 48);
  g.scale(-1, 1, 1); // vue depuis l'intérieur
  // three place u = 0,5 de la texture sur −X ; un quart de tour l'amène au nord (−Z), u = 0,75 à l'est (+X).
  g.rotateY(-Math.PI / 2);
  return g;
}

export function estMobile(): boolean {
  return typeof window !== "undefined" && (window.matchMedia?.("(pointer: coarse)").matches ?? false);
}

/** Charge une image (CORS anonyme) et la réduit si le GPU ou la mémoire du téléphone l'exigent. */
async function chargerTexture(url: string, maxTexture: number, signal?: AbortSignal): Promise<THREE.Texture> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  img.src = url;
  await new Promise<void>((ok, ko) => {
    img.onload = () => ok();
    img.onerror = () => ko(new Error(`image introuvable : ${url}`));
    signal?.addEventListener("abort", () => ko(new DOMException("annulé", "AbortError")), { once: true });
  });
  const voulu = largeurTexture(img.naturalWidth, maxTexture, estMobile());
  let source: HTMLImageElement | HTMLCanvasElement = img;
  if (img.naturalWidth > voulu) {
    const c = document.createElement("canvas");
    c.width = voulu;
    c.height = Math.round(voulu / 2);
    const ctx = c.getContext("2d");
    if (ctx) {
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, c.width, c.height);
      source = c;
    }
  }
  const t = source instanceof HTMLCanvasElement ? new THREE.CanvasTexture(source) : new THREE.Texture(source);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearFilter; // équirectangulaire non puissance de deux : pas de mipmaps
  t.generateMipmaps = false;
  t.wrapS = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

export class Visionneuse {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly geometrie = sphere();
  private courant: Calque | null = null;
  private entrant: { calque: Calque; debut: number; fin: () => void } | null = null;
  private cap = 0;
  private inclinaison = 0;
  private vitesseCap = 0;
  private vitesseIncl = 0;
  private glisse: { x: number; y: number; cap: number; incl: number; t: number } | null = null;
  private pincement: { d: number; champ: number } | null = null;
  private readonly pointeurs = new Map<number, { x: number; y: number }>();
  private gyro: { quat: THREE.Quaternion; decalage: number | null; ecran: number } | null = null;
  private animation = 0;
  private detruit = false;
  private ecouteurs: Array<() => void> = [];
  /** Appelé à chaque image (après rendu) : la page repositionne repères et boussole. */
  surImage: (() => void) | null = null;
  /** Appelé quand l'utilisateur prend la main (glisser) : la page coupe le gyroscope. */
  surInteraction: (() => void) | null = null;

  private readonly hote: HTMLElement;

  constructor(hote: HTMLElement) {
    this.hote = hote;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.canvas = this.renderer.domElement;
    this.canvas.style.touchAction = "none";
    this.canvas.style.display = "block";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.setAttribute("aria-hidden", "true");
    hote.appendChild(this.canvas);
    this.camera = new THREE.PerspectiveCamera(CHAMP_DEFAUT, 1, 0.1, RAYON * 4);
    this.redimensionner();
    this.brancher();
    const boucle = (t: number) => {
      if (this.detruit) return;
      this.image(t);
      this.animation = requestAnimationFrame(boucle);
    };
    this.animation = requestAnimationFrame(boucle);
  }

  /** Champ vertical conseillé pour l'écran courant (plus large en portrait, borné à 75–100°). */
  champConseille(): number {
    const aspect = this.camera.aspect || 1;
    const v = (2 * Math.atan(Math.tan((CHAMP_HORIZONTAL_VISE / 2) * Math.PI / 180) / aspect) * 180) / Math.PI;
    return Math.max(CHAMP_DEFAUT, Math.min(CHAMP_MAX, v));
  }

  get maxTexture(): number {
    return this.renderer.capabilities.maxTextureSize;
  }

  get orientation(): { cap: number; inclinaison: number; champ: number } {
    return { cap: this.cap, inclinaison: this.inclinaison, champ: this.camera.fov };
  }

  /** Charge une image et l'affiche : immédiatement (`fondu` faux) ou en fondu enchaîné. */
  async afficher(url: string, options: { fondu?: boolean; signal?: AbortSignal } = {}): Promise<void> {
    const texture = await chargerTexture(url, this.maxTexture, options.signal);
    if (this.detruit) {
      texture.dispose();
      return;
    }
    const materiau = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: options.fondu ? 0 : 1, depthWrite: false });
    const calque: Calque = { mesh: new THREE.Mesh(this.geometrie, materiau) };
    this.scene.add(calque.mesh);
    if (!options.fondu || !this.courant) {
      this.remplacer(calque);
      return;
    }
    await new Promise<void>((fin) => {
      if (this.entrant) this.entrant.fin();
      this.entrant = { calque, debut: performance.now(), fin };
    });
  }

  /** Remplace la texture du calque courant (image pleine résolution après l'aperçu) sans fondu. */
  async affiner(url: string, signal?: AbortSignal): Promise<void> {
    const texture = await chargerTexture(url, this.maxTexture, signal);
    if (this.detruit || !this.courant || this.entrant) {
      texture.dispose();
      return;
    }
    const ancienne = this.courant.mesh.material.map;
    this.courant.mesh.material.map = texture;
    this.courant.mesh.material.needsUpdate = true;
    ancienne?.dispose();
  }

  regarder(cap: number, inclinaison = 0, champ?: number): void {
    this.cap = ((cap % 360) + 360) % 360;
    this.inclinaison = bornerInclinaison(inclinaison);
    if (champ) this.camera.fov = Math.max(CHAMP_MIN, Math.min(CHAMP_MAX, champ));
    this.vitesseCap = this.vitesseIncl = 0;
    this.camera.updateProjectionMatrix();
  }

  /** Tourne doucement le regard vers un cap en resserrant le champ (transition avant un déplacement). */
  async tourner(cap: number, inclinaison: number, dureeMs = 380): Promise<void> {
    const c0 = this.cap;
    const i0 = this.inclinaison;
    const f0 = this.camera.fov;
    let d = (((cap - c0) % 360) + 540) % 360 - 180;
    if (Math.abs(d) < 1) d = 0;
    const debut = performance.now();
    await new Promise<void>((fin) => {
      const pas = () => {
        if (this.detruit) return fin();
        const k = Math.min(1, (performance.now() - debut) / dureeMs);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        this.cap = (((c0 + d * e) % 360) + 360) % 360;
        this.inclinaison = i0 + (bornerInclinaison(inclinaison * 0.5) - i0) * e;
        this.camera.fov = f0 + (Math.max(CHAMP_MIN, f0 - 15) - f0) * e;
        this.camera.updateProjectionMatrix();
        if (k < 1) requestAnimationFrame(pas);
        else fin();
      };
      requestAnimationFrame(pas);
    });
  }

  /** Ramène doucement le champ à `champ` (après le fondu : on « entre » dans le nouveau panorama). */
  relacher(champ: number, dureeMs = 420): void {
    const f0 = this.camera.fov;
    const cible = Math.max(CHAMP_MIN, Math.min(CHAMP_MAX, champ));
    const debut = performance.now();
    const pas = () => {
      if (this.detruit) return;
      const k = Math.min(1, (performance.now() - debut) / dureeMs);
      this.camera.fov = f0 + (cible - f0) * (1 - Math.pow(1 - k, 3));
      this.camera.updateProjectionMatrix();
      if (k < 1) requestAnimationFrame(pas);
    };
    requestAnimationFrame(pas);
  }

  /** Position écran (px, relative au canevas) d'une direction de la sphère. */
  projeter(cap: number, inclinaison: number): Projection {
    const d = directionVue(cap, inclinaison);
    const v = new THREE.Vector3(d[0], d[1], d[2]).multiplyScalar(RAYON * 0.9);
    const avant = new THREE.Vector3();
    this.camera.getWorldDirection(avant);
    const devant = avant.dot(new THREE.Vector3(d[0], d[1], d[2])) > 0.05;
    v.project(this.camera);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const x = (v.x + 1) / 2 * w;
    const y = (1 - v.y) / 2 * h;
    return { x, y, visible: devant && x > -40 && x < w + 40 && y > -40 && y < h + 40 };
  }

  // ───────── Gyroscope ─────────

  /** Active l'orientation du téléphone (iOS : à appeler dans un geste de l'utilisateur). Rend false si refusé. */
  async activerGyroscope(): Promise<boolean> {
    const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
    if (!DOE) return false;
    if (typeof DOE.requestPermission === "function") {
      try {
        if ((await DOE.requestPermission()) !== "granted") return false;
      } catch {
        return false;
      }
    }
    this.gyro = { quat: new THREE.Quaternion(), decalage: null, ecran: 0 };
    return true;
  }

  desactiverGyroscope(): void {
    this.gyro = null;
  }

  get gyroscopeActif(): boolean {
    return this.gyro !== null;
  }

  private surOrientation = (e: DeviceOrientationEvent): void => {
    if (!this.gyro || e.alpha === null || e.beta === null || e.gamma === null) return;
    const ecran = ((screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0) as number) * Math.PI / 180;
    const euler = new THREE.Euler(e.beta * Math.PI / 180, e.alpha * Math.PI / 180, -e.gamma * Math.PI / 180, "YXZ");
    const q = new THREE.Quaternion().setFromEuler(euler);
    q.multiply(new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5))); // caméra vers l'arrière de l'appareil
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -ecran));
    const avant = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const capAppareil = ((Math.atan2(avant.x, -avant.z) * 180) / Math.PI + 360) % 360;
    // Le nord de l'appareil n'est pas celui du plan : on garde le cap affiché au moment de l'activation.
    if (this.gyro.decalage === null) this.gyro.decalage = this.cap - capAppareil;
    const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (-this.gyro.decalage * Math.PI) / 180);
    this.gyro.quat.copy(rot.multiply(q));
    this.gyro.ecran = ecran;
  };

  // ───────── Interaction ─────────

  private brancher(): void {
    const ec = <K extends keyof HTMLElementEventMap>(cible: HTMLElement, type: K, f: (e: HTMLElementEventMap[K]) => void, o?: AddEventListenerOptions) => {
      cible.addEventListener(type, f as EventListener, o);
      this.ecouteurs.push(() => cible.removeEventListener(type, f as EventListener, o));
    };
    const c = this.canvas;
    ec(c, "pointerdown", (e) => {
      c.setPointerCapture(e.pointerId);
      this.pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointeurs.size === 1) {
        this.glisse = { x: e.clientX, y: e.clientY, cap: this.cap, incl: this.inclinaison, t: performance.now() };
        this.vitesseCap = this.vitesseIncl = 0;
        if (this.gyro) this.surInteraction?.();
      } else if (this.pointeurs.size === 2) {
        const [a, b] = [...this.pointeurs.values()];
        this.pincement = { d: Math.hypot(a.x - b.x, a.y - b.y), champ: this.camera.fov };
        this.glisse = null;
      }
    });
    ec(c, "pointermove", (e) => {
      if (!this.pointeurs.has(e.pointerId)) return;
      this.pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pincement && this.pointeurs.size >= 2) {
        const [a, b] = [...this.pointeurs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        this.zoomer(this.pincement.champ * (this.pincement.d / d) - this.camera.fov);
        return;
      }
      if (!this.glisse) return;
      const degParPx = this.camera.fov / (c.clientHeight || 1);
      const cap = this.glisse.cap - (e.clientX - this.glisse.x) * degParPx;
      const incl = bornerInclinaison(this.glisse.incl + (e.clientY - this.glisse.y) * degParPx);
      const dt = Math.max(1, performance.now() - this.glisse.t);
      this.vitesseCap = (cap - this.cap) / dt * 16;
      this.vitesseIncl = (incl - this.inclinaison) / dt * 16;
      this.glisse.t = performance.now();
      this.cap = ((cap % 360) + 360) % 360;
      this.inclinaison = incl;
      this.glisse.x = e.clientX;
      this.glisse.y = e.clientY;
      this.glisse.cap = this.cap;
      this.glisse.incl = this.inclinaison;
    });
    const fin = (e: PointerEvent) => {
      this.pointeurs.delete(e.pointerId);
      if (this.pointeurs.size < 2) this.pincement = null;
      if (this.pointeurs.size === 0) this.glisse = null;
    };
    ec(c, "pointerup", fin);
    ec(c, "pointercancel", fin);
    ec(c, "wheel", (e) => {
      e.preventDefault();
      this.zoomer(e.deltaY * 0.05);
    }, { passive: false });
    const redim = () => this.redimensionner();
    window.addEventListener("resize", redim);
    this.ecouteurs.push(() => window.removeEventListener("resize", redim));
    const orient = (e: Event) => this.surOrientation(e as DeviceOrientationEvent);
    window.addEventListener("deviceorientation", orient);
    this.ecouteurs.push(() => window.removeEventListener("deviceorientation", orient));
  }

  zoomer(delta: number): void {
    this.camera.fov = Math.max(CHAMP_MIN, Math.min(CHAMP_MAX, this.camera.fov + delta));
    this.camera.updateProjectionMatrix();
  }

  /** Flèches du clavier (la page relaie les touches quand la visionneuse a le focus). */
  pivoter(dCap: number, dIncl: number): void {
    this.cap = (((this.cap + dCap) % 360) + 360) % 360;
    this.inclinaison = bornerInclinaison(this.inclinaison + dIncl);
  }

  private redimensionner(): void {
    const w = this.hote.clientWidth || window.innerWidth;
    const h = this.hote.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  private remplacer(calque: Calque): void {
    const ancien = this.courant;
    calque.mesh.material.opacity = 1;
    calque.mesh.material.transparent = false;
    calque.mesh.renderOrder = 0;
    this.courant = calque;
    if (ancien) {
      this.scene.remove(ancien.mesh);
      ancien.mesh.material.map?.dispose();
      ancien.mesh.material.dispose();
    }
  }

  private image(t: number): void {
    if (this.gyro && this.gyro.decalage !== null) {
      this.camera.quaternion.copy(this.gyro.quat);
      const avant = new THREE.Vector3(0, 0, -1).applyQuaternion(this.gyro.quat);
      this.cap = ((Math.atan2(avant.x, -avant.z) * 180) / Math.PI + 360) % 360;
      this.inclinaison = (Math.asin(Math.max(-1, Math.min(1, avant.y))) * 180) / Math.PI;
    } else {
      if (!this.glisse && (Math.abs(this.vitesseCap) > 0.01 || Math.abs(this.vitesseIncl) > 0.01)) {
        this.pivoter(this.vitesseCap, this.vitesseIncl);
        this.vitesseCap *= 0.92;
        this.vitesseIncl *= 0.92;
      }
      const d: Vec3 = directionVue(this.cap, this.inclinaison);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(d[0], d[1], d[2]);
    }
    if (this.entrant) {
      const k = Math.min(1, (t - this.entrant.debut) / DUREE_FONDU_MS);
      this.entrant.calque.mesh.material.opacity = k;
      this.entrant.calque.mesh.renderOrder = 1;
      if (k >= 1) {
        const { calque, fin } = this.entrant;
        this.entrant = null;
        this.remplacer(calque);
        fin();
      }
    }
    this.renderer.render(this.scene, this.camera);
    this.surImage?.();
  }

  detruire(): void {
    this.detruit = true;
    cancelAnimationFrame(this.animation);
    for (const f of this.ecouteurs) f();
    this.ecouteurs = [];
    for (const o of [...this.scene.children]) {
      const m = o as THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
      m.material?.map?.dispose();
      m.material?.dispose();
      this.scene.remove(o);
    }
    this.entrant?.fin();
    this.geometrie.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}

export function webglDisponible(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}
