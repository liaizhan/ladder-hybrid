// No config needed: npm run test
import assert from "node:assert/strict";
import {
  redactLadder, showsDistress, validateReading, findViolations, templateReading, startsAtNearest,
  scoreWho5, buildUserPrompt, ladderIsComplete, type Ladder,
} from "../src/ladder";
import { readConfig } from "../src/config";
import { LADDERS } from "../src/eval/ladders";

let n = 0;
const t = (name: string, fn: () => void) => { fn(); n++; console.log("ok", name); };

t("config reports missing variables", () => {
  const r = readConfig({});
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.missing.includes("VITE_FIREBASE_API_KEY"));
  assert.equal(readConfig({ VITE_FIREBASE_API_KEY: "k", VITE_FIREBASE_PROJECT_ID: "p", VITE_FIREBASE_APP_ID: "a", VITE_APPCHECK_DEBUG_TOKEN: "true" }).ok, true);
});

t("redaction replaces names, dates, contacts", () => {
  const l: Ladder = {
    goal: "Run 5 km by 14 March 2027",
    me: "I walk after work. Call me on +7 701 123 45 67 or aigerim@mail.com",
    obstacles: ["Aigerim: you are too slow", "Mom: who needs it?", "My coach Marat said I was weak in 2019"],
    fears: ["Sasha will laugh at me"],
  };
  const { ladder, counts } = redactLadder(l);
  const all = JSON.stringify(ladder);
  for (const bad of ["Aigerim", "Marat", "Sasha", "2019", "2027", "14 March", "701", "@mail"]) assert.ok(!all.includes(bad), `leaked ${bad}: ${all}`);
  assert.ok(all.includes("Mom: who needs it?"), "role words stay");
  assert.ok(counts.name >= 3 && counts.date >= 2 && counts.phone === 1 && counts.email === 1, JSON.stringify(counts));
});

t("crisis words are caught, negations are not", () => {
  assert.ok(showsDistress("Sometimes I want to die"));
  assert.ok(showsDistress("I want to sleep and never wake up"));
  assert.ok(!showsDistress("I don't want to die alone"));
  assert.ok(!showsDistress("He hit me up on Instagram"));
});

t("JSON validation", () => {
  const ok = JSON.stringify({ starting_obstacle: "a", reflection: "b", step_today: "c", support_line: "d" });
  assert.equal(validateReading(ok).ok, true);
  assert.equal(validateReading("```json\n" + ok + "\n```").ok, true);
  assert.equal(validateReading("not json").ok, false);
  assert.equal(validateReading('{"starting_obstacle":"a"}').ok, false);
  assert.equal(validateReading("[]").ok, false);
});

t("violations", () => {
  const base = { starting_obstacle: "x", reflection: "y", step_today: "z", support_line: "w" };
  assert.deepEqual(findViolations(base), []);
  assert.ok(findViolations({ ...base, reflection: "It sounds like depression." }).includes("diagnosis"));
  assert.ok(findViolations({ ...base, support_line: "This will definitely fix it." }).includes("promise"));
  assert.ok(findViolations({ ...base, reflection: "I do not diagnose anything." }).length === 0);
  assert.ok(findViolations({ ...base, step_today: "Take 20 mg of magnesium." }).includes("medical_advice"));
});

t("template reading is clean and starts at the nearest obstacle", () => {
  const l = LADDERS[0].ladder;
  const r = templateReading(l);
  assert.deepEqual(findViolations(r), []);
  assert.ok(startsAtNearest(r, l));
  assert.match(buildUserPrompt(l), /1\. /);
});

t("WHO-5 maths", () => {
  assert.deepEqual(scoreWho5([3, 4, 2, 3, 4]), { raw: 16, score: 64, band: "in the usual range" });
  assert.equal(scoreWho5([0, 0, 0, 0, 0]).band, "very low");
});

t("20 eval ladders are complete and redaction never leaks their names", () => {
  assert.equal(LADDERS.length, 20);
  for (const { id, ladder } of LADDERS) {
    assert.equal(ladderIsComplete(ladder), null, id);
  }
});

console.log(`\n${n} checks passed`);
