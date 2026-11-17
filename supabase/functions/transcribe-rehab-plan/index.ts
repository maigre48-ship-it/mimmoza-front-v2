// supabase/functions/transcribe-rehab-plan/index.ts
// LOT F5 (17/11/2026) — RETIRÉE : la transcription de plans par gpt-4o est remplacée par la lecture de plan du Studio
// (calcul local, gratuit). La fonction reste déployée et répond 410 avec un message clair ; aucun appel au modèle, aucun
// jeton débité. Ancien code : historique git (commit précédant le lot F5).
import { reponseRetrait } from '../_shared/retraitLecturePlan.ts';

Deno.serve(reponseRetrait);
