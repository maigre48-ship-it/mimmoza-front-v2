// L3 — aller-retour Implantation 2D ↔ Studio : projection, application du retour,
// contrôle recalculé par Mimmoza, persistance et reprise, transport (origines, poignée de main).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Feature, Polygon } from "geojson";

import type { Building2D } from "../../plan2d/editor2d.types.ts";
import { construireSegments, type Pt } from "../../implantation/boundaryDistances.ts";
import { classementFinal, signatureParcelle } from "../../implantation/limitesClassement.ts";
import type { EtatRuleset } from "../../implantation/rulesetReculs.ts";
import {
  appliquerRetourAuPlan, baseApresAcceptation, classerChangements, comparerVerdicts, controleRecalcule, projectionDepuisFeature, projetDepuisPromoteur, versLocal, versLonLat,
  type EntreeProjetPromoteur,
} from "./projetPromoteur.ts";
import {
  accepterRetour, cleEchange, ecrireEchangeStocke, enregistrerEnvoi, ignorerRetour, lireEchangeStocke, nouvelEchange, parentPourEnvoi, recevoirRetour,
} from "./persistanceEchange.ts";
import { demarrerPoigneeDeMain, examinerMessageStudio, originesStudio, sessionDeChargeV1, type Minuterie } from "./transportStudio.ts";
import {
  comparerProjets, creerMessage, empreinteProjet, encoderProjet, decoderProjet, etatSynchronisation, nouvelleRevision, type ProjetMimmozaV2,
} from "./mimmozaProjetV2.ts";

// Parcelle carrée d'environ 80 m × 89 m à Ascain (WGS 84).
const LON0 = -1.6205, LAT0 = 43.344, C = 0.001, D = 0.0008;
const FEATURE: Feature<Polygon> = {
  type: "Feature", properties: {},
  geometry: { type: "Polygon", coordinates: [[[LON0, LAT0], [LON0 + C, LAT0], [LON0 + C, LAT0 + D], [LON0, LAT0 + D], [LON0, LAT0]]] },
};
const PR = projectionDepuisFeature(FEATURE)!;

function batiment(id: string, label: string, cx: number, cy: number, w: number, d: number, rot = 0, etages = 3, volumes = 1): Building2D {
  const vols = Array.from({ length: volumes }, (_, i) => ({ id: `${id}-v${String(i)}`, rect: { center: { x: cx + (i - (volumes - 1) / 2) * (w / volumes), y: cy }, width: w / volumes, depth: d, rotationDeg: rot }, role: "main" as const }));
  return {
    id, kind: "building", label, rect: { center: { x: cx, y: cy }, width: w, depth: d, rotationDeg: rot },
    floorPlans: [{ id: `${id}-rdc`, levelIndex: 0, label: "RDC", volumes: vols, balconies: [], loggias: [], terraces: [] }],
    floorsAboveGround: etages, groundFloorHeightM: 3, typicalFloorHeightM: 2.8, roofType: "flat", balconies: [], loggias: [], terraces: [], volumes: [],
  };
}

const RULESET = {
  version: "plu_ruleset_v1", document_id: "8f2c1a7e-plu-ascain-2019", commune_insee: "64065", zone_code: "UB", source: "plu-universal-parser", confidence_score: 0.82,
  reculs: { voirie: { type: "FIXED", min_m: 5 }, limites_separatives: { type: "FIXED", min_m: 3 }, fond_parcelle: { type: "FIXED", min_m: 4 }, implantation_en_limite: { autorisee: false } },
};
const ETAT: EtatRuleset = { statut: "ok", ruleset: RULESET };

function entree(buildings: Building2D[], base: ProjetMimmozaV2 | null = null, refsFront: Record<string, string> = {}): EntreeProjetPromoteur {
  return {
    projetId: "mz-etude-42", etudeId: "etude-42", horodatage: "2026-10-14T09:00:00.000Z",
    session: { id: "abcd1234-0000-4000-8000-000000000042", conversationId: null, retourOrigine: "http://localhost:5173", retourUrl: "http://localhost:5173/promoteur/implantation-2d?study=etude-42" },
    featureCombinee: FEATURE, parcelles: [{ id: "64065000AI0001", feature: FEATURE }], communeInsee: "64065", adresse: "Ascain", pointAdresse: null,
    relief: { provider: "IGN_ALTI", renderBounds: [0, 0, 1, 1], parcelBounds: [0, 0, 1, 1], grid: { n: 2, z: [[40, 41], [41, 42]] }, altitudeMin: 40, altitudeMax: 42, penteMoyenne: 3 },
    buildings, base, refsFront, etatRuleset: ETAT, validations: {}, controle: null, logementsVises: 12,
  };
}

