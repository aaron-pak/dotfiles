import { Args, Command, Options } from "@effect/cli";
import { Console, Effect } from "effect";
import { ClaudeSettings } from "../services/ClaudeSettings.js";

const dry = Options.boolean("dry").pipe(
  Options.withAlias("n"),
  Options.withDescription("Show what would happen without making changes"),
);

// -------------------------------------------------------------------------------------
// Subcommands
// -------------------------------------------------------------------------------------

const pull = Command.make("pull", { dry }, ({ dry }) =>
  Effect.gen(function* () {
    const settings = yield* ClaudeSettings;

    if (dry) {
      const shared = yield* settings.readShared();
      const sharedKeys = Object.keys(shared);

      if (sharedKeys.length === 0) {
        yield* Console.log("No shared keys to pull.");
        return;
      }

      yield* Console.log("Would update the following shared keys:");
      for (const key of sharedKeys) {
        yield* Console.log(`  ${key}`);
      }
      return;
    }

    const result = yield* settings.pull();

    yield* Console.log("Pulled shared settings:");
    for (const key of result.updatedKeys) {
      yield* Console.log(`  ${key}`);
    }
    yield* Console.log(
      `\n${result.updatedKeys.length} shared key(s), ${result.totalKeys} total key(s) in settings.`,
    );
  }),
).pipe(
  Command.withDescription("Pull shared settings into local settings.json"),
);

const push = Command.make("push", { dry }, ({ dry }) =>
  Effect.gen(function* () {
    const settings = yield* ClaudeSettings;

    if (dry) {
      yield* Console.log(
        "Would push local values for shared keys to shared file.",
      );
      return;
    }

    const result = yield* settings.push();

    yield* Console.log("Pushed local values to shared settings:");
    for (const key of result.updatedKeys) {
      yield* Console.log(`  ${key}`);
    }
  }),
).pipe(
  Command.withDescription(
    "Push local values for shared keys back to shared file",
  ),
);

const shareKey = Args.text({ name: "key" }).pipe(
  Args.withDescription("Top-level settings key to start sharing"),
);

const share = Command.make("share", { key: shareKey }, ({ key }) =>
  Effect.gen(function* () {
    const settings = yield* ClaudeSettings;
    const result = yield* settings.share(key);
    yield* Console.log(`Now sharing: ${result.key}`);
  }),
).pipe(Command.withDescription("Start sharing a top-level settings property"));

const unshareKey = Args.text({ name: "key" }).pipe(
  Args.withDescription("Top-level settings key to stop sharing"),
);

const unshare = Command.make("unshare", { key: unshareKey }, ({ key }) =>
  Effect.gen(function* () {
    const settings = yield* ClaudeSettings;
    const result = yield* settings.unshare(key);
    yield* Console.log(`Stopped sharing: ${result.key}`);
  }),
).pipe(Command.withDescription("Stop sharing a top-level settings property"));

// -------------------------------------------------------------------------------------
// Parent command
// -------------------------------------------------------------------------------------

export const claude = Command.make("claude", {}, () =>
  Console.log(
    "Manage Claude Code settings\n\nUse --help for available subcommands.",
  ),
).pipe(
  Command.withDescription("Manage Claude Code settings"),
  Command.withSubcommands([pull, push, share, unshare]),
);
