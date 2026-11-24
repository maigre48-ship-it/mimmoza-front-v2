// deno test --no-check -A supabase/functions/copilot-chat/agent/dessin-batiment-rendu.test.ts
// VIS-25 lot B — le bâtiment DESSINÉ dans le chat atteint la 3D préparée (écarts dits) et la FICHE DU RENDU
// (`modele_batiment`, contraint à la hauteur du moteur), par le code réel de studio.ts. Aucun réseau.
// Conception : celle de description-batiment.test.ts (AE0414, géométrie synthétique 50 × 40 m).
import * as na from 'node:assert/strict';
import { executerOutilDessinerBatiment, executerOutilRetoucherBatiment } from './dessin-batiment.ts';
import {
  executerOutilStudio, ficheDepuisPreparation, modeleDuFil, preparerVolume, validerBrief,
  type BriefRendu, type ConceptionLue, type DepotStudio, type PreparationLue,
} from './studio.ts';
import { empreinteModele, versDescriptionBatiment, type ModeleBatiment } from '../../../../src/lib/studio/modeleBatiment.ts';
import { EXEMPLE_MAISON_BASQUE } from '../../../../src/lib/studio/modeleBatimentExemples.ts';
import { versBrief } from '../../../../src/lib/studio/descriptionBatiment.ts';
import { messageReproduireModele, referenceModeleDuMessage } from '../../../../src/lib/studio/modeleBatimentMessage.ts';
import { appliquerSecteursDeclares, completerRegles, reglesDepuisLecture, type RegleConception } from './conception.ts';

globalThis.fetch = (() => { throw new Error('RÉSEAU INTERDIT EN TEST'); }) as typeof fetch;
const ok = (v: unknown, m?: string) => na.ok(v, m);
const eq = (a: unknown, b: unknown, m?: string) => na.deepStrictEqual(a, b, m);

