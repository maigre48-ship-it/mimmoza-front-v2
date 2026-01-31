import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const toolRoot = path.resolve(process.cwd(), "tools", "ai-orchestrator");

function read(p){ return fs.readFileSync(p,"utf8"); }
function write(p,s){ fs.mkdirSync(path.dirname(p),{recursive:true}); fs.writeFileSync(p,s,"utf8"); }
function sha(s){ return crypto.createHash("sha256").update(s).digest("hex").slice(0,10); }

function loadEnvLocal(){
  const p = path.join(toolRoot, ".env.local");
  if(!fs.existsSync(p)) return;
  for(const line of read(p).split(/\r?\n/)){
    const t = line.trim();
    if(!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if(i<0) continue;
    const k = t.slice(0,i).trim();
    const v = t.slice(i+1).trim();
    if(k && v && !process.env[k]) process.env[k]=v;
  }
}

function gitClean(){
  const r = spawnSync("git", ["status","--porcelain"], {encoding:"utf8"});
  if(r.status!==0) throw new Error(r.stderr || "git status failed");
  if(r.stdout.trim()) throw new Error("Working tree not clean. Commit/stash before running orchestrator.");
}

function args(){
  const a = process.argv.slice(2);
  const out = { engine:"anthropic" };
  for(let i=0;i<a.length;i++){
    if(a[i]==="--spec") out.spec=a[++i];
    if(a[i]==="--engine") out.engine=a[++i];
  }
  if(!out.spec) throw new Error("Missing --spec <path>");
  return out;
}

async function anthropic(system, user){
  const key = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022";
  if(!key) throw new Error("Missing ANTHROPIC_API_KEY in tools/ai-orchestrator/.env.local");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:"POST",
    headers:{
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      system,
      messages:[{role:"user", content:user}]
    })
  });
  const json = await res.json();
  if(!res.ok) throw new Error("Anthropic error: " + JSON.stringify(json));
  return json.content?.map(x=>x.text).join("") ?? "";
}

function policy(){
  return JSON.parse(read(path.join(toolRoot,"policy.json")));
}

function budgets(diff, pol){
  const added = (diff.match(/^\+(?!\+\+)/gm)||[]).length;
  const deleted = (diff.match(/^\-(?!\-\-)/gm)||[]).length;
  if(pol.block_renames && /rename from|rename to/.test(diff)) throw new Error("Policy blocked: rename detected.");
  if(pol.block_moves && /similarity index/.test(diff)) throw new Error("Policy blocked: move detected.");
  if(added > pol.max_lines_added) throw new Error(`Policy blocked: too many added lines (${added}).`);
  if(deleted > pol.max_lines_deleted) throw new Error(`Policy blocked: too many deleted lines (${deleted}).`);
  return { added, deleted };
}

async function main(){
  loadEnvLocal();
  gitClean();

  const { spec, engine } = args();
  if(engine !== "anthropic") throw new Error("V1 only supports --engine anthropic for now.");

  const specText = read(path.resolve(spec));
  const pol = policy();

  const runId = new Date().toISOString().replace(/[:.]/g,"-")+"-"+sha(specText);
  const runDir = path.join(toolRoot,"runs",runId);
  fs.mkdirSync(runDir,{recursive:true});

  const plannerPrompt = read(path.join(toolRoot,"prompts","planner.md"));
  const coderPrompt = read(path.join(toolRoot,"prompts","coder.md"));

  console.log("Engine:", engine);
  console.log("Run:", runId);

  const planText = await anthropic(plannerPrompt, `SPEC:\n${specText}\n\nReturn JSON only.`);
  write(path.join(runDir,"plan.json"), planText);

  let plan;
  try{ plan = JSON.parse(planText); }
  catch{ throw new Error("Planner did not return valid JSON. See plan.json"); }

  const userCoder = `POLICY:\n${JSON.stringify(pol)}\n\nPLAN:\n${JSON.stringify(plan,null,2)}\n\nSPEC:\n${specText}\n\nReturn a SINGLE unified diff only.`;
  const diffText = await anthropic(coderPrompt, userCoder);
  write(path.join(runDir,"changeset.diff"), diffText);

  const b = budgets(diffText, pol);
  write(path.join(runDir,"meta.json"), JSON.stringify({ budgets:b }, null, 2));

  console.log(`Patch budgets: +${b.added} / -${b.deleted}`);
  console.log("Generated:");
  console.log(" -", path.join(runDir,"plan.json"));
  console.log(" -", path.join(runDir,"changeset.diff"));
  console.log("\nNext (manual):");
  console.log(`  code "${path.join(runDir,"changeset.diff")}"`);
}

main().catch(e=>{ console.error("❌", e.message || e); process.exit(1); });
