// src/pages/visite/manifeste.test.ts
// Visite 360° : lecture du manifeste v1, adresses, conventions d'orientation, démo publique.
// Lancement : npm test (node --test).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ID_DEMO, MENTION_OBLIGATOIRE, URL_SUPABASE_DEFAUT, capDepuisDirection, colonneImage, directionVue, dossierVisite,
  ecartCap, fichierValide, grouperPieces, identifiantValide, imagePlan, largeurTexture, lireManifeste, messageHttp,
  positionSurPlan, urlFichier,
} from "./manifeste.ts";

const ICI = dirname(fileURLToPath(import.meta.url));
const DEMO = resolve(ICI, "..", "..", "..", "public", "visite-demo");
const UUID = "0b6f3c2e-5d1a-4c9e-8f00-123456789abc";

function exemple(): Record<string, unknown> {
  return {
    version: 1, titre: "Logement T3 — 2 rue des Tilleuls", depart: "arrivee",
    panoramas: [
      { id: "arrivee", titre: "Depuis la rue", image: "pano-arrivee.jpg", apercu: "pano-arrivee-apercu.jpg", largeur: 8192, hauteur: 4096,
        cap_initial_deg: 2.6, niveau: 0, position_m: [44.5, -4.75, 1.6], lieu: "exterieur",
        liens: [{ vers: "sejour", cap_deg: 0, inclinaison_deg: -3.1, libelle: "Séjour" }] },
      { id: "sejour", titre: "Séjour", image: "pano-sejour.jpg", largeur: 8192, hauteur: 4096, cap_initial_deg: 55, niveau: 0,
        position_m: [43.3, 43.1, 1.67], lieu: "interieur",
        liens: [{ vers: "arrivee", cap_deg: 131.2, inclinaison_deg: -8, libelle: "Depuis la rue" }] },
    ],
    plan: { image: "plan-niveau-0.png", niveaux: [0], emprise_m: [31, -6.75, 62, 62] },
    mentions: [MENTION_OBLIGATOIRE],
    elements_omis: [{ categorie: "voitures", raison: "aucun asset photoréaliste installé" }],
  };
}

describe("identifiants et adresses", () => {
  it("accepte un UUID ou « demo », refuse le reste", () => {
    assert.equal(identifiantValide(UUID), true);
    assert.equal(identifiantValide(ID_DEMO), true);
    for (const v of ["", undefined, null, "../secret", "abc", `${UUID}/x`]) assert.equal(identifiantValide(v as string), false);
  });

  it("construit l'adresse publique du bucket visites", () => {
    assert.equal(
      dossierVisite(UUID, URL_SUPABASE_DEFAUT),
      `https://fwvrqngbafqdaekbdfnm.supabase.co/storage/v1/object/public/visites/${UUID}/`,
    );
    assert.equal(dossierVisite(UUID, "https://x.supabase.co/"), `https://x.supabase.co/storage/v1/object/public/visites/${UUID}/`);
    assert.equal(dossierVisite(ID_DEMO, URL_SUPABASE_DEFAUT, "/"), "/visite-demo/");
    assert.equal(dossierVisite(ID_DEMO, URL_SUPABASE_DEFAUT, "/app"), "/app/visite-demo/");
  });

  it("ne charge jamais un fichier hors du dossier de la visite", () => {
    assert.equal(fichierValide("pano-sejour.jpg"), true);
    for (const v of ["../x.jpg", "https://evil/x.jpg", "/x.jpg", "a/b.jpg", "", 3]) assert.equal(fichierValide(v), false);
    assert.throws(() => urlFichier("/visite-demo/", "../manifest.json"));
    assert.equal(urlFichier("/visite-demo/", "manifest.json"), "/visite-demo/manifest.json");
  });

  it("messages d'erreur clairs", () => {
    assert.match(messageHttp(404), /n'existe pas/);
    assert.match(messageHttp(400), /n'existe pas/);
    assert.match(messageHttp(403), /pas publique/);
    assert.match(messageHttp(503), /503/);
  });
});

describe("lecture du manifeste v1", () => {
  it("lit un manifeste conforme", () => {
    const r = lireManifeste(exemple());
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.manifeste.depart, "arrivee");
    assert.equal(r.manifeste.panoramas.length, 2);
    assert.equal(r.manifeste.panoramas[0].apercu, "pano-arrivee-apercu.jpg");
    assert.deepEqual(r.manifeste.plan?.emprise_m, [31, -6.75, 62, 62]);
    assert.deepEqual(r.manifeste.elements_omis, [{ categorie: "voitures", raison: "aucun asset photoréaliste installé" }]);
    assert.deepEqual(r.avertissements, []);
  });

  it("refuse ce qui empêche la visite", () => {
    assert.equal(lireManifeste(null).ok, false);
    assert.equal(lireManifeste({ ...exemple(), version: 2 }).ok, false);
    assert.equal(lireManifeste({ ...exemple(), panoramas: [] }).ok, false);
    const doublon = exemple();
    (doublon.panoramas as unknown[]).push((doublon.panoramas as unknown[])[0]);
    assert.equal(lireManifeste(doublon).ok, false);
  });

  it("répare sans cacher : liens morts retirés, départ absent, mention ajoutée", () => {
    const m = exemple();
    (m.panoramas as Array<{ liens: unknown[] }>)[0].liens.push({ vers: "fantome", cap_deg: 10, inclinaison_deg: 0, libelle: "?" });
    m.depart = "inconnu";
    m.mentions = [];
    const r = lireManifeste(m);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.manifeste.depart, "arrivee");
    assert.deepEqual(r.manifeste.panoramas[0].liens.map((l) => l.vers), ["sejour"]);
    assert.equal(r.manifeste.mentions[0], MENTION_OBLIGATOIRE);
    assert.equal(r.avertissements.length, 2);
  });

  it("écarte une image au nom suspect", () => {
    const m = exemple();
    (m.panoramas as Array<Record<string, unknown>>)[1].image = "../../autre/pano.jpg";
    const r = lireManifeste(m);
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.manifeste.panoramas.map((p) => p.id), ["arrivee"]);
  });

  it("plan : PNG accepté, SVG écarté (bucket public, contenu actif)", () => {
    const r = lireManifeste(exemple());
    assert.equal(r.ok && r.manifeste.plan?.image, "plan-niveau-0.png");
    const m = exemple();
    m.plan = { image: "plan-niveau-0.svg", niveaux: [0] };
    const r2 = lireManifeste(m);
    assert.equal(r2.ok, true);
    if (!r2.ok) return;
    assert.equal(r2.manifeste.plan, undefined);
    assert.deepEqual(r2.avertissements, ["plan ignoré (image PNG ou JPEG attendue)"]);
    const m3 = exemple();
    m3.plan = { image: "plan-niveau-0.png", niveaux: [0, 1], images: { "1": "plan-niveau-1.svg" } };
    const r3 = lireManifeste(m3);
    assert.equal(r3.ok && r3.manifeste.plan?.images, undefined);
  });

  it("normalise caps et inclinaisons", () => {
    const m = exemple();
    (m.panoramas as Array<{ liens: Array<Record<string, unknown>> }>)[0].liens[0] = { vers: "sejour", cap_deg: -90, inclinaison_deg: -120 };
    const r = lireManifeste(m);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const l = r.manifeste.panoramas[0].liens[0];
    assert.equal(l.cap_deg, 270);
    assert.equal(l.inclinaison_deg, -90);
    assert.equal(l.libelle, "sejour");
  });
});

