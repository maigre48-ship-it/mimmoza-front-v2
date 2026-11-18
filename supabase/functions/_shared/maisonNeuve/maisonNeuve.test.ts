// LOT G10 — tests du parcours « construire une maison » (purs, sans réseau).
// Lancer : deno test --no-lock --no-check -A supabase/functions/_shared/maisonNeuve/
import * as na from 'node:assert/strict';
const assert: (v: unknown, m?: string) => asserts v = (v, m) => na.ok(v, m);
const assertEquals = <T,>(a: T, b: T, m?: string): void => na.deepStrictEqual(a, b, m);
import type { Donnee } from '../extension/contrat.ts';
import { calculerGabaritMaison, distancePolygoneSegment, type ParcelleMaison } from './gabaritMaison.ts';
import { detecterIntentionMaisonNeuve, lireInstructionsMaison } from './instructionsMaison.ts';
import { autorisationMaison, avancerParcoursMaison, QM, suiteDuParcoursMaison } from './parcoursMaison.ts';

const C = <T,>(v: T): Donnee<T> => ({ valeur: v, statut: 'confirmee', source: 'test' });
// Parcelle de test : 20 m sur rue (limite 0), 30 m de profondeur.
const P20x30: ParcelleMaison = { contour: [{ x: 0, z: 0 }, { x: 20, z: 0 }, { x: 20, z: 30 }, { x: 0, z: 30 }], categories: ['voie', 'separative', 'fond', 'separative'], surfaceM2: 600 };
// Parcelle étroite : 12 m sur rue.
const P12x30: ParcelleMaison = { contour: [{ x: 0, z: 0 }, { x: 12, z: 0 }, { x: 12, z: 30 }, { x: 0, z: 30 }], categories: ['voie', 'separative', 'fond', 'separative'], surfaceM2: 360 };

Deno.test('G10-1 intention : maison neuve oui, extension et immeuble non', () => {
  assert(detecterIntentionMaisonNeuve('Je veux construire une maison sur mon terrain'));
  assert(detecterIntentionMaisonNeuve('faire bâtir une villa contemporaine de 120 m²'));
  assert(detecterIntentionMaisonNeuve('une maison neuve de plain-pied'));
  assert(!detecterIntentionMaisonNeuve('je voudrais agrandir ma maison'));
  assert(!detecterIntentionMaisonNeuve('construire un immeuble de 8 logements'));
  assert(!detecterIntentionMaisonNeuve('extension de ma maison de 20 m²'));
});

Deno.test('G10-2 instructions : seules les valeurs dites, terrain ≠ habitable, R+2 plafonné', () => {
  const l = lireInstructionsMaison('Construire une maison contemporaine de 120 m² habitables, R+1, toit plat, menuiseries anthracite, sur un terrain de 600 m²');
  assertEquals(l.demande.surfaceHabitableM2?.valeur, 120);
  assertEquals(l.demande.niveaux?.valeur, 2);
  assertEquals(l.demande.toit?.valeur, 'plat');
  assertEquals(l.demande.style?.valeur, 'contemporain');
  assertEquals(l.demande.menuiseries?.valeur, 'anthracite');
  const t = lireInstructionsMaison('maison sur un terrain de 600 m²');
  assertEquals(t.demande.surfaceHabitableM2, undefined);
  const r2 = lireInstructionsMaison('maison neuve en R+2');
  assertEquals(r2.demande.niveaux, undefined);
  assert(r2.niveauxPlafonnes);
});

Deno.test('G10-3 gabarit : 90 m² de plain-pied tient, reculs respectés au mm', () => {
  // LOT G10b : hauteurs de construction de la maison dessinée (rez-de-chaussée 3,30 m + dalle, débord 0,40 m) ; 100 m²
  // ne tiennent plus façade sur rue sur 20 m (recul R111-17 plus grand) : 90 m².
  const g = calculerGabaritMaison({ parcelle: P20x30, regles: {}, surfaceHabitableM2: C(90), niveaux: C(1 as const), toit: C('deux-pans' as const) });
  assert(g.ok && g.gabarit);
  const m = g.gabarit!;
  assert(Math.abs(m.empriseM2 - 90 / 0.82) < 0.05);
  for (const r of m.reculs) assert(r.mesureM + 0.005 >= r.requis.valeur, `limite ${r.limite} : ${r.mesureM} < ${r.requis.valeur}`);
  // Recul à la voie SUPPOSÉ 4 m, maison au plus près de la rue.
  const rue = m.reculs.find((r) => r.categorie === 'voie')!;
  assertEquals(rue.requis.statut, 'supposee');
  assert(Math.abs(rue.mesureM - 4) < 0.26);
  // Mesure indépendante : distance du gabarit à chaque limite.
  for (let i = 0; i < 4; i += 1) {
    const d = distancePolygoneSegment(m.coins, P20x30.contour[i]!, P20x30.contour[(i + 1) % 4]!);
    assert(Math.abs(d - m.reculs[i]!.mesureM) < 0.0006);
  }
  assertEquals(m.facadeSurRue, true);
  assert(g.hypotheses.some((h) => /SUPPOS/.test(h)));
});

Deno.test('G10-4 gabarit : règles lues (CES, hauteur) appliquées et dites', () => {
  const regles = { cesMax: { valeur: 0.2, statut: 'confirmee' as const, source: 'PLU art. 9' }, hauteurMaxM: { valeur: 7, statut: 'confirmee' as const, source: 'PLU art. 10' } };
  const trop = calculerGabaritMaison({ parcelle: P20x30, regles, surfaceHabitableM2: C(110), niveaux: C(1 as const), toit: C('deux-pans' as const) });
  assert(!trop.ok);
  assert(/emprise au sol/.test(trop.refus[0]!));
  const haut = calculerGabaritMaison({ parcelle: P20x30, regles: { hauteurMaxM: regles.hauteurMaxM }, surfaceHabitableM2: C(140), niveaux: C(2 as const), toit: C('deux-pans' as const) });
  assert(!haut.ok);
  assert(/faîtage/.test(haut.refus[0]!));
});

Deno.test('G10-5 refus : parcelle étroite, propositions qui passent vraiment', () => {
  const g = calculerGabaritMaison({ parcelle: P12x30, regles: {}, surfaceHabitableM2: C(150), niveaux: C(1 as const), toit: C('deux-pans' as const) });
  assert(!g.ok);
  assert(g.propositions.length > 0, 'au moins une proposition');
  for (const p of g.propositions) {
    const r = calculerGabaritMaison({ parcelle: P12x30, regles: {}, surfaceHabitableM2: C(p.surfaceHabitableM2), niveaux: C(p.niveaux), toit: C('deux-pans' as const) });
    assert(r.ok, `la proposition « ${p.libelle} » doit passer`);
  }
});

Deno.test('G10-6 côté rue inconnu : refus honnête, rien de placé', () => {
  const g = calculerGabaritMaison({ parcelle: { ...P20x30, categories: [null, null, null, null] }, regles: {}, surfaceHabitableM2: C(100), niveaux: C(1 as const), toit: C('deux-pans' as const) });
  assert(!g.ok);
  assertEquals(g.gabarit, null);
  assert(/rue/.test(g.refus[0]!));
});

Deno.test('G10-7 parcours complet : message → questions manquantes → synthèse, sans nom interne', () => {
  const ctx = { parcelle: P20x30, regles: {}, secteurProtege: null };
  const s1 = avancerParcoursMaison(null, 'Je veux construire une maison de 110 m² sur mon terrain', ctx);
  assertEquals(s1.etape, 'programme');
  assert(s1.texte.includes('Repris de votre message'));
  assert(s1.attendues.includes(QM.niveaux.id) && s1.attendues.includes(QM.toit.id));
  assert(!s1.attendues.includes(QM.surface.id));
  assert(suiteDuParcoursMaison(s1.blocChoix));
  const s2 = avancerParcoursMaison(s1.etat, 'Niveaux : Plain-pied · Toit : 2 pans · Style : Traditionnel · Menuiseries : Blanc', ctx);
  assertEquals(s2.etape, 'termine');
  assert(s2.gabarit?.ok);
  assertEquals(s2.autorisation?.regime, 'PC');
  for (const mot of ['serveur', 'moteur', 'outil', 'lot ', 'worker']) assert(!s2.texte.toLowerCase().includes(mot), `mot interne : ${mot}`);
  assert(/Reculs respectés/.test(s2.texte));
});

Deno.test('G10-8 parcours : refus puis proposition cliquée → termine', () => {
  const ctx = { parcelle: P12x30, regles: {}, secteurProtege: false };
  const s1 = avancerParcoursMaison(null, 'construire une maison de 150 m² de plain-pied, toit 2 pans', ctx);
  // style et menuiseries posés une fois (facultatifs) : pas de blocage
  const s2 = s1.etape === 'programme' ? avancerParcoursMaison(s1.etat, '', ctx) : s1;
  assertEquals(s2.etape, 'refus');
  const choix = JSON.parse(s2.blocChoix!.replace(/^```mimmoza-choix\n/, '').replace(/\n```$/, ''));
  const option = choix.questions[0].options[0] as string;
  const s3 = avancerParcoursMaison(s2.etat, `${QM.proposition.libelle} : ${option}`, ctx);
  assertEquals(s3.etape, 'termine', s3.texte);
});

Deno.test('G10-9 sans parcelle : adresse demandée, rien inventé', () => {
  const s = avancerParcoursMaison(null, 'construire une maison de 100 m² de plain-pied, toit 4 pans, contemporaine, menuiseries bois', { parcelle: null, regles: {}, secteurProtege: null });
  assertEquals(s.etape, 'sans_parcelle');
  assertEquals(s.gabarit, null);
});

Deno.test('G10-10 autorisation : seuil architecte 150 m² et délai', () => {
  assertEquals(autorisationMaison(170, [153, 187], false).architecte, 'obligatoire');
  assertEquals(autorisationMaison(120, [108, 132], false).architecte, 'non-obligatoire');
  assertEquals(autorisationMaison(145, [130, 160], null).architecte, 'a-confirmer');
  assertEquals(autorisationMaison(120, [108, 132], true).delaiMois, 3);
});