const lire = (e: EntreeProjetPromoteur): ProjetMimmozaV2 => {
  const lu = projetDepuisPromoteur(e);
  assert.ok(lu.ok, lu.ok ? "" : lu.erreur);
  return lu.projet;
};

let compteur = 0;
const nouvelId = () => `n${String(++compteur)}`;

test("projection : même repère qu'Implantation2DPage, aller-retour WGS 84 ↔ local au millimètre", () => {
  // Centre = moyenne des 5 sommets (fermeture comprise), comme wgs84FeatureToLocalMeters.
  assert.ok(Math.abs(PR.centLon - (LON0 * 3 + (LON0 + C) * 2) / 5) < 1e-12);
  const p = { x: 12.345, y: -7.89 };
  const q = versLocal(PR, versLonLat(PR, p));
  assert.ok(Math.hypot(q.x - p.x, q.y - p.y) < 1e-3);
  // y = sud : un point plus au nord a un y plus petit.
  assert.ok(versLocal(PR, { lon: PR.centLon, lat: PR.centLat + 0.0001 }).y < 0);
});

test("aller-retour sans perte : Studio renvoie le projet inchangé → plan 2D identique, aucun changement, aucun conflit", () => {
  const plan = [batiment("A", "A", -10, 5, 24, 12, 0, 3, 2), batiment("B", "B", 20, -10, 18, 10, 37.5, 4)];
  const envoye = lire(entree(plan));
  assert.equal(envoye.batiments.length, 2);
  assert.equal(envoye.regles.length, 3);
  assert.equal(envoye.regles[0]!.zone, "UB");
  // Studio renvoie le même contenu (bruit de projection < 1 mm sur les positions).
  const retour = nouvelleRevision({ ...envoye, origine: "mimmoza-studio",
    batiments: envoye.batiments.map((b) => ({ ...b, centre: { lon: b.centre.lon + 4e-9, lat: b.centre.lat - 3e-9 }, refs: { ...b.refs, studio: `s-${b.id}` } })) }, "mimmoza-studio", "2026-10-14T09:05:00.000Z", envoye);
  const relu = decoderProjet(encoderProjet(retour));
  assert.ok(relu.ok);
  assert.deepEqual(comparerProjets(envoye, relu.projet), []);
  const app = appliquerRetourAuPlan(plan, relu.projet, envoye, {}, PR, nouvelId);
  assert.equal(app.buildings.length, 2);
  for (const [i, b] of app.buildings.entries()) {
    const o = plan[i]!;
    assert.ok(Math.hypot(b.rect.center.x - o.rect.center.x, b.rect.center.y - o.rect.center.y) < 0.002);
    assert.ok(Math.abs(b.rect.rotationDeg - o.rect.rotationDeg) < 1e-6);
    assert.equal(b.floorsAboveGround, o.floorsAboveGround);
    assert.equal(b.floorPlans[0]!.volumes.length, o.floorPlans[0]!.volumes.length);
  }
  // Après application, l'état local recalculé = la base acceptée (pas de faux conflit ensuite).
  const local = lire(entree(app.buildings, relu.projet, app.refsFront));
  assert.deepEqual(comparerProjets(relu.projet, local), []);
  assert.equal(etatSynchronisation(relu.projet, local, relu.projet), "distant-inchange");
});

