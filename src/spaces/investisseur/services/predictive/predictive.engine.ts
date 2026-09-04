// ──────────────────────────────────────────────────────────────────────────────
// predictive.engine.ts — RÉEXPORT du moteur partagé
// ──────────────────────────────────────────────────────────────────────────────
//
// Le moteur (967 lignes de calcul pur) vit désormais dans
//   supabase/functions/_shared/predictive/engine.ts
//
// Pourquoi il a déménagé
// ----------------------
// Il tourne maintenant des DEUX côtés :
//   • ici, sur la page Analyse prédictive de l'espace investisseur ;
//   • dans copilot-chat, pour que le copilote puisse produire une projection
//     à la demande au lieu d'attendre que le front lui en tende une.
//
// Le garder en double aurait garanti la divergence : deux projections
// différentes pour le même bien selon qu'on la demande à l'écran ou au chat.
// C'est précisément le défaut qu'on a passé du temps à éliminer ailleurs.
//
// Le moteur est du calcul pur — aucune dépendance au navigateur, aucun accès
// réseau — donc il tourne à l'identique sous Vite et sous Deno.
//
// ⚠️ Toute modification des formules se fait dans le fichier partagé.
// ──────────────────────────────────────────────────────────────────────────────

export { computePredictiveSnapshot } from "@shared/predictive/engine.ts";
