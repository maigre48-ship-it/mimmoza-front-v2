import { useMemo, useState } from "react";

/**
 * BudgetTravaux.tsx — Version "hyper précise" (offline, autonome)
 * - Gestion de pièces (intérieur + extérieur) : ajout / duplication / suppression
 * - Lots détaillés + items modifiables
 * - Cuisine & SDB : packs + options détaillées (auto-remplissage)
 * - Isolation : modules détaillés (combles, murs, planchers, menuiseries, étanchéité, ventilation)
 * - Totaux par pièce / global + imprévus (%)
 */

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type WorkLot =
  | "Démolition / préparation"
  | "Maçonnerie"
  | "Plâtrerie / cloisons"
  | "Électricité"
  | "Plomberie"
  | "Chauffage / ECS"
  | "Ventilation"
  | "Isolation"
  | "Menuiseries"
  | "Revêtements sols"
  | "Revêtements murs"
  | "Peinture"
  | "Cuisine"
  | "Salle de bain"
  | "Extérieurs"
  | "Divers";

type PriceUnit =
  | "forfait"
  | "m²"
  | "ml"
  | "u"
  | "point"
  | "m3"
  | "jour"
  | "lot";

type WorkItem = {
  id: string;
  lot: WorkLot;
  label: string;
  description?: string;
  unit: PriceUnit;
  qty: number;
  unitPrice: number; // € HT (ou TTC si tu veux, mais on reste cohérent)
};

type RoomKind =
  | "Cuisine"
  | "Salle de bain"
  | "WC"
  | "Salon / Séjour"
  | "Chambre"
  | "Bureau"
  | "Entrée / Couloir"
  | "Buanderie"
  | "Garage"
  | "Combles"
  | "Sous-sol / Cave"
  | "Extérieur"
  | "Autre";

type Room = {
  id: string;
  name: string;
  kind: RoomKind;
  surfaceM2: number;
  notes?: string;
  items: WorkItem[];
};

type PackLevel = "Éco" | "Standard" | "Premium";
type KitchenShape = "Linéaire" | "L" | "U" | "Avec îlot";
type BathType = "Douche" | "Baignoire" | "Douche + baignoire";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function eur(n: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(isFinite(n) ? n : 0);
}

function n0(n: number) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(
    isFinite(n) ? n : 0
  );
}

function sumItems(items: WorkItem[]) {
  return items.reduce((acc, it) => acc + (it.qty || 0) * (it.unitPrice || 0), 0);
}

function groupByLot(items: WorkItem[]) {
  const map = new Map<WorkLot, WorkItem[]>();
  for (const it of items) {
    const arr = map.get(it.lot) ?? [];
    arr.push(it);
    map.set(it.lot, arr);
  }
  return map;
}

// -----------------------------------------------------------------------------
// Default templates (highly detailed)
// -----------------------------------------------------------------------------

function makeBaseInteriorPrep(surfaceM2: number): WorkItem[] {
  const s = Math.max(0, surfaceM2 || 0);
  return [
    {
      id: uid("it"),
      lot: "Démolition / préparation",
      label: "Protection chantier + évacuation gravats",
      description: "Mise en protection, bennes/sacs, nettoyage fin.",
      unit: "forfait",
      qty: 1,
      unitPrice: 650,
    },
    {
      id: uid("it"),
      lot: "Démolition / préparation",
      label: "Dépose revêtements sols (si existant)",
      description: "Dépose carrelage/parquet/stratifié + préparation.",
      unit: "m²",
      qty: s,
      unitPrice: 18,
    },
    {
      id: uid("it"),
      lot: "Peinture",
      label: "Préparation supports (rebouchage, enduits légers)",
      unit: "m²",
      qty: s * 2.6, // approx murs/plafonds
      unitPrice: 8,
    },
  ];
}

function makeGenericRoomTemplate(kind: RoomKind, surfaceM2: number): WorkItem[] {
  const s = Math.max(0, surfaceM2 || 0);

  const base: WorkItem[] = [
    ...makeBaseInteriorPrep(s),
    {
      id: uid("it"),
      lot: "Électricité",
      label: "Points électriques (prises/interrupteurs)",
      description: "Création/ajout, hors remise aux normes tableau.",
      unit: "point",
      qty: kind === "Chambre" ? 6 : kind === "Salon / Séjour" ? 10 : 6,
      unitPrice: 95,
    },
    {
      id: uid("it"),
      lot: "Peinture",
      label: "Peinture murs (2 couches)",
      unit: "m²",
      qty: s * 2.2,
      unitPrice: 14,
    },
    {
      id: uid("it"),
      lot: "Peinture",
      label: "Peinture plafond (2 couches)",
      unit: "m²",
      qty: s,
      unitPrice: 16,
    },
    {
      id: uid("it"),
      lot: "Revêtements sols",
      label: "Sol (pose stratifié / parquet / carrelage)",
      description: "Pose + sous-couche (hors fourniture haut de gamme).",
      unit: "m²",
      qty: s,
      unitPrice: 45,
    },
    {
      id: uid("it"),
      lot: "Divers",
      label: "Plinthes + finitions",
      unit: "ml",
      qty: Math.round(Math.sqrt(s) * 10), // approximation
      unitPrice: 12,
    },
  ];

  // Variantes simples par type
  if (kind === "Entrée / Couloir") {
    base.push({
      id: uid("it"),
      lot: "Menuiseries",
      label: "Placard / rangement (option)",
      unit: "forfait",
      qty: 1,
      unitPrice: 900,
    });
  }

  if (kind === "Buanderie") {
    base.push(
      {
        id: uid("it"),
        lot: "Plomberie",
        label: "Arrivée/évacuation LL + point d’eau",
        unit: "forfait",
        qty: 1,
        unitPrice: 450,
      },
      {
        id: uid("it"),
        lot: "Revêtements sols",
        label: "Sol carrelage (recommandé pièce technique)",
        unit: "m²",
        qty: s,
        unitPrice: 55,
      }
    );
  }

  return base;
}

// --- Cuisine (ultra détaillée) ------------------------------------------------

type KitchenOptions = {
  level: PackLevel;
  shape: KitchenShape;
  linearMeters: number; // longueur linéaire approx
  includesAppliances: boolean;
  appliancesLevel: PackLevel;
  countertop: "Stratifié" | "Quartz" | "Granit" | "Inox" | "Céramique";
  backsplash: "Peinture" | "Crédence carrelage" | "Verre" | "Inox";
  sinkType: "1 bac" | "1.5 bac" | "2 bacs";
  faucetLevel: PackLevel;
  flooring: "Carrelage" | "Parquet" | "PVC / LVT";
  lighting: "Standard" | "Spots encastrés" | "Spots + LED sous meubles";
  electricalUpgrade: boolean;
  plumbingUpgrade: boolean;
  ventilationHood: "Recyclage" | "Évacuation";
  painting: boolean;
};

function kitchenDefaults(): KitchenOptions {
  return {
    level: "Standard",
    shape: "L",
    linearMeters: 4.2,
    includesAppliances: true,
    appliancesLevel: "Standard",
    countertop: "Quartz",
    backsplash: "Crédence carrelage",
    sinkType: "1.5 bac",
    faucetLevel: "Standard",
    flooring: "PVC / LVT",
    lighting: "Spots + LED sous meubles",
    electricalUpgrade: true,
    plumbingUpgrade: true,
    ventilationHood: "Évacuation",
    painting: true,
  };
}

