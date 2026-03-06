import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Ref } from "effect";
import {
  aiHelpText,
  runAiHubWithHooks,
  runSkillsManagerWithHooks,
} from "../src/commands/ai.js";
import { AiSkills } from "../src/services/AiSkills.js";

type ManagedSkillEntry = {
  readonly name: string;
  readonly canonical_dir: string;
  readonly targets: readonly ("claude" | "codex" | "agents")[];
};

const makeAiSkillsLayer = (entries: Ref.Ref<readonly ManagedSkillEntry[]>) =>
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
      Effect.succeed({
        toCreate: [],
        toRemove: [],
        unchanged: [],
        conflicts: [],
      }),
    adopt: () =>
      Effect.succeed({
        name: "batch",
        canonicalDir: "ai/skills/batch",
        targets: ["claude", "codex", "agents"],
      }),
    updateTargets: (name: string, targets: readonly ("claude" | "codex" | "agents")[]) =>
      Effect.gen(function* () {
        const nextTargets = [...targets];
        const enabledTargets: Array<"claude" | "codex" | "agents"> = [];
        const disabledTargets: Array<"claude" | "codex" | "agents"> = [
          "claude",
        ];
        yield* Ref.update(entries, (currentEntries) =>
          currentEntries.map((entry) =>
            entry.name === name ? { ...entry, targets: nextTargets } : entry,
          ),
        );

        return {
          name,
          canonicalDir: "ai/skills/batch",
          targets: nextTargets,
          enabledTargets,
          disabledTargets,
        };
      }),
    unmanage: () =>
      Effect.succeed({
        name: "batch",
        removedTargets: ["/test/home/.claude/skills/batch"],
      }),
    list: () =>
      Ref.get(entries).pipe(
        Effect.map((currentEntries) => [...currentEntries]),
      ),
  });

describe("ai interactive flows", () => {
  it("exports help text for the AI command surface", () => {
    expect(aiHelpText).toContain("dot ai");
    expect(aiHelpText).toContain("dot ai skills");
    expect(aiHelpText).toContain("dot ai settings pull");
  });

  it.effect("runAiHubWithHooks routes to the skills manager", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<readonly string[]>([]);

      yield* runAiHubWithHooks({
        selectAssetKind: () =>
          Ref.modify(calls, (currentCalls) => {
            const nextCalls = [...currentCalls, "select-asset"];
            const selection: "skills" | "exit" =
              currentCalls.length === 0 ? "skills" : "exit";
            return [selection, nextCalls];
          }),
        runSkillsManager: () =>
          Ref.update(calls, (currentCalls) => [...currentCalls, "run-skills"]),
      });

      expect(yield* Ref.get(calls)).toEqual([
        "select-asset",
        "run-skills",
        "select-asset",
      ]);
    }));

  it.effect("runSkillsManagerWithHooks updates skill targets immediately", () =>
    Effect.gen(function* () {
      const entries = yield* Ref.make<readonly ManagedSkillEntry[]>([
        {
          name: "batch",
          canonical_dir: "ai/skills/batch",
          targets: ["claude", "codex"],
        },
      ]);
      const selections = yield* Ref.make<readonly string[]>([
        "batch",
        "claude",
        "back",
        "exit",
      ]);

      yield* runSkillsManagerWithHooks({
        selectSkill: () =>
          Ref.modify(selections, (currentSelections) => {
            const [nextSelection = "exit", ...remainingSelections] =
              currentSelections;
            return [nextSelection === "exit" ? "exit" : nextSelection, remainingSelections];
          }),
        selectTargetAction: () =>
          Ref.modify(selections, (currentSelections) => {
            const [nextSelection = "back", ...remainingSelections] =
              currentSelections;
            return [
              nextSelection === "claude" ||
              nextSelection === "codex" ||
              nextSelection === "agents"
                ? nextSelection
                : "back",
              remainingSelections,
            ];
          }),
      }).pipe(Effect.provide(makeAiSkillsLayer(entries)));

      expect(yield* Ref.get(entries)).toEqual([
        {
          name: "batch",
          canonical_dir: "ai/skills/batch",
          targets: ["codex"],
        },
      ]);
    }));
});
