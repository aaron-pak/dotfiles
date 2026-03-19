import {
  Data,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Schema,
  ServiceMap,
} from "effect";
import * as SchemaGetter from "effect/SchemaGetter";
import { AiLocalState } from "./AiLocalState.js";
import { AiState } from "./AiState.js";
import {
  buildManagedSettingsPreview,
  changedManagedKeys,
  mergeManagedSettings,
} from "./ManagedSettings.js";
import { StowConfig } from "./StowConfig.js";

export class ClaudeSettingsError extends Data.TaggedError(
  "ClaudeSettingsError",
)<{
  readonly details: string;
}> {
  override get message() {
    return `Claude settings error: ${this.details}`;
  }
}

type SettingsObject = Record<string, unknown>;

const jsonObjectFromString = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Unknown),
);

const decodeJsonObject = Schema.decodeUnknownSync(jsonObjectFromString);
const stringifyJson = SchemaGetter.stringifyJson({ space: 2 });
const readJsonObject = (
  content: string,
  filePath: string,
): Effect.Effect<SettingsObject, ClaudeSettingsError> =>
  Effect.try({
    try: () => decodeJsonObject(content),
    catch: () =>
      new ClaudeSettingsError({
        details: `Failed to parse ${filePath} as JSON`,
      }),
  });

const encodeJsonObject = (
  filePath: string,
  data: SettingsObject,
): Effect.Effect<string, ClaudeSettingsError> =>
  stringifyJson.run(Option.some(data), {}).pipe(
    Effect.mapError(
      () =>
        new ClaudeSettingsError({
          details: `Failed to encode ${filePath} as JSON`,
        }),
    ),
    Effect.flatMap((encoded) =>
      Option.match(encoded, {
        onNone: () =>
          Effect.fail(
            new ClaudeSettingsError({
              details: `Failed to encode ${filePath} as JSON`,
            }),
          ),
        onSome: Effect.succeed,
      }),
    ),
  );

export class ClaudeSettings extends ServiceMap.Service<
  ClaudeSettings,
  {
    readonly localPath: string;
    readonly getSharedPath: () => Effect.Effect<string, ClaudeSettingsError>;
    readonly previewPull: () => Effect.Effect<
      ReturnType<typeof buildManagedSettingsPreview>,
      ClaudeSettingsError
    >;
    readonly pull: () => Effect.Effect<
      {
        readonly applicableKeys: readonly string[];
        readonly changedKeys: readonly string[];
        readonly skippedKeys: readonly string[];
        readonly totalKeys: number;
      },
      ClaudeSettingsError
    >;
    readonly adopt: (
      key: string,
    ) => Effect.Effect<{ readonly key: string }, ClaudeSettingsError>;
    readonly ignore: (
      key: string,
    ) => Effect.Effect<{ readonly key: string }, ClaudeSettingsError>;
    readonly unignore: (
      key: string,
    ) => Effect.Effect<{ readonly key: string }, ClaudeSettingsError>;
  }
>()("@dotfiles/ClaudeSettings") {
  static readonly Live = Layer.effect(
    ClaudeSettings,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { dotfilesRoot, homeDir } = yield* StowConfig;
      const aiState = yield* AiState;
      const aiLocalState = yield* AiLocalState;

      const localPath = path.join(homeDir, ".claude", "settings.json");

      const readJsonFile = (filePath: string) =>
        Effect.gen(function* () {
          const content = yield* fs.readFileString(filePath).pipe(
            Effect.catchIf(
              (error) => error.reason._tag === "NotFound",
              () => Effect.succeed(""),
            ),
            Effect.mapError(
              (error) =>
                new ClaudeSettingsError({
                  details: `Failed to read ${filePath}: ${error}`,
                }),
            ),
          );

          if (content.length === 0) {
            return {};
          }

          return yield* readJsonObject(content, filePath);
        });

      const writeJsonFile = (filePath: string, data: SettingsObject) =>
        Effect.gen(function* () {
          const parentDirectory = path.dirname(filePath);
          yield* fs.makeDirectory(parentDirectory, { recursive: true }).pipe(
            Effect.mapError(
              (error) =>
                new ClaudeSettingsError({
                  details: `Failed to create ${parentDirectory}: ${error}`,
                }),
            ),
          );

          const content = yield* encodeJsonObject(filePath, data);
          yield* fs.writeFileString(filePath, `${content}\n`).pipe(
            Effect.mapError(
              (error) =>
                new ClaudeSettingsError({
                  details: `Failed to write ${filePath}: ${error}`,
                }),
            ),
          );
        });

      const getSharedPath = Effect.fn("ClaudeSettings.getSharedPath")(
        function* () {
          const tool = yield* aiState.getTool("claude").pipe(
            Effect.mapError(
              (error) =>
                new ClaudeSettingsError({
                  details: error.message,
                }),
            ),
          );
          return path.join(dotfilesRoot, tool.settings.shared_settings_file);
        },
      );

      const previewPull = Effect.fn("ClaudeSettings.previewPull")(function* () {
        const sharedPath = yield* getSharedPath();
        const shared = yield* readJsonFile(sharedPath);
        const ignoredSections = yield* aiLocalState
          .getIgnoredSections("claude")
          .pipe(
            Effect.mapError(
              (error) =>
                new ClaudeSettingsError({
                  details: error.message,
                }),
            ),
          );
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
          return yield* new ClaudeSettingsError({
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
          return yield* new ClaudeSettingsError({
            details: `This machine is already keeping its own value for "${key}"`,
          });
        }

        if (!preview.sharedKeys.includes(key)) {
          return yield* new ClaudeSettingsError({
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
        const ignoredSections = yield* aiLocalState
          .getIgnoredSections("claude")
          .pipe(
            Effect.mapError(
              (error) =>
                new ClaudeSettingsError({
                  details: error.message,
                }),
          ),
          );
        if (!ignoredSections.includes(key)) {
          return yield* new ClaudeSettingsError({
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

      return ClaudeSettings.of({
        localPath,
        getSharedPath,
        previewPull,
        pull,
        adopt,
        ignore,
        unignore,
      });
    }),
  );
}

export const ClaudeSettingsLive = ClaudeSettings.Live;
