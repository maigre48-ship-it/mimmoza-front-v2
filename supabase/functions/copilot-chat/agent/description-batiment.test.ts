// deno test --no-check -A supabase/functions/copilot-chat/agent/description-batiment.test.ts
// VIS-22 — « Dessiner le bâtiment » : outil du chat (le modèle propose, le serveur valide), détection, consignes,
// PARITÉ du contrat avec le brief de rendu (listes, clauses, bloc), forme et niveaux demandés au moteur, fiche du rendu.
// Aucun réseau. Fiche de conception : celle de studio.test.ts (AE0414, géométrie synthétique 50 × 40 m).
import * as na from 'node:assert/strict';
import {
  consigneBatimentCarte, consigneDessinBatiment, dessinPlutotQuExtension, executerOutilDecrireBatiment, intentionDessinBatiment, messageReproduireEn3D,
  OUTIL_DECRIRE_BATIMENT, OUTIL_DECRIRE_BATIMENT_DEF, suiteDuDessin,
} from './description-batiment.ts';
import {
  BALCONS_BATIMENT, clausesCompletes, descriptionDuMessage, FACADES_BATIMENT, GARDE_CORPS_BATIMENT, MENUISERIES_BATIMENT, messageReproduire,
  OUVERTURES_BATIMENT, PRECISIONS_BRIEF_MAX, SOUBASSEMENTS_BATIMENT, TEINTES_BATIMENT, TEINTES_PAR_FACADE_BATIMENT, FORMES_TOIT, COUVERTURES,
  validerDescription, versBrief, FORMES_BATIMENT, DESCRIPTION_BLOC_LANGUE, type DescriptionBatiment,
} from '../../../../src/lib/studio/descriptionBatiment.ts';
import {
  BRIEF_BALCONS, BRIEF_BLOC_LANGUE, BRIEF_FACADES, BRIEF_GARDE_CORPS, BRIEF_MENUISERIES, BRIEF_OUVERTURES, BRIEF_PRECISIONS_MAX, BRIEF_SOUBASSEMENTS,
  BRIEF_TEINTES, briefDuFil, briefDuMessage, clausesBrief, descriptionDuFil, descriptionPourBrief, ficheDepuisPreparation, preparerVolume,
  reservesDescription, TEINTES_PAR_FACADE, validerBrief,
  type BriefRendu, type ConceptionLue, type DepotStudio, type PreparationLue,
} from './studio.ts';
import { FORMES } from './studio-front.ts';
import { detecterIntentionMission } from './intention-mission.ts';
import { detecterIntentionMaisonNeuve } from '../../_shared/maisonNeuve/instructionsMaison.ts';
import { detecterIntentionExtension } from '../../_shared/extension/parcours.ts';
import { appliquerSecteursDeclares, completerRegles, reglesDepuisLecture, type RegleConception } from './conception.ts';

globalThis.fetch = (() => { throw new Error('RÉSEAU INTERDIT EN TEST'); }) as typeof fetch;
const ok = (v: unknown, m?: string) => na.ok(v, m);
const eq = (a: unknown, b: unknown, m?: string) => na.deepStrictEqual(a, b, m);

const MAISON_BASQUE = {
  type: 'maison', niveaux: 2, style: 'basque', toiture: { forme: 'deux_pans', couverture: 'tuiles' }, facade: { materiau: 'enduit_blanc' },
  ouvertures: { type: 'fenetres_verticales', volets: 'battants', couleurVolets: 'rouge' }, balcons: { type: 'balcons_filants', gardeCorps: 'plein' },
  elements: [{ type: 'colombages', couleur: 'rouge' }, { type: 'garage_accole', cote: 'gauche' }],
};
function decrit(brut: unknown): DescriptionBatiment {
  const v = validerDescription(brut);
  if (!v.ok) throw new Error(v.erreur);
  return v.valeur;
}
function brief(d: DescriptionBatiment): BriefRendu {
  const v = validerBrief(versBrief(d));
  if (!v.ok) throw new Error(v.erreur);
  return v.valeur;
}

// ---- Parité du contrat avec le brief de rendu (code réel de studio.ts) ------------------------------------

