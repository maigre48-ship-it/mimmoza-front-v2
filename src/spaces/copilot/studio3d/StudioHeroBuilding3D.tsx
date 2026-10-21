import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Immeuble de démonstration de l'accueil. Aucun projet utilisateur n'est simulé ici. */
export function StudioHeroBuilding3D() {
  const host = useRef<HTMLDivElement>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const element = host.current;
    if (!element) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    } catch {
      setUnavailable(true);
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.32;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Scène et soleil immobiles (seule la caméra tourne) : l'ombre est calculée
    // une fois, pas à chaque image.
    renderer.shadowMap.autoUpdate = false;
    element.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(14, 11, 17);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 4.1, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.minPolarAngle = 0.35;
    controls.maxPolarAngle = 1.43;
    controls.autoRotate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    controls.autoRotateSpeed = 0.55;
    const rotationAuto = controls.autoRotate;
    let reprise = 0;
    controls.addEventListener('start', () => { controls.autoRotate = false; window.clearTimeout(reprise); });
    // Après une manipulation, la rotation reprend doucement d'elle-même.
    controls.addEventListener('end', () => { reprise = window.setTimeout(() => { controls.autoRotate = rotationAuto; }, 2500); });
    controls.update();

    scene.add(new THREE.HemisphereLight('#fffdf3', '#7869b3', 1.8));
    const sun = new THREE.DirectionalLight('#fff8e7', 2.8);
    sun.position.set(-7, 18, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -13;
    sun.shadow.camera.right = 13;
    sun.shadow.camera.top = 14;
    sun.shadow.camera.bottom = -14;
    sun.shadow.normalBias = 0.03;
    scene.add(sun);

    const building = new THREE.Group();
    scene.add(building);
    const cream = new THREE.MeshStandardMaterial({ color: '#e9e2d3', roughness: 0.88 });
    const ivory = new THREE.MeshStandardMaterial({ color: '#f9f2e4', roughness: 0.83 });
    const stone = new THREE.MeshStandardMaterial({ color: '#c9bda9', roughness: 0.94 });
    const dark = new THREE.MeshStandardMaterial({ color: '#415464', metalness: 0.22, roughness: 0.32 });
    const glass = new THREE.MeshPhysicalMaterial({ color: '#7695a3', metalness: 0.12, roughness: 0.15, transparent: true, opacity: 0.72, side: THREE.DoubleSide });
    const rail = new THREE.MeshStandardMaterial({ color: '#d9d7d1', metalness: 0.55, roughness: 0.4 });
    const soil = new THREE.MeshStandardMaterial({ color: '#786e5e', roughness: 1 });
    const leaves = [
      new THREE.MeshStandardMaterial({ color: '#5c7c53', roughness: 1 }),
      new THREE.MeshStandardMaterial({ color: '#78965b', roughness: 1 }),
      new THREE.MeshStandardMaterial({ color: '#9ba763', roughness: 1 }),
    ];
    const purple = new THREE.MeshStandardMaterial({ color: '#afa0ff', emissive: '#5941df', emissiveIntensity: 0.32 });

    const box = (parent: THREE.Object3D, material: THREE.Material, width: number, height: number, depth: number, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const shrub = (parent: THREE.Object3D, x: number, y: number, z: number, scale = 1, tone = 0) => {
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(0.27 * scale, 1), leaves[tone % leaves.length]);
      crown.position.set(x, y, z);
      crown.castShadow = true;
      parent.add(crown);
    };
    const planter = (parent: THREE.Object3D, x: number, y: number, z: number, width: number) => {
      box(parent, stone, width, 0.23, 0.32, x, y, z);
      box(parent, soil, width - 0.08, 0.035, 0.23, x, y + 0.13, z);
      for (let i = 0; i < Math.max(2, Math.floor(width / 0.45)); i++) {
        shrub(parent, x - width / 2 + 0.3 + i * 0.43, y + 0.28, z, 0.55 + (i % 3) * 0.14, i);
      }
    };

    box(building, stone, 12.4, 0.32, 10, 0, -0.22, 0);
    box(building, purple, 12.5, 0.055, 10.1, 0, -0.42, 0);
    box(building, cream, 10, 8.4, 7.2, 0, 4.2, 0);
    box(building, ivory, 10.35, 0.24, 7.55, 0, 8.42, 0);
    box(building, ivory, 10.2, 0.18, 7.38, 0, 2.1, 0);
    for (const level of [4.2, 6.3]) box(building, ivory, 10.12, 0.11, 7.35, 0, level, 0);

    // Openings on all four faces make the building recognisably three dimensional.
    for (let floor = 0; floor < 4; floor++) {
      const y = floor * 2.1 + (floor === 0 ? 1.08 : 1.12);
      const h = floor === 0 ? 1.76 : 1.57;
      for (const z of [-3.615, 3.615]) {
        for (const x of [-3.75, -1.25, 1.25, 3.75]) {
          box(building, dark, 1.27, h + 0.12, 0.09, x, y, z);
          box(building, glass, 1.12, h, 0.11, x, y, z + Math.sign(z) * 0.07);
          box(building, rail, 0.055, h, 0.13, x, y, z + Math.sign(z) * 0.14);
          box(building, ivory, 1.45, 0.13, 0.2, x, y + h / 2 + 0.1, z);
        }
      }
      for (const x of [-5.015, 5.015]) {
        for (const z of [-2.35, 0, 2.35]) {
          box(building, dark, 0.09, h + 0.08, 1.08, x, y, z);
          box(building, glass, 0.11, h, 0.96, x + Math.sign(x) * 0.07, y, z);
          box(building, rail, 0.13, h, 0.055, x + Math.sign(x) * 0.14, y, z);
        }
      }
    }

    // Recessed balconies and transparent guardrails on the main and side facades.
    for (let floor = 1; floor < 4; floor++) {
      const y = floor * 2.1 + 0.08;
      for (const x of [-3.05, 2.45]) {
        const width = x < 0 ? 2.65 : 5.0;
        box(building, ivory, width, 0.16, 1.15, x, y, 4.12);
        box(building, glass, width - 0.18, 0.76, 0.07, x, y + 0.47, 4.7);
        box(building, rail, width, 0.045, 0.1, x, y + 0.88, 4.7);
        for (const edge of [-1, 1]) box(building, rail, 0.045, 0.83, 0.06, x + edge * (width / 2 - 0.08), y + 0.48, 4.7);
        planter(building, x + width * 0.22, y + 0.19, 4.42, width * 0.36);
      }
      box(building, ivory, 1.06, 0.16, 5.85, 5.48, y, 0);
      box(building, glass, 0.07, 0.76, 5.65, 6.02, y + 0.47, 0);
      box(building, rail, 0.07, 0.045, 5.85, 6.02, y + 0.88, 0);
      planter(building, 5.7, y + 0.19, 1.35, 2.2);
    }

    // Roof garden and central lift housing.
    box(building, soil, 9.5, 0.06, 6.7, 0, 8.57, 0);
    box(building, ivory, 2.45, 1.65, 2.3, 0, 9.37, -0.6);
    box(building, dark, 2.6, 0.08, 2.45, 0, 10.23, -0.6);
    for (const x of [-4.78, 4.78]) box(building, ivory, 0.24, 0.53, 7.15, x, 8.77, 0);
    for (const z of [-3.45, 3.45]) box(building, ivory, 9.5, 0.53, 0.24, 0, 8.77, z);
    for (let i = 0; i < 24; i++) {
      const x = -4.35 + (i % 8) * 1.25;
      const z = i < 16 ? (i < 8 ? -2.9 : 2.9) : -2.2 + (i - 16) * 0.62;
      shrub(building, x, 8.96, z, 0.8 + (i % 4) * 0.12, i);
    }

    for (const x of [-5.3, 5.3]) {
      planter(building, x, 0.06, 3.8, 2.2);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 1.15, 6), soil);
      trunk.position.set(x, 0.82, 3.6);
      building.add(trunk);
      for (let i = 0; i < 5; i++) shrub(building, x + (i % 2 ? 0.27 : -0.24), 1.55 + (i % 3) * 0.2, 3.55 + (i - 2) * 0.19, 1.45, i);
    }

    // ~700 petites boîtes = ~1 400 appels de dessin par image (ombres comprises) :
    // c'est ce qui faisait saccader la rotation sur les GPU intégrés. On fusionne
    // toutes les pièces d'un même matériau en un seul maillage (≈ 12 appels).
    building.updateMatrixWorld(true);
    const parMateriau = new Map<THREE.Material, THREE.BufferGeometry[]>();
    building.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const geometrie = (object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone()).applyMatrix4(object.matrixWorld);
      object.geometry.dispose();
      const liste = parMateriau.get(object.material as THREE.Material) ?? [];
      liste.push(geometrie);
      parMateriau.set(object.material as THREE.Material, liste);
    });
    building.clear();
    for (const [materiau, geometries] of parMateriau) {
      const fusion = mergeGeometries(geometries, false);
      geometries.forEach((g) => g.dispose());
      if (!fusion) continue;
      const mesh = new THREE.Mesh(fusion, materiau);
      mesh.castShadow = true;
      mesh.receiveShadow = materiau !== glass;
      building.add(mesh);
    }
    renderer.shadowMap.needsUpdate = true;

    let compact = false;
    const resize = () => {
      const width = Math.max(1, element.clientWidth);
      const height = Math.max(1, element.clientHeight);
      const nextCompact = width < 500;
      if (nextCompact !== compact) {
        camera.position.sub(controls.target).multiplyScalar(nextCompact ? 1.22 : 1 / 1.22).add(controls.target);
        camera.position.y += nextCompact ? -0.5 : 0.5;
        controls.target.y += nextCompact ? -0.5 : 0.5;
        compact = nextCompact;
        controls.update();
      }
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    let frame = 0;
    let visible = true;
    const visibility = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
    visibility.observe(element);
    // Rotation calée sur le temps écoulé, pas sur le nombre d'images : une image
    // en retard ne ralentit plus le mouvement, elle est rattrapée.
    const horloge = new THREE.Clock();
    const animate = () => {
      frame = requestAnimationFrame(animate);
      const delta = Math.min(horloge.getDelta(), 0.1);
      if (!visible || document.hidden) return;
      controls.update(delta);
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(reprise);
      observer.disconnect();
      visibility.disconnect();
      controls.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      for (const material of [cream, ivory, stone, dark, glass, rail, soil, purple, ...leaves]) material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  if (unavailable) {
    return <img src="/illustrations/mimmoza-studio-building.webp" alt="Immeuble contemporain en trois dimensions" />;
  }
  return (
    <div
      ref={host}
      className="mzia-studio-hero__viewer"
      role="img"
      aria-label="Immeuble contemporain en 3D. Faites glisser avec la souris ou le doigt pour le faire tourner."
    />
  );
}
