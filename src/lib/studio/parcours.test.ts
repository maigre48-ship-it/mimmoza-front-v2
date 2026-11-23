// node --test src/lib/studio/parcours.test.ts
// VIS-17 (20/11/2026) — parcours guidé image / film / visite : statuts CALCULÉS depuis l'état réel, résumés, actions.
// Cas réel : conversation f9fa5476… (Ascain, AI0001 + AI0002) — mission de conception 51029769 terminée à 06:23,
// 3D préparée 7b3a3a3b (assiette 2 349 m², 12 logements, 3 bâtiments, R+1), aucun rendu.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  apercuValideDesMessages, avancement, blocParcoursSysteme, calculerParcours, etapeDuClic, interieurRequis, lireBlocParcours,
  lireInstantaneParcours, messageValidationApercu, prochaineEtape, programmeDesCriteres, sourcesDeLInstantane, sourcesVides, terrainDesCriteres, travailParcours,
  typeParcoursDesMessages, typeParcoursDuTexte, vuesDuParcours, type SourcesParcours, type StatutEtape, type TravailParcours,
} from './parcours.ts';
import { PACK_PLAQUETTE } from './catalogueVues.ts';

const APERCU = '11111111-1111-4111-8111-111111111111';
const FINAL = '22222222-2222-4222-8222-222222222222';

/** État réel de la conversation d'Ascain au moment de l'essai (après « Ouvrir mon projet en 3D »). */
function ascain(extra: Partial<SourcesParcours> = {}): SourcesParcours {
  return {
    ...sourcesVides('image'),
    terrain: 'AI0001 + AI0002 (2 349 m²) · 64065',
    conception: { statut: 'terminee', resume: '12 logements · 3 bâtiments · R+1 · 960 m² de surface de plancher' },
    volume: { pret: true, resume: '3 bâtiments en plots, R+1 (hauteur max 7 m), 12 logements placés' },
    ...extra,
  };
}
const statuts = (s: SourcesParcours): StatutEtape[] => calculerParcours(s).etapes.map((e) => e.statut);
const job = (o: Partial<TravailParcours> & { id: string }): TravailParcours => ({
  type: 'image', statut: 'termine', qualite: 'apercu', cree_le: '2026-11-20T08:00:00Z', vues: ['trois_quarts_gauche'], nbImages: 1, livraison: false, ...o,
});

test('trois parcours, 8 étapes chacun, dans l’ordre décidé', () => {
  const titres = (type: 'image' | 'film' | 'visite') => calculerParcours(sourcesVides(type)).etapes.map((e) => `${String(e.numero)} ${e.titre}`);
  assert.deepEqual(titres('image'), ['1 Terrain', '2 Programme & conception', '3 Volume 3D', '4 Style & façades', '5 Intérieurs', '6 Vues & ambiance', '7 Aperçu', '8 Images finales & livraison']);
  assert.deepEqual(titres('film').slice(5), ['6 Scénario du film', '7 Aperçu', '8 Film final']);
  assert.deepEqual(titres('visite').slice(5), ['6 Pièces & points de vue', '7 Aperçu', '8 Visite 360° finale']);
  assert.deepEqual(titres('film').slice(0, 5), titres('image').slice(0, 5));
});

test('conversation vide : terrain à faire, la suite bloquée avec la raison et l’étape qui débloque', () => {
  const p = calculerParcours(sourcesVides('image'));
  // Intérieurs « à faire » : les vues proposées (pack plaquette) comprennent le séjour.
  assert.deepEqual(p.etapes.map((e) => e.statut), ['a_faire', 'bloquee', 'bloquee', 'a_faire', 'a_faire', 'a_faire', 'bloquee', 'bloquee']);
  assert.equal(p.courante, 'terrain');
  const conception = p.etapes[1];
  assert.equal(conception.debloquePar, 'terrain');
  assert.match(conception.raison ?? '', /terrain/);
  assert.equal(p.etapes[7].debloquePar, 'apercu');
  // VIS-20 : le terrain se désigne dans l'étape (champ + carte du panneau), plus par un message générique.
  assert.equal(p.etapes[0].action.cible, 'terrain');
  assert.equal(p.etapes[0].reglage, 'terrain');
});