function kitchenPackItems(surfaceM2: number, o: KitchenOptions): WorkItem[] {
  const s = Math.max(0, surfaceM2 || 0);
  const ml = Math.max(1, o.linearMeters || 0);

  // Prix unitaires indicatifs, ajustables item par item ensuite.
  const cabinetryPm =
    o.level === "Éco" ? 700 : o.level === "Standard" ? 1100 : 1600;
  const installCabinetryPm = o.level === "Premium" ? 240 : 190;

  const countertopPm = (() => {
    switch (o.countertop) {
      case "Stratifié":
        return 180;
      case "Quartz":
        return 420;
      case "Granit":
        return 520;
      case "Inox":
        return 480;
      case "Céramique":
        return 650;
    }
  })();

  const backsplashCost = (() => {
    switch (o.backsplash) {
      case "Peinture":
        return { unit: "m²" as const, price: 18, qty: s * 0.8 };
      case "Crédence carrelage":
        return { unit: "m²" as const, price: 95, qty: s * 0.8 };
      case "Verre":
        return { unit: "m²" as const, price: 180, qty: s * 0.8 };
      case "Inox":
        return { unit: "m²" as const, price: 160, qty: s * 0.8 };
    }
  })();

  const sinkPrice = o.sinkType === "1 bac" ? 220 : o.sinkType === "1.5 bac" ? 320 : 420;
  const faucetPrice =
    o.faucetLevel === "Éco" ? 90 : o.faucetLevel === "Standard" ? 160 : 260;

  const appliancesBundle = (() => {
    if (!o.includesAppliances) return 0;
    const base =
      o.appliancesLevel === "Éco"
        ? 1700
        : o.appliancesLevel === "Standard"
        ? 2800
        : 4600;
    // four + plaque + hotte + LV + frigo (bundle indicatif)
    return base;
  })();

  const hood = (() => {
    const base = o.level === "Premium" ? 520 : 350;
    const extra = o.ventilationHood === "Évacuation" ? 180 : 0;
    return base + extra;
  })();

  const lighting = (() => {
    switch (o.lighting) {
      case "Standard":
        return { points: 2, leds: 0, pricePoint: 110, priceLeds: 0 };
      case "Spots encastrés":
        return { points: 6, leds: 0, pricePoint: 120, priceLeds: 0 };
      case "Spots + LED sous meubles":
        return { points: 6, leds: 1, pricePoint: 120, priceLeds: 260 };
    }
  })();

  const flooringUnitPrice =
    o.flooring === "Carrelage" ? 75 : o.flooring === "Parquet" ? 85 : 55;

  const items: WorkItem[] = [
    ...makeBaseInteriorPrep(s),

    // Lot cuisine
    {
      id: uid("k"),
      lot: "Cuisine",
      label: `Meubles cuisine (${o.level})`,
      description: "Meubles bas/hauts/colonnes (hors électroménager).",
      unit: "ml",
      qty: ml,
      unitPrice: cabinetryPm,
    },
    {
      id: uid("k"),
      lot: "Cuisine",
      label: "Pose meubles cuisine",
      unit: "ml",
      qty: ml,
      unitPrice: installCabinetryPm,
    },
    {
      id: uid("k"),
      lot: "Cuisine",
      label: `Plan de travail (${o.countertop})`,
      unit: "ml",
      qty: ml,
      unitPrice: countertopPm,
    },
    {
      id: uid("k"),
      lot: "Cuisine",
      label: `Évier (${o.sinkType})`,
      unit: "u",
      qty: 1,
      unitPrice: sinkPrice,
    },
    {
      id: uid("k"),
      lot: "Cuisine",
      label: `Mitigeur (${o.faucetLevel})`,
      unit: "u",
      qty: 1,
      unitPrice: faucetPrice,
    },
    {
      id: uid("k"),
      lot: "Cuisine",
      label: `Hotte (${o.ventilationHood})`,
      unit: "u",
      qty: 1,
      unitPrice: hood,
    },

    // Crédence
    {
      id: uid("k"),
      lot: "Revêtements murs",
      label: `Crédence (${o.backsplash})`,
      unit: backsplashCost.unit,
      qty: Math.round(backsplashCost.qty * 10) / 10,
      unitPrice: backsplashCost.price,
    },

    // Sol
    {
      id: uid("k"),
      lot: "Revêtements sols",
      label: `Sol cuisine (${o.flooring})`,
      unit: "m²",
      qty: s,
      unitPrice: flooringUnitPrice,
    },

    // Électricité / plomberie dédiées
    {
      id: uid("k"),
      lot: "Plomberie",
      label: "Alimentation/évacuation évier + LV",
      description: "Création ou reprise (hors gros déplacement colonne).",
      unit: "forfait",
      qty: 1,
      unitPrice: o.plumbingUpgrade ? 650 : 350,
    },
    {
      id: uid("k"),
      lot: "Électricité",
      label: "Ligne(s) dédiée(s) (four/plaque/LV) + protections",
      unit: "forfait",
      qty: 1,
      unitPrice: o.electricalUpgrade ? 780 : 420,
    },
    {
      id: uid("k"),
      lot: "Électricité",
      label: "Éclairage principal (points)",
      unit: "point",
      qty: lighting.points,
      unitPrice: lighting.pricePoint,
    },
  ];

  if (lighting.leds > 0) {
    items.push({
      id: uid("k"),
      lot: "Électricité",
      label: "Rubans LED sous meubles + alim",
      unit: "lot",
      qty: lighting.leds,
      unitPrice: lighting.priceLeds,
    });
  }

  if (o.shape === "Avec îlot") {
    items.push(
      {
        id: uid("k"),
        lot: "Cuisine",
        label: "Îlot (meubles + structure)",
        unit: "forfait",
        qty: 1,
        unitPrice: o.level === "Éco" ? 900 : o.level === "Standard" ? 1500 : 2400,
      },
      {
        id: uid("k"),
        lot: "Électricité",
        label: "Alimentation îlot (prises/plan de travail)",
        unit: "forfait",
        qty: 1,
        unitPrice: 320,
      }
    );
  }

  if (o.includesAppliances) {
    items.push({
      id: uid("k"),
      lot: "Cuisine",
      label: `Électroménager (bundle ${o.appliancesLevel})`,
      description: "Four + plaque + LV + frigo (indicatif).",
      unit: "forfait",
      qty: 1,
      unitPrice: appliancesBundle,
    });
  }

  if (o.painting) {
    items.push({
      id: uid("k"),
      lot: "Peinture",
      label: "Peinture cuisine (murs + plafond)",
      unit: "m²",
      qty: s * 3.0,
      unitPrice: 15,
    });
  }

  return items;
}

// --- Salle de bain (ultra détaillée) ------------------------------------------

type BathroomOptions = {
  level: PackLevel;
  surfaceM2: number;
  type: BathType;
  wc: "Suspendu" | "Au sol";
  vanity: "Simple vasque" | "Double vasque";
  shower: "Receveur" | "Italienne";
  tiling: "Partiel" | "Complet";
  waterproofing: boolean;
  heating: "Sèche-serviettes" | "Plancher chauffant" | "Radiateur";
  ventilation: "VMC simple" | "VMC hygro" | "Extraction indépendante";
  lighting: "Standard" | "Spots";
  electricalUpgrade: boolean;
  plumbingUpgrade: boolean;
  accessories: boolean;
};

function bathroomDefaults(surfaceM2: number): BathroomOptions {
  return {
    level: "Standard",
    surfaceM2: Math.max(0, surfaceM2 || 0),
    type: "Douche",
    wc: "Suspendu",
    vanity: "Simple vasque",
    shower: "Italienne",
    tiling: "Complet",
    waterproofing: true,
    heating: "Sèche-serviettes",
    ventilation: "VMC hygro",
    lighting: "Spots",
    electricalUpgrade: true,
    plumbingUpgrade: true,
    accessories: true,
  };
}

