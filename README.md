# The Ladder: Private Guide (hybrid AI prototype)

A small web app for the #BuildHybridAI 2026 hackathon. A woman answers three Ladder questions: where she wants to be, where she is now, and what blocks her, nearest block first. The app gives her a short, structured reflection.

The reading runs **on her device** with Gemini Nano through Firebase AI Logic. The cloud (a Gemini model) only sees a **redacted preview**, and only after she has read it and pressed **Send**.

The Ladder method was created by Aizhan Li, author of the Ladder method. This is a reflection aid. It is not a medical or psychological service, it gives no diagnosis and it makes no promises about health.

**Live demo:** https://ladder-hybrid.web.app (Firebase Hosting, App Check with reCAPTCHA Enterprise). On-device reading needs desktop Chrome with Gemini Nano; other browsers get the cloud path with consent.

Status: running on a live Firebase project (Spark plan). Measured numbers are in the Eval section below.

## How the hybrid works

1. **Crisis check in code.** Before any model runs, plain code looks for crisis wording. If it matches, the model is not called, nothing is sent, and the help lines are shown. A help block is always visible.
2. **On-device first.** The reading goes to `ONLY_ON_DEVICE` Gemini Nano (Chrome Prompt API, through the Firebase AI Logic hybrid SDK). Her real words never go to a cloud model.
3. **If Nano is unavailable** (other browser, small device, model not downloaded), she sees a clear message and a consent panel. The panel shows the exact redacted text that would be sent. Names, emails, phone numbers, card and ID numbers, links, handles and dates are replaced. She can also list extra names to hide.
4. **Send or not.** Send calls a separate `ONLY_IN_CLOUD` model with the redacted text. "Do not send" shows a built-in template reading from plain code, with the badge "Built-in template, no model".
5. **Every answer shows where it came from** (this device, the cloud, or the template) and the response time in milliseconds. The source comes from the SDK's `inferenceSource`.

Two separate model objects are used on purpose. Plain `PREFER_ON_DEVICE` would fall back to the cloud silently, with her unredacted text.

We also found that `ONLY_ON_DEVICE` alone is not enough. When the browser has no Prompt API at all (Safari, Firefox, mobile), the SDK creates no on-device adapter and sends the request to the cloud anyway, with the real text. When the model is only downloadable, the call waits for the download. So `readOnDevice` in `src/hybrid.ts` checks `LanguageModel.availability()` first, calls the model only when it is `available`, and rejects any answer whose `inferenceSource` is not on-device. In every other case she gets the consent panel.

### Strict JSON and safety

- The model must return JSON with `starting_obstacle`, `reflection`, `step_today` and `support_line`. The schema is sent to both the on-device and the cloud model.
- The reply is parsed and validated in code. An invalid reply is retried once. After two failures the user sees a clear error and nothing from the model.
- Output rules are checked in code (diagnosis, promises, identity claims, medical advice, unsafe commands). A reply that breaks one is withheld and replaced by the template.
- Code, not the model, decides that work starts at the nearest block.
- The optional WHO-5 well-being questions are scored by code in the browser and are never sent.

## Run it