test('cas réel Ascain : 1–3 faits, prochaine étape = Style & façades, résumés tirés de l’état', () => {
  const p = calculerParcours(ascain());
  assert.deepEqual(p.etapes.slice(0, 4).map((e) => e.statut), ['fait', 'fait', 'fait', 'a_faire']);
  assert.equal(p.courante, 'style');
  assert.equal(prochaineEtape(p)?.titre, 'Style & façades');
  assert.match(p.etapes[0].resume, /AI0001 \+ AI0002/);
  assert.match(p.etapes[1].resume, /12 logements/);
  assert.equal(p.etapes[2].action.cible, 'dimensions');
  assert.equal(p.etapes[2].actionSecondaire?.cible, 'studio-batiment');
  assert.equal(p.etapes[3].action.cible, 'habillage');
  assert.deepEqual(avancement(p), { faites: 3, total: 8 });
});

test('conception : devis, en cours, échec, fiche décrite dans le chat', () => {
  const t = 'AI0001 · Ascain';
  const c = (statut: string) => calculerParcours({ ...sourcesVides(), terrain: t, conception: { statut, resume: null } }).etapes[1];
  assert.equal(c('devis').statut, 'a_faire'); assert.equal(c('devis').action.libelle, 'Lancer la mission'); // VIS-21
  assert.equal(c('en_cours').statut, 'en_cours');
  assert.equal(c('attente_utilisateur').statut, 'en_cours');
  assert.equal(c('echec').statut, 'a_faire'); assert.match(c('echec').resume, /échoué/);
  assert.equal(c('fiche').statut, 'fait');
  assert.equal(c('terminee').action.libelle, 'Modifier');
  // 3D préparée sans mission connue (préparation directe) : la conception est faite.
  assert.equal(calculerParcours({ ...sourcesVides(), terrain: t, volume: { pret: true, resume: 'R+2' } }).etapes[1].statut, 'fait');
});

test('style : fait avec le résumé de l’habillage ; en cours quand Mimmo l’attend', () => {
  const res = 'Brique claire · menuiseries anthracite · balcons filants';
  const fait = calculerParcours(ascain({ habillage: { resume: res, attenduParMimmo: false } })).etapes[3];
  assert.equal(fait.statut, 'fait'); assert.equal(fait.resume, res); assert.equal(fait.action.libelle, 'Modifier');
  const attente = calculerParcours(ascain({ habillage: { resume: null, attenduParMimmo: true } })).etapes[3];
  assert.equal(attente.statut, 'en_cours'); assert.match(attente.raison ?? '', /attend votre habillage/);
});

