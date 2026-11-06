// LOT BRIEF-CRÉATIF — Carte « Brief créatif » du chat : modèle, options, récapitulatif, message,
// aperçu. La PARITÉ avec le serveur est vérifiée sur le CODE RÉEL de copilot-chat/agent/studio.ts :
// listes fermées, valeurs par défaut, langue du bloc, et chaque message de la carte relu par
// briefDuMessage (le test échoue si les deux divergent). La sortie de la garde utilisée ici
// (__fixtures__/demande-brief-AE0414.json) est vérifiée identique à la sortie réelle par studio.test.ts (BC-1).
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  BRIEF_AMBIANCES, BRIEF_BALCONS, BRIEF_BLOC_LANGUE as LANGUE_SERVEUR, BRIEF_BLOC_VERSION as VERSION_SERVEUR, BRIEF_DEFAUT,
  BRIEF_FACADES, BRIEF_OUVERTURES, BRIEF_RDC, BRIEF_STYLES, briefDuMessage, libelleBrief,
} from '../../../../supabase/functions/copilot-chat/agent/studio.ts';
import {
  AMBIANCES, ATTIQUES, BALCONS, BRIEF_BLOC_LANGUE, BRIEF_BLOC_VERSION, CHAMPS_CARTE, CHOIX_DEFAUT, ECRANS, FACADES, OUVERTURES, RDCS, STYLES,
  briefAEnvoyer, briefEnvoyeApres, choisir, demandeDepassee, couleurs, dessinTravee, dimsFenetre, etatInitial, hauteurCorps, lireBlocBrief, lireDemandeBrief,
  messageBrief, raisonIndisponible, recapitulatif, sceneApercu, travees,
  briefCourant, briefDuBloc, demandeFiche, dessinStyle,
  type ChoixBrief, type DemandeBrief, type EtatBrief,
} from './briefCreatif.ts';

const SORTIE = JSON.parse(readFileSync(new URL('./__fixtures__/demande-brief-AE0414.json', import.meta.url), 'utf8'));
const appel = (output: unknown, status = 'success') => ({ id: 't1', name: 'studio_lancer_rendu', status, output });
const DEMANDE = lireDemandeBrief(appel(SORTIE)) as DemandeBrief;

test('parité stricte : listes fermées, ordre, valeurs par défaut et bloc identiques à studio.ts', () => {
  assert.deepEqual(STYLES.map((o) => o.valeur), [...BRIEF_STYLES]);
  assert.deepEqual(FACADES.map((o) => o.valeur), [...BRIEF_FACADES]);
  assert.deepEqual(OUVERTURES.map((o) => o.valeur), [...BRIEF_OUVERTURES]);
  assert.deepEqual(BALCONS.map((o) => o.valeur), [...BRIEF_BALCONS]);
  assert.deepEqual(RDCS.map((o) => o.valeur), [...BRIEF_RDC]);
  assert.deepEqual(AMBIANCES.map((o) => o.valeur), [...BRIEF_AMBIANCES]);
  assert.deepEqual(ATTIQUES.map((o) => o.valeur), [false, true]);
  const { style, ...defautServeur } = BRIEF_DEFAUT;
  assert.equal(style, 'contemporain');
  assert.deepEqual(CHOIX_DEFAUT, defautServeur);
  assert.equal(BRIEF_BLOC_LANGUE, LANGUE_SERVEUR);
  assert.equal(BRIEF_BLOC_VERSION, VERSION_SERVEUR);
  // Seules indisponibles : ce que le Studio n'applique pas (styles « manifest », hall non dessiné).
  const indispo = [...STYLES, ...FACADES, ...OUVERTURES, ...BALCONS, ...RDCS, ...AMBIANCES, ...ATTIQUES].filter((o) => !o.disponible).map((o) => o.valeur);
  assert.deepEqual(indispo, ['haussmannien', 'art_deco', 'hall']);
  // Aucun libellé technique du Studio dans les textes de la carte.
  for (const o of [...FACADES, ...OUVERTURES, ...BALCONS, ...RDCS, ...AMBIANCES, ...ATTIQUES]) {
    assert.ok(!/\bav-|enduit-|brique-rouge|beton-brut|bardage-bois|verre-teinte|pierre-claire|manifest|arch[A-Z]|windowType|retail|running|loggia\b|stylepack|attic\b/.test(`${o.libelle} ${o.detail}`), `${o.libelle} ${o.detail}`);
  }
});

