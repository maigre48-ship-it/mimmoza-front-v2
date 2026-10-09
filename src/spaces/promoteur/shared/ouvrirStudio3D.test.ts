import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adresseAvecTransfert, adresseStudio3D, chargerReliefMesure, ErreurStudio3D, estHoteLocal, multiPolygonParcelles,
  ouvrirOngletStudio3D, parcellesSansGeometrie, resoudreUrlStudio3D, STUDIO_3D_URL_LOCALE, terrainCompact,
  type InvoquerFonction,
} from "./ouvrirStudio3D";

const carre = (x: number, y: number, c = 0.001): [number, number][] => [[x, y], [x + c, y], [x + c, y + c], [x, y + c], [x, y]];
const trou = carre(1.0003, 43.0003, 0.0002);
const parcelleA = { id: "64065000AI0001", feature: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [carre(1, 43), trou] } } };
const parcelleB = { id: "64065000AI0002", feature: { type: "MultiPolygon", coordinates: [[carre(1.001, 43)], [carre(1.003, 43)]] } };
const sansGeom = { id: "64065000AI0003" };

const terrainData = {
  provider: "IGN_ALTI", parcel_id: null, commune_insee: "64065",
  parcelBounds: [1, 43, 1.004, 43.001], renderBounds: [0.9996, 42.9997, 1.0044, 43.0013],
  grid: { n: 2, z: [[12.3456, 12.5], [13.001, 13.999]] },
  altitudeMin: 12.3456, altitudeMax: 13.999, penteMoyenne: 4.567,
  parcelGeojson: { type: "Feature" },
};

function decoder(url: string): any {
  const b64 = url.split("#parcelles=")[1].replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
}

describe("CAD04 — MultiPolygon de la sélection", () => {
  it("réunit toutes les parcelles, trous conservés", () => {
    const f = multiPolygonParcelles([parcelleA, parcelleB]);
    expect(f.type).toBe("Feature");
    expect(f.geometry.type).toBe("MultiPolygon");
    expect(f.geometry.coordinates).toHaveLength(3);
    expect(f.geometry.coordinates[0]).toHaveLength(2);
    expect(f.geometry.coordinates[0][1]).toEqual(trou);
    expect(f.properties.parcel_ids).toEqual(["64065000AI0001", "64065000AI0002"]);
  });
  it("refuse explicitement une parcelle sans géométrie (aucun filtrage silencieux)", () => {
    expect(parcellesSansGeometrie([parcelleA, sansGeom, { id: "X", feature: { type: "Point", coordinates: [1, 43] } }])).toEqual(["64065000AI0003", "X"]);
    expect(() => multiPolygonParcelles([parcelleA, sansGeom])).toThrow(ErreurStudio3D);
    expect(() => multiPolygonParcelles([parcelleA, sansGeom])).toThrow(/64065000AI0003/);
    expect(() => adresseStudio3D([parcelleA, sansGeom])).toThrow(/64065000AI0003/);
  });
});

describe("CAD04 — terrainData compact", () => {
  it("garde les seuls champs utiles, altitudes au centimètre, sans parcelGeojson", () => {
    const t = terrainCompact({ success: true, terrainData });
    expect(Object.keys(t).sort()).toEqual(["altitudeMax", "altitudeMin", "grid", "parcelBounds", "penteMoyenne", "provider", "renderBounds"]);
    expect(t.grid).toEqual({ n: 2, z: [[12.35, 12.5], [13, 14]] });
    expect(t.altitudeMin).toBe(12.35);
    expect(t.penteMoyenne).toBe(4.57);
    expect(t.renderBounds).toEqual(terrainData.renderBounds);
  });
  it("signale une réponse en échec ou incomplète", () => {
    expect(() => terrainCompact({ success: false, error: "IGN hors service" })).toThrow(/IGN hors service/);
    expect(() => terrainCompact({ success: true })).toThrow(ErreurStudio3D);
    expect(() => terrainCompact({ success: true, terrainData: { ...terrainData, grid: { n: 3, z: [[1]] } } })).toThrow(/incomplète/);
  });
});