test('intérieurs : facultatifs sans vue intérieure, requis avec une vue intérieure, faits avec une gamme', () => {
  const sansInterieur = ascain({ rendu: { ...sourcesVides().rendu, vues: ['trois_quarts_gauche', 'aerienne'], vuesChoisies: true } });
  assert.equal(interieurRequis(sansInterieur), false);
  assert.equal(calculerParcours(sansInterieur).etapes[4].statut, 'facultative');
  // Rien de choisi : le pack plaquette proposé contient le séjour → requis.
  assert.deepEqual(vuesDuParcours(ascain()), [...PACK_PLAQUETTE]);
  assert.equal(calculerParcours(ascain()).etapes[4].statut, 'a_faire');
  assert.match(calculerParcours(ascain()).etapes[4].raison ?? '', /logement témoin/);
  const gamme = calculerParcours(ascain({ interieurs: { gamme: 'premium', typologie: 'T3' } })).etapes[4];
  assert.equal(gamme.statut, 'fait');
  assert.match(gamme.resume, /Logement témoin T3, gamme premium/);
  assert.equal(gamme.action.cible, 'studio-interieur');
  // VIS-18b : sans étude, plus d'accès « Gamme » vers un brief absent (impasse) : petit réglage dans l'étape.
  assert.equal(gamme.actionSecondaire, undefined);
  assert.equal(gamme.reglage, 'gamme');
  const avecEtude = calculerParcours(ascain({ interieurs: { gamme: 'premium', typologie: 'T3' }, rendu: { ...sourcesVides().rendu, etudeRattachee: true } })).etapes[4];
  assert.equal(avecEtude.actionSecondaire?.cible, 'reglages-rendu');
  assert.equal(avecEtude.reglage, undefined);
  // Film : requis seulement si « Montrer aussi l'intérieur » est coché.
  const film = (interieurs: boolean) => calculerParcours({ ...ascain(), type: 'film', film: { duree_s: 60, format: '16:9', musique: true, interieurs, ambiance: null } }).etapes[4].statut;
  assert.equal(film(false), 'facultative'); assert.equal(film(true), 'a_faire');
});

test('vues & ambiance : proposé (pack) ou choisi, résumé lisible, réglages du brief si une étude est rattachée', () => {
  const propose = calculerParcours(ascain()).etapes[5];
  assert.equal(propose.statut, 'a_faire');
  assert.match(propose.resume, /^Proposé : 6 vues \(3\/4 gauche, 3\/4 droite, aérienne, cœur d’îlot, terrasse et séjour\)/);
  assert.equal(propose.action.cible, 'feuille-image');
  const choisi = calculerParcours(ascain({ rendu: { vues: ['aerienne', 'angle_rue'], vuesChoisies: true, ambiance: 'fin_de_journee', saison: 'printemps', fond: 'photo_rue', etudeRattachee: true } })).etapes[5];
  assert.equal(choisi.statut, 'fait');
  assert.match(choisi.resume, /^2 vues .* · fin de journée · printemps · photo de la rue\.$/);
  assert.equal(choisi.action.cible, 'reglages-rendu');
});

test('film et visite : réglages résumés sans jargon', () => {
  const f = calculerParcours({ ...ascain(), type: 'film', film: { duree_s: 90, format: '9:16', musique: false, interieurs: true, ambiance: 'fin_de_journee' } }).etapes[5];
  assert.equal(f.statut, 'fait');
  assert.equal(f.resume, '1 min 30 · vertical (téléphone) · fin de journée · sans musique · avec les intérieurs');
  assert.equal(f.action.cible, 'feuille-film');
  const v = calculerParcours({ ...ascain(), type: 'visite', visite: { interieurs: false, resolution: '8k', ambiance: 'jour' } }).etapes[5];
  assert.equal(v.resume, 'extérieurs seulement · très haute qualité · en journée');
  assert.equal(v.action.cible, 'feuille-visite');
  assert.equal(calculerParcours({ ...ascain(), type: 'film' }).etapes[5].statut, 'a_faire');
});

test('aperçu : à faire → en calcul → prêt à valider → validé ; jamais validé sans un aperçu TERMINÉ', () => {
  assert.equal(calculerParcours(ascain()).etapes[6].statut, 'a_faire');
  assert.equal(calculerParcours(ascain()).etapes[6].action.cible, 'apercu');
  const calcul = calculerParcours(ascain({ travaux: [job({ id: APERCU, statut: 'en_cours' })] })).etapes[6];
  assert.equal(calcul.statut, 'en_cours'); assert.match(calcul.resume, /en calcul/);
  const pret = calculerParcours(ascain({ travaux: [job({ id: APERCU })] })).etapes[6];
  assert.equal(pret.statut, 'en_cours'); assert.equal(pret.action.cible, 'resultats'); assert.equal(pret.action.libelle, 'Voir et valider');
  const valide = calculerParcours(ascain({ travaux: [job({ id: APERCU, nbImages: 6 })], apercuValide: APERCU })).etapes[6];
  assert.equal(valide.statut, 'fait'); assert.equal(valide.resume, 'Aperçu validé (6 vues).');
  // Validation d'un id inconnu ou d'un aperçu non terminé : ignorée.
  assert.equal(calculerParcours(ascain({ travaux: [job({ id: APERCU, statut: 'echec' })], apercuValide: APERCU })).etapes[6].statut, 'a_faire');
  assert.equal(calculerParcours(ascain({ apercuValide: APERCU })).etapes[6].statut, 'a_faire');
  // Sans 3D : bloqué, débloqué par le volume.
  const sans3D = calculerParcours({ ...sourcesVides(), terrain: 'AI0001' }).etapes[6];
  assert.equal(sans3D.statut, 'bloquee'); assert.equal(sans3D.debloquePar, 'volume');
});

test('final : bloqué tant que l’aperçu n’est pas validé, puis à faire, en calcul, livré', () => {
  const bloque = calculerParcours(ascain({ travaux: [job({ id: APERCU })] })).etapes[7];
  assert.equal(bloque.statut, 'bloquee'); assert.equal(bloque.raison, 'Validez d’abord l’aperçu.'); assert.equal(bloque.debloquePar, 'apercu');
  const base = { travaux: [job({ id: APERCU })], apercuValide: APERCU };
  assert.equal(calculerParcours(ascain(base)).etapes[7].statut, 'a_faire');
  assert.equal(calculerParcours(ascain(base)).etapes[7].action.cible, 'final');
  const enCalcul = calculerParcours(ascain({ ...base, travaux: [...base.travaux, job({ id: FINAL, qualite: 'finale', statut: 'en_attente', cree_le: '2026-11-20T09:00:00Z' })] })).etapes[7];
  assert.equal(enCalcul.statut, 'en_cours');
  const livre = calculerParcours(ascain({ ...base, travaux: [...base.travaux, job({ id: FINAL, qualite: 'finale', nbImages: 6, livraison: true, cree_le: '2026-11-20T09:00:00Z' })] }));
  assert.equal(livre.etapes[7].statut, 'fait');
  assert.equal(livre.etapes[7].resume, '6 images livrées · formats, ZIP et plan de vente.');
  // Un rendu final déjà livré (ancien parcours, sans aperçu) reste « fait ».
  assert.equal(calculerParcours(ascain({ travaux: [job({ id: FINAL, qualite: 'finale' })] })).etapes[7].statut, 'fait');
  // Un film ne compte pas comme image finale.
  assert.equal(calculerParcours(ascain({ travaux: [job({ id: FINAL, type: 'film', qualite: null })] })).etapes[7].statut, 'bloquee');
  assert.equal(calculerParcours({ ...ascain({ travaux: [job({ id: FINAL, type: 'film', qualite: null })] }), type: 'film' }).etapes[7].statut, 'fait');
});

test('parcours complet : terminé, pas de prochaine étape', () => {
  const p = calculerParcours(ascain({
    habillage: { resume: 'Brique claire', attenduParMimmo: false }, interieurs: { gamme: 'standard', typologie: null },
    rendu: { vues: ['aerienne'], vuesChoisies: true, ambiance: null, saison: null, fond: null, etudeRattachee: false },
    travaux: [job({ id: APERCU }), job({ id: FINAL, qualite: 'finale', cree_le: '2026-11-20T09:00:00Z' })], apercuValide: APERCU,
  }));
  assert.equal(p.termine, true); assert.equal(p.courante, null); assert.equal(prochaineEtape(p), null);
  assert.ok(statuts(ascain()).includes('a_faire'));
});

