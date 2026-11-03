// src/spaces/copilot/studio3d/VolumeParcelle3D.tsx
//
// Vue 3D LÉGÈRE du Dossier 3D : contour réel de la parcelle (en mètres locaux)
// et volume parallélépipédique proposé, orbitable à la souris ou au doigt.
// Chargée paresseusement (React.lazy) par VolumeParcelleSection : three n'est
// téléchargé que lorsqu'une parcelle est à montrer. Sans WebGL : plan 2D (SVG).
//
// Mise en scène « maquette sur plateau » : fond dégradé (CSS), socle de parcelle
// légèrement extrudé avec contour net, ombre douce au sol, volume translucide à
// arêtes nettes et lignes de plancher discrètes. Les cotes sont des lignes dans
// la scène repérées par une lettre (L, P, H) de taille fixe à l'écran ; leurs
// valeurs sont regroupées dans une légende HTML : plus aucun chevauchement
// d'étiquettes. Deux commandes : vue de dessus / perspective, recentrer.
// Troisième vue : « Axonométrie », un plan d'architecte en SVG (projection
// parallèle à 45°, voir planAxonometriqueLogique.ts), tournable par pas de 90° et
// exportable en SVG ou PNG. Il ne dépend pas de WebGL.

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Axis3d, Rotate3d, Scan, SquareDashed } from 'lucide-react';
import { libelleNiveaux, type VolumePropose } from './volumeParcelle';
import type { CartouchePlan, RotationAxo } from './planAxonometriqueLogique';
import { PlanAxonometrique } from './PlanAxonometrique';

const fr = (v: number, d = 1) => v.toLocaleString('fr-FR', { maximumFractionDigits: d });

