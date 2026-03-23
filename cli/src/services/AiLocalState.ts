import { Data, Effect, FileSystem, Layer, Path, ServiceMap } from 'effect';
import { parse, stringify } from 'smol-toml';
import type { ManagedTool } from './AiState.js';
import { StowConfig } from './StowConfig.js';
import { errorMessage } from './errorMessage.js';

export class AiLocalStateError extends Data.TaggedError('AiLocalStateError')<{
  readonly details: string;
}> {
  override get message() {
    return `AI local state error: ${this.details}`;
  }
}

type ToolLocalState = {
  readonly ignored_shared_sections: readonly string[];
};

export type AiLocalStateData = {
  readonly tools: {
    readonly claude: ToolLocalState;
    readonly codex: ToolLocalState;
  };
};

const failAiLocalState = (details: string) =>
  Effect.failSync(() => new AiLocalStateError({ details }));

const isString = (value: unknown): value is string => typeof value === 'string';

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every(isString);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const emptyToolLocalState = (): ToolLocalState => ({
  ignored_shared_sections: [],
});

const makeDefaultAiLocalState = (): AiLocalStateData => ({
  tools: {
    claude: emptyToolLocalState(),
    codex: emptyToolLocalState(),
  },
});

const normalizeSections = (sections: readonly string[]) =>
  [...new Set(sections)].sort((left, right) => left.localeCompare(right));

const parseToolLocalState = (
  tool: ManagedTool,
  value: unknown,
): Effect.Effect<ToolLocalState, AiLocalStateError> => {
  if (value === undefined) {
    return Effect.succeed(emptyToolLocalState());
  }

  if (!isRecord(value)) {
    return failAiLocalState(`tools.${tool} must be a table`);
  }

  const ignoredSections = value.ignored_shared_sections;

  if (ignoredSections === undefined) {
    return Effect.succeed(emptyToolLocalState());
  }

  if (!isStringArray(ignoredSections)) {
    return failAiLocalState(`tools.${tool}.ignored_shared_sections must be a string array`);
  }

  return Effect.succeed({
    ignored_shared_sections: normalizeSections(ignoredSections),
  });
};

const decodeAiLocalState = (value: unknown): Effect.Effect<AiLocalStateData, AiLocalStateError> =>
  Effect.gen(function* () {
    if (!isRecord(value)) {
      return yield* new AiLocalStateError({
        details: 'ai-local state must be a TOML table',
      });
    }

    const tools = value.tools;
    if (tools !== undefined && !isRecord(tools)) {
      return yield* new AiLocalStateError({
        details: 'tools must be a table',
      });
    }

    const toolValues = tools ?? {};

    return {
      tools: {
        claude: yield* parseToolLocalState('claude', toolValues.claude),
        codex: yield* parseToolLocalState('codex', toolValues.codex),
      },
    };
  });

export class AiLocalState extends ServiceMap.Service<
  AiLocalState,
  {
    readonly localStatePath: string;
    readonly read: () => Effect.Effect<AiLocalStateData, AiLocalStateError>;
    readonly write: (state: AiLocalStateData) => Effect.Effect<void, AiLocalStateError>;
    readonly getIgnoredSections: (
      tool: ManagedTool,
    ) => Effect.Effect<readonly string[], AiLocalStateError>;
    readonly ignore: (
      tool: ManagedTool,
      section: string,
    ) => Effect.Effect<{ readonly key: string }, AiLocalStateError>;
    readonly unignore: (
      tool: ManagedTool,
      section: string,
    ) => Effect.Effect<{ readonly key: string }, AiLocalStateError>;
  }
>()('@dotfiles/AiLocalState') {
  static readonly Live = Layer.effect(
    AiLocalState,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { homeDir } = yield* StowConfig;

      const localStatePath = path.join(homeDir, '.config', 'dot', 'ai-local.toml');

      const read = Effect.fn('AiLocalState.read')(function* () {
        const exists = yield* fs.exists(localStatePath).pipe(
          Effect.mapError(
            (error) =>
              new AiLocalStateError({
                details: `Failed to check ${localStatePath}: ${errorMessage(error)}`,
              }),
          ),
        );
        if (!exists) {
          return makeDefaultAiLocalState();
        }

        const content = yield* fs.readFileString(localStatePath).pipe(
          Effect.mapError(
            (error) =>
              new AiLocalStateError({
                details: `Failed to read ${localStatePath}: ${errorMessage(error)}`,
              }),
          ),
        );

        const parsed = yield* Effect.try({
          try: () => parse(content),
          catch: () =>
            new AiLocalStateError({
              details: `Failed to parse ${localStatePath} as TOML`,
            }),
        });

        return yield* decodeAiLocalState(parsed);
      });

      const write = Effect.fn('AiLocalState.write')(function* (state: AiLocalStateData) {
        const stateDirectory = path.dirname(localStatePath);
        yield* fs.makeDirectory(stateDirectory, { recursive: true }).pipe(
          Effect.mapError(
            (error) =>
              new AiLocalStateError({
                details: `Failed to create ${stateDirectory}: ${errorMessage(error)}`,
              }),
          ),
        );

        const toml = stringify({
          tools: {
            claude: {
              ignored_shared_sections: [...state.tools.claude.ignored_shared_sections],
            },
            codex: {
              ignored_shared_sections: [...state.tools.codex.ignored_shared_sections],
            },
          },
        });

        yield* fs.writeFileString(localStatePath, toml).pipe(
          Effect.mapError(
            (error) =>
              new AiLocalStateError({
                details: `Failed to write ${localStatePath}: ${errorMessage(error)}`,
              }),
          ),
        );
      });

      const getIgnoredSections = Effect.fn('AiLocalState.getIgnoredSections')(function* (
        tool: ManagedTool,
      ) {
        const state = yield* read();
        return tool === 'claude'
          ? state.tools.claude.ignored_shared_sections
          : state.tools.codex.ignored_shared_sections;
      });

      const ignore = Effect.fn('AiLocalState.ignore')(function* (
        tool: ManagedTool,
        section: string,
      ) {
        const state = yield* read();
        const current =
          tool === 'claude'
            ? state.tools.claude.ignored_shared_sections
            : state.tools.codex.ignored_shared_sections;

        const nextToolState: ToolLocalState = {
          ignored_shared_sections: normalizeSections([...current, section]),
        };

        const nextState: AiLocalStateData =
          tool === 'claude'
            ? {
                tools: {
                  claude: nextToolState,
                  codex: state.tools.codex,
                },
              }
            : {
                tools: {
                  claude: state.tools.claude,
                  codex: nextToolState,
                },
              };

        yield* write(nextState);
        return { key: section };
      });

      const unignore = Effect.fn('AiLocalState.unignore')(function* (
        tool: ManagedTool,
        section: string,
      ) {
        const state = yield* read();
        const current =
          tool === 'claude'
            ? state.tools.claude.ignored_shared_sections
            : state.tools.codex.ignored_shared_sections;

        const nextToolState: ToolLocalState = {
          ignored_shared_sections: current.filter((entry) => entry !== section),
        };

        const nextState: AiLocalStateData =
          tool === 'claude'
            ? {
                tools: {
                  claude: nextToolState,
                  codex: state.tools.codex,
                },
              }
            : {
                tools: {
                  claude: state.tools.claude,
                  codex: nextToolState,
                },
              };

        yield* write(nextState);
        return { key: section };
      });

      return AiLocalState.of({
        localStatePath,
        read,
        write,
        getIgnoredSections,
        ignore,
        unignore,
      });
    }),
  );
}

export const AiLocalStateLive = AiLocalState.Live;