function bathroomPackItems(o: BathroomOptions): WorkItem[] {
  const s = Math.max(0, o.surfaceM2 || 0);

  const sanitaryPack = o.level === "Éco" ? 1200 : o.level === "Standard" ? 2200 : 3800;
  const furniturePack = o.level === "Éco" ? 650 : o.level === "Standard" ? 1100 : 1900;

  const tilingQty = o.tiling === "Complet" ? s * 3.2 : s * 1.6;
  const tilingUnit = o.level === "Premium" ? 110 : o.level === "Standard" ? 85 : 65;

  const showerCost = (() => {
    if (o.shower === "Receveur") return o.level === "Éco" ? 650 : o.level === "Standard" ? 950 : 1600;
    return o.level === "Éco" ? 950 : o.level === "Standard" ? 1500 : 2600; // italienne (incl. pente/receveur à carreler)
  })();

  const bathCost = (() => {
    if (o.type === "Baignoire") return o.level === "Éco" ? 800 : o.level === "Standard" ? 1300 : 2200;
    if (o.type === "Douche + baignoire") return o.level === "Éco" ? 1400 : o.level === "Standard" ? 2300 : 3900;
    return 0;
  })();

  const wcCost = o.wc === "Suspendu"
    ? (o.level === "Éco" ? 520 : o.level === "Standard" ? 780 : 1250)
    : (o.level === "Éco" ? 220 : o.level === "Standard" ? 360 : 520);

  const heating = (() => {
    switch (o.heating) {
      case "Sèche-serviettes":
        return o.level === "Éco" ? 280 : o.level === "Standard" ? 420 : 680;
      case "Radiateur":
        return o.level === "Éco" ? 220 : o.level === "Standard" ? 350 : 520;
      case "Plancher chauffant":
        return o.level === "Éco" ? 70 : o.level === "Standard" ? 95 : 130; // €/m²
    }
  })();

  const ventilation = (() => {
    switch (o.ventilation) {
      case "VMC simple":
        return 220;
      case "VMC hygro":
        return 380;
      case "Extraction indépendante":
        return 520;
    }
  })();

  const lightPoints = o.lighting === "Spots" ? 4 : 2;

  const items: WorkItem[] = [
    ...makeBaseInteriorPrep(s),

    {
      id: uid("b"),
      lot: "Salle de bain",
      label: `Sanitaires (pack ${o.level})`,
      description: "Robinetteries principales (hors douche italienne spécifique).",
      unit: "forfait",
      qty: 1,
      unitPrice: sanitaryPack,
    },
    {
      id: uid("b"),
      lot: "Salle de bain",
      label: `Meuble vasque (${o.vanity})`,
      unit: "forfait",
      qty: 1,
      unitPrice: furniturePack + (o.vanity === "Double vasque" ? 550 : 0),
    },
    {
      id: uid("b"),
      lot: "Salle de bain",
      label: `Douche (${o.shower})`,
      unit: "forfait",
      qty: 1,
      unitPrice: showerCost,
    },
    ...(bathCost > 0
      ? [
          {
            id: uid("b"),
            lot: "Salle de bain",
            label: `Baignoire (${o.type})`,
            unit: "forfait",
            qty: 1,
            unitPrice: bathCost,
          } as WorkItem,
        ]
      : []),

    {
      id: uid("b"),
      lot: "Salle de bain",
      label: `WC (${o.wc})`,
      unit: "forfait",
      qty: 1,
      unitPrice: wcCost,
    },

    ...(o.waterproofing
      ? [
          {
            id: uid("b"),
            lot: "Revêtements murs",
            label: "Étanchéité (SPEC) zones humides",
            unit: "m²",
            qty: tilingQty,
            unitPrice: 12,
          } as WorkItem,
        ]
      : []),

    {
      id: uid("b"),
      lot: "Revêtements murs",
      label: `Carrelage/faïence (${o.tiling})`,
      unit: "m²",
      qty: Math.round(tilingQty * 10) / 10,
      unitPrice: tilingUnit,
    },
    {
      id: uid("b"),
      lot: "Revêtements sols",
      label: "Sol (carrelage recommandé)",
      unit: "m²",
      qty: s,
      unitPrice: o.level === "Premium" ? 95 : o.level === "Standard" ? 75 : 60,
    },

    {
      id: uid("b"),
      lot: "Plomberie",
      label: "Reprise plomberie (alims/évacs)",
      unit: "forfait",
      qty: 1,
      unitPrice: o.plumbingUpgrade ? 1200 : 650,
    },
    {
      id: uid("b"),
      lot: "Électricité",
      label: "Reprise électricité (protection + lignes + volumes)",
      unit: "forfait",
      qty: 1,
      unitPrice: o.electricalUpgrade ? 880 : 420,
    },
    {
      id: uid("b"),
      lot: "Électricité",
      label: "Éclairage (points)",
      unit: "point",
      qty: lightPoints,
      unitPrice: 120,
    },
    {
      id: uid("b"),
      lot: "Ventilation",
      label: `Ventilation (${o.ventilation})`,
      unit: "forfait",
      qty: 1,
      unitPrice: ventilation,
    },

    ...(o.heating === "Plancher chauffant"
      ? [
          {
            id: uid("b"),
            lot: "Chauffage / ECS",
            label: "Plancher chauffant électrique (pose)",
            unit: "m²",
            qty: s,
            unitPrice: heating as number,
          } as WorkItem,
        ]
      : [
          {
            id: uid("b"),
            lot: "Chauffage / ECS",
            label: `Chauffage (${o.heating})`,
            unit: "u",
            qty: 1,
            unitPrice: heating as number,
          } as WorkItem,
        ]),

    ...(o.accessories
      ? [
          {
            id: uid("b"),
            lot: "Salle de bain",
            label: "Accessoires (miroir, porte-serviettes, parois, etc.)",
            unit: "forfait",
            qty: 1,
            unitPrice: o.level === "Éco" ? 250 : o.level === "Standard" ? 450 : 850,
          } as WorkItem,
        ]
      : []),
  ];

  return items;
}

// --- Extérieurs ---------------------------------------------------------------

type ExteriorOptions = {
  terraceM2: number;
  fencingML: number;
  landscapingM2: number;
  facadeM2: number;
  roofRepair: boolean;
  exteriorPainting: boolean;
};

function exteriorDefaults(): ExteriorOptions {
  return {
    terraceM2: 25,
    fencingML: 20,
    landscapingM2: 80,
    facadeM2: 0,
    roofRepair: false,
    exteriorPainting: false,
  };
}

function exteriorItems(o: ExteriorOptions): WorkItem[] {
  const items: WorkItem[] = [
    {
      id: uid("ex"),
      lot: "Extérieurs",
      label: "Terrasse (dallage/bois/composite) — pose + fournitures",
      unit: "m²",
      qty: Math.max(0, o.terraceM2 || 0),
      unitPrice: 120,
    },
    {
      id: uid("ex"),
      lot: "Extérieurs",
      label: "Clôture + portillon/portail (hors motorisation)",
      unit: "ml",
      qty: Math.max(0, o.fencingML || 0),
      unitPrice: 85,
    },
    {
      id: uid("ex"),
      lot: "Extérieurs",
      label: "Aménagement paysager (nivellement/semis/plantations)",
      unit: "m²",
      qty: Math.max(0, o.landscapingM2 || 0),
      unitPrice: 18,
    },
  ];

  if ((o.facadeM2 || 0) > 0) {
    items.push({
      id: uid("ex"),
      lot: "Extérieurs",
      label: "Ravalement façade (nettoyage + enduit/peinture selon état)",
      unit: "m²",
      qty: Math.max(0, o.facadeM2 || 0),
      unitPrice: 65,
    });
  }

  if (o.roofRepair) {
    items.push({
      id: uid("ex"),
      lot: "Extérieurs",
      label: "Révision toiture (tuiles/zinguerie/étanchéité ponctuelle)",
      unit: "forfait",
      qty: 1,
      unitPrice: 1800,
    });
  }

  if (o.exteriorPainting) {
    items.push({
      id: uid("ex"),
      lot: "Extérieurs",
      label: "Peintures extérieures boiseries/volets (option)",
      unit: "forfait",
      qty: 1,
      unitPrice: 1200,
    });
  }

  return items;
}

// --- Isolation (module détaillé) ---------------------------------------------

type InsulationOptions = {
  atticM2: number; // combles perdus / rampants
  wallsM2: number; // ITI/IPE
  floorM2: number; // plancher bas
  windowsCount: number;
  doorsCount: number;
  airTightness: boolean;
  vmc: "Aucune" | "Simple flux" | "Hygro B" | "Double flux";
  level: PackLevel; // pour qualité d’isolant / menuiseries
};

function insulationDefaults(): InsulationOptions {
  return {
    atticM2: 60,
    wallsM2: 120,
    floorM2: 60,
    windowsCount: 6,
    doorsCount: 1,
    airTightness: true,
    vmc: "Hygro B",
    level: "Standard",
  };
}