test('3 écrans au plus, chaque champ de la carte sur un seul écran', () => {
  assert.ok(ECRANS.length <= 3);
  assert.deepEqual(ECRANS.flatMap((e) => e.champs).sort(), [...CHAMPS_CARTE].sort());
});

test('aller-retour serveur : TOUTES les combinaisons cliquables, relues par briefDuMessage, valeurs exactes, rien « par défaut »', () => {
  let n = 0;
  for (const facade of FACADES) for (const ouvertures of OUVERTURES) for (const balcons of BALCONS) for (const attique of ATTIQUES)
    for (const rdc of RDCS) for (const ambiance of AMBIANCES) {
      if (!rdc.disponible) continue;
      for (const type of ['film', 'visite360', 'image'] as const) {
        if (type === 'image' && ambiance.valeur === 'nuit') continue;
        const choix: ChoixBrief = { facade: facade.valeur, ouvertures: ouvertures.valeur, balcons: balcons.valeur, attique: attique.valeur, rdc: rdc.valeur, ambiance: ambiance.valeur };
        const etat: EtatBrief = { choix, touches: [...CHAMPS_CARTE] };
        const msg = messageBrief(etat, { type, limites: { batiments: 1, balcons: true } });
        assert.ok(msg.length < 8000);
        const lu = briefDuMessage(msg);
        assert.ok(lu?.ok, JSON.stringify(lu));
        if (!lu?.ok) return;
        const { precisions, defauts, style, ...valeurs } = lu.valeur.brief;
        assert.deepEqual(valeurs, choix);
        assert.deepEqual([precisions, style, defauts, lu.valeur.type], [null, 'contemporain', ['style'], type]);
        n++;
      }
    }
  assert.equal(n, 7 * 3 * 4 * 2 * 2 * 3 * 3 - 7 * 3 * 4 * 2 * 2 * 1);
});

test('« Laisser Mimmo choisir » et champs non touchés : `a_toi_de_choisir`, le serveur les marque « par défaut »', () => {
  const vide = etatInitial({ actuel: null, ambiances: ['jour', 'fin_de_journee'] });
  assert.deepEqual(vide, { choix: CHOIX_DEFAUT, touches: [] });
  assert.deepEqual(briefAEnvoyer(vide, true), { a_toi_de_choisir: true });
  const lu = briefDuMessage(messageBrief(vide, DEMANDE, true));
  assert.ok(lu?.ok);
  if (lu?.ok) assert.deepEqual(lu.valeur.brief.defauts, ['style', 'facade', 'ouvertures', 'balcons', 'attique', 'rdc', 'ambiance']);
  const e = choisir(choisir(vide, 'facade', 'brique', DEMANDE), 'balcons', 'loggias', DEMANDE);
  assert.deepEqual(briefAEnvoyer(e), { facade: 'brique', balcons: 'loggias', a_toi_de_choisir: true });
  const lu2 = briefDuMessage(messageBrief(e, DEMANDE));
  assert.ok(lu2?.ok);
  if (lu2?.ok) {
    assert.deepEqual(lu2.valeur.brief.defauts, ['style', 'ouvertures', 'attique', 'rdc', 'ambiance']);
    assert.match(libelleBrief(lu2.valeur.brief), /façade brique · fenêtres verticales \(par défaut\) · loggias ·/);
  }
  // Ligne lisible du message = ce qui sera appliqué.
  assert.match(messageBrief(e, DEMANDE, true), /^Brief créatif pour le film \(rendu\) : je laisse Mimmo choisir le reste — Brique · fenêtres verticales · loggias · toit plat · logements en rez-de-chaussée · journée\./);
});

