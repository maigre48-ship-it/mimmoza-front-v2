const fs = require("fs");
const inFile = process.argv[2] || "tsc-after.txt";
const raw = fs.readFileSync(inFile).filter(b => b !== 0x00).toString("utf8").replace(/^\uFEFF/, "");
const DANGEROUS = new Set(["TS18048","TS18047","TS2531","TS2532","TS2533","TS2339","TS2551","TS2353","TS2322","TS2345"]);
const COSMETIC = new Set(["TS6133","TS6196","TS7006","TS7031","TS7053","TS1484"]);
const CALC = /(mapper|export|pdf|excel|xlsx|score|rentab|bilan|engine|moteur|calc|compute|snapshot|generat|build|service|\.utils|prorata|fiscal|dscr|irr|npv|stress|absorption|dvf)/i;
const DISPLAY = /(Page|Panel|Card|View|Modal|Chart|Banner|Shell|components|\.tsx$)/;
function zone(f){ if(CALC.test(f))return "CALC/GEN"; if(DISPLAY.test(f))return "AFFICHAGE"; return "?"; }
const lineRe = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):/;
const files = new Map(); let totalErr = 0; const codeTotals = new Map();
for (const line of raw.split(/\r?\n/)) {
  const m = lineRe.exec(line.trim()); if(!m) continue;
  const [,file,,,code]=m; totalErr++; codeTotals.set(code,(codeTotals.get(code)||0)+1);
  if(!files.has(file)) files.set(file,{total:0,dangerous:0,cosmetic:0,other:0,codes:new Map()});
  const e=files.get(file); e.total++; e.codes.set(code,(e.codes.get(code)||0)+1);
  if(DANGEROUS.has(code))e.dangerous++; else if(COSMETIC.has(code))e.cosmetic++; else e.other++;
}
let dTot=0,cTot=0,oTot=0; for(const e of files.values()){dTot+=e.dangerous;cTot+=e.cosmetic;oTot+=e.other;}
const ranked=[...files.entries()].sort((a,b)=> b[1].dangerous!==a[1].dangerous ? b[1].dangerous-a[1].dangerous : b[1].total-a[1].total);
const fmtCodes=(codes)=>[...codes.entries()].sort((a,b)=>b[1]-a[1]).map(([c,n])=>c+"x"+n).join(" ");
console.log("\nTotal erreurs comptees : "+totalErr);
console.log("  Dangereuses : "+dTot+"  |  Cosmetiques : "+cTot+"  |  Autres : "+oTot+"\n");
console.log("Codes les plus frequents :");
[...codeTotals.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12).forEach(([c,n])=>{
  const tag=DANGEROUS.has(c)?"DANGER":COSMETIC.has(c)?"cosmetique":"autre";
  console.log("  "+c.padEnd(8)+String(n).padStart(4)+"  "+tag);
});
console.log("\nTop 25 fichiers par erreurs dangereuses :");
console.log("DANG  TOTAL  ZONE       FICHIER");
ranked.slice(0,25).forEach(([f,e])=>console.log(String(e.dangerous).padStart(4)+"  "+String(e.total).padStart(5)+"  "+zone(f).padEnd(9)+"  "+f));
let md="# Carte du risque tsc\n\nTotal : "+totalErr+" - Dangereuses : "+dTot+", Cosmetiques : "+cTot+", Autres : "+oTot+"\n\n## Fichiers (tries par erreurs dangereuses)\n\n| Dang | Total | Zone | Fichier | Codes |\n|---:|---:|---|---|---|\n";
for(const [f,e] of ranked) md+="| "+e.dangerous+" | "+e.total+" | "+zone(f)+" | "+f+" | "+fmtCodes(e.codes)+" |\n";
fs.writeFileSync("risk-map.md", md, "utf8");
console.log("\n-> Detail complet ecrit dans risk-map.md ("+files.size+" fichiers)");