Deno.test('parité : listes du contrat = listes du brief de rendu, forme = formes du moteur', () => {
  eq([...FACADES_BATIMENT], [...BRIEF_FACADES]);
  eq([...TEINTES_BATIMENT], [...BRIEF_TEINTES]);
  eq([...OUVERTURES_BATIMENT], [...BRIEF_OUVERTURES]);
  eq([...MENUISERIES_BATIMENT], [...BRIEF_MENUISERIES]);
  eq([...BALCONS_BATIMENT], [...BRIEF_BALCONS]);
  eq([...GARDE_CORPS_BATIMENT], [...BRIEF_GARDE_CORPS]);
  eq([...SOUBASSEMENTS_BATIMENT], [...BRIEF_SOUBASSEMENTS]);
  eq(TEINTES_PAR_FACADE_BATIMENT, TEINTES_PAR_FACADE);
  eq(PRECISIONS_BRIEF_MAX, BRIEF_PRECISIONS_MAX);
  for (const f of FORMES_BATIMENT) ok(FORMES.some((x) => x.valeur === f && x.disponible), `forme ${f} connue du moteur`);
});

Deno.test('parité : toute description validée donne un brief ACCEPTÉ par validerBrief, sans valeur changée', () => {
  let n = 0;
  for (const materiau of FACADES_BATIMENT) for (const teinte of TEINTES_PAR_FACADE_BATIMENT[materiau]) for (const forme of FORMES_TOIT) for (const balcons of BALCONS_BATIMENT) {
    for (const attique of [false, true]) for (const rdc of ['logements', 'commerces']) for (const forme2 of [null, 'u']) {
      const d = decrit({ forme: forme2, toiture: { forme, couverture: COUVERTURES[n % 3] }, facade: { materiau, teinte }, balcons: { type: balcons, gardeCorps: GARDE_CORPS_BATIMENT[n % 3] },
        attique, rdc, soubassement: SOUBASSEMENTS_BATIMENT[n % 4], ouvertures: { type: OUVERTURES_BATIMENT[n % 3], menuiseries: MENUISERIES_BATIMENT[n % 4] } });
      const propose = versBrief(d);
      const v = validerBrief(propose);
      ok(v.ok, v.ok ? '' : `${v.erreur} — ${JSON.stringify(propose)}`);
      if (v.ok) for (const [k, val] of Object.entries(propose)) eq((v.valeur as unknown as Record<string, unknown>)[k], val, k);
      n++;
    }
  }
  ok(n > 1000);
});

Deno.test('parité : clauses complètes = clauses du brief (hors toitures et styles propres à la description)', () => {
  for (const brut of [
    {}, { facade: { materiau: 'brique', teinte: 'claire' }, balcons: { type: 'loggias' }, attique: true, rdc: 'commerces' },
    { facade: { materiau: 'verre' }, toiture: { forme: 'vegetalisee' } }, { facade: { materiau: 'bardage_bois', teinte: 'foncee' }, toiture: { forme: 'deux_pans', couverture: 'zinc' }, balcons: { type: 'balcons' } },
    { facade: { materiau: 'beton', teinte: 'claire' }, ouvertures: { type: 'baies_vitrees' }, balcons: { type: 'balcons_filants' }, toiture: { forme: 'deux_pans', couverture: 'ardoise' } },
  ]) {
    const d = decrit(brut);
    eq(clausesCompletes(d), clausesBrief(brief(d)), JSON.stringify(brut));
  }
});

Deno.test('bouton « Reproduire en 3D » : le message est relu par le serveur (description stricte + habillage sans type)', () => {
  const d = decrit(MAISON_BASQUE);
  const m = messageReproduire(d);
  const lue = descriptionDuMessage(m);
  ok(lue?.ok);
  eq(lue?.ok ? lue.valeur : null, d);
  const b = briefDuMessage(m);
  ok(b?.ok, b && !b.ok ? b.erreur : '');
  if (b?.ok) {
    eq(b.valeur.type, null, 'aucun rendu demandé : habillage du projet');
    eq(b.valeur.brief?.toiture, 'deux_pans_tuiles');
    eq(b.valeur.brief?.balcons, 'balcons_filants');
    eq(b.valeur.brief?.precisions, 'style basque ; volets battants rouge ; colombages rouge ; garage accolé à gauche');
  }
  ok(messageReproduireEn3D(m));
  ok(!messageReproduireEn3D('Prépare la 3D'));
  ok(m.includes('```' + DESCRIPTION_BLOC_LANGUE) && m.includes('```' + BRIEF_BLOC_LANGUE));
});

// ---- Outil : le modèle propose, le serveur valide ---------------------------------------------------------