describe("CAD04 — appel terrain-analysis-v1 (sans réseau)", () => {
  it("envoie le MultiPolygon et les réglages attendus", async () => {
    const appels: { nom: string; body: Record<string, unknown> }[] = [];
    const invoquer: InvoquerFonction = async (nom, body) => { appels.push({ nom, body }); return { data: { success: true, terrainData }, error: null }; };
    const t = await chargerReliefMesure([parcelleA, parcelleB], "64065", invoquer);
    expect(appels).toHaveLength(1);
    expect(appels[0].nom).toBe("terrain-analysis-v1");
    expect(appels[0].body.grid_size).toBe(50);
    expect(appels[0].body.padding_meters).toBe(30);
    expect(appels[0].body.commune_insee).toBe("64065");
    expect((appels[0].body.parcel_geojson as any).geometry.coordinates).toHaveLength(3);
    expect(t.provider).toBe("IGN_ALTI");
  });
  it("n'appelle pas le service si une géométrie manque, et relaie l'erreur du service", async () => {
    let appele = false;
    const espion: InvoquerFonction = async () => { appele = true; return { data: null, error: null }; };
    await expect(chargerReliefMesure([sansGeom], "64065", espion)).rejects.toThrow(ErreurStudio3D);
    expect(appele).toBe(false);
    const enEchec: InvoquerFonction = async () => ({ data: null, error: new Error("Edge Function returned a non-2xx status code") });
    await expect(chargerReliefMesure([parcelleA], "64065", enEchec)).rejects.toThrow(/non-2xx/);
  });
});

describe("CAD04 — charge #parcelles", () => {
  it("inclut terrainData compact et les parcelles, sans parcelGeojson", () => {
    const url = adresseStudio3D([parcelleA], "64065", "1 rue X", { lat: 43, lon: 1 }, [], {}, terrainCompact({ success: true, terrainData }));
    const charge = decoder(url as string);
    expect(charge.parcels).toHaveLength(1);
    expect(charge.terrainData.grid.n).toBe(2);
    expect(JSON.stringify(charge)).not.toContain("parcelGeojson");
  });
  it("conserve le mode sans parcelle (brief, plans, photos du copilote)", () => {
    const charge = decoder(adresseStudio3D([], null, null, null, [], { brief: "R+5 toiture zinc", plans: [{ url: "https://x/p.pdf", nom: "p.pdf" }] }) as string);
    expect(charge.parcels).toEqual([]);
    expect(charge.brief).toBe("R+5 toiture zinc");
    expect(charge.terrainData).toBeUndefined();
    expect(adresseStudio3D([], null)).toBeNull();
  });
});

