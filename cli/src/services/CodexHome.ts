import { Data, Effect, FileSystem, Layer, Path, ServiceMap } from "effect";
import { StowConfig } from "./StowConfig.js";

export class CodexHomeError extends Data.TaggedError("CodexHomeError")<{
  readonly details: string;
}> {
  override get message() {
    return `Codex home error: ${this.details}`;
  }
}

type RepairPreview = {
  readonly needsRepair: boolean;
  readonly path: string;
};

type RepairResult = {
  readonly repaired: boolean;
  readonly path: string;
};

const isNotFound = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "reason" in error &&
  typeof error.reason === "object" &&
  error.reason !== null &&
  "_tag" in error.reason &&
  error.reason._tag === "NotFound";

export class CodexHome extends ServiceMap.Service<
  CodexHome,
  {
    readonly path: string;
    readonly previewRepair: () => Effect.Effect<RepairPreview, CodexHomeError>;
    readonly repairIfNeeded: () => Effect.Effect<RepairResult, CodexHomeError>;
  }
>()("@dotfiles/CodexHome") {
  static readonly Live = Layer.effect(
    CodexHome,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { dotfilesRoot, homeDir } = yield* StowConfig;

      const codexHomePath = path.join(homeDir, ".codex");
      const repoCodexPath = path.join(dotfilesRoot, "home", ".codex");
      const repairTempPath = path.join(homeDir, ".codex.dot-repair.tmp");

      const realPath = (targetPath: string) =>
        fs.realPath(targetPath).pipe(
          Effect.mapError(
            (error) =>
              new CodexHomeError({
                details: `Failed to resolve ${targetPath}: ${error}`,
              }),
          ),
        );

      const removePath = (targetPath: string) =>
        fs.remove(targetPath, { recursive: true }).pipe(
          Effect.mapError(
            (error) =>
              new CodexHomeError({
                details: `Failed to remove ${targetPath}: ${error}`,
              }),
          ),
        );

      const readLinkIfSymbolicLink = (targetPath: string) =>
        fs.readLink(targetPath).pipe(
          Effect.catchIf(isNotFound, () => Effect.succeed<string | null>(null)),
          Effect.catchIf(
            () => true,
            (readLinkError) =>
              fs.stat(targetPath).pipe(
                Effect.catchIf(isNotFound, () =>
                  Effect.succeed<null | { readonly type: string }>(null),
                ),
                Effect.mapError(
                  (statError) =>
                    new CodexHomeError({
                      details: `Failed to stat ${targetPath}: ${statError}`,
                    }),
                ),
                Effect.flatMap((info) =>
                  info === null || info.type !== "SymbolicLink"
                    ? Effect.succeed<string | null>(null)
                    : Effect.fail(
                        new CodexHomeError({
                          details: `Failed to read ${targetPath}: ${readLinkError}`,
                        }),
                      ),
                ),
              ),
          ),
          Effect.mapError((error) =>
            error instanceof CodexHomeError
              ? error
              : new CodexHomeError({
                  details: `Failed to read ${targetPath}: ${error}`,
                }),
          ),
        );

      const isLegacySymlink = Effect.fn("CodexHome.isLegacySymlink")(function* () {
        const linkTarget = yield* readLinkIfSymbolicLink(codexHomePath);
        if (linkTarget === null) {
          return false;
        }

        const resolvedCodexHome = yield* realPath(codexHomePath);
        const resolvedRepoCodex = yield* realPath(repoCodexPath);

        return resolvedCodexHome === resolvedRepoCodex;
      });

      const previewRepair = Effect.fn("CodexHome.previewRepair")(function* () {
        const needsRepair = yield* isLegacySymlink();
        return {
          needsRepair,
          path: codexHomePath,
        } satisfies RepairPreview;
      });

      const repairIfNeeded = Effect.fn("CodexHome.repairIfNeeded")(function* () {
        const needsRepair = yield* isLegacySymlink();
        if (!needsRepair) {
          return {
            repaired: false,
            path: codexHomePath,
          } satisfies RepairResult;
        }

        const resolvedRepoCodex = yield* realPath(repoCodexPath);

        yield* removePath(repairTempPath).pipe(
          Effect.catchIf(isNotFound, () => Effect.void),
        );

        yield* fs.copy(resolvedRepoCodex, repairTempPath, {
          overwrite: true,
        }).pipe(
          Effect.mapError(
            (error) =>
              new CodexHomeError({
                details: `Failed to copy ${resolvedRepoCodex} to ${repairTempPath}: ${error}`,
              }),
          ),
        );

        yield* removePath(codexHomePath);

        yield* fs.rename(repairTempPath, codexHomePath).pipe(
          Effect.mapError(
            (error) =>
              new CodexHomeError({
                details: `Failed to move ${repairTempPath} to ${codexHomePath}: ${error}`,
              }),
          ),
        );

        return {
          repaired: true,
          path: codexHomePath,
        } satisfies RepairResult;
      });

      return CodexHome.of({
        path: codexHomePath,
        previewRepair,
        repairIfNeeded,
      });
    }),
  );
}

export const CodexHomeLive = CodexHome.Live;
