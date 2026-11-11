// supabase/functions/photo-rue-couverture/index.ts
// LOT P2 (11/11/2026) — couverture Panoramax d'une parcelle, en lecture seule. Traitement : traitement.ts (testé).
import { traiter } from './traitement.ts';

Deno.serve((req) => traiter(req));