test("retour modifié : déplacement de 2,3 m, rotation, niveau, bâtiment ajouté et supprimé → appliqués après lecture des changements", () => {
  const plan = [batiment("A", "A", -10, 5, 24, 12, 0, 3, 2), batiment("B", "B", 20, -10, 18, 10, 0, 4), batiment("C", "C", 0, 30, 8, 6, 0, 0)];
  const envoye = lire(entree(plan));
  const [a, b] = envoye.batiments;
  const retour: ProjetMimmozaV2 = nouvelleRevision({
    ...envoye,
    batiments: [
      { ...a!, centre: { lon: a!.centre.lon, lat: a!.centre.lat + 2.3 / 110_574 }, rotationDeg: 10, niveaux: 5 },
      b!,
      { ...a!, id: "studio-x9", nom: "D", centre: { lon: a!.centre.lon + 0.0002, lat: a!.centre.lat }, ailes: [], refs: { front: null, studio: "x9" } },
    ],
  }, "mimmoza-studio", "2026-10-14T09:10:00.000Z", envoye);
  const libelles = comparerProjets(envoye, retour).map((c) => c.libelle);
  assert.ok(libelles.includes("bâtiment A déplacé de 2,3 m"), libelles.join(" | "));
  assert.ok(libelles.includes("bâtiment A tourné de 10,0°"));
  assert.ok(libelles.includes("bâtiment A : 4 → 5 niveaux"));
  assert.ok(libelles.some((l) => l.startsWith("bâtiment D ajouté")));
  assert.ok(libelles.includes("bâtiment C supprimé"));
  // Un bâtiment ajouté dans Mimmoza APRÈS l'envoi est conservé.
  const avecLocal = [...plan, batiment("E", "E", 30, 30, 6, 6)];
  const app = appliquerRetourAuPlan(avecLocal, retour, envoye, {}, PR, nouvelId);
  const parLabel = new Map(app.buildings.map((x) => [x.label, x]));
  assert.deepEqual([...parLabel.keys()].sort(), ["A", "B", "D", "E"]);
  const A = parLabel.get("A")!;
  assert.ok(Math.abs(A.rect.center.y - (5 - 2.3)) < 0.01, String(A.rect.center.y));
  assert.equal(A.rect.rotationDeg, 10);
  assert.equal(A.floorsAboveGround, 4);
  // Les volumes du RDC suivent le bâtiment (même rotation, centre déplacé).
  const v0 = A.floorPlans[0]!.volumes[0]!;
  assert.equal(v0.rect.rotationDeg, 10);
  assert.ok(Math.abs(Math.hypot(v0.rect.center.x - A.rect.center.x, v0.rect.center.y - A.rect.center.y) - 6) < 1e-6);
  assert.deepEqual(app.supprimes, ["C"]);
  assert.deepEqual(app.ajoutes, ["D"]);
  assert.equal(app.refsFront["studio-x9"], parLabel.get("D")!.id);
});

test("contrôle recalculé par Mimmoza : le verdict de Studio n'est jamais repris tel quel", () => {
  const anneau: Pt[] = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }];
  const choix = { signature: signatureParcelle([anneau]), choix: { "p0-e0": "voirie", "p0-e1": "separative", "p0-e2": "fond", "p0-e3": "separative" } } as const;
  const segments = construireSegments([anneau], classementFinal([anneau], 0, choix));
  // Studio a déplacé le bâtiment à 1 m de la voirie (y = 0) et prétend « respecte ».
  const propose = [batiment("A", "A", 20, 7, 20, 12)];
  const c = controleRecalcule(segments, [anneau], propose, ETAT, {}, "64065");
  const lv = c.batiments[0]!.limites.find((l) => l.segmentId === "p0-e0")!;
  assert.ok(Math.abs(lv.distance - 1) < 1e-9);
  assert.notEqual(lv.verdict, "respecte");
  const studio = { calculePar: "mimmoza-studio" as const, calculeLe: "2026-10-14T09:00:00.000Z", niveau: "respecte-regles-sourcees-connues", libelle: "Respecte", indicatif: true as const,
    lignes: [{ batimentId: "f-A", limiteId: "seg-1", categorie: "public-road", distanceM: 1, minimumM: 5, verdict: "respecte" as const, raison: null }] };
  const cmp = comparerVerdicts(c, studio, {});
  assert.equal(cmp.divergences.length, 1);
  assert.match(cmp.libelle, /le recalcul Mimmoza fait foi/);
  assert.match(comparerVerdicts(c, null, {}).libelle, /seul le recalcul Mimmoza fait foi/);
});

class StockageSimule {
  readonly donnees = new Map<string, string>();
  utilisateur: string;
  constructor(utilisateur: string) { this.utilisateur = utilisateur; }
  connecter(u: string): void { this.utilisateur = u; }
  getItem(k: string): string | null { return this.donnees.get(`u:${this.utilisateur}:${k}`) ?? null; }
  setItem(k: string, v: string): void { this.donnees.set(`u:${this.utilisateur}:${k}`, v); }
}

