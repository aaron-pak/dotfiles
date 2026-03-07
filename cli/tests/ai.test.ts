import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Ref } from "effect";
import {
  aiHelpText,
  runAiHubWithHooks,
  runSkillsManagerWithHooks,
} from "../src/commands/ai.js";
import {
  AiSkills,
  type UnmanageDisposition,
} from "../src/services/AiSkills.js";

type ManagedSkillEntry = {
  readonly name: string;
  readonly canonical_dir: string;
  readonly targets: readonly ("claude" | "codex" | "agents")[];
};

const makeAiSkillsLayer = (
  entries: Ref.Ref<readonly ManagedSkillEntry[]>,
  unmanageDispositions?: Ref.Ref<readonly UnmanageDisposition[]>,
) =>
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
      Effect.succeed({
        name,
        targets: [...targets],
      }),
    updateTargetsMany: (
      names: readonly string[],
      targets: readonly ("claude" | "codex" | "agents")[],
    ) =>
      Effect.gen(function* () {
        const nextTargets = [...targets];
        yield* Ref.update(entries, (currentEntries) =>
          currentEntries.map((entry) =>
            names.includes(entry.name)
              ? { ...entry, targets: nextTargets }
              : entry,
          ),
        );

        return {
          names: [...names],
          targets: nextTargets,
        };
      }),
    unmanage: () =>
      Effect.succeed({
        name: "batch",
        disposition: "keep-local-copies",
      }),
    unmanageMany: (
      names: readonly string[],
      disposition: UnmanageDisposition = "keep-local-copies",
    ) =>
      Effect.gen(function* () {
        if (unmanageDispositions !== undefined) {
          yield* Ref.update(unmanageDispositions, (current) => [
            ...current,
            disposition,
          ]);
        }

        return {
          names: [...names],
          disposition,
        };
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

  it.effect("runSkillsManagerWithHooks applies the confirmed targets to selected skills", () =>
    Effect.gen(function* () {
      const entries = yield* Ref.make<readonly ManagedSkillEntry[]>([
        {
          name: "batch",
          canonical_dir: "ai/skills/batch",
          targets: ["claude", "codex"],
        },
      ]);
      const calls = yield* Ref.make(0);

      yield* runSkillsManagerWithHooks({
        selectSkills: () =>
          Ref.modify(calls, (current) => [
            current === 0
              ? {
                  _tag: "edit",
                  names: ["batch"],
                }
              : {
                  _tag: "exit",
                },
            current + 1,
          ]),
        selectUnmanageDisposition: () =>
          Effect.succeed({
            _tag: "cancel",
          }),
        editTargets: () =>
          Effect.succeed({
            _tag: "confirm",
            targets: ["codex"],
          }),
      }).pipe(Effect.provide(makeAiSkillsLayer(entries)));

      expect(yield* Ref.get(entries)).toEqual([
        {
          name: "batch",
          canonical_dir: "ai/skills/batch",
          targets: ["codex"],
        },
      ]);
      expect(yield* Ref.get(calls)).toBe(2);
    }));

  it.effect("runSkillsManagerWithHooks unmanages every selected skill", () =>
    Effect.gen(function* () {
      const entries = yield* Ref.make<readonly ManagedSkillEntry[]>([
        {
          name: "batch",
          canonical_dir: "ai/skills/batch",
          targets: ["claude", "codex"],
        },
        {
          name: "simplify",
          canonical_dir: "ai/skills/simplify",
          targets: ["codex"],
        },
      ]);
      const calls = yield* Ref.make(0);
      const dispositions = yield* Ref.make<readonly UnmanageDisposition[]>([]);

      yield* runSkillsManagerWithHooks({
        selectSkills: () =>
          Ref.modify(calls, (current) => [
            current === 0
              ? {
                  _tag: "unmanage",
                  names: ["batch", "simplify"],
                }
              : {
                  _tag: "exit",
                },
            current + 1,
          ]),
        selectUnmanageDisposition: () =>
          Effect.succeed({
            _tag: "confirm",
            disposition: "delete-local-copies",
          }),
        editTargets: () =>
          Effect.succeed({
            _tag: "cancel",
          }),
      }).pipe(
        Effect.provide(makeAiSkillsLayer(entries, dispositions)),
      );

      expect(yield* Ref.get(entries)).toEqual([
        {
          name: "batch",
          canonical_dir: "ai/skills/batch",
          targets: ["claude", "codex"],
        },
        {
          name: "simplify",
          canonical_dir: "ai/skills/simplify",
          targets: ["codex"],
        },
      ]);
      expect(yield* Ref.get(dispositions)).toEqual(["delete-local-copies"]);
      expect(yield* Ref.get(calls)).toBe(2);
    }));

  it.effect("runSkillsManagerWithHooks preserves selected skills after backing out of target editing", () =>
    Effect.gen(function* () {
      const entries = yield* Ref.make<readonly ManagedSkillEntry[]>([
        {
          name: "batch",
          canonical_dir: "ai/skills/batch",
          targets: ["claude", "codex"],
        },
        {
          name: "simplify",
          canonical_dir: "ai/skills/simplify",
          targets: ["codex"],
        },
      ]);
      const selectCalls = yield* Ref.make(0);
      const selectedSnapshots = yield* Ref.make<readonly (readonly string[])[]>([]);

      yield* runSkillsManagerWithHooks({
        selectSkills: (_entries, selectedNames) =>
          Effect.gen(function* () {
            yield* Ref.update(selectedSnapshots, (current) => [
              ...current,
              [...selectedNames],
            ]);
            return yield* Ref.modify(selectCalls, (current) => [
              current === 0
                ? {
                    _tag: "edit" as const,
                    names: ["batch", "simplify"],
                  }
                : {
                    _tag: "exit" as const,
                  },
              current + 1,
            ]);
          }),
        selectUnmanageDisposition: () =>
          Effect.succeed({
            _tag: "cancel",
          }),
        editTargets: () =>
          Effect.succeed({
            _tag: "cancel",
          }),
      }).pipe(Effect.provide(makeAiSkillsLayer(entries)));

      expect(yield* Ref.get(selectedSnapshots)).toEqual([
        [],
        ["batch", "simplify"],
      ]);
      expect(yield* Ref.get(selectCalls)).toBe(2);
    }));
});
