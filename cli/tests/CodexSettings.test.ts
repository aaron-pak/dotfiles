import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { parse } from "smol-toml";
import { AiLocalStateLive } from "../src/services/AiLocalState.js";
import { AiStateLive } from "../src/services/AiState.js";
import {
  CodexSettings,
  CodexSettingsError,
  CodexSettingsLive,
} from "../src/services/CodexSettings.js";
import {
  defaultAiLocalStateToml,
  defaultAiStateToml,
  type FsFiles,
  makeTestBaseLayer,
  readFile,
  testDotfilesRoot,
  testHomeDir,
} from "./testSupport.js";

const aiStatePath = `${testDotfilesRoot}/ai/state.toml`;
const aiLocalPath = `${testHomeDir}/.config/dot/ai-local.toml`;
const sharedPath = `${testDotfilesRoot}/ai/codex-settings-shared.toml`;
const localPath = `${testHomeDir}/.codex/config.toml`;

const makeTestLayer = (files: FsFiles) => {
  const baseLayer = makeTestBaseLayer(files);
  const stateLayers = Layer.mergeAll(AiStateLive, AiLocalStateLive).pipe(
    Layer.provideMerge(baseLayer),
  );

  return CodexSettingsLive.pipe(
    Layer.provideMerge(stateLayers),
    Layer.provideMerge(baseLayer),
  );
};

