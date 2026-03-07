import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { runInitializationWithHooks } from "../src/commands/init.js";
import { AiSkills } from "../src/services/AiSkills.js";
import { ClaudeSettings } from "../src/services/ClaudeSettings.js";
import { CodexSettings } from "../src/services/CodexSettings.js";
import {
  BundleCheckResult,
  BundleResult,
  Homebrew,
  InstalledPackage,
} from "../src/services/Homebrew.js";
import { ResolveResult, Stow, StowResult } from "../src/services/Stow.js";

type CallLog = {
  readonly steps: string[];
};

const makeHomebrewLayer = (callLog: CallLog) =>
  Layer.succeed(Homebrew, {
    _tag: "@dotfiles/Homebrew",
    checkInstalled: () =>
      Effect.sync(() => {
        callLog.steps.push("brew.checkInstalled");
        return true;
      }),
    install: () =>
      Effect.sync(() => {
        callLog.steps.push("brew.install");
        return undefined;
      }),
    bundle: () =>
      Effect.sync(() => {
        callLog.steps.push("brew.bundle");
        return new BundleResult({
          installed: [],
          skipped: [new InstalledPackage({ name: "stow", type: "formula" })],
        });
      }),
    bundleDryRun: () =>
      Effect.sync(() => {
        callLog.steps.push("brew.bundleDryRun");
        return new BundleCheckResult({ missing: [], satisfied: true });
      }),
  });

const makeStowLayer = (callLog: CallLog) =>
  Layer.succeed(Stow, {
    _tag: "@dotfiles/Stow",
    dryRun: () =>
      Effect.sync(() => {
        callLog.steps.push("stow.dryRun");
        return StowResult.make({ conflicts: [], links: [] });
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
    _tag: "@dotfiles/ClaudeSettings",
    localPath: "/test/home/.claude/settings.json",
    getSharedPath: () =>
      Effect.succeed("/test/dotfiles/ai/claude-settings-shared.json"),
    previewPull: () =>
      Effect.succeed({
        sharedKeys: [],
        applicableKeys: [],
        skippedKeys: [],
        applicableShared: {},
      }),
    pull: () =>
      Effect.sync(() => {
        callLog.steps.push("claude.pull");
        return {
          applicableKeys: [],
          changedKeys: [],
          skippedKeys: [],
          totalKeys: 0,
        };
      }),
    adopt: (key: string) => Effect.succeed({ key }),
    ignore: (key: string) => Effect.succeed({ key }),
    unignore: (key: string) => Effect.succeed({ key }),
  });

const makeAiSkillsLayer = (callLog: CallLog) =>
  Layer.succeed(AiSkills, {
    _tag: "@dotfiles/AiSkills",
    canonicalRoot: "/test/dotfiles/ai/skills",
    listLocalSkills: () => Effect.succeed([]),
    sourcePathForSurface: () => Effect.succeed(""),
    previewSync: () =>
      Effect.succeed({
        toCreate: [],
        toRemove: [],
        unchanged: [],
        conflicts: [],
      }),
    sync: () =>
      Effect.sync(() => {
        callLog.steps.push("skills.sync");
        return {
          toCreate: [],
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
    updateTargets: (_name, targets) =>
      Effect.succeed({
        name: "batch",
        targets,
      }),
    updateTargetsMany: (names, targets) =>
      Effect.succeed({
        names: [...names],
        targets,
      }),
    unmanage: () =>
      Effect.succeed({
        name: "batch",
        disposition: "keep-local-copies",
      }),
    unmanageMany: (names, disposition = "keep-local-copies") =>
      Effect.succeed({
        names: [...names],
        disposition,
      }),
    list: () => Effect.succeed([]),
  });

const makeCodexLayer = (callLog: CallLog) =>
  Layer.succeed(CodexSettings, {
    _tag: "@dotfiles/CodexSettings",
    localPath: "/test/home/.codex/config.toml",
    getSharedPath: () =>
      Effect.succeed("/test/dotfiles/ai/codex-settings-shared.toml"),
    previewPull: () =>
      Effect.succeed({
        sharedKeys: [],
        applicableKeys: [],
        skippedKeys: [],
        applicableShared: {},
      }),
    pull: () =>
      Effect.sync(() => {
        callLog.steps.push("codex.pull");
        return {
          applicableKeys: [],
          changedKeys: [],
          skippedKeys: [],
          totalKeys: 0,
        };
      }),
    adopt: (key: string) => Effect.succeed({ key }),
    ignore: (key: string) => Effect.succeed({ key }),
    unignore: (key: string) => Effect.succeed({ key }),
  });

const makeTestLayer = (callLog: CallLog) =>
  Layer.mergeAll(
    makeHomebrewLayer(callLog),
    makeStowLayer(callLog),
    makeAiSkillsLayer(callLog),
    makeClaudeLayer(callLog),
    makeCodexLayer(callLog),
  );

describe("init flow", () => {
  it.effect("runs Homebrew work, then reuses the shared sync pipeline", () => {
    const callLog: CallLog = { steps: [] };

    return Effect.gen(function* () {
      yield* runInitializationWithHooks(
        false,
        false,
        () => Effect.succeed(true),
        () => Effect.succeed("abort"),
      );

      expect(callLog.steps).toEqual([
        "brew.checkInstalled",
        "brew.bundle",
        "stow.dryRun",
        "stow.sync",
        "skills.sync",
        "claude.pull",
        "codex.pull",
      ]);
    }).pipe(Effect.provide(makeTestLayer(callLog)));
  });

  it.effect("skip-brew still runs both sync phases", () => {
    const callLog: CallLog = { steps: [] };

    return Effect.gen(function* () {
      yield* runInitializationWithHooks(
        false,
        true,
        () => Effect.succeed(true),
        () => Effect.succeed("abort"),
      );

      expect(callLog.steps).toEqual([
        "stow.dryRun",
        "stow.sync",
        "skills.sync",
        "claude.pull",
        "codex.pull",
      ]);
    }).pipe(Effect.provide(makeTestLayer(callLog)));
  });
});
