import { describe, expect, it } from "@effect/vitest";
import { parse } from "smol-toml";
import { Effect, Layer } from "effect";
import { AiLocalState } from "../src/services/AiLocalState.js";
import { AiState } from "../src/services/AiState.js";
import {
  ClaudeSettings,
  ClaudeSettingsError,
} from "../src/services/ClaudeSettings.js";
import {
  defaultAiLocalStateToml,
  defaultAiStateToml,
  type FsFiles,
  makeMockFs,
  parseJsonObject,
  readFile,
  stringifyJsonObject,
  TestPath,
  TestStowConfig,
  testDotfilesRoot,
  testHomeDir,
} from "./testSupport.js";

const aiStatePath = `${testDotfilesRoot}/ai/state.toml`;
const aiLocalPath = `${testHomeDir}/.config/dot/ai-local.toml`;
const sharedPath = `${testDotfilesRoot}/ai/claude-settings-shared.json`;
const localPath = `${testHomeDir}/.claude/settings.json`;

const makeTestLayer = (files: FsFiles) =>
  ClaudeSettings.Default.pipe(
    Layer.provideMerge(Layer.merge(AiState.Default, AiLocalState.Default)),
    Layer.provideMerge(makeMockFs(files)),
    Layer.provideMerge(TestStowConfig),
    Layer.provideMerge(TestPath),
  );