describe("CodexSettings service", () => {
  describe("pull", () => {
    it.effect("merges every shared section and preserves local projects", () => {
      const files: FsFiles = {
        [aiStatePath]: defaultAiStateToml,
        [sharedPath]: `
model = "gpt-5.4"

[features]
multi_agent = true

[notice]
hide_rate_limit_model_nudge = true
`.trimStart(),
        [localPath]: `
model = "gpt-4.1"

[projects."/tmp/example"]
trust_level = "trusted"
`.trimStart(),
      };

      return Effect.gen(function* () {
        const settings = yield* CodexSettings;
        const result = yield* settings.pull();

        expect(result.applicableKeys).toEqual(["model", "features", "notice"]);
        expect(result.changedKeys).toEqual(["model", "features", "notice"]);
        expect(result.skippedKeys).toEqual([]);

        const written = parse(readFile(files, localPath));
        expect(written.model).toBe("gpt-5.4");
        expect(written.features).toEqual({ multi_agent: true });
        expect(written.notice).toEqual({
          hide_rate_limit_model_nudge: true,
        });
        expect(written.projects).toEqual({
          "/tmp/example": { trust_level: "trusted" },
        });
      }).pipe(Effect.provide(makeTestLayer(files)));
    });

    it.effect("skips ignored sections and preserves the local value", () => {
      const files: FsFiles = {
        [aiStatePath]: defaultAiStateToml,
        [aiLocalPath]: `
[tools.claude]
ignored_shared_sections = []

[tools.codex]
ignored_shared_sections = ["notice"]
`.trimStart(),
        [sharedPath]: `
model = "gpt-5.4"

[notice]
hide_rate_limit_model_nudge = true
`.trimStart(),
        [localPath]: `
model = "gpt-4.1"

[notice]
hide_rate_limit_model_nudge = false
`.trimStart(),
      };

      return Effect.gen(function* () {
        const settings = yield* CodexSettings;
        const result = yield* settings.pull();

        expect(result.applicableKeys).toEqual(["model"]);
        expect(result.changedKeys).toEqual(["model"]);
        expect(result.skippedKeys).toEqual(["notice"]);

        const written = parse(readFile(files, localPath));
        expect(written.model).toBe("gpt-5.4");
        expect(written.notice).toEqual({
          hide_rate_limit_model_nudge: false,
        });
      }).pipe(Effect.provide(makeTestLayer(files)));
    });

    it.effect("never pulls the machine-local projects section", () => {
      const files: FsFiles = {
        [aiStatePath]: defaultAiStateToml,
        [sharedPath]: `
model = "gpt-5.4"

[projects."/tmp/shared"]
trust_level = "trusted"
`.trimStart(),
        [localPath]: `
[projects."/tmp/local"]
trust_level = "trusted"
`.trimStart(),
      };

      return Effect.gen(function* () {
        const settings = yield* CodexSettings;
        const result = yield* settings.pull();

        expect(result.applicableKeys).toEqual(["model"]);
        expect(result.changedKeys).toEqual(["model"]);
        expect(result.skippedKeys).toEqual(["projects"]);

        const written = parse(readFile(files, localPath));
        expect(written.model).toBe("gpt-5.4");
        expect(written.projects).toEqual({
          "/tmp/local": { trust_level: "trusted" },
        });
      }).pipe(Effect.provide(makeTestLayer(files)));
    });

    it.effect("does not rewrite the local file when shared values already match", () => {
      const initialLocal = `
model = "gpt-5.4"
`.trimStart();
      const files: FsFiles = {
        [aiStatePath]: defaultAiStateToml,
        [sharedPath]: `
model = "gpt-5.4"
`.trimStart(),
        [localPath]: initialLocal,
      };

      return Effect.gen(function* () {
        const settings = yield* CodexSettings;
        const result = yield* settings.pull();

        expect(result.applicableKeys).toEqual(["model"]);
        expect(result.changedKeys).toEqual([]);
        expect(result.skippedKeys).toEqual([]);
        expect(readFile(files, localPath)).toBe(initialLocal);
      }).pipe(Effect.provide(makeTestLayer(files)));
    });
  });

  describe("adopt", () => {
    it.effect("copies a local section into the shared TOML file", () => {
      const files: FsFiles = {
        [aiStatePath]: defaultAiStateToml,
        [sharedPath]: `
[features]
multi_agent = true
`.trimStart(),
        [localPath]: `
[features]
multi_agent = true

[notice]
hide_rate_limit_model_nudge = true
`.trimStart(),
      };

      return Effect.gen(function* () {
        const settings = yield* CodexSettings;
        const result = yield* settings.adopt("notice");

        expect(result.key).toBe("notice");

        const shared = parse(readFile(files, sharedPath));
        expect(shared.features).toEqual({ multi_agent: true });
        expect(shared.notice).toEqual({ hide_rate_limit_model_nudge: true });
      }).pipe(Effect.provide(makeTestLayer(files)));
    });

    it.effect("rejects the machine-local projects section", () => {
      const files: FsFiles = {
        [aiStatePath]: defaultAiStateToml,
        [sharedPath]: "",
        [localPath]: `
[projects."/tmp/example"]
trust_level = "trusted"
`.trimStart(),
      };

      return Effect.gen(function* () {
        const settings = yield* CodexSettings;
        const error = yield* settings.adopt("projects").pipe(Effect.flip);

        expect(error).toBeInstanceOf(CodexSettingsError);
        if (error._tag === "CodexSettingsError") {
          expect(error.details).toContain("machine-local");
        }
      }).pipe(Effect.provide(makeTestLayer(files)));
    });
  });

  describe("ignore", () => {
    it.effect("ignore and unignore update future sync policy only", () => {
      const files: FsFiles = {
        [aiStatePath]: defaultAiStateToml,
        [aiLocalPath]: defaultAiLocalStateToml,
        [sharedPath]: `
[features]
multi_agent = true

[notice]
hide_rate_limit_model_nudge = true
`.trimStart(),
        [localPath]: `
model = "gpt-5.4"
`.trimStart(),
      };

      return Effect.gen(function* () {
        const settings = yield* CodexSettings;

        yield* settings.ignore("notice");

        let localState = parse(readFile(files, aiLocalPath));
        expect(localState).toEqual({
          tools: {
            claude: { ignored_shared_sections: [] },
            codex: { ignored_shared_sections: ["notice"] },
          },
        });
        expect(parse(readFile(files, sharedPath))).toEqual({
          features: { multi_agent: true },
          notice: { hide_rate_limit_model_nudge: true },
        });
        expect(parse(readFile(files, localPath))).toEqual({
          model: "gpt-5.4",
        });

        yield* settings.unignore("notice");

        localState = parse(readFile(files, aiLocalPath));
        expect(localState).toEqual({
          tools: {
            claude: { ignored_shared_sections: [] },
            codex: { ignored_shared_sections: [] },
          },
        });
      }).pipe(Effect.provide(makeTestLayer(files)));
    });

    it.effect("rejects ignore for machine-local or unknown sections", () => {
      const files: FsFiles = {
        [aiStatePath]: defaultAiStateToml,
        [aiLocalPath]: defaultAiLocalStateToml,
        [sharedPath]: `
[features]
multi_agent = true
`.trimStart(),
      };

      return Effect.gen(function* () {
        const settings = yield* CodexSettings;
        const machineLocalError = yield* settings
          .ignore("projects")
          .pipe(Effect.flip);
        const unknownError = yield* settings.ignore("notice").pipe(Effect.flip);

        expect(machineLocalError).toBeInstanceOf(CodexSettingsError);
        expect(unknownError).toBeInstanceOf(CodexSettingsError);

        if (machineLocalError._tag === "CodexSettingsError") {
          expect(machineLocalError.details).toContain("never shared");
        }
        if (unknownError._tag === "CodexSettingsError") {
          expect(unknownError.details).toContain("not currently shared");
        }
      }).pipe(Effect.provide(makeTestLayer(files)));
    });

    it.effect("rejects ignore when this machine already keeps its own value", () => {
      const files: FsFiles = {
        [aiStatePath]: defaultAiStateToml,
        [aiLocalPath]: `
[tools.claude]
ignored_shared_sections = []

[tools.codex]
ignored_shared_sections = ["notice"]
`.trimStart(),
        [sharedPath]: `
[notice]
hide_rate_limit_model_nudge = true
`.trimStart(),
      };

      return Effect.gen(function* () {
        const settings = yield* CodexSettings;
        const error = yield* settings.ignore("notice").pipe(Effect.flip);

        expect(error).toBeInstanceOf(CodexSettingsError);
        if (error._tag === "CodexSettingsError") {
          expect(error.details).toContain("already keeping its own value");
        }
      }).pipe(Effect.provide(makeTestLayer(files)));
    });

    it.effect("rejects unignore when this machine is already using the shared value", () => {
      const files: FsFiles = {
        [aiStatePath]: defaultAiStateToml,
        [aiLocalPath]: defaultAiLocalStateToml,
      };

      return Effect.gen(function* () {
        const settings = yield* CodexSettings;
        const error = yield* settings.unignore("notice").pipe(Effect.flip);

        expect(error).toBeInstanceOf(CodexSettingsError);
        if (error._tag === "CodexSettingsError") {
          expect(error.details).toContain('not keeping its own value for "notice"');
        }
      }).pipe(Effect.provide(makeTestLayer(files)));
    });
  });

  describe("stop managing", () => {
    it.effect("keeps a local section when it is no longer present in the shared file", () => {
      const files: FsFiles = {
        [aiStatePath]: defaultAiStateToml,
        [sharedPath]: `
model = "gpt-5.4"
`.trimStart(),
        [localPath]: `
model = "gpt-4.1"

[notice]
hide_rate_limit_model_nudge = false
`.trimStart(),
      };

      return Effect.gen(function* () {
        const settings = yield* CodexSettings;
        yield* settings.pull();

        expect(parse(readFile(files, localPath))).toEqual({
          model: "gpt-5.4",
          notice: { hide_rate_limit_model_nudge: false },
        });
      }).pipe(Effect.provide(makeTestLayer(files)));
    });
  });
});
