// src/spaces/investisseur/services/travauxPricing.config.ts
import type { LotPricing } from "../shared/travauxSimulation.types";

export const TRAVAUX_PRICING_V1: { version: 1; lots: LotPricing[] } = {
  version: 1,
  lots: [
    {
      code: "prelim",
      label: "Préliminaires & finitions de chantier",
      items: [
        {
          code: "prelim_protection",
          label: "Protection chantier (sols, parties communes)",
          unit: "forfait",
          prices: { eco: 300, standard: 450, premium: 700 },
          tags: ["risque"],
          riskFlags: ["copro_validation"],
        },
        {
          code: "prelim_nettoyage",
          label: "Nettoyage fin de chantier",
          unit: "forfait",
          prices: { eco: 250, standard: 400, premium: 650 },
        },
      ],
    },

    {
      code: "demolition",
      label: "Dépose / Casse / Curage",
      items: [
        {
          code: "demol_depose_sols",
          label: "Dépose revêtements de sol (dépose + manutention)",
          unit: "m2",
          prices: { eco: 10, standard: 15, premium: 22 },
          tags: ["demolition"],
        },
        {
          code: "demol_depose_faience_sanitaires",
          label: "Dépose faïence + sanitaires (SDB/WC)",
          unit: "forfait",
          prices: { eco: 600, standard: 900, premium: 1400 },
          tags: ["demolition"],
        },
        {
          code: "demol_depose_cuisine",
          label: "Dépose cuisine (meubles + électroménager si présent)",
          unit: "forfait",
          prices: { eco: 350, standard: 600, premium: 900 },
          tags: ["demolition"],
        },
        {
          code: "demol_depose_cloisons",
          label: "Dépose cloisons non porteuses",
          unit: "m2",
          prices: { eco: 25, standard: 35, premium: 50 },
          tags: ["demolition", "risque"],
          riskFlags: ["porteur_risque", "copro_validation"],
        },
        {
          code: "demol_curage_complet",
          label: "Curage complet (appartement mis à nu)",
          unit: "m2",
          prices: { eco: 45, standard: 65, premium: 95 },
          tags: ["demolition", "risque"],
          riskFlags: ["amiante_suspect", "copro_validation"],
        },
      ],
    },

    {
      code: "gravats",
      label: "Évacuation gravats & logistique",
      items: [
        {
          code: "gravats_evacuation",
          label: "Évacuation gravats (mise en sacs + manutention)",
          unit: "m2",
          prices: { eco: 15, standard: 25, premium: 38 },
          tags: ["gravats", "risque"],
          riskFlags: ["copro_validation"],
        },
        {
          code: "gravats_benne",
          label: "Benne / évacuation externe (si nécessaire)",
          unit: "forfait",
          prices: { eco: 550, standard: 800, premium: 1100 },
          tags: ["gravats"],
          riskFlags: ["copro_validation"],
        },
      ],
    },

    {
      code: "maconnerie",
      label: "Maçonnerie légère / supports / Placo",
      items: [
        {
          code: "macon_ragreage",
          label: "Ragréage sol (préparation support)",
          unit: "m2",
          prices: { eco: 18, standard: 25, premium: 35 },
          tags: ["sol"],
        },
        {
          code: "macon_reprises_supports",
          label: "Reprises supports (rebouchage, enduits localisés)",
          unit: "m2",
          prices: { eco: 10, standard: 16, premium: 24 },
          tags: ["mur"],
        },
        {
          code: "macon_cloisons_placo",
          label: "Création cloisons placo (hors peinture)",
          unit: "m2",
          prices: { eco: 55, standard: 80, premium: 120 },
          tags: ["mur"],
        },
        {
          code: "macon_doublage",
          label: "Doublage (hors isolation spécifique)",
          unit: "m2",
          prices: { eco: 30, standard: 45, premium: 70 },
          tags: ["mur"],
        },
      ],
    },

    {
      code: "isolation_thermique",
      label: "Isolation thermique",
      items: [
        {
          code: "isol_th_murs",
          label: "Isolation thermique murs (doublage isolant)",
          unit: "m2",
          prices: { eco: 55, standard: 80, premium: 120 },
          tags: ["thermique"],
        },
        {
          code: "isol_th_plafond",
          label: "Isolation thermique plafond",
          unit: "m2",
          prices: { eco: 45, standard: 70, premium: 110 },
          tags: ["thermique"],
        },
        {
          code: "isol_th_sol_sous_couche",
          label: "Sous-couche isolante sol (thermique)",
          unit: "m2",
          prices: { eco: 12, standard: 18, premium: 28 },
          tags: ["thermique", "sol"],
        },
      ],
    },

    {
      code: "isolation_phonique",
      label: "Isolation phonique",
      items: [
        {
          code: "isol_ph_murs_mitoyens",
          label: "Doublage acoustique (murs mitoyens)",
          unit: "m2",
          prices: { eco: 70, standard: 110, premium: 160 },
          tags: ["phonique"],
        },
        {
          code: "isol_ph_plafond",
          label: "Plafond acoustique",
          unit: "m2",
          prices: { eco: 60, standard: 95, premium: 140 },
          tags: ["phonique"],
        },
        {
          code: "isol_ph_sous_couche",
          label: "Sous-couche acoustique sol",
          unit: "m2",
          prices: { eco: 18, standard: 28, premium: 45 },
          tags: ["phonique", "sol"],
        },
        {
          code: "isol_ph_portes_isophoniques",
          label: "Portes isophoniques (surcoût)",
          unit: "u",
          prices: { eco: 250, standard: 420, premium: 680 },
          tags: ["phonique", "menuiserie"],
        },
      ],
    },

    {
      code: "plomberie",
      label: "Plomberie",
      items: [
        {
          code: "plomb_reseau_partiel",
          label: "Plomberie (partielle) – reprises / adaptations",
          unit: "forfait",
          prices: { eco: 900, standard: 1400, premium: 2200 },
          tags: ["plomberie"],
        },
        {
          code: "plomb_reseau_complet",
          label: "Plomberie (réseau complet) – logement",
          unit: "m2",
          prices: { eco: 45, standard: 70, premium: 105 },
          tags: ["plomberie", "risque"],
          riskFlags: ["plomberie_colonne"],
        },
        {
          code: "plomb_deplacement_points_eau",
          label: "Déplacement point d’eau (arrivée + évacuation)",
          unit: "u",
          prices: { eco: 250, standard: 380, premium: 600 },
          tags: ["plomberie", "risque"],
          riskFlags: ["plomberie_colonne"],
        },
        {
          code: "plomb_chauffe_eau",
          label: "Chauffe-eau / ballon ECS (fourniture + pose)",
          unit: "u",
          prices: { eco: 650, standard: 900, premium: 1400 },
          tags: ["plomberie"],
        },
      ],
    },

    {
      code: "electricite",
      label: "Électricité",
      items: [
        {
          code: "elec_mise_aux_normes_partielle",
          label: "Électricité (partielle) – mise aux normes / ajouts",
          unit: "m2",
          prices: { eco: 25, standard: 40, premium: 60 },
          tags: ["electricite", "risque"],
          riskFlags: ["electricite_normes"],
        },
        {
          code: "elec_reseau_complet",
          label: "Électricité (réseau complet) – logement",
          unit: "m2",
          prices: { eco: 70, standard: 105, premium: 150 },
          tags: ["electricite", "risque"],
          riskFlags: ["electricite_normes"],
        },
        {
          code: "elec_tableau",
          label: "Tableau électrique (fourniture + pose)",
          unit: "u",
          prices: { eco: 650, standard: 950, premium: 1500 },
          tags: ["electricite"],
        },
        {
          code: "elec_spots",
          label: "Spots encastrés (fourniture + pose)",
          unit: "u",
          prices: { eco: 45, standard: 70, premium: 120 },
          tags: ["electricite"],
        },
        {
          code: "elec_rj45",
          label: "Prise RJ45 (fourniture + pose)",
          unit: "u",
          prices: { eco: 60, standard: 95, premium: 150 },
          tags: ["electricite"],
        },
      ],
    },

    {
      code: "ventilation_chauffage",
      label: "Ventilation / Chauffage",
      items: [
        {
          code: "vent_vmc",
          label: "VMC (simple flux / hygro B selon gamme)",
          unit: "u",
          prices: { eco: 650, standard: 1100, premium: 1800 },
          tags: ["ventilation"],
        },
        {
          code: "chauff_radiateurs",
          label: "Radiateur (fourniture + pose)",
          unit: "u",
          prices: { eco: 220, standard: 380, premium: 650 },
          tags: ["chauffage"],
        },
        {
          code: "chauff_seche_serviette",
          label: "Sèche-serviette (fourniture + pose)",
          unit: "u",
          prices: { eco: 220, standard: 350, premium: 550 },
          tags: ["chauffage"],
        },
      ],
    },

    {
      code: "menuiseries",
      label: "Menuiseries",
      items: [
        {
          code: "menuis_portes_int",
          label: "Portes intérieures (bloc-porte + pose)",
          unit: "u",
          prices: { eco: 180, standard: 320, premium: 650 },
          tags: ["menuiserie"],
        },
        {
          code: "menuis_fenetres",
          label: "Fenêtre (fourniture + pose) – moyenne",
          unit: "u",
          prices: { eco: 450, standard: 750, premium: 1200 },
          tags: ["menuiserie"],
        },
        {
          code: "menuis_placards",
          label: "Placards / rangements (linéaire)",
          unit: "ml",
          prices: { eco: 220, standard: 420, premium: 850 },
          tags: ["menuiserie"],
        },
      ],
    },

    {
      code: "sols",
      label: "Revêtements de sols",
      items: [
        {
          code: "sol_parquet",
          label: "Parquet (fourniture + pose)",
          unit: "m2",
          prices: { eco: 45, standard: 75, premium: 130 },
          tags: ["sol"],
          variants: [
            { code: "stratifie", label: "Stratifié", prices: { eco: 35, standard: 55, premium: 85 } },
            { code: "contrecollé", label: "Contrecollé", prices: { eco: 55, standard: 85, premium: 140 } },
            { code: "massif", label: "Massif", prices: { eco: 85, standard: 135, premium: 220 } },
          ],
        },
        {
          code: "sol_carrelage",
          label: "Carrelage (fourniture + pose)",
          unit: "m2",
          prices: { eco: 55, standard: 85, premium: 150 },
          tags: ["sol"],
        },
        {
          code: "sol_plinthes",
          label: "Plinthes (fourniture + pose)",
          unit: "ml",
          prices: { eco: 6, standard: 9, premium: 16 },
          tags: ["sol"],
        },
      ],
    },

    {
      code: "murs_peinture",
      label: "Murs / Peinture / Faïence",
      items: [
        {
          code: "mur_peinture_simple",
          label: "Peinture (prépa simple + 2 couches)",
          unit: "m2",
          prices: { eco: 22, standard: 32, premium: 46 },
          tags: ["mur"],
        },
        {
          code: "mur_ratissage_complet",
          label: "Ratissage complet + peinture (qualité premium)",
          unit: "m2",
          prices: { eco: 35, standard: 48, premium: 68 },
          tags: ["mur"],
        },
        {
          code: "mur_faience",
          label: "Faïence (fourniture + pose)",
          unit: "m2",
          prices: { eco: 55, standard: 85, premium: 150 },
          tags: ["mur", "sdb"],
        },
      ],
    },

    {
      code: "cuisine",
      label: "Cuisine",
      items: [
        {
          code: "cuisine_pack",
          label: "Pack cuisine (meubles + plan + évier) — hors électroménager",
          unit: "forfait",
          prices: { eco: 4500, standard: 9500, premium: 18000 },
          tags: ["cuisine"],
        },
        {
          code: "cuisine_pose",
          label: "Pose cuisine (main d’œuvre)",
          unit: "forfait",
          prices: { eco: 800, standard: 1300, premium: 2200 },
          tags: ["cuisine"],
        },
      ],
    },

    {
      code: "sdb",
      label: "Salle de bain",
      items: [
        {
          code: "sdb_pack",
          label: "Pack SDB complet (douche/baignoire, meuble, robinetterie, pose)",
          unit: "forfait",
          prices: { eco: 6500, standard: 10500, premium: 18500 },
          tags: ["sdb"],
        },
        {
          code: "sdb_spec_etancheite",
          label: "Étanchéité SPEC (zones humides)",
          unit: "forfait",
          prices: { eco: 350, standard: 550, premium: 900 },
          tags: ["sdb"],
        },
      ],
    },

    {
      code: "divers",
      label: "Divers / risques",
      items: [
        {
          code: "divers_humidite",
          label: "Traitement humidité / moisissures (forfait)",
          unit: "forfait",
          prices: { eco: 450, standard: 900, premium: 1800 },
          tags: ["risque"],
        },
        {
          code: "divers_petites_reparations",
          label: "Petites réparations / aléas (forfait)",
          unit: "forfait",
          prices: { eco: 300, standard: 600, premium: 1200 },
          tags: ["risque"],
        },
      ],
    },

    {
      code: "honoraires",
      label: "Honoraires (option)",
      items: [
        {
          code: "honoraires_moe_pct",
          label: "Maîtrise d’œuvre (MOE) — % du total travaux",
          unit: "pct",
          prices: { eco: 0.07, standard: 0.09, premium: 0.12 }, // 7% / 9% / 12%
          tags: ["moe"],
        },
      ],
    },
  ],
};