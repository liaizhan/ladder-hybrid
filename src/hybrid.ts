import {
  getGenerativeModel,
  InferenceMode,
  InferenceSource,
  Schema,
  type AI,
  type GenerativeModel,
} from "firebase/ai";
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  validateReading,
  type Ladder,
  type Reading,
  type Source,
} from "./ladder";

// The cloud model name used when none is configured is the SDK's own hybrid default.
export const DEFAULT_CLOUD_MODEL = "gemini-3.5-flash-lite";

// Strict JSON schema, sent to both the on-device model and the cloud model.
export const READING_SCHEMA = Schema.object({
  properties: {
    starting_obstacle: Schema.string(),
    reflection: Schema.string(),
    step_today: Schema.string(),
    support_line: Schema.string(),
  },
});

export class DeviceUnavailableError extends Error {
  constructor(message: string, readonly detail?: unknown) {
    super(message);
    this.name = "DeviceUnavailableError";
  }
}
export class InvalidOutputError extends Error {
  constructor(message: string, readonly raw: string) {
    super(message);
    this.name = "InvalidOutputError";
  }
}

export interface ReadingResult {
  reading: Reading;
  source: Source; // where the SDK says the answer was produced
  ms: number;
  attempts: number;
}

export interface Hybrid {
  /** Downloads/initialises the on-device model. Must be called from a click. */
  startDevice(onProgress: (fraction: number) => void): Promise<void>;
  /** Reads her real ladder on the device only. Throws DeviceUnavailableError if it cannot. */
  readOnDevice(ladder: Ladder): Promise<ReadingResult>;
  /** Reads a REDACTED ladder in the cloud. Call only after she pressed Send. */
  readInCloud(redacted: Ladder): Promise<ReadingResult>;
}

export function createHybrid(ai: AI, cloudModel?: string): Hybrid {
  const inCloudParams = {
    model: cloudModel || DEFAULT_CLOUD_MODEL,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: { responseMimeType: "application/json", responseSchema: READING_SCHEMA },
  };

  // Two models on purpose. Her real answers can only ever reach ONLY_ON_DEVICE,
  // which never falls back to the cloud. The cloud model is a separate object that
  // is only used for the redacted preview she approved.
  const local: GenerativeModel = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: {
      createOptions: {
        expectedInputs: [{ type: "text", languages: ["en"] }],
        expectedOutputs: [{ type: "text", languages: ["en"] }],
      },
    },
    inCloudParams,
  });
  const cloud: GenerativeModel = getGenerativeModel(ai, { mode: InferenceMode.ONLY_IN_CLOUD, inCloudParams });

  async function once(model: GenerativeModel, ladder: Ladder, expected: Source) {
    const t0 = performance.now();
    const result = await model.generateContent(buildUserPrompt(ladder));
    const text = result.response.text();
    // The SDK reports where the inference ran. Fall back to what we asked for.
    const src = result.response.inferenceSource;
    const source: Source = src === InferenceSource.ON_DEVICE ? "on_device" : src === InferenceSource.IN_CLOUD ? "cloud" : expected;
    return { text, source, ms: Math.round(performance.now() - t0) };
  }

  async function run(model: GenerativeModel, ladder: Ladder, expected: Source, wrap: boolean): Promise<ReadingResult> {
    let last = "";
    let ms = 0;
    for (let attempt = 1; attempt <= 2; attempt++) {
      let r;
      try {
        r = await once(model, ladder, expected);
      } catch (e) {
        if (wrap) throw new DeviceUnavailableError(e instanceof Error ? e.message : String(e), e);
        throw e;
      }
      ms += r.ms;
      last = r.text;
      const v = validateReading(r.text);
      if (v.ok) return { reading: v.reading, source: r.source, ms, attempts: attempt };
    }
    throw new InvalidOutputError("The model did not return the expected JSON after two tries.", last);
  }

  return {
    async startDevice(onProgress) {
      try {
        await local.initializeDeviceModel(onProgress);
      } catch (e) {
        throw new DeviceUnavailableError(e instanceof Error ? e.message : String(e), e);
      }
    },
    readOnDevice: (ladder) => run(local, ladder, "on_device", true),
    readInCloud: (redacted) => run(cloud, redacted, "cloud", false),
  };
}

// ---------------------------------------------------------------- device probe
// Chrome's Prompt API, used only to show the device status before any call.
interface LanguageModelStatic {
  availability(opts?: unknown): Promise<"unavailable" | "downloadable" | "downloading" | "available">;
}
export type DeviceStatus = "unsupported" | "unavailable" | "downloadable" | "downloading" | "available";

export async function probeDevice(): Promise<DeviceStatus> {
  const lm = (globalThis as unknown as { LanguageModel?: LanguageModelStatic }).LanguageModel;
  if (!lm) return "unsupported";
  try {
    return await lm.availability({
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
    });
  } catch {
    return "unavailable";
  }
}
