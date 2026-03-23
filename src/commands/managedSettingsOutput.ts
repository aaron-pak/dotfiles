import { Console, Effect } from 'effect';

type ManagedSettingsSummary = {
  readonly applicableKeys: readonly string[];
  readonly skippedKeys: readonly string[];
};

export const printManagedSettingsPreview = (label: string, summary: ManagedSettingsSummary) =>
  Effect.gen(function* () {
    if (summary.applicableKeys.length > 0) {
      yield* Console.log(`Would apply these shared ${label}:`);
      for (const key of summary.applicableKeys) {
        yield* Console.log(`  ${key}`);
      }
    } else if (summary.skippedKeys.length > 0) {
      yield* Console.log(`No shared ${label} would be applied on this machine right now.`);
    } else {
      yield* Console.log(`No shared ${label} are currently managed.`);
    }

    if (summary.skippedKeys.length > 0) {
      yield* Console.log(`This machine keeps its own value for these ${label}:`);
      for (const key of summary.skippedKeys) {
        yield* Console.log(`  ${key}`);
      }
    }
  });

export const printManagedSettingsApply = (
  label: string,
  summary: ManagedSettingsSummary & {
    readonly changedKeys: readonly string[];
    readonly totalKeys: number;
  },
) =>
  Effect.gen(function* () {
    if (summary.changedKeys.length > 0) {
      yield* Console.log(`Applied these shared ${label}:`);
      for (const key of summary.changedKeys) {
        yield* Console.log(`  ${key}`);
      }
    } else if (summary.applicableKeys.length > 0) {
      yield* Console.log(`Shared ${label} already match this machine. Nothing changed.`);
    } else if (summary.skippedKeys.length > 0) {
      yield* Console.log(`No shared ${label} were applied on this machine.`);
    } else {
      yield* Console.log(`No shared ${label} are currently managed.`);
    }

    if (summary.skippedKeys.length > 0) {
      yield* Console.log(`This machine kept its own value for these ${label}:`);
      for (const key of summary.skippedKeys) {
        yield* Console.log(`  ${key}`);
      }
    }

    yield* Console.log(`\n${summary.totalKeys} total setting(s) in the local file.`);
  });
