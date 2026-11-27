import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  ReCaptchaV3Provider,
  CustomProvider,
  type AppCheck,
} from "firebase/app-check";
import { getAI, GoogleAIBackend, type AI } from "firebase/ai";
import type { AppConfig } from "./config";

export interface FirebaseHandles {
  app: FirebaseApp;
  appCheck: AppCheck;
  ai: AI;
}

// Exchanges a registered App Check debug token for an App Check token over REST.
// Only used outside the browser (the Node eval script); in the browser the SDK's
// own debug mode does this.
function debugTokenProvider(cfg: AppConfig) {
  return new CustomProvider({
    getToken: async () => {
      const url = `https://firebaseappcheck.googleapis.com/v1/projects/${cfg.firebase.projectId}/apps/${cfg.firebase.appId}:exchangeDebugToken?key=${cfg.firebase.apiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ debug_token: cfg.appCheck.debugToken }),
      });
      if (!res.ok) throw new Error(`App Check debug token exchange failed (${res.status}).`);
      const body = (await res.json()) as { token: string; ttl: string };
      const ttlSeconds = parseInt(body.ttl, 10) || 3600;
      return { token: body.token, expireTimeMillis: Date.now() + ttlSeconds * 1000 };
    },
  });
}

export function initFirebase(cfg: AppConfig): FirebaseHandles {
  const inBrowser = typeof window !== "undefined";
  const { debugToken, siteKey, provider } = cfg.appCheck;

  // Debug token (development): "true" makes the SDK print a new token to the
  // console that you register in the Firebase console; any other value is used as the token.
  if (inBrowser && debugToken) {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      debugToken === "true" ? true : debugToken;
  }

  const app = initializeApp(cfg.firebase);

  // App Check must be initialised before the first AI call.
  const appCheckProvider = !inBrowser
    ? debugTokenProvider(cfg)
    : provider === "v3"
      ? new ReCaptchaV3Provider(siteKey ?? "debug")
      : new ReCaptchaEnterpriseProvider(siteKey ?? "debug");
  const appCheck = initializeAppCheck(app, { provider: appCheckProvider, isTokenAutoRefreshEnabled: true });

  const ai = getAI(app, { backend: new GoogleAIBackend() });
  return { app, appCheck, ai };
}
