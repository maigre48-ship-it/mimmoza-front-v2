// sceneEnvironment.ts
// Éclairage + environnement "qualité plaquette" : ciel procédural visible, soleil directionnel
// orienté (azimut/élévation), ombres douces, réflexions PBR sur le verre, tone mapping ACES.
//
// Découplage volontaire : le ciel (Sky) sert de fond visuel ; les réflexions PBR proviennent
// d'un RoomEnvironment neutre (fiable toutes versions). Pour du photoréaliste, remplace
// l'environnement par un HDR via RGBELoader (voir note en bas).

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

export interface EnvOptions {
  sun?: {
    azimuth?: number;    // deg, 0 = Nord, sens horaire (Est = 90)
    elevation?: number;  // deg au-dessus de l'horizon
    intensity?: number;  // intensité du soleil — défaut 2.6
  };
  exposure?: number;     // exposition tone mapping — défaut 0.95
}

export interface EnvHandle {
  sky: Sky;
  sunLight: THREE.DirectionalLight;
  hemiLight: THREE.HemisphereLight;
  sunDirection: THREE.Vector3; // direction normalisée vers le soleil
  /** Ajuste la caméra d'ombre du soleil pour couvrir une bounding box (bâtiment + terrain). */
  fitShadowToBounds: (box: THREE.Box3) => void;
  dispose: () => void;
}

export function setupEnvironment(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  opts: EnvOptions = {},
): EnvHandle {
  const azimuth = opts.sun?.azimuth ?? 150;
  const elevation = opts.sun?.elevation ?? 48;
  const sunIntensity = opts.sun?.intensity ?? 2.6;

  // --- rendu : tone mapping + ombres ---
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = opts.exposure ?? 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // --- direction du soleil (sphérique → cartésien) ---
  const phi = THREE.MathUtils.degToRad(90 - elevation); // depuis le zénith
  const theta = THREE.MathUtils.degToRad(azimuth);
  const sunDirection = new THREE.Vector3().setFromSphericalCoords(1, phi, theta).normalize();

  // --- ciel procédural (fond visuel) ---
  const sky = new Sky();
  sky.scale.setScalar(450000);
  const u = sky.material.uniforms;
  u['turbidity'].value = 6;
  u['rayleigh'].value = 2.2;
  u['mieCoefficient'].value = 0.005;
  u['mieDirectionalG'].value = 0.8;
  u['sunPosition'].value.copy(sunDirection);
  scene.add(sky);

  // --- réflexions PBR (environnement neutre studio) ---
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;

  // --- soleil directionnel ---
  const sunLight = new THREE.DirectionalLight(0xfff4e6, sunIntensity);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.bias = -0.0004;
  sunLight.shadow.normalBias = 0.02;
  scene.add(sunLight);
  scene.add(sunLight.target);

  // --- lumière d'ambiance ciel/sol ---
  const hemiLight = new THREE.HemisphereLight(0xbcd3e8, 0x8a8276, 0.55);
  scene.add(hemiLight);

  const fitShadowToBounds = (box: THREE.Box3) => {
    const center = box.getCenter(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const r = sphere.radius * 1.15;
    const dist = Math.max(r * 2.5, 60);

    sunLight.target.position.copy(center);
    sunLight.position.copy(center).add(sunDirection.clone().multiplyScalar(dist));

    const cam = sunLight.shadow.camera as THREE.OrthographicCamera;
    cam.left = -r; cam.right = r;
    cam.top = r; cam.bottom = -r;
    cam.near = 1;
    cam.far = dist + r * 2;
    cam.updateProjectionMatrix();
    sunLight.target.updateMatrixWorld();
  };

  const dispose = () => {
    envTex.dispose();
    pmrem.dispose();
    sky.material.dispose();
    (sky.geometry as THREE.BufferGeometry).dispose();
  };

  return { sky, sunLight, hemiLight, sunDirection, fitShadowToBounds, dispose };
}

// Pour un rendu plus poussé, remplace les réflexions studio par un HDR :
//   import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
//   new RGBELoader().load('/hdr/venice_sunset_1k.hdr', (hdr) => {
//     const env = pmrem.fromEquirectangular(hdr).texture;
//     scene.environment = env;
//     hdr.dispose();
//   });