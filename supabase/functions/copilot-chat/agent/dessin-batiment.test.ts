// deno test --no-check -A supabase/functions/copilot-chat/agent/dessin-batiment.test.ts
// VIS-25 lot B — outils du chat « dessiner » et « retoucher » (modèle composé) : le modèle propose, le serveur valide ;
// retouches par DIFFÉRENCES sur le dernier modèle de la conversation (lecture bornée) ; message du bouton « Reproduire
// en 3D » (référence + trajet VIS-22) ; écarts avec la 3D préparée ; dessin contraint en hauteur ; avertissements du rendu.
// Aucun réseau.
import * as na from 'node:assert/strict';
import {
  consigneDessinModele, consigneModeleCarte, consigneRetoucheModele, dernierModele, ecartsModeleVolume, executerOutilDessinerBatiment,
  executerOutilRetoucherBatiment, intentionDessinModele, intentionRetoucheModele, modeleContraint, modeleDeLaSortie, modeleParEmpreinte,
  nouveauDessinDemande, OUTIL_DESSINER_BATIMENT_DEF, OUTIL_RETOUCHER_BATIMENT_DEF, REFS_CATALOGUE, reservesModele, STATUTS_CATALOGUE,
  type DepotModele, type MemoireTour,
} from './dessin-batiment.ts';
import { empreinteModele, validerModele, versDescriptionBatiment, type ModeleBatiment } from '../../../../src/lib/studio/modeleBatiment.ts';
import { EXEMPLE_COLLECTIF_U, EXEMPLE_MAISON_BASQUE, EXEMPLE_MAISON_TOURELLE, EXEMPLE_VILLA_L } from '../../../../src/lib/studio/modeleBatimentExemples.ts';
import { descriptionDuMessage } from '../../../../src/lib/studio/descriptionBatiment.ts';
import { messageReproduireModele, porteeModele, referenceModeleDuMessage, sansBlocReference } from '../../../../src/lib/studio/modeleBatimentMessage.ts';
import { messageReproduireEn3D } from './description-batiment.ts';
import { briefDuMessage, descriptionDuFil, type DepotStudio } from './studio.ts';

globalThis.fetch = (() => { throw new Error('RÉSEAU INTERDIT EN TEST'); }) as typeof fetch;
const ok = (v: unknown, m?: string) => na.ok(v, m);
const eq = (a: unknown, b: unknown, m?: string) => na.deepStrictEqual(a, b, m);

const PHARE = {
  nom: 'Phare', type: 'autre', style: 'autre', styleLibre: 'phare breton',
  volumes: [
    { id: 'tour', nom: 'Tour', role: 'tourelle', plan: { type: 'cercle', rayon: 2.5 }, position: { x: 0, y: 0 }, niveaux: 8, hauteurEtage: 3, toit: { forme: 'conique', pente: 50 } },
    { id: 'maisonnette', nom: 'Maison du gardien', role: 'annexe', plan: { type: 'rectangle', largeur: 6, profondeur: 5 }, position: { x: 6, y: 1 }, niveaux: 1, toit: { forme: 'deux_pans' } },
  ],
  ouvertures: [{ id: 'porte', volume: 'tour', facade: 'avant', niveau: 0, type: 'porte' }],
  elements: [{
    id: 'lanterne', type: 'autre', nom: 'lanterne vitrée', point: { x: 0, y: 0, z: 24 },
    briques: [{ forme: 'cylindre', x: 0, y: 0, z: 24, largeur: 3, hauteur: 2.5 }, { forme: 'cone', x: 0, y: 0, z: 26.5, largeur: 3.4, hauteur: 1.5 }],
  }],
};

function valide(brut: unknown): ModeleBatiment {
  const v = validerModele(brut, { refsConnues: REFS_CATALOGUE });
  if (!v.ok) throw new Error(v.erreur);
  return v.modele;
}
function depotDe(sorties: unknown[]): DepotModele & { appels: { u: string; c: string }[] } {
  const appels: { u: string; c: string }[] = [];
  return { appels, async sortiesModele(u, c) { appels.push({ u, c }); return sorties; } };
}

Deno.test('outils : définitions lisibles, exemple réel dans la description, retouches bornées', () => {
  eq(OUTIL_DESSINER_BATIMENT_DEF.name, 'studio_dessiner_batiment');
  eq(OUTIL_RETOUCHER_BATIMENT_DEF.name, 'studio_retoucher_batiment');
  ok(OUTIL_DESSINER_BATIMENT_DEF.description.includes('briques'));
  ok(/JAMAIS qu’une forme n’est pas possible/.test(OUTIL_DESSINER_BATIMENT_DEF.description));
  ok(OUTIL_DESSINER_BATIMENT_DEF.description.includes('"garage"'), 'exemple de la maison basque joint');
  ok(OUTIL_DESSINER_BATIMENT_DEF.available_in_modes.length === 3 && OUTIL_RETOUCHER_BATIMENT_DEF.available_in_modes.length === 3);
  ok(REFS_CATALOGUE.includes('av-enduit-blanc') && STATUTS_CATALOGUE['av-enduit-blanc'] !== undefined);
});