test('clic sur une étape bloquée → l’étape qui la débloque (en chaîne)', () => {
  const p = calculerParcours(sourcesVides());
  assert.equal(etapeDuClic(p, 'final')?.cle, 'terrain'); // final → aperçu → volume → conception → terrain
  assert.equal(etapeDuClic(p, 'style')?.cle, 'style');
  assert.equal(etapeDuClic(calculerParcours(ascain()), 'final')?.cle, 'apercu');
});

test('rendus de la base (studio_jobs) lus défensivement', () => {
  assert.deepEqual(travailParcours({ id: FINAL, type: 'image', statut: 'termine', cree_le: 'x', options: { vues: ['aerienne', 'inconnue'], qualite: 'apercu' }, resultat: { images: [{}, {}], livraison_commerciale: { version: 1 } } }),
    { id: FINAL, type: 'image', statut: 'termine', qualite: 'apercu', cree_le: 'x', vues: ['aerienne'], nbImages: 2, livraison: true });
  assert.equal(travailParcours({ id: FINAL, type: 'image', statut: 'termine', options: {} })?.qualite, 'finale');
  // VIS-18b : film et visite portent aussi leur qualité (absente = finale ; avant : null, traité comme finale).
  assert.equal(travailParcours({ id: FINAL, type: 'film', statut: 'en_cours' })?.qualite, 'finale');
  assert.equal(travailParcours({ id: FINAL, type: 'maison', statut: 'termine' }), null);
  assert.equal(travailParcours(null), null);
});

test('validation d’aperçu : message lisible + bloc relu, dernier gagnant, bloc masqué', () => {
  const m = messageValidationApercu(APERCU, 'image');
  assert.match(m, /^J’ai regardé l’aperçu et je le valide : on peut passer à les images finales\./);
  const lu = lireBlocParcours(m);
  assert.equal(lu.apercuValide, APERCU); assert.equal(lu.present, true);
  assert.doesNotMatch(lu.visible, /mimmoza-parcours|apercu_valide/);
  assert.equal(apercuValideDesMessages(['bonjour', m, 'merci']), APERCU);
  assert.equal(apercuValideDesMessages(['bonjour']), null);
  assert.equal(lireBlocParcours('```mimmoza-parcours\n{"apercu_valide":"pas-un-id"}\n```').apercuValide, null);
  assert.equal(lireBlocParcours('```mimmoza-parcours\n{illisible\n```').apercuValide, null);
});

test('type de parcours demandé par le message', () => {
  assert.equal(typeParcoursDuTexte('Je voudrais un film de présentation'), 'film');
  assert.equal(typeParcoursDuTexte('une vidéo pour Instagram'), 'film');
  assert.equal(typeParcoursDuTexte('Prépare une visite 360 du projet'), 'visite');
  assert.equal(typeParcoursDuTexte('visite virtuelle'), 'visite');
  assert.equal(typeParcoursDuTexte('Prépare le pack plaquette de ce projet (visuels de commercialisation)'), 'image');
  assert.equal(typeParcoursDuTexte('une image depuis la rue'), 'image');
  assert.equal(typeParcoursDuTexte('Quel est le prix au m² à Ascain ?'), null);
  assert.equal(typeParcoursDuTexte('les filmographies'), null);
  assert.equal(typeParcoursDesMessages(['un film', 'et plutôt des images']), 'image');
  assert.equal(typeParcoursDesMessages(['bonjour']), 'image');
});