test('options non cliquables : styles et hall « bientôt », nuit pour une image, ouvertures avec façade en verre, balcons d’une composition', () => {
  const img = { ambiances: ['jour', 'fin_de_journee'] as DemandeBrief['ambiances'], limites: { batiments: 1, balcons: true } };
  const e = etatInitial({ actuel: null, ambiances: img.ambiances });
  assert.equal(raisonIndisponible('rdc', 'hall', e.choix, img), 'Bientôt disponible.');
  assert.deepEqual(choisir(e, 'rdc', 'hall', img), e);
  assert.deepEqual(choisir(e, 'ambiance', 'nuit', img), e);
  assert.deepEqual(choisir(e, 'facade', 'marbre', img), e);
  const verre = choisir(e, 'facade', 'verre', img);
  assert.match(String(raisonIndisponible('ouvertures', 'baies_vitrees', verre.choix, img)), /façade en verre/);
  assert.deepEqual(choisir(verre, 'ouvertures', 'baies_vitrees', img), verre);
  assert.equal(recapitulatif(verre.choix), 'Façade en verre · balcons · toit plat · logements en rez-de-chaussée · journée');
  const compo = { ...img, limites: { batiments: 1, balcons: false } };
  assert.match(String(raisonIndisponible('balcons', 'loggias', e.choix, compo)), /ne sait pas encore poser les balcons/);
  assert.ok(!recapitulatif(e.choix, compo).includes('balcon'));
});

test('état initial d’une modification : brief connu, « hall » et nuit d’image ramenés à ce que le Studio rend', () => {
  const e = etatInitial({ actuel: { facade: 'pierre', ouvertures: 'baies_vitrees', balcons: 'balcons_filants', attique: true, rdc: 'hall', ambiance: 'nuit', defauts: ['style', 'ouvertures'] }, ambiances: ['jour', 'fin_de_journee'] });
  assert.deepEqual(e.choix, { facade: 'pierre', ouvertures: 'baies_vitrees', balcons: 'balcons_filants', attique: true, rdc: 'logements', ambiance: 'jour' });
  assert.deepEqual(e.touches, ['facade', 'balcons', 'attique']);
});

test('lireDemandeBrief : garde réelle (fixture AE0414), devis avec brief_actuel, ancienne sortie sans aperçu ; rien ailleurs', () => {
  assert.equal(DEMANDE.origine, 'demande');
  assert.equal(DEMANDE.type, 'film');
  assert.deepEqual(DEMANDE.ambiances, ['jour', 'fin_de_journee', 'nuit']);
  assert.deepEqual(DEMANDE.limites, { batiments: 2, balcons: true });
  assert.deepEqual(DEMANDE.apercu?.corps.map((k) => [k.l, k.p, k.n]), [[29.5, 16, 3], [29, 16, 3]]);
  assert.equal(DEMANDE.actuel, null);
  // Ancienne sortie (fonction non redéployée) : carte quand même, sans aperçu 3D.
  const ancienne = structuredClone(SORTIE);
  delete ancienne.data.apercu; delete ancienne.data.limites; delete ancienne.data.carte;
  ancienne.data.type = 'image'; ancienne.data.champs.ambiance.valeurs = ['jour', 'fin_de_journee'];
  const d2 = lireDemandeBrief(appel(ancienne));
  assert.deepEqual([d2?.apercu, d2?.limites, d2?.ambiances], [null, { batiments: 1, balcons: true }, ['jour', 'fin_de_journee']]);
  // Devis portant le brief : « Modifier l'habillage ».
  const devis = { status: 'confirmation_requise', data: { jeton_devis: 'x', type: 'image', devis: {}, brief_actuel: { style: 'contemporain', facade: 'brique', ouvertures: 'fenetres_verticales', balcons: 'loggias', attique: true, rdc: 'commerces', ambiance: 'jour', precisions: null, defauts: ['style'] }, apercu: SORTIE.data.apercu, limites: { batiments: 2, balcons: true } } };
  const d3 = lireDemandeBrief(appel(devis));
  assert.equal(d3?.origine, 'devis');
  assert.equal(d3?.actuel?.facade, 'brique');
  assert.deepEqual(d3?.ambiances, ['jour', 'fin_de_journee']);
  // Pas de carte : appel en cours, autre outil, devis sans brief, lancement, erreur.
  assert.equal(lireDemandeBrief(appel(SORTIE, 'running')), null);
  assert.equal(lireDemandeBrief({ ...appel(SORTIE), name: 'studio_etat_rendu' }), null);
  assert.equal(lireDemandeBrief(appel({ status: 'confirmation_requise', data: { type: 'film', devis: {} } })), null);
  assert.equal(lireDemandeBrief(appel({ status: 'ok', data: { lance: true, type: 'film' } })), null);
  assert.equal(lireDemandeBrief(appel({ status: 'error', message: 'x' })), null);
});

