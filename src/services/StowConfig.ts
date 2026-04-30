import { Effect, Layer, Path, ServiceMap } from 'effect';
import * as os from 'node:os';

/**
 * Configuration service for Stow operations.
 * Provides injectable paths for dotfiles root and home directory.
 */
export class StowConfig extends ServiceMap.Service<
  StowConfig,
  {
    readonly dotfilesRoot: string;
    readonly homeDir: string;
  }
>()('@dotfiles/StowConfig') {
  static readonly Live = Layer.effect(
    StowConfig,
    Effect.gen(function* () {
      const path = yield* Path.Path;

      // In compiled Bun binaries, import.meta.dirname is virtual (/$bunfs/root/...).
      // In source and dist runs this module lives under repo/src/services or repo/dist/services.
      const isCompiled =
        import.meta.dirname?.startsWith('/$bunfs') || !import.meta.dirname?.includes('dotfiles');

      const dirname = import.meta.dirname ?? '.';
      const binaryPath = process.argv[0] ?? '.';
      const dotfilesRoot = isCompiled
        ? path.resolve(path.dirname(binaryPath))
        : path.resolve(dirname, '..', '..');

      return StowConfig.of({
        dotfilesRoot,
        homeDir: os.homedir(),
      });
    }),
  );
}