Deno.test('outil : description validée, bilan, éléments pas encore reproduits ; rien n’est préparé', () => {
  eq(OUTIL_DECRIRE_BATIMENT_DEF.name, OUTIL_DECRIRE_BATIMENT);
  const r = executerOutilDecrireBatiment({ ...MAISON_BASQUE, origine: 'texte' }, { photoAuTour: false });
  eq(r.status, 'ok');
  const data = r.data as Record<string, unknown>;
  eq(data.carte, 'batiment');
  eq((data.description as DescriptionBatiment).style, 'basque');
  eq(data.pas_encore_reproduit, ['élément remarquable : garage accolé à gauche']);
  eq(data.corrections, []);
  ok(!('mention_photo' in data));
  ok(/Reproduire en 3D/.test(r.message ?? '') && /NI studio_preparer_3d/.test(r.message ?? ''));
  ok(Array.isArray(data.bilan) && (data.bilan as unknown[]).length >= 13);
});

Deno.test('outil : photo jointe au tour → origine « photo » imposée par le serveur et mention « référence de style »', () => {
  const r = executerOutilDecrireBatiment({ ...MAISON_BASQUE, origine: 'texte', incertains: ['niveaux', 'style'] }, { photoAuTour: true });
  const data = r.data as Record<string, unknown>;
  eq((data.description as DescriptionBatiment).origine, 'photo');
  ok(String(data.mention_photo).includes('référence de style'));
  ok(/ni un relevé ni une copie exacte/.test(r.message ?? ''));
  eq(data.a_verifier, ['niveaux', 'style']);
});

Deno.test('outil : valeurs hors liste écartées et dites ; entrée illisible refusée', () => {
  const r = executerOutilDecrireBatiment({ type: 'manoir', style: 'gothique', niveaux: 400, toiture: { forme: 'deux_pans' }, attique: true, secret: 'x' }, { photoAuTour: false });
  eq(r.status, 'ok');
  const d = (r.data as Record<string, unknown>).description as DescriptionBatiment;
  eq([d.type, d.style, d.niveaux, d.attique, d.toiture.couverture], ['collectif', 'contemporain', 30, false, 'tuiles']);
  ok(((r.data as Record<string, unknown>).corrections as string[]).length >= 5);
  ok(/ajuster/.test(r.message ?? ''));
  eq(executerOutilDecrireBatiment({ v: 7 }, { photoAuTour: false }).status, 'error');
});

Deno.test('détection : descriptions et photos « qui ressemble » ; pas les demandes ordinaires', () => {
  for (const t of [
    'Dessine une maison basque R+1 avec toit deux pans en tuiles, colombages rouges, balcon filant au 1er, garage accolé à gauche',
    'un petit collectif R+2 en L, toiture-terrasse, loggias, bardage bois',
    'Je voudrais un immeuble en brique avec des balcons filants et un toit en zinc',
    'Fais-moi une maison normande à colombages avec un toit en ardoise',
  ]) ok(intentionDessinBatiment(t, false), t);
  for (const t of ['je veux un bâtiment qui ressemble à ça', 'inspire-toi de cette photo', 'Reproduis ce bâtiment', 'un immeuble dans ce style']) ok(intentionDessinBatiment(t, true), t);
  for (const t of [
    'Quel est le prix au m² à Ascain ?', 'Prépare la 3D de ma conception', 'Lance une image de mon projet', 'Je veux construire une maison', 'Quelle hauteur maximale au PLU ?',
    'un immeuble', '', 'Combien de logements sur cette parcelle ?', messageReproduire(decrit(MAISON_BASQUE)),
  ]) ok(!intentionDessinBatiment(t, false), t);
  ok(!intentionDessinBatiment('voici la photo du terrain', true));
  ok(!intentionDessinBatiment('je veux un bâtiment qui ressemble à ça', false), 'sans photo ni description : rien');
  ok(suiteDuDessin('Voici ce que j’ai compris ; corrigez dans la carte puis cliquez « Reproduire en 3D ».'));
  ok(!suiteDuDessin('Le prix médian est de 4 200 €/m².'));
});

