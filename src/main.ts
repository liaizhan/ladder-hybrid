import "./style.css";
import { readConfig } from "./config";
import { initFirebase } from "./firebase";
import {
  createHybrid,
  probeDevice,
  DeviceUnavailableError,
  InvalidOutputError,
  DEFAULT_CLOUD_MODEL,
  type Hybrid,
  type DeviceStatus,
} from "./hybrid";
import {
  HELP_LINES,
  WHO5_ITEMS,
  WHO5_SCALE,
  buildUserPrompt,
  cleanLadder,
  findViolations,
  ladderIsComplete,
  ladderText,
  redactLadder,
  scoreWho5,
  showsDistress,
  templateReading,
  totalReplaced,
  type Ladder,
  type Reading,
  type Source,
} from "./ladder";
import { runEval } from "./eval/runner";
import { toMarkdown } from "./eval/runner";

const cfgResult = readConfig(import.meta.env as Record<string, string | undefined>);
const app = document.getElementById("app")!;

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// Firebase is created lazily, so the page and the build work without any config.
let hybrid: Hybrid | null = null;
function getHybrid(): Hybrid {
  if (!cfgResult.ok) throw new Error("No Firebase config.");
  if (!hybrid) {
    const { ai } = initFirebase(cfgResult.config);
    hybrid = createHybrid(ai, cfgResult.config.cloudModel);
  }
  return hybrid;
}

const SAMPLE: Ladder = {
  goal: "Run 5 km without stopping by 1 June 2027",
  me: "I walk 20 minutes after work, three times a week",
  obstacles: [
    "Dad: you are not the sporty type",
    "Coach Marat: you will always be last",
    "Classmates: look at her, she is out of breath",
  ],
  fears: ["People will film me running"],
};

const helpHtml = (alert: boolean) => `
  <details class="help${alert ? " alert" : ""}" ${alert ? "open" : ""} id="help">
    <summary>Need help right now?</summary>
    <p>${esc(HELP_LINES.headline)}</p>
    <ul>${HELP_LINES.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
  </details>`;

function renderShell() {
  const noCfg = !cfgResult.ok
    ? `<div class="banner" id="nocfg"><strong>No Firebase config found.</strong> The page works, but the model cannot run.
       Copy <code>.env.example</code> to <code>.env.local</code> and fill in:
       <ul>${cfgResult.missing.map((m) => `<li><code>${esc(m)}</code></li>`).join("")}</ul>
       Without config you can still try the form, the redaction preview and the template reading.</div>`
    : "";
  app.innerHTML = `
  <main>
    <h1>The Ladder: Private Guide</h1>
    <p class="tag">A short reflection on your ladder, read on your own device first. By the author of the Ladder method.</p>
    <div class="banner"><strong>Not a medical or psychological service.</strong> This tool gives no diagnosis, no treatment and no promises about your health.
      Your answers stay in this browser tab. The cloud only ever sees a redacted preview, and only after you press Send.</div>
    ${helpHtml(false)}
    ${noCfg}

    <section class="card" aria-labelledby="dev-h">
      <h2 id="dev-h">This device</h2>
      <div class="status">
        <span id="dev-status">Checking...</span>
        <button id="dev-start" class="secondary" hidden>Get the on-device model</button>
        <progress id="dev-progress" max="1" value="0" hidden></progress>
      </div>
      <p class="note" id="dev-note">On-device reading uses Gemini Nano in desktop Chrome. If it is not available, you choose whether to send a redacted preview to the cloud.</p>
    </section>

    <section class="card" aria-labelledby="form-h">
      <h2 id="form-h">Your ladder</h2>
      <button id="sample" class="secondary" type="button">Load a sample ladder (invented)</button>
      <label for="goal">Where do you want to be? <span class="hint">your goal, with a date if you have one</span></label>
      <input id="goal" type="text" maxlength="300" />
      <label for="me">Where are you now? <span class="hint">one honest sentence</span></label>
      <input id="me" type="text" maxlength="300" />
      <label for="obs">What blocks you? <span class="hint">3 to 5 lines, the nearest block first</span></label>
      <textarea id="obs" maxlength="1200" placeholder="One block per line"></textarea>
      <label for="fears">What are you afraid will happen? <span class="hint">optional, one per line</span></label>
      <textarea id="fears" maxlength="800"></textarea>
      <label for="names">Names to hide from the cloud preview <span class="hint">optional, separated by commas</span></label>
      <input id="names" type="text" maxlength="200" />
      <div class="row"><button id="read" type="button">Read my ladder</button><span id="read-note" class="note"></span></div>
    </section>

    <section class="card who5" aria-labelledby="who-h">
      <details>
        <summary id="who-h"><strong>Optional: how have you felt over the last two weeks? (WHO-5)</strong></summary>
        <p class="note">Calculated on this device by code. It is never sent anywhere and is not a diagnosis.</p>
        ${WHO5_ITEMS.map(
          (q, i) => `<div class="q"><label for="w${i}">${esc(q)}</label>
            <select id="w${i}"><option value="">Choose</option>${WHO5_SCALE.map((s, v) => `<option value="${5 - v}">${esc(s)}</option>`).join("")}</select></div>`,
        ).join("")}
        <div class="row"><button id="who-go" class="secondary" type="button">Show my WHO-5 score</button><span id="who-out"></span></div>
      </details>
    </section>

    <div id="out" aria-live="polite"></div>
    <p class="note">Built for the #BuildHybridAI 2026 hackathon with Firebase AI Logic. Apache-2.0.</p>
  </main>`;
}

