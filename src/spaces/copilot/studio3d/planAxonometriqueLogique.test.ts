import assert from 'node:assert/strict';
import test from 'node:test';
import { calculerVolumeParcelle, type GeometrieParcelle, type ProgrammeVolume } from './volumeParcelle.ts';
import {
  ANGLE_AXO_DEG, boitesSeChevauchent, construirePlanAxo, couperLignes, directionNordEcran, echapperXml, faceVisible,
  nomFichierPlan, orientationConnue, projeterAxo, svgPlanAxo, tournerAxo, type RotationAxo,
} from './planAxonometriqueLogique.ts';

const LAT = 48.87, LON = 2.18;
const KX = 111_320 * Math.cos(LAT * Math.PI / 180);
function polygone(points: [number, number][], rotationDeg = 0): GeometrieParcelle {
  const a = rotationDeg * Math.PI / 180;
  const ring = points.map(([x, y]) => {
    const xr = x * Math.cos(a) - y * Math.sin(a), yr = x * Math.sin(a) + y * Math.cos(a);
    return [LON + xr / KX, LAT + yr / 111_320];
  });
  return { type: 'Polygon', coordinates: [[...ring, ring[0]]] };
}
const rectangle = (l: number, h: number, rot = 0) => polygone([[0, 0], [l, 0], [l, h], [0, h]], rot);
const LOGTS = (n: number): ProgrammeVolume => ({ logements: n, libelle: `${n} logements sociaux`, origine: 'conversation' });
const REGLES_AUCUNE = { source: 'aucune', regles: [], nonAppliquees: [] } as const;
const ROTATIONS: RotationAxo[] = [0, 1, 2, 3];
const proche = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test(`projection planométrique ${ANGLE_AXO_DEG}° : parallèle, plan non déformé, verticales verticales à la même échelle`, () => {
  const s = Math.SQRT1_2;
  const est = projeterAxo({ x: 1, y: 0, z: 0 }, 0), nord = projeterAxo({ x: 0, y: 1, z: 0 }, 0), haut = projeterAxo({ x: 0, y: 0, z: 1 }, 0);
  proche(est.x, s); proche(est.y, -s);
  proche(nord.x, -s); proche(nord.y, -s);
  proche(haut.x, 0); proche(haut.y, -1);
  for (const r of ROTATIONS) {
    // Longueurs vraies dans toutes les directions du plan et à la verticale.
    for (const deg of [0, 17, 45, 90, 133, 271]) {
      const a = deg * Math.PI / 180, p = projeterAxo({ x: 10 * Math.cos(a), y: 10 * Math.sin(a), z: 0 }, r);
      proche(Math.hypot(p.x, p.y), 10, 1e-9);
    }
    const v = projeterAxo({ x: 0, y: 0, z: 7 }, r);
    proche(v.x, 0); proche(v.y, -7);
    // Linéarité (projection parallèle, pas de fuite).
    const a = { x: 3, y: -2, z: 5 }, b = { x: -7, y: 4, z: 1 };
    const pa = projeterAxo(a, r), pb = projeterAxo(b, r), pab = projeterAxo({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }, r);
    proche(pab.x, pa.x + pb.x); proche(pab.y, pa.y + pb.y);
    // Angles du plan conservés (un angle droit reste droit).
    const u = projeterAxo({ x: 4, y: 1, z: 0 }, r), w = projeterAxo({ x: -1, y: 4, z: 0 }, r);
    proche(u.x * w.x + u.y * w.y, 0);
  }
});

test('rotation par pas de 90° : quatre vues distinctes, la cinquième revient à la première', () => {
  assert.deepEqual([0, 1, 2, 3].map(r => tournerAxo(r as RotationAxo)), [1, 2, 3, 0]);
  const vues = ROTATIONS.map(r => projeterAxo({ x: 10, y: 3, z: 0 }, r)).map(p => `${p.x.toFixed(6)},${p.y.toFixed(6)}`);
  assert.equal(new Set(vues).size, 4);
  const n0 = directionNordEcran(0), n2 = directionNordEcran(2);
  proche(n0.x, -n2.x); proche(n0.y, -n2.y);
});

test('faces vues : deux faces verticales par vue, et chacune des quatre faces vue au moins une fois sur les quatre rotations', () => {
  const coins = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 16 }, { x: 0, y: 16 }];
  const centre = { x: 20, y: 8 };
  const vuesParFace = [0, 0, 0, 0];
  for (const r of ROTATIONS) {
    const vues = coins.map((a, i) => faceVisible(a, coins[(i + 1) % 4], centre, r));
    assert.equal(vues.filter(Boolean).length, 2, `rotation ${r}`);
    vues.forEach((v, i) => { if (v) vuesParFace[i]++; });
  }
  assert.deepEqual(vuesParFace, [2, 2, 2, 2]);
});

