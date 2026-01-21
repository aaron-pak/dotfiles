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
      const dotfilesRoot = path.resolve(
        import.meta.dirname ?? process.cwd(),
        "..",
        "..",
        "..",
      );
      const homeDir = os.homedir();
      return { dotfilesRoot, homeDir };
    }),
  },
) {}
