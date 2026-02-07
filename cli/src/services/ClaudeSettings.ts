import { FileSystem, Path } from "@effect/platform";
import { Effect, Schema } from "effect";
import { StowConfig } from "./StowConfig.js";

// -------------------------------------------------------------------------------------
// Errors
// -------------------------------------------------------------------------------------

export class ClaudeSettingsError extends Schema.TaggedError<ClaudeSettingsError>()(
  "ClaudeSettingsError",
  { details: Schema.String },
) {
  override get message() {
    return `Claude settings error: ${this.details}`;
  }
}

// -------------------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------------------

/** Top-level JSON object with unknown values. */
type SettingsObject = Record<string, unknown>;

// -------------------------------------------------------------------------------------
// Service
// -------------------------------------------------------------------------------------

export class ClaudeSettings extends Effect.Service<ClaudeSettings>()(
  "@dotfiles/ClaudeSettings",
  {
    effect: Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { dotfilesRoot, homeDir } = yield* StowConfig;

      const sharedPath = path.join(
        dotfilesRoot,
        "config",
        "claude-settings-shared.json",
      );
      const localPath = path.join(homeDir, ".claude", "settings.json");

      /** Read and parse a JSON file, returning {} if it doesn't exist. */
      const readJsonFile = (filePath: string) =>
        Effect.gen(function* () {
          const exists = yield* fs.exists(filePath);
          if (!exists) return {} as SettingsObject;

          const content = yield* fs.readFileString(filePath).pipe(
            Effect.catchAll((error) =>
              ClaudeSettingsError.make({
                details: `Failed to read ${filePath}: ${error}`,
              }),
            ),
          );

          return yield* Effect.try({
            try: () => JSON.parse(content) as SettingsObject,
            catch: () =>
              new ClaudeSettingsError({
                details: `Failed to parse ${filePath} as JSON`,
              }),
          });
        });

      /** Write a JSON object to a file. */
      const writeJsonFile = (filePath: string, data: SettingsObject) =>
        fs.writeFileString(filePath, JSON.stringify(data, null, 2) + "\n").pipe(
          Effect.catchAll((error) =>
            ClaudeSettingsError.make({
              details: `Failed to write ${filePath}: ${error}`,
            }),
          ),
        );

      /**
       * Pull shared settings into local settings.json.
       * For each key in shared, overwrite in local. Non-shared keys untouched.
       */
      const pull = Effect.fn("ClaudeSettings.pull")(function* () {
        const shared = yield* readJsonFile(sharedPath);
        const local = yield* readJsonFile(localPath);

        const merged = { ...local, ...shared };

        yield* writeJsonFile(localPath, merged);

        return {
          updatedKeys: Object.keys(shared),
          totalKeys: Object.keys(merged).length,
        };
      });

      /**
       * Push local values for shared keys back to the shared file.
       * Only updates keys that already exist in shared.
       */
      const push = Effect.fn("ClaudeSettings.push")(function* () {
        const shared = yield* readJsonFile(sharedPath);
        const local = yield* readJsonFile(localPath);

        const updatedShared: SettingsObject = {};
        const updatedKeys: string[] = [];

        for (const key of Object.keys(shared)) {
          if (key in local) {
            updatedShared[key] = local[key];
            updatedKeys.push(key);
          } else {
            updatedShared[key] = shared[key];
          }
        }

        yield* writeJsonFile(sharedPath, updatedShared);

        return { updatedKeys };
      });

      /**
       * Start sharing a top-level property.
       * Copies the current local value to the shared file.
       */
      const share = Effect.fn("ClaudeSettings.share")(function* (key: string) {
        const shared = yield* readJsonFile(sharedPath);
        const local = yield* readJsonFile(localPath);

        if (!(key in local)) {
          return yield* ClaudeSettingsError.make({
            details: `Key "${key}" not found in local settings`,
          });
        }

        if (key in shared) {
          return yield* ClaudeSettingsError.make({
            details: `Key "${key}" is already shared`,
          });
        }

        shared[key] = local[key];
        yield* writeJsonFile(sharedPath, shared);

        return { key };
      });

      /**
       * Stop sharing a top-level property.
       * Removes it from the shared file. Local value is preserved.
       */
      const unshare = Effect.fn("ClaudeSettings.unshare")(function* (
        key: string,
      ) {
        const shared = yield* readJsonFile(sharedPath);

        if (!(key in shared)) {
          return yield* ClaudeSettingsError.make({
            details: `Key "${key}" is not shared`,
          });
        }

        const { [key]: _, ...rest } = shared;
        yield* writeJsonFile(sharedPath, rest);

        return { key };
      });

      /** Read the shared settings file (for dry-run previews). */
      const readShared = Effect.fn("ClaudeSettings.readShared")(function* () {
        return yield* readJsonFile(sharedPath);
      });

      return {
        readShared,
        pull,
        push,
        share,
        unshare,
        sharedPath,
        localPath,
      };
    }),
  },
) {}
