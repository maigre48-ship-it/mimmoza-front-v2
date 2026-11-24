// npx tsx --test src/spaces/copilot/studio3d/modeleBatimentChat.test.ts
// VIS-25 lot B — carte « Votre bâtiment » du modèle composé : lecture sans confiance, aperçu (plan + façade), liste et
// portée honnête, état de la carte (envoyée / remplacée), message du bouton « Reproduire en 3D ».
import assert from 'node:assert/strict';
import test from 'node:test';
import { etatCarte, facadePrincipale, groupesListe, lireCarteModele, phrasePortee, planVuDeDessus, STATUTS_RENDU } from './modeleBatimentChat.ts';
import { empreinteModele, validerModele, type ModeleBatiment } from '../../../lib/studio/modeleBatiment.ts';
import { EXEMPLE_COLLECTIF_U, EXEMPLE_MAISON_BASQUE, EXEMPLE_MAISON_TOURELLE, EXEMPLE_VILLA_L } from '../../../lib/studio/modeleBatimentExemples.ts';
import { messageReproduireModele, sansBlocReference } from '../../../lib/studio/modeleBatimentMessage.ts';
import { sansBlocDescription } from '../../../lib/studio/descriptionBatiment.ts';

function valide(brut: unknown): ModeleBatiment {
  const v = validerModele(brut);
  if (!v.ok) throw new Error(v.erreur);
  return v.modele;
}
const sortie = (m: ModeleBatiment, extra: Record<string, unknown> = {}) => ({
  status: 'ok', source: 'MimmozIA · Studio 3D', data: { carte: 'modele', empreinte: empreinteModele(m), corrections: ['pente ramenée à 75'], modele: m, ...extra },
});

test('lecture : sortie valide → carte ; en cours, autre outil, refus ou modèle abîmé → rien', () => {
  const m = valide(EXEMPLE_MAISON_BASQUE);
  const c = lireCarteModele({ name: 'studio_dessiner_batiment', status: 'success', output: sortie(m) });
  assert.ok(c);
  assert.equal(c!.empreinte, empreinteModele(m));
  assert.deepEqual(c!.corrections, ['pente ramenée à 75']);
  assert.equal(c!.retouche, false);
  const r = lireCarteModele({ name: 'studio_retoucher_batiment', status: 'success', output: sortie(m, { retouche_de: 'mb1-00000000', fait: ['ajouté : lucarne (o1)'] }) });
  assert.ok(r?.retouche && r.fait.length === 1);
  assert.equal(lireCarteModele({ name: 'studio_dessiner_batiment', status: 'running', output: sortie(m) }), null);
  assert.equal(lireCarteModele({ name: 'studio_decrire_batiment', status: 'success', output: sortie(m) }), null);
  assert.equal(lireCarteModele({ name: 'studio_dessiner_batiment', status: 'error', output: { status: 'error' } }), null);
  assert.equal(lireCarteModele({ name: 'studio_dessiner_batiment', status: 'success', output: sortie({ ...m, volumes: 'abîmé' } as unknown as ModeleBatiment) }), null);
  const photo = valide({ ...EXEMPLE_VILLA_L, origine: 'photo' });
  assert.match(lireCarteModele({ name: 'studio_dessiner_batiment', output: sortie(photo) })!.mentionPhoto ?? '', /référence de style/);
});

test('aperçu : un polygone par volume (plan), murs + toit par volume et ouvertures sur rue (façade), nombres finis', () => {
  for (const brut of [EXEMPLE_MAISON_BASQUE, EXEMPLE_VILLA_L, EXEMPLE_MAISON_TOURELLE, EXEMPLE_COLLECTIF_U]) {
    const m = valide(brut);
    const p = planVuDeDessus(m);
    assert.equal(p.volumes.length, m.volumes.length);
    assert.ok(p.volumes.every((v) => v.points.split(' ').length >= 3));
    assert.ok(!/NaN|Infinity/.test(JSON.stringify(p)), 'plan sans valeur non finie');
    assert.equal(p.viewBox.split(' ').length, 4);
    const f = facadePrincipale(m);
    assert.equal(f.murs.length, m.volumes.length);
    assert.equal(f.toits.length, m.volumes.length);
    assert.ok(!/NaN|Infinity/.test(JSON.stringify(f)), 'façade sans valeur non finie');
  }
  const basque = facadePrincipale(valide(EXEMPLE_MAISON_BASQUE));
  // Porte + 2 fenêtres au RDC + 3 fenêtres à l'étage + porte de garage, sur la rue ; rien de la façade arrière.
  assert.equal(basque.ouvertures.filter((o) => o.type === 'fenetre').length, 5);
  assert.ok(basque.ouvertures.some((o) => o.type === 'porte_garage'));
  assert.ok(!basque.ouvertures.some((o) => o.type === 'porte_fenetre'), 'les portes-fenêtres sont à l’arrière');
  // La rue est en bas du plan (y SVG plus grand que tous les volumes).
  const plan = planVuDeDessus(valide(EXEMPLE_MAISON_BASQUE));
  const ys = plan.volumes.flatMap((v) => v.points.split(' ').map((c) => Number(c.split(',')[1])));
  assert.ok(plan.rue.y > Math.max(...ys));
});

