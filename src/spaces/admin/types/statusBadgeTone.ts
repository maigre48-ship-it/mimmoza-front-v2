// src/spaces/admin/types/statusBadgeTone.ts
// Réplique locale du type de tons accepté par <StatusBadge> (voir
// src/spaces/admin/components/StatusBadge.tsx). Dupliqué volontairement pour ne
// pas modifier le composant existant (hors périmètre du module Agent commercial).
export type StatusBadgeTone =
  | "emerald"
  | "amber"
  | "rose"
  | "slate"
  | "sky"
  | "violet";