test('bulle utilisateur : le bloc est masqué ; brief envoyé après la carte retrouvé', () => {
  const e = choisir(etatInitial({ actuel: null, ambiances: ['jour'] }), 'facade', 'beton', DEMANDE);
  const m = messageBrief(e, DEMANDE);
  const l = lireBlocBrief(m);
  assert.equal(l.brief, true);
  assert.ok(!l.visible.includes('```') && !l.visible.includes('{'));
  assert.match(l.visible, /^Brief créatif validé pour le film \(rendu\) : Béton ·/);
  assert.deepEqual(lireBlocBrief('Bonjour'), { visible: 'Bonjour', brief: false });
  const fil = [
    { id: 'a1', role: 'assistant', text: '' },
    { id: 'u1', role: 'user', text: 'merci' },
    { id: 'u2', role: 'user', text: m },
  ];
  assert.match(String(briefEnvoyeApres(fil, 'a1')), /^Béton · fenêtres verticales/);
  assert.equal(briefEnvoyeApres(fil, 'u2'), null);
  assert.equal(briefEnvoyeApres(fil, 'inconnu'), null);
  // Demande dépassée : brief envoyé, ou devis plus loin (réponse en texte) → carte repliée.
  assert.equal(demandeDepassee(fil, 'a1'), true);
  const fil2 = [{ id: 'a1', role: 'assistant', text: '' }, { id: 'u1', role: 'user', text: 'brique, loggias' },
    { id: 'a2', role: 'assistant', text: '', toolCalls: [{ name: 'studio_lancer_rendu', output: { status: 'confirmation_requise', data: {} } }] }];
  assert.equal(demandeDepassee(fil2, 'a1'), true);
  assert.equal(demandeDepassee(fil2.slice(0, 2), 'a1'), false);
  assert.equal(demandeDepassee(fil2, 'inconnu'), false);
});

test('dimensions du Studio : fenêtres (windowDims), hauteurs R+2 = 9,34 m et + attique = 12,26 m, travées de 3,20 m', () => {
  const r2 = (v: { largeur: number; hauteur: number; allege: number }) => [v.largeur, v.hauteur, v.allege].map((x) => Math.round(x * 100) / 100);
  assert.deepEqual(r2(dimsFenetre('fenetres_verticales', 3.2, 2.8)), [0.8, 1.6, 0.7]);
  assert.deepEqual(r2(dimsFenetre('baies_vitrees', 3.2, 2.8)), [2.6, 2.22, 0.08]);
  assert.deepEqual(r2(dimsFenetre('fenetres_horizontales', 3.2, 2.8)), [2.24, 1, 1.2]);
  assert.equal(hauteurCorps(3, false), 9.34);
  assert.equal(hauteurCorps(3, true), 12.26);
  const t = travees(29.5);
  assert.equal(t.length, 8);
  assert.ok(t[0].angle && t[7].angle && !t[3].angle);
  assert.ok(Math.abs(t[0].centre + (29.5 - 1.8) / 2 - t[0].largeur / 2) < 1e-9);
});

