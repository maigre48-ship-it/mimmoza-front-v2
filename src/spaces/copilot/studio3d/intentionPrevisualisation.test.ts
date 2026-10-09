import { describe, expect, it } from "vitest";
import { demandePrevisualisation } from "./intentionPrevisualisation";

describe("CH2 — « génère la prévisualisation » ouvre la préparation 3D", () => {
  it("reconnaît la demande", () => {
    expect(demandePrevisualisation("Génère la prévisualisation")).toBe(true);
    expect(demandePrevisualisation("peux-tu me faire une maquette 3D de ce terrain ?")).toBe(true);
    expect(demandePrevisualisation("Lance le Studio 3D avec ces photos")).toBe(true);
  });
  it("laisse partir les autres questions vers le modèle", () => {
    expect(demandePrevisualisation("Quel est le prix au m² à Bayonne ?")).toBe(false);
    expect(demandePrevisualisation("Qu'est-ce qu'une prévisualisation ?")).toBe(false);
    expect(demandePrevisualisation("Analyse cette parcelle")).toBe(false);
  });
});

describe("CH3 — « ouvrir studio » dans le tchat ouvre la préparation 3D", () => {
  it("reconnaît les demandes d'ouverture du Studio", () => {
    expect(demandePrevisualisation("tu peux ouvrir studio ?")).toBe(true);
    expect(demandePrevisualisation("ouvre studio")).toBe(true);
    expect(demandePrevisualisation("Ouvre le studio")).toBe(true);
    expect(demandePrevisualisation("peux-tu lancer MimmozIA Studio ?")).toBe(true);
    expect(demandePrevisualisation("ouvrir le Studio 3D")).toBe(true);
    expect(demandePrevisualisation("Démarre le Studio, s'il te plaît")).toBe(true);
  });
  it("laisse les questions explicatives et les analyses au modèle", () => {
    expect(demandePrevisualisation("qu'est-ce que Studio ?")).toBe(false);
    expect(demandePrevisualisation("Qu’est-ce que le Studio 3D ?")).toBe(false);
    expect(demandePrevisualisation("comment fonctionne Studio ?")).toBe(false);
    expect(demandePrevisualisation("Comment ouvrir le studio ?")).toBe(false);
    expect(demandePrevisualisation("Analyse ce studio de 25 m² à Bayonne")).toBe(false);
    expect(demandePrevisualisation("Je cherche un studio à louer, tu peux m'aider ?")).toBe(false);
  });
});

describe("CH4 — « Mimmoza Studio » (sans i) ouvre aussi la préparation 3D", () => {
  it("reconnaît la phrase exacte du site public et ses variantes", () => {
    expect(demandePrevisualisation("est ce que tu peux ouvrir mimmoza studio?")).toBe(true);
    expect(demandePrevisualisation("Est-ce que tu peux ouvrir Mimmoza Studio ?")).toBe(true);
    expect(demandePrevisualisation("ouvre Mimmoza Studio")).toBe(true);
    expect(demandePrevisualisation("ouvre MimmozIA Studio")).toBe(true);
    expect(demandePrevisualisation("ouvre studio")).toBe(true);
  });
  it("n'intercepte ni les questions explicatives ni les annonces", () => {
    expect(demandePrevisualisation("qu'est-ce que Mimmoza Studio ?")).toBe(false);
    expect(demandePrevisualisation("comment ouvrir Mimmoza Studio ?")).toBe(false);
    expect(demandePrevisualisation("studio à louer à Bayonne")).toBe(false);
    expect(demandePrevisualisation("Lance une recherche studio à louer")).toBe(false);
    expect(demandePrevisualisation("ouvre studio à louer près de la gare")).toBe(false);
    expect(demandePrevisualisation("affiche studio de 25 m² à vendre")).toBe(false);
  });
});
