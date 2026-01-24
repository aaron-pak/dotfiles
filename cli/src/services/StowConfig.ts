import { Path } from "@effect/platform";
import { Effect } from "effect";
import * as os from "node:os";

/**
 * Configuration service for Stow operations.
 * Provides injectable paths for dotfiles root and home directory.
 */
export class StowConfig extends Effect.Service<StowConfig>()(
  "@dotfiles/StowConfig",
  {
    effect: Effect.gen(function* () {
      const path = yield* Path.Path;

      // In compiled binary, import.meta.dirname is virtual (/$bunfs/root/...)
      // Use process.argv[0] which is the binary path (dotfiles/dot)
      const isCompiled =
        import.meta.dirname?.startsWith("/$bunfs") ||
        !import.meta.dirname?.includes("dotfiles");

      const dirname = import.meta.dirname ?? ".";
      const binaryPath = process.argv[0] ?? ".";
      const dotfilesRoot = isCompiled
        ? path.resolve(path.dirname(binaryPath))
        : path.resolve(dirname, "..", "..", "..");

      const homeDir = os.homedir();
      return { dotfilesRoot, homeDir };
    }),
  },
) {}
