import { Error as PlatformError, FileSystem, Path } from "@effect/platform";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import {
  ClaudeSettings,
  ClaudeSettingsError,
} from "../src/services/ClaudeSettings.js";
import { StowConfig } from "../src/services/StowConfig.js";

// Test paths
const testDotfilesRoot = "/test/dotfiles";
const testHomeDir = "/test/home";

const TestStowConfig = Layer.succeed(
  StowConfig,
  StowConfig.make({
    dotfilesRoot: testDotfilesRoot,
    homeDir: testHomeDir,
  }),
);

const TestPath = Path.layer;

// In-memory file system for testing
type FsFiles = Record<string, string>;

/** Safely read a file from the mock fs map. */
const readFile = (files: FsFiles, path: string): string => {
  const content = files[path];
  if (content === undefined) throw new Error(`Test file not found: ${path}`);
  return content;
};

const makeMockFs = (files: FsFiles) =>
  FileSystem.layerNoop({
    exists: (path) => Effect.succeed(path in files),
    readFileString: (path) => {
      const content = files[path];
      return content !== undefined
        ? Effect.succeed(content)
        : Effect.fail(
            new PlatformError.SystemError({
              reason: "NotFound",
              module: "FileSystem",
              method: "readFileString",
              pathOrDescriptor: path,
            }),
          );
    },
    writeFileString: (path, content) =>
      Effect.sync(() => {
        files[path] = content;
      }),
  });

const makeTestLayer = (files: FsFiles) =>
  ClaudeSettings.Default.pipe(
    Layer.provideMerge(makeMockFs(files)),
    Layer.provideMerge(TestStowConfig),
    Layer.provideMerge(TestPath),
  );

const sharedPath = "/test/dotfiles/config/claude-settings-shared.json";
const localPath = "/test/home/.claude/settings.json";

