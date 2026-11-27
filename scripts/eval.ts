// Cloud eval from Node (the on-device half can only run in desktop Chrome: open the app with ?eval=1).
// Needs .env.local with the VITE_FIREBASE_* values and a registered App Check debug token.
//   npm run eval            -> cloud only
import { mkdirSync, writeFileSync } from "node:fs";
import { readConfig } from "../src/config";
import { initFirebase } from "../src/firebase";
import { createHybrid, DEFAULT_CLOUD_MODEL } from "../src/hybrid";
import { runEval, toMarkdown } from "../src/eval/runner";

try { process.loadEnvFile(".env.local"); } catch { /* no file: handled below */ }

const cfg = readConfig(process.env);
if (!cfg.ok) {
  console.error("No Firebase config. Missing:\n  " + cfg.missing.join("\n  "));
  console.error("\nCopy .env.example to .env.local and fill it in. For Node, VITE_APPCHECK_DEBUG_TOKEN must be a token registered in the Firebase console (not \"true\").");
  process.exit(2);
}
if (!cfg.config.appCheck.debugToken || cfg.config.appCheck.debugToken === "true") {
  console.error("Node eval needs VITE_APPCHECK_DEBUG_TOKEN set to a registered debug token (not \"true\").");
  process.exit(2);
}

const { ai } = initFirebase(cfg.config);
const hybrid = createHybrid(ai, cfg.config.cloudModel);
const model = cfg.config.cloudModel ?? DEFAULT_CLOUD_MODEL;
const rep = await runEval(hybrid, {
  modes: ["cloud"],
  cloudModel: model,
  userAgent: `node ${process.version}`,
  onProgress: (m) => console.log(m),
  pauseMs: 4000, // free-tier requests-per-minute limit
});
mkdirSync("eval-results", { recursive: true });
const stamp = rep.date.replace(/[:.]/g, "-");
writeFileSync(`eval-results/cloud-${stamp}.json`, JSON.stringify(rep, null, 2));
writeFileSync(`eval-results/cloud-${stamp}.md`, toMarkdown(rep));
console.log("\n" + toMarkdown(rep));
process.exit(0);