Deno.test('exemples du fondateur : ni mission, ni parcours d’extension (garage accolé), ni parcours maison neuve', () => {
  const exemples = [
    'une maison basque R+1 avec toit deux pans en tuiles, colombages rouges, balcon filant au 1er, garage accolé à gauche',
    'un petit collectif R+2 en L, toiture-terrasse, loggias, bardage bois',
  ];
  for (const t of exemples) {
    ok(intentionDessinBatiment(t, false), t);
    ok(!detecterIntentionMission(t).mission, `mission : ${t}`);
    ok(!detecterIntentionMaisonNeuve(t), `maison neuve : ${t}`);
  }
  // Le premier exemple cite un garage accolé : le parcours d'extension le reconnaîtrait ; la description passe devant.
  ok(detecterIntentionExtension(exemples[0]).extension, 'le parcours d’extension reconnaît « garage accolé »');
  ok(dessinPlutotQuExtension(exemples[0], false));
  ok(dessinPlutotQuExtension('un bâtiment qui ressemble à cette photo, avec une véranda', true));
  // Une vraie demande d'extension reste une extension.
  for (const t of ['Je veux agrandir ma maison avec un garage accolé à gauche, toit en tuiles, façade en enduit', 'une extension de 20 m² en bardage bois avec toit plat et baies vitrées', 'ajoute un garage accolé à ma maison']) {
    ok(!dessinPlutotQuExtension(t, false), t);
    ok(!dessinPlutotQuExtension(t, true), t);
  }
  ok(!dessinPlutotQuExtension('un garage accolé', false));
  const m = messageReproduire(decrit(MAISON_BASQUE));
  ok(!detecterIntentionMission(m).mission && !detecterIntentionMaisonNeuve(m) && !dessinPlutotQuExtension(m, false));
});

Deno.test('consignes : dessiner (photo = référence de style) ; reproduire (prépare la 3D, habillage enregistré)', () => {
  ok(consigneDessinBatiment(false).includes(OUTIL_DECRIRE_BATIMENT));
  ok(/RÉFÉRENCE DE STYLE, pas un relevé/.test(consigneDessinBatiment(true)));
  eq(consigneBatimentCarte(null), '');
  const c = consigneBatimentCarte(validerDescription({ ...decrit(MAISON_BASQUE), origine: 'photo' }, true));
  ok(/studio_preparer_3d/.test(c) && /n’appelle pas studio_lancer_rendu/.test(c) && /référence de style/.test(c) && /maison de style basque/.test(c));
  ok(/REFUSÉE/.test(consigneBatimentCarte({ ok: false, erreur: 'version inconnue' })));
});

// ---- Forme et niveaux demandés au moteur (code réel : preparerVolume) -------------------------------------

const SOURCE = 'Règlement GPU — 92050_PLU_20251209';
const IDU = '92050000AE0414';
const USER = '0d6f1a2b-0000-4000-8000-000000000001';
const CONV = '7c0f0000-0000-4000-8000-0000000000aa';
function reglesAE0414(): RegleConception[] {
  const lues = reglesDepuisLecture({ regles: [
    { cle: 'emprise_sol_max_pct', nature: 'non_reglementee', valeur: null, article: 'UC 9, p. 109', texte: 'Il n’est pas fixé de règle.' },
    { cle: 'hauteur_max_m', nature: 'par_secteur', valeur: null, article: 'UC 10, p. 109', regle_relative: 'UC 10-1 : hauteur ≤ distance à l’alignement opposé + 2 m',
      valeurs_par_secteur: [{ secteur: '1', acrotere_terrasse: 28, egout: 26, faitage: 28, texte: '28 m à l’acrotère (toiture terrasse)' }] },
    { cle: 'stationnement_par_logement', nature: 'par_secteur', valeur: null, article: 'UC 12', valeurs_par_secteur: [{ secteur: 'Zone 3', valeur: 1, texte: 'Zone 3 – logements : 1 places/logement' }] },
    { cle: 'recul_voie_m', nature: 'alternative', valeur: null, article: 'UC 6-1, p. 106', texte: 'implantation à l’alignement ou en recul minimum de 4 m',
      alternatives: [{ libelle: 'alignement', valeur: 0 }, { libelle: 'recul minimum', valeur: 4 }] },
    { cle: 'recul_limites_m', valeur: 8, article: 'UC 7', texte: '8 m (3 m en l’absence de baie)' },
    { cle: 'pleine_terre_min_pct', valeur: 20, article: 'UC 13', texte: '20 % de pleine terre' },
  ] }, 'gpu', SOURCE);
  return completerRegles(appliquerSecteursDeclares(lues, { hauteur: '1', stationnement: '3', toiture: 'terrasse' }).regles);
}
const LON = 2.2068, LAT = 48.892, KX = 111_320 * Math.cos(LAT * Math.PI / 180);
function rectangle(l: number, h: number) {
  const ring = [[0, 0], [l, 0], [l, h], [0, h]].map(([x, y]) => [LON + x / KX, LAT + y / 111_320]);
  return { type: 'Polygon' as const, coordinates: [[...ring, ring[0]]] };
}
function conception(l = 50, h = 40): ConceptionLue {
  return {
    id: '5a1c0e00-0000-4000-8000-0000000000c1', idu: IDU, commune: 'Nanterre',
    parcelle: { idu: IDU, geometrie: rectangle(l, h), surface_m2: l * h, source: 'synthétique (test)' },
    regles_plu: reglesAE0414(),
    programme: { nb_logements: 40, typologies: {}, shab_cible_m2: null, sdp_cible_m2: null, gabarit: 'R+4', stationnement: null, toiture: 'terrasse' },
  };
}