describe("ClaudeSettings service", () => {
  describe("pull", () => {
    it.effect("creates local settings from shared when no local exists", () => {
      const files: FsFiles = {
        [sharedPath]: JSON.stringify({
          permissions: { allow: ["Bash(ls)"] },
          hooks: {},
        }),
      };

      return Effect.gen(function* () {
        const settings = yield* ClaudeSettings;
        const result = yield* settings.pull();

        expect(result.updatedKeys).toEqual(["permissions", "hooks"]);
        expect(result.totalKeys).toBe(2);

        const written = JSON.parse(readFile(files, localPath));
        expect(written.permissions).toEqual({ allow: ["Bash(ls)"] });
        expect(written.hooks).toEqual({});
      }).pipe(Effect.provide(makeTestLayer(files)));
    });

    it.effect("overwrites shared keys but preserves local-only keys", () => {
      const files: FsFiles = {
        [sharedPath]: JSON.stringify({
          permissions: { allow: ["Bash(ls)"] },
        }),
        [localPath]: JSON.stringify({
          permissions: { allow: ["Bash(old)"] },
          enabledPlugins: { "context7@claude-plugins-official": true },
        }),
      };

      return Effect.gen(function* () {
        const settings = yield* ClaudeSettings;
        const result = yield* settings.pull();

        expect(result.updatedKeys).toEqual(["permissions"]);
        expect(result.totalKeys).toBe(2);

        const written = JSON.parse(readFile(files, localPath));
        expect(written.permissions).toEqual({ allow: ["Bash(ls)"] });
        expect(written.enabledPlugins).toEqual({
          "context7@claude-plugins-official": true,
        });
      }).pipe(Effect.provide(makeTestLayer(files)));
    });

    it.effect("returns empty when no shared file exists", () => {
      const files: FsFiles = {
        [localPath]: JSON.stringify({ enabledPlugins: {} }),
      };

      return Effect.gen(function* () {
        const settings = yield* ClaudeSettings;
        const result = yield* settings.pull();

        expect(result.updatedKeys).toEqual([]);
        expect(result.totalKeys).toBe(1);
      }).pipe(Effect.provide(makeTestLayer(files)));
    });
  });

  describe("push", () => {
    it.effect("updates shared file with local values for shared keys", () => {
      const files: FsFiles = {
        [sharedPath]: JSON.stringify({
          permissions: { allow: ["Bash(ls)"] },
          hooks: {},
        }),
        [localPath]: JSON.stringify({
          permissions: { allow: ["Bash(ls)", "Bash(git status*)"] },
          hooks: { Notification: [] },
          enabledPlugins: {},
        }),
      };

      return Effect.gen(function* () {
        const settings = yield* ClaudeSettings;
        const result = yield* settings.push();

        expect(result.updatedKeys).toEqual(["permissions", "hooks"]);

        const written = JSON.parse(readFile(files, sharedPath));
        expect(written.permissions).toEqual({
          allow: ["Bash(ls)", "Bash(git status*)"],
        });
        expect(written.hooks).toEqual({ Notification: [] });
        // enabledPlugins should NOT be in shared
        expect(written.enabledPlugins).toBeUndefined();
      }).pipe(Effect.provide(makeTestLayer(files)));
    });

    it.effect("keeps shared value when key is missing from local", () => {
      const files: FsFiles = {
        [sharedPath]: JSON.stringify({
          permissions: { allow: [] },
          hooks: {},
        }),
        [localPath]: JSON.stringify({
          permissions: { allow: ["Bash(ls)"] },
        }),
      };

      return Effect.gen(function* () {
        const settings = yield* ClaudeSettings;
        const result = yield* settings.push();

        expect(result.updatedKeys).toEqual(["permissions"]);

        const written = JSON.parse(readFile(files, sharedPath));
        expect(written.hooks).toEqual({});
      }).pipe(Effect.provide(makeTestLayer(files)));
    });
  });

  describe("share", () => {
    it.effect("adds a local key to the shared file", () => {
      const files: FsFiles = {
        [sharedPath]: JSON.stringify({
          permissions: { allow: [] },
        }),
        [localPath]: JSON.stringify({
          permissions: { allow: [] },
          statusLine: { type: "command", command: "echo hi" },
        }),
      };

      return Effect.gen(function* () {
        const settings = yield* ClaudeSettings;
        const result = yield* settings.share("statusLine");

        expect(result.key).toBe("statusLine");

        const written = JSON.parse(readFile(files, sharedPath));
        expect(written.statusLine).toEqual({
          type: "command",
          command: "echo hi",
        });
        expect(written.permissions).toEqual({ allow: [] });
      }).pipe(Effect.provide(makeTestLayer(files)));
    });

    it.effect("fails when key not found in local settings", () => {
      const files: FsFiles = {
        [sharedPath]: JSON.stringify({}),
        [localPath]: JSON.stringify({}),
      };

      return Effect.gen(function* () {
        const settings = yield* ClaudeSettings;
        const error = yield* settings.share("nonexistent").pipe(Effect.flip);

        expect(error).toBeInstanceOf(ClaudeSettingsError);
        if (error._tag === "ClaudeSettingsError") {
          expect(error.details).toContain("not found in local settings");
        }
      }).pipe(Effect.provide(makeTestLayer(files)));
    });

    it.effect("fails when key is already shared", () => {
      const files: FsFiles = {
        [sharedPath]: JSON.stringify({ permissions: {} }),
        [localPath]: JSON.stringify({ permissions: {} }),
      };

      return Effect.gen(function* () {
        const settings = yield* ClaudeSettings;
        const error = yield* settings.share("permissions").pipe(Effect.flip);

        expect(error).toBeInstanceOf(ClaudeSettingsError);
        if (error._tag === "ClaudeSettingsError") {
          expect(error.details).toContain("already shared");
        }
      }).pipe(Effect.provide(makeTestLayer(files)));
    });
  });

  describe("unshare", () => {
    it.effect("removes a key from the shared file", () => {
      const files: FsFiles = {
        [sharedPath]: JSON.stringify({
          permissions: { allow: [] },
          hooks: {},
        }),
      };

      return Effect.gen(function* () {
        const settings = yield* ClaudeSettings;
        const result = yield* settings.unshare("hooks");

        expect(result.key).toBe("hooks");

        const written = JSON.parse(readFile(files, sharedPath));
        expect(written.hooks).toBeUndefined();
        expect(written.permissions).toEqual({ allow: [] });
      }).pipe(Effect.provide(makeTestLayer(files)));
    });

    it.effect("fails when key is not shared", () => {
      const files: FsFiles = {
        [sharedPath]: JSON.stringify({ permissions: {} }),
      };

      return Effect.gen(function* () {
        const settings = yield* ClaudeSettings;
        const error = yield* settings.unshare("nonexistent").pipe(Effect.flip);

        expect(error).toBeInstanceOf(ClaudeSettingsError);
        if (error._tag === "ClaudeSettingsError") {
          expect(error.details).toContain("not shared");
        }
      }).pipe(Effect.provide(makeTestLayer(files)));
    });
  });

  describe("readShared", () => {
    it.effect("returns empty object when shared file doesn't exist", () => {
      const files: FsFiles = {};

      return Effect.gen(function* () {
        const settings = yield* ClaudeSettings;
        const shared = yield* settings.readShared();
        expect(shared).toEqual({});
      }).pipe(Effect.provide(makeTestLayer(files)));
    });

    it.effect("returns parsed shared settings", () => {
      const files: FsFiles = {
        [sharedPath]: JSON.stringify({ permissions: { allow: ["Bash(ls)"] } }),
      };

      return Effect.gen(function* () {
        const settings = yield* ClaudeSettings;
        const shared = yield* settings.readShared();
        expect(shared).toEqual({ permissions: { allow: ["Bash(ls)"] } });
      }).pipe(Effect.provide(makeTestLayer(files)));
    });
  });
});
