import { Error as PlatformError, FileSystem, Path } from "@effect/platform";
import { Effect, Layer, Schema } from "effect";
import { StowConfig } from "../src/services/StowConfig.js";

export const testDotfilesRoot = "/test/dotfiles";
export const testHomeDir = "/test/home";

export const TestStowConfig = Layer.succeed(
  StowConfig,
  StowConfig.make({
    dotfilesRoot: testDotfilesRoot,
    homeDir: testHomeDir,
  }),
);

export const TestPath = Path.layer;

export type FsFiles = Record<string, string>;

export const readFile = (files: FsFiles, path: string): string => {
  const content = files[path];
  if (content === undefined) {
    throw new Error(`Test file not found: ${path}`);
  }
  return content;
};

const decodeJson = Schema.decodeUnknownSync(Schema.parseJson());
const encodeJson = Schema.encodeSync(Schema.parseJson({ space: 2 }));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const parseJsonObject = (content: string): Record<string, unknown> => {
  const parsed = decodeJson(content);
  if (!isRecord(parsed)) {
    throw new Error("Expected JSON object");
  }
  return parsed;
};

export const stringifyJsonObject = (value: Record<string, unknown>) =>
  `${encodeJson(value)}\n`;

const notFound = (method: string, path: string) =>
  new PlatformError.SystemError({
    reason: "NotFound",
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
