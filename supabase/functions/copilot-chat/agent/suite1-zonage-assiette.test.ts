// deno test -A supabase/functions/copilot-chat/agent/suite1-zonage-assiette.test.ts
// LOT SUITE-1 — zonage PLU d'une assiette multi-parcelles : zone lue parcelle par parcelle ;
// mono-zone inchangé ; deux zones lues → règle la plus contraignante, règle par règle ; zone non lue → zone de
// la parcelle la plus grande + avertissement ; une lecture au plus par zone ; hypothèse dans la carte (Studio).
import * as na from 'node:assert/strict';
import { completerRegles, normaliserRegle, type RegleConception } from './conception.ts';
import {
  appliquerZonageAuxRegles, enregistrerLectureZone, hypotheseZonage, lireZonageStocke, lireZonesAssiette, noterTentative, zoneALire,
} from './zonage-assiette.ts';
import { zonageDeLaConception } from './mission.ts';

globalThis.fetch = (() => { throw new Error('RÉSEAU INTERDIT EN TEST'); }) as typeof fetch;
const A1 = '64065000AI0001', A2 = '64065000AI0002', A3 = '64065000AI0003';
const P = (idu: string, s: number, lat: number) => ({ idu, surface_m2: s, surface_calculee_m2: s, ecart_pct: 0, centre: { lat, lon: -1.62 } });
const lecteur = (zones: Record<number, string | null>) => {
  const appels: number[] = [];
  return { appels, lire: async (_idu: string, pt: { lat: number }) => { appels.push(pt.lat); return zones[pt.lat] ?? null; } };
};
const R = (cle: string, valeur: number | null, extra: Record<string, unknown> = {}) =>
  normaliserRegle({ cle, valeur, statut: valeur == null ? 'manquant' : 'confirme', source: 'Règlement GPU', article: 'art. 10 p. 12', ...extra }, 'reglement') as RegleConception;

Deno.test('SUITE-1 mono-zone : une seule zone, aucune hypothèse, rien à relire (comportement inchangé)', async () => {
  const l = lecteur({ 1: 'UB', 2: 'ub' });
  const z = await lireZonesAssiette([P(A1, 800, 1), P(A2, 400, 2)], l.lire);
  na.ok(z);
  na.equal(l.appels.length, 2, 'une lecture GPU par parcelle');
  na.equal(z!.mixte, false);
  na.equal(z!.zone_principale, 'UB');
  na.equal(z!.hypothese, null);
  // Lecture du règlement : la zone lue est UB, aucune règle n'est modifiée par le zonage.
  na.equal(enregistrerLectureZone(z!, 'UB', [R('hauteur_max_m', 12)]), false);
  const regles = completerRegles([R('hauteur_max_m', 12)]);
  na.deepEqual(appliquerZonageAuxRegles(regles, z!), regles);
});

Deno.test('SUITE-1 parcelle seule ou assiette antérieure (sans centres) → null : ancien comportement', async () => {
  const l = lecteur({ 1: 'UA' });
  na.equal(await lireZonesAssiette([P(A1, 800, 1)], l.lire), null);
  na.equal(await lireZonesAssiette([{ idu: A1, surface_m2: 800 }, { idu: A2, surface_m2: 400 }], l.lire), null);
  na.equal(l.appels.length, 0);
  na.equal(zonageDeLaConception({ parcelle: null }), null);
});

