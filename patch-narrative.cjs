const fs = require("fs");
const FILE = "src/spaces/promoteur/services/promoteurPdf.narrative.ts";
let src = fs.readFileSync(FILE, "utf8");

const a = "  original: 'CONFIRME' | 'SOUS_RESERVE' | 'IMPOSSIBLE',";
const aN = "  original: 'CONFIRME' | 'SOUS_RESERVE' | 'IMPOSSIBLE' | 'NON_DETERMINABLE',";
const b = "): 'CONFIRME' | 'SOUS_RESERVE' | 'IMPOSSIBLE' {";
const bN = "): 'CONFIRME' | 'SOUS_RESERVE' | 'IMPOSSIBLE' | 'NON_DETERMINABLE' {";

let n = 0;
if (src.includes(a)) { src = src.replace(a, aN); n++; }
if (src.includes(b)) { src = src.replace(b, bN); n++; }
fs.writeFileSync(FILE, src, "utf8");
console.log(n === 2 ? "OK : signature elargie (param + retour)." : "ATTENTION : " + n + "/2 remplacements. Verifier manuellement.");