Deno.test('dessiner : les quatre exemples du lot A et un phare (forme libre) donnent une carte, jamais un refus', () => {
  for (const brut of [EXEMPLE_MAISON_BASQUE, EXEMPLE_VILLA_L, EXEMPLE_MAISON_TOURELLE, EXEMPLE_COLLECTIF_U, PHARE]) {
    const memoire: MemoireTour = { dernier: null };
    const r = executerOutilDessinerBatiment({ modele: brut }, { photoAuTour: false, memoire });
    eq(r.status, 'ok', JSON.stringify(r.message));
    const d = r.data as Record<string, unknown>;
    eq(d.carte, 'modele');
    ok(/^mb1-[0-9a-f]{8}$/.test(String(d.empreinte)));
    ok(typeof d.resume === 'string' && (d.resume as string).length > 20);
    ok(Array.isArray(d.portee) && (d.portee as unknown[]).length > 0);
    ok(memoire.dernier !== null, 'mémorisé pour une retouche dans la même requête');
    eq(Object.keys(d).at(-1), 'modele', 'le modèle en dernier (rappel tronqué)');
    // Relu en STRICT depuis la sortie stockée : la sortie de l'outil sert de base aux retouches suivantes.
    const relu = modeleDeLaSortie(r);
    ok(relu !== null);
    eq(empreinteModele(relu!), d.empreinte);
  }
});

Deno.test('dessiner : photo jointe → origine photo et mention « référence de style » ; modèle illisible → erreur sans carte', () => {
  const r = executerOutilDessinerBatiment({ modele: { ...EXEMPLE_VILLA_L, origine: 'texte' } }, { photoAuTour: true });
  eq((r.data as { modele: ModeleBatiment }).modele.origine, 'photo');
  ok(String((r.data as Record<string, unknown>).mention_photo).includes('référence de style'));
  ok(/PHOTO — dis-le tel quel/.test(r.message ?? ''));
  const e = executerOutilDessinerBatiment({ modele: 'une maison' }, { photoAuTour: false });
  eq(e.status, 'error');
  ok(!e.data);
  const e2 = executerOutilDessinerBatiment({ modele: { v: 99, volumes: [] } }, { photoAuTour: false });
  eq(e2.status, 'error');
  ok(/ne dis pas à l’utilisateur que c’est impossible/.test(e2.message ?? ''), e2.message);
  // Modèle sans volume : le contrat le refuse (ou le complète) ; jamais d'exception.
  const vide = executerOutilDessinerBatiment({ modele: { volumes: [] } }, { photoAuTour: false });
  ok(vide.status === 'error' || vide.status === 'ok');
});

Deno.test('retoucher : différences sur le DERNIER modèle relu (borné à l’utilisateur et à la conversation), jamais une reconstruction', async () => {
  const ancien = executerOutilDessinerBatiment({ modele: EXEMPLE_VILLA_L }, { photoAuTour: false });
  const dernier = executerOutilDessinerBatiment({ modele: EXEMPLE_MAISON_BASQUE }, { photoAuTour: false });
  const casse = { status: 'ok', data: { carte: 'modele', modele: { volumes: 'abîmé' } } };
  const depot = depotDe([casse, dernier, ancien]);
  const base = (dernier.data as { modele: ModeleBatiment }).modele;
  const r = await executerOutilRetoucherBatiment({
    retouches: [
      { action: 'modifier', id: 'principal', champs: { niveaux: 3 } },
      { action: 'deplacer', id: 'garage', dx: -2 },
      { action: 'ajouter', quoi: 'ouverture', objet: { volume: 'principal', facade: 'avant', type: 'lucarne' } },
      { action: 'modifier_modele', champs: { matieres: { toiture: { famille: 'ardoise', couleur: '#3c4148' } } } },
    ],
  }, { userId: 'u1', conversationId: 'c1', photoAuTour: false, depot });
  eq(r.status, 'ok', r.message);
  eq(depot.appels, [{ u: 'u1', c: 'c1' }]);
  const d = r.data as { modele: ModeleBatiment; fait: string[]; retouche_de: string };
  eq(d.retouche_de, empreinteModele(base), 'part du dernier modèle valide (la sortie abîmée est ignorée)');
  eq(d.modele.volumes.find((v) => v.id === 'principal')!.niveaux, 3);
  eq(d.modele.volumes.find((v) => v.id === 'garage')!.position.x, base.volumes.find((v) => v.id === 'garage')!.position.x - 2);
  ok(d.modele.ouvertures.some((o) => o.type === 'lucarne'));
  eq(d.modele.matieres.toiture?.famille, 'ardoise');
  // Tout le reste est inchangé : mêmes identifiants, mêmes éléments.
  eq(d.modele.elements.map((e) => e.id), base.elements.map((e) => e.id));
  eq(d.modele.volumes.map((v) => v.id), base.volumes.map((v) => v.id));
  ok(d.fait.length === 4);
});