test('plan construit : 3 tons de faces, planchers, cotes L/P/H vraies et sans chevauchement, dans le cadre', () => {
  for (const rot of [0, 20, 63, 90]) {
    const v = calculerVolumeParcelle(rectangle(70, 50, rot), LOGTS(40), REGLES_AUCUNE);
    assert.ok(v.emprise);
    for (const r of ROTATIONS) {
      for (const largeur of [640, 360]) {
        const plan = construirePlanAxo(v, { rotation: r, largeur });
        assert.deepEqual(plan.faces.map(f => f.ton).sort(), ['dessus', 'droite', 'gauche'], `rot ${rot} vue ${r}`);
        assert.equal(plan.planchers.length, 2 * (v.niveaux - 1));
        assert.deepEqual(plan.cotes.map(c => c.lettre), ['L', 'P', 'H']);
        const [L, P, H] = plan.cotes;
        // Cotation vraie : la longueur dessinée divisée par l'échelle redonne la dimension.
        proche(Math.hypot(L.ligne[1].x - L.ligne[0].x, L.ligne[1].y - L.ligne[0].y) / plan.echelle, v.emprise.largeurM, 1e-6);
        proche(Math.hypot(P.ligne[1].x - P.ligne[0].x, P.ligne[1].y - P.ligne[0].y) / plan.echelle, v.emprise.profondeurM, 1e-6);
        proche(Math.abs(H.ligne[1].y - H.ligne[0].y) / plan.echelle, v.hauteurM, 1e-6);
        assert.match(H.texte, /R\+\d/);
        assert.equal(L.attaches.length, 2);
        // Aucune valeur de cote ne chevauche une autre, toutes restent dans la largeur du dessin.
        for (let i = 0; i < plan.cotes.length; i++) {
          for (let j = i + 1; j < plan.cotes.length; j++) assert.ok(!boitesSeChevauchent(plan.cotes[i].boite, plan.cotes[j].boite), `chevauchement ${plan.cotes[i].lettre}/${plan.cotes[j].lettre} (rot ${rot}, vue ${r}, ${largeur})`);
          const b = plan.cotes[i].boite;
          assert.ok(b.x0 >= 0 && b.x1 <= largeur && b.y0 >= 0 && b.y1 <= plan.hauteurDessin, `cote ${plan.cotes[i].lettre} hors cadre (rot ${rot}, vue ${r}, ${largeur})`);
        }
        for (const p of [...plan.parcelle, ...plan.faces.flatMap(f => f.points)]) assert.ok(p.x >= 0 && p.x <= largeur && p.y >= 0 && p.y <= plan.hauteurDessin);
      }
    }
  }
});

test('emprise alignée sur l’axe de vue (45°) : une seule face verticale vue, cotes toujours lisibles', () => {
  const v = calculerVolumeParcelle(rectangle(70, 50, 45), LOGTS(40), REGLES_AUCUNE);
  for (const r of ROTATIONS) {
    const plan = construirePlanAxo(v, { rotation: r });
    assert.ok(plan.faces.length >= 2 && plan.faces.at(-1)?.ton === 'dessus');
    const [a, b, c] = plan.cotes.map(x => x.boite);
    assert.ok(!boitesSeChevauchent(a, b) && !boitesSeChevauchent(a, c) && !boitesSeChevauchent(b, c));
  }
});

test('flèche du nord seulement si l’orientation est connue ; échelle graphique 10/20 m vraie', () => {
  const v = calculerVolumeParcelle(rectangle(70, 50), LOGTS(40), REGLES_AUCUNE);
  assert.ok(orientationConnue(v));
  const plan = construirePlanAxo(v);
  assert.ok(plan.nord);
  const sans = { ...v, origine: { lon: Number.NaN, lat: Number.NaN } };
  assert.equal(orientationConnue(sans), false);
  assert.equal(construirePlanAxo(sans).nord, null);
  assert.equal(svgPlanAxo(sans, { idu: '92050000AN0412', mention: v.mentionPlu }).includes('>N</text>'), false);
  const g = plan.echelleGraphique;
  proche(g.longueurPx, g.longueurM * plan.echelle);
  assert.ok([10, 20, 50, 100, 200].includes(g.longueurM));
  assert.equal(g.longueurM, 2 * g.pas);
});

test('SVG autonome : titre et description, cartouche complet, mention obligatoire, texte échappé', () => {
  const v = calculerVolumeParcelle(rectangle(70, 50), LOGTS(40), REGLES_AUCUNE);
  const svg = svgPlanAxo(v, { idu: '92050000AN0412', reference: 'AN 0412', zone: 'UB<b>', programme: '40 logements sociaux', mention: v.mentionPlu });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 640 \d+"/);
  assert.ok(svg.endsWith('</svg>'));
  assert.match(svg, /<title id="axo-titre">Plan axonométrique — parcelle AN 0412, zone UB&lt;b&gt;<\/title>/);
  assert.match(svg, /<desc id="axo-desc">[^<]*Hypothèse — règlement PLU non lu/);
  for (const attendu of ['IDU 92050000AN0412', 'Programme : 40 logements sociaux', `R+${v.niveaux - 1}`, 'SDP estimée', 'Hypothèse', 'data-cote="L"', 'data-cote="P"', 'data-cote="H"', 'marker-end="url(#axo-fleche)"', '>N</text>']) {
    assert.ok(svg.includes(attendu), attendu);
  }
  assert.equal(/NaN|undefined|Infinity/.test(svg), false);
  assert.equal(svg.includes('<b>'), false);
  assert.equal(echapperXml(`a<&>"'`), 'a&lt;&amp;&gt;&quot;&apos;');
  assert.equal(nomFichierPlan('92050000AN0412', 2, 'png'), 'plan-axo-92050000AN0412-vue3.png');
});

test('coupe de lignes du cartouche', () => {
  assert.deepEqual(couperLignes('Règles PLU appliquées — conformité à vérifier par un professionnel', 24), ['Règles PLU appliquées —', 'conformité à vérifier', 'par un professionnel']);
  assert.deepEqual(couperLignes('', 10), []);
});
