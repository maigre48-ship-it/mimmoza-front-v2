// src/spaces/copilot/studio3d/ApercuBrief3D.tsx
// =============================================================================
// LOT BRIEF-CRÉATIF — Aperçu 3D instantané du volume RÉEL de l'utilisateur, habillé
// selon les choix de la carte « Brief créatif ». Chargé paresseusement (React.lazy)
// par CarteBriefCreatif : three n'est téléchargé qu'à l'ouverture de la carte.
// Toute la géométrie vient de briefCreatif.ts::sceneApercu (pure, testée) ; ce
// composant ne fait que poser des boîtes (une InstancedMesh par matière) et la
// lumière de l'ambiance. Sans WebGL : `onIndisponible` (la carte garde la vignette).
// Pas d'acrotère dessiné. Lot brief-unifié : toiture végétalisée (tapis vert), toit à
// deux pans (prisme de la couleur de la couverture), soubassement et menuiseries.
// =============================================================================
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { couleurs, lumiere, sceneApercu, type ApercuVolume, type ChoixBrief, type LimitesBrief, type Matiere } from './briefCreatif';

interface Props { apercu: ApercuVolume; choix: ChoixBrief; limites: LimitesBrief; onIndisponible?: () => void }

const RUGOSITE: Record<Matiere, number> = { mur: 0.9, vitrage: 0.15, vitrageAllume: 0.4, vitrine: 0.15, dalle: 0.85, gardeCorps: 0.4, fondLoggia: 0.95, allege: 0.6, menuiserie: 0.45, soubassement: 0.9, toiture: 0.85 };