Deno.test('retoucher : sans modèle → pas de carte ; retouche impossible → modèle inchangé et identifiants donnés', async () => {
  const sans = await executerOutilRetoucherBatiment({ retouches: [{ action: 'retirer', id: 'x' }] }, { userId: 'u1', conversationId: 'c1', photoAuTour: false, depot: depotDe([]) });
  eq(sans.status, 'not_found');
  const dessin = executerOutilDessinerBatiment({ modele: EXEMPLE_MAISON_BASQUE }, { photoAuTour: false });
  const r = await executerOutilRetoucherBatiment({ retouches: [{ action: 'retirer', id: 'inexistant' }] }, { userId: 'u1', conversationId: 'c1', photoAuTour: false, depot: depotDe([dessin]) });
  eq(r.status, 'error');
  ok(/Identifiants disponibles/.test(r.message ?? '') && /garage/.test(r.message ?? ''));
  // Même requête : le dessin du tour sert de base, sans lecture.
  const memoire: MemoireTour = { dernier: null };
  executerOutilDessinerBatiment({ modele: PHARE }, { photoAuTour: false, memoire });
  const depot = depotDe([]);
  const r2 = await executerOutilRetoucherBatiment({ retouches: [{ action: 'modifier', id: 'tour', champs: { niveaux: 9 } }] }, { userId: 'u1', conversationId: 'c1', photoAuTour: false, depot, memoire });
  eq(r2.status, 'ok', r2.message);
  eq(depot.appels.length, 0);
  ok(await dernierModele(depot, null, null, memoire) !== null);
});

Deno.test('détection : dessin (texte, photo, dessin libre), retouche, nouveau dessin', () => {
  ok(intentionDessinModele('Dessine-moi un phare breton avec la maison du gardien', false));
  ok(intentionDessinModele('une maison basque R+1 avec toit deux pans en tuiles, colombages rouges, balcon filant au 1er, garage accolé à gauche', false));
  ok(intentionDessinModele('je veux un bâtiment qui ressemble à ça', true));
  ok(intentionDessinModele('fais-moi une chapelle en 3D', false));
  ok(!intentionDessinModele('dessine-moi un graphique du bilan', false));
  ok(!intentionDessinModele('quel est le PLU de cette parcelle ?', false));
  for (const t of ['ajoute une lucarne', 'décale le garage de 2 m', 'un étage de plus', 'toit en ardoise', 'enlève la véranda', 'plutôt des volets verts', 'mets des fenêtres plus grandes']) {
    ok(intentionRetoucheModele(t), t);
  }
  ok(!intentionRetoucheModele('merci, c’est parfait'));
  ok(!intentionRetoucheModele('ajoute une extension à ma maison'));
  ok(nouveauDessinDemande('dessine-moi plutôt un autre bâtiment'));
});

