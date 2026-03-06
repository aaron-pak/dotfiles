import { FileSystem, Path } from "@effect/platform";
import { Effect, Schema } from "effect";
import { AiLocalState } from "./AiLocalState.js";
import { AiState } from "./AiState.js";
import {
  buildManagedSettingsPreview,
  changedManagedKeys,
  mergeManagedSettings,
} from "./ManagedSettings.js";
import { StowConfig } from "./StowConfig.js";

export class ClaudeSettingsError extends Schema.TaggedError<ClaudeSettingsError>()(
  "ClaudeSettingsError",
  { details: Schema.String },
) {
  override get message() {
    return `Claude settings error: ${this.details}`;
  }
}

type SettingsObject = Record<string, unknown>;

const isRecord = (value: unknown): value is SettingsObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const jsonObjectSchema = Schema.Record({
  key: Schema.String,
  value: Schema.Unknown,
});

export class ClaudeSettings extends Effect.Service<ClaudeSettings>()(
  "@dotfiles/ClaudeSettings",
  {
    effect: Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { dotfilesRoot, homeDir } = yield* StowConfig;
      const aiState = yield* AiState;
      const aiLocalState = yield* AiLocalState;
      const decodeJsonObject = Schema.decodeUnknown(
        Schema.parseJson(jsonObjectSchema),
      );
      const encodeJsonObject = Schema.encode(
        Schema.parseJson(jsonObjectSchema, { space: 2 }),
      );

      const localPath = path.join(homeDir, ".claude", "settings.json");

      const readJsonFile = (filePath: string) =>
        Effect.gen(function* () {
          const exists = yield* fs.exists(filePath);
          if (!exists) {
            return {};
          }

          const content = yield* fs.readFileString(filePath).pipe(
            Effect.catchAll((error) =>
              ClaudeSettingsError.make({
                details: `Failed to read ${filePath}: ${error}`,
              }),
            ),
          );

          const parsed = yield* decodeJsonObject(content).pipe(
            Effect.mapError(
              () =>
                new ClaudeSettingsError({
                  details: `Failed to parse ${filePath} as JSON`,
                }),
            ),
          );

          if (!isRecord(parsed)) {
            return yield* ClaudeSettingsError.make({
              details: `${filePath} must decode to a JSON object`,
            });
          }

          return parsed;
        });

      const writeJsonFile = (filePath: string, data: SettingsObject) =>
        Effect.gen(function* () {
          const content = yield* encodeJsonObject(data).pipe(
            Effect.mapError(
              () =>
                new ClaudeSettingsError({
                  details: `Failed to encode ${filePath} as JSON`,
                }),
            ),
          );

          yield* fs.writeFileString(filePath, `${content}\n`).pipe(
            Effect.catchAll((error) =>
              ClaudeSettingsError.make({
                details: `Failed to write ${filePath}: ${error}`,
              }),
            ),
          );
        });

      const getSharedPath = Effect.fn("ClaudeSettings.getSharedPath")(
        function* () {
          const tool = yield* aiState.getTool("claude");
          return path.join(dotfilesRoot, tool.settings.shared_settings_file);
        },
      );

      const previewPull = Effect.fn("ClaudeSettings.previewPull")(function* () {
        const sharedPath = yield* getSharedPath();
        const shared = yield* readJsonFile(sharedPath);
        const ignoredSections = yield* aiLocalState.getIgnoredSections("claude");
        return buildManagedSettingsPreview(shared, ignoredSections);
      });

      const pull = Effect.fn("ClaudeSettings.pull")(function* () {
        const preview = yield* previewPull();
        const local = yield* readJsonFile(localPath);
        const changedKeys = changedManagedKeys(local, preview.applicableShared);
        const merged = mergeManagedSettings(local, preview.applicableShared);

        if (changedKeys.length > 0) {
          yield* writeJsonFile(localPath, merged);
        }

        return {
          applicableKeys: preview.applicableKeys,
          changedKeys,
          skippedKeys: preview.skippedKeys,
          totalKeys: Object.keys(merged).length,
        };
      });

      const adopt = Effect.fn("ClaudeSettings.adopt")(function* (key: string) {
        const sharedPath = yield* getSharedPath();
        const shared = yield* readJsonFile(sharedPath);
        const local = yield* readJsonFile(localPath);

        if (!(key in local)) {
          return yield* ClaudeSettingsError.make({
            details: `Section "${key}" not found in local settings`,
          });
        }

        const updatedShared = {
          ...shared,
          [key]: local[key],
        };

        yield* writeJsonFile(sharedPath, updatedShared);

        return { key };
      });

      const validateIgnoreTarget = Effect.fn(
        "ClaudeSettings.validateIgnoreTarget",
      )(function* (key: string) {
        const preview = yield* previewPull();
        if (preview.skippedKeys.includes(key)) {
          return yield* ClaudeSettingsError.make({
            details: `This machine is already keeping its own value for "${key}"`,
          });
        }

        if (!preview.sharedKeys.includes(key)) {
          return yield* ClaudeSettingsError.make({
            details: `Key "${key}" is not currently shared`,
          });
        }
      });

      const ignore = Effect.fn("ClaudeSettings.ignore")(function* (
        key: string,
      ) {
        yield* validateIgnoreTarget(key);

        return yield* aiLocalState.ignore("claude", key).pipe(
          Effect.mapError(
            (error) =>
              new ClaudeSettingsError({
                details: error.message,
              }),
          ),
        );
      });

      const unignore = Effect.fn("ClaudeSettings.unignore")(function* (
        key: string,
      ) {
        const ignoredSections = yield* aiLocalState.getIgnoredSections("claude");
        if (!ignoredSections.includes(key)) {
          return yield* ClaudeSettingsError.make({
            details: `This machine is not keeping its own value for "${key}"`,
          });
        }

        return yield* aiLocalState.unignore("claude", key).pipe(
          Effect.mapError(
            (error) =>
              new ClaudeSettingsError({
                details: error.message,
              }),
          ),
        );
      });

      return {
        localPath,
        getSharedPath,
        previewPull,
        pull,
        adopt,
        ignore,
        unignore,
      };
    }),
  },
) {}