function insulationItems(o: InsulationOptions): WorkItem[] {
  const lvl = o.level;
  const atticPrice = lvl === "Éco" ? 28 : lvl === "Standard" ? 38 : 55; // €/m² soufflage/rampants simplifié
  const wallPrice = lvl === "Éco" ? 55 : lvl === "Standard" ? 75 : 105; // €/m² ITI
  const floorPrice = lvl === "Éco" ? 42 : lvl === "Standard" ? 58 : 78; // €/m²

  const windowUnit = lvl === "Éco" ? 520 : lvl === "Standard" ? 850 : 1250;
  const doorUnit = lvl === "Éco" ? 780 : lvl === "Standard" ? 1200 : 1800;

  const vmcCost = (() => {
    switch (o.vmc) {
      case "Aucune":
        return 0;
      case "Simple flux":
        return 650;
      case "Hygro B":
        return 980;
      case "Double flux":
        return 2800;
    }
  })();

  const items: WorkItem[] = [
    {
      id: uid("ins"),
      lot: "Isolation",
      label: `Isolation combles (${lvl})`,
      description: "Soufflage/rouleaux selon configuration.",
      unit: "m²",
      qty: Math.max(0, o.atticM2 || 0),
      unitPrice: atticPrice,
    },
    {
      id: uid("ins"),
      lot: "Isolation",
      label: `Isolation murs (${lvl})`,
      description: "ITI (rails/laine/BA13) ou équivalent.",
      unit: "m²",
      qty: Math.max(0, o.wallsM2 || 0),
      unitPrice: wallPrice,
    },
    {
      id: uid("ins"),
      lot: "Isolation",
      label: `Isolation plancher bas (${lvl})`,
      unit: "m²",
      qty: Math.max(0, o.floorM2 || 0),
      unitPrice: floorPrice,
    },
    {
      id: uid("ins"),
      lot: "Menuiseries",
      label: `Fenêtres (remplacement, ${lvl})`,
      description: "Double vitrage performant (indicatif, hors contraintes).",
      unit: "u",
      qty: Math.max(0, o.windowsCount || 0),
      unitPrice: windowUnit,
    },
    {
      id: uid("ins"),
      lot: "Menuiseries",
      label: `Portes extérieures (remplacement, ${lvl})`,
      unit: "u",
      qty: Math.max(0, o.doorsCount || 0),
      unitPrice: doorUnit,
    },
  ];

  if (o.airTightness) {
    items.push({
      id: uid("ins"),
      lot: "Isolation",
      label: "Étanchéité à l’air (traitements + bandes + mastic)",
      unit: "forfait",
      qty: 1,
      unitPrice: 850,
    });
  }

  if (vmcCost > 0) {
    items.push({
      id: uid("ins"),
      lot: "Ventilation",
      label: `VMC (${o.vmc})`,
      unit: "forfait",
      qty: 1,
      unitPrice: vmcCost,
    });
  }

  return items;
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

const BudgetTravaux: React.FC = () => {
  const [rooms, setRooms] = useState<Room[]>(() => {
    const kitchen: Room = {
      id: uid("room"),
      name: "Cuisine",
      kind: "Cuisine",
      surfaceM2: 12,
      items: kitchenPackItems(12, kitchenDefaults()),
    };

    const bath: Room = {
      id: uid("room"),
      name: "Salle de bain",
      kind: "Salle de bain",
      surfaceM2: 6,
      items: bathroomPackItems(bathroomDefaults(6)),
    };

    const living: Room = {
      id: uid("room"),
      name: "Salon / Séjour",
      kind: "Salon / Séjour",
      surfaceM2: 28,
      items: makeGenericRoomTemplate("Salon / Séjour", 28),
    };

    const insulationRoom: Room = {
      id: uid("room"),
      name: "Isolation (maison)",
      kind: "Autre",
      surfaceM2: 0,
      notes: "Lot global isolation / menuiseries / ventilation.",
      items: insulationItems(insulationDefaults()),
    };

    const outside: Room = {
      id: uid("room"),
      name: "Extérieurs",
      kind: "Extérieur",
      surfaceM2: 0,
      items: exteriorItems(exteriorDefaults()),
    };

    return [living, kitchen, bath, insulationRoom, outside];
  });

  const [selectedRoomId, setSelectedRoomId] = useState<string>(() => rooms[0]?.id ?? "");
  const selectedRoom = rooms.find((r) => r.id === selectedRoomId) ?? rooms[0];

  const [imprevusPct, setImprevusPct] = useState<number>(8);

  // Create-room UI
  const [newRoomKind, setNewRoomKind] = useState<RoomKind>("Chambre");
  const [newRoomName, setNewRoomName] = useState<string>("Nouvelle pièce");
  const [newRoomSurface, setNewRoomSurface] = useState<number>(12);

  // Kitchen/Bath/Exterior/Insulation options UI (scoped)
  const [kitchenOpts, setKitchenOpts] = useState<KitchenOptions>(kitchenDefaults());
  const [bathOpts, setBathOpts] = useState<BathroomOptions>(bathroomDefaults(6));
  const [extOpts, setExtOpts] = useState<ExteriorOptions>(exteriorDefaults());
  const [insOpts, setInsOpts] = useState<InsulationOptions>(insulationDefaults());

  // Totals
  const totals = useMemo(() => {
    const perRoom = rooms.map((r) => ({
      id: r.id,
      name: r.name,
      total: sumItems(r.items),
    }));
    const subtotal = perRoom.reduce((acc, x) => acc + x.total, 0);
    const imp = subtotal * (Math.max(0, imprevusPct) / 100);
    const total = subtotal + imp;
    return { perRoom, subtotal, imp, total };
  }, [rooms, imprevusPct]);

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  const updateRoom = (roomId: string, patch: Partial<Room>) => {
    setRooms((prev) => prev.map((r) => (r.id === roomId ? { ...r, ...patch } : r)));
  };

  const addRoom = () => {
    const s = Math.max(0, newRoomSurface || 0);
    const kind = newRoomKind;
    let items: WorkItem[] = [];

    if (kind === "Cuisine") items = kitchenPackItems(s, kitchenOpts);
    else if (kind === "Salle de bain") items = bathroomPackItems({ ...bathOpts, surfaceM2: s });
    else if (kind === "Extérieur") items = exteriorItems(extOpts);
    else if (kind === "Autre" && newRoomName.toLowerCase().includes("isolation"))
      items = insulationItems(insOpts);
    else items = makeGenericRoomTemplate(kind, s);

    const room: Room = {
      id: uid("room"),
      name: newRoomName.trim() || kind,
      kind,
      surfaceM2: s,
      items,
    };

    setRooms((prev) => [room, ...prev]);
    setSelectedRoomId(room.id);
  };

  const duplicateRoom = (roomId: string) => {
    const r = rooms.find((x) => x.id === roomId);
    if (!r) return;
    const copy: Room = {
      ...r,
      id: uid("room"),
      name: `${r.name} (copie)`,
      items: r.items.map((it) => ({ ...it, id: uid("it") })),
    };
    setRooms((prev) => [copy, ...prev]);
    setSelectedRoomId(copy.id);
  };

  const deleteRoom = (roomId: string) => {
    if (rooms.length <= 1) return;
    setRooms((prev) => prev.filter((r) => r.id !== roomId));
    if (selectedRoomId === roomId) {
      const next = rooms.find((r) => r.id !== roomId);
      setSelectedRoomId(next?.id ?? "");
    }
  };

  const addItem = (roomId: string) => {
    const it: WorkItem = {
      id: uid("it"),
      lot: "Divers",
      label: "Nouvelle ligne",
      unit: "forfait",
      qty: 1,
      unitPrice: 0,
    };
    setRooms((prev) =>
      prev.map((r) => (r.id === roomId ? { ...r, items: [it, ...r.items] } : r))
    );
  };

  const updateItem = (roomId: string, itemId: string, patch: Partial<WorkItem>) => {
    setRooms((prev) =>
      prev.map((r) => {
        if (r.id !== roomId) return r;
        return {
          ...r,
          items: r.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)),
        };
      })
    );
  };

  const deleteItem = (roomId: string, itemId: string) => {
    setRooms((prev) =>
      prev.map((r) => (r.id === roomId ? { ...r, items: r.items.filter((it) => it.id !== itemId) } : r))
    );
  };

  const applyKitchenPackToRoom = (roomId: string) => {
    const r = rooms.find((x) => x.id === roomId);
    if (!r) return;
    const s = r.surfaceM2 || 0;
    updateRoom(roomId, { kind: "Cuisine", items: kitchenPackItems(s, kitchenOpts) });
  };

  const applyBathroomPackToRoom = (roomId: string) => {
    const r = rooms.find((x) => x.id === roomId);
    if (!r) return;
    const s = r.surfaceM2 || 0;
    updateRoom(roomId, { kind: "Salle de bain", items: bathroomPackItems({ ...bathOpts, surfaceM2: s }) });
  };

  const applyExteriorPackToRoom = (roomId: string) => {
    updateRoom(roomId, { kind: "Extérieur", items: exteriorItems(extOpts) });
  };

  const applyInsulationPackToRoom = (roomId: string) => {
    updateRoom(roomId, { kind: "Autre", items: insulationItems(insOpts) });
  };

  // ---------------------------------------------------------------------------
  // UI rendering
  // ---------------------------------------------------------------------------

  const selectedTotal = selectedRoom ? sumItems(selectedRoom.items) : 0;
  const lotsMap = selectedRoom ? groupByLot(selectedRoom.items) : new Map<WorkLot, WorkItem[]>();
  const lotOrder: WorkLot[] = [
    "Démolition / préparation",
    "Maçonnerie",
    "Plâtrerie / cloisons",
    "Isolation",
    "Menuiseries",
    "Électricité",
    "Plomberie",
    "Chauffage / ECS",
    "Ventilation",
    "Revêtements sols",
    "Revêtements murs",
    "Peinture",
    "Cuisine",
    "Salle de bain",
    "Extérieurs",
    "Divers",
  ];

  return (
    <div style={pageStyle}>
      <div style={headerStyle}>
        <div>
          <div style={kickerStyle}>TRAVAUX</div>
          <h1 style={titleStyle}>Budget travaux</h1>
          <p style={subtitleStyle}>
            Budget détaillé par pièce et par lot. Ajoute des pièces, personnalise chaque ligne,
            et pilote un budget hyper précis (cuisine/salle de bain/isolation/extérieurs inclus).
          </p>
        </div>

        <div style={headerRightStyle}>
          <div style={bigNumberCardStyle}>
            <div style={bigNumberLabelStyle}>Total estimé</div>
            <div style={bigNumberValueStyle}>{eur(totals.total)}</div>
            <div style={bigNumberHintStyle}>
              Sous-total {eur(totals.subtotal)} + imprévus {eur(totals.imp)}
            </div>
          </div>
        </div>
      </div>

      <div style={mainGridStyle}>
        {/* Left column: rooms + add room */}
        <div style={cardStyle}>
          <h2 style={cardTitleStyle}>Pièces</h2>

          <div style={imprevusRowStyle}>
            <label style={fieldStyle}>
              <div style={labelStyle}>Imprévus (%)</div>
              <input
                type="number"
                min={0}
                max={30}
                step={1}
                style={inputStyle}
                value={imprevusPct}
                onChange={(e) => setImprevusPct(clamp(Number(e.target.value || 0), 0, 30))}
              />
            </label>
          </div>

          <div style={roomsListStyle}>
            {rooms.map((r) => {
              const isActive = r.id === selectedRoomId;
              const t = sumItems(r.items);
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedRoomId(r.id)}
                  style={{
                    ...roomRowStyle,
                    borderColor: isActive ? "rgba(14,165,233,0.55)" : "rgba(15,23,42,0.10)",
                    background: isActive ? "#e0f2fe" : "#ffffff",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <div>
                      <div style={roomNameStyle}>{r.name}</div>
                      <div style={roomMetaStyle}>
                        {r.kind} {r.surfaceM2 ? `• ${n0(r.surfaceM2)} m²` : ""}
                      </div>
                    </div>
                    <div style={roomTotalStyle}>{eur(t)}</div>
                  </div>
                </button>
              );
            })}
          </div>

          <div style={dividerStyle} />

          <h3 style={subTitleStyle}>Ajouter une pièce</h3>
          <div style={formGridStyle}>
            <label style={fieldStyle}>
              <div style={labelStyle}>Type</div>
              <select
                style={inputStyle}
                value={newRoomKind}
                onChange={(e) => setNewRoomKind(e.target.value as RoomKind)}
              >
                {[
                  "Cuisine",
                  "Salle de bain",
                  "WC",
                  "Salon / Séjour",
                  "Chambre",
                  "Bureau",
                  "Entrée / Couloir",
                  "Buanderie",
                  "Garage",
                  "Combles",
                  "Sous-sol / Cave",
                  "Extérieur",
                  "Autre",
                ].map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>

            <label style={fieldStyle}>
              <div style={labelStyle}>Nom</div>
              <input
                style={inputStyle}
                value={newRoomName}
                onChange={(e) => setNewRoomName(e.target.value)}
                placeholder="Ex: Chambre 1"
              />
            </label>

            <label style={fieldStyle}>
              <div style={labelStyle}>Surface (m²)</div>
              <input
                type="number"
                min={0}
                step={1}
                style={inputStyle}
                value={newRoomSurface}
                onChange={(e) => setNewRoomSurface(Math.max(0, Number(e.target.value || 0)))}
              />
            </label>
          </div>

          <div style={actionsStyle}>
            <button type="button" style={btnPrimaryStyle} onClick={addRoom}>
              Ajouter
            </button>
          </div>
        </div>

        {/* Right column: selected room details */}
        <div style={cardStyle}>
          {selectedRoom ? (
            <>
              <div style={roomHeaderStyle}>
                <div>
                  <h2 style={{ ...cardTitleStyle, marginBottom: 6 }}>{selectedRoom.name}</h2>
                  <div style={roomMetaStyle}>
                    {selectedRoom.kind}
                    {selectedRoom.surfaceM2 ? ` • ${n0(selectedRoom.surfaceM2)} m²` : ""}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <div style={chipStyle}>{eur(selectedTotal)}</div>
                  <button type="button" style={btnSecondaryStyle} onClick={() => addItem(selectedRoom.id)}>
                    + Ligne
                  </button>
                  <button type="button" style={btnSecondaryStyle} onClick={() => duplicateRoom(selectedRoom.id)}>
                    Dupliquer
                  </button>
                  <button
                    type="button"
                    style={{ ...btnDangerStyle, opacity: rooms.length <= 1 ? 0.5 : 1 }}
                    onClick={() => deleteRoom(selectedRoom.id)}
                    disabled={rooms.length <= 1}
                  >
                    Supprimer
                  </button>
                </div>
              </div>

              <div style={dividerStyle} />

              {/* Room basic fields */}
              <div style={roomBasicsGridStyle}>
                <label style={fieldStyle}>
                  <div style={labelStyle}>Nom</div>
                  <input
                    style={inputStyle}
                    value={selectedRoom.name}
                    onChange={(e) => updateRoom(selectedRoom.id, { name: e.target.value })}
                  />
                </label>

                <label style={fieldStyle}>
                  <div style={labelStyle}>Type</div>
                  <select
                    style={inputStyle}
                    value={selectedRoom.kind}
                    onChange={(e) => updateRoom(selectedRoom.id, { kind: e.target.value as RoomKind })}
                  >
                    {[
                      "Cuisine",
                      "Salle de bain",
                      "WC",
                      "Salon / Séjour",
                      "Chambre",
                      "Bureau",
                      "Entrée / Couloir",
                      "Buanderie",
                      "Garage",
                      "Combles",
                      "Sous-sol / Cave",
                      "Extérieur",
                      "Autre",
                    ].map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={fieldStyle}>
                  <div style={labelStyle}>Surface (m²)</div>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    style={inputStyle}
                    value={selectedRoom.surfaceM2}
                    onChange={(e) =>
                      updateRoom(selectedRoom.id, { surfaceM2: Math.max(0, Number(e.target.value || 0)) })
                    }
                  />
                </label>
              </div>

              <label style={{ ...fieldStyle, marginTop: 10 }}>
                <div style={labelStyle}>Notes</div>
                <textarea
                  style={textareaStyle}
                  value={selectedRoom.notes ?? ""}
                  onChange={(e) => updateRoom(selectedRoom.id, { notes: e.target.value })}
                  placeholder="Contraintes, devis, hypothèses, etc."
                />
              </label>

              <div style={dividerStyle} />

              {/* Packs quick apply */}
              <div style={packsGridStyle}>
                <div style={packCardStyle}>
                  <div style={packTitleStyle}>Cuisine (pack)</div>
                  <div style={packHintStyle}>Options détaillées + auto-remplissage.</div>
                  <div style={packGridStyle}>
                    <SelectField
                      label="Niveau"
                      value={kitchenOpts.level}
                      onChange={(v) => setKitchenOpts((p) => ({ ...p, level: v as PackLevel }))}
                      options={["Éco", "Standard", "Premium"]}
                    />
                    <SelectField
                      label="Forme"
                      value={kitchenOpts.shape}
                      onChange={(v) => setKitchenOpts((p) => ({ ...p, shape: v as KitchenShape }))}
                      options={["Linéaire", "L", "U", "Avec îlot"]}
                    />
                    <NumberField
                      label="Linéaire (ml)"
                      value={kitchenOpts.linearMeters}
                      onChange={(v) => setKitchenOpts((p) => ({ ...p, linearMeters: v }))}
                      step={0.1}
                    />
                    <SelectField
                      label="Plan de travail"
                      value={kitchenOpts.countertop}
                      onChange={(v) => setKitchenOpts((p) => ({ ...p, countertop: v as any }))}
                      options={["Stratifié", "Quartz", "Granit", "Inox", "Céramique"]}
                    />
                    <SelectField
                      label="Crédence"
                      value={kitchenOpts.backsplash}
                      onChange={(v) => setKitchenOpts((p) => ({ ...p, backsplash: v as any }))}
                      options={["Peinture", "Crédence carrelage", "Verre", "Inox"]}
                    />
                    <SelectField
                      label="Électroménager"
                      value={kitchenOpts.includesAppliances ? "Oui" : "Non"}
                      onChange={(v) => setKitchenOpts((p) => ({ ...p, includesAppliances: v === "Oui" }))}
                      options={["Oui", "Non"]}
                    />
                    <SelectField
                      label="Niveau électroménager"
                      value={kitchenOpts.appliancesLevel}
                      onChange={(v) => setKitchenOpts((p) => ({ ...p, appliancesLevel: v as PackLevel }))}
                      options={["Éco", "Standard", "Premium"]}
                    />
                    <SelectField
                      label="Ventilation hotte"
                      value={kitchenOpts.ventilationHood}
                      onChange={(v) => setKitchenOpts((p) => ({ ...p, ventilationHood: v as any }))}
                      options={["Recyclage", "Évacuation"]}
                    />
                    <SelectField
                      label="Éclairage"
                      value={kitchenOpts.lighting}
                      onChange={(v) => setKitchenOpts((p) => ({ ...p, lighting: v as any }))}
                      options={["Standard", "Spots encastrés", "Spots + LED sous meubles"]}
                    />
                    <SelectField
                      label="Sol"
                      value={kitchenOpts.flooring}
                      onChange={(v) => setKitchenOpts((p) => ({ ...p, flooring: v as any }))}
                      options={["Carrelage", "Parquet", "PVC / LVT"]}
                    />
                    <SelectField
                      label="Peinture cuisine"
                      value={kitchenOpts.painting ? "Oui" : "Non"}
                      onChange={(v) => setKitchenOpts((p) => ({ ...p, painting: v === "Oui" }))}
                      options={["Oui", "Non"]}
                    />
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                    <button type="button" style={btnPrimaryStyle} onClick={() => applyKitchenPackToRoom(selectedRoom.id)}>
                      Appliquer au lot
                    </button>
                  </div>
                </div>

                <div style={packCardStyle}>
                  <div style={packTitleStyle}>Salle de bain (pack)</div>
                  <div style={packHintStyle}>Douche italienne, WC suspendu, carrelage, etc.</div>
                  <div style={packGridStyle}>
                    <SelectField
                      label="Niveau"
                      value={bathOpts.level}
                      onChange={(v) => setBathOpts((p) => ({ ...p, level: v as PackLevel }))}
                      options={["Éco", "Standard", "Premium"]}
                    />
                    <SelectField
                      label="Type"
                      value={bathOpts.type}
                      onChange={(v) => setBathOpts((p) => ({ ...p, type: v as any }))}
                      options={["Douche", "Baignoire", "Douche + baignoire"]}
                    />
                    <SelectField
                      label="Douche"
                      value={bathOpts.shower}
                      onChange={(v) => setBathOpts((p) => ({ ...p, shower: v as any }))}
                      options={["Receveur", "Italienne"]}
                    />
                    <SelectField
                      label="Carrelage"
                      value={bathOpts.tiling}
                      onChange={(v) => setBathOpts((p) => ({ ...p, tiling: v as any }))}
                      options={["Partiel", "Complet"]}
                    />
                    <SelectField
                      label="Étanchéité SPEC"
                      value={bathOpts.waterproofing ? "Oui" : "Non"}
                      onChange={(v) => setBathOpts((p) => ({ ...p, waterproofing: v === "Oui" }))}
                      options={["Oui", "Non"]}
                    />
                    <SelectField
                      label="WC"
                      value={bathOpts.wc}
                      onChange={(v) => setBathOpts((p) => ({ ...p, wc: v as any }))}
                      options={["Suspendu", "Au sol"]}
                    />
                    <SelectField
                      label="Vasque"
                      value={bathOpts.vanity}
                      onChange={(v) => setBathOpts((p) => ({ ...p, vanity: v as any }))}
                      options={["Simple vasque", "Double vasque"]}
                    />
                    <SelectField
                      label="Chauffage"
                      value={bathOpts.heating}
                      onChange={(v) => setBathOpts((p) => ({ ...p, heating: v as any }))}
                      options={["Sèche-serviettes", "Radiateur", "Plancher chauffant"]}
                    />
                    <SelectField
                      label="Ventilation"
                      value={bathOpts.ventilation}
                      onChange={(v) => setBathOpts((p) => ({ ...p, ventilation: v as any }))}
                      options={["VMC simple", "VMC hygro", "Extraction indépendante"]}
                    />
                    <SelectField
                      label="Éclairage"
                      value={bathOpts.lighting}
                      onChange={(v) => setBathOpts((p) => ({ ...p, lighting: v as any }))}
                      options={["Standard", "Spots"]}
                    />
                    <SelectField
                      label="Accessoires"
                      value={bathOpts.accessories ? "Oui" : "Non"}
                      onChange={(v) => setBathOpts((p) => ({ ...p, accessories: v === "Oui" }))}
                      options={["Oui", "Non"]}
                    />
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                    <button
                      type="button"
                      style={btnPrimaryStyle}
                      onClick={() => applyBathroomPackToRoom(selectedRoom.id)}
                    >
                      Appliquer au lot
                    </button>
                  </div>
                </div>

                <div style={packCardStyle}>
                  <div style={packTitleStyle}>Isolation (pack)</div>
                  <div style={packHintStyle}>Combles, murs, planchers, menuiseries, VMC, étanchéité.</div>

                  <div style={packGridStyle}>
                    <SelectField
                      label="Niveau"
                      value={insOpts.level}
                      onChange={(v) => setInsOpts((p) => ({ ...p, level: v as PackLevel }))}
                      options={["Éco", "Standard", "Premium"]}
                    />
                    <NumberField
                      label="Combles (m²)"
                      value={insOpts.atticM2}
                      onChange={(v) => setInsOpts((p) => ({ ...p, atticM2: v }))}
                    />
                    <NumberField
                      label="Murs (m²)"
                      value={insOpts.wallsM2}
                      onChange={(v) => setInsOpts((p) => ({ ...p, wallsM2: v }))}
                    />
                    <NumberField
                      label="Plancher bas (m²)"
                      value={insOpts.floorM2}
                      onChange={(v) => setInsOpts((p) => ({ ...p, floorM2: v }))}
                    />
                    <NumberField
                      label="Fenêtres (u)"
                      value={insOpts.windowsCount}
                      onChange={(v) => setInsOpts((p) => ({ ...p, windowsCount: Math.round(v) }))}
                    />
                    <NumberField
                      label="Portes (u)"
                      value={insOpts.doorsCount}
                      onChange={(v) => setInsOpts((p) => ({ ...p, doorsCount: Math.round(v) }))}
                    />
                    <SelectField
                      label="Étanchéité à l’air"
                      value={insOpts.airTightness ? "Oui" : "Non"}
                      onChange={(v) => setInsOpts((p) => ({ ...p, airTightness: v === "Oui" }))}
                      options={["Oui", "Non"]}
                    />
                    <SelectField
                      label="VMC"
                      value={insOpts.vmc}
                      onChange={(v) => setInsOpts((p) => ({ ...p, vmc: v as any }))}
                      options={["Aucune", "Simple flux", "Hygro B", "Double flux"]}
                    />
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                                        <button
                      type="button"
                      style={btnPrimaryStyle}
                      onClick={() => applyInsulationPackToRoom(selectedRoom.id)}
                    >
                      Appliquer au lot
                    </button>
                  </div>
                </div>

                <div style={packCardStyle}>
                  <div style={packTitleStyle}>Extérieurs (pack)</div>
                  <div style={packHintStyle}>Terrasse, clôtures, jardin, façade, toiture, peintures.</div>

                  <div style={packGridStyle}>
                    <NumberField
                      label="Terrasse (m²)"
                      value={extOpts.terraceM2}
                      onChange={(v) => setExtOpts((p) => ({ ...p, terraceM2: v }))}
                    />
                    <NumberField
                      label="Clôture (ml)"
                      value={extOpts.fencingML}
                      onChange={(v) => setExtOpts((p) => ({ ...p, fencingML: v }))}
                    />
                    <NumberField
                      label="Jardin (m²)"
                      value={extOpts.landscapingM2}
                      onChange={(v) => setExtOpts((p) => ({ ...p, landscapingM2: v }))}
                    />
                    <NumberField
                      label="Façade (m²)"
                      value={extOpts.facadeM2}
                      onChange={(v) => setExtOpts((p) => ({ ...p, facadeM2: v }))}
                    />
                    <SelectField
                      label="Révision toiture"
                      value={extOpts.roofRepair ? "Oui" : "Non"}
                      onChange={(v) => setExtOpts((p) => ({ ...p, roofRepair: v === "Oui" }))}
                      options={["Oui", "Non"]}
                    />
                    <SelectField
                      label="Peintures ext."
                      value={extOpts.exteriorPainting ? "Oui" : "Non"}
                      onChange={(v) =>
                        setExtOpts((p) => ({ ...p, exteriorPainting: v === "Oui" }))
                      }
                      options={["Oui", "Non"]}
                    />
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                    <button
                      type="button"
                      style={btnPrimaryStyle}
                      onClick={() => applyExteriorPackToRoom(selectedRoom.id)}
                    >
                      Appliquer au lot
                    </button>
                  </div>
                </div>
              </div>

              <div style={dividerStyle} />

              {/* Lignes par lots */}
              <h3 style={subTitleStyle}>Détail des travaux</h3>

              <div style={lotSummaryBarStyle}>
                <div style={lotSummaryTextStyle}>
                  Total pièce : <b>{eur(selectedTotal)}</b>
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    style={btnSecondaryStyle}
                    onClick={() => {
                      // petit helper : ajouter une ligne "électricité" rapide
                      addItem(selectedRoom.id);
                      const last = rooms.find((r) => r.id === selectedRoom.id);
                      // pas de mutation directe ici, on laisse l'utilisateur éditer la nouvelle ligne
                    }}
                  >
                    + Ligne rapide
                  </button>
                </div>
              </div>

              {lotOrder.map((lot) => {
                const items = lotsMap.get(lot) ?? [];
                if (items.length === 0) return null;

                const lotTotal = sumItems(items);

                return (
                  <div key={lot} style={lotBlockStyle}>
                    <div style={lotHeaderStyle}>
                      <div>
                        <div style={lotTitleStyle}>{lot}</div>
                        <div style={lotMetaStyle}>{items.length} ligne(s)</div>
                      </div>
                      <div style={lotTotalStyle}>{eur(lotTotal)}</div>
                    </div>

                    <div style={tableHeadStyle}>
                      <div style={colLotHeadStyle}>Intitulé</div>
                      <div style={colUnitHeadStyle}>Unité</div>
                      <div style={colQtyHeadStyle}>Qté</div>
                      <div style={colPriceHeadStyle}>PU</div>
                      <div style={colTotalHeadStyle}>Total</div>
                      <div style={colActionsHeadStyle}></div>
                    </div>

                    {items.map((it) => {
                      const lineTotal = (it.qty || 0) * (it.unitPrice || 0);
                      return (
                        <div key={it.id} style={rowStyle}>
                          <div style={colLotStyle}>
                            <input
                              style={inputInlineStyle}
                              value={it.label}
                              onChange={(e) =>
                                updateItem(selectedRoom.id, it.id, { label: e.target.value })
                              }
                            />
                            <input
                              style={{ ...inputInlineStyle, marginTop: 6 }}
                              value={it.description ?? ""}
                              onChange={(e) =>
                                updateItem(selectedRoom.id, it.id, { description: e.target.value })
                              }
                              placeholder="Description / hypothèse (optionnel)"
                            />
                            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
                              <label style={miniFieldStyle}>
                                <span style={miniLabelStyle}>Lot</span>
                                <select
                                  style={miniSelectStyle}
                                  value={it.lot}
                                  onChange={(e) =>
                                    updateItem(selectedRoom.id, it.id, { lot: e.target.value as WorkLot })
                                  }
                                >
                                  {lotOrder.map((l) => (
                                    <option key={l} value={l}>
                                      {l}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>
                          </div>

                          <div style={colUnitStyle}>
                            <select
                              style={miniSelectStyle}
                              value={it.unit}
                              onChange={(e) =>
                                updateItem(selectedRoom.id, it.id, { unit: e.target.value as PriceUnit })
                              }
                            >
                              {["forfait", "m²", "ml", "u", "point", "m3", "jour", "lot"].map((u) => (
                                <option key={u} value={u}>
                                  {u}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div style={colQtyStyle}>
                            <input
                              type="number"
                              step={it.unit === "m²" || it.unit === "ml" ? 0.1 : 1}
                              style={numberInlineStyle}
                              value={it.qty}
                              onChange={(e) =>
                                updateItem(selectedRoom.id, it.id, {
                                  qty: Number(e.target.value || 0),
                                })
                              }
                            />
                          </div>

                          <div style={colPriceStyle}>
                            <input
                              type="number"
                              step={10}
                              style={numberInlineStyle}
                              value={it.unitPrice}
                              onChange={(e) =>
                                updateItem(selectedRoom.id, it.id, {
                                  unitPrice: Number(e.target.value || 0),
                                })
                              }
                            />
                          </div>

                          <div style={colTotalStyle}>{eur(lineTotal)}</div>

                          <div style={colActionsStyle}>
                            <button
                              type="button"
                              style={tinyDangerBtnStyle}
                              onClick={() => deleteItem(selectedRoom.id, it.id)}
                            >
                              Suppr.
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              {selectedRoom.items.length === 0 && (
                <div style={emptyHintStyle}>
                  Aucune ligne dans cette pièce. Clique sur “+ Ligne” pour commencer.
                </div>
              )}
            </>
          ) : (
            <div style={emptyHintStyle}>Aucune pièce sélectionnée.</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BudgetTravaux;

// -----------------------------------------------------------------------------
// Small fields
// -----------------------------------------------------------------------------

const SelectField: React.FC<{
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}> = ({ label, value, options, onChange }) => {
  return (
    <label style={fieldStyle}>
      <div style={labelStyle}>{label}</div>
      <select style={inputStyle} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
};

const NumberField: React.FC<{
  label: string;
  value: number;
  step?: number;
  onChange: (v: number) => void;
}> = ({ label, value, step, onChange }) => {
  return (
    <label style={fieldStyle}>
      <div style={labelStyle}>{label}</div>
      <input
        type="number"
        step={step ?? 1}
        min={0}
        style={inputStyle}
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value || 0)))}
      />
    </label>
  );
};

// -----------------------------------------------------------------------------
// Styles
// -----------------------------------------------------------------------------

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  padding: "28px 18px",
  background: "linear-gradient(135deg, #f8fafc 0%, #ffffff 45%, #eef2ff 100%)",
  color: "#0f172a",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
};

const headerStyle: React.CSSProperties = {
  maxWidth: 1280,
  margin: "0 auto 18px auto",
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "space-between",
  gap: 16,
};

const headerRightStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "flex-end",
};

const kickerStyle: React.CSSProperties = {
  fontSize: 12,
  letterSpacing: 1.2,
  fontWeight: 800,
  color: "#64748b",
};

const titleStyle: React.CSSProperties = {
  fontSize: 30,
  lineHeight: 1.1,
  margin: "6px 0 6px 0",
};

const subtitleStyle: React.CSSProperties = {
  margin: 0,
  color: "#475569",
  maxWidth: 900,
};

const bigNumberCardStyle: React.CSSProperties = {
  background: "#ffffff",
  borderRadius: 14,
  border: "1px solid rgba(15,23,42,0.08)",
  boxShadow: "0 12px 35px rgba(2,6,23,0.06)",
  padding: 14,
  minWidth: 260,
};

const bigNumberLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 900,
  color: "#64748b",
};

const bigNumberValueStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 26,
  fontWeight: 950,
};

const bigNumberHintStyle: React.CSSProperties = {
  marginTop: 6,
  fontSize: 12,
  color: "#475569",
};

const mainGridStyle: React.CSSProperties = {
  maxWidth: 1280,
  margin: "0 auto",
  display: "grid",
  gridTemplateColumns: "0.44fr 0.56fr",
  gap: 16,
};

const cardStyle: React.CSSProperties = {
  background: "#ffffff",
  borderRadius: 14,
  border: "1px solid rgba(15, 23, 42, 0.08)",
  boxShadow: "0 12px 35px rgba(2, 6, 23, 0.06)",
  padding: 18,
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 900,
  margin: "0 0 12px 0",
};

const subTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 900,
  margin: "0 0 10px 0",
  color: "#334155",
};

const dividerStyle: React.CSSProperties = {
  margin: "14px 0",
  borderTop: "1px solid rgba(15, 23, 42, 0.08)",
};

const fieldStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  color: "#334155",
};

const inputStyle: React.CSSProperties = {
  height: 40,
  borderRadius: 10,
  border: "1px solid rgba(15, 23, 42, 0.12)",
  padding: "0 12px",
  outline: "none",
  background: "#ffffff",
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 78,
  resize: "vertical",
  borderRadius: 12,
  border: "1px solid rgba(15, 23, 42, 0.12)",
  padding: "10px 12px",
  outline: "none",
  background: "#ffffff",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  color: "#0f172a",
};

const actionsStyle: React.CSSProperties = {
  marginTop: 12,
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
};

const btnPrimaryStyle: React.CSSProperties = {
  height: 40,
  padding: "0 14px",
  borderRadius: 10,
  border: "1px solid rgba(2, 132, 199, 0.35)",
  background: "#0ea5e9",
  color: "#ffffff",
  fontWeight: 900,
  cursor: "pointer",
};

const btnSecondaryStyle: React.CSSProperties = {
  height: 40,
  padding: "0 14px",
  borderRadius: 10,
  border: "1px solid rgba(15, 23, 42, 0.12)",
  background: "#ffffff",
  color: "#0f172a",
  fontWeight: 900,
  cursor: "pointer",
};

const btnDangerStyle: React.CSSProperties = {
  height: 40,
  padding: "0 14px",
  borderRadius: 10,
  border: "1px solid rgba(239, 68, 68, 0.35)",
  background: "#fff1f2",
  color: "#7f1d1d",
  fontWeight: 900,
  cursor: "pointer",
};

const chipStyle: React.CSSProperties = {
  height: 40,
  display: "inline-flex",
  alignItems: "center",
  padding: "0 12px",
  borderRadius: 999,
  border: "1px solid rgba(15,23,42,0.12)",
  background: "#ffffff",
  fontWeight: 950,
};

const roomsListStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  marginTop: 10,
};

const roomRowStyle: React.CSSProperties = {
  textAlign: "left",
  padding: 12,
  borderRadius: 12,
  border: "1px solid rgba(15,23,42,0.10)",
  cursor: "pointer",
};

const roomNameStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 950,
};

const roomMetaStyle: React.CSSProperties = {
  marginTop: 4,
  fontSize: 12,
  color: "#64748b",
  fontWeight: 800,
};

const roomTotalStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 950,
  color: "#0f172a",
  whiteSpace: "nowrap",
};

const imprevusRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: 10,
};

const formGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: 10,
};

const roomHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
};

const roomBasicsGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr 1fr",
  gap: 10,
};

const packsGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: 12,
};

const packCardStyle: React.CSSProperties = {
  borderRadius: 14,
  border: "1px solid rgba(15,23,42,0.08)",
  background: "#ffffff",
  padding: 14,
  boxShadow: "0 10px 26px rgba(2, 6, 23, 0.04)",
};

const packTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 950,
  color: "#0f172a",
};

const packHintStyle: React.CSSProperties = {
  marginTop: 4,
  fontSize: 12,
  color: "#64748b",
};

const packGridStyle: React.CSSProperties = {
  marginTop: 10,
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 10,
};

const lotSummaryBarStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "center",
  padding: 12,
  borderRadius: 12,
  background: "#f8fafc",
  border: "1px solid rgba(15,23,42,0.06)",
  marginBottom: 10,
};

const lotSummaryTextStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#334155",
};

const lotBlockStyle: React.CSSProperties = {
  marginTop: 12,
  borderRadius: 14,
  border: "1px solid rgba(15,23,42,0.08)",
  overflow: "hidden",
};

const lotHeaderStyle: React.CSSProperties = {
  padding: 12,
  background: "linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
};

const lotTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 950,
};

const lotMetaStyle: React.CSSProperties = {
  marginTop: 2,
  fontSize: 12,
  color: "#64748b",
  fontWeight: 800,
};

const lotTotalStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 950,
  whiteSpace: "nowrap",
};

const tableHeadStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 110px 90px 120px 120px 80px",
  gap: 10,
  padding: "10px 12px",
  background: "#f1f5f9",
  borderTop: "1px solid rgba(15,23,42,0.08)",
  fontSize: 12,
  fontWeight: 900,
  color: "#334155",
};

const colLotHeadStyle: React.CSSProperties = {};
const colUnitHeadStyle: React.CSSProperties = { textAlign: "left" };
const colQtyHeadStyle: React.CSSProperties = { textAlign: "left" };
const colPriceHeadStyle: React.CSSProperties = { textAlign: "left" };
const colTotalHeadStyle: React.CSSProperties = { textAlign: "left" };
const colActionsHeadStyle: React.CSSProperties = { textAlign: "right" };

const rowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 110px 90px 120px 120px 80px",
  gap: 10,
  padding: "10px 12px",
  borderTop: "1px solid rgba(15,23,42,0.06)",
  alignItems: "start",
};

const colLotStyle: React.CSSProperties = {};
const colUnitStyle: React.CSSProperties = {};
const colQtyStyle: React.CSSProperties = {};
const colPriceStyle: React.CSSProperties = {};
const colTotalStyle: React.CSSProperties = {
  fontWeight: 950,
  paddingTop: 8,
  whiteSpace: "nowrap",
};
const colActionsStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  paddingTop: 6,
};

const inputInlineStyle: React.CSSProperties = {
  width: "100%",
  borderRadius: 10,
  border: "1px solid rgba(15, 23, 42, 0.12)",
  padding: "8px 10px",
  outline: "none",
  background: "#ffffff",
  fontSize: 12,
};

const numberInlineStyle: React.CSSProperties = {
  width: "100%",
  height: 36,
  borderRadius: 10,
  border: "1px solid rgba(15, 23, 42, 0.12)",
  padding: "0 10px",
  outline: "none",
  background: "#ffffff",
  fontSize: 12,
};

const miniFieldStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const miniLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 900,
  color: "#64748b",
};

const miniSelectStyle: React.CSSProperties = {
  height: 34,
  borderRadius: 10,
  border: "1px solid rgba(15, 23, 42, 0.12)",
  padding: "0 10px",
  outline: "none",
  background: "#ffffff",
  fontSize: 12,
  fontWeight: 800,
  color: "#0f172a",
};

const tinyDangerBtnStyle: React.CSSProperties = {
  height: 34,
  padding: "0 10px",
  borderRadius: 10,
  border: "1px solid rgba(239, 68, 68, 0.35)",
  background: "#fff1f2",
  color: "#7f1d1d",
  fontWeight: 900,
  cursor: "pointer",
};

const emptyHintStyle: React.CSSProperties = {
  marginTop: 12,
  padding: 12,
  borderRadius: 12,
  border: "1px dashed rgba(15,23,42,0.18)",
  color: "#475569",
  background: "#f8fafc",
};