Requirements: Node 22 or newer. On-device inference needs desktop Chrome 139 or newer with Gemini Nano available (the Prompt API). Other browsers get the cloud path with consent.

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run dev
```

Without `.env.local` the app still builds and opens. It shows a "No Firebase config found" panel that lists the missing variables, and offers only the form, the redaction preview and the template reading.

### Variables (`.env.local`, never committed)

| Variable | Needed | Meaning |
| --- | --- | --- |
| `VITE_FIREBASE_API_KEY` | yes | Firebase web app API key |
| `VITE_FIREBASE_PROJECT_ID` | yes | Firebase project id |
| `VITE_FIREBASE_APP_ID` | yes | Firebase web app id |
| `VITE_APPCHECK_SITE_KEY` | one of these two | reCAPTCHA Enterprise or v3 site key |
| `VITE_APPCHECK_DEBUG_TOKEN` | one of these two | App Check debug token for local development |
| `VITE_APPCHECK_PROVIDER` | no | `enterprise` (default) or `v3` |
| `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID` | no | standard Firebase settings |
| `VITE_CLOUD_MODEL` | no | cloud model name, default `gemini-3.5-flash-lite` |

In the Firebase console: create a project, add a web app, enable the Gemini Developer API in Firebase AI Logic, register App Check for the web app with reCAPTCHA, and register the debug token. Then turn on App Check enforcement for the AI API.

### App Check

App Check starts before the AI service. In production use a reCAPTCHA Enterprise (or v3) site key. For development set `VITE_APPCHECK_DEBUG_TOKEN` to a token you registered in the console. A debug token in a built bundle is public, so use it only on local or throwaway builds.

## Eval

Twenty invented ladders (all people and events are made up), plus two crisis cases that must be stopped by the code guard. It reports the share of valid JSON on the first try and after one retry, median and p95 response time, the share that starts at the nearest block, safety-rule violations, and the crisis guard result.

- Cloud, in Node: `npm run eval` (reads `.env.local`, needs a registered debug token). Writes `eval-results/`.
- On device, in desktop Chrome: open `/?eval=1` and press **Run eval**. It runs both the on-device and the cloud half and offers JSON and Markdown downloads.
- Offline checks of the logic (config, redaction, crisis words, validation, template, WHO-5): `npm test`.

### Results (27 November 2026)

Measured on the 20 invented ladders. Cloud model: `gemini-3.5-flash-lite`.

- **On device (Gemini Nano, desktop Chrome 158):** valid JSON 20 of 20, median 4583 ms, p95 15349 ms.
- **Cloud, in the browser:** valid JSON 20 of 20, median 1112 ms, p95 1540 ms.
- **Cloud, in Node:** valid JSON 20 of 20, median 1386 ms, p95 2399 ms.
- **Starts at the nearest block:** 20 of 20.
- **Safety-rule violations:** 0.
- **Crisis guard:** 2 of 2 crisis ladders stopped in code before any model call.

The first on-device run gave 0 of 20 valid answers: the hybrid SDK does not pass `systemInstruction` to the on-device session. The fix sends the system prompt as `initialPrompts` in `onDeviceParams.createOptions` and the JSON schema as `responseConstraint` in `onDeviceParams.promptOptions` (see `src/hybrid.ts`). The free tier also returned some `429 Too Many Requests` in the cloud run, so the eval now pauses 4 s between calls and retries on 429.

## Privacy

- Her answers are kept in the page only. Nothing is stored and there is no analytics.
- The on-device model gets her real text. The cloud gets only the redacted preview that she saw and approved.
- Redaction is rule-based and best effort. It can miss unusual names, so the preview is shown in full before sending and she can add names to hide.
- No keys are in the code. Configuration comes only from `VITE_FIREBASE_*` and `VITE_APPCHECK_*` variables. `.env.local` is in `.gitignore`.
- Firebase web API keys are not secrets by themselves. App Check and API restrictions protect the project.

## Honest limits

- Gemini Nano in Chrome supports a limited set of languages, so the interface and prompts are English only.
- Small on-device models make mistakes. That is why output is validated, rule-checked and retried, and why the template exists.
- On-device numbers come from one laptop (Chrome 158). Other hardware may be slower or may not get Nano at all.

## Reused work

The crisis words, redaction rules, help lines, system prompt and WHO-5 items come from an earlier prototype by the same author, made for the GTransformer AI Buildathon 2026: https://github.com/liaizhan/ladder-private-guide. That prototype runs only in the cloud and does not use Firebase. Everything else, including the Firebase hybrid layer, the UI and the eval, was written for this hackathon.

## License

Apache-2.0. See `LICENSE`.
