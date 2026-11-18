// INTÉGRATION DU 18/11/2026 — lignes de la carte de suivi sur la retouche photoréaliste de l'extension.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lignesRetoucheRealisme, retoucheDuResultat } from './retoucheRealisme.ts';

test('INT-R1 retouche faite : mention et contrôle de forme cités, sans nom interne', () => {
  const l = lignesRetoucheRealisme({ harmonisation: { statut: 'harmonise', mention: 'Matières et lumière de l’extension retouchées pour le réalisme.', controles: { iou: 0.9913 }, preuve_path: 'u/j/retouche-realisme.json' } });
  assert.equal(l.length, 2);
  assert.match(l[1]!, /99,1 %/);
  for (const x of l) assert.doesNotMatch(x, /\blot\b|moteur|worker|serveur|SDXL|G1|G5/i);
});

test('INT-R2 retouche refusée : la raison est dite ; non installée : rien', () => {
  assert.deepEqual(lignesRetoucheRealisme({ harmonisation: { statut: 'non_harmonise', mention: 'Image livrée sans retouche de réalisme : la forme a changé.' } }), ['Image livrée sans retouche de réalisme : la forme a changé.']);
  assert.deepEqual(lignesRetoucheRealisme({ harmonisation: { statut: 'desactive', mention: 'x' } }), []);
  assert.deepEqual(lignesRetoucheRealisme({}), []);
  assert.equal(retoucheDuResultat({ harmonisation: { statut: 'autre' } }), null);
});

// INTÉGRATION 18/11 — carte « Votre photo du trottoir » : une photo en portrait n'est plus refusée.
import { diagnostiquerPhoto, EXIF_ABSENT } from './photoClientLogique.ts';
test('INT-P1 photo en portrait : acceptée avec un conseil, jamais bloquante', () => {
  const l = diagnostiquerPhoto({ type: 'image/jpeg', octets: 3e6, exif: EXIF_ABSENT, largeur: 3024, hauteur: 4032 });
  const p = l.find((x) => /portrait/.test(x.texte))!;
  assert.equal(p.niveau, 'avertissement');
  assert.ok(!l.some((x) => x.niveau === 'bloquant'));
});

// FINITIONS 18/11 — le seuil vient de la machine de rendu (iou_min), plus d'un chiffre écrit en dur côté site.
test('FIN-R1 seuil cité tel que transmis ; absent : pas de minimum inventé', () => {
  const avec = lignesRetoucheRealisme({ harmonisation: { statut: 'harmonise', mention: 'm', iou_min: 0.92, controles: { iou: 0.95 } } });
  assert.match(avec[1]!, /minimum exigé : 92 %/);
  const sans = lignesRetoucheRealisme({ harmonisation: { statut: 'harmonise', mention: 'm', controles: { iou: 0.95 } } });
  assert.doesNotMatch(sans[1]!, /minimum/);
  assert.match(sans[1]!, /95 %/);
});
