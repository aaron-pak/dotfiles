import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { parse } from "smol-toml";
import { AiLocalState, AiLocalStateLive } from "../src/services/AiLocalState.js";
import {
  defaultAiLocalStateToml,
  type FsFiles,
  makeTestBaseLayer,
  readFile,
  testHomeDir,
} from "./testSupport.js";

const aiLocalPath = `${testHomeDir}/.config/dot/ai-local.toml`;

const makeTestLayer = (files: FsFiles) =>
  AiLocalStateLive.pipe(Layer.provideMerge(makeTestBaseLayer(files)));

describe("AiLocalState service", () => {
  it.effect("defaults to no ignored sections when the file is missing", () => {
    const files: FsFiles = {};

    return Effect.gen(function* () {
      const aiLocalState = yield* AiLocalState;
      const state = yield* aiLocalState.read();

      expect(state.tools.claude.ignored_shared_sections).toEqual([]);
      expect(state.tools.codex.ignored_shared_sections).toEqual([]);
    }).pipe(Effect.provide(makeTestLayer(files)));
  });

  it.effect("persists ignore and unignore per tool", () => {
    const files: FsFiles = {
      [aiLocalPath]: defaultAiLocalStateToml,
    };

    return Effect.gen(function* () {
      const aiLocalState = yield* AiLocalState;

      yield* aiLocalState.ignore("claude", "statusLine");
      yield* aiLocalState.ignore("codex", "notice");

      let state = yield* aiLocalState.read();
      expect(state.tools.claude.ignored_shared_sections).toEqual([
        "statusLine",
      ]);
      expect(state.tools.codex.ignored_shared_sections).toEqual(["notice"]);

      yield* aiLocalState.unignore("claude", "statusLine");

      state = yield* aiLocalState.read();
      expect(state.tools.claude.ignored_shared_sections).toEqual([]);
      expect(state.tools.codex.ignored_shared_sections).toEqual(["notice"]);

      const written = parse(readFile(files, aiLocalPath));
      expect(written).toEqual({
        tools: {
          claude: { ignored_shared_sections: [] },
          codex: { ignored_shared_sections: ["notice"] },
        },
      });
    }).pipe(Effect.provide(makeTestLayer(files)));
  });
});
