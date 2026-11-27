// src/lib/visiteInteractive/metadonnees.test.ts
// VIS-69 — lecture de visite-interactive.json, repli, ambiance, plan, partage.
// Lancement : npx tsx --test src/lib/visiteInteractive/metadonnees.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lireManifeste, type ManifesteVisite } from "../../pages/visite/manifeste.ts";
import {
  FORMAT_INTERACTIF, aplatissementSol, cadreNiveau, cadreSvg, centroide, echelleSol, entreeDuPanorama, imagesPour,
  libelleNiveau, lienMailto, lienPublic, lireVisiteInteractive, nomCapture,
} from "./metadonnees.ts";

const UUID = "5ebfb9af-be00-4eb7-9ee7-ad2d5b474a5e";

function manifeste(): ManifesteVisite {
  const pano = (id: string, niveau: number, pos: [number, number, number], liens: unknown[] = []) => ({
    id, titre: id, image: `pano-${id}.jpg`, apercu: `pano-${id}-apercu.jpg`, largeur: 3072, hauteur: 1536,
    cap_initial_deg: 10, niveau, position_m: pos, liens,
  });
  const lu = lireManifeste({
    version: 1, titre: "T3", depart: "arrivee", mentions: [], elements_omis: [],
    panoramas: [
      pano("arrivee", 0, [0, 10, 1.6], [{ vers: "sejour", cap_deg: 120, inclinaison_deg: 10, libelle: "Séjour" }]),
      pano("sejour", 2, [16, -6, 7.6], [{ vers: "entree", cap_deg: 308.7, inclinaison_deg: -10.4, libelle: "Entrée" }]),
      pano("entree", 2, [12.4, -3, 7.6], [{ vers: "sejour", cap_deg: 130.7, inclinaison_deg: -21.9, libelle: "Séjour" }]),
    ],
  });
  assert.ok(lu.ok);
  return lu.manifeste;
}

function meta(): Record<string, unknown> {
  const p = (id: string, piece: string | null, niveau: number, pos: number[], hotspots: unknown[], nuit = true) => ({
    id, titre: id === "sejour" ? "Séjour" : id, piece, lieu: piece ? "interieur" : "exterieur", niveau, position_m: pos,
    hauteur_yeux_m: 1.6, cap_initial_deg: 10,
    images: { jour: { image: `pano-${id}.jpg`, apercu: `pano-${id}-apercu.jpg` }, ...(nuit ? { nuit: { image: `pano-${id}-nuit.jpg` } } : {}) },
    hotspots,
  });
  return {
    format: FORMAT_INTERACTIF, version: 1, visite_id: UUID, titre: "T3 R+4", depart: "arrivee", depart_conseille: "sejour",
    ambiances: ["jour", "nuit"],
    menu: [{ piece: "sej", titre: "Séjour", panoramas: ["sejour"] }, { piece: "ent", titre: "Entrée", panoramas: ["entree"] },
      { piece: null, titre: "Extérieurs", panoramas: ["arrivee", "inconnu"] }],
    pieces: [
      { id: "sej", titre: "Séjour", fonction: "sejour", niveau: 2, surface_m2: 33, polygone_m: [[13, -1.5], [17, -0.7], [18.5, -8.3], [14.4, -9]], panoramas: ["sejour"] },
      { id: "wc", titre: "WC", fonction: "wc", niveau: 2, surface_m2: 2, polygone_m: [[1, 1], [2, 1]], panoramas: [] },
    ],
    panoramas: [
      p("arrivee", null, 0, [0, 10, 1.6], [{ vers: "sejour", libelle: "Séjour", mode: "repere", cap_deg: 120, inclinaison_deg: 10, distance_m: 22 }], false),
      p("sejour", "sej", 2, [16, -6, 7.6], [{ vers: "entree", libelle: "Entrée", mode: "sol", cap_deg: 308.7, inclinaison_deg: -22.5, distance_m: 3.87 },
        { vers: "ailleurs", libelle: "?", mode: "sol", cap_deg: 1, inclinaison_deg: -10 }]),
      p("entree", "ent", 2, [12.4, -3, 7.6], [{ vers: "sejour", libelle: "Séjour", mode: "sol", cap_deg: 490.7, inclinaison_deg: -37.4, distance_m: 2.1 }]),
    ],
    plan: { emprise_batiment_m: [[15.7, 8.7], [-17.7, 2.6], [-14.6, -14.6], [18.9, -8.5]],
      niveaux: { "2": { cadre_m: [6.42, -11.06, 19.54, 0.25], pieces: ["sej", "wc"] }, "0": { cadre_m: [1, 1, 0, 0], pieces: [] } } },
  };
}

