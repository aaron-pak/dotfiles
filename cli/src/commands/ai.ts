import { Console, Effect, Option } from "effect";
import { Argument, Command, Flag, Prompt } from "effect/unstable/cli";
import {
  AiSkills,
  AiSkillsError,
  type UnmanageDisposition,
} from "../services/AiSkills.js";
import { type ManagedTool, type SkillTarget } from "../services/AiState.js";
import { ClaudeSettings } from "../services/ClaudeSettings.js";
import { CodexSettings } from "../services/CodexSettings.js";
import {
  printManagedSettingsApply,
  printManagedSettingsPreview,
} from "./managedSettingsOutput.js";
import {
  runChecklistPrompt,
} from "./interactiveChecklist.js";

const dry = Flag.boolean("dry").pipe(
  Flag.withAlias("n"),
  Flag.withDescription("Show what would happen without making changes"),
);

const toolChoice = Flag.choice("tool", ["claude", "codex", "all"]).pipe(
  Flag.optional,
  Flag.withDescription("Which tool settings to manage"),
);

const settingsNameArg = Argument.string("name").pipe(
  Argument.withDescription("Top-level setting key or section name"),
);

const toolOnlyChoice = Flag.choice("tool", ["claude", "codex"]).pipe(
  Flag.optional,
  Flag.withDescription("Which tool to manage"),
);

const skillNameArg = Argument.string("name").pipe(
  Argument.optional,
  Argument.withDescription("Managed skill name"),
);

const fromOption = Flag.string("from").pipe(
  Flag.optional,
  Flag.withDescription("claude, codex, agents, or a filesystem path"),
);

const targetsOption = Flag.string("targets").pipe(
  Flag.optional,
  Flag.withDescription("Comma-separated list of claude,codex,agents"),
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
    return Effect.fail(
      new AiSkillsError({
        details: "At least one skill target must be provided",
      }),
    );
  }

  const targets: SkillTarget[] = [];
  for (const part of parts) {
    if (!isSkillTarget(part)) {
      return Effect.fail(
        new AiSkillsError({
          details: `Invalid skill target "${part}". Expected claude, codex, or agents`,
        }),
      );
    }
    targets.push(part);
  }

  return Effect.succeed(normalizeTargets(targets));
};

const selectManagedTool = () =>
  Prompt.run(
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
    }),
  );

const selectSkillSource = () =>
  Prompt.run(
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
    }),
  );

const selectSkillTargets = Effect.fn("ai.selectSkillTargets")(function* () {
  const claude = yield* Prompt.confirm({
    message: "Project this skill into Claude?",
    initial: true,
  }).pipe(Prompt.run);
  const codex = yield* Prompt.confirm({
    message: "Project this skill into Codex?",
    initial: true,
  }).pipe(Prompt.run);
  const agents = yield* Prompt.confirm({
    message: "Project this skill into .agents?",
    initial: false,
  }).pipe(Prompt.run);

  const targets: SkillTarget[] = [];
  if (claude) targets.push("claude");
  if (codex) targets.push("codex");
  if (agents) targets.push("agents");

  if (targets.length === 0) {
    return yield* new AiSkillsError({
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
      return yield* new AiSkillsError({
        details: `No local skills were found on ${surface}`,
      });
    }

    return yield* Prompt.run(
      Prompt.select<string>({
        message: "Which skill do you want to adopt?",
        choices: available.map((name: string) => ({
          title: name,
          value: name,
          description: `Adopt ${name} from ${surface}`,
        })),
      }),
    );
  });

type ManagedSkillEntry = {
  readonly name: string;
  readonly canonical_dir: string;
  readonly targets: readonly SkillTarget[];
};

const skillTargetLabels: Record<SkillTarget, string> = {
  claude: ".claude",
  codex: ".codex",
  agents: ".agents",
};

const formatSkillTargets = (targets: readonly SkillTarget[]) =>
  targets.length === 0 ? "none" : targets.map((target) => skillTargetLabels[target]).join(", ");

const formatSkillTargetSummary = (targets: readonly SkillTarget[]) =>
  targets.length === 0
    ? "Nowhere"
    : `(${targets.map((target) => skillTargetLabels[target]).join(", ")})`;

const sameTargets = (
  left: readonly SkillTarget[],
  right: readonly SkillTarget[],
) =>
  left.length === right.length &&
  left.every((target, index) => target === right[index]);

const deriveInitialTargets = (entries: readonly ManagedSkillEntry[]) => {
  const firstEntry = entries[0];
  if (firstEntry === undefined) {
    return [];
  }

  return entries.every((entry) => sameTargets(entry.targets, firstEntry.targets))
    ? firstEntry.targets
    : [];
};

const formatSkillNames = (names: readonly string[]) =>
  names.length === 1
    ? names[0] ?? ""
    : `${names.length} skills`;

const selectManagedAssetKind = () =>
  Effect.gen(function* () {
    const result = yield* runChecklistPrompt<"skills" | "exit", never>({
      message: "What do you want to manage?",
      choices: [
        {
          title: "Skills",
          value: "skills",
          detail: "Manage which AI surfaces receive each shared skill",
        },
        {
          title: "Exit",
          value: "exit",
          detail: "Leave AI management",
        },
      ],
      footer: ["enter select  esc cancel", "j/k or arrows move"],
      selectionMode: "single",
      showSelectionSummary: false,
      min: 1,
      selectHoveredWhenEmpty: true,
      emptySelectionError: "Choose one item to continue.",
    });

    if (result._tag === "cancel") {
      return "exit";
    }

    const selected = result.values[0];
    if (selected === undefined) {
      return "exit";
    }
    return selected;
  });

type SkillsMenuResult =
  | {
      readonly _tag: "exit";
    }
  | {
      readonly _tag: "edit";
      readonly names: readonly string[];
    }
  | {
      readonly _tag: "unmanage";
      readonly names: readonly string[];
    };

type SkillTargetEditorResult =
  | {
      readonly _tag: "cancel";
    }
  | {
      readonly _tag: "confirm";
      readonly targets: readonly SkillTarget[];
    };

type UnmanageSkillResult =
  | {
      readonly _tag: "cancel";
    }
  | {
      readonly _tag: "confirm";
      readonly disposition: UnmanageDisposition;
    };

const selectManagedSkills = (
  entries: readonly ManagedSkillEntry[],
  selectedNames: readonly string[],
) =>
  Effect.gen(function* () {
    const result = yield* runChecklistPrompt<string, "unmanage">({
      message: "Manage skills",
      choices: entries.map((entry: ManagedSkillEntry) => ({
        title: entry.name,
        value: entry.name,
        detail: formatSkillTargetSummary(entry.targets),
        selected: selectedNames.includes(entry.name),
      })),
      footer: [
        "space toggle  enter edit targets  u unmanage  esc exit",
        "j/k or arrows move",
      ],
      selectHoveredWhenEmpty: true,
      emptySelectionError:
        "Select a skill with space, or press enter/u on the hovered skill.",
      extraActions: [
        {
          key: "u",
          action: "unmanage",
          label: "Unmanage",
        },
      ],
    });

    if (result._tag === "cancel") {
      return {
        _tag: "exit",
      } satisfies SkillsMenuResult;
    }

    if (result._tag === "extra") {
      return {
        _tag: "unmanage",
        names: result.values,
      } satisfies SkillsMenuResult;
    }

    return {
      _tag: "edit",
      names: result.values,
    } satisfies SkillsMenuResult;
  });

const selectSkillTargetsEditor = (
  names: readonly string[],
  initialTargets: readonly SkillTarget[],
) =>
  Effect.gen(function* () {
    const result = yield* runChecklistPrompt<SkillTarget, never>({
      message: `Choose targets\n${formatSkillNames(names)}`,
      choices: allSkillTargets.map((target) => ({
        title: skillTargetLabels[target],
        value: target,
        selected: initialTargets.includes(target),
      })),
      footer: [
        "space toggle  enter confirm  esc cancel",
        "j/k or arrows move",
      ],
      min: 1,
      emptySelectionError:
        "Select at least one target, or go back and press u to unmanage.",
    });

    if (result._tag === "cancel") {
      return {
        _tag: "cancel",
      } satisfies SkillTargetEditorResult;
    }

    return {
      _tag: "confirm",
      targets: normalizeTargets(result.values),
    } satisfies SkillTargetEditorResult;
  });

const selectUnmanageDisposition = (names: readonly string[]) =>
  Effect.gen(function* () {
    const result = yield* runChecklistPrompt<UnmanageDisposition, never>({
      message: `Unmanage skills\n${formatSkillNames(names)}`,
      choices: [
        {
          title: "Keep local copies",
          value: "keep-local-copies",
          detail: "Remove repo management and leave real local folders on this machine",
        },
        {
          title: "Delete local copies",
          value: "delete-local-copies",
          detail: "Remove repo management and delete the managed skill folders on this machine",
        },
      ],
      footer: ["enter select  esc cancel", "j/k or arrows move"],
      selectionMode: "single",
      showSelectionSummary: false,
      min: 1,
      selectHoveredWhenEmpty: true,
      emptySelectionError: "Choose how to unmanage these skills.",
    });

    if (result._tag === "cancel") {
      return {
        _tag: "cancel",
      } satisfies UnmanageSkillResult;
    }

    const disposition = result.values[0];
    if (disposition === undefined) {
      return {
        _tag: "cancel",
      } satisfies UnmanageSkillResult;
    }

    return {
      _tag: "confirm",
      disposition,
    } satisfies UnmanageSkillResult;
  });

type AiHubHooks<E, R> = {
  readonly selectAssetKind: () => Effect.Effect<"skills" | "exit", E, R>;
  readonly runSkillsManager: () => Effect.Effect<void, E, R>;
};

type SkillsManagerHooks<E, R> = {
  readonly selectSkills: (
    entries: readonly ManagedSkillEntry[],
    selectedNames: readonly string[],
  ) => Effect.Effect<SkillsMenuResult, E, R>;
  readonly selectUnmanageDisposition: (
    names: readonly string[],
  ) => Effect.Effect<UnmanageSkillResult, E, R>;
  readonly editTargets: (
    names: readonly string[],
    initialTargets: readonly SkillTarget[],
  ) => Effect.Effect<SkillTargetEditorResult, E, R>;
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
  selectSkills,
  selectUnmanageDisposition,
  editTargets,
}: SkillsManagerHooks<E, R>) =>
  Effect.gen(function* () {
    const skills = yield* AiSkills;
    let selectedNames: readonly string[] = [];

    while (true) {
      const entries = yield* skills.list();
      if (entries.length === 0) {
        yield* Console.log("No managed skills.");
        return;
      }

      const availableNames = new Set(
        entries.map((entry: ManagedSkillEntry) => entry.name),
      );
      selectedNames = selectedNames.filter((name) => availableNames.has(name));

      const selection = yield* selectSkills(entries, selectedNames);
      if (selection._tag === "exit") {
        return;
      }

      selectedNames = selection.names;

      if (selection._tag === "unmanage") {
        const unmanageResult = yield* selectUnmanageDisposition(selection.names);
        if (unmanageResult._tag === "cancel") {
          continue;
        }

        const result = yield* skills.unmanageMany(
          selection.names,
          unmanageResult.disposition,
        );
        yield* Console.log(
          `Unmanaged ${result.names.length} skill(s): ${result.names.join(", ")}`,
        );
        yield* Console.log(
          result.disposition === "keep-local-copies"
            ? "This machine kept local copies for any managed links it was using."
            : "This machine deleted any managed skill folders it was using.",
        );
        yield* Console.log(
          "Other machines are not guaranteed to keep a working copy after they pull this repo change in v1.",
        );
        selectedNames = [];
        continue;
      }

      const selectedEntries = entries.filter((entry: ManagedSkillEntry) =>
        selection.names.includes(entry.name),
      );
      const initialTargets = deriveInitialTargets(selectedEntries);
      const editorResult = yield* editTargets(selection.names, initialTargets);
      if (editorResult._tag === "cancel") {
        continue;
      }

      const result = yield* skills.updateTargetsMany(
        selection.names,
        editorResult.targets,
      );
      yield* Console.log(
        `Updated ${result.names.length} skill(s): ${result.names.join(", ")}`,
      );
      yield* Console.log(`Current targets: ${formatSkillTargets(result.targets)}`);
    }
  });

export const runSkillsManager = Effect.fn("ai.runSkillsManager")(function* () {
  yield* runSkillsManagerWithHooks({
    selectSkills: selectManagedSkills,
    selectUnmanageDisposition,
    editTargets: selectSkillTargetsEditor,
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
              Prompt.run(
                Prompt.text({
                  message: "Enter the skill directory path to adopt",
                }),
              ),
            onSome: (value) =>
              value === "claude" ||
              value === "codex" ||
              value === "agents" ||
              value === "path"
                ? Prompt.run(
                    Prompt.text({
                      message: "Enter the skill directory path to adopt",
                    }),
                  )
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
              const pathParts = sourcePath
                .split("/")
                .filter((part: string) => part.length > 0);
              const inferred = pathParts[pathParts.length - 1];
              if (inferred === undefined) {
                return yield* new AiSkillsError({
                  details:
                    "Could not infer a managed skill name from the path",
                });
              }
              return inferred;
            }

            const pathParts = sourcePath
              .split("/")
              .filter((part: string) => part.length > 0);
            const inferred = pathParts[pathParts.length - 1];
            if (inferred === undefined) {
              return yield* new AiSkillsError({
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

const unmanageSkillName = Argument.string("name").pipe(
  Argument.withDescription("Managed skill name"),
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
