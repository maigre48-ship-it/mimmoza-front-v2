import ts from "typescript";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir) {
  let out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out = out.concat(walk(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk("src");
const fmt = { indentSize: 2, tabSize: 2, newLineCharacter: "\n", convertTabsToSpaces: true, insertSpaceAfterCommaDelimiter: true };

let modified = 0;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const services = ts.createLanguageService({
    getCompilationSettings: () => ({ jsx: ts.JsxEmit.ReactJSX, allowImportingTsExtensions: true, target: ts.ScriptTarget.ES2022 }),
    getScriptFileNames: () => [file],
    getScriptVersion: () => "1",
    getScriptSnapshot: (f) => ts.ScriptSnapshot.fromString(f === file ? text : readFileSync(f, "utf8")),
    getCurrentDirectory: () => process.cwd(),
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: ts.sys.fileExists, readFile: ts.sys.readFile, readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists, getDirectories: ts.sys.getDirectories,
  });
  const edits = services.organizeImports({ type: "file", fileName: file }, fmt, {});
  let out = text;
  for (const fe of edits) {
    const sorted = [...fe.textChanges].sort((a, b) => b.span.start - a.span.start);
    for (const c of sorted) out = out.slice(0, c.span.start) + c.newText + out.slice(c.span.start + c.span.length);
  }
  if (out !== text) { writeFileSync(file, out, "utf8"); modified++; }
}
console.log("Fichiers modifiés:", modified, "/", files.length);