const lines = (v: string) => v.split("\n").map((s) => s.trim()).filter(Boolean);
function readForm(): Ladder {
  return cleanLadder({
    goal: $<HTMLInputElement>("goal").value,
    me: $<HTMLInputElement>("me").value,
    obstacles: lines($<HTMLTextAreaElement>("obs").value),
    fears: lines($<HTMLTextAreaElement>("fears").value),
  });
}
const extraNames = () => $<HTMLInputElement>("names").value.split(",").map((s) => s.trim()).filter(Boolean);

function fillForm(l: Ladder) {
  $<HTMLInputElement>("goal").value = l.goal;
  $<HTMLInputElement>("me").value = l.me;
  $<HTMLTextAreaElement>("obs").value = l.obstacles.join("\n");
  $<HTMLTextAreaElement>("fears").value = l.fears.join("\n");
}

// ---------------------------------------------------------------- device panel
async function refreshDevice() {
  const st: DeviceStatus = await probeDevice();
  const label: Record<DeviceStatus, string> = {
    unsupported: "Not supported in this browser. Use desktop Chrome 139 or newer.",
    unavailable: "Gemini Nano is unavailable on this device.",
    downloadable: "Gemini Nano can be downloaded to this device.",
    downloading: "Gemini Nano is downloading.",
    available: "Gemini Nano is ready on this device.",
  };
  $("dev-status").textContent = label[st];
  $<HTMLButtonElement>("dev-start").hidden = !(cfgResult.ok && st !== "unsupported" && st !== "unavailable");
  $<HTMLButtonElement>("dev-start").textContent = st === "available" ? "Warm up the model" : "Get the on-device model";
}