test('liste : volumes, toits, ouvertures, éléments, matières, chacun avec sa portée ; pied de carte lisible', () => {
  const g = groupesListe(valide(EXEMPLE_MAISON_BASQUE), STATUTS_RENDU);
  assert.deepEqual(g.map((x) => x.titre), ['Volumes', 'Toits', 'Ouvertures', 'Éléments', 'Matières']);
  assert.ok(g.every((x) => x.lignes.every((l) => l.portee === 'images' || l.portee === '3d' || l.portee === 'aucune')));
  // Même règle que le moteur du Studio : un élément « autre » sans briques est noté, pas dessiné — et c'est dit.
  const avecAutre = groupesListe(valide({ ...EXEMPLE_MAISON_BASQUE, elements: [...EXEMPLE_MAISON_BASQUE.elements, { id: 'four', type: 'autre', nom: 'four à pain', volume: 'principal' }] }), STATUTS_RENDU);
  const four = avecAutre.find((x) => x.categorie === 'element')!.lignes.find((l) => l.id === 'four');
  assert.equal(four?.portee, 'aucune');
  assert.match(phrasePortee(avecAutre), /1 noté, pas dessiné/);
  assert.ok(g.find((x) => x.categorie === 'volume')!.lignes.some((l) => /Garage/.test(l.libelle)));
  assert.match(phrasePortee(g), /^\d+ parties dans la 3D et les images/);
});

test('état : à envoyer → envoyée (référence plus bas) ; remplacée par une retouche plus bas', () => {
  const m = valide(EXEMPLE_MAISON_BASQUE);
  const e = empreinteModele(m);
  const carte = { id: 'a1', role: 'assistant', text: 'Voici', toolCalls: [{ name: 'studio_dessiner_batiment', status: 'success', output: sortie(m) }] };
  assert.equal(etatCarte([carte], 'a1', e), 'a_envoyer');
  const envoi = { id: 'u2', role: 'user', text: messageReproduireModele(m, e) };
  assert.equal(etatCarte([carte, envoi], 'a1', e), 'envoyee');
  const m2 = valide({ ...EXEMPLE_MAISON_BASQUE, nom: 'Maison basque retouchée' });
  const retouche = { id: 'a3', role: 'assistant', text: 'Fait', toolCalls: [{ name: 'studio_retoucher_batiment', status: 'success', output: sortie(m2, { retouche_de: e }) }] };
  assert.equal(etatCarte([carte, { id: 'u2', role: 'user', text: 'ajoute une lucarne' }, retouche], 'a1', e), 'remplacee');
  assert.equal(etatCarte([carte, envoi, retouche], 'a1', e), 'envoyee');
});

test('bulle de l’utilisateur : la référence et la description sont masquées, le texte reste', () => {
  const m = valide(EXEMPLE_MAISON_TOURELLE);
  const t = messageReproduireModele(m, empreinteModele(m));
  const visible = sansBlocDescription(sansBlocReference(t).visible).visible;
  assert.ok(!visible.includes('```mimmoza-modele-ref') && !visible.includes('```mimmoza-batiment'));
  assert.match(visible, /^Reproduis ce bâtiment en 3D/);
});

test('modèle en vigueur (Voir en 3D) : celui du dernier « Reproduire en 3D » ; un habillage choisi ensuite le remplace', async () => {
  const { modeleCourant } = await import('./modeleBatimentChat.ts');
  const m = valide(EXEMPLE_MAISON_BASQUE); const e = empreinteModele(m);
  const m2 = valide({ ...EXEMPLE_MAISON_BASQUE, nom: 'Maison basque retouchée' }); const e2 = empreinteModele(m2);
  const cartes = [
    { id: 'a1', role: 'assistant', text: '', toolCalls: [{ name: 'studio_dessiner_batiment', status: 'success', output: sortie(m) }] },
    { id: 'a2', role: 'assistant', text: '', toolCalls: [{ name: 'studio_retoucher_batiment', status: 'success', output: sortie(m2, { retouche_de: e }) }] },
  ];
  assert.equal(modeleCourant(cartes), null);
  assert.equal(modeleCourant([...cartes, { id: 'u', role: 'user', text: messageReproduireModele(m2, e2) }])?.nom, 'Maison basque retouchée');
  assert.equal(modeleCourant([...cartes, { id: 'u', role: 'user', text: messageReproduireModele(m, e) }])?.nom, m.nom);
  const habillage = { id: 'u2', role: 'user', text: 'Habillage\n\n```mimmoza-brief\n{"v":1,"brief":{}}\n```' };
  assert.equal(modeleCourant([...cartes, { id: 'u', role: 'user', text: messageReproduireModele(m, e) }, habillage]), null);
});
