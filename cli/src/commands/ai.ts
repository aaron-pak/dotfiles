import { Args, Command, Options, Prompt } from "@effect/cli";
import { Console, Effect, Option } from "effect";
import { AiSkills, AiSkillsError } from "../services/AiSkills.js";
import { type ManagedTool, type SkillTarget } from "../services/AiState.js";
import { ClaudeSettings } from "../services/ClaudeSettings.js";
import { CodexSettings } from "../services/CodexSettings.js";
import {
  printManagedSettingsApply,
  printManagedSettingsPreview,
} from "./managedSettingsOutput.js";

const dry = Options.boolean("dry").pipe(
  Options.withAlias("n"),
  Options.withDescription("Show what would happen without making changes"),
);

const toolChoice = Options.choice("tool", ["claude", "codex", "all"]).pipe(
  Options.optional,
  Options.withDescription("Which tool settings to manage"),
);

const settingsNameArg = Args.text({ name: "name" }).pipe(
  Args.withDescription("Top-level setting key or section name"),
);

const toolOnlyChoice = Options.choice("tool", ["claude", "codex"]).pipe(
  Options.optional,
  Options.withDescription("Which tool to manage"),
);

const skillNameArg = Args.text({ name: "name" }).pipe(
  Args.optional,
  Args.withDescription("Managed skill name"),
);

const fromOption = Options.text("from").pipe(
  Options.optional,
  Options.withDescription("claude, codex, agents, or a filesystem path"),
);

const targetsOption = Options.text("targets").pipe(
  Options.optional,
  Options.withDescription("Comma-separated list of claude,codex,agents"),
);

const allSkillTargets: readonly SkillTarget[] = ["claude", "codex", "agents"];

const isSkillTarget = (value: string): value is SkillTarget =>
  value === "claude" || value === "codex" || value === "agents";

const normalizeTargets = (
  targets: readonly SkillTarget[],
): readonly SkillTarget[] =>
  [...new Set(targets)].sort(
    (left, right) =>
      allSkillTargets.indexOf(left) - allSkillTargets.indexOf(right),
  );

const parseTargets = (value: string) => {
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    return AiSkillsError.make({
      details: "At least one skill target must be provided",
    });
  }

  const targets: SkillTarget[] = [];
  for (const part of parts) {
    if (!isSkillTarget(part)) {
      return AiSkillsError.make({
        details: `Invalid skill target "${part}". Expected claude, codex, or agents`,
      });
    }
    targets.push(part);
  }

  return Effect.succeed(normalizeTargets(targets));
};

const selectManagedTool = () =>
  Prompt.select<ManagedTool>({
    message: "Which tool do you want to manage?",
    choices: [
      {
        title: "Claude",
        value: "claude",
        description: "Manage Claude settings",
      },
      {
        title: "Codex",
        value: "codex",
        description: "Manage Codex settings",
      },
    ],
  });

const selectSkillSource = () =>
  Prompt.select<"claude" | "codex" | "agents" | "path">({
    message: "Where is the source skill currently located?",
    choices: [
      {
        title: "Claude",
        value: "claude",
        description: "Use ~/.claude/skills/<name>",
      },
      {
        title: "Codex",
        value: "codex",
        description: "Use ~/.codex/skills/<name>",
      },
      {
        title: ".agents",
        value: "agents",
        description: "Use ~/.agents/skills/<name>",
      },
      {
        title: "Filesystem path",
        value: "path",
        description: "Use an explicit local path",
      },
    ],
  });

const selectSkillTargets = Effect.fn("ai.selectSkillTargets")(function* () {
  const claude = yield* Prompt.confirm({
    message: "Project this skill into Claude?",
    initial: true,
  });
  const codex = yield* Prompt.confirm({
    message: "Project this skill into Codex?",
    initial: true,
  });
  const agents = yield* Prompt.confirm({
    message: "Project this skill into .agents?",
    initial: false,
  });

  const targets: SkillTarget[] = [];
  if (claude) targets.push("claude");
  if (codex) targets.push("codex");
  if (agents) targets.push("agents");

  if (targets.length === 0) {
    return yield* AiSkillsError.make({
      details: "Select at least one target surface for a managed skill",
    });
  }

  return normalizeTargets(targets);
});