describe("ClaudeSettings service", () => {
  describe("pull", () => {
    it.effect("merges every key from the shared JSON file", () => {
      const files: FsFiles = {
        [aiStatePath]: defaultAiStateToml,
        [sharedPath]: stringifyJsonObject({
          permissions: { allow: ["Bash(ls)"] },
          hooks: { Notification: [] },
          statusLine: { type: "command", command: "echo hi" },
        }),
        [localPath]: stringifyJsonObject({
          enabledPlugins: { "context7@claude-plugins-official": true },
        }),
      };

      return Effect.gen(function* () {
        const settings = yield* ClaudeSettings;
        const result = yield* settings.pull();

        expect(result.applicableKeys).toEqual([
          "permissions",
          "hooks",
          "statusLine",
        ]);
        expect(result.changedKeys).toEqual([
          "permissions",
          "hooks",
          "statusLine",
        ]);
        expect(result.skippedKeys).toEqual([]);
        expect(result.totalKeys).toBe(4);

        const written = parseJsonObject(readFile(files, localPath));
        expect(written.permissions).toEqual({ allow: ["Bash(ls)"] });
        expect(written.hooks).toEqual({ Notification: [] });
        expect(written.statusLine).toEqual({
          type: "command",
          command: "echo hi",
        });
        expect(written.enabledPlugins).toEqual({
          "context7@claude-plugins-official": true,
        });
      }).pipe(Effect.provide(makeTestLayer(files)));
    });

    it.effect("skips ignored shared keys and preserves the local value", () => {
      const files: FsFiles = {
        [aiStatePath]: defaultAiStateToml,
        [aiLocalPath]: `
[tools.claude]
ignored_shared_sections = ["statusLine"]

[tools.codex]
ignored_shared_sections = []
`.trimStart(),
        [sharedPath]: stringifyJsonObject({
          permissions: { allow: ["Bash(ls)"] },
          statusLine: { type: "command", command: "echo shared" },
        }),
        [localPath]: stringifyJsonObject({
          statusLine: { type: "command", command: "echo local" },
          enabledPlugins: { "context7@claude-plugins-official": true },
        }),
      };

      return Effect.gen(function* () {
        const settings = yield* ClaudeSettings;
        const result = yield* settings.pull();

        expect(result.applicableKeys).toEqual(["permissions"]);
        expect(result.changedKeys).toEqual(["permissions"]);
        expect(result.skippedKeys).toEqual(["statusLine"]);

        const written = parseJsonObject(readFile(files, localPath));
        expect(written.permissions).toEqual({ allow: ["Bash(ls)"] });
        expect(written.statusLine).toEqual({
          type: "command",
          command: "echo local",
        });
        expect(written.enabledPlugins).toEqual({
          "context7@claude-plugins-official": true,
        });
      }).pipe(Effect.provide(makeTestLayer(files)));
    });

    it.effect("does not rewrite the local file when shared values already match", () => {
      const initialLocal = stringifyJsonObject({
        permissions: { allow: ["Bash(ls)"] },
        enabledPlugins: { "context7@claude-plugins-official": true },
      });
      const files: FsFiles = {
        [aiStatePath]: defaultAiStateToml,
        [sharedPath]: stringifyJsonObject({
          permissions: { allow: ["Bash(ls)"] },
        }),
        [localPath]: initialLocal,
      };

      return Effect.gen(function* () {
        const settings = yield* ClaudeSettings;
        const result = yield* settings.pull();

        expect(result.applicableKeys).toEqual(["permissions"]);
        expect(result.changedKeys).toEqual([]);
        expect(result.skippedKeys).toEqual([]);
        expect(readFile(files, localPath)).toBe(initialLocal);
      }).pipe(Effect.provide(makeTestLayer(files)));
    });
  });

  describe("adopt", () => {
    it.effect("copies a local key into the shared JSON file", () => {
      const files: FsFiles = {
        [aiStatePath]: defaultAiStateToml,
        [sharedPath]: stringifyJsonObject({
          permissions: { allow: [] },
        }),
        [localPath]: stringifyJsonObject({
          statusLine: { type: "command", command: "echo local" },
        }),
      };

      return Effect.gen(function* () {
        const settings = yield* ClaudeSettings;
        const result = yield* settings.adopt("statusLine");

        expect(result.key).toBe("statusLine");

        const shared = parseJsonObject(readFile(files, sharedPath));
        expect(shared.permissions).toEqual({ allow: [] });
        expect(shared.statusLine).toEqual({
          type: "command",
          command: "echo local",
        });
      }).pipe(Effect.provide(makeTestLayer(files)));
    });

    it.effect("fails when the local key is missing", () => {
      const files: FsFiles = {
        [aiStatePath]: defaultAiStateToml,
        [sharedPath]: stringifyJsonObject({}),
        [localPath]: stringifyJsonObject({}),
      };

      return Effect.gen(function* () {
        const settings = yield* ClaudeSettings;
        const error = yield* settings.adopt("statusLine").pipe(Effect.flip);

        expect(error).toBeInstanceOf(ClaudeSettingsError);
        if (error._tag === "ClaudeSettingsError") {
          expect(error.details).toContain('Section "statusLine" not found');
        }
      }).pipe(Effect.provide(makeTestLayer(files)));
    });
  });

  describe("ignore", () => {
    it.effect("ignore and unignore update future sync policy only", () => {
      const files: FsFiles = {
        [aiStatePath]: defaultAiStateToml,
        [aiLocalPath]: defaultAiLocalStateToml,
        [sharedPath]: stringifyJsonObject({
          permissions: { allow: ["Bash(ls)"] },
          statusLine: { type: "command", command: "echo shared" },
        }),
        [localPath]: stringifyJsonObject({
          statusLine: { type: "command", command: "echo local" },
        }),
      };

      return Effect.gen(function* () {
        const settings = yield* ClaudeSettings;

        yield* settings.ignore("statusLine");

        let localState = parse(readFile(files, aiLocalPath));
        expect(localState).toEqual({
          tools: {
            claude: { ignored_shared_sections: ["statusLine"] },
            codex: { ignored_shared_sections: [] },
          },
        });
        expect(parseJsonObject(readFile(files, sharedPath))).toEqual({
          permissions: { allow: ["Bash(ls)"] },
          statusLine: { type: "command", command: "echo shared" },
        });
        expect(parseJsonObject(readFile(files, localPath))).toEqual({
          statusLine: { type: "command", command: "echo local" },
        });

        yield* settings.unignore("statusLine");

        localState = parse(readFile(files, aiLocalPath));
        expect(localState).toEqual({
          tools: {
            claude: { ignored_shared_sections: [] },
            codex: { ignored_shared_sections: [] },
          },
        });
      }).pipe(Effect.provide(makeTestLayer(files)));
    });

    it.effect("rejects ignore for a key that is not currently shared", () => {
      const files: FsFiles = {
        [aiStatePath]: defaultAiStateToml,
        [aiLocalPath]: defaultAiLocalStateToml,
        [sharedPath]: stringifyJsonObject({
          permissions: { allow: ["Bash(ls)"] },
        }),
      };

      return Effect.gen(function* () {
        const settings = yield* ClaudeSettings;
        const error = yield* settings.ignore("statusLine").pipe(Effect.flip);

        expect(error).toBeInstanceOf(ClaudeSettingsError);
        if (error._tag === "ClaudeSettingsError") {
          expect(error.details).toContain("not currently shared");
        }
      }).pipe(Effect.provide(makeTestLayer(files)));
    });

    it.effect("rejects ignore when this machine already keeps its own value", () => {
      const files: FsFiles = {
        [aiStatePath]: defaultAiStateToml,
        [aiLocalPath]: `
[tools.claude]
ignored_shared_sections = ["statusLine"]

[tools.codex]
ignored_shared_sections = []
`.trimStart(),
        [sharedPath]: stringifyJsonObject({
          statusLine: { type: "command", command: "echo shared" },
        }),
      };

      return Effect.gen(function* () {
        const settings = yield* ClaudeSettings;
        const error = yield* settings.ignore("statusLine").pipe(Effect.flip);

        expect(error).toBeInstanceOf(ClaudeSettingsError);
        if (error._tag === "ClaudeSettingsError") {
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
        const settings = yield* ClaudeSettings;
        const error = yield* settings.unignore("statusLine").pipe(Effect.flip);

        expect(error).toBeInstanceOf(ClaudeSettingsError);
        if (error._tag === "ClaudeSettingsError") {
          expect(error.details).toContain('not keeping its own value for "statusLine"');
        }
      }).pipe(Effect.provide(makeTestLayer(files)));
    });
  });

  describe("stop managing", () => {
    it.effect("keeps a local key when it is no longer present in the shared file", () => {
      const files: FsFiles = {
        [aiStatePath]: defaultAiStateToml,
        [sharedPath]: stringifyJsonObject({
          permissions: { allow: ["Bash(ls)"] },
        }),
        [localPath]: stringifyJsonObject({
          permissions: { allow: ["Bash(old)"] },
          statusLine: { type: "command", command: "echo local" },
        }),
      };

      return Effect.gen(function* () {
        const settings = yield* ClaudeSettings;
        yield* settings.pull();

        expect(parseJsonObject(readFile(files, localPath))).toEqual({
          permissions: { allow: ["Bash(ls)"] },
          statusLine: { type: "command", command: "echo local" },
        });
      }).pipe(Effect.provide(makeTestLayer(files)));
    });
  });
});
