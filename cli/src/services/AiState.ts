import { FileSystem, Path } from "@effect/platform";
import { Effect, Schema } from "effect";
import { parse, stringify } from "smol-toml";
import { StowConfig } from "./StowConfig.js";

export class AiStateError extends Schema.TaggedError<AiStateError>()(
  "AiStateError",
  { details: Schema.String },
) {
  override get message() {
    return `AI state error: ${this.details}`;
  }
}

export type ManagedTool = "claude" | "codex";
export type SkillTarget = "claude" | "codex" | "agents";

type InstructionsState = {
  readonly canonical: string;
};

type ToolSettingsState = {
  readonly shared_settings_file: string;
};

type ToolState = {
  readonly settings: ToolSettingsState;
};

export type ManagedSkillState = {
  readonly canonical_dir: string;
  readonly targets: readonly SkillTarget[];
};

export type AiStateData = {
  readonly instructions: InstructionsState;
  readonly tools: {
    readonly claude: ToolState;
    readonly codex: ToolState;
  };
  readonly skills: Record<string, ManagedSkillState>;
};

const skillTargets: readonly SkillTarget[] = ["claude", "codex", "agents"];
const isSkillTarget = (value: string): value is SkillTarget =>
  value === "claude" || value === "codex" || value === "agents";

const isString = (value: unknown): value is string => typeof value === "string";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeTargets = (
  targets: readonly SkillTarget[],
): readonly SkillTarget[] =>
  [...new Set(targets)].sort((left, right) =>
    skillTargets.indexOf(left) - skillTargets.indexOf(right),
  );

const parseTargets = (
  skillName: string,
  value: unknown,
): Effect.Effect<readonly SkillTarget[], AiStateError> => {
  if (!Array.isArray(value) || !value.every(isString)) {
    return AiStateError.make({
      details: `skills.${skillName}.targets must be a string array`,
    });
  }

  const targets: SkillTarget[] = [];
  for (const target of value) {
    if (!isSkillTarget(target)) {
      return AiStateError.make({
        details: `skills.${skillName}.targets contains invalid target "${target}"`,
      });
    }
    targets.push(target);
  }

  return Effect.succeed(normalizeTargets(targets));
};

const parseManagedSkill = (
  skillName: string,
  value: unknown,
): Effect.Effect<ManagedSkillState, AiStateError> => {
  if (!isRecord(value)) {
    return AiStateError.make({
      details: `skills.${skillName} must be a table`,
    });
  }

  const canonicalDir = value.canonical_dir;
  if (!isString(canonicalDir)) {
    return AiStateError.make({
      details: `skills.${skillName}.canonical_dir must be a string`,
    });
  }

  return Effect.gen(function* () {
    const targets = yield* parseTargets(skillName, value.targets);
    if (targets.length === 0) {
      return yield* AiStateError.make({
        details: `skills.${skillName}.targets must contain at least one target`,
      });
    }

    return {
      canonical_dir: canonicalDir,
      targets,
    };
  });
};

const parseToolSettings = (
  tool: ManagedTool,
  value: unknown,
): Effect.Effect<ToolSettingsState, AiStateError> => {
  if (!isRecord(value)) {
    return AiStateError.make({
      details: `tools.${tool}.settings must be a table`,
    });
  }

  const sharedSettingsFile = value.shared_settings_file;
  if (!isString(sharedSettingsFile)) {
    return AiStateError.make({
      details: `tools.${tool}.settings.shared_settings_file must be a string`,
    });
  }

  return Effect.succeed({
    shared_settings_file: sharedSettingsFile,
  });
};

