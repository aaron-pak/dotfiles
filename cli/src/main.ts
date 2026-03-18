import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, Layer } from "effect";
import { Command } from "effect/unstable/cli";
import { add } from "./commands/add.js";
import { ai } from "./commands/ai.js";
import { init } from "./commands/init.js";
import { remove } from "./commands/remove.js";
import { sync } from "./commands/sync.js";
import { AiLocalState } from "./services/AiLocalState.js";
import { AiSkills } from "./services/AiSkills.js";
import { AiState } from "./services/AiState.js";
import { ClaudeSettings } from "./services/ClaudeSettings.js";
import { CodexSettings } from "./services/CodexSettings.js";
import { Homebrew } from "./services/Homebrew.js";
import { Stow } from "./services/Stow.js";
import { StowConfig } from "./services/StowConfig.js";

// Root command
const dot = Command.make("dot", {}, () =>
  Console.log("Dotfiles manager\n\nUse --help for available commands."),
).pipe(
  Command.withDescription("Manage your dotfiles with ease"),
  Command.withSubcommands([sync, add, remove, init, ai]),
);

const BunLayer = BunServices.layer;

const StowConfigLayer = StowConfig.Live.pipe(Layer.provideMerge(BunLayer));
const PlatformLayer = Layer.merge(BunLayer, StowConfigLayer);

const StateLayer = Layer.merge(
  AiState.Live.pipe(Layer.provideMerge(PlatformLayer)),
  AiLocalState.Live.pipe(Layer.provideMerge(PlatformLayer)),
);

const ManagedAiLayer = Layer.mergeAll(
  ClaudeSettings.Live.pipe(
    Layer.provideMerge(StateLayer),
    Layer.provideMerge(PlatformLayer),
  ),
  CodexSettings.Live.pipe(
    Layer.provideMerge(StateLayer),
    Layer.provideMerge(PlatformLayer),
  ),
  AiSkills.Live.pipe(
    Layer.provideMerge(StateLayer),
    Layer.provideMerge(PlatformLayer),
  ),
);

const RuntimeLayer = Layer.merge(
  Stow.Live.pipe(Layer.provideMerge(PlatformLayer)),
  Homebrew.Live.pipe(Layer.provideMerge(PlatformLayer)),
);

const MainLayer = Layer.mergeAll(
  PlatformLayer,
  StateLayer,
  ManagedAiLayer,
  RuntimeLayer,
);

BunRuntime.runMain(
  Command.run(dot, { version: "0.1.0" }).pipe(Effect.provide(MainLayer)),
);
