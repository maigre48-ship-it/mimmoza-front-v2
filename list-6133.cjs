const fs = require("fs");
const src = fs.readFileSync(process.argv[2] || "tsc-after.txt", "utf8").split(/\r?\n/);
const re = /^(.+\.tsx?)\((\d+),(\d+)\): error TS6133: '([^']+)' is declared/;
const rows = [];
for (const l of src) {
  const m = l.match(re);
  if (m) rows.push({ file: m[1], line: +m[2], name: m[4] });
}
// Pour distinguer import vs var, il faudrait lire chaque fichier ; ici on classe par heuristique de nom
const imports = [], vars = [];
for (const r of rows) {
  // heuristique : on ne peut pas savoir sans lire le fichier, donc on groupe par fichier
  vars.push(r);
}
const byFile = new Map();
for (const r of rows) {
  if (!byFile.has(r.file)) byFile.set(r.file, []);
  byFile.get(r.file).push(`L${r.line} ${r.name}`);
}
console.log(`\n${rows.length} TS6133 dans ${byFile.size} fichiers:\n`);
for (const [f, names] of [...byFile].sort((a,b)=>b[1].length-a[1].length)) {
  console.log(`${f}`);
  for (const n of names) console.log(`    ${n}`);
}