test('instantané de l’écran : relu défensivement par le serveur', () => {
  const i = lireInstantaneParcours({
    type: 'film', habillage: '  Brique   claire ', interieurs: { gamme: 'premium', typologie: 'T3' },
    rendu: { vues: ['sejour', 'xx'], vuesChoisies: true, ambiance: 'jour', saison: null, etudeRattachee: true },
    film: { duree_s: 60, format: '9:16', musique: true, interieurs: true, ambiance: 'nuit' }, visite: null, inconnu: 1,
  });
  assert.deepEqual(i, {
    type: 'film', habillage: 'Brique claire', interieurs: { gamme: 'premium', typologie: 'T3' },
    rendu: { vues: ['sejour'], vuesChoisies: true, ambiance: 'jour', saison: null, etudeRattachee: true },
    film: { duree_s: 60, format: '9:16', musique: true, interieurs: true, ambiance: 'nuit' }, visite: null,
  });
  assert.equal(lireInstantaneParcours({ film: { duree_s: 45 } })?.film, null);
  assert.equal(lireInstantaneParcours('x'), null);
  const s = sourcesDeLInstantane(i, 'image');
  assert.equal(s.type, 'film'); assert.equal(s.habillage.resume, 'Brique claire'); assert.equal(s.interieurs.gamme, 'premium');
  assert.equal(sourcesDeLInstantane(null, 'visite').type, 'visite');
});

test('bloc système « PARCOURS — FAIT FOI » : étapes, statuts, prochaine étape, consignes', () => {
  const b = blocParcoursSysteme(calculerParcours(ascain()));
  assert.match(b, /# PARCOURS IMAGES — FAIT FOI/);
  assert.match(b, /1\. Terrain — FAIT — AI0001 \+ AI0002/);
  assert.match(b, /4\. Style & façades — À FAIRE/);
  assert.match(b, /8\. Images finales & livraison — BLOQUÉE — .*\(Validez d’abord l’aperçu\.\)/);
  assert.match(b, /PROCHAINE ÉTAPE : 4\. Style & façades\./);
  assert.match(b, /Ne lance JAMAIS de rendu final/);
  assert.match(b, /vue intérieure sans\nlogement témoin|vue intérieure sans logement témoin/);
  assert.match(blocParcoursSysteme(calculerParcours({ ...ascain(), type: 'visite' })), /# PARCOURS VISITE 360° — FAIT FOI/);
});

test('terrain et programme lus dans les critères RÉELS de la mission 51029769 (assiette groupée)', () => {
  const criteres = { idu: '64065000AI0001', commune: 'Ascain', programme: 'petit collectif R+2', parcel_ids: ['64065000AI0001', '64065000AI0002'] };
  assert.equal(terrainDesCriteres(criteres), 'AI0001 + AI0002 · Ascain');
  assert.equal(terrainDesCriteres({ idu: '64065000AI0001' }), 'AI0001');
  assert.equal(terrainDesCriteres({}), null);
  assert.equal(terrainDesCriteres(null), null);
  assert.equal(programmeDesCriteres(criteres), 'Programme demandé : petit collectif R+2.');
  // Mission en devis sans 3D : la conception est à valider (la mission porte son terrain), pas bloquée.
  const p = calculerParcours({ ...sourcesVides(), terrain: terrainDesCriteres(criteres), conception: { statut: 'devis', resume: null } });
  assert.equal(p.etapes[0].statut, 'fait'); assert.equal(p.etapes[1].statut, 'a_faire'); assert.equal(p.courante, 'conception');
});

test('23/11 — étape 3 « Préparer » : conception terminée connue → action directe gratuite (jamais un message à Mimmo)', () => {
  const s = sourcesVides('image');
  s.terrain = 'AI0002 · Ascain';
  s.conception = { statut: 'terminee', resume: 'R+2, 12 logements', missionId: 'd1cde026' };
  const volume = calculerParcours(s).etapes.find((e) => e.cle === 'volume')!;
  assert.equal(volume.statut, 'a_faire');
  assert.deepEqual(volume.action, { cible: 'mission', operation: 'projet3d', libelle: 'Préparer', missionId: 'd1cde026' });
  // Sans mission connue (fiche seule) : repli sur le message à Mimmo.
  s.conception = { statut: 'fiche', resume: '12 logements' };
  const repli = calculerParcours(s).etapes.find((e) => e.cle === 'volume')!;
  if (repli.statut === 'a_faire') assert.equal(repli.action.cible, 'chat');
});
