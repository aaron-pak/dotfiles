import { Command } from "@effect/cli"
import { BunContext, BunRuntime } from "@effect/platform-bun"
import { Console, Effect } from "effect"

// Main CLI command
const command = Command.make("dotfiles", {}, () =>
  Console.log("🏠 dotfiles-cli - Manage your dotfiles with ease")
)

// CLI application
const cli = Command.run(command, {
  name: "dotfiles",
  version: "0.1.0",
})

// Run with Bun runtime
cli(process.argv).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain)