describe("PUB-A — résolution de l'adresse du studio", () => {
  it("reconnaît les hôtes de poste local", () => {
    for (const h of ["localhost", "LOCALHOST", "studio.localhost", "127.0.0.1", "127.1.2.3", "::1", "[::1]", "0.0.0.0"]) expect(estHoteLocal(h)).toBe(true);
    for (const h of ["mimmoza.fr", "app.mimmoza.fr", "localhost.mimmoza.fr", "128.0.0.1", "10.0.0.5"]) expect(estHoteLocal(h)).toBe(false);
  });
  it("en local, garde le serveur Vite par défaut ou l'adresse configurée", () => {
    expect(resoudreUrlStudio3D(undefined, "localhost")).toBe(STUDIO_3D_URL_LOCALE);
    expect(resoudreUrlStudio3D("  ", "127.0.0.1")).toBe(STUDIO_3D_URL_LOCALE);
    expect(resoudreUrlStudio3D(undefined, null)).toBe(STUDIO_3D_URL_LOCALE);
    expect(resoudreUrlStudio3D("http://localhost:5174", "localhost")).toBe("http://localhost:5174/");
    expect(() => resoudreUrlStudio3D("pas une url", "localhost")).toThrow(ErreurStudio3D);
  });
  it("sur un domaine public, refuse une adresse absente, invalide, locale ou non https", () => {
    expect(() => resoudreUrlStudio3D(undefined, "app.mimmoza.fr")).toThrow(/aucune adresse de studio/);
    expect(() => resoudreUrlStudio3D("", "app.mimmoza.fr")).toThrow(ErreurStudio3D);
    expect(() => resoudreUrlStudio3D("studio.mimmoza.fr", "app.mimmoza.fr")).toThrow(/invalide/);
    expect(() => resoudreUrlStudio3D("ftp://studio.mimmoza.fr", "app.mimmoza.fr")).toThrow(/invalide/);
    expect(() => resoudreUrlStudio3D("http://localhost:5173", "app.mimmoza.fr")).toThrow(/poste local/);
    expect(() => resoudreUrlStudio3D("https://127.0.0.1:5173", "app.mimmoza.fr")).toThrow(/poste local/);
    expect(() => resoudreUrlStudio3D("http://studio.mimmoza.fr", "app.mimmoza.fr")).toThrow(/https/);
  });
  it("accepte une adresse https publique et conserve l'ancre de transfert", () => {
    const base = resoudreUrlStudio3D("https://studio.mimmoza.fr/app#ancien", "app.mimmoza.fr");
    expect(base).toBe("https://studio.mimmoza.fr/app");
    const url = adresseAvecTransfert(base, "parcelles=eyJhIjoxfQ-_");
    expect(url).toBe("https://studio.mimmoza.fr/app/#parcelles=eyJhIjoxfQ-_");
    expect(decoder(adresseAvecTransfert("https://studio.mimmoza.fr", "parcelles=eyJhIjoxfQ"))).toEqual({ a: 1 });
    expect(adresseAvecTransfert(STUDIO_3D_URL_LOCALE, "parcelles=x")).toBe("http://localhost:5173/#parcelles=x");
  });
});

describe("PUB-A — garde avant onglet, relief et signatures", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sur un domaine public mal configuré : erreur claire, aucun onglet, aucune préparation", async () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open, location: { href: "", hostname: "app.mimmoza.fr" } });
    const preparer = vi.fn(async () => "https://studio.mimmoza.fr/#parcelles=x");
    const verifier = () => resoudreUrlStudio3D(undefined, "app.mimmoza.fr");
    await expect(ouvrirOngletStudio3D(preparer, verifier, () => "app.mimmoza.fr")).rejects.toThrow(ErreurStudio3D);
    expect(open).not.toHaveBeenCalled();
    expect(preparer).not.toHaveBeenCalled();
  });

  it("sur un domaine public, referme l'onglet plutôt que de le diriger vers localhost", async () => {
    const onglet = { opener: {}, location: { href: "about:blank" }, close: vi.fn() };
    vi.stubGlobal("window", { open: vi.fn(() => onglet), location: { href: "", hostname: "app.mimmoza.fr" } });
    await expect(ouvrirOngletStudio3D(async () => "http://localhost:5173/#parcelles=x", () => "https://studio.mimmoza.fr/", () => "app.mimmoza.fr"))
      .rejects.toThrow(/poste local/);
    expect(onglet.close).toHaveBeenCalled();
    expect(onglet.location.href).toBe("about:blank");
  });

  it("dirige l'onglet vers le studio public, ancre comprise ; en local, localhost reste permis", async () => {
    const onglet = { opener: {} as unknown, location: { href: "about:blank" }, close: vi.fn() };
    vi.stubGlobal("window", { open: vi.fn(() => onglet), location: { href: "", hostname: "app.mimmoza.fr" } });
    await ouvrirOngletStudio3D(async () => "https://studio.mimmoza.fr/#parcelles=x", () => "https://studio.mimmoza.fr/", () => "app.mimmoza.fr");
    expect(onglet.location.href).toBe("https://studio.mimmoza.fr/#parcelles=x");
    expect(onglet.opener).toBeNull();
    await ouvrirOngletStudio3D(async () => "http://localhost:5173/#parcelles=y", () => STUDIO_3D_URL_LOCALE, () => "localhost");
    expect(onglet.location.href).toBe("http://localhost:5173/#parcelles=y");
  });
});