test('aperçu 3D du volume réel : corps à leur place, habillage selon les choix', () => {
  const ap = DEMANDE.apercu!;
  const base = sceneApercu(ap, CHOIX_DEFAUT, DEMANDE.limites);
  const murs = base.boites.filter((b) => b.m === 'mur');
  assert.equal(murs.length, 2);
  murs.forEach((m, i) => {
    assert.ok(Math.abs(m.p[0] - ap.corps[i].cx) < 1e-9 && Math.abs(m.p[2] + ap.corps[i].cy) < 1e-9, 'centre du corps (z = −y)');
    assert.deepEqual([m.s[0], m.s[2]], [ap.corps[i].l, ap.corps[i].p]);
    assert.ok(Math.abs(m.r - (ap.corps[i].a * Math.PI) / 180) < 1e-12);
  });
  assert.ok(Math.abs(base.hauteurMax - 9.34) < 1e-9);
  assert.ok(base.boites.some((b) => b.m === 'dalle'), 'balcons proposés par défaut');
  // Attique : un volume de plus par corps, en retrait de 2 m.
  const at = sceneApercu(ap, { ...CHOIX_DEFAUT, attique: true }, DEMANDE.limites);
  const mursAt = at.boites.filter((b) => b.m === 'mur');
  assert.equal(mursAt.length, 4);
  assert.deepEqual([mursAt[1].s[0], mursAt[1].s[2]], [29.5 - 4, 16 - 4]);
  assert.ok(Math.abs(at.hauteurMax - 12.26) < 1e-9);
  // Commerces : vitrines au rez seulement ; loggias : creux sombres, aucun balcon en saillie.
  const co = sceneApercu(ap, { ...CHOIX_DEFAUT, rdc: 'commerces', balcons: 'loggias' }, DEMANDE.limites);
  assert.ok(co.boites.filter((b) => b.m === 'vitrine').every((b) => b.p[1] < 3.3));
  assert.ok(co.boites.some((b) => b.m === 'fondLoggia') && !co.boites.some((b) => b.m === 'dalle'));
  assert.ok(co.boites.filter((b) => b.m === 'fondLoggia').every((b) => b.p[1] > 3.3), 'pas de loggia au rez (étages courants seulement)');
  // Verre : pas de fenêtres posées, allèges de mur-rideau ; nuit : vitrages allumés.
  const ve = sceneApercu(ap, { ...CHOIX_DEFAUT, facade: 'verre', ambiance: 'nuit' }, DEMANDE.limites);
  assert.ok(!ve.boites.some((b) => b.m === 'vitrage') && ve.boites.some((b) => b.m === 'allege') && ve.boites.some((b) => b.m === 'vitrageAllume'));
  // Composition où le Studio ne pose pas les balcons : l'aperçu n'en montre pas.
  assert.ok(!sceneApercu(ap, CHOIX_DEFAUT, { batiments: 1, balcons: false }).boites.some((b) => b.m === 'dalle' || b.m === 'gardeCorps'));
  assert.equal(couleurs({ ...CHOIX_DEFAUT, facade: 'brique' }).mur, '#8e4b38');
});

test('vignette de travée : dimensions et matière du Studio, attique en retrait, motifs', () => {
  const d = dessinTravee(CHOIX_DEFAUT);
  assert.ok(Math.abs(d.largeur - (3 * 3.2 + 1.8)) < 1e-9);
  assert.equal(d.motif, null);
  const a = dessinTravee({ ...CHOIX_DEFAUT, attique: true, facade: 'brique' });
  assert.equal(a.motif, 'brique');
  assert.ok(a.rects.some((r) => Math.abs(r.x - 2) < 1e-9 && Math.abs(r.w - (d.largeur - 4)) < 1e-9 && r.fill === '#8e4b38'));
  assert.equal(dessinTravee({ ...CHOIX_DEFAUT, facade: 'bardage_bois' }).motif, 'bois');
  assert.ok(dessinTravee({ ...CHOIX_DEFAUT, rdc: 'commerces' }).rects.some((r) => r.fill === couleurs(CHOIX_DEFAUT).vitrine));
});

// ═══ Lot fiche-3d : le MÊME brief dans la fiche « Espace 3D » ═══════════════════════════════════════

