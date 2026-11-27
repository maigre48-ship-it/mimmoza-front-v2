// VIS-70 — outil de mise au point : affiche les atouts assemblés sur le jeu Paris (npx tsx src/lib/quartier/__fixtures__/afficherAtouts.ts).
import { assemblerAtouts, lieuxDepuisBpe, lieuxDepuisMobilite } from '../atoutsQuartier.ts';
import * as F from './quartierFixtures.ts';
const a = assemblerAtouts(F.PARIS, [...lieuxDepuisBpe(F.BPE_PARIS), ...lieuxDepuisMobilite(F.MOBILITE_PARIS)], [{source:'bpe',ok:true},{source:'mobilite',ok:true}]);
for (const c of a.categories) console.log(c.id, c.etat, c.lieux.map(l=>`${l.nom}|${l.sousType}|${l.distance_m}|${l.pied_min}`).join(' ; '));
console.log(a.synthese);