describe("orientation (même convention que le studio)", () => {
  it("cap 0 = nord = −Z, cap 90 = est = +X", () => {
    const n = directionVue(0, 0);
    const e = directionVue(90, 0);
    assert.ok(Math.abs(n[2] + 1) < 1e-12 && Math.abs(n[0]) < 1e-12);
    assert.ok(Math.abs(e[0] - 1) < 1e-12 && Math.abs(e[2]) < 1e-12);
    assert.ok(Math.abs(directionVue(0, 90)[1] - 1) < 1e-12);
  });

  it("aller-retour cap ↔ direction", () => {
    for (const [c, i] of [[0, 0], [75, -10], [200, 35], [359, -80]]) {
      const r = capDepuisDirection(directionVue(c, i));
      assert.ok(Math.abs(ecartCap(r.cap, c)) < 1e-9, `${c}`);
      assert.ok(Math.abs(r.inclinaison - i) < 1e-9);
    }
  });

  it("centre de l'image = nord, est aux trois quarts", () => {
    assert.equal(colonneImage(0), 0.5);
    assert.equal(colonneImage(90), 0.75);
    assert.equal(colonneImage(-90), 0.25);
    assert.equal(colonneImage(180), 0);
  });

  it("écart de cap signé", () => {
    assert.equal(ecartCap(350, 10), 20);
    assert.equal(ecartCap(10, 350), -20);
  });
});

describe("plan, pièces, textures", () => {
  it("place un point du plan (nord en haut)", () => {
    const p = positionSurPlan([5, 0, 1.6], [0, 0, 10, 20]);
    assert.deepEqual(p, { x: 0.5, y: 1 });
    assert.deepEqual(positionSurPlan([0, 20, 0], [0, 0, 10, 20]), { x: 0, y: 0 });
  });

  it("choisit le plan du niveau", () => {
    assert.equal(imagePlan({ image: "a.svg", niveaux: [0, 1], images: { "1": "b.svg" } }, 1), "b.svg");
    assert.equal(imagePlan({ image: "a.svg", niveaux: [0] }, 3), "a.svg");
  });

  it("regroupe extérieur puis intérieur", () => {
    const r = lireManifeste(exemple());
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(grouperPieces(r.manifeste.panoramas).map((g) => g.titre), ["Extérieur", "Intérieur"]);
  });

  it("borne la texture au GPU et au téléphone", () => {
    assert.equal(largeurTexture(8192, 16384, false), 8192);
    assert.equal(largeurTexture(8192, 16384, true), 4096);
    assert.equal(largeurTexture(8192, 4096, false), 4096);
    assert.equal(largeurTexture(6144, 0, false), 4096);
  });
});

describe("visite de démonstration (public/visite-demo)", () => {
  it("manifeste conforme et fichiers présents", () => {
    const brut = JSON.parse(readFileSync(join(DEMO, "manifest.json"), "utf8"));
    const r = lireManifeste(brut);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.avertissements, []);
    assert.ok(r.manifeste.panoramas.length >= 2);
    for (const p of r.manifeste.panoramas) {
      assert.ok(existsSync(join(DEMO, p.image)), p.image);
      if (p.apercu) assert.ok(existsSync(join(DEMO, p.apercu)), p.apercu);
      assert.ok(p.liens.length >= 1);
    }
    assert.ok(r.manifeste.plan && existsSync(join(DEMO, r.manifeste.plan.image)));
    assert.match(r.manifeste.plan.image, /\.png$/);
    assert.equal(r.manifeste.mentions[0], MENTION_OBLIGATOIRE);
  });
});
