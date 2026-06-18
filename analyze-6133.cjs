const fs = require("fs");
const lines = fs.readFileSync(process.argv[2] || "tsc-after.txt", "utf8").split(/\r?\n/);
const re = /^(.+\.tsx?)\((\d+),(\d+)\): error (TS\d+):/;
const byFile = new Map();
for (const l of lines) {
  const m = l.match(re);
  if (!m) continue;
  const [, file, , , code] = m;
  if (!byFile.has(file)) byFile.set(file, []);
  byFile.get(file).push(code);
}
const only6133 = [];
const mostly6133 = [];
for (const [file, codes] of byFile) {
  const n6133 = codes.filter(c => c === "TS6133").length;
  if (n6133 === 0) continue;
  if (n6133 === codes.length) only6133.push([file, codes.length]);
  else mostly6133.push([file, n6133, codes.length]);
}
only6133.sort((a, b) => b[1] - a[1]);
console.log(`\n=== Fichiers UNIQUEMENT TS6133 (${only6133.length} fichiers, purge sans risque) ===`);
let total = 0;
for (const [f, n] of only6133) { console.log(`  ${String(n).padStart(2)}  ${f}`); total += n; }
console.log(`  -> ${total} erreurs TS6133 purgeables d'un coup`);
console.log(`\n=== Fichiers AVEC TS6133 + autres (traiter le 6133 en passant) ===`);
mostly6133.sort((a, b) => b[1] - a[1]);
for (const [f, n, tot] of mostly6133.slice(0, 20)) console.log(`  ${String(n).padStart(2)}/${tot}  ${f}`);