Deno.test('SUITE-1 deux zones lues : la règle la plus contraignante, règle par règle, et c\'est dit', async () => {
  const z = (await lireZonesAssiette([P(A1, 400, 1), P(A2, 1200, 2)], lecteur({ 1: 'UA', 2: 'UB' }).lire))!;
  na.equal(z.mixte, true);
  na.deepEqual(z.zones, ['UB', 'UA'], 'zone de la parcelle la plus grande d\'abord');
  na.equal(zoneALire(z), 'UB');
  noterTentative(z, 'UB');
  // 1re lecture (UB) : rien de combiné encore ; hypothèse « UA non lue ».
  const ub = [R('hauteur_max_m', 9), R('emprise_sol_max_pct', 60), R('recul_voie_m', 3), R('recul_limites_m', 4)];
  na.ok(enregistrerLectureZone(z, 'UB', ub));
  na.equal(zoneALire(z), 'UA', 'une lecture complémentaire pour l\'autre zone');
  na.match(z.hypothese!, /zone UB, celle de la parcelle la plus grande \(AI0002, 1 200 m²\) ; zone UA non lue/);
  // 2e lecture (UA) : combinaison.
  const ua = [R('hauteur_max_m', 12), R('emprise_sol_max_pct', 40), R('recul_voie_m', 5), R('recul_limites_m', null)];
  na.ok(enregistrerLectureZone(z, 'UA', ua));
  na.equal(zoneALire(z), null, 'jamais plus d\'une lecture par zone');
  na.deepEqual(z.retenues, { hauteur_max_m: 'UB', emprise_sol_max_pct: 'UA', recul_voie_m: 'UA', recul_limites_m: 'UB' });
  const regles = appliquerZonageAuxRegles(completerRegles(ub), z);
  const v = (c: string) => regles.find((r) => r.cle === c)!;
  na.equal(v('hauteur_max_m').valeur, 9);
  na.equal(v('emprise_sol_max_pct').valeur, 40);
  na.equal(v('recul_voie_m').valeur, 5);
  na.equal(v('recul_limites_m').valeur, 4, 'chiffrée en UB, absente en UA → UB');
  na.match(v('emprise_sol_max_pct').texte!, /zone UA retenue, la plus contraignante \(UB : 60/);
  na.match(z.hypothese!, /AI0001 : UA ; AI0002 : UB/);
  na.match(z.hypothese!, /la règle la plus contraignante des zones UB et UA, règle par règle \(hauteur : UB, emprise : UA, recul voie : UA, recul limites : UB\)/);
  // Règle confirmée par l'utilisateur : jamais remplacée.
  const conf = completerRegles([{ ...R('hauteur_max_m', 15), source: 'Confirmée par l\'utilisateur' }]);
  na.equal(appliquerZonageAuxRegles(conf, z).find((r) => r.cle === 'hauteur_max_m')!.valeur, 15);
  // Stockage (parcelle.assiette.zonage) relu à l'identique.
  const relu = zonageDeLaConception({ parcelle: { assiette: { zonage: JSON.parse(JSON.stringify(z)) } } as never });
  na.deepEqual(relu, z);
});

Deno.test('SUITE-1 zone non lue : zone de la parcelle la plus grande + avertissement « zone X non lue »', async () => {
  const z = (await lireZonesAssiette([P(A1, 300, 1), P(A2, 900, 2), P(A3, 200, 3)], lecteur({ 1: 'UA', 2: 'UC', 3: null }).lire))!;
  na.equal(z.zone_principale, 'UC');
  noterTentative(z, 'UC');
  enregistrerLectureZone(z, 'UC', [R('hauteur_max_m', 10)]);
  // La lecture complémentaire de UA échoue (budget, refus) : tentée une fois, jamais relancée.
  noterTentative(z, 'UA');
  na.equal(zoneALire(z), null);
  const h = hypotheseZonage(z)!;
  na.match(h, /Hypothèse retenue : zone UC, celle de la parcelle la plus grande \(AI0002, 900 m²\) ; zone UA non lue : ses règles peuvent être plus contraignantes/);
  na.match(h, /Zone non lue au Géoportail pour AI0003/);
  // Règles inchangées : seule la zone UC est lue.
  const regles = completerRegles([R('hauteur_max_m', 10)]);
  na.deepEqual(appliquerZonageAuxRegles(regles, z), regles);
  na.equal(lireZonageStocke({ nimporte: 1 }), null);
});
