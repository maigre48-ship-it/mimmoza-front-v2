// fix-encoding.cjs - repair mojibake UTF8-read-as-1252, from git HEAD
const { execSync } = require("child_process");
const fs = require("fs");
const iconv = require("iconv-lite");

const files = [
  "src/spaces/investisseur/pages/deal-center/DealCenterPage.tsx",
  "src/spaces/investisseur/pages/deal-center/exports/exportCommitteeReview.ts",
  "src/spaces/investisseur/pages/deal-center/exports/exportFinancialEngine.ts",
  "src/spaces/investisseur/pages/deal-center/exports/exportInvestmentPack.ts",
  "src/spaces/investisseur/pages/deal-center/exports/exportZip.ts",
  "src/spaces/investisseur/pages/deal-center/tabs/CommitteeReviewTab.tsx",
  "src/spaces/investisseur/pages/deal-center/tabs/ExportsTab.tsx",
  "src/spaces/investisseur/pages/deal-center/tabs/FinancialEngineTab.tsx",
  "src/spaces/investisseur/pages/deal-center/tabs/InvestmentPackTab.tsx",
];

for (const f of files) {
  const fromGit = execSync(`git show HEAD:${f}`, { encoding: "buffer", maxBuffer: 50 * 1024 * 1024 });
  let s = fromGit.toString("utf8");
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  // encode la string mojibakee en win1252 -> recupere les octets UTF-8 originaux
  const originalBytes = iconv.encode(s, "win1252");
  // decode ces octets en UTF-8 -> texte propre
  const clean = originalBytes.toString("utf8");
  fs.writeFileSync(f, clean, { encoding: "utf8" });
  console.log("OK:", f);
}