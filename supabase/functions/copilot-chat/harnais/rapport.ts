// supabase/functions/copilot-chat/harnais/rapport.ts
// Lance tous les scénarios du harnais et écrit un rapport lisible (OK / ÉCHEC par étape). Code de sortie 1 si un échec.
//   npx deno run --no-lock --no-check --no-config -A --node-modules-dir=none supabase/functions/copilot-chat/harnais/rapport.ts [S1 S3 …]
import { SCENARIOS, jouerScenario } from './scenarios.ts';

const choix = Deno.args.filter((a) => /^S\d+$/i.test(a)).map((a) => a.toUpperCase());
const aJouer = choix.length ? SCENARIOS.filter((s) => choix.includes(s.id)) : SCENARIOS;
const lignes: string[] = [`Harnais de bout en bout des parcours du chat — ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC`, ''];
let ok = 0, ko = 0;
const remarques: string[] = [];
for (const s of aJouer) {
  const j = await jouerScenario(s);
  const echecs = j.etapes.filter((e) => !e.ok);
  lignes.push(`${echecs.length ? 'ÉCHEC' : 'OK   '}  ${s.id} — ${s.titre} (${j.etapes.length - echecs.length}/${j.etapes.length} étapes)`);
  for (const e of j.etapes) {
    if (e.ok) { ok += 1; lignes.push(`         ok     ${e.nom}`); }
    else { ko += 1; lignes.push(`         ÉCHEC  ${e.nom}`); for (const d of e.detail.split('\n')) lignes.push(`                  ${d}`); }
  }
  remarques.push(...j.remarques);
  lignes.push('');
}
lignes.push(`Total : ${ok} étape(s) OK, ${ko} en échec, sur ${aJouer.length} scénario(s).`);
if (remarques.length) { lignes.push('', 'Remarques (pas des échecs) :'); for (const r of remarques) lignes.push(`  - ${r}`); }
console.log(lignes.join('\n'));
const sortie = Deno.env.get('HARNAIS_RAPPORT');
if (sortie) Deno.writeTextFileSync(sortie, lignes.join('\n') + '\n');
Deno.exit(ko ? 1 : 0);
