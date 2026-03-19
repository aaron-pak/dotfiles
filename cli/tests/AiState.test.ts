import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { AiState, AiStateError, AiStateLive } from "../src/services/AiState.js";
import {
  defaultAiStateToml,
  type FsFiles,
  makeTestBaseLayer,
  testDotfilesRoot,
} from "./testSupport.js";

const aiStatePath = `${testDotfilesRoot}/ai/state.toml`;

const makeTestLayer = (files: FsFiles) =>
  AiStateLive.pipe(Layer.provideMerge(makeTestBaseLayer(files)));

describe("AiState service", () => {
  it.effect("reads settings metadata and managed skill registry", () => {
    const files: FsFiles = {
      [aiStatePath]: defaultAiStateToml,
    };

    return Effect.gen(function* () {
      const aiState = yield* AiState;
      const state = yield* aiState.read();
      const claude = yield* aiState.getTool("claude");
      const skills = yield* aiState.listSkills();

      expect(state.instructions.canonical).toBe("home/.claude/CLAUDE.md");
      expect(claude.settings.shared_settings_file).toBe(
        "ai/claude-settings-shared.json",
      );
      expect(skills.batch).toEqual({
        canonical_dir: "ai/skills/batch",
        targets: ["claude", "codex", "agents"],
      });
      expect(skills.progress).toEqual({
        canonical_dir: "ai/skills/progress",
        targets: ["claude"],
      });
    }).pipe(Effect.provide(makeTestLayer(files)));
  });

  it.effect("rejects invalid skill targets", () => {
    const files: FsFiles = {
      [aiStatePath]: defaultAiStateToml.replace(
        'targets = ["codex"]',
        'targets = ["cursor"]',
      ),
    };

    return Effect.gen(function* () {
      const aiState = yield* AiState;
      const error = yield* aiState.read().pipe(Effect.flip);

      expect(error).toBeInstanceOf(AiStateError);
      if (error._tag === "AiStateError") {
        expect(error.details).toContain('invalid target "cursor"');
      }
    }).pipe(Effect.provide(makeTestLayer(files)));
  });

  it.effect("validates the shared settings file field", () => {
    const files: FsFiles = {
      [aiStatePath]: defaultAiStateToml.replace(
        'shared_settings_file = "ai/claude-settings-shared.json"',
        "shared_settings_file = 123",
      ),
    };

    return Effect.gen(function* () {
      const aiState = yield* AiState;
      const error = yield* aiState.read().pipe(Effect.flip);

      expect(error).toBeInstanceOf(AiStateError);
      if (error._tag === "AiStateError") {
        expect(error.details).toContain("shared_settings_file must be a string");
      }
    }).pipe(Effect.provide(makeTestLayer(files)));
  });
});
