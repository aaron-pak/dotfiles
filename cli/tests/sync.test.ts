import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import {
  ResolveResult,
  Stow,
  StowConflict,
  StowResult,
  type ConflictChoice,
} from "../src/services/Stow.js";

// Track method calls
type CallLog = {
  dryRun: number;
  sync: number;
  resolveConflicts: Array<{
    conflicts: readonly StowConflict[];
    choice: ConflictChoice;
  }>;
};

// Mock Stow service
const mockStow = (
  conflicts: readonly StowConflict[],
  callLog: CallLog,
  resolveAbort: boolean = false,
) =>
  Layer.succeed(Stow, {
    _tag: "@dotfiles/Stow",
    dryRun: () =>
      Effect.sync(() => {
        callLog.dryRun++;
        return StowResult.make({ conflicts });
      }),
    sync: () =>
      Effect.sync(() => {
        callLog.sync++;
        return [];
      }),
    resolveConflicts: (c: readonly StowConflict[], choice: ConflictChoice) =>
      Effect.sync(() => {
        callLog.resolveConflicts.push({ conflicts: c, choice });
        return resolveAbort
          ? ResolveResult.Abort()
          : ResolveResult.Resolved({ resolutions: [] });
      }),
    checkAddable: () => Effect.succeed(""),
    addDotfile: () => Effect.succeed(""),
  });

describe("sync command", () => {
  // Note: Full e2e command tests with Prompt.select are complex due to
  // interactive terminal handling. These tests verify the Stow service
  // integration patterns.

  describe("Stow service integration", () => {
    it.effect("no conflicts: calls dryRun then sync", () => {
      const callLog: CallLog = { dryRun: 0, sync: 0, resolveConflicts: [] };

      return Effect.gen(function* () {
        const stow = yield* Stow;

        // Simulate sync command flow (no conflicts)
        const result = yield* stow.dryRun();

        if (result.conflicts.length === 0) {
          yield* stow.sync();
        }

        expect(callLog.dryRun).toBe(1);
        expect(callLog.sync).toBe(1);
        expect(callLog.resolveConflicts).toHaveLength(0);
      }).pipe(Effect.provide(mockStow([], callLog)));
    });

    it.effect(
      "with conflicts + backup: calls resolveConflicts then sync",
      () => {
        const conflicts = [
          new StowConflict({
            source: ".bashrc",
            target: ".bashrc",
            reason: "exists",
          }),
        ];
        const callLog: CallLog = { dryRun: 0, sync: 0, resolveConflicts: [] };

        return Effect.gen(function* () {
          const stow = yield* Stow;

          // Simulate sync command flow (with conflicts, backup choice)
          const result = yield* stow.dryRun();

          if (result.conflicts.length > 0) {
            const resolveResult = yield* stow.resolveConflicts(
              result.conflicts,
              "backup",
            );
            if (resolveResult._tag === "Resolved") {
              yield* stow.sync();
            }
          }

          expect(callLog.dryRun).toBe(1);
          expect(callLog.resolveConflicts).toHaveLength(1);
          expect(callLog.resolveConflicts.at(0)?.choice).toBe("backup");
          expect(callLog.sync).toBe(1);
        }).pipe(Effect.provide(mockStow(conflicts, callLog)));
      },
    );

    it.effect(
      "with conflicts + delete: calls resolveConflicts then sync",
      () => {
        const conflicts = [
          new StowConflict({
            source: ".zshrc",
            target: ".zshrc",
            reason: "exists",
          }),
        ];
        const callLog: CallLog = { dryRun: 0, sync: 0, resolveConflicts: [] };

        return Effect.gen(function* () {
          const stow = yield* Stow;

          // Simulate sync command flow (with conflicts, delete choice)
          const result = yield* stow.dryRun();

          if (result.conflicts.length > 0) {
            const resolveResult = yield* stow.resolveConflicts(
              result.conflicts,
              "delete",
            );
            if (resolveResult._tag === "Resolved") {
              yield* stow.sync();
            }
          }

          expect(callLog.dryRun).toBe(1);
          expect(callLog.resolveConflicts).toHaveLength(1);
          expect(callLog.resolveConflicts.at(0)?.choice).toBe("delete");
          expect(callLog.sync).toBe(1);
        }).pipe(Effect.provide(mockStow(conflicts, callLog)));
      },
    );

    it.effect("with conflicts + abort: no sync called", () => {
      const conflicts = [
        new StowConflict({
          source: ".bashrc",
          target: ".bashrc",
          reason: "exists",
        }),
      ];
      const callLog: CallLog = { dryRun: 0, sync: 0, resolveConflicts: [] };

      return Effect.gen(function* () {
        const stow = yield* Stow;

        // Simulate sync command flow (with conflicts, abort choice)
        const result = yield* stow.dryRun();

        if (result.conflicts.length > 0) {
          const resolveResult = yield* stow.resolveConflicts(
            result.conflicts,
            "abort",
          );
          if (resolveResult._tag === "Resolved") {
            yield* stow.sync();
          }
        }

        expect(callLog.dryRun).toBe(1);
        expect(callLog.resolveConflicts).toHaveLength(1);
        expect(callLog.resolveConflicts.at(0)?.choice).toBe("abort");
        expect(callLog.sync).toBe(0); // No sync!
      }).pipe(Effect.provide(mockStow(conflicts, callLog, true)));
    });
  });
});
