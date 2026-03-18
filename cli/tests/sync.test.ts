import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import {
  runFullSyncWithChoice,
  runManagedSkillsSync,
  runManagedSettingsSync,
} from "../src/commands/syncFlow.js";
import { AiSkills } from "../src/services/AiSkills.js";
import type { SkillTarget } from "../src/services/AiState.js";
import { ClaudeSettings } from "../src/services/ClaudeSettings.js";
import { CodexSettings } from "../src/services/CodexSettings.js";
import { ResolveResult, Stow, StowResult } from "../src/services/Stow.js";

type CallLog = {
  readonly steps: string[];
};

const makeStowLayer = (callLog: CallLog) =>
  Layer.succeed(Stow, {
    dryRun: () =>
      Effect.sync(() => {
        callLog.steps.push("stow.dryRun");
        return new StowResult({ conflicts: [], links: [] });
      }),
    sync: () =>
      Effect.sync(() => {
        callLog.steps.push("stow.sync");
        return [];
      }),
    resolveConflicts: () =>
      Effect.sync(() => ResolveResult.Resolved({ resolutions: [] })),
    checkAddable: () => Effect.succeed(""),
    addDotfile: () => Effect.succeed(""),
    checkRemovable: () =>
      Effect.succeed({ normalized: "", isDirectory: false, itemCount: 0 }),
    removeDotfile: () => Effect.succeed(""),
  });

const makeClaudeLayer = (callLog: CallLog) =>
  Layer.succeed(ClaudeSettings, {
    localPath: "/test/home/.claude/settings.json",
    getSharedPath: () =>
      Effect.succeed("/test/dotfiles/ai/claude-settings-shared.json"),
    previewPull: () =>
      Effect.sync(() => {
        callLog.steps.push("claude.previewPull");
        return {
          sharedKeys: ["permissions"],
          applicableKeys: ["permissions"],
          skippedKeys: [],
          applicableShared: { permissions: {} },
        };
      }),
    pull: () =>
      Effect.sync(() => {
        callLog.steps.push("claude.pull");
        return {
          applicableKeys: ["permissions"],
          changedKeys: ["permissions"],
          skippedKeys: [],
          totalKeys: 1,
        };
      }),
    adopt: (key: string) => Effect.succeed({ key }),
    ignore: (key: string) => Effect.succeed({ key }),
    unignore: (key: string) => Effect.succeed({ key }),
  });

const makeAiSkillsLayer = (callLog: CallLog) =>
  Layer.succeed(AiSkills, {
    canonicalRoot: "/test/dotfiles/ai/skills",
    listLocalSkills: () => Effect.succeed([]),
    sourcePathForSurface: () => Effect.succeed(""),
    previewSync: () =>
      Effect.sync(() => {
        callLog.steps.push("skills.previewSync");
        return {
          toCreate: ["/test/home/.claude/skills/batch"],
          toRemove: [],
          unchanged: [],
          conflicts: [],
        };
      }),
    sync: () =>
      Effect.sync(() => {
        callLog.steps.push("skills.sync");
        return {
          toCreate: ["/test/home/.claude/skills/batch"],
          toRemove: [],
          unchanged: [],
          conflicts: [],
        };
      }),
    adopt: () =>
      Effect.succeed({
        name: "batch",
        canonicalDir: "ai/skills/batch",
        targets: ["claude", "codex", "agents"],
      }),
    updateTargets: (_name: string, targets: readonly SkillTarget[]) =>
      Effect.succeed({
        name: "batch",
        targets,
      }),
    updateTargetsMany: (
      names: readonly string[],
      targets: readonly SkillTarget[],
    ) =>
      Effect.succeed({
        names: [...names],
        targets,
      }),
    unmanage: () =>
      Effect.succeed({
        name: "batch",
        disposition: "keep-local-copies",
      }),
    unmanageMany: (
      names: readonly string[],
      disposition = "keep-local-copies",
    ) =>
      Effect.succeed({
        names: [...names],
        disposition,
      }),
    list: () => Effect.succeed([]),
  });

const makeCodexLayer = (callLog: CallLog) =>
  Layer.succeed(CodexSettings, {
    localPath: "/test/home/.codex/config.toml",
    getSharedPath: () =>
      Effect.succeed("/test/dotfiles/ai/codex-settings-shared.toml"),
    previewPull: () =>
      Effect.sync(() => {
        callLog.steps.push("codex.previewPull");
        return {
          sharedKeys: ["features"],
          applicableKeys: ["features"],
          skippedKeys: [],
          applicableShared: { features: {} },
        };
      }),
    pull: () =>
      Effect.sync(() => {
        callLog.steps.push("codex.pull");
        return {
          applicableKeys: ["features"],
          changedKeys: ["features"],
          skippedKeys: [],
          totalKeys: 1,
        };
      }),
    adopt: (key: string) => Effect.succeed({ key }),
    ignore: (key: string) => Effect.succeed({ key }),
    unignore: (key: string) => Effect.succeed({ key }),
  });

const makeTestLayer = (callLog: CallLog) =>
  Layer.mergeAll(
    makeStowLayer(callLog),
    makeAiSkillsLayer(callLog),
    makeClaudeLayer(callLog),
    makeCodexLayer(callLog),
  );

describe("sync flow", () => {
  it.effect("runManagedSkillsSync projects skills before settings", () => {
    const callLog: CallLog = { steps: [] };

    return Effect.gen(function* () {
      yield* runManagedSkillsSync(false);
      expect(callLog.steps).toEqual(["skills.sync"]);
    }).pipe(Effect.provide(makeTestLayer(callLog)));
  });

  it.effect("runManagedSettingsSync pulls Claude before Codex", () => {
    const callLog: CallLog = { steps: [] };

    return Effect.gen(function* () {
      yield* runManagedSettingsSync(false);
      expect(callLog.steps).toEqual(["claude.pull", "codex.pull"]);
    }).pipe(Effect.provide(makeTestLayer(callLog)));
  });

  it.effect(
    "runFullSync runs stow first, then both managed settings pulls",
    () => {
      const callLog: CallLog = { steps: [] };

      return Effect.gen(function* () {
        yield* runFullSyncWithChoice(false, () => Effect.succeed("abort"));
        expect(callLog.steps).toEqual([
          "stow.dryRun",
          "stow.sync",
          "skills.sync",
          "claude.pull",
          "codex.pull",
        ]);
      }).pipe(Effect.provide(makeTestLayer(callLog)));
    },
  );

  it.effect("dry sync previews shared settings without mutating them", () => {
    const callLog: CallLog = { steps: [] };

    return Effect.gen(function* () {
      yield* runManagedSettingsSync(true);
      expect(callLog.steps).toEqual(["claude.previewPull", "codex.previewPull"]);
    }).pipe(Effect.provide(makeTestLayer(callLog)));
  });
});