Deno.test('moteur : niveaux demandés plus bas → volume abaissé ; plus haut → plafonné au moteur et DIT', async () => {
  const base = await preparerVolume(conception());
  ok(base.ok, base.ok ? '' : base.raison);
  if (!base.ok) return;
  const plafond = base.volume.niveaux;
  ok(plafond >= 3, `le moteur donne ${plafond} niveaux`);
  const bas = await preparerVolume(conception(), { niveaux: 2 });
  ok(bas.ok, bas.ok ? '' : bas.raison);
  if (!bas.ok) return;
  eq(bas.volume.niveaux, 2, 'R+1 demandé : R+1 préparé');
  ok(bas.empreinte !== base.empreinte, 'préparation distincte (l’ancienne n’est pas resservie)');
  ok(!bas.resume.alertes.some((a) => a.startsWith('Hauteur demandée')));
  const haut = await preparerVolume(conception(), { niveaux: plafond + 6 });
  ok(haut.ok);
  if (!haut.ok) return;
  eq(haut.volume.niveaux, plafond, 'jamais au-dessus du moteur');
  ok(haut.resume.alertes.some((a) => a.startsWith('Hauteur demandée') && a.includes('ramenée')), haut.resume.alertes.join(' | '));
  eq(haut.empreinte, base.empreinte, 'volume identique à celui du moteur');
  const sans = await preparerVolume(conception(), { niveaux: null });
  eq(sans.ok ? sans.empreinte : null, base.empreinte, 'sans description : rien ne change');
});

Deno.test('moteur : forme demandée (en L) + niveaux', async () => {
  const l = await preparerVolume(conception(), { forme: 'l', niveaux: 3 });
  ok(l.ok, l.ok ? '' : l.raison);
  if (!l.ok) return;
  eq(l.resume.forme?.retenue, FORMES.find((f) => f.valeur === 'l')?.libelle);
  ok(l.volume.niveaux <= 3, `niveaux ${l.volume.niveaux}`);
});

// ---- Fiche du rendu : la description atteint la machine de rendu -------------------------------------------

async function preparation(choix: Parameters<typeof preparerVolume>[1] = {}): Promise<PreparationLue> {
  const p = await preparerVolume(conception(), choix);
  if (!p.ok) throw new Error(p.raison);
  return { id: '9b000000-0000-4000-8000-000000000001', conception_id: '5a1c0e00-0000-4000-8000-0000000000c1', conversation_id: CONV, idu: IDU, empreinte: p.empreinte, entree: p.entree, volume: p.volume, resume: p.resume } as unknown as PreparationLue;
}
const commandeDe = (f: { ok: true; valeur: Record<string, unknown> }): string =>
  String(((f.valeur.charge as Record<string, unknown>).programme as Record<string, unknown>).commandeArchitecture ?? '');

Deno.test('rendu, un bâtiment : toiture de la description, style basque, colombages et volets dans la commande', async () => {
  const d = decrit(MAISON_BASQUE);
  const p = await preparation({ forme: 'plot', niveaux: 2 });
  const sans = ficheDepuisPreparation(p, CONV, '2026-11-23T12:00:00.000Z', crypto.randomUUID(), 'https://mimmoza.vercel.app', brief(d));
  const avec = ficheDepuisPreparation(p, CONV, '2026-11-23T12:00:00.000Z', crypto.randomUUID(), 'https://mimmoza.vercel.app', brief(d), null, { description: d });
  ok(sans.ok && avec.ok, !avec.ok ? avec.erreur : '');
  if (!sans.ok || !avec.ok) return;
  const c0 = commandeDe(sans), c1 = commandeDe(avec);
  ok(c0.length > 0, 'bâtiment seul : commande de création présente');
  ok(c0.includes('toiture à deux pans en tuiles') && !c0.includes('basque'));
  ok(c1.endsWith('toiture à deux pans en tuiles, de style basque, colombages rouges, volets rouges.'), c1);
  eq(c1.split('toiture').length, 2, 'une seule clause de toiture');
  eq(avec.valeur.description_batiment, d);
  ok(!('description_batiment' in sans.valeur));
  const q = decrit({ toiture: { forme: 'quatre_pans', couverture: 'ardoise' } });
  const f4 = ficheDepuisPreparation(p, CONV, '2026-11-23T12:00:00.000Z', crypto.randomUUID(), 'https://mimmoza.vercel.app', brief(q), null, { description: q });
  ok(f4.ok && commandeDe(f4).includes('toiture à quatre pans en ardoise') && !commandeDe(f4).includes('deux pans'), f4.ok ? commandeDe(f4) : '');
});