test('fiche : brief sans rendu (type null) — bloc sans type relu par le serveur, mêmes valeurs ; ligne « Habillage du projet »', () => {
  const d = demandeFiche(null, DEMANDE.apercu, DEMANDE.limites);
  assert.deepEqual([d.origine, d.type, d.ambiances], ['fiche', null, ['jour', 'fin_de_journee', 'nuit']]);
  const etat = choisir(choisir(etatInitial(d), 'facade', 'brique', d), 'balcons', 'loggias', d);
  const msg = messageBrief(etat, d);
  assert.match(msg, /^Habillage du projet choisi dans la fiche : Brique · fenêtres verticales · loggias/);
  const lu = briefDuMessage(msg);
  assert.ok(lu?.ok);
  assert.equal(lu.ok && lu.valeur.type, null);
  assert.deepEqual(lu.ok && [lu.valeur.brief.facade, lu.valeur.brief.balcons, lu.valeur.brief.style], ['brique', 'loggias', 'contemporain']);
  assert.ok(!JSON.parse(/```mimmoza-brief\n(.*)\n```/.exec(msg)![1]).type);
  assert.match(messageBrief(etat, d, true), /je laisse Mimmo choisir le reste/);
});

test('fiche : brief courant = le PLUS RÉCENT (fiche, carte ou devis), relu sans confiance', () => {
  const devis = { id: 'a1', role: 'assistant', text: '', toolCalls: [appel({ status: 'confirmation_requise', data: { type: 'film', brief_actuel: { ...CHOIX_DEFAUT, facade: 'pierre', defauts: ['ouvertures'] } } })] };
  const fiche = { id: 'u2', role: 'user', text: messageBrief({ choix: { ...CHOIX_DEFAUT, facade: 'bardage_bois' }, touches: ['facade'] }, { type: null, limites: DEMANDE.limites }, true) };
  assert.equal(briefCourant([]), null);
  assert.deepEqual([briefCourant([devis])?.facade, briefCourant([devis])?.origine], ['pierre', 'devis']);
  const apres = briefCourant([devis, fiche]);
  assert.deepEqual([apres?.facade, apres?.origine, apres?.defauts], ['bardage_bois', 'message', ['ouvertures', 'balcons', 'attique', 'rdc', 'ambiance']]);
  assert.equal(briefCourant([fiche, devis])?.facade, 'pierre');
  // Bloc refusé par les listes du serveur : ignoré (jamais deviné).
  assert.equal(briefDuBloc('```mimmoza-brief\n{"v":1,"brief":{"facade":"marbre"}}\n```'), null);
  assert.equal(briefDuBloc('```mimmoza-brief\n{"v":1,"brief":{"style":"gothique"}}\n```'), null);
  assert.equal(briefDuMessage('```mimmoza-brief\n{"v":1,"brief":{"facade":"marbre"}}\n```')?.ok, false);
  // La carte rouverte depuis la fiche part du brief courant.
  const e = etatInitial(demandeFiche(apres, null, DEMANDE.limites));
  assert.deepEqual([e.choix.facade, e.touches], ['bardage_bois', ['facade']]);
  // Après l'envoi depuis la fiche, une carte plus ancienne du fil se replie avec la ligne envoyée.
  assert.equal(briefEnvoyeApres([{ id: 'm0', role: 'assistant', text: '' }, fiche], 'm0'), 'je laisse Mimmo choisir le reste — Bardage bois · fenêtres verticales · balcons · toit plat · logements en rez-de-chaussée · journée');
});

test('fiche : styles — descriptif court pour chacun, vignette contemporaine = VignetteTravee, illustrations des styles « bientôt »', () => {
  for (const s of STYLES) {
    assert.ok(s.descriptif && s.descriptif.length <= 150, `${s.valeur} : ${s.descriptif}`);
    assert.ok(!/conforme|\bav-|manifest|stylepack|french_/.test(s.descriptif!), s.descriptif);
  }
  assert.deepEqual(STYLES.filter((s) => !s.disponible).map((s) => s.valeur), ['haussmannien', 'art_deco']);
  assert.equal(dessinStyle('contemporain'), null);
  const h = dessinStyle('haussmannien')!;
  assert.ok(h.polys.length === 2 && h.rects.length > 20, 'comble brisé + travées');
  const a = dessinStyle('art_deco')!;
  assert.ok(a.polys.length === 0 && a.rects.length > 20 && a.hauteur > 10);
  for (const d of [h, a]) for (const r of d.rects) assert.ok([r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w > 0 && r.h > 0);
});
