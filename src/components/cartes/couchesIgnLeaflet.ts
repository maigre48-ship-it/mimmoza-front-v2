// src/components/cartes/couchesIgnLeaflet.ts
//
// Variante « Leaflet direct » (sans React) du contrôle de couches IGN et du
// surlignage de parcelle. Les composants react-leaflet CouchesIgnControle et
// SurlignageParcelles s'appuient sur ces deux fonctions : une seule
// implémentation, donc un seul comportement sur toutes les cartes.
//
//  - installerCouchesIgn(map, options)  : fonds Satellite / Plan, couche
//    Cadastre, contrôle (bascule, case, curseur d'opacité), mémorisation du
//    choix, repli automatique sur le Plan si les tuiles satellite échouent.
//  - creerSurlignageParcelles(map)      : contour violet épais au-dessus de
//    tout (pane dédié, non cliquable) + recadrage quand la cible change.
//
// Ordre des calques (z-index des panes Leaflet) :
//   150 mzFondIgn        fond Satellite ou Plan
//   190 mzCadastreIgn    tuiles cadastre IGN
//   200 tilePane         couches WMS thématiques (Géorisques…) — au-dessus
//   400 overlayPane      parcelles vectorielles cliquables existantes
//   450 mzSurlignage     surlignage violet (pointer-events: none)
//   600+ marqueurs, infobulles, popups

import L from "leaflet";
import type { Feature, FeatureCollection } from "geojson";
import { userStorage } from "@/lib/storage/userScopedStorage";
import {
  ATTRIBUTION_IGN,
  COUCHE_CADASTRE_IGN_URL,
  FOND_PLAN_URL,
  FOND_SATELLITE_IGN_URL,
  LIBELLES_FOND,
  OPACITE_CADASTRE_MAX,
  OPACITE_CADASTRE_MIN,
  OPACITE_CADASTRE_PAS,
  ZOOM_MAX_CARTE_IGN,
  ZOOM_MAX_RECADRAGE,
  ZOOM_NATIF_MAX_CADASTRE,
  ZOOM_NATIF_MAX_PLAN,
  ZOOM_NATIF_MAX_SATELLITE,
  type ContexteCarte,
  type FondCarte,
  type PreferencesCouches,
} from "@/lib/cartes/couchesIgn";
import {
  bornerOpacite,
  ecrirePreferences,
  enregistrerTuile,
  fondEffectif,
  lirePreferences,
  suiviInitial,
  type StockageCles,
  type SuiviTuiles,
} from "@/lib/cartes/preferencesCouches";
import { doitRecadrer, empriseFeatures, versBoundsLeaflet } from "@/lib/cartes/empriseParcelle";
import "./couchesIgn.css";

export const PANE_FOND_IGN = "mzFondIgn";
export const PANE_CADASTRE_IGN = "mzCadastreIgn";
export const PANE_SURLIGNAGE = "mzSurlignage";

export const COULEUR_SURLIGNAGE = "#6851e9";

function assurerPane(map: L.Map, nom: string, zIndex: number): HTMLElement {
  const existant = map.getPane(nom);
  if (existant) return existant;
  const pane = map.createPane(nom);
  pane.style.zIndex = String(zIndex);
  // Les tuiles et le surlignage ne doivent jamais capter clics ni survols.
  pane.style.pointerEvents = "none";
  return pane;
}

let compteurInstances = 0;

export type OptionsCouchesIgn = {
  /** « parcelle » (défaut : Satellite + Cadastre) ou « thematique » (Plan). */
  contexte?: ContexteCarte;
  /** Position du contrôle Leaflet (défaut : topleft, sous le zoom). */
  position?: L.ControlPosition;
  /** Stockage des préférences (défaut : userStorage, clés par utilisateur). */
  stockage?: StockageCles | null;
  /** Appelé à chaque tuile du fond Plan en échec (message « fond indisponible »). */
  onErreurFond?: () => void;
};

export type CouchesIgnInstallees = {
  preferences(): PreferencesCouches;
  fondAffiche(): FondCarte;
  detruire(): void;
};

