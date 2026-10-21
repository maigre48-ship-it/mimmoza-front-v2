import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { JarvisMassing } from './jarvisDraft';
import { levelFootprint, previewRoof, type MassingRect } from './massingGeometry';
import type { TerrainStudio } from '@/spaces/promoteur/shared/ouvrirStudio3D';
import { terrainElevationAt } from './terrainEarthworks';
import type { AccessRoute } from './accessRoutes';

/** Grille WGS84 sud → nord de terrain-analysis-v1, convertie en mètres autour de son centre. */
function measuredGround(terrain: TerrainStudio): THREE.BufferGeometry {
  const { n, z } = terrain.grid;
  const [west, south, east, north] = terrain.renderBounds;
  const latitude = (south + north) / 2 * Math.PI / 180;
  const width = (east - west) * 111_320 * Math.cos(latitude);
  const depth = (north - south) * 111_320;
  const reference = z[Math.floor(n / 2)]?.[Math.floor(n / 2)] ?? terrain.altitudeMin;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
    positions.push(-width / 2 + col / (n - 1) * width, z[row][col] - reference - 0.06, depth / 2 - row / (n - 1) * depth);
    if (row < n - 1 && col < n - 1) {
      const a = row * n + col, b = a + 1, c = a + n, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function addRoof(scene: THREE.Object3D, rect: MassingRect, y: number, style: ReturnType<typeof previewRoof>, material: THREE.Material) {
  if (style === 'terrasse') {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(rect.width + .24, .24, rect.depth + .24), material);
    mesh.position.set(rect.x, y + .12, rect.z);
    scene.add(mesh);
    return;
  }
  const w = rect.width / 2, d = rect.depth / 2, rise = Math.min(4.5, rect.depth * .32);
  const vertices: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => vertices.push(...a, ...b, ...c);
  const frontLeft = [-w, y, -d], frontRight = [w, y, -d];
  const backLeft = [-w, y, d], backRight = [w, y, d];
  if (style === 'deux-pans') {
    const ridgeLeft = [-w, y + rise, 0], ridgeRight = [w, y + rise, 0];
    tri(frontLeft, frontRight, ridgeRight); tri(frontLeft, ridgeRight, ridgeLeft);
    tri(ridgeLeft, ridgeRight, backRight); tri(ridgeLeft, backRight, backLeft);
    tri(frontLeft, ridgeLeft, backLeft); tri(frontRight, backRight, ridgeRight);
  } else {
    const ridgeLength = Math.max(0, w - d);
    const ridgeLeft = [-ridgeLength, y + rise, 0], ridgeRight = [ridgeLength, y + rise, 0];
    tri(frontLeft, frontRight, ridgeRight); tri(frontLeft, ridgeRight, ridgeLeft);
    tri(ridgeLeft, ridgeRight, backRight); tri(ridgeLeft, backRight, backLeft);
    tri(frontLeft, ridgeLeft, backLeft); tri(frontRight, backRight, ridgeRight);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(rect.x, 0, rect.z);
  scene.add(mesh);
}

/** Aperçu géométrique local ; le relief apparaît après confirmation de la parcelle. */
export function JarvisMassingPreview({ massing, panorama, terrain, implantation, routes = [], autoRotate = false, light = false }: { massing: JarvisMassing; autoRotate?: boolean; light?: boolean; panorama?: { url: string; kind: 'image' | 'video' } | null; terrain?: TerrainStudio | null; implantation?: { lon: number; lat: number; orientationDeg: number; entryOffsetM: number } | null; routes?: AccessRoute[] }) {
  const host = useRef<HTMLDivElement>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const buildingKey = JSON.stringify(massing.buildings);

  useEffect(() => {
    if (!expanded) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [expanded]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      setUnavailable(true);
      return;
    }
    setUnavailable(false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    element.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(light ? '#f1f2f8' : '#091827');
    let panoramaTexture: THREE.Texture | undefined;
    let panoramaVideo: HTMLVideoElement | undefined;
    let panoramaSphere: THREE.Mesh | undefined;
    if (panorama) {
      if (panorama.kind === 'video') {
        panoramaVideo = document.createElement('video');
        panoramaVideo.src = panorama.url;
        panoramaVideo.loop = true;
        panoramaVideo.muted = true;
        panoramaVideo.playsInline = true;
        panoramaVideo.autoplay = true;
        void panoramaVideo.play().catch(() => undefined);
        panoramaTexture = new THREE.VideoTexture(panoramaVideo);
      } else {
        panoramaTexture = new THREE.TextureLoader().load(panorama.url);
      }
      panoramaTexture.colorSpace = THREE.SRGBColorSpace;
      const sphereGeometry = new THREE.SphereGeometry(450, 64, 32);
      sphereGeometry.scale(-1, 1, 1);
      panoramaSphere = new THREE.Mesh(sphereGeometry,
        new THREE.MeshBasicMaterial({ map: panoramaTexture, side: THREE.FrontSide, depthWrite: false }));
      panoramaSphere.renderOrder = -1;
      scene.add(panoramaSphere);
    }
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1000);
    const buildings = massing.buildings ?? [{ name: '', largeurM: massing.largeurM, profondeurM: massing.profondeurM, niveaux: massing.niveaux, appearance: massing.appearance, segments: massing.segments, facadeRules: massing.facadeRules }];
    const height = Math.max(...buildings.map(building => building.niveaux * 3));
    const separation = massing.separationM ?? 8;
    const totalDepth = buildings.reduce((sum, building) => sum + building.profondeurM, 0) + (buildings.length - 1) * separation;
    const terrainWidth = terrain ? (terrain.renderBounds[2] - terrain.renderBounds[0]) * 111_320 * Math.cos((terrain.renderBounds[1] + terrain.renderBounds[3]) / 2 * Math.PI / 180) : 0;
    const terrainDepth = terrain ? (terrain.renderBounds[3] - terrain.renderBounds[1]) * 111_320 : 0;
    const span = Math.max(...buildings.map(building => building.largeurM), totalDepth, height, terrainWidth, terrainDepth);
    camera.position.set(span * 1.2, height + span * 0.65, -span * 1.35);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 0.7;
    controls.enablePan = false;
    controls.minDistance = span * 0.85;
    controls.maxDistance = span * 4;
    controls.maxPolarAngle = Math.PI * 0.48;
    const targetX = terrain && implantation ? (implantation.lon - (terrain.renderBounds[0] + terrain.renderBounds[2]) / 2) * 111_320 * Math.cos(implantation.lat * Math.PI / 180) : 0;
    const targetZ = terrain && implantation ? ((terrain.renderBounds[1] + terrain.renderBounds[3]) / 2 - implantation.lat) * 111_320 : 0;
    controls.target.set(targetX, height * 0.48, targetZ);
    camera.position.x += targetX; camera.position.z += targetZ;
    controls.update();

    scene.add(new THREE.AmbientLight('#c9e8ff', 2.0));
    const sun = new THREE.DirectionalLight('#ffffff', 3.0);
    sun.position.set(-25, 40, -35);
    scene.add(sun);
    const terrainMaterial = terrain ? new THREE.MeshStandardMaterial({ color: '#547d69', roughness: 0.95, side: THREE.DoubleSide, flatShading: false }) : null;
    if (terrain && terrainMaterial) {
      const measured = new THREE.Mesh(measuredGround(terrain), terrainMaterial);
      measured.name = 'Relief mesuré de la parcelle';
      scene.add(measured);
    } else {
      scene.add(new THREE.GridHelper(span * 2.7, 20, light ? '#aaa4d2' : '#285675', light ? '#d6d2e8' : '#17354c'));
    }

    const facadeColors = { brique: '#a85e4e', bois: '#a67b50', 'beton-blanc': '#d6d5cf', 'beton-brut': '#888e91', verre: '#3d8eab' };
    const styleColors = light
      ? { contemporain: '#c8bfae', haussmannien: '#d4c5ad', traditionnel: '#bdab8f', industriel: '#adb3ba' }
      : { contemporain: '#668eac', haussmannien: '#c6bba8', traditionnel: '#b79d7b', industriel: '#84949d' };
    const slab = new THREE.MeshStandardMaterial({ color: light ? '#49ae93' : '#48d7ee', metalness: 0.5, roughness: 0.35 });
    const roof = new THREE.MeshStandardMaterial({ color: light ? '#696685' : '#284b67', metalness: 0.28, roughness: 0.65, side: THREE.DoubleSide });
    const walls: THREE.MeshStandardMaterial[] = [];
    const volumes = new THREE.Group();
    volumes.name = 'Implantation du projet';
    if (terrain && implantation) {
      const reference = terrain.grid.z[Math.floor(terrain.grid.n / 2)]?.[Math.floor(terrain.grid.n / 2)] ?? terrain.altitudeMin;
      volumes.position.set(targetX, terrainElevationAt(terrain, implantation.lon, implantation.lat) + implantation.entryOffsetM - reference, targetZ);
      volumes.rotation.y = -implantation.orientationDeg * Math.PI / 180;
    }
    scene.add(volumes);
    const routeMaterials: THREE.MeshStandardMaterial[] = [];
    if (terrain) {
      const reference = terrain.grid.z[Math.floor(terrain.grid.n / 2)]?.[Math.floor(terrain.grid.n / 2)] ?? terrain.altitudeMin;
      const originLon = (terrain.renderBounds[0] + terrain.renderBounds[2]) / 2;
      const originLat = (terrain.renderBounds[1] + terrain.renderBounds[3]) / 2;
      const local = (lon: number, lat: number, level: number) => new THREE.Vector3(
        (lon - originLon) * 111_320 * Math.cos(originLat * Math.PI / 180), level - reference + .09,
        (originLat - lat) * 111_320);
      for (const route of routes) {
        const material = new THREE.MeshStandardMaterial({ color: route.insideParcel ? route.kind === 'pieton' ? '#39dabc' : '#e9a851' : '#f07587', roughness: .85, side: THREE.DoubleSide });
        routeMaterials.push(material);
        for (let i = 1; i < route.profile.length; i++) {
          const a = route.profile[i - 1]!, b = route.profile[i]!;
          const t0 = (i - 1) / (route.profile.length - 1), t1 = i / (route.profile.length - 1);
          const start = local(route.gate.lon + (route.entrance.lon - route.gate.lon) * t0, route.gate.lat + (route.entrance.lat - route.gate.lat) * t0, a.pathM);
          const end = local(route.gate.lon + (route.entrance.lon - route.gate.lon) * t1, route.gate.lat + (route.entrance.lat - route.gate.lat) * t1, b.pathM);
          const segment = new THREE.Mesh(new THREE.BoxGeometry(route.kind === 'pieton' ? 1.5 : 3.2, .1, start.distanceTo(end)), material);
          segment.position.copy(start).add(end).multiplyScalar(.5);
          segment.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), end.clone().sub(start).normalize());
          scene.add(segment);
        }
      }
    }
    let startZ = -totalDepth / 2;
    for (const building of buildings) {
      const centerZ = startZ + building.profondeurM / 2;
      startZ += building.profondeurM + separation;
      const facadeColor = building.appearance.facade ? facadeColors[building.appearance.facade]
        : building.appearance.architecturalStyle ? styleColors[building.appearance.architecturalStyle] : '#618fae';
      const wall = new THREE.MeshStandardMaterial({ color: facadeColor, metalness: 0.18, roughness: 0.72 });
      walls.push(wall);
      for (let floor = 0; floor < building.niveaux; floor++) {
        const rectangles = levelFootprint(building, floor);
        for (const base of rectangles) {
          const rect = { ...base, z: base.z + centerZ };
          const level = new THREE.Mesh(new THREE.BoxGeometry(rect.width, 2.82, rect.depth), wall);
          level.position.set(rect.x, floor * 3 + 1.5, rect.z);
          volumes.add(level);
          const band = new THREE.Mesh(new THREE.BoxGeometry(rect.width + .12, .18, rect.depth + .12), slab);
          band.position.set(rect.x, floor * 3 + .09, rect.z);
          volumes.add(band);
          if (rect.topLevel === floor + 1
            || (floor < building.niveaux - 1 && (building.appearance.shape === 'gradins' || building.appearance.shape === 'socle-tour'))) {
            addRoof(volumes, rect, (floor + 1) * 3, 'terrasse', roof);
          }
        }
      }
      for (const base of building.segments ? [] : levelFootprint(building, building.niveaux - 1))
        addRoof(volumes, { ...base, z: base.z + centerZ }, building.niveaux * 3, previewRoof(building), roof);
    }

    const resize = () => {
      const width = Math.max(element.clientWidth, 1);
      const canvasHeight = Math.max(element.clientHeight, 1);
      renderer.setSize(width, canvasHeight, false);
      camera.aspect = width / canvasHeight;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    let frame = 0;
    const render = () => {
      frame = window.requestAnimationFrame(render);
      controls.update();
      if (panoramaSphere) panoramaSphere.position.copy(camera.position);
      renderer.render(scene, camera);
    };
    render();
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      scene.traverse(object => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      walls.forEach(wall => wall.dispose()); routeMaterials.forEach(material => material.dispose()); slab.dispose(); roof.dispose();
      terrainMaterial?.dispose();
      panoramaVideo?.pause();
      panoramaVideo?.removeAttribute('src');
      panoramaVideo?.load();
      panoramaTexture?.dispose();
      if (panoramaSphere) {
        (panoramaSphere.material as THREE.Material).dispose();
      }
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [massing.largeurM, massing.profondeurM, massing.niveaux, massing.appearance.facade, massing.appearance.roof, massing.appearance.shape, massing.appearance.architecturalStyle, JSON.stringify(massing.appearance.articulation), massing.separationM, buildingKey, JSON.stringify(massing.segments), JSON.stringify(massing.facadeRules), panorama?.url, panorama?.kind, terrain, implantation?.lon, implantation?.lat, implantation?.orientationDeg, implantation?.entryOffsetM, JSON.stringify(routes.map(route => [route.kind, route.gate, route.entrance, route.slopePercent])), autoRotate, light]);

  return <figure className={`jarvis-dossier__massing${expanded ? ' is-expanded' : ''}`} aria-label="Aperçu 3D indicatif du projet">
    <figcaption><strong>Aperçu 3D {massing.buildings ? 'des bâtiments' : 'du volume'}</strong><span>Esquisse manipulable</span>
      <button type="button" onClick={() => setExpanded(value => !value)} aria-label={expanded ? 'Réduire la vue 3D' : 'Agrandir la vue 3D'}>
        {expanded ? 'Fermer' : 'Agrandir'}
      </button>
    </figcaption>
    {unavailable ? <div className="jarvis-dossier__massing-fallback">La vue 3D n’est pas disponible sur cet appareil.</div>
      : <div ref={host} className="jarvis-dossier__massing-canvas" aria-hidden="true" />}
    <div className="jarvis-dossier__massing-facts">
      {massing.buildings ? massing.buildings.map(building => <span key={building.name}>{building.name} · {building.largeurM} × {building.profondeurM} m · R+{building.niveaux - 1}{building.appearance.shape ? ` · ${building.appearance.shape.toUpperCase()}` : ''}</span>) : <>
      <span>{massing.largeurM} × {massing.profondeurM} m</span>
      <span>{massing.niveaux} niveaux</span>
      {massing.segments?.map(part => <span key={part.name}>{part.name} · R+{part.niveaux - 1}{part.retraitM ? ` · retrait ${part.retraitM} m` : ''}</span>)}
      {massing.logements !== null && <span>{massing.logements} logements visés</span>}
      <span>Forme · {({ barre: 'barre', l: 'L', u: 'U', t: 'T', h: 'H', cour: 'cour intérieure', gradins: 'gradins', 'socle-tour': 'tour sur socle' })[massing.appearance.shape ?? 'barre']}</span>
      {massing.appearance.architecturalStyle && <span>Style · {massing.appearance.architecturalStyle}</span>}
      {massing.appearance.facade && <span>Façade · {({ brique: 'brique', bois: 'bois', 'beton-blanc': 'béton blanc', 'beton-brut': 'béton brut', verre: 'verre' })[massing.appearance.facade]}</span>}
      {massing.appearance.articulation && <span>Décrochés · {massing.appearance.articulation.depthM} m</span>}
      {massing.facadeRules?.map((rule, index) => <span key={`facade-rule-${index}`}>
        {rule.action === 'retrait' ? 'Retrait' : 'Avancée'} · façade {rule.side}{rule.sideAssumed ? ' supposée' : ''} · {rule.position} · {rule.depthM} m · {rule.widthM ?? '⅓ de façade'}{rule.widthM ? ' m de large' : ' estimé'} · {rule.fromLevel === rule.toLevel ? `R+${rule.fromLevel}` : `dès R+${rule.fromLevel}`}
      </span>)}
      {massing.appearance.roof && <span>Toiture · {({ terrasse: 'terrasse', pente: 'en pente', 'deux-pans': 'deux pans', 'quatre-pans': 'quatre pans' })[massing.appearance.roof]}</span>}
      </>}
      {massing.buildings && <span>{massing.separationM === undefined ? 'Implantation indicative' : `Écart · ${massing.separationM} m`}</span>}
    </div>
    <small>Tournez la vue par glissement. {terrain ? implantation ? `Relief mesuré (${terrain.provider}) ; volume positionné, orienté et calé sur le niveau d’entrée choisi.` : `Relief mesuré (${terrain.provider}) sur la parcelle confirmée ; touchez le plan cadastral pour positionner le bâtiment.` : massing.buildings ? 'Indiquez les dimensions et niveaux de chaque bâtiment. Leur implantation reste indicative et leurs hauteurs individuelles sont à confirmer dans Studio.' : massing.facadeRules?.length ? 'Les portions de façade et leurs niveaux sont indiqués ci-dessus. Vérifiez leur emplacement avant le transfert à Studio.' : massing.segments ? 'Un seul bâtiment, avec hauteur et retrait propres à chaque partie. Vérifiez son implantation sur la parcelle dans Studio.' : 'Dites à Mimmo « en L », « en U », « avec cour intérieure », « en gradins » ou « avec des décrochés de façade ». La pente générique est esquissée à deux pans.'} Façades, ouvertures et PLU se précisent dans Studio.</small>
  </figure>;
}
