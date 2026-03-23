import { Command, Flag, Prompt } from 'effect/unstable/cli';
import { Console, Effect } from 'effect';
import { Homebrew } from '../services/Homebrew.js';
import {
  runManagedSettingsSync,
  runManagedSkillsSync,
  selectConflictChoice,
  runStowSyncWithChoice,
} from './syncFlow.js';
import type { ConflictChoice } from '../services/Stow.js';

const dry = Flag.boolean('dry').pipe(
  Flag.withAlias('n'),
  Flag.withDescription('Show what would happen without making changes'),
);

const skipBrew = Flag.boolean('skip-brew').pipe(
  Flag.withDescription('Skip Homebrew installation phase'),
);

export const runInitialization = Effect.fn('init.runInitialization')(function* (
  dry: boolean,
  skipBrew: boolean,
) {
  yield* runInitializationWithHooks(
    dry,
    skipBrew,
    () =>
      Prompt.run(
        Prompt.confirm({
          message: 'Homebrew is not installed. Install it now?',
          initial: true,
        }),
      ),
    selectConflictChoice,
  );
});

export const runInitializationWithHooks = <E1, R1, E2, R2>(
  dry: boolean,
  skipBrew: boolean,
  confirmHomebrewInstall: () => Effect.Effect<boolean, E1, R1>,
  chooseConflictResolution: () => Effect.Effect<ConflictChoice, E2, R2>,
) =>
  Effect.gen(function* () {
    const homebrew = yield* Homebrew;

    if (!skipBrew) {
      yield* Console.log('=== Phase 1: Homebrew ===\n');

      const brewInstalled = yield* homebrew.checkInstalled();

      if (!brewInstalled) {
        if (dry) {
          yield* Console.log('Would install Homebrew (not installed)');
        } else {
          const shouldInstall = yield* confirmHomebrewInstall();

          if (!shouldInstall) {
            yield* Console.log('Skipping Homebrew installation.');
          } else {
            yield* Console.log('Installing Homebrew...');
            yield* homebrew.install();
            yield* Console.log('Homebrew installed successfully!');
          }
        }
      } else {
        yield* Console.log('Homebrew is already installed.');
      }

      if (dry) {
        yield* Console.log('\nChecking Brewfile packages...');
        const checkResult = yield* homebrew.bundleDryRun();

        if (checkResult.satisfied) {
          yield* Console.log('All packages already installed.');
        } else {
          yield* Console.log(`Would install ${checkResult.missing.length} package(s):`);
          for (const pkg of checkResult.missing) {
            const prefix = pkg.type === 'cask' ? 'cask' : 'brew';
            yield* Console.log(`  ${prefix} ${pkg.name}`);
          }
        }
      } else {
        yield* Console.log('\nInstalling packages from Brewfile...');
        const bundleResult = yield* homebrew.bundle({ verbose: true });

        if (bundleResult.installed.length > 0) {
          yield* Console.log(`Installed ${bundleResult.installed.length} package(s):`);
          for (const pkg of bundleResult.installed) {
            yield* Console.log(`  ${pkg.name}`);
          }
        }

        if (bundleResult.skipped.length > 0) {
          yield* Console.log(`Already installed: ${bundleResult.skipped.length} package(s)`);
        }

        if (bundleResult.installed.length === 0 && bundleResult.skipped.length === 0) {
          yield* Console.log('All packages already installed.');
        }
      }
    } else {
      yield* Console.log('Skipping Homebrew phase (--skip-brew)');
    }

    yield* Console.log('\n=== Phase 2: Dotfiles ===\n');
    yield* runStowSyncWithChoice(dry, chooseConflictResolution);

    yield* Console.log('\n=== Phase 3: Managed AI Skills ===\n');
    yield* runManagedSkillsSync(dry);

    yield* Console.log('\n=== Phase 4: Managed AI Settings ===\n');
    yield* runManagedSettingsSync(dry);

    yield* Console.log('\nInitialization complete!');
  });

export const init = Command.make('init', { dry, skipBrew }, ({ dry, skipBrew }) =>
  runInitialization(dry, skipBrew),
).pipe(
  Command.withDescription(
    'Set up a new machine, then apply shared dotfiles, managed AI skills, and settings',
  ),
);
