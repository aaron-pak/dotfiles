import { Data, Effect, FileSystem, Layer, Path, ServiceMap } from "effect";
import { parse, stringify } from "smol-toml";
import { AiLocalState } from "./AiLocalState.js";
import { AiState } from "./AiState.js";
import {
  buildManagedSettingsPreview,
  changedManagedKeys,
  mergeManagedSettings,
} from "./ManagedSettings.js";
import { StowConfig } from "./StowConfig.js";

export class CodexSettingsError extends Data.TaggedError("CodexSettingsError")<{
  readonly details: string;
}> {
  override get message() {
    return `Codex settings error: ${this.details}`;
  }
}

type SettingsObject = Record<string, unknown>;

const isRecord = (value: unknown): value is SettingsObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const neverSharedSections = ["projects"];

const readTomlObject = (
  content: string,
  filePath: string,
): Effect.Effect<SettingsObject, CodexSettingsError> =>
  Effect.try({
    try: () => parse(content),
    catch: () =>
      new CodexSettingsError({
        details: `Failed to parse ${filePath} as TOML`,
      }),
  }).pipe(
    Effect.flatMap((parsed) =>
      isRecord(parsed)
        ? Effect.succeed(parsed)
        : Effect.fail(
            new CodexSettingsError({
              details: `${filePath} must decode to a TOML table`,
            }),
          ),
    ),
  );

export class CodexSettings extends ServiceMap.Service<
  CodexSettings,
  {
    readonly localPath: string;
    readonly getSharedPath: () => Effect.Effect<string, CodexSettingsError>;
    readonly previewPull: () => Effect.Effect<
      ReturnType<typeof buildManagedSettingsPreview>,
      CodexSettingsError
    >;
    readonly pull: () => Effect.Effect<
      {
        readonly applicableKeys: readonly string[];
        readonly changedKeys: readonly string[];
        readonly skippedKeys: readonly string[];
        readonly totalKeys: number;
      },
      CodexSettingsError
    >;
    readonly adopt: (
      key: string,
    ) => Effect.Effect<{ readonly key: string }, CodexSettingsError>;
    readonly ignore: (
      key: string,
    ) => Effect.Effect<{ readonly key: string }, CodexSettingsError>;
    readonly unignore: (
      key: string,
    ) => Effect.Effect<{ readonly key: string }, CodexSettingsError>;
  }
>()("@dotfiles/CodexSettings") {
  static readonly Live = Layer.effect(
    CodexSettings,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { homeDir, dotfilesRoot } = yield* StowConfig;
      const aiState = yield* AiState;
      const aiLocalState = yield* AiLocalState;

      const localPath = path.join(homeDir, ".codex", "config.toml");

      const readTomlFile = (filePath: string) =>
        Effect.gen(function* () {
          const content = yield* fs.readFileString(filePath).pipe(
            Effect.catchIf(
              (error) => error.reason._tag === "NotFound",
              () => Effect.succeed(""),
            ),
            Effect.mapError(
              (error) =>
                new CodexSettingsError({
                  details: `Failed to read ${filePath}: ${error}`,
                }),
            ),
          );

          if (content.length === 0) {
            return {};
          }

          return yield* readTomlObject(content, filePath);
        });

      const writeTomlFile = (filePath: string, data: SettingsObject) =>
        fs.writeFileString(filePath, stringify(data)).pipe(
          Effect.mapError(
            (error) =>
              new CodexSettingsError({
                details: `Failed to write ${filePath}: ${error}`,
              }),
          ),
        );

      const getSharedPath = Effect.fn("CodexSettings.getSharedPath")(
        function* () {
          const tool = yield* aiState.getTool("codex").pipe(
            Effect.mapError(
              (error) =>
                new CodexSettingsError({
                  details: error.message,
                }),
            ),
          );
          return path.join(dotfilesRoot, tool.settings.shared_settings_file);
        },
      );

      const previewPull = Effect.fn("CodexSettings.previewPull")(function* () {
        const sharedPath = yield* getSharedPath();
        const shared = yield* readTomlFile(sharedPath);
        const ignoredSections = yield* aiLocalState
          .getIgnoredSections("codex")
          .pipe(
            Effect.mapError(
              (error) =>
                new CodexSettingsError({
                  details: error.message,
                }),
            ),
          );
        return buildManagedSettingsPreview(
          shared,
          ignoredSections,
          neverSharedSections,
        );
      });

      const pull = Effect.fn("CodexSettings.pull")(function* () {
        const preview = yield* previewPull();
        const local = yield* readTomlFile(localPath);
        const changedKeys = changedManagedKeys(local, preview.applicableShared);
        const merged = mergeManagedSettings(local, preview.applicableShared);

        if (changedKeys.length > 0) {
          yield* writeTomlFile(localPath, merged);
        }

        return {
          applicableKeys: preview.applicableKeys,
          changedKeys,
          skippedKeys: preview.skippedKeys,
          totalKeys: Object.keys(merged).length,
        };
      });

      const adopt = Effect.fn("CodexSettings.adopt")(function* (key: string) {
        if (neverSharedSections.includes(key)) {
          return yield* new CodexSettingsError({
            details: `Section "${key}" is machine-local and cannot be adopted`,
          });
        }

        const sharedPath = yield* getSharedPath();
        const shared = yield* readTomlFile(sharedPath);
        const local = yield* readTomlFile(localPath);

        if (!(key in local)) {
          return yield* new CodexSettingsError({
            details: `Section "${key}" not found in local config`,
          });
        }

        const updatedShared = {
          ...shared,
          [key]: local[key],
        };

        yield* writeTomlFile(sharedPath, updatedShared);

        return { key };
      });

      const validateIgnoreTarget = Effect.fn(
        "CodexSettings.validateIgnoreTarget",
      )(function* (key: string) {
        if (neverSharedSections.includes(key)) {
          return yield* new CodexSettingsError({
            details: `Section "${key}" is machine-local and is never shared`,
          });
        }

        const preview = yield* previewPull();

        if (preview.skippedKeys.includes(key)) {
          return yield* new CodexSettingsError({
            details: `This machine is already keeping its own value for "${key}"`,
          });
        }

        if (!preview.sharedKeys.includes(key)) {
          return yield* new CodexSettingsError({
            details: `Section "${key}" is not currently shared`,
          });
        }
      });

      const ignore = Effect.fn("CodexSettings.ignore")(function* (key: string) {
        yield* validateIgnoreTarget(key);

        return yield* aiLocalState.ignore("codex", key).pipe(
          Effect.mapError(
            (error) =>
              new CodexSettingsError({
                details: error.message,
              }),
          ),
        );
      });

      const unignore = Effect.fn("CodexSettings.unignore")(function* (
        key: string,
      ) {
        const ignoredSections = yield* aiLocalState
          .getIgnoredSections("codex")
          .pipe(
            Effect.mapError(
              (error) =>
                new CodexSettingsError({
                  details: error.message,
                }),
            ),
          );
        if (!ignoredSections.includes(key)) {
          return yield* new CodexSettingsError({
            details: `This machine is not keeping its own value for "${key}"`,
          });
        }

        return yield* aiLocalState.unignore("codex", key).pipe(
          Effect.mapError(
            (error) =>
              new CodexSettingsError({
                details: error.message,
              }),
          ),
        );
      });

      return CodexSettings.of({
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

export const CodexSettingsLive = CodexSettings.Live;