Deno.test('rendu : un habillage choisi APRÈS (autre toiture) l’emporte — la description n’est plus appliquée', async () => {
  const d = decrit(MAISON_BASQUE);
  const p = await preparation({ forme: 'plot', niveaux: 2 });
  const autre = validerBrief({ ...versBrief(d), toiture: 'terrasse' });
  ok(autre.ok);
  if (!autre.ok) return;
  eq(descriptionPourBrief(d, autre.valeur), null);
  eq(descriptionPourBrief(d, brief(d)), d);
  eq(descriptionPourBrief(d, null), null);
  const f = ficheDepuisPreparation(p, CONV, '2026-11-23T12:00:00.000Z', crypto.randomUUID(), 'https://mimmoza.vercel.app', autre.valeur, null, { description: d });
  ok(f.ok && !commandeDe(f).includes('basque') && !('description_batiment' in f.valeur));
});

Deno.test('rendu, bâtiment à ailes : ni style ni éléments ; habillage relu par les règles de la machine de rendu', async () => {
  const d = decrit({ ...MAISON_BASQUE, forme: 'l', toiture: { forme: 'terrasse' } });
  const p = await preparation({ forme: 'l', niveaux: 3 });
  const f = ficheDepuisPreparation(p, CONV, '2026-11-23T12:00:00.000Z', crypto.randomUUID(), 'https://mimmoza.vercel.app', brief(d), null, { description: d });
  ok(f.ok, !f.ok ? f.erreur : '');
  if (!f.ok) return;
  const h = f.valeur.habillage_batiments as { clauses: string[] } | undefined;
  ok(h, 'bâtiment à ailes : habillage à part');
  // Mêmes règles que worker/src/fiche.ts::lireHabillage (6 clauses, lettres seulement, ni balcon ni style).
  ok(h!.clauses.length <= 6 && h!.clauses.every((c) => /^[\p{L} '’-]+$/u.test(c) && !/balcon|loggia|style/i.test(c) && c.length <= 60), h!.clauses.join(' | '));
  ok(reservesDescription(d, true).some((r) => r.includes('appliqué seulement à un bâtiment seul')));
  ok(reservesDescription(decrit({ ...MAISON_BASQUE, origine: 'photo' })).some((r) => r.includes('ni un relevé ni une copie exacte')));
  ok(reservesDescription(d).some((r) => r.includes('garage accolé')));
});

Deno.test('conversation : la description vaut tant que son message est le DERNIER habillage envoyé', async () => {
  const d = decrit(MAISON_BASQUE);
  const m = messageReproduire(d);
  const panneau = 'Habillage choisi.\n\n```mimmoza-brief\n' + JSON.stringify({ v: 1, brief: { facade: 'brique' } }) + '\n```';
  const depot = (lignes: { texte: string; cree_le: string }[]) => ({ briefsMessages: () => Promise.resolve(lignes) }) as unknown as DepotStudio;
  const seul = await descriptionDuFil(depot([{ texte: m, cree_le: '2026-11-23T10:00:00Z' }]), USER, CONV);
  eq(seul?.description, d);
  const b = await briefDuFil(depot([{ texte: m, cree_le: '2026-11-23T10:00:00Z' }]), USER, CONV);
  eq(b?.brief.toiture, 'deux_pans_tuiles', 'le même message donne l’habillage du rendu');
  // Plus récent d'abord (ordre du dépôt) : un habillage choisi ensuite dans l'Espace 3D remplace la description.
  eq(await descriptionDuFil(depot([{ texte: panneau, cree_le: '2026-11-23T11:00:00Z' }, { texte: m, cree_le: '2026-11-23T10:00:00Z' }]), USER, CONV), null);
  eq(await descriptionDuFil(depot([]), USER, CONV), null);
  eq(await descriptionDuFil({} as DepotStudio, USER, CONV), null);
});