/** Repère de cote (lettre dans une pastille), de taille constante à l'écran. */
function repere(lettre: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(32, 32, 29, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = '#5b44d6'; ctx.stroke();
    ctx.fillStyle = '#3a2a9c'; ctx.font = '700 30px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(lettre, 32, 34);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true, sizeAttenuation: false }));
  sprite.scale.set(0.055, 0.055, 1);
  sprite.renderOrder = 10;
  return sprite;
}

/** Halo clair sous la maquette (dégradé radial), pour poser l'objet sans grille. */
function texturePlateau(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
    g.addColorStop(0, 'rgba(255,255,255,.95)');
    g.addColorStop(0.55, 'rgba(255,255,255,.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Légende des cotes : valeurs regroupées hors de la scène (lisibles quel que soit l'angle). */
function LegendeCotes({ volume }: { volume: VolumePropose }) {
  const e = volume.emprise;
  if (!e) return null;
  return <dl className="mzia-volume__legende" aria-label="Cotes du volume">
    <div><dt>L</dt><dd>{fr(e.largeurM)} m<span className="mzia-volume__sr"> de longueur</span></dd></div>
    <div><dt>P</dt><dd>{fr(e.profondeurM)} m<span className="mzia-volume__sr"> d’épaisseur</span></dd></div>
    {volume.hauteurM > 0 && <div><dt>H</dt><dd>{fr(volume.hauteurM, 0)} m · {libelleNiveaux(volume.niveaux)}</dd></div>}
  </dl>;
}

/** Plan 2D de secours (pas de WebGL) : parcelle et emprise vues de dessus. */
export function PlanVolumeSvg({ volume }: { volume: VolumePropose }) {
  const xs = volume.contour.map(p => p.x), ys = volume.contour.map(p => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const marge = Math.max(x1 - x0, y1 - y0) * 0.08 + 2;
  const vb = `${x0 - marge} ${-(y1 + marge)} ${x1 - x0 + 2 * marge} ${y1 - y0 + 2 * marge}`;
  const pts = (l: { x: number; y: number }[]) => l.map(p => `${p.x},${-p.y}`).join(' ');
  const trait = Math.max(0.3, (x1 - x0) / 200);
  return <svg className="mzia-volume__plan" viewBox={vb} role="img" aria-label="Plan de la parcelle et de l’emprise proposée">
    <polygon points={pts(volume.contour)} fill="#dff1e6" stroke="#2f7a52" strokeWidth={trait} strokeLinejoin="round" />
    {volume.emprise && <polygon points={pts(volume.emprise.coins)} fill="#c9bff5" fillOpacity={0.85} stroke="#4a33b8" strokeWidth={trait} strokeLinejoin="round" />}
  </svg>;
}

type Vue = 'perspective' | 'dessus';
type Commandes = { recentrer(): void; vue(v: Vue): void };

export default function VolumeParcelle3D({ volume, cartouche }: { volume: VolumePropose; cartouche?: CartouchePlan }) {
  const hote = useRef<HTMLDivElement>(null);
  const commandes = useRef<Commandes | null>(null);
  const [sansWebgl, setSansWebgl] = useState(false);
  const [vue, setVue] = useState<Vue>('perspective');
  // Plan axonométrique : affiché à la place de la scène (qui reste montée, masquée).
  const [axo, setAxo] = useState(false);
  const [rotationAxo, setRotationAxo] = useState<RotationAxo>(0);
  const cartoucheAxo: CartouchePlan = cartouche ?? { idu: '', mention: volume.mentionPlu };
  const cle = JSON.stringify([volume.contour, volume.emprise, volume.niveaux]);

  useEffect(() => {
    const element = hote.current;
    if (!element || volume.contour.length < 3) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
    } catch {
      setSansWebgl(true);
      return;
    }
    setSansWebgl(false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    element.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const xs = volume.contour.map(p => p.x), ys = volume.contour.map(p => p.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const etendue = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), volume.hauteurM, 20);
    // Repère : x vers l'est, -z vers le nord (comme l'aperçu existant).
    const monde = (x: number, y: number, h = 0) => new THREE.Vector3(x - cx, h, -(y - cy));
    const SOCLE = Math.max(0.35, etendue / 160);

    const jetables: { dispose(): void }[] = [];
    const garder = <T extends { dispose(): void }>(o: T) => { jetables.push(o); return o; };

    // Plateau : halo clair et sol qui ne montre que l'ombre.
    const halo = new THREE.Mesh(garder(new THREE.CircleGeometry(etendue * 1.6, 64)),
      garder(new THREE.MeshBasicMaterial({ map: garder(texturePlateau()), transparent: true, depthWrite: false })));
    halo.rotation.x = -Math.PI / 2; halo.position.y = -0.02;
    scene.add(halo);
    const sol = new THREE.Mesh(garder(new THREE.PlaneGeometry(etendue * 4, etendue * 4)), garder(new THREE.ShadowMaterial({ color: '#2a1f6b', opacity: 0.16 })));
    sol.rotation.x = -Math.PI / 2; sol.position.y = -0.01; sol.receiveShadow = true;
    scene.add(sol);

    // Parcelle : socle extrudé (dessus vert clair, flancs plus soutenus) et contour net.
    const forme = new THREE.Shape(volume.contour.map(p => new THREE.Vector2(p.x - cx, p.y - cy)));
    const socle = new THREE.Mesh(garder(new THREE.ExtrudeGeometry(forme, { depth: SOCLE, bevelEnabled: false })), [
      garder(new THREE.MeshStandardMaterial({ color: '#d9efe1', roughness: 0.92 })),
      garder(new THREE.MeshStandardMaterial({ color: '#9fcdb2', roughness: 0.9 })),
    ]);
    // ExtrudeGeometry extrude selon +z : rotation pour poser le socle (dessus à y = SOCLE).
    socle.rotation.x = -Math.PI / 2;
    socle.castShadow = true; socle.receiveShadow = true;
    scene.add(socle);
    const contour = new THREE.LineLoop(garder(new THREE.BufferGeometry().setFromPoints(volume.contour.map(p => monde(p.x, p.y, SOCLE + 0.04)))), garder(new THREE.LineBasicMaterial({ color: '#23704a' })));
    scene.add(contour);

    let cible = new THREE.Vector3(0, SOCLE, 0);
    // Caméra : direction fixe (sud-est, en surplomb), distance recalculée pour cadrer toute la parcelle.
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, etendue * 20);
    const direction = new THREE.Vector3(0.55, 0.62, 0.78).normalize();
    const rayon = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), volume.hauteurM) / 2;
    const cadrer = (aspect: number) => {
      const demiV = THREE.MathUtils.degToRad(camera.fov / 2);
      const demi = Math.min(demiV, Math.atan(Math.tan(demiV) * aspect));
      // Le rayon englobe la parcelle vue depuis la cible (centre du volume, parfois décentré).
      return cible.clone().add(direction.clone().multiplyScalar((rayon + Math.hypot(cible.x, cible.z)) * 0.8 / Math.sin(demi)));
    };
    const initiale = new THREE.Vector3(etendue, etendue, etendue);
    if (volume.emprise) {
      const e = volume.emprise;
      const groupe = new THREE.Group();
      groupe.position.copy(monde(e.centre.x, e.centre.y, SOCLE));
      groupe.rotation.y = e.angleDeg * Math.PI / 180;
      scene.add(groupe);
      const H = volume.hauteurM;
      const boite = garder(new THREE.BoxGeometry(e.largeurM, H, e.profondeurM));
      const bloc = new THREE.Mesh(boite, garder(new THREE.MeshStandardMaterial({ color: '#9d8cf7', roughness: 0.4, metalness: 0, transparent: true, opacity: 0.62, depthWrite: false })));
      bloc.position.y = H / 2; bloc.castShadow = true; bloc.renderOrder = 2;
      groupe.add(bloc);
      const aretes = new THREE.LineSegments(garder(new THREE.EdgesGeometry(boite)), garder(new THREE.LineBasicMaterial({ color: '#3a26a6' })));
      aretes.position.y = H / 2; aretes.renderOrder = 3;
      groupe.add(aretes);
      // Lignes de plancher (un trait par niveau), discrètes.
      const plancher = garder(new THREE.LineBasicMaterial({ color: '#5b44d6', transparent: true, opacity: 0.38 }));
      const w = e.largeurM / 2 + 0.02, d = e.profondeurM / 2 + 0.02;
      for (let n = 1; n < volume.niveaux; n++) {
        const y = n * (H / volume.niveaux);
        groupe.add(new THREE.LineLoop(garder(new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-w, y, -d), new THREE.Vector3(w, y, -d), new THREE.Vector3(w, y, d), new THREE.Vector3(-w, y, d)])), plancher));
      }
      // Cotes : lignes décalées du volume, avec talons, repérées par une lettre (valeurs dans la légende).
      const ecart = Math.max(1.6, etendue / 28), talon = ecart * 0.45;
      const coteMat = garder(new THREE.LineBasicMaterial({ color: '#5b44d6', transparent: true, opacity: 0.85, depthTest: false }));
      const cote = (a: THREE.Vector3, b: THREE.Vector3, sens: THREE.Vector3, lettre: string, ou: THREE.Vector3) => {
        const t = sens.clone().multiplyScalar(talon);
        const segs = [a, b, a.clone().sub(t), a.clone().add(t), b.clone().sub(t), b.clone().add(t)];
        const l = new THREE.LineSegments(garder(new THREE.BufferGeometry().setFromPoints(segs)), coteMat);
        l.renderOrder = 9; groupe.add(l);
        const r = repere(lettre); r.position.copy(ou); groupe.add(r);
        jetables.push(r.material.map!, r.material);
      };
      // Les cotes se placent sur les côtés tournés vers la caméra de départ : elles ne traversent pas le volume.
      groupe.updateMatrixWorld();
      const local = groupe.worldToLocal(direction.clone().multiplyScalar(etendue * 10).add(groupe.position));
      const sx = local.x >= 0 ? 1 : -1, sz = local.z >= 0 ? 1 : -1;
      const y0 = 0.15;
      cote(new THREE.Vector3(-w, y0, sz * (d + ecart)), new THREE.Vector3(w, y0, sz * (d + ecart)), new THREE.Vector3(0, 0, 1), 'L', new THREE.Vector3(0, y0, sz * (d + ecart)));
      cote(new THREE.Vector3(sx * (w + ecart), y0, -d), new THREE.Vector3(sx * (w + ecart), y0, d), new THREE.Vector3(1, 0, 0), 'P', new THREE.Vector3(sx * (w + ecart), y0, 0));
      if (H > 0) cote(new THREE.Vector3(-sx * (w + ecart), 0, sz * d), new THREE.Vector3(-sx * (w + ecart), H, sz * d), new THREE.Vector3(0, 0, 1), 'H', new THREE.Vector3(-sx * (w + ecart), H / 2, sz * d));
      cible = new THREE.Vector3(groupe.position.x, SOCLE + H * 0.3, groupe.position.z);
    }

    scene.add(new THREE.HemisphereLight('#ffffff', '#cfc8ee', 1.6));
    const soleil = new THREE.DirectionalLight('#fffaf2', 2.2);
    soleil.position.set(-etendue * 0.8, etendue * 1.8, etendue * 1.1);
    soleil.castShadow = true;
    soleil.shadow.mapSize.set(1024, 1024);
    soleil.shadow.radius = 6;
    soleil.shadow.bias = -0.0005;
    const ombre = soleil.shadow.camera;
    ombre.left = -etendue * 1.4; ombre.right = etendue * 1.4; ombre.top = etendue * 1.4; ombre.bottom = -etendue * 1.4;
    ombre.near = 0.5; ombre.far = etendue * 6;
    scene.add(soleil);

    camera.position.copy(initiale);
    const controles = new OrbitControls(camera, renderer.domElement);
    controles.enableDamping = true;
    controles.enablePan = false;
    controles.minDistance = etendue * 0.4;
    controles.maxDistance = etendue * 7;
    controles.maxPolarAngle = Math.PI * 0.49;
    controles.target.copy(cible);
    controles.update();
    let manipulee = false;
    controles.addEventListener('start', () => { manipulee = true; });

    // Transitions de caméra (vue de dessus, recentrage) ; immédiates si l'utilisateur réduit les animations.
    const reduit = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let transition: { de: THREE.Vector3; vers: THREE.Vector3; t0: number } | null = null;
    const allerA = (vers: THREE.Vector3) => {
      controles.target.copy(cible);
      if (reduit) { camera.position.copy(vers); transition = null; controles.update(); return; }
      transition = { de: camera.position.clone(), vers, t0: performance.now() };
    };
    commandes.current = {
      recentrer: () => allerA(initiale.clone()),
      // Dessus : léger décalage vers le sud pour garder l'orbite stable (pôle évité).
      vue: v => {
        const distance = initiale.distanceTo(cible);
        allerA(v === 'dessus' ? new THREE.Vector3(cible.x, cible.y + distance, cible.z + distance * 0.01) : initiale.clone());
      },
    };

    const redimensionner = () => {
      const largeur = Math.max(element.clientWidth, 1), hauteur = Math.max(element.clientHeight, 1);
      renderer.setSize(largeur, hauteur, false);
      camera.aspect = largeur / hauteur;
      camera.updateProjectionMatrix();
      initiale.copy(cadrer(camera.aspect));
      if (!manipulee && !transition) { camera.position.copy(initiale); controles.update(); }
    };
    const observateur = new ResizeObserver(redimensionner);
    observateur.observe(element);
    redimensionner();
    let image = 0;
    const rendre = () => {
      image = window.requestAnimationFrame(rendre);
      if (element.clientWidth === 0) return; // scène masquée (plan axonométrique affiché)
      if (transition) {
        const k = Math.min(1, (performance.now() - transition.t0) / 450);
        const lisse = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        camera.position.lerpVectors(transition.de, transition.vers, lisse);
        if (k >= 1) transition = null;
      }
      controles.update();
      renderer.render(scene, camera);
    };
    rendre();
    return () => {
      commandes.current = null;
      window.cancelAnimationFrame(image);
      observateur.disconnect();
      controles.dispose();
      jetables.forEach(o => o.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle]);

  const changerVue = useCallback(() => {
    const suivante: Vue = vue === 'dessus' ? 'perspective' : 'dessus';
    commandes.current?.vue(suivante);
    setVue(suivante);
    setAxo(false);
  }, [vue]);
  const recentrer = useCallback(() => { commandes.current?.recentrer(); setVue('perspective'); setAxo(false); }, []);
  const basculerAxo = useCallback(() => setAxo(a => !a), []);
  const boutonAxo = <button type="button" className="mzia-volume__outil" aria-pressed={axo} onClick={basculerAxo}
    title={axo ? 'Revenir à la vue 3D' : 'Plan axonométrique'}>
    <Axis3d size={16} aria-hidden="true" /><span className="mzia-volume__sr">Plan axonométrique</span>
  </button>;
  const plan = axo && <PlanAxonometrique volume={volume} cartouche={cartoucheAxo} rotation={rotationAxo} onTourner={setRotationAxo} />;

  const resume = volume.emprise
    ? `Parcelle de ${fr(volume.surfaceParcelleM2, 0)} m² et volume d’étude de ${fr(volume.emprise.largeurM)} × ${fr(volume.emprise.profondeurM)} m, ${fr(volume.hauteurM, 0)} m de haut (${libelleNiveaux(volume.niveaux)}).`
    : `Parcelle de ${fr(volume.surfaceParcelleM2, 0)} m².`;

  if (sansWebgl) return <figure className={`mzia-volume__vue ${axo ? 'is-axo' : 'is-plan'}`}>
    {axo ? plan : <>
      <PlanVolumeSvg volume={volume} />
      <figcaption className="mzia-volume__vue-note">Plan de dessus : la 3D n’est pas disponible sur cet appareil.</figcaption>
      <LegendeCotes volume={volume} />
    </>}
    <div className="mzia-volume__outils" role="toolbar" aria-label="Vue du plan">{boutonAxo}</div>
  </figure>;

  return <figure className={`mzia-volume__vue${axo ? ' is-axo' : ''}`}>
    <div ref={hote} className="mzia-volume__scene" role="img" aria-label={`Vue 3D orbitable. ${resume}`} hidden={axo} />
    {plan}
    <div className="mzia-volume__outils" role="toolbar" aria-label="Vue 3D">
      <button type="button" className="mzia-volume__outil" aria-pressed={!axo && vue === 'dessus'} onClick={changerVue}
        title={vue === 'dessus' ? 'Revenir en perspective' : 'Vue de dessus'}>
        {vue === 'dessus' ? <Rotate3d size={16} aria-hidden="true" /> : <SquareDashed size={16} aria-hidden="true" />}
        <span className="mzia-volume__sr">{vue === 'dessus' ? 'Revenir en perspective' : 'Vue de dessus'}</span>
      </button>
      <button type="button" className="mzia-volume__outil" onClick={recentrer} title="Recentrer la vue">
        <Scan size={16} aria-hidden="true" /><span className="mzia-volume__sr">Recentrer la vue</span>
      </button>
      {boutonAxo}
    </div>
    {!axo && <LegendeCotes volume={volume} />}
  </figure>;
}