/** Toit à deux pans : prisme triangulaire (faîtage le long de l'axe u), en mètres locaux. */
function geometrieToit(l: number, p: number, h: number): THREE.BufferGeometry {
  const u = l / 2, v = p / 2;
  const s = [[-u, 0, -v], [u, 0, -v], [u, 0, v], [-u, 0, v], [-u, h, 0], [u, h, 0]];
  const f = [[0, 1, 5], [0, 5, 4], [3, 4, 5], [3, 5, 2], [0, 4, 3], [1, 2, 5], [0, 3, 2], [0, 2, 1]];
  const pos: number[] = [];
  for (const t of f) for (const i of t) pos.push(...(s[i] as [number, number, number]));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export default function ApercuBrief3D({ apercu, choix, limites, onIndisponible }: Props) {
  const hote = useRef<HTMLDivElement | null>(null);
  const moteur = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; groupe: THREE.Group; soleil: THREE.DirectionalLight; ambiante: THREE.HemisphereLight; sol: THREE.Mesh; rendre: () => void } | null>(null);
  const indispo = useRef(onIndisponible);
  useEffect(() => { indispo.current = onIndisponible; }, [onIndisponible]);

  // Montage : moteur, caméra, contrôles (une fois par volume).
  useEffect(() => {
    const el = hote.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch {
      indispo.current?.();
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 4000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.enablePan = false;
    const groupe = new THREE.Group();
    scene.add(groupe);
    const ambiante = new THREE.HemisphereLight(0xffffff, 0x888888, 0.8);
    scene.add(ambiante);
    const soleil = new THREE.DirectionalLight(0xffffff, 2.5);
    soleil.castShadow = true;
    soleil.shadow.mapSize.set(2048, 2048);
    scene.add(soleil, soleil.target);
    const sol = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshStandardMaterial({ color: 0xe7e3da, roughness: 1 }));
    sol.rotation.x = -Math.PI / 2;
    sol.receiveShadow = true;
    scene.add(sol);
    const rendre = () => renderer.render(scene, camera);
    moteur.current = { renderer, scene, camera, controls, groupe, soleil, ambiante, sol, rendre };
    const taille = () => {
      const w = el.clientWidth || 320, h = el.clientHeight || 200;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      rendre();
    };
    const obs = new ResizeObserver(taille);
    obs.observe(el);
    let anim = 0;
    const boucle = () => { anim = requestAnimationFrame(boucle); if (controls.update()) rendre(); };
    controls.addEventListener('change', rendre);
    boucle();
    taille();
    return () => {
      cancelAnimationFrame(anim);
      obs.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => x.dispose());
      });
      renderer.dispose();
      renderer.domElement.remove();
      moteur.current = null;
    };
  }, []);

  // Cadrage : à chaque nouveau volume (vue 3/4 depuis le sud-ouest, comme la vue « 3/4 gauche »).
  useEffect(() => {
    const m = moteur.current;
    if (!m) return;
    const sc = sceneApercu(apercu, choix, limites);
    const [cx, cy] = sc.centre;
    const d = Math.max(sc.rayon * 1.8, sc.hauteurMax * 3, 30);
    m.controls.target.set(cx, sc.hauteurMax * 0.3, -cy);
    m.camera.position.set(cx - d * 0.66, d * 0.42, -cy + d * 0.66);
    m.controls.minDistance = d * 0.25;
    m.controls.maxDistance = d * 2.2;
    m.sol.scale.setScalar(sc.rayon * 3);
    m.sol.position.set(cx, -0.02, -cy);
    m.controls.update();
    m.rendre();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apercu]);

  // Habillage : reconstruit à chaque choix (quelques milliers de boîtes au plus, instantané).
  useEffect(() => {
    const m = moteur.current;
    if (!m) return;
    const sc = sceneApercu(apercu, choix, limites);
    const col = couleurs(choix);
    const lum = lumiere(choix.ambiance);
    for (const o of [...m.groupe.children]) {
      m.groupe.remove(o);
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => x.dispose());
    }
    // Parcelle : aplat clair et contour.
    if (sc.contour) {
      const forme = new THREE.Shape(sc.contour.map(([x, y]) => new THREE.Vector2(x, y)));
      const plat = new THREE.Mesh(new THREE.ShapeGeometry(forme), new THREE.MeshStandardMaterial({ color: choix.ambiance === 'nuit' ? 0x3a4150 : 0xf4f1ea, roughness: 1 }));
      plat.rotation.x = -Math.PI / 2;
      plat.position.y = 0.01;
      plat.receiveShadow = true;
      m.groupe.add(plat);
      const ligne = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(sc.contour.map(([x, y]) => new THREE.Vector3(x, 0.05, -y))), new THREE.LineBasicMaterial({ color: 0x7a6fd0 }));
      m.groupe.add(ligne);
    }
    // Boîtes, regroupées par matière et opacité.
    const groupes = new Map<string, typeof sc.boites>();
    for (const b of sc.boites) {
      const k = `${b.m}|${b.opacite ?? 1}`;
      const l = groupes.get(k) ?? [];
      l.push(b);
      groupes.set(k, l);
    }
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
    for (const [k, liste] of groupes) {
      const [matiere, op] = k.split('|') as [Matiere, string];
      const opacite = Number(op);
      const couleur = new THREE.Color(col[matiere]);
      const materiau = new THREE.MeshStandardMaterial({
        color: couleur, roughness: RUGOSITE[matiere], metalness: matiere === 'gardeCorps' ? 0.4 : 0,
        transparent: opacite < 1, opacity: opacite,
        emissive: matiere === 'vitrageAllume' || (matiere === 'vitrine' && lum.fenetresAllumees) ? couleur : new THREE.Color(0x000000),
        emissiveIntensity: matiere === 'vitrageAllume' || matiere === 'vitrine' ? 0.9 : 0,
      });
      const inst = new THREE.InstancedMesh(geo, materiau, liste.length);
      liste.forEach((b, i) => {
        p.set(...b.p); s.set(...b.s); q.setFromEuler(e.set(0, b.r, 0));
        inst.setMatrixAt(i, mat4.compose(p, q, s));
      });
      inst.castShadow = matiere === 'mur' || matiere === 'dalle' || matiere === 'soubassement';
      inst.receiveShadow = true;
      m.groupe.add(inst);
    }
    // Toits à deux pans (lot brief-unifié).
    for (const t of sc.toits) {
      const toit = new THREE.Mesh(geometrieToit(t.l, t.h > 0 ? t.p : 1, t.h), new THREE.MeshStandardMaterial({ color: new THREE.Color(col.toiture), roughness: RUGOSITE.toiture, side: THREE.DoubleSide }));
      toit.position.set(t.cx, t.base, -t.cy);
      toit.rotation.y = (t.a * Math.PI) / 180;
      toit.castShadow = true;
      toit.receiveShadow = true;
      m.groupe.add(toit);
    }
    // Lumière de l'ambiance (indicative).
    m.scene.background = new THREE.Color(lum.ciel);
    (m.sol.material as THREE.MeshStandardMaterial).color.set(lum.sol);
    m.ambiante.color.set(lum.fenetresAllumees ? '#a9b8dc' : '#ffffff');
    m.ambiante.intensity = lum.ambiante;
    m.soleil.color.set(lum.soleil);
    m.soleil.intensity = lum.intensiteSoleil;
    const [cx, cy] = sc.centre;
    const el = (lum.elevationDeg * Math.PI) / 180;
    const R = sc.rayon * 3;
    m.soleil.position.set(cx - R * Math.cos(el) * 0.7, R * Math.sin(el), -cy + R * Math.cos(el) * 0.7);
    m.soleil.target.position.set(cx, 0, -cy);
    const cam = m.soleil.shadow.camera;
    cam.left = cam.bottom = -sc.rayon * 1.5; cam.right = cam.top = sc.rayon * 1.5; cam.near = 1; cam.far = R * 3;
    cam.updateProjectionMatrix();
    m.rendre();
  }, [apercu, choix, limites]);

  return <div ref={hote} className="mz-brief__apercu3d" role="img" aria-label="Aperçu 3D de votre volume, habillé selon vos choix (faites-le tourner du doigt ou à la souris)" />;
}