const selectSkillNameFromSurface = (
  surface: "claude" | "codex" | "agents",
) =>
  Effect.gen(function* () {
    const skills = yield* AiSkills;
    const available = yield* skills.listLocalSkills(surface);

    if (available.length === 0) {
      return yield* AiSkillsError.make({
        details: `No local skills were found on ${surface}`,
      });
    }

    return yield* Prompt.select<string>({
      message: "Which skill do you want to adopt?",
      choices: available.map((name) => ({
        title: name,
        value: name,
        description: `Adopt ${name} from ${surface}`,
      })),
    });
  });

type ManagedSkillEntry = {
  readonly name: string;
  readonly canonical_dir: string;
  readonly targets: readonly SkillTarget[];
};

const skillTargetLabels: Record<SkillTarget, string> = {
  claude: "Claude",
  codex: "Codex",
  agents: ".agents",
};

const formatSkillTargets = (targets: readonly SkillTarget[]) =>
  targets.length === 0 ? "none" : targets.map((target) => skillTargetLabels[target]).join(", ");

const selectManagedAssetKind = () =>
  Prompt.select<"skills" | "exit">({
    message: "What do you want to manage?",
    choices: [
      {
        title: "Skills",
        value: "skills",
        description: "Manage which AI surfaces receive each shared skill",
      },
      {
        title: "Exit",
        value: "exit",
        description: "Leave AI management",
      },
    ],
  });

const selectManagedSkill = (entries: readonly ManagedSkillEntry[]) =>
  Prompt.select<string | "exit">({
    message: "Which managed skill do you want to edit?",
    choices: [
      ...entries.map((entry) => ({
        title: entry.name,
        value: entry.name,
        description: formatSkillTargets(entry.targets),
      })),
      {
        title: "Exit",
        value: "exit",
        description: "Leave skills manager",
      },
    ],
  });

const selectSkillTargetAction = (entry: ManagedSkillEntry) =>
  Prompt.select<SkillTarget | "back">({
    message: `Manage targets for ${entry.name}`,
    choices: [
      ...allSkillTargets.map((target) => {
        const enabled = entry.targets.includes(target);
        const label = skillTargetLabels[target];
        return {
          title: `${label}: ${enabled ? "on" : "off"}`,
          value: target,
          description: enabled
            ? `Stop projecting ${entry.name} into ${label}`
            : `Project ${entry.name} into ${label}`,
        };
      }),
      {
        title: "Back",
        value: "back",
        description: "Return to the managed skill list",
      },
    ],
  });

type AiHubHooks<E, R> = {
  readonly selectAssetKind: () => Effect.Effect<"skills" | "exit", E, R>;
  readonly runSkillsManager: () => Effect.Effect<void, E, R>;
};

type SkillsManagerHooks<E, R> = {
  readonly selectSkill: (
    entries: readonly ManagedSkillEntry[],
  ) => Effect.Effect<string | "exit", E, R>;
  readonly selectTargetAction: (
    entry: ManagedSkillEntry,
  ) => Effect.Effect<SkillTarget | "back", E, R>;
};

const summarizeTargetChanges = (
  enabledTargets: readonly SkillTarget[],
  disabledTargets: readonly SkillTarget[],
) => {
  const changes: string[] = [];

  if (enabledTargets.length > 0) {
    changes.push(`enabled ${formatSkillTargets(enabledTargets)}`);
  }

  if (disabledTargets.length > 0) {
    changes.push(`disabled ${formatSkillTargets(disabledTargets)}`);
  }

  return changes.length === 0 ? "No target changes were needed." : changes.join("; ");
};

export const aiHelpText = [
  "AI management",
  "",
  "Interactive entrypoints:",
  "  dot ai",
  "  dot ai skills",
  "",
  "Direct skill commands:",
  "  dot ai skills list",
  "  dot ai skills sync",
  "  dot ai skills adopt [<name>] [--from claude|codex|agents|<path>] [--targets claude,codex,agents]",
  "  dot ai skills unmanage <name>",
  "",
  "Direct settings commands:",
  "  dot ai settings pull [--tool claude|codex|all]",
  "  dot ai settings adopt <name> --tool claude|codex",
  "  dot ai settings ignore <name> --tool claude|codex",
  "  dot ai settings unignore <name> --tool claude|codex",
].join("\n");

