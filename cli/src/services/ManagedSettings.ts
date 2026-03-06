import { isDeepStrictEqual } from "node:util";

type SettingsObject = Record<string, unknown>;

export type ManagedSettingsPreview = {
  readonly sharedKeys: readonly string[];
  readonly applicableKeys: readonly string[];
  readonly skippedKeys: readonly string[];
  readonly applicableShared: SettingsObject;
};

export const buildManagedSettingsPreview = (
  shared: SettingsObject,
  ignoredKeys: readonly string[],
  skippedByDefault: readonly string[] = [],
): ManagedSettingsPreview => {
  const sharedKeys = Object.keys(shared);
  const skippedKeys = sharedKeys.filter(
    (key) => ignoredKeys.includes(key) || skippedByDefault.includes(key),
  );
  const applicableEntries = Object.entries(shared).filter(
    ([key]) => !ignoredKeys.includes(key) && !skippedByDefault.includes(key),
  );

  return {
    sharedKeys,
    applicableKeys: applicableEntries.map(([key]) => key),
    skippedKeys,
    applicableShared: Object.fromEntries(applicableEntries),
  };
};

export const changedManagedKeys = (
  local: SettingsObject,
  shared: SettingsObject,
): readonly string[] =>
  Object.entries(shared).flatMap(([key, value]) =>
    isDeepStrictEqual(local[key], value) ? [] : [key],
  );

export const mergeManagedSettings = (
  local: SettingsObject,
  shared: SettingsObject,
): SettingsObject => ({
  ...local,
  ...shared,
});
