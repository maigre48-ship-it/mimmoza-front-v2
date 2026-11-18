// LOT G4 (17/11/2026) — plans de l'extension livrés dans le chat avec l'image.
// La carte ne propose QUE des plans réellement envoyés et du MÊME modèle que l'image (empreinte de scène identique).
// Bloc rejoué : sortie réelle de la machine de rendu sur 930470000P0646 (essai fictif X9 + G4, 17/11/2026).
import assert from 'node:assert/strict';
import test from 'node:test';
import { COUT_PLANS_TEXTE, lignesPlanches, lirePlansExtension, MENTION_PLANS, plansDuTravail, plansPourModele, TITRE_PLANS_MAISON } from './plansExtension.ts';

const EMP = '108bd93607064b3a29192a3c99c9f930d7e4dd1147ce8c0ea854c3cf1b8a6816';
const BASE = '00000000-0000-4000-8000-000000000009/99999999-9999-4999-8999-870208895320';
const INTERNES = /\b(lot|moteur|serveur|worker|unreal|blender)\b/i;

const plans = (x: Record<string, unknown> = {}) => ({
  statut: 'envoye', empreinte_scene: EMP, empreinte_courte: EMP.slice(0, 12),
  pdf_path: `${BASE}/plans-extension.pdf`, dxf_path: `${BASE}/plans-extension-dxf.zip`, apercu_path: `${BASE}/plans-extension-apercu.png`,
  planches: [
    { numero: 'PL-01', titre: 'Plan de masse', echelle: '1/200', format: 'A3 paysage' },
    { numero: 'PL-05', titre: 'Façades', echelle: '1/100', format: 'A3 paysage' },
    { numero: 'PL-06', titre: 'Coupe AA', echelle: '1/100', format: 'A3 paysage' },
  ],
  statuts: ['Largeur 5,00 m (confirmée)', 'Profondeur 4,00 m (confirmée)', 'Hauteur à l’égout 3,00 m (supposée)'],
  avertissements: [], jetons: 0, mention: 'Plans indicatifs, à faire valider par un professionnel avant tout dépôt.',
  ...x,
});
const ext = (p: unknown, x: Record<string, unknown> = {}) => ({ ok: true, livrable: false, empreinte_scene: EMP, empreinte_courte: EMP.slice(0, 12), plans: p, ...x });

test('plans envoyés, même modèle que l’image → proposés (PDF, DXF, aperçu), gratuits, mention indicative', () => {
  const v = lirePlansExtension(ext(plans()));
  assert.ok(v && v.etat === 'disponibles');
  assert.equal(v.pdfPath, `${BASE}/plans-extension.pdf`);
  assert.equal(v.dxfPath, `${BASE}/plans-extension-dxf.zip`);
  assert.equal(v.apercuPath, `${BASE}/plans-extension-apercu.png`);
  assert.equal(v.modele, '108bd9360706');
  assert.equal(v.cout, COUT_PLANS_TEXTE);
  assert.equal(v.mention, MENTION_PLANS);
  assert.deepEqual(lignesPlanches(v), ['PL-01 Plan de masse — 1/200', 'PL-05 Façades — 1/100', 'PL-06 Coupe AA — 1/100']);
});

test('aucun bloc de plans (rendu antérieur, projet neuf) → rien', () => {
  assert.equal(lirePlansExtension(null), null);
  assert.equal(lirePlansExtension({ ok: true }), null);
  assert.equal(plansPourModele({ images: [] }), null);
});

test('jamais un plan d’un autre modèle que l’image, ni sans identifiant de modèle', () => {
  const autre = lirePlansExtension(ext(plans(), { empreinte_scene: 'f'.repeat(64) }));
  assert.deepEqual(autre, { etat: 'indisponibles', raison: 'Les plans ne correspondent pas au modèle de l’image : ils ne sont pas proposés.' });
  const sans = lirePlansExtension(ext(plans({ empreinte_scene: undefined })));
  assert.equal(sans?.etat, 'indisponibles');
  const sansImage = lirePlansExtension({ ok: true, plans: plans() });
  assert.equal(sansImage?.etat, 'indisponibles');
});