test("persistance par utilisateur et par étude : reprise après rechargement, retour en attente conservé, conflit signalé", () => {
  const stockage = new StockageSimule("alice");
  const maintenant = "2026-10-14T09:00:00.000Z";
  const e0 = nouvelEchange("etude-42", () => "zz", maintenant);
  // R2 (A4) : identifiant aléatoire, sans l'identifiant d'étude en clair ; stabilité assurée par le stockage.
  assert.equal(e0.projetId, "mz-zz");
  assert.ok(!e0.projetId.includes("etude-42"));
  const plan = [batiment("A", "A", -10, 5, 24, 12)];
  const envoye = lire(entree(plan));
  assert.ok(ecrireEchangeStocke(stockage, enregistrerEnvoi(e0, envoye, maintenant)));
  // « Fermeture du navigateur » : seule la mémoire du stockage reste.
  const relu = lireEchangeStocke(stockage, "etude-42");
  assert.ok(relu);
  assert.deepEqual(relu!.base, envoye);
  assert.equal(relu!.projetId, envoye.projetId, "même étude rouverte → même projet (pas de doublon)");
  assert.equal(relu!.sessionId, envoye.session!.id);
  // Un autre utilisateur ou une autre étude ne voit rien.
  stockage.connecter("bob");
  assert.equal(lireEchangeStocke(stockage, "etude-42"), null);
  stockage.connecter("alice");
  assert.equal(lireEchangeStocke(stockage, "etude-43"), null);
  assert.ok(cleEchange("etude-42").includes("etude-42"));
  // Retour de Studio : mis en attente (persisté), pas appliqué.
  const a = envoye.batiments[0]!;
  const retour = nouvelleRevision({ ...envoye, batiments: [{ ...a, rotationDeg: 15 }] }, "mimmoza-studio", "2026-10-14T09:30:00.000Z", envoye);
  const an = recevoirRetour(relu!, retour, envoye, maintenant);
  assert.ok(!("erreur" in an));
  if ("erreur" in an) return;
  assert.equal(an.etat, "distant-seul");
  ecrireEchangeStocke(stockage, an.echange);
  assert.deepEqual(lireEchangeStocke(stockage, "etude-42")!.enAttente, retour);
  // Les deux côtés ont changé : conflit signalé, avec ce que Mimmoza a changé localement.
  const localModifie = lire(entree([batiment("A", "A", -4, 5, 24, 12)], envoye));
  const conflit = recevoirRetour(relu!, retour, localModifie, maintenant);
  assert.ok(!("erreur" in conflit) && conflit.etat === "conflit");
  if (!("erreur" in conflit)) assert.ok(conflit.changementsLocaux.some((c) => c.type === "deplacement"));
  // Accepter → nouvelle base ; ignorer → base inchangée.
  const acc = accepterRetour(an.echange, retour, { "f-A": "A" }, maintenant);
  assert.equal(acc.enAttente, null);
  assert.deepEqual(acc.base, retour);
  assert.deepEqual(ignorerRetour(an.echange, maintenant).base, envoye);
  // Retour d'un autre projet : refusé.
  assert.ok("erreur" in recevoirRetour(relu!, { ...retour, projetId: "mz-autre" }, envoye, maintenant));
  // Stockage corrompu : aucune exception, rien de relu.
  stockage.setItem(cleEchange("etude-9"), "{pas du json");
  assert.equal(lireEchangeStocke(stockage, "etude-9"), null);
});