/** Installe fonds IGN, cadastre et contrôle sur une carte Leaflet. */
export function installerCouchesIgn(map: L.Map, options: OptionsCouchesIgn = {}): CouchesIgnInstallees {
  const contexte: ContexteCarte = options.contexte ?? "parcelle";
  const stockage = options.stockage === undefined ? userStorage : options.stockage;
  const uid = `mz-couches-${++compteurInstances}`;

  let prefs = lirePreferences(stockage, contexte);
  let suiviSatellite: SuiviTuiles = suiviInitial();
  let suiviPlan: SuiviTuiles = suiviInitial();
  let suiviCadastre: SuiviTuiles = suiviInitial();
  let detruit = false;

  assurerPane(map, PANE_FOND_IGN, 150);
  assurerPane(map, PANE_CADASTRE_IGN, 190);

  const plan = L.tileLayer(FOND_PLAN_URL, {
    pane: PANE_FOND_IGN,
    attribution: ATTRIBUTION_IGN,
    maxZoom: ZOOM_MAX_CARTE_IGN,
    maxNativeZoom: ZOOM_NATIF_MAX_PLAN,
  });
  const satellite = L.tileLayer(FOND_SATELLITE_IGN_URL, {
    pane: PANE_FOND_IGN,
    attribution: ATTRIBUTION_IGN,
    maxZoom: ZOOM_MAX_CARTE_IGN,
    maxNativeZoom: ZOOM_NATIF_MAX_SATELLITE,
  });
  const cadastre = L.tileLayer(COUCHE_CADASTRE_IGN_URL, {
    pane: PANE_CADASTRE_IGN,
    attribution: ATTRIBUTION_IGN,
    maxZoom: ZOOM_MAX_CARTE_IGN,
    maxNativeZoom: ZOOM_NATIF_MAX_CADASTRE,
    opacity: prefs.opaciteCadastre,
  });

  // ── Contrôle (DOM) ────────────────────────────────────────────────────────
  const racine = L.DomUtil.create("div", "mz-couches");
  racine.setAttribute("role", "group");
  racine.setAttribute("aria-label", "Couches de la carte");
  racine.innerHTML = `
    <button type="button" class="mz-couches__bouton" aria-expanded="false" aria-controls="${uid}-panneau">
      <svg class="mz-couches__icone" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M12 3 2 8l10 5 10-5-10-5Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="m2 13 10 5 10-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
      <span class="mz-couches__resume"></span>
      <svg class="mz-couches__chevron" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <div class="mz-couches__panneau" id="${uid}-panneau" hidden>
      <fieldset class="mz-couches__segment">
        <legend class="mz-couches__invisible">Fond de carte</legend>
        <label class="mz-couches__option"><input type="radio" name="${uid}-fond" value="satellite"><span>Satellite</span></label>
        <label class="mz-couches__option"><input type="radio" name="${uid}-fond" value="plan"><span>Plan</span></label>
      </fieldset>
      <label class="mz-couches__case"><input type="checkbox" class="mz-couches__cadastre"> Cadastre</label>
      <label class="mz-couches__curseur">
        <span>Opacité</span>
        <input type="range" class="mz-couches__opacite" min="${OPACITE_CADASTRE_MIN}" max="${OPACITE_CADASTRE_MAX}" step="${OPACITE_CADASTRE_PAS}">
        <output class="mz-couches__valeur" aria-hidden="true"></output>
      </label>
    </div>
    <p class="mz-couches__mention" title="Le tracé cadastral peut être décalé de quelques mètres par rapport à la photo aérienne." hidden>Tracé cadastral indicatif</p>
    <p class="mz-couches__alerte" role="status" aria-live="polite" hidden></p>`;

  const bouton = racine.querySelector<HTMLButtonElement>(".mz-couches__bouton")!;
  const resume = racine.querySelector<HTMLSpanElement>(".mz-couches__resume")!;
  const panneau = racine.querySelector<HTMLDivElement>(".mz-couches__panneau")!;
  const radios = Array.from(racine.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
  const caseCadastre = racine.querySelector<HTMLInputElement>(".mz-couches__cadastre")!;
  const curseur = racine.querySelector<HTMLInputElement>(".mz-couches__opacite")!;
  const zoneCurseur = racine.querySelector<HTMLLabelElement>(".mz-couches__curseur")!;
  const valeur = racine.querySelector<HTMLOutputElement>(".mz-couches__valeur")!;
  const mention = racine.querySelector<HTMLParagraphElement>(".mz-couches__mention")!;
  const alerte = racine.querySelector<HTMLParagraphElement>(".mz-couches__alerte")!;

  // Le contrôle ne doit ni déplacer ni zoomer la carte.
  L.DomEvent.disableClickPropagation(racine);
  L.DomEvent.disableScrollPropagation(racine);

  const ouvrir = (ouvert: boolean) => {
    panneau.hidden = !ouvert;
    bouton.setAttribute("aria-expanded", String(ouvert));
    racine.classList.toggle("mz-couches--ouvert", ouvert);
  };
  // Ouvert d'emblée sur une carte large, replié sur mobile.
  ouvrir(map.getContainer().clientWidth >= 520);

  const fondVisible = (): FondCarte => fondEffectif(prefs.fond, suiviSatellite.enPanne);

  function messageAlerte(): string {
    if (prefs.fond === "satellite" && suiviSatellite.enPanne) {
      return "Vue satellite indisponible : plan affiché.";
    }
    if (fondVisible() === "plan" && suiviPlan.enPanne) return "Fond de carte IGN partiellement indisponible.";
    if (prefs.cadastre && suiviCadastre.enPanne) return "Cadastre IGN momentanément indisponible.";
    return "";
  }

  function appliquer() {
    if (detruit) return;
    const fond = fondVisible();
    const visible = fond === "satellite" ? satellite : plan;
    const cachee = fond === "satellite" ? plan : satellite;
    if (map.hasLayer(cachee)) map.removeLayer(cachee);
    if (!map.hasLayer(visible)) visible.addTo(map);

    if (prefs.cadastre) {
      cadastre.setOpacity(prefs.opaciteCadastre);
      if (!map.hasLayer(cadastre)) cadastre.addTo(map);
    } else if (map.hasLayer(cadastre)) {
      map.removeLayer(cadastre);
    }

    radios.forEach((r) => { r.checked = r.value === fond; });
    caseCadastre.checked = prefs.cadastre;
    curseur.value = String(prefs.opaciteCadastre);
    curseur.disabled = !prefs.cadastre;
    const pourcent = `${Math.round(prefs.opaciteCadastre * 100)} %`;
    curseur.setAttribute("aria-valuetext", pourcent);
    curseur.setAttribute("aria-label", "Opacité du cadastre");
    valeur.textContent = pourcent;
    zoneCurseur.toggleAttribute("data-inactif", !prefs.cadastre);
    resume.textContent = `${LIBELLES_FOND[fond]}${prefs.cadastre ? " + cadastre" : ""}`;
    bouton.setAttribute("aria-label", `Couches de la carte : ${resume.textContent}. ${panneau.hidden ? "Afficher" : "Masquer"} les réglages`);
    mention.hidden = !prefs.cadastre;
    const message = messageAlerte();
    alerte.hidden = message === "";
    alerte.textContent = message;
  }

  function changer(partiel: Partial<PreferencesCouches>) {
    prefs = { ...prefs, ...partiel };
    ecrirePreferences(stockage, contexte, prefs);
    appliquer();
  }

  // ── Événements du contrôle ────────────────────────────────────────────────
  bouton.addEventListener("click", () => { ouvrir(panneau.hidden); appliquer(); });
  racine.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panneau.hidden) {
      e.stopPropagation();
      ouvrir(false);
      appliquer();
      bouton.focus();
    }
  });
  radios.forEach((r) => r.addEventListener("change", () => {
    if (!r.checked) return;
    const fond = r.value === "plan" ? "plan" : "satellite";
    // Nouveau choix explicite du satellite : on retente (le réseau a pu revenir).
    if (fond === "satellite") suiviSatellite = suiviInitial();
    if (fond === "plan") suiviPlan = suiviInitial();
    changer({ fond });
  }));
  caseCadastre.addEventListener("change", () => {
    if (caseCadastre.checked) suiviCadastre = suiviInitial();
    changer({ cadastre: caseCadastre.checked });
  });
  curseur.addEventListener("input", () => {
    prefs = { ...prefs, opaciteCadastre: bornerOpacite(Number(curseur.value), prefs.opaciteCadastre) };
    appliquer();
  });
  curseur.addEventListener("change", () => changer({}));

  // ── Suivi des tuiles (repli) ──────────────────────────────────────────────
  const surSatellite = (ok: boolean) => () => {
    const avant = suiviSatellite.enPanne;
    suiviSatellite = enregistrerTuile(suiviSatellite, ok);
    if (!avant && suiviSatellite.enPanne) {
      console.warn("[couchesIgn] tuiles satellite IGN en échec : repli sur le plan");
      appliquer();
    }
  };
  const surPlan = (ok: boolean) => () => {
    if (!ok) options.onErreurFond?.();
    const avant = suiviPlan.enPanne;
    suiviPlan = enregistrerTuile(suiviPlan, ok);
    if (!avant && suiviPlan.enPanne) appliquer();
  };
  const surCadastre = (ok: boolean) => () => {
    const avant = suiviCadastre.enPanne;
    suiviCadastre = enregistrerTuile(suiviCadastre, ok);
    if (!avant && suiviCadastre.enPanne) appliquer();
  };
  const ecoutes: Array<[L.TileLayer, string, () => void]> = [
    [satellite, "tileload", surSatellite(true)],
    [satellite, "tileerror", surSatellite(false)],
    [plan, "tileload", surPlan(true)],
    [plan, "tileerror", surPlan(false)],
    [cadastre, "tileload", surCadastre(true)],
    [cadastre, "tileerror", surCadastre(false)],
  ];
  ecoutes.forEach(([couche, evt, fn]) => couche.on(evt, fn));

  // ── Ajout du contrôle ─────────────────────────────────────────────────────
  const controle = new L.Control({ position: options.position ?? "topleft" });
  controle.onAdd = () => racine;
  controle.addTo(map);
  appliquer();

  return {
    preferences: () => ({ ...prefs }),
    fondAffiche: fondVisible,
    detruire() {
      if (detruit) return;
      detruit = true;
      ecoutes.forEach(([couche, evt, fn]) => couche.off(evt, fn));
      try { controle.remove(); } catch { /* carte déjà détruite */ }
      for (const couche of [satellite, plan, cadastre]) {
        try { if (map.hasLayer(couche)) map.removeLayer(couche); } catch { /* carte déjà détruite */ }
      }
    },
  };
}

