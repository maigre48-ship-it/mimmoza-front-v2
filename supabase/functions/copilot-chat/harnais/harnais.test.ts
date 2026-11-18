// supabase/functions/copilot-chat/harnais/harnais.test.ts
// Harnais de bout en bout des parcours du chat, en tests Deno (une étape par contrôle).
//   npx deno test --no-lock --no-check --no-config -A --node-modules-dir=none supabase/functions/copilot-chat/harnais/
import { SCENARIOS, jouerScenario } from './scenarios.ts';

for (const s of SCENARIOS) {
  Deno.test(`HARNAIS ${s.id} — ${s.titre}`, async (t) => {
    const j = await jouerScenario(s);
    for (const e of j.etapes) {
      await t.step(e.nom, () => { if (!e.ok) throw new Error(e.detail || 'échec'); });
    }
  });
}