test("transport : origine non autorisée, message malformé ou session inconnue → ignorés", () => {
  const liste = originesStudio("https://studio.mimmoza.fr, *", "https://studio.mimmoza.fr/studio/");
  assert.deepEqual(liste, ["https://studio.mimmoza.fr"]);
  const envoye = lire(entree([batiment("A", "A", 0, 0, 10, 10)]));
  const sid = envoye.session!.id;
  const sessions = new Set([sid]);
  const page = "https://mimmoza.fr";
  const retour = creerMessage("retour", sid, { ...envoye, origine: "mimmoza-studio" as const });
  assert.equal(examinerMessageStudio({ origin: "https://evil.example", data: retour }, liste, page, sessions).type, "ignore");
  assert.equal(examinerMessageStudio({ origin: "http://localhost:5174", data: retour }, liste, page, sessions).type, "ignore");
  assert.equal(examinerMessageStudio({ origin: "https://studio.mimmoza.fr", data: { ...retour, projet: { format: "x" } } }, liste, page, sessions).type, "ignore");
  assert.equal(examinerMessageStudio({ origin: "https://studio.mimmoza.fr", data: "texte" }, liste, page, sessions).type, "ignore");
  assert.equal(examinerMessageStudio({ origin: "https://studio.mimmoza.fr", data: retour }, liste, page, new Set()).type, "ignore");
  assert.equal(examinerMessageStudio({ origin: "https://studio.mimmoza.fr", data: creerMessage("bonjour", sid) }, liste, page, sessions).type, "ignore");
  const ok = examinerMessageStudio({ origin: "https://studio.mimmoza.fr", data: JSON.parse(JSON.stringify(retour)) }, liste, page, sessions);
  assert.equal(ok.type, "retour");
  assert.equal(examinerMessageStudio({ origin: "https://studio.mimmoza.fr", data: creerMessage("pret", sid, null, true) }, liste, page, sessions).type, "pret");
  // En développement seulement (devLocal), une origine source localhost est admise.
  assert.equal(examinerMessageStudio({ origin: "http://localhost:5174", data: retour }, [], "http://localhost:5173", sessions, true).type, "retour");
  assert.equal(examinerMessageStudio({ origin: "http://localhost:5174", data: retour }, [], "http://localhost:5173", sessions, false).type, "ignore");
  // R2 (A6) : un « retour » dont l'origine déclarée n'est pas Studio est ignoré.
  assert.equal(examinerMessageStudio({ origin: "https://studio.mimmoza.fr", data: creerMessage("retour", sid, envoye) }, liste, page, sessions).type, "ignore");
});

test("poignée de main initiée par Mimmoza : « bonjour » vers l'origine exacte du Studio, projet envoyé après « prêt »", () => {
  let t = 0;
  let tic: (() => void) | null = null;
  let periode = 0;
  const minuterie: Minuterie = { setInterval: (f, ms) => { tic = f; periode = ms; return 1; }, clearInterval: () => { tic = null; }, maintenant: () => t };
  const recus: { message: unknown; cible: string }[] = [];
  const onglet = { closed: false, postMessage: (message: unknown, cible: string) => { recus.push({ message, cible }); } };
  const projet = lire(entree([batiment("A", "A", 0, 0, 10, 10)]));
  const sid = projet.session!.id;
  const h = demarrerPoigneeDeMain(onglet, "http://localhost:5174", sid, projet, { minuterie, intervalleMs: 500, dureeMaxMs: 2000 });
  tic!(); t = 500; tic!();
  assert.equal(recus.length, 2);
  assert.ok(recus.every((r) => r.cible === "http://localhost:5174" && (r.message as { canal: string }).canal === "bonjour"));
  h.surPret(true);
  assert.equal(h.actif(), false);
  assert.equal(recus.length, 3);
  assert.equal((recus[2]!.message as { canal: string }).canal, "projet");
  assert.equal(tic, null);
  // Sans réponse : arrêt au bout de dureeMaxMs.
  const h2 = demarrerPoigneeDeMain(onglet, "http://localhost:5174", sid, null, { minuterie, dureeMaxMs: 1000 });
  t = 10_000; tic!();
  assert.equal(h2.actif(), false);
});

test("poignée de main maintenue : après « prêt », Studio peut retrouver la fenêtre Mimmoza même après un rechargement", () => {
  let t = 0;
  let tic: (() => void) | null = null;
  let periode = 0;
  const minuterie: Minuterie = { setInterval: (f, ms) => { tic = f; periode = ms; return 1; }, clearInterval: () => { tic = null; }, maintenant: () => t };
  const recus: unknown[] = [];
  const onglet = { closed: false, postMessage: (message: unknown) => { recus.push(message); } };
  const projet = lire(entree([batiment("A", "A", 0, 0, 10, 10)]));
  const h = demarrerPoigneeDeMain(onglet, "http://localhost:5174", projet.session!.id, projet, { minuterie, maintenir: true, dureeMaxMs: 1000 });
  h.surPret(true);
  h.surPret(true);
  assert.equal(recus.filter((m) => (m as { canal: string }).canal === "projet").length, 1, "projet envoyé une seule fois");
  assert.equal(h.connecte(), true);
  assert.equal(periode, 2000);
  t = 1_000_000; tic!();
  assert.equal(h.actif(), true, "pas de limite de durée une fois connecté");
  onglet.closed = true; tic!();
  assert.equal(h.actif(), false, "arrêt quand l'onglet Studio est fermé");
});

