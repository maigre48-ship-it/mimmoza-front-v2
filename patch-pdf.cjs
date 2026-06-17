const fs = require("fs");
const FILE = "src/spaces/promoteur/services/exportPromoteurPdf.ts";
let src = fs.readFileSync(FILE, "utf8");
const before = src.length;

function removeFunction(text, name) {
  const re = new RegExp("\\nfunction " + name + "\\b");
  const m = re.exec(text);
  if (!m) { console.warn("  [skip] introuvable: " + name); return text; }
  const start = m.index;
  let i = text.indexOf("{", start), depth = 0;
  for (; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  let end = i;
  while (end < text.length && /\s/.test(text[end])) end++;
  console.log("  [ok] fonction " + name);
  return text.slice(0, start) + "\n" + text.slice(end);
}
function removeLineContaining(text, needle) {
  const lines = text.split("\n");
  const idx = lines.findIndex(l => l.includes(needle));
  if (idx < 0) { console.warn("  [skip] ligne: " + needle); return text; }
  console.log("  [ok] ligne " + (idx+1) + " : " + lines[idx].trim().slice(0,50));
  lines.splice(idx, 1);
  return lines.join("\n");
}

for (const fn of ["secTitle","subTitle","body","rule","alertBanner","kpiGrid",
                  "scoreLine","drawRibbon","drawMimmozaCube","drawCalendarIcon","rgba"]) {
  src = removeFunction(src, fn);
}
src = removeLineContaining(src, "const right =");
src = removeLineContaining(src, "const footerY =");

const oldRow = "`Projet: ${s(c.valeurProjet ?? 'N/A')} | PLU: ${s(c.valeurPlu ?? 'N/A')}`";
const newRow = "`${s(c.libelle)} : ${s(String(c.valeur ?? c.detail ?? 'N/A'))}`";
if (src.includes(oldRow)) { src = src.replace(oldRow, newRow); console.log("  [ok] contraintes PLU -> valeur/detail"); }
else console.warn("  [skip] motif valeurProjet/valeurPlu introuvable");

fs.writeFileSync(FILE, src, "utf8");
console.log("Termine. " + before + " -> " + src.length + " car.");