export const runSkillsManagerWithHooks = <E, R>({
  selectSkill,
  selectTargetAction,
}: SkillsManagerHooks<E, R>) =>
  Effect.gen(function* () {
    const skills = yield* AiSkills;

    while (true) {
      const entries = yield* skills.list();
      if (entries.length === 0) {
        yield* Console.log("No managed skills.");
        return;
      }

      const selectedName = yield* selectSkill(entries);
      if (selectedName === "exit") {
        return;
      }

      while (true) {
        const currentEntries = yield* skills.list();
        const entry = currentEntries.find(
          (currentEntry) => currentEntry.name === selectedName,
        );

        if (entry === undefined) {
          yield* Console.log(
            `Managed skill "${selectedName}" is no longer available.`,
          );
          break;
        }

        const action = yield* selectTargetAction(entry);
        if (action === "back") {
          break;
        }

        const nextTargets = entry.targets.includes(action)
          ? entry.targets.filter((target) => target !== action)
          : normalizeTargets([...entry.targets, action]);

        const result = yield* skills.updateTargets(entry.name, nextTargets);
        yield* Console.log(
          `Updated ${result.name}: ${summarizeTargetChanges(
            result.enabledTargets,
            result.disabledTargets,
          )}`,
        );
        yield* Console.log(
          `Current targets: ${formatSkillTargets(result.targets)}`,
        );
      }
    }
  });

export const runSkillsManager = Effect.fn("ai.runSkillsManager")(function* () {
  yield* runSkillsManagerWithHooks({
    selectSkill: selectManagedSkill,
    selectTargetAction: selectSkillTargetAction,
  });
});

export const runAiHubWithHooks = <E, R>({
  selectAssetKind,
  runSkillsManager,
}: AiHubHooks<E, R>) =>
  Effect.gen(function* () {
    while (true) {
      const selected = yield* selectAssetKind();
      if (selected === "exit") {
        return;
      }

      if (selected === "skills") {
        yield* runSkillsManager();
      }
    }
  });

export const runAiHub = Effect.fn("ai.runAiHub")(function* () {
  yield* runAiHubWithHooks({
    selectAssetKind: selectManagedAssetKind,
    runSkillsManager,
  });
});

export const runAiHelp = Effect.fn("ai.runAiHelp")(function* () {
  yield* Console.log(aiHelpText);
});

const getSettingsService = (tool: ManagedTool) =>
  tool === "claude" ? ClaudeSettings : CodexSettings;

const runSettingsPull = Effect.fn("ai.runSettingsPull")(function* (
  tool: ManagedTool | "all",
  dryRun: boolean,
) {
  const pullTool = Effect.fn("ai.pullTool")(function* (selectedTool: ManagedTool) {
    const label =
      selectedTool === "claude" ? "Claude settings" : "Codex settings";
    const service = yield* getSettingsService(selectedTool);

    if (dryRun) {
      const preview = yield* service.previewPull();
      yield* printManagedSettingsPreview(label, preview);
      return;
    }

    const result = yield* service.pull();
    yield* printManagedSettingsApply(label, result);
  });

  if (tool === "all") {
    yield* pullTool("claude");
    yield* Console.log("");
    yield* pullTool("codex");
    return;
  }

  yield* pullTool(tool);
});

const pull = Command.make("pull", { dry, tool: toolChoice }, ({ dry, tool }) =>
  Effect.gen(function* () {
    const selected = yield* Option.match(tool, {
      onNone: () => Effect.succeed<ManagedTool | "all">("all"),
      onSome: (value) => Effect.succeed<ManagedTool | "all">(value),
    });
    yield* runSettingsPull(selected, dry);
  }),
).pipe(Command.withDescription("Apply shared AI settings to this machine"));