test("atelier 3D du tchat (charge v1) : la session de retour est lue dans l'ancre pour la poignée de main", () => {
  const v1 = { version: 1, source: "mimmoza-front-v2", bridgeSessionId: "11111111-2222-3333-4444-555555555555", parcels: [] };
  const code = Buffer.from(JSON.stringify(v1)).toString("base64url");
  assert.equal(sessionDeChargeV1(`http://localhost:5174/#parcelles=${code}`), v1.bridgeSessionId);
  assert.equal(sessionDeChargeV1("http://localhost:5174/#parcelles=@@@"), null);
  assert.equal(sessionDeChargeV1("http://localhost:5174/"), null);
});

// ------------------------------------------------------------------ R2

test("R2 (A5) la fenêtre ne montre comme appliqué que ce que « Appliquer » fait ; les règles sont « à confirmer », jamais appliquées", () => {
  const plan = [batiment("A", "A", -10, 5, 24, 12)];
  const envoye = lire(entree(plan));
  const a = envoye.batiments[0]!;
  const retour = nouvelleRevision({
    ...envoye,
    batiments: [{ ...a, nom: "A bis", rotationDeg: 12, ailes: [{ nom: "Aile", largeurM: 10, profondeurM: 8, niveaux: 2, niveauDepart: 0, retraitM: 0, x: 0, y: 0 }] }],
    regles: envoye.regles.map((r) => (r.id === "recul-voirie" ? { ...r, valeur: 7 } : r)),
    programme: { ...envoye.programme, logementsVises: 20 },
  }, "mimmoza-studio", "2026-10-14T10:00:00.000Z", envoye);
  const c = classerChangements(comparerProjets(envoye, retour));
  assert.deepEqual(c.appliques.map((x) => x.type).sort(), ["renommage", "rotation"]);
  assert.deepEqual(c.aConfirmer.map((x) => x.type), ["regle"]);
  assert.deepEqual(c.conserves.map((x) => x.type).sort(), ["ailes", "programme"]);
  // Après « Appliquer », les règles restent celles de Mimmoza dans la base, et l'état local coïncide avec la base.
  const app = appliquerRetourAuPlan(plan, retour, envoye, {}, PR, nouvelId);
  const local = lire({ ...entree(app.buildings, envoye, app.refsFront), logementsVises: null });
  const base = baseApresAcceptation(retour, local);
  assert.equal(base.regles.find((r) => r.id === "recul-voirie")!.valeur, 5);
  const apres = lire({ ...entree(app.buildings, base, app.refsFront), logementsVises: null });
  assert.deepEqual(comparerProjets(base, apres), []);
});

test("R2 (A6/A7) révision ancienne, rejeu et retour sans différence : ignorés, pas de fenêtre", () => {
  const t = "2026-10-14T09:00:00.000Z";
  const plan = [batiment("A", "A", -10, 5, 24, 12)];
  const envoye = lire(entree(plan));
  const e = enregistrerEnvoi(nouvelEchange("etude-42", () => "q", t), envoye, t);
  const a = envoye.batiments[0]!;
  const r5 = { ...nouvelleRevision({ ...envoye, batiments: [{ ...a, niveaux: 6 }] }, "mimmoza-studio", t, envoye), revision: envoye.revision + 5 };
  const r4 = { ...r5, revision: envoye.revision + 4, batiments: [{ ...a, niveaux: 5 }] };
  const a5 = recevoirRetour(e, r5, envoye, t);
  assert.ok(!("erreur" in a5));
  if ("erreur" in a5) return;
  assert.equal(a5.aucuneDifference, false);
  assert.ok("erreur" in recevoirRetour(a5.echange, r4, envoye, t), "révision plus ancienne refusée");
  assert.ok("erreur" in recevoirRetour(a5.echange, r5, envoye, t), "rejeu refusé");
  assert.ok("erreur" in recevoirRetour(e, { ...r5, origine: "mimmoza-front" }, envoye, t), "retour qui ne vient pas de Studio refusé");
  const acc = accepterRetour(a5.echange, a5.retour, {}, t, a5.retour);
  assert.ok("erreur" in recevoirRetour(acc, r5, null, t), "retour déjà appliqué puis rejoué : refusé");
  assert.equal(parentPourEnvoi(acc), empreinteProjet(r5), "le prochain envoi repart du retour accepté");
  // Retour identique à la base : aucune différence, rien en attente.
  const inchange = nouvelleRevision(envoye, "mimmoza-studio", t, envoye);
  const ai = recevoirRetour(e, inchange, envoye, t);
  assert.ok(!("erreur" in ai) && ai.aucuneDifference && ai.echange.enAttente === null);
});
