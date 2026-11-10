// =============================================================
// interior-architect-v1 — Architecte d'intérieur Mimmoza (lot INT-10)
// =============================================================
// POST { plan: PlanInput | description: string | roomPlan, brief, seed?, variants? }
//   → { status, variantes: [{ layout, rapport, feuilleDeStyle, pointsEauSupposes, … }], resumeTexte, synthese, … }
//
// AUTONOME : aucun import _shared, aucune dépendance réseau dans le calcul.
// Moteur : copie figée de @mimmoza/interior-core 0.3.0 dans ./moteur (INT-10b ;
// voir moteur/VERSION.md : empreintes sha256). Point d'entrée utilisé : amenager.
// Imports : import map ./deno.json (zod → npm:zod@3 ; chemins sans extension du
// moteur → fichiers .ts), la copie du moteur n'est PAS modifiée.
//
// Appelée par copilot-chat (outil amenager_interieur, secret COPILOT_FN_INTERIOR)
// avec la clé secrète, ou par le front avec le JWT de l'utilisateur.
// Détails : README.md.
// =============================================================

import { creerHandler } from './handler.ts';

Deno.serve(creerHandler({ env: Deno.env }));
