import { Prompt } from "effect/unstable/cli";
import { Console, Effect, Option } from "effect";
import {
  printManagedSettingsApply,
  printManagedSettingsPreview,
} from "./managedSettingsOutput.js";
import { AiSkills } from "../services/AiSkills.js";
import { ClaudeSettings } from "../services/ClaudeSettings.js";
import { CodexSettings } from "../services/CodexSettings.js";
import {
  type ConflictChoice,
  type ConflictResolution,
  Stow,
  type StowLink,
} from "../services/Stow.js";

const printResolutions = (resolutions: readonly ConflictResolution[]) =>
  Effect.gen(function* () {
    if (resolutions.length === 0) {
      return;
    }

    yield* Console.log("\nConflict resolutions:");
    for (const resolution of resolutions) {
      const suffix = Option.match(resolution.backupPath, {
        onNone: () => "",
        onSome: (backupPath) => ` -> ${backupPath}`,
      });
      yield* Console.log(`  ${resolution.target}${suffix}`);
    }
  });

const printLinks = (links: readonly StowLink[]) =>
  Effect.gen(function* () {
    if (links.length === 0) {
      return;
    }

    yield* Console.log("\nSymlinks created:");
    for (const { target } of links) {
      yield* Console.log(`  ${target}`);
    }
  });

const previewManagedSettings = Effect.fn("syncFlow.previewManagedSettings")(
  function* () {
    const claudeSettings = yield* ClaudeSettings;
    const codexSettings = yield* CodexSettings;

    const claudePreview = yield* claudeSettings.previewPull();
    const codexPreview = yield* codexSettings.previewPull();

    yield* Console.log("");
    yield* printManagedSettingsPreview("Claude settings", claudePreview);
    yield* Console.log("");
    yield* printManagedSettingsPreview("Codex settings", codexPreview);
  },
);

export const selectConflictChoice = () =>
  Prompt.run(
    Prompt.select<ConflictChoice>({
      message: "How would you like to resolve these conflicts?",
      choices: [
        {
          title: "Backup",
          value: "backup",
          description: "Rename conflicting files to .bak and sync",
        },
        {
          title: "Delete",
          value: "delete",
          description: "Delete conflicting files and sync",
        },
        {
          title: "Abort",
          value: "abort",
          description: "Do nothing and exit",
        },
      ],
    }),
  );

export const runManagedSkillsSync = Effect.fn(
  "syncFlow.runManagedSkillsSync",
)(function* (dry: boolean) {
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
});

export const runManagedSettingsSync = Effect.fn(
  "syncFlow.runManagedSettingsSync",
)(function* (dry: boolean) {
  if (dry) {
    yield* previewManagedSettings();
    return;
  }

  const claudeSettings = yield* ClaudeSettings;
  const codexSettings = yield* CodexSettings;

  const claudeResult = yield* claudeSettings.pull();
  const codexResult = yield* codexSettings.pull();

  yield* Console.log("");
  yield* printManagedSettingsApply("Claude settings", claudeResult);
  yield* Console.log("");
  yield* printManagedSettingsApply("Codex settings", codexResult);
});

export const runStowSyncWithChoice = <E, R>(
  dry: boolean,
  chooseConflictResolution: () => Effect.Effect<ConflictChoice, E, R>,
) =>
  Effect.gen(function* () {
    const stow = yield* Stow;
    const result = yield* stow.dryRun();

    if (dry) {
      if (result.conflicts.length > 0) {
        yield* Console.log(
          `Would encounter ${result.conflicts.length} conflict(s):`,
        );
        for (const { target } of result.conflicts) {
          yield* Console.log(`  - ${target}`);
        }
      }

      if (result.links.length > 0) {
        yield* Console.log("\nWould create symlinks:");
        for (const { target } of result.links) {
          yield* Console.log(`  ${target}`);
        }
      }

      if (result.conflicts.length === 0 && result.links.length === 0) {
        yield* Console.log("Nothing to do. All dotfiles already synced.");
      }

      return;
    }

    yield* Console.log("Checking for conflicts...");

    if (result.conflicts.length === 0) {
      yield* Console.log("No conflicts found. Syncing dotfiles...");
      const links = yield* stow.sync();
      yield* printLinks(links);
      yield* Console.log("\nDotfiles synced successfully!");
      return;
    }

    yield* Console.log(`\nFound ${result.conflicts.length} conflict(s):`);
    for (const { target } of result.conflicts) {
      yield* Console.log(`  - ${target}`);
    }
    yield* Console.log("");

    const choice = yield* chooseConflictResolution();

    const resolveResult = yield* stow.resolveConflicts(
      result.conflicts,
      choice,
    );

    if (resolveResult._tag === "Resolved") {
      yield* printResolutions(resolveResult.resolutions);
      yield* Console.log("\nSyncing dotfiles...");
      const links = yield* stow.sync();
      yield* printLinks(links);
      yield* Console.log("\nDotfiles synced successfully!");
    }
  });

export const runStowSync = Effect.fn("syncFlow.runStowSync")(function* (
  dry: boolean,
) {
  yield* runStowSyncWithChoice(dry, selectConflictChoice);
});

export const runFullSyncWithChoice = <E, R>(
  dry: boolean,
  chooseConflictResolution: () => Effect.Effect<ConflictChoice, E, R>,
) =>
  Effect.gen(function* () {
    yield* runStowSyncWithChoice(dry, chooseConflictResolution);
    yield* Console.log("");
    yield* runManagedSkillsSync(dry);
    yield* runManagedSettingsSync(dry);
  });

export const runFullSync = Effect.fn("syncFlow.runFullSync")(function* (
  dry: boolean,
) {
  yield* runFullSyncWithChoice(dry, selectConflictChoice);
});
