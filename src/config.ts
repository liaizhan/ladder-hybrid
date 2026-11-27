// Reads Firebase settings from an env object (import.meta.env in the browser,
// process.env in Node). No keys live in the code.
export type Env = Record<string, string | undefined>;

export interface AppConfig {
  firebase: {
    apiKey: string;
    authDomain?: string;
    projectId: string;
    storageBucket?: string;
    messagingSenderId?: string;
    appId: string;
  };
  appCheck: {
    provider: "enterprise" | "v3";
    siteKey?: string;
    debugToken?: string;
  };
  cloudModel?: string;
}

export type ConfigResult =
  | { ok: true; config: AppConfig }
  | { ok: false; missing: string[] };

const REQUIRED = ["VITE_FIREBASE_API_KEY", "VITE_FIREBASE_PROJECT_ID", "VITE_FIREBASE_APP_ID"];

const clean = (v: string | undefined): string | undefined => {
  const t = (v ?? "").trim();
  return t ? t : undefined;
};

export function readConfig(env: Env): ConfigResult {
  const missing = REQUIRED.filter((k) => !clean(env[k]));
  const siteKey = clean(env.VITE_APPCHECK_SITE_KEY);
  const debugToken = clean(env.VITE_APPCHECK_DEBUG_TOKEN);
  // App Check is required: a site key or a debug token must be present.
  if (!siteKey && !debugToken) missing.push("VITE_APPCHECK_SITE_KEY (or VITE_APPCHECK_DEBUG_TOKEN for development)");
  if (missing.length) return { ok: false, missing };
  return {
    ok: true,
    config: {
      firebase: {
        apiKey: clean(env.VITE_FIREBASE_API_KEY)!,
        authDomain: clean(env.VITE_FIREBASE_AUTH_DOMAIN),
        projectId: clean(env.VITE_FIREBASE_PROJECT_ID)!,
        storageBucket: clean(env.VITE_FIREBASE_STORAGE_BUCKET),
        messagingSenderId: clean(env.VITE_FIREBASE_MESSAGING_SENDER_ID),
        appId: clean(env.VITE_FIREBASE_APP_ID)!,
      },
      appCheck: {
        provider: clean(env.VITE_APPCHECK_PROVIDER) === "v3" ? "v3" : "enterprise",
        siteKey,
        debugToken,
      },
      cloudModel: clean(env.VITE_CLOUD_MODEL),
    },
  };
}
