import {
  Effect,
  FileSystem,
  Layer,
  Path,
  PlatformError,
  Schema,
  Sink,
  Stream,
} from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { StowConfig } from "../src/services/StowConfig.js";

export const testDotfilesRoot = "/test/dotfiles";
export const testHomeDir = "/test/home";

export const TestStowConfig = Layer.succeed(StowConfig)({
  dotfilesRoot: testDotfilesRoot,
  homeDir: testHomeDir,
});

export const TestPath = Path.layer;

const encoder = new TextEncoder();

export type FsFiles = Record<string, string>;

export const readFile = (files: FsFiles, path: string): string => {
  const content = files[path];
  if (content === undefined) {
    throw new Error(`Test file not found: ${path}`);
  }
  return content;
};

const jsonObjectFromString = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Unknown),
);
const decodeJsonObject = Schema.decodeUnknownSync(jsonObjectFromString);
const encodeJsonObject = Schema.encodeSync(jsonObjectFromString);

export const parseJsonObject = (content: string): Record<string, unknown> =>
  decodeJsonObject(content);

export const stringifyJsonObject = (value: Record<string, unknown>) =>
  `${encodeJsonObject(value)}\n`;

const notFound = (method: string, path: string) =>
  PlatformError.systemError({
    _tag: "NotFound",
    module: "FileSystem",
    method,
    pathOrDescriptor: path,
  });

export const makeMockFs = (files: FsFiles) =>
  FileSystem.layerNoop({
    exists: (path) => Effect.succeed(path in files),
    makeDirectory: () => Effect.void,
    readFileString: (path) => {
      const content = files[path];
      return content !== undefined
        ? Effect.succeed(content)
        : Effect.fail(notFound("readFileString", path));
    },
    writeFileString: (path, content) =>
      Effect.sync(() => {
        files[path] = content;
      }),
  });

export const makeTestBaseLayer = (files: FsFiles) =>
  Layer.mergeAll(makeMockFs(files), TestStowConfig, TestPath);

type MockChildProcessResult = {
  readonly exitCode: number;
  readonly stdout?: string;
  readonly stderr?: string;
};

export const makeMockChildProcessHandle = ({
  exitCode,
  stdout = "",
  stderr = "",
}: MockChildProcessResult) =>
  ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(exitCode)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    stdin: Sink.drain,
    stdout:
      stdout.length > 0 ? Stream.make(encoder.encode(stdout)) : Stream.empty,
    stderr:
      stderr.length > 0 ? Stream.make(encoder.encode(stderr)) : Stream.empty,
    all:
      stdout.length > 0 || stderr.length > 0
        ? Stream.make(encoder.encode(stdout + stderr))
        : Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });

export const makeMockChildProcessSpawner = (result: MockChildProcessResult) =>
  Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make(() =>
      Effect.succeed(makeMockChildProcessHandle(result)),
    ),
  );

export const makeFailingChildProcessSpawner = (pathOrDescriptor: string) =>
  Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make(() =>
      Effect.fail(
        PlatformError.systemError({
          _tag: "NotFound",
          module: "Command",
          method: "spawn",
          pathOrDescriptor,
        }),
      ),
    ),
  );

export const defaultAiStateToml = `
[instructions]
canonical = "home/.claude/CLAUDE.md"

[tools.claude.settings]
shared_settings_file = "ai/claude-settings-shared.json"

[tools.codex.settings]
shared_settings_file = "ai/codex-settings-shared.toml"

[skills.batch]
canonical_dir = "ai/skills/batch"
targets = ["claude", "codex", "agents"]

[skills.doc]
canonical_dir = "ai/skills/doc"
targets = ["codex"]

[skills.frontend-design]
canonical_dir = "ai/skills/frontend-design"
targets = ["claude", "codex", "agents"]

[skills.next-task]
canonical_dir = "ai/skills/next-task"
targets = ["claude"]

[skills.openai-docs]
canonical_dir = "ai/skills/openai-docs"
targets = ["codex"]

[skills.playwright]
canonical_dir = "ai/skills/playwright"
targets = ["codex"]

[skills.progress]
canonical_dir = "ai/skills/progress"
targets = ["claude"]

[skills.simplify]
canonical_dir = "ai/skills/simplify"
targets = ["claude", "codex", "agents"]

[skills.task-list]
canonical_dir = "ai/skills/task-list"
targets = ["claude"]
`.trimStart();

export const defaultAiLocalStateToml = `
[tools.claude]
ignored_shared_sections = []

[tools.codex]
ignored_shared_sections = []
`.trimStart();
