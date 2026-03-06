import { FileSystem, Path } from "@effect/platform";
import { Effect, Schema } from "effect";
import {
  AiState,
  type ManagedSkillState,
  type SkillTarget,
} from "./AiState.js";
import { StowConfig } from "./StowConfig.js";

export class AiSkillsError extends Schema.TaggedError<AiSkillsError>()(
  "AiSkillsError",
  { details: Schema.String },
) {
  override get message() {
    return `AI skills error: ${this.details}`;
  }
}

export type SkillSurface = SkillTarget;

type SkillSyncPreview = {
  readonly toCreate: readonly string[];
  readonly toRemove: readonly string[];
  readonly unchanged: readonly string[];
  readonly conflicts: readonly string[];
};

type AdoptSkillInput = {
  readonly name: string;
  readonly sourcePath: string;
  readonly targets: readonly SkillTarget[];
};

const skillTargets: readonly SkillTarget[] = ["claude", "codex", "agents"];

const normalizeTargets = (
  targets: readonly SkillTarget[],
): readonly SkillTarget[] =>
  [...new Set(targets)].sort((left, right) =>
    skillTargets.indexOf(left) - skillTargets.indexOf(right),
  );

export class AiSkills extends Effect.Service<AiSkills>()("@dotfiles/AiSkills", {
  effect: Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const aiState = yield* AiState;
    const { dotfilesRoot, homeDir } = yield* StowConfig;

    const canonicalRoot = path.join(dotfilesRoot, "ai", "skills");
    const surfaceDir = (surface: SkillSurface) =>
      surface === "claude"
        ? path.join(homeDir, ".claude", "skills")
        : surface === "codex"
          ? path.join(homeDir, ".codex", "skills")
          : path.join(homeDir, ".agents", "skills");

    const targetPathFor = (skillName: string, target: SkillTarget) =>
      path.join(surfaceDir(target), skillName);

    const displayPath = (fullPath: string) => `~/${path.relative(homeDir, fullPath)}`;

    const canonicalPathFor = (skill: ManagedSkillState) =>
      path.join(dotfilesRoot, skill.canonical_dir);

    const ensureDirectory = (dirPath: string) =>
      fs.makeDirectory(dirPath, { recursive: true }).pipe(
        Effect.catchAll((error) =>
          AiSkillsError.make({
            details: `Failed to create ${dirPath}: ${error}`,
          }),
        ),
      );

    const removePath = (targetPath: string) =>
      fs.remove(targetPath, { recursive: true }).pipe(
        Effect.catchAll((error) =>
          AiSkillsError.make({
            details: `Failed to remove ${targetPath}: ${error}`,
          }),
        ),
      );

    const copyPath = (fromPath: string, toPath: string) =>
      fs.copy(fromPath, toPath).pipe(
        Effect.catchAll((error) =>
          AiSkillsError.make({
            details: `Failed to copy ${fromPath} to ${toPath}: ${error}`,
          }),
        ),
      );

    const createManagedSymlink = (targetPath: string, canonicalPath: string) =>
      Effect.gen(function* () {
        const targetDir = path.dirname(targetPath);
        yield* ensureDirectory(targetDir);
        const resolvedTargetDir = yield* fs.realPath(targetDir).pipe(
          Effect.catchAll((error) =>
            AiSkillsError.make({
              details: `Failed to resolve ${targetDir}: ${error}`,
            }),
          ),
        );
        const resolvedCanonicalPath = yield* fs.realPath(canonicalPath).pipe(
          Effect.catchAll((error) =>
            AiSkillsError.make({
              details: `Failed to resolve ${canonicalPath}: ${error}`,
            }),
          ),
        );
        const linkPath = path.relative(resolvedTargetDir, resolvedCanonicalPath);
        yield* fs
          .symlink(linkPath, targetPath)
          .pipe(
            Effect.catchAll((error) =>
              AiSkillsError.make({
                details: `Failed to create symlink ${targetPath}: ${error}`,
              }),
            ),
          );
      });

    const getPathType = (targetPath: string) =>
      fs.readLink(targetPath).pipe(
        Effect.matchEffect({
          onFailure: () =>
            fs.stat(targetPath).pipe(
              Effect.map((info) => info.type),
              Effect.catchAll(() => Effect.succeed<"Missing">("Missing")),
            ),
          onSuccess: () => Effect.succeed<"SymbolicLink">("SymbolicLink"),
        }),
      );

    const isManagedSymlink = Effect.fn("AiSkills.isManagedSymlink")(function* (
      targetPath: string,
      canonicalPath: string,
    ) {
      const targetType = yield* getPathType(targetPath);
      if (targetType !== "SymbolicLink") {
        return false;
      }

      const resolvedTarget = yield* fs.realPath(targetPath).pipe(
        Effect.catchAll((error) =>
          AiSkillsError.make({
            details: `Failed to resolve ${targetPath}: ${error}`,
          }),
        ),
      );
      const resolvedCanonical = yield* fs.realPath(canonicalPath).pipe(
        Effect.catchAll((error) =>
          AiSkillsError.make({
            details: `Failed to resolve ${canonicalPath}: ${error}`,
          }),
        ),
      );

      return resolvedTarget === resolvedCanonical;
    });

    const ensureLocalSurface = Effect.fn("AiSkills.ensureLocalSurface")(
      function* (surface: SkillSurface) {
        const dirPath = surfaceDir(surface);
        const targetType = yield* getPathType(dirPath);
        if (targetType === "Missing") {
          yield* ensureDirectory(dirPath);
        }
      },
    );

    const includesTarget = (
      targets: readonly SkillTarget[],
      target: SkillTarget,
    ) => targets.includes(target);

    const targetsToEnable = (
      currentTargets: readonly SkillTarget[],
      nextTargets: readonly SkillTarget[],
    ) =>
      skillTargets.filter(
        (target) =>
          !includesTarget(currentTargets, target) &&
          includesTarget(nextTargets, target),
      );

    const targetsToDisable = (
      currentTargets: readonly SkillTarget[],
      nextTargets: readonly SkillTarget[],
    ) =>
      skillTargets.filter(
        (target) =>
          includesTarget(currentTargets, target) &&
          !includesTarget(nextTargets, target),
      );

    const listLocalSkills = Effect.fn("AiSkills.listLocalSkills")(function* (
      surface: SkillSurface,
    ) {
      const dirPath = surfaceDir(surface);
      const exists = yield* fs.exists(dirPath).pipe(
        Effect.catchAll((error) =>
          AiSkillsError.make({
            details: `Failed to inspect ${dirPath}: ${error}`,
          }),
        ),
      );

      if (!exists) {
        return [];
      }

      const entries = yield* fs.readDirectory(dirPath).pipe(
        Effect.catchAll((error) =>
          AiSkillsError.make({
            details: `Failed to read ${dirPath}: ${error}`,
          }),
        ),
      );

      return entries.filter((entry) => !entry.startsWith(".")).sort();
    });

    const previewSync = Effect.fn("AiSkills.previewSync")(function* () {
      const skills = yield* aiState.listSkills();
      const toCreate: string[] = [];
      const toRemove: string[] = [];
      const unchanged: string[] = [];
      const conflicts: string[] = [];

      for (const [skillName, skill] of Object.entries(skills)) {
        const canonicalPath = canonicalPathFor(skill);
        for (const target of skillTargets) {
          if (includesTarget(skill.targets, target)) {
            continue;
          }

          const targetPath = targetPathFor(skillName, target);
          const managed = yield* isManagedSymlink(targetPath, canonicalPath).pipe(
            Effect.catchAll(() => Effect.succeed(false)),
          );
          if (managed) {
            toRemove.push(displayPath(targetPath));
          }
        }

        for (const target of skill.targets) {
          const targetPath = targetPathFor(skillName, target);
          const targetType = yield* getPathType(targetPath);

          if (targetType === "Missing") {
            toCreate.push(displayPath(targetPath));
            continue;
          }

          if (targetType !== "SymbolicLink") {
            conflicts.push(
              `${displayPath(targetPath)} already exists as a local ${targetType.toLowerCase()}`,
            );
            continue;
          }

          const managed = yield* isManagedSymlink(targetPath, canonicalPath);
          if (managed) {
            unchanged.push(displayPath(targetPath));
          } else {
            conflicts.push(
              `${displayPath(targetPath)} already exists as a different symlink`,
            );
          }
        }
      }

      return {
        toCreate,
        toRemove,
        unchanged,
        conflicts,
      } satisfies SkillSyncPreview;
    });

    const sync = Effect.fn("AiSkills.sync")(function* () {
      const skills = yield* aiState.listSkills();
      const toCreate: string[] = [];
      const toRemove: string[] = [];
      const unchanged: string[] = [];
      const conflicts: string[] = [];

      for (const skill of Object.values(skills)) {
        for (const target of skill.targets) {
          yield* ensureLocalSurface(target);
        }
      }

      for (const [skillName, skill] of Object.entries(skills)) {
        const canonicalPath = canonicalPathFor(skill);
        for (const target of skillTargets) {
          if (includesTarget(skill.targets, target)) {
            continue;
          }

          const targetPath = targetPathFor(skillName, target);
          const managed = yield* isManagedSymlink(targetPath, canonicalPath).pipe(
            Effect.catchAll(() => Effect.succeed(false)),
          );
          if (managed) {
            toRemove.push(displayPath(targetPath));
          }
        }

        for (const target of skill.targets) {
          const targetPath = targetPathFor(skillName, target);
          const targetType = yield* getPathType(targetPath);

          if (targetType === "Missing") {
            toCreate.push(displayPath(targetPath));
            continue;
          }

          if (targetType === "SymbolicLink") {
            const managed = yield* isManagedSymlink(targetPath, canonicalPath);
            if (managed) {
              unchanged.push(displayPath(targetPath));
            } else {
              conflicts.push(
                `${displayPath(targetPath)} already exists as a different symlink`,
              );
            }
            continue;
          }

          conflicts.push(
            `${displayPath(targetPath)} already exists as a local ${targetType.toLowerCase()}`,
          );
        }
      }

      if (conflicts.length > 0) {
        return yield* AiSkillsError.make({
          details: `Managed skill sync conflicts:\n${conflicts.map((conflict) => `  ${conflict}`).join("\n")}`,
        });
      }

      for (const [skillName, skill] of Object.entries(skills)) {
        const canonicalPath = canonicalPathFor(skill);
        for (const target of skillTargets) {
          if (includesTarget(skill.targets, target)) {
            continue;
          }

          const targetPath = targetPathFor(skillName, target);
          const managed = yield* isManagedSymlink(targetPath, canonicalPath).pipe(
            Effect.catchAll(() => Effect.succeed(false)),
          );
          if (managed) {
            yield* removePath(targetPath);
          }
        }

        for (const target of skill.targets) {
          const targetPath = targetPathFor(skillName, target);
          const targetType = yield* getPathType(targetPath);

          if (targetType === "Missing") {
            yield* createManagedSymlink(targetPath, canonicalPath);
            continue;
          }

          if (targetType === "SymbolicLink") {
            const managed = yield* isManagedSymlink(targetPath, canonicalPath);
            if (managed) {
              continue;
            }
          }
        }
      }

      return {
        toCreate,
        toRemove,
        unchanged,
        conflicts,
      } satisfies SkillSyncPreview;
    });

    const validateSourcePath = Effect.fn("AiSkills.validateSourcePath")(
      function* (sourcePath: string) {
        const targetType = yield* getPathType(sourcePath);
        if (targetType === "Missing") {
          return yield* AiSkillsError.make({
            details: `Skill source not found: ${sourcePath}`,
          });
        }

        if (targetType !== "Directory") {
          return yield* AiSkillsError.make({
            details: `Skill source must be a directory: ${sourcePath}`,
          });
        }
      },
    );

    const validateAdoptTargets = Effect.fn("AiSkills.validateAdoptTargets")(
      function* (
        name: string,
        canonicalPath: string,
        targets: readonly SkillTarget[],
        sourcePath: string,
      ) {
        if (targets.length === 0) {
          return yield* AiSkillsError.make({
            details: `Managed skill "${name}" must target at least one surface`,
          });
        }

        for (const target of targets) {
          const targetPath = targetPathFor(name, target);
          if (targetPath === sourcePath) {
            continue;
          }

          const targetType = yield* getPathType(targetPath);
          if (targetType === "Missing") {
            continue;
          }

          if (targetType === "SymbolicLink") {
            const managed = yield* isManagedSymlink(targetPath, canonicalPath).pipe(
              Effect.catchAll(() => Effect.succeed(false)),
            );
            if (!managed) {
              return yield* AiSkillsError.make({
                details: `${displayPath(targetPath)} already exists as a different symlink`,
              });
            }
            continue;
          }

          return yield* AiSkillsError.make({
            details: `${displayPath(targetPath)} already exists as a local ${targetType.toLowerCase()}`,
          });
        }
      },
    );

    const adopt = Effect.fn("AiSkills.adopt")(function* ({
      name,
      sourcePath,
      targets,
    }: AdoptSkillInput) {
      yield* validateSourcePath(sourcePath);

      const existingSkill = yield* aiState.getSkill(name);
      if (existingSkill !== undefined) {
        return yield* AiSkillsError.make({
          details: `Managed skill "${name}" already exists`,
        });
      }

      const canonicalDir = path.join("ai", "skills", name);
      const canonicalPath = path.join(dotfilesRoot, canonicalDir);
      const canonicalExists = yield* fs.exists(canonicalPath).pipe(
        Effect.catchAll((error) =>
          AiSkillsError.make({
            details: `Failed to inspect ${canonicalPath}: ${error}`,
          }),
        ),
      );
      if (canonicalExists) {
        return yield* AiSkillsError.make({
          details: `Canonical managed skill path already exists: ${canonicalDir}`,
        });
      }

      const normalizedTargets = normalizeTargets(targets);
      yield* validateAdoptTargets(name, canonicalPath, normalizedTargets, sourcePath);
      yield* ensureDirectory(path.dirname(canonicalPath));
      yield* copyPath(sourcePath, canonicalPath);
      yield* aiState.upsertSkill(name, {
        canonical_dir: canonicalDir,
        targets: normalizedTargets,
      });

      yield* removePath(sourcePath);

      for (const target of normalizedTargets) {
        const targetPath = targetPathFor(name, target);
        if (targetPath === sourcePath) {
          yield* createManagedSymlink(targetPath, canonicalPath);
          continue;
        }

        const targetType = yield* getPathType(targetPath);
        if (targetType === "Missing") {
          yield* createManagedSymlink(targetPath, canonicalPath);
        }
      }

      return {
        name,
        canonicalDir,
        targets: normalizedTargets,
      };
    });

    const updateTargets = Effect.fn("AiSkills.updateTargets")(function* (
      name: string,
      targets: readonly SkillTarget[],
    ) {
      const skill = yield* aiState.getSkill(name);
      if (skill === undefined) {
        return yield* AiSkillsError.make({
          details: `Managed skill "${name}" not found`,
        });
      }

      const normalizedTargets = normalizeTargets(targets);
      if (normalizedTargets.length === 0) {
        return yield* AiSkillsError.make({
          details: `Managed skill "${name}" must keep at least one target. Use unmanage to stop managing it entirely.`,
        });
      }

      const canonicalPath = canonicalPathFor(skill);
      const toEnable = targetsToEnable(skill.targets, normalizedTargets);
      const toDisable = targetsToDisable(skill.targets, normalizedTargets);

      for (const target of toEnable) {
        const targetPath = targetPathFor(name, target);
        const targetType = yield* getPathType(targetPath);
        if (targetType === "Missing") {
          continue;
        }

        const managed = yield* isManagedSymlink(targetPath, canonicalPath).pipe(
          Effect.catchAll(() => Effect.succeed(false)),
        );
        if (managed) {
          continue;
        }

        return yield* AiSkillsError.make({
          details:
            targetType === "SymbolicLink"
              ? `${displayPath(targetPath)} already exists as a different symlink`
              : `${displayPath(targetPath)} already exists as a local ${targetType.toLowerCase()}`,
        });
      }

      for (const target of toDisable) {
        const targetPath = targetPathFor(name, target);
        const targetType = yield* getPathType(targetPath);
        if (targetType === "Missing") {
          continue;
        }

        const managed = yield* isManagedSymlink(targetPath, canonicalPath).pipe(
          Effect.catchAll(() => Effect.succeed(false)),
        );
        if (managed) {
          continue;
        }

        return yield* AiSkillsError.make({
          details:
            targetType === "SymbolicLink"
              ? `${displayPath(targetPath)} is not managed by this skill`
              : `${displayPath(targetPath)} is not a managed symlink and cannot be removed automatically`,
        });
      }

      yield* aiState.upsertSkill(name, {
        canonical_dir: skill.canonical_dir,
        targets: normalizedTargets,
      });

      for (const target of toDisable) {
        const targetPath = targetPathFor(name, target);
        yield* removePath(targetPath);
      }

      for (const target of toEnable) {
        yield* ensureLocalSurface(target);
        const targetPath = targetPathFor(name, target);
        yield* createManagedSymlink(targetPath, canonicalPath);
      }

      return {
        name,
        canonicalDir: skill.canonical_dir,
        targets: normalizedTargets,
        enabledTargets: toEnable,
        disabledTargets: toDisable,
      };
    });

    const unmanage = Effect.fn("AiSkills.unmanage")(function* (name: string) {
      const skill = yield* aiState.getSkill(name);
      if (skill === undefined) {
        return yield* AiSkillsError.make({
          details: `Managed skill "${name}" not found`,
        });
      }

      const canonicalPath = canonicalPathFor(skill);
      for (const target of skill.targets) {
        const targetPath = targetPathFor(name, target);
        const managed = yield* isManagedSymlink(targetPath, canonicalPath).pipe(
          Effect.catchAll(() => Effect.succeed(false)),
        );

        if (!managed) {
          continue;
        }

        yield* removePath(targetPath);
        yield* copyPath(canonicalPath, targetPath);
      }

      yield* removePath(canonicalPath);
      yield* aiState.removeSkill(name);

      return {
        name,
        removedTargets: skill.targets.map((target) => displayPath(targetPathFor(name, target))),
      };
    });

    const list = Effect.fn("AiSkills.list")(function* () {
      const skills = yield* aiState.listSkills();
      return Object.entries(skills)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, skill]) => ({
          name,
          canonical_dir: skill.canonical_dir,
          targets: skill.targets,
        }));
    });

    const sourcePathForSurface = Effect.fn("AiSkills.sourcePathForSurface")(
      function* (surface: SkillSurface, skillName: string) {
        const sourcePath = targetPathFor(skillName, surface);
        yield* validateSourcePath(sourcePath);
        return sourcePath;
      },
    );

    return {
      canonicalRoot,
      listLocalSkills,
      sourcePathForSurface,
      previewSync,
      sync,
      adopt,
      updateTargets,
      unmanage,
      list,
    };
  }),
}) {}