describe("lecture de visite-interactive.json", () => {
  it("lit un fichier conforme et écarte ce qui est invalide", () => {
    const lu = lireVisiteInteractive(meta(), manifeste());
    assert.ok(lu.ok);
    const v = lu.visite;
    assert.equal(v.departConseille, "sejour");
    assert.deepEqual(v.ambiances, ["jour", "nuit"]);
    assert.deepEqual(v.menu.map((m) => m.titre), ["Séjour", "Entrée", "Extérieurs"]);
    assert.deepEqual(v.menu[2].panoramas, ["arrivee"]); // panorama inconnu retiré du menu
    const sejour = v.panoramas.find((p) => p.id === "sejour")!;
    assert.equal(sejour.hotspots.length, 1); // hotspot vers un panorama inconnu écarté
    assert.equal(sejour.hotspots[0].mode, "sol");
    assert.equal(v.panoramas.find((p) => p.id === "entree")!.hotspots[0].cap_deg, 130.7); // cap ramené dans [0, 360)
    assert.deepEqual(v.pieces.map((p) => p.id), ["sej"]); // polygone à 2 sommets écarté
    assert.deepEqual(Object.keys(v.niveaux), ["2"]); // cadre dégénéré écarté
    assert.ok(v.mentions.includes("Images de synthèse non contractuelles"));
  });

  it("refuse (→ ancienne visionneuse) un format inconnu, une autre version ou des panoramas différents", () => {
    assert.equal(lireVisiteInteractive(null, manifeste()).ok, false);
    assert.equal(lireVisiteInteractive({ ...meta(), format: "autre" }, manifeste()).ok, false);
    assert.equal(lireVisiteInteractive({ ...meta(), version: 2 }, manifeste()).ok, false);
    const m = meta();
    (m["panoramas"] as unknown[]).pop();
    assert.equal(lireVisiteInteractive(m, manifeste()).ok, false);
  });

  it("refuse les noms de fichiers dangereux (jamais d'URL arbitraire)", () => {
    const m = meta();
    (m["panoramas"] as Record<string, unknown>[])[1]["images"] = { jour: { image: "https://pirate.example/x.jpg" } };
    assert.equal(lireVisiteInteractive(m, manifeste()).ok, false);
    const m2 = meta();
    (m2["panoramas"] as Record<string, unknown>[])[1]["images"] = { jour: { image: "pano-sejour.jpg" }, nuit: { image: "../x.jpg" } };
    const lu = lireVisiteInteractive(m2, manifeste());
    assert.ok(lu.ok);
    assert.equal(lu.visite.panoramas[1].images.nuit, undefined);
  });

  it("n'annonce la nuit que si au moins un panorama la porte", () => {
    const m = meta();
    for (const p of m["panoramas"] as Record<string, unknown>[]) p["images"] = { jour: (p["images"] as Record<string, unknown>)["jour"] };
    const lu = lireVisiteInteractive(m, manifeste());
    assert.ok(lu.ok);
    assert.deepEqual(lu.visite.ambiances, ["jour"]);
  });
});

describe("ambiance jour / nuit", () => {
  it("rend l'image de nuit, ou le jour quand la nuit manque pour ce panorama", () => {
    const lu = lireVisiteInteractive(meta(), manifeste());
    assert.ok(lu.ok);
    const [arrivee, sejour] = lu.visite.panoramas;
    assert.deepEqual(imagesPour(sejour, "nuit"), { images: { image: "pano-sejour-nuit.jpg" }, ambiance: "nuit" });
    assert.equal(imagesPour(arrivee, "nuit").ambiance, "jour");
    assert.equal(imagesPour(sejour, "jour").images.image, "pano-sejour.jpg");
  });
});

describe("pastilles au sol", () => {
  it("s'aplatissent près de l'horizon et rapetissent au loin, dans des bornes cliquables", () => {
    assert.ok(aplatissementSol(-60) > aplatissementSol(-15));
    assert.equal(aplatissementSol(-90), 1);
    assert.equal(aplatissementSol(-2), 0.32);
    assert.ok(echelleSol(1.5) > echelleSol(6));
    assert.equal(echelleSol(50), 0.55);
    assert.equal(echelleSol(0.1), 1.15);
  });
});

describe("plan", () => {
  it("projette nord en haut et garde les proportions", () => {
    const c = cadreSvg([0, 0, 20, 10], 400);
    assert.equal(c.largeur, 400);
    assert.equal(c.hauteur, 200);
    assert.deepEqual(c.vers(0, 10), [0, 0]); // coin nord-ouest en haut à gauche
    assert.deepEqual(c.vers(20, 0), [400, 200]);
  });
  it("centroïde d'un rectangle et cadre de repli", () => {
    assert.deepEqual(centroide([[0, 0], [4, 0], [4, 2], [0, 2]]), [2, 1]);
    const lu = lireVisiteInteractive(meta(), manifeste());
    assert.ok(lu.ok);
    assert.deepEqual(cadreNiveau(lu.visite, 2), [6.42, -11.06, 19.54, 0.25]);
    assert.deepEqual(cadreNiveau(lu.visite, 0), [-3, 7, 3, 13]); // pas de cadre studio : panoramas + 3 m
    assert.equal(entreeDuPanorama(lu.visite, "arrivee")?.titre, "Extérieurs");
    assert.equal(libelleNiveau(0), "Rez-de-chaussée");
    assert.equal(libelleNiveau(2), "2e étage");
  });
});

describe("partage", () => {
  it("lien public, mailto prérempli et nom de capture", () => {
    assert.equal(lienPublic("https://mimmoza.fr/", UUID, "sejour"), `https://mimmoza.fr/visite/${UUID}?p=sejour`);
    assert.equal(lienPublic("https://mimmoza.fr", UUID, "sejour", "nuit"), `https://mimmoza.fr/visite/${UUID}?p=sejour&ambiance=nuit`);
    const m = lienMailto("Résidence Les Platanes", "Séjour", `https://mimmoza.fr/visite/${UUID}?p=sejour`);
    assert.ok(m.startsWith("mailto:?subject=Visite%20360%C2%B0%20%E2%80%94%20R%C3%A9sidence"));
    const corps = decodeURIComponent(m.split("&body=")[1]);
    assert.ok(corps.includes(`https://mimmoza.fr/visite/${UUID}?p=sejour`));
    assert.ok(corps.includes("Images de synthèse non contractuelles"));
    assert.equal(nomCapture("VIS-63 — T3 Résidence", "Chambre parentale", "nuit"), "visite-vis-63-t3-residence-chambre-parentale-nuit.png");
  });
});