async function startDevice() {
  const btn = $<HTMLButtonElement>("dev-start");
  const bar = $<HTMLProgressElement>("dev-progress");
  btn.disabled = true;
  bar.hidden = false;
  try {
    await getHybrid().startDevice((f) => (bar.value = f));
    $("dev-status").textContent = "Gemini Nano is ready on this device.";
  } catch (e) {
    $("dev-status").textContent = "Could not start the on-device model: " + (e instanceof Error ? e.message : String(e));
  } finally {
    bar.hidden = true;
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------- output
function showHelpAlert() {
  const h = $("help");
  h.classList.add("alert");
  (h as HTMLDetailsElement).open = true;
  h.scrollIntoView({ behavior: "smooth", block: "center" });
}

function showReading(r: Reading, source: Source, ms: number | null, attempts: number | null, notice = "") {
  const label: Record<Source, string> = { on_device: "Answered on this device", cloud: "Answered in the cloud", template: "Built-in template, no model" };
  $("out").innerHTML = `
    <section class="card reading" aria-label="Your reading">
      <span class="badge ${source}">${label[source]}</span>
      ${notice ? `<p class="note">${esc(notice)}</p>` : ""}
      <h3>Where to start</h3><p>${esc(r.starting_obstacle)}</p>
      <h3>What I notice</h3><p>${esc(r.reflection)}</p>
      <h3>One step for today</h3><p>${esc(r.step_today)}</p>
      <h3>A line for you</h3><p>${esc(r.support_line)}</p>
      <p class="meta">${ms === null ? "No model was called." : `Response time: ${ms} ms${attempts && attempts > 1 ? `, ${attempts} attempts` : ""}.`}
      This is a reflection aid, not medical or psychological advice.</p>
    </section>`;
}

function showError(msg: string) {
  $("out").innerHTML = `<section class="card"><p class="err" role="alert">${esc(msg)}</p></section>`;
}

function offerTemplate(l: Ladder, why: string) {
  const r = templateReading(l);
  showReading(r, "template", null, null, why);
}

async function askConsent(l: Ladder, why: string): Promise<void> {
  const red = redactLadder(l, extraNames());
  const n = totalReplaced(red.counts);
  const prompt = buildUserPrompt(red.ladder);
  $("out").innerHTML = `
    <section class="card" aria-label="Send to the cloud?">
      <h2>Send a redacted preview to the cloud?</h2>
      <p>${esc(why)} Nothing has been sent. Below is exactly what would be sent. ${n} item${n === 1 ? "" : "s"} (names, contacts, dates, links) were replaced. Check it before you decide.</p>
      <pre class="preview">${esc(prompt)}</pre>
      <div class="row"><button id="send">Send to the cloud</button><button id="cancel" class="secondary">Do not send</button></div>
    </section>`;
  $("cancel").onclick = () => offerTemplate(l, "Nothing was sent. This is the built-in template reading, not a model answer.");
  $("send").onclick = async () => {
    const btn = $<HTMLButtonElement>("send");
    btn.disabled = true;
    btn.textContent = "Sending...";
    try {
      const res = await getHybrid().readInCloud(red.ladder);
      finish(l, res.reading, res.source, res.ms, res.attempts);
    } catch (e) {
      failure(e, l);
    }
  };
}

function finish(l: Ladder, r: Reading, source: Source, ms: number, attempts: number) {
  const bad = findViolations(r);
  if (bad.length) {
    offerTemplate(l, `The model answer broke a safety rule (${bad.join(", ")}) and was withheld. This is the built-in template reading.`);
    return;
  }
  showReading(r, source, ms, attempts);
}

function failure(e: unknown, l: Ladder) {
  if (e instanceof InvalidOutputError) {
    showError("The model did not return valid JSON in the expected shape after two tries. Nothing is shown from it.");
    const o = $("out");
    const b = document.createElement("div");
    b.className = "row";
    b.innerHTML = `<button id="tpl" class="secondary">Show the template reading instead</button>`;
    o.firstElementChild!.appendChild(b);
    $("tpl").onclick = () => offerTemplate(l, "Built-in template reading, not a model answer.");
  } else {
    showError("Something went wrong: " + (e instanceof Error ? e.message : String(e)));
  }
}

async function onRead() {
  const l = readForm();
  const problem = ladderIsComplete(l);
  if (problem) {
    $("read-note").textContent = problem;
    return;
  }
  $("read-note").textContent = "";
  // The crisis check runs in code, before any model.
  if (showsDistress(ladderText(l))) {
    showHelpAlert();
    $("out").innerHTML = `<section class="card"><p><strong>I am stopping here.</strong> What you wrote sounds heavy, and this tool is not the right place for it. Please use the help lines above or talk to someone you trust. No model was run and nothing was sent.</p></section>`;
    return;
  }
  if (!cfgResult.ok) {
    offerTemplate(l, "No Firebase config, so no model can run. This is the built-in template reading.");
    return;
  }
  const btn = $<HTMLButtonElement>("read");
  btn.disabled = true;
  $("read-note").textContent = "Reading on this device...";
  try {
    const res = await getHybrid().readOnDevice(l);
    finish(l, res.reading, res.source, res.ms, res.attempts);
  } catch (e) {
    if (e instanceof DeviceUnavailableError) {
      $("dev-status").textContent = "Gemini Nano did not run: " + e.message;
      await askConsent(l, "Gemini Nano is not available on this device, so I could not read your ladder here.");
    } else {
      failure(e, l);
    }
  } finally {
    btn.disabled = false;
    $("read-note").textContent = "";
  }
}

function onWho5() {
  const vals = WHO5_ITEMS.map((_, i) => $<HTMLSelectElement>(`w${i}`).value);
  if (vals.some((v) => v === "")) {
    $("who-out").textContent = "Please answer all five.";
    return;
  }
  const s = scoreWho5(vals.map(Number));
  $("who-out").textContent = `Score ${s.score} of 100 (${s.band}). Calculated here, not sent.${s.score <= 50 ? " A low score is a good reason to talk to someone you trust or a professional." : ""}`;
}

// ---------------------------------------------------------------- eval page (?eval=1)
function renderEval() {
  app.innerHTML = `<main><h1>Eval run</h1>
    <p class="note">Runs 20 invented ladders on this device (Gemini Nano, desktop Chrome) and in the cloud. Start it with a click.</p>
    ${cfgResult.ok ? "" : `<div class="banner">No Firebase config. Missing: ${cfgResult.missing.map((m) => `<code>${esc(m)}</code>`).join(", ")}</div>`}
    <div class="row"><button id="go" ${cfgResult.ok ? "" : "disabled"}>Run eval</button></div>
    <pre class="preview" id="log"></pre><div id="dl"></div></main>`;
  $("go").onclick = async () => {
    const log = $("log");
    $<HTMLButtonElement>("go").disabled = true;
    try {
      const h = getHybrid();
      log.textContent = "Preparing the on-device model...\n";
      await h.startDevice(() => {});
      const rep = await runEval(h, {
        modes: ["on_device", "cloud"],
        cloudModel: cfgResult.ok ? cfgResult.config.cloudModel || DEFAULT_CLOUD_MODEL : DEFAULT_CLOUD_MODEL,
        userAgent: navigator.userAgent,
        onProgress: (m) => (log.textContent = m),
        pauseMs: 4000, // free-tier requests-per-minute limit (cloud only)
      });
      const md = toMarkdown(rep);
      log.textContent = md;
      const link = (name: string, body: string, type: string) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([body], { type }));
        a.download = name;
        a.textContent = "Download " + name;
        a.style.display = "block";
        $("dl").appendChild(a);
      };
      link("eval-browser.json", JSON.stringify(rep, null, 2), "application/json");
      link("eval-browser.md", md, "text/markdown");
    } catch (e) {
      log.textContent = "Eval stopped: " + (e instanceof Error ? e.message : String(e));
    } finally {
      $<HTMLButtonElement>("go").disabled = false;
    }
  };
}

// ---------------------------------------------------------------- start
if (new URLSearchParams(location.search).get("eval") === "1") {
  renderEval();
} else {
  renderShell();
  $("sample").onclick = () => fillForm(SAMPLE);
  $("read").onclick = onRead;
  $("who-go").onclick = onWho5;
  $("dev-start").onclick = startDevice;
  void refreshDevice();
}