Deno.test('bouton « Reproduire en 3D » : référence + trajet VIS-22 (description, habillage) dans moins de 8 000 caractères', async () => {
  for (const brut of [EXEMPLE_MAISON_BASQUE, EXEMPLE_COLLECTIF_U, PHARE]) {
    const m = valide(brut);
    const e = empreinteModele(m);
    const texte = messageReproduireModele(m, e);
    ok(texte.length < 8000, `${texte.length}`);
    eq(referenceModeleDuMessage(texte), { ok: true, empreinte: e });
    ok(descriptionDuMessage(texte)?.ok, 'description VIS-22 relue par le serveur');
    ok(briefDuMessage(texte)?.ok, 'habillage relu par le serveur');
    ok(messageReproduireEn3D(texte), 'les outils du Studio sont proposés au tour');
    ok(!sansBlocReference(texte).visible.includes('mimmoza-modele-ref'));
    const relue = descriptionDuMessage(texte);
    eq(relue?.ok ? relue.valeur : null, versDescriptionBatiment(m));
    // Le serveur retrouve le modèle par son empreinte, dans les sorties de la conversation.
    const sortie = executerOutilDessinerBatiment({ modele: brut }, { photoAuTour: false });
    const trouve = await modeleParEmpreinte(depotDe([sortie]), 'u1', 'c1', e);
    ok(trouve && empreinteModele(trouve) === e);
    // La description du fil (VIS-22) reste en vigueur : la 3D préparée et le rendu la lisent comme avant.
    const depot = { briefsMessages: async () => [{ texte, cree_le: '2026-11-23T20:00:00Z' }] } as unknown as DepotStudio;
    ok((await descriptionDuFil(depot, 'u1', 'c1'))?.description);
  }
  eq(referenceModeleDuMessage('```mimmoza-modele-ref\n{"v":1,"empreinte":"x"}\n```'), { ok: false, erreur: 'Référence du bâtiment illisible.' });
  eq(referenceModeleDuMessage('bonjour'), null);
  ok(/introuvable/.test(consigneModeleCarte({ ok: true, empreinte: 'mb1-00000000' }, false)));
  ok(/studio_preparer_3d/.test(consigneModeleCarte({ ok: true, empreinte: 'mb1-00000000' }, true)));
  eq(consigneModeleCarte(null, null), '');
});

Deno.test('consignes : dessiner compose avec des briques ; photo = référence de style ; retouche donne les identifiants', () => {
  ok(/BRIQUES/.test(consigneDessinModele(false)) && /JAMAIS que ce n’est pas possible/.test(consigneDessinModele(false)));
  ok(/RÉFÉRENCE DE STYLE/.test(consigneDessinModele(true)) && !/RÉFÉRENCE DE STYLE/.test(consigneDessinModele(false)));
  const c = consigneRetoucheModele(valide(EXEMPLE_MAISON_BASQUE));
  ok(/studio_retoucher_batiment/.test(c) && /garage/.test(c) && /principal/.test(c));
});

Deno.test('3D préparée : écarts dits ; dessin ramené à la hauteur permise ; jamais plus haut que le moteur', () => {
  const m = valide({ ...EXEMPLE_MAISON_BASQUE, volumes: EXEMPLE_MAISON_BASQUE.volumes.map((v) => (v.id === 'principal' ? { ...v, niveaux: 4 } : v)) });
  const e = ecartsModeleVolume(m, { niveaux: 2, emprise: { largeurM: 8, profondeurM: 7 }, batiments: null });
  ok(e.some((x) => /Hauteur : le dessin monte à R\+3/.test(x) && /R\+1/.test(x)), e.join('|'));
  ok(e.some((x) => /^Emprise : le volume principal dessiné fait 12 × 10 m/.test(x)), e.join('|'));
  ok(e.some((x) => /volume d’étude simple/.test(x)));
  eq(ecartsModeleVolume(m, null), []);
  const c = modeleContraint(m, 2);
  eq(c.modele.volumes.find((v) => v.id === 'principal')!.niveaux, 2);
  eq(c.modele.volumes.find((v) => v.id === 'garage')!.niveaux, 1, 'le garage (1 niveau) est inchangé');
  ok(c.notes.some((n) => /ramené de 4 à 2/.test(n)));
  eq(modeleContraint(m, null).modele, m);
  eq(modeleContraint(m, 10).notes, []);
});

Deno.test('rendu : avertissements honnêtes (photo, briques, photoréalisme) et pastilles par partie', () => {
  const phare = valide({ ...PHARE, origine: 'photo' });
  const a = reservesModele(phare);
  ok(a.some((x) => /référence de style/.test(x)));
  ok(a.some((x) => /1 élément composé de formes simples/.test(x)));
  ok(a.some((x) => /Photoréalisme/.test(x)));
  const p = porteeModele(phare, STATUTS_CATALOGUE);
  ok(p.some((l) => l.categorie === 'volume' && l.id === 'tour'));
  ok(p.some((l) => l.categorie === 'toit' && /conique/.test(l.detail)));
  ok(p.some((l) => l.categorie === 'element' && /Lanterne vitrée/.test(l.libelle)));
  // Une matière dont la texture n'est pas validée pour les images est dite « dans la 3D seulement ».
  const nonValidee = Object.entries(STATUTS_CATALOGUE).find(([r, s]) => s === 'non' && REFS_CATALOGUE.includes(r))?.[0];
  if (nonValidee) {
    const m = valide({ ...EXEMPLE_VILLA_L, matieres: { murs: { refStudio: nonValidee } } });
    const l = porteeModele(m, STATUTS_CATALOGUE).find((x) => x.categorie === 'matiere' && x.id === 'murs');
    eq(l?.portee, '3d');
  }
});