const decodeAiState = (
  value: unknown,
): Effect.Effect<AiStateData, AiStateError> =>
  Effect.gen(function* () {
    if (!isRecord(value)) {
      return yield* AiStateError.make({
        details: "ai/state.toml must be a TOML table",
      });
    }

    const instructions = value.instructions;
    const tools = value.tools;
    const skillsValue = value.skills;

    if (!isRecord(instructions) || !isString(instructions.canonical)) {
      return yield* AiStateError.make({
        details: "instructions.canonical must be a string",
      });
    }

    if (!isRecord(tools)) {
      return yield* AiStateError.make({
        details: "tools must be a table",
      });
    }

    if (skillsValue !== undefined && !isRecord(skillsValue)) {
      return yield* AiStateError.make({
        details: "skills must be a table",
      });
    }

    const parseTool = (tool: ManagedTool) =>
      Effect.gen(function* () {
        const toolValue = tools[tool];
        if (!isRecord(toolValue)) {
          return yield* AiStateError.make({
            details: `tools.${tool} must be a table`,
          });
        }

        return {
          settings: yield* parseToolSettings(tool, toolValue.settings),
        };
      });

    const parseSkills = Effect.fn("AiState.parseSkills")(function* () {
      const parsedSkills: Record<string, ManagedSkillState> = {};

      if (skillsValue === undefined) {
        return parsedSkills;
      }

      for (const [skillName, skillValue] of Object.entries(skillsValue)) {
        if (skillName in parsedSkills) {
          return yield* AiStateError.make({
            details: `skills contains duplicate skill "${skillName}"`,
          });
        }

        parsedSkills[skillName] = yield* parseManagedSkill(skillName, skillValue);
      }

      return parsedSkills;
    });

    return {
      instructions: { canonical: instructions.canonical },
      tools: {
        claude: yield* parseTool("claude"),
        codex: yield* parseTool("codex"),
      },
      skills: yield* parseSkills(),
    };
  });

const encodeAiState = (state: AiStateData) => ({
  instructions: {
    canonical: state.instructions.canonical,
  },
  tools: {
    claude: {
      settings: {
        shared_settings_file: state.tools.claude.settings.shared_settings_file,
      },
    },
    codex: {
      settings: {
        shared_settings_file: state.tools.codex.settings.shared_settings_file,
      },
    },
  },
  skills: Object.fromEntries(
    Object.entries(state.skills).map(([skillName, skill]) => [
      skillName,
      {
        canonical_dir: skill.canonical_dir,
        targets: [...skill.targets],
      },
    ]),
  ),
});

export class AiState extends Effect.Service<AiState>()("@dotfiles/AiState", {
  effect: Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { dotfilesRoot } = yield* StowConfig;

    const statePath = path.join(dotfilesRoot, "ai", "state.toml");

    const read = Effect.fn("AiState.read")(function* () {
      const content = yield* fs.readFileString(statePath).pipe(
        Effect.catchAll((error) =>
          AiStateError.make({
            details: `Failed to read ${statePath}: ${error}`,
          }),
        ),
      );

      const parsed = yield* Effect.try({
        try: () => parse(content),
        catch: () =>
          new AiStateError({
            details: `Failed to parse ${statePath} as TOML`,
          }),
      });

      return yield* decodeAiState(parsed);
    });

    const write = Effect.fn("AiState.write")(function* (state: AiStateData) {
      const content = stringify(encodeAiState(state));
      yield* fs.writeFileString(statePath, `${content}\n`).pipe(
        Effect.catchAll((error) =>
          AiStateError.make({
            details: `Failed to write ${statePath}: ${error}`,
          }),
        ),
      );
    });

    const getTool = Effect.fn("AiState.getTool")(function* (tool: ManagedTool) {
      const state = yield* read();
      return tool === "claude" ? state.tools.claude : state.tools.codex;
    });

    const listSkills = Effect.fn("AiState.listSkills")(function* () {
      const state = yield* read();
      return state.skills;
    });

    const getSkill = Effect.fn("AiState.getSkill")(function* (skillName: string) {
      const skills = yield* listSkills();
      return skills[skillName];
    });

    const upsertSkill = Effect.fn("AiState.upsertSkill")(function* (
      skillName: string,
      skill: ManagedSkillState,
    ) {
      const state = yield* read();
      const nextState: AiStateData = {
        ...state,
        skills: {
          ...state.skills,
          [skillName]: {
            canonical_dir: skill.canonical_dir,
            targets: normalizeTargets(skill.targets),
          },
        },
      };

      yield* write(nextState);
    });

    const removeSkill = Effect.fn("AiState.removeSkill")(function* (
      skillName: string,
    ) {
      const state = yield* read();
      if (!(skillName in state.skills)) {
        return;
      }

      const nextSkills = Object.fromEntries(
        Object.entries(state.skills).filter(([name]) => name !== skillName),
      );

      yield* write({
        ...state,
        skills: nextSkills,
      });
    });

    return {
      statePath,
      read,
      write,
      getTool,
      listSkills,
      getSkill,
      upsertSkill,
      removeSkill,
    };
  }),
}) {}