const SOURCE = 'Règlement GPU — 92050_PLU_20251209';
const IDU = '92050000AE0414';
const USER = '0d6f1a2b-0000-4000-8000-000000000001';
const CONV = '7c0f0000-0000-4000-8000-0000000000aa';
function reglesAE0414(): RegleConception[] {
  const lues = reglesDepuisLecture({ regles: [
    { cle: 'emprise_sol_max_pct', nature: 'non_reglementee', valeur: null, article: 'UC 9, p. 109', texte: 'Il n’est pas fixé de règle.' },
    { cle: 'hauteur_max_m', nature: 'par_secteur', valeur: null, article: 'UC 10, p. 109', regle_relative: 'UC 10-1 : hauteur ≤ distance à l’alignement opposé + 2 m',
      valeurs_par_secteur: [{ secteur: '1', acrotere_terrasse: 28, egout: 26, faitage: 28, texte: '28 m à l’acrotère (toiture terrasse)' }] },
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
function conception(): ConceptionLue {
  return {
    id: '5a1c0e00-0000-4000-8000-0000000000c1', idu: IDU, commune: 'Nanterre',
    parcelle: { idu: IDU, geometrie: rectangle(50, 40), surface_m2: 2000, source: 'synthétique (test)' },
    regles_plu: reglesAE0414(),
    programme: { nb_logements: 40, typologies: {}, shab_cible_m2: null, sdp_cible_m2: null, gabarit: 'R+4', stationnement: null, toiture: 'terrasse' },
  };
}
async function preparation(choix: Parameters<typeof preparerVolume>[1] = {}): Promise<PreparationLue> {
  const p = await preparerVolume(conception(), choix);
  if (!p.ok) throw new Error(p.raison);
  return { id: '9b000000-0000-4000-8000-000000000001', conception_id: '5a1c0e00-0000-4000-8000-0000000000c1', conversation_id: CONV, idu: IDU, empreinte: p.empreinte, entree: p.entree, volume: p.volume, resume: p.resume } as unknown as PreparationLue;
}
function briefDe(m: ModeleBatiment): BriefRendu {
  const v = validerBrief(versBrief(versDescriptionBatiment(m)));
  if (!v.ok) throw new Error(v.erreur);
  return v.valeur;
}

/** Dessin d'une maison basque montée à R+5 (plus haut que le moteur ne le permettra pour cette maison préparée à R+1). */
function dessin(): { sortie: ReturnType<typeof executerOutilDessinerBatiment>; modele: ModeleBatiment } {
  const brut = { ...EXEMPLE_MAISON_BASQUE, volumes: EXEMPLE_MAISON_BASQUE.volumes.map((v) => (v.id === 'principal' ? { ...v, niveaux: 6 } : v)) };
  const sortie = executerOutilDessinerBatiment({ modele: brut }, { photoAuTour: false });
  return { sortie, modele: (sortie.data as { modele: ModeleBatiment }).modele };
}

Deno.test('fiche du rendu : le modèle voyage (contraint à la hauteur du moteur) avec sa description ; plusieurs bâtiments → non joint', async () => {
  const { modele } = dessin();
  const p = await preparation({ forme: 'plot', niveaux: 2 });
  const d = versDescriptionBatiment(modele);
  const f = ficheDepuisPreparation(p, CONV, '2026-11-23T12:00:00.000Z', crypto.randomUUID(), 'https://mimmoza.vercel.app', briefDe(modele), null, { description: d, modele });
  ok(f.ok, f.ok ? '' : f.erreur);
  if (!f.ok) return;
  const mb = f.valeur.modele_batiment as { v: number; empreinte: string; modele: ModeleBatiment; notes?: string[] };
  ok(mb, 'modele_batiment joint');
  eq(mb.v, 1);
  eq(mb.empreinte, empreinteModele(modele), 'empreinte du dessin d’origine (celle du devis)');
  const niv = (p.volume as { niveaux: number }).niveaux;
  ok(mb.modele.volumes.every((v) => v.niveaux <= niv), `niveaux ≤ ${niv}`);
  ok(mb.notes?.some((n) => /ramené de 6 à/.test(n)), JSON.stringify(mb.notes));
  eq(mb.modele.volumes.map((v) => v.id), modele.volumes.map((v) => v.id), 'garage et corps principal gardés');
  ok(JSON.stringify(f.valeur).length < 400_000);
  // Sans description (habillage choisi ensuite) : le modèle n'est plus en vigueur.
  const sans = ficheDepuisPreparation(p, CONV, '2026-11-23T12:00:00.000Z', crypto.randomUUID(), 'https://mimmoza.vercel.app', briefDe(modele), null, { description: null, modele });
  ok(sans.ok && !('modele_batiment' in sans.valeur));
  // Plusieurs bâtiments (programme réparti par le moteur) : jamais un dessin posé sur le premier bâtiment seulement.
  const pm = await preparation({});
  const fm = ficheDepuisPreparation(pm, CONV, '2026-11-23T12:00:00.000Z', crypto.randomUUID(), 'https://mimmoza.vercel.app', briefDe(modele), null, { description: d, modele });
  const multi = fm.ok && (((fm.valeur.charge as { batiments?: unknown[] }).batiments?.length ?? 0) > 0 || ((fm.valeur.charge as { compositionArchitecture?: unknown[] }).compositionArchitecture?.length ?? 0) > 0);
  if (multi) ok(!('modele_batiment' in (fm as { valeur: Record<string, unknown> }).valeur));
});

Deno.test('conversation : le modèle en vigueur = référence du DERNIER message d’habillage, retrouvée par son empreinte (lecture bornée)', async () => {
  const { sortie, modele } = dessin();
  const retouche = await executerOutilRetoucherBatiment({ retouches: [{ action: 'modifier', id: 'garage', champs: { niveaux: 1, toit: { forme: 'terrasse' } } }] },
    { userId: USER, conversationId: CONV, photoAuTour: false, depot: { sortiesModele: () => Promise.resolve([sortie]) } });
  eq(retouche.status, 'ok', retouche.message);
  const modele2 = (retouche.data as { modele: ModeleBatiment }).modele;
  const appels: string[] = [];
  const depot = (messages: string[]) => ({
    briefsMessages: (u: string, c: string) => { appels.push(`${u}/${c}`); return Promise.resolve(messages.map((texte, i) => ({ texte, cree_le: `2026-11-23T1${9 - i}:00:00Z` }))); },
    sortiesModele: (u: string, c: string) => { appels.push(`${u}/${c}`); return Promise.resolve([retouche, sortie]); },
  }) as unknown as DepotStudio;
  // « Reproduire en 3D » de la PREMIÈRE carte puis de la carte retouchée : c'est la version retouchée qui vaut.
  const m1 = messageReproduireModele(modele, empreinteModele(modele));
  const m2 = messageReproduireModele(modele2, empreinteModele(modele2));
  eq((await modeleDuFil(depot([m2, m1]), USER, CONV))?.empreinte, empreinteModele(modele2));
  eq((await modeleDuFil(depot([m1, m2]), USER, CONV))?.empreinte, empreinteModele(modele));
  ok(appels.every((a) => a === `${USER}/${CONV}`), 'lecture bornée à l’utilisateur et à la conversation');
  // Un habillage choisi ensuite dans l'Espace 3D (sans référence) : plus de modèle en vigueur.
  const panneau = 'Habillage choisi\n\n```mimmoza-brief\n' + JSON.stringify({ v: 1, brief: versBrief(versDescriptionBatiment(modele)) }) + '\n```';
  eq(await modeleDuFil(depot([panneau, m1]), USER, CONV), null);
  // Référence d'un modèle absent de la conversation : null (jamais deviné).
  const faux = m1.replace(/mb1-[0-9a-f]{8}/, 'mb1-00000000');
  ok(referenceModeleDuMessage(faux)?.ok);
  eq(await modeleDuFil(depot([faux]), USER, CONV), null);
});

Deno.test('3D préparée : « Reproduire en 3D » d’un dessin → forme et hauteur au moteur, écarts du dessin DITS', async () => {
  const { sortie, modele } = dessin();
  const texte = messageReproduireModele(modele, empreinteModele(modele));
  const ref = referenceModeleDuMessage(texte);
  let preparee: Record<string, unknown> | null = null;
  const depot = {
    conception: () => Promise.resolve(conception()),
    enregistrerPreparation: (_u: string, l: Record<string, unknown>) => { preparee = l; return Promise.resolve('9b000000-0000-4000-8000-000000000002'); },
    briefsMessages: () => Promise.resolve([{ texte, cree_le: '2026-11-23T19:00:00Z' }]),
    sortiesModele: () => Promise.resolve([sortie]),
    sortiesExtension: () => Promise.resolve([]), sortiesMaison: () => Promise.resolve([]), dernierParcours: () => Promise.resolve(null),
  } as unknown as DepotStudio;
  const { descriptionDuMessage } = await import('../../../../src/lib/studio/descriptionBatiment.ts');
  const r = await executerOutilStudio('studio_preparer_3d', {}, {
    userId: USER, depot, secret: 's', requete: 'r1', conversationId: CONV, origine: 'https://mimmoza.vercel.app',
    batimentCarte: descriptionDuMessage(texte), modeleCarte: ref,
  });
  ok(r && r.status === 'ok', JSON.stringify(r?.message));
  ok(preparee, 'préparation enregistrée');
  const bd = (r!.data as Record<string, unknown>).batiment_decrit as { ecarts: string[]; pas_encore_reproduit: string[]; modele?: { empreinte: string; ecarts: string[] } };
  ok(bd.modele, JSON.stringify(bd));
  eq(bd.modele!.empreinte, empreinteModele(modele));
  ok(bd.modele!.ecarts.some((e) => /^Hauteur : le dessin monte à R\+5/.test(e)), bd.modele!.ecarts.join(' | '));
  eq(bd.pas_encore_reproduit, [], 'le garage accolé est construit par le dessin : plus « pas encore »');
  // Référence introuvable : la description seule est appliquée, et c'est dit.
  const depot2 = { ...depot, sortiesModele: () => Promise.resolve([]) } as unknown as DepotStudio;
  const r2 = await executerOutilStudio('studio_preparer_3d', {}, {
    userId: USER, depot: depot2, secret: 's', requete: 'r2', conversationId: CONV, origine: 'https://mimmoza.vercel.app',
    batimentCarte: descriptionDuMessage(texte), modeleCarte: ref,
  });
  const bd2 = (r2!.data as Record<string, unknown>).batiment_decrit as { ecarts: string[]; modele?: unknown };
  ok(!bd2.modele && bd2.ecarts.some((e) => /n’a pas été retrouvé/.test(e)), JSON.stringify(bd2));
});