const adoptSetting = Command.make(
  "adopt",
  { name: settingsNameArg, tool: toolOnlyChoice },
  ({ name, tool }) =>
    Effect.gen(function* () {
      const selectedTool = yield* Option.match(tool, {
        onNone: () => selectManagedTool(),
        onSome: Effect.succeed,
      });

      const service = yield* getSettingsService(selectedTool);
      const result = yield* service.adopt(name);
      yield* Console.log(
        `Adopted local ${selectedTool} setting into the shared defaults: ${result.key}`,
      );
    }),
).pipe(Command.withDescription("Make one local setting become the shared default"));

const ignoreSetting = Command.make(
  "ignore",
  { name: settingsNameArg, tool: toolOnlyChoice },
  ({ name, tool }) =>
    Effect.gen(function* () {
      const selectedTool = yield* Option.match(tool, {
        onNone: () => selectManagedTool(),
        onSome: Effect.succeed,
      });

      const service = yield* getSettingsService(selectedTool);
      const result = yield* service.ignore(name);
      yield* Console.log(
        `This machine will keep its own ${selectedTool} value for "${result.key}" on the next pull or sync.`,
      );
    }),
).pipe(Command.withDescription("Keep this machine's current value for one shared setting"));

const unignoreSetting = Command.make(
  "unignore",
  { name: settingsNameArg, tool: toolOnlyChoice },
  ({ name, tool }) =>
    Effect.gen(function* () {
      const selectedTool = yield* Option.match(tool, {
        onNone: () => selectManagedTool(),
        onSome: Effect.succeed,
      });

      const service = yield* getSettingsService(selectedTool);
      const result = yield* service.unignore(name);
      yield* Console.log(
        `This machine will start applying the shared ${selectedTool} value for "${result.key}" on the next pull or sync.`,
      );
    }),
).pipe(Command.withDescription("Resume using the shared value for one setting"));

const settings = Command.make("settings", {}, () =>
  Console.log("Manage AI settings\n\nUse --help for available subcommands."),
).pipe(
  Command.withDescription("Manage shared Claude and Codex settings"),
  Command.withSubcommands([pull, adoptSetting, ignoreSetting, unignoreSetting]),
);

const help = Command.make("help", {}, () => runAiHelp()).pipe(
  Command.withDescription("Show AI command help"),
);

const skillsSync = Command.make("sync", { dry }, ({ dry }) =>
  Effect.gen(function* () {
    const skills = yield* AiSkills;

    if (dry) {
      const preview = yield* skills.previewSync();
      if (preview.toCreate.length > 0) {
        yield* Console.log("Would create these managed skill links:");
        for (const targetPath of preview.toCreate) {
          yield* Console.log(`  ${targetPath}`);
        }
      }

      if (preview.toRemove.length > 0) {
        yield* Console.log("\nWould remove these managed skill links:");
        for (const targetPath of preview.toRemove) {
          yield* Console.log(`  ${targetPath}`);
        }
      }

      if (preview.conflicts.length > 0) {
        yield* Console.log("\nManaged skill conflicts:");
        for (const conflict of preview.conflicts) {
          yield* Console.log(`  ${conflict}`);
        }
      }

      if (
        preview.toCreate.length === 0 &&
        preview.toRemove.length === 0 &&
        preview.conflicts.length === 0
      ) {
        yield* Console.log("Managed skills already match this machine.");
      }
      return;
    }

    const result = yield* skills.sync();
    if (result.toCreate.length === 0 && result.toRemove.length === 0) {
      yield* Console.log("Managed skills already match this machine.");
      return;
    }

    if (result.toCreate.length > 0) {
      yield* Console.log("Created these managed skill links:");
      for (const targetPath of result.toCreate) {
        yield* Console.log(`  ${targetPath}`);
      }
    }

    if (result.toRemove.length > 0) {
      yield* Console.log("Removed these managed skill links:");
      for (const targetPath of result.toRemove) {
        yield* Console.log(`  ${targetPath}`);
      }
    }
  }),
).pipe(Command.withDescription("Project managed skills onto this machine"));

const skillsList = Command.make("list", {}, () =>
  Effect.gen(function* () {
    const skills = yield* AiSkills;
    const entries = yield* skills.list();

    if (entries.length === 0) {
      yield* Console.log("No managed skills.");
      return;
    }

    for (const entry of entries) {
      yield* Console.log(
        `${entry.name} -> ${formatSkillTargets(entry.targets)} (${entry.canonical_dir})`,
      );
    }
  }),
).pipe(Command.withDescription("List managed skills and their targets"));

const adoptSkill = Command.make(
  "adopt",
  { name: skillNameArg, from: fromOption, targets: targetsOption },
  ({ name, from, targets }) =>
    Effect.gen(function* () {
      const sourceChoice = yield* Option.match(from, {
        onNone: () => selectSkillSource(),
        onSome: (value) =>
          Effect.succeed(
            value === "claude" ||
              value === "codex" ||
              value === "agents" ||
              value === "path"
              ? value
              : "path",
          ),
      });

      const sourcePath = yield* (sourceChoice === "path"
        ? Option.match(from, {
            onNone: () =>
              Prompt.text({
                message: "Enter the skill directory path to adopt",
              }),
            onSome: (value) =>
              value === "claude" ||
              value === "codex" ||
              value === "agents" ||
              value === "path"
                ? Prompt.text({
                    message: "Enter the skill directory path to adopt",
                  })
                : Effect.succeed(value),
          })
        : Effect.gen(function* () {
            const selectedName = yield* Option.match(name, {
              onNone: () => selectSkillNameFromSurface(sourceChoice),
              onSome: Effect.succeed,
            });
            const skills = yield* AiSkills;
            return yield* skills.sourcePathForSurface(sourceChoice, selectedName);
          }));

      const skillName = yield* Option.match(name, {
        onNone: () =>
          Effect.gen(function* () {
            if (sourceChoice === "path") {
              const pathParts = sourcePath.split("/").filter((part) => part.length > 0);
              const inferred = pathParts[pathParts.length - 1];
              if (inferred === undefined) {
                return yield* AiSkillsError.make({
                  details:
                    "Could not infer a managed skill name from the path",
                });
              }
              return inferred;
            }

            const pathParts = sourcePath.split("/").filter((part) => part.length > 0);
            const inferred = pathParts[pathParts.length - 1];
            if (inferred === undefined) {
              return yield* AiSkillsError.make({
                details: "Could not infer a managed skill name from the source",
              });
            }
            return inferred;
          }),
        onSome: Effect.succeed,
      });

      const selectedTargets = yield* Option.match(targets, {
        onNone: () => selectSkillTargets(),
        onSome: parseTargets,
      });

      const skills = yield* AiSkills;
      const result = yield* skills.adopt({
        name: skillName,
        sourcePath,
        targets: selectedTargets,
      });

      yield* Console.log(
        `Adopted managed skill "${result.name}" with targets: ${result.targets.join(", ")}`,
      );
    }),
).pipe(Command.withDescription("Adopt one local skill into managed AI storage"));

const unmanageSkillName = Args.text({ name: "name" }).pipe(
  Args.withDescription("Managed skill name"),
);

const unmanageSkill = Command.make(
  "unmanage",
  { name: unmanageSkillName },
  ({ name }) =>
    Effect.gen(function* () {
      const skills = yield* AiSkills;
      const result = yield* skills.unmanage(name);

      yield* Console.log(`Unmanaged skill "${result.name}".`);
      yield* Console.log(
        "This machine kept local copies for any managed links it was using.",
      );
      yield* Console.log(
        "Other machines are not guaranteed to keep a working copy after they pull this repo change in v1.",
      );
    }),
).pipe(Command.withDescription("Stop managing one skill and keep local copies on this machine"));

const skills = Command.make("skills", {}, () => runSkillsManager()).pipe(
  Command.withDescription("Manage whole-skill sharing and projection"),
  Command.withSubcommands([skillsSync, adoptSkill, unmanageSkill, skillsList]),
);

export const ai = Command.make("ai", {}, () => runAiHub()).pipe(
  Command.withDescription("Manage shared AI settings and managed skills"),
  Command.withSubcommands([settings, skills, help]),
);