// ── Surlignage de la parcelle recherchée / sélectionnée ─────────────────────

export type Recadrage = {
  /** Identifiant de la parcelle cible : on recadre quand il change. */
  cle: string;
  /** Features dont l'emprise sert au recadrage. */
  features: ReadonlyArray<Feature>;
};

export type SurlignageParcelles = {
  maj(features: ReadonlyArray<Feature>, recadrage?: Recadrage | null): void;
  detruire(): void;
};

const STYLE_HALO: L.PathOptions = {
  color: "#ffffff",
  weight: 7,
  opacity: 0.85,
  fill: false,
  interactive: false,
  lineJoin: "round",
};
const STYLE_CONTOUR: L.PathOptions = {
  color: COULEUR_SURLIGNAGE,
  weight: 3.5,
  opacity: 1,
  fillColor: COULEUR_SURLIGNAGE,
  fillOpacity: 0.12,
  interactive: false,
  lineJoin: "round",
};

/** Crée le surlignage violet (au-dessus des tuiles et des parcelles cliquables). */
export function creerSurlignageParcelles(map: L.Map): SurlignageParcelles {
  assurerPane(map, PANE_SURLIGNAGE, 450);
  // Rendu SVG propre au pane (même si la carte est en preferCanvas) : jamais
  // de canvas plein écran qui intercepterait les clics des parcelles.
  const rendu = L.svg({ pane: PANE_SURLIGNAGE });
  const groupe = L.layerGroup().addTo(map);
  let derniereCle: string | null = null;
  let detruit = false;

  return {
    maj(features, recadrage) {
      if (detruit) return;
      groupe.clearLayers();
      if (features.length > 0) {
        const fc = { type: "FeatureCollection", features: [...features] } as FeatureCollection;
        L.geoJSON(fc, { pane: PANE_SURLIGNAGE, renderer: rendu, style: () => STYLE_HALO, interactive: false } as L.GeoJSONOptions).addTo(groupe);
        L.geoJSON(fc, { pane: PANE_SURLIGNAGE, renderer: rendu, style: () => STYLE_CONTOUR, interactive: false } as L.GeoJSONOptions).addTo(groupe);
      }
      if (recadrage && doitRecadrer(recadrage.cle, derniereCle)) {
        const emprise = empriseFeatures(recadrage.features);
        // Pas encore de géométrie : on retentera à la prochaine mise à jour.
        if (!emprise) return;
        derniereCle = recadrage.cle;
        try {
          map.fitBounds(versBoundsLeaflet(emprise), { padding: [48, 48], maxZoom: ZOOM_MAX_RECADRAGE, animate: true });
        } catch (e) {
          console.warn("[couchesIgn] recadrage impossible :", e);
        }
      }
    },
    detruire() {
      if (detruit) return;
      detruit = true;
      try { groupe.clearLayers(); map.removeLayer(groupe); map.removeLayer(rendu); } catch { /* carte déjà détruite */ }
    },
  };
}