test('stockage qui a refusé le PDF → aucun lien, la raison est dite ; échec du dessin → raison dite', () => {
  const v = lirePlansExtension(ext(plans({ statut: 'non_envoye', pdf_path: null, dxf_path: null, raison: 'Les plans ont été dessinés mais n’ont pas pu être envoyés.' })));
  assert.deepEqual(v, { etat: 'indisponibles', raison: 'Les plans ont été dessinés mais n’ont pas pu être envoyés.' });
  const e = lirePlansExtension(ext({ statut: 'echec', raison: 'L’extension n’est pas placée : aucun plan.', jetons: 0 }));
  assert.deepEqual(e, { etat: 'indisponibles', raison: 'L’extension n’est pas placée : aucun plan.' });
});

test('chemins hors du seau des plans refusés (remontée, adresse complète)', () => {
  for (const mauvais of ['../../autre/plans-extension.pdf', 'https://exemple.fr/plans-extension.pdf', `${BASE}/image-face.jpg`]) {
    assert.equal(lirePlansExtension(ext(plans({ pdf_path: mauvais })))?.etat, 'indisponibles', mauvais);
  }
  const sansDxf = lirePlansExtension(ext(plans({ dxf_path: '../x/plans-extension-dxf.zip' })));
  assert.ok(sansDxf?.etat === 'disponibles' && sansDxf.dxfPath === null);
});

test('ce que dit l’outil au modèle : plans prêts (sans liens ni cotes) ou indisponibles (aucune promesse) ; aucun nom interne', () => {
  const ok = plansPourModele({ extension: ext(plans()) });
  assert.ok(ok);
  assert.deepEqual(ok.data, { disponibles: true, modele: '108bd9360706', planches: ['PL-01 Plan de masse — 1/200', 'PL-05 Façades — 1/100', 'PL-06 Coupe AA — 1/100'], jetons: 0 });
  assert.match(ok.phrase, /sont prêts/);
  assert.doesNotMatch(ok.phrase, /https?:|plans-extension\.pdf/);
  const non = plansPourModele({ extension: ext(plans({ statut: 'non_envoye', pdf_path: null })) });
  assert.ok(non);
  assert.equal(non.data.disponibles, false);
  assert.match(non.phrase, /ne promets aucun plan/);
  for (const t of [ok.phrase, COUT_PLANS_TEXTE, MENTION_PLANS]) assert.doesNotMatch(t.replace('machine de rendu', ''), INTERNES);
});

const E10 = 'b'.repeat(64);
const MAISON10 = {
  empreinte_scene: E10,
  plans: { statut: 'envoye', empreinte_scene: E10, pdf_path: 'u-1/j-1/plans-maison.pdf', dxf_path: 'u-1/j-1/plans-maison-dxf.zip', apercu_path: 'u-1/j-1/plans-maison-apercu.png', planches: [{ numero: 'PL-01', titre: 'Plan de masse', echelle: '1/200', format: 'A3 paysage' }], jetons: 0 },
};
test('G10b : plans de la maison lus depuis resultat.maison, titre et phrase de la maison', () => {
  const lu = plansDuTravail({ resultat_maison: MAISON10 });
  assert.equal(lu?.genre, 'maison');
  assert.equal(lu?.vue.etat, 'disponibles');
  assert.match(plansPourModele({ maison: MAISON10 })?.phrase ?? '', /plans de la maison/);
  assert.equal(TITRE_PLANS_MAISON, 'Plans de votre maison');
});
test('G10b : plans de la maison d’un autre modèle que l’image → non proposés', () => {
  assert.equal(plansDuTravail({ resultat_maison: { ...MAISON10, empreinte_scene: 'c'.repeat(64) } })?.vue.etat, 'indisponibles');
});
