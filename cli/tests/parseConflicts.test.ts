import { describe, expect, it } from "@effect/vitest";
import { parseConflicts, StowConflict } from "../src/services/Stow.js";

describe("parseConflicts", () => {
  it("empty string -> empty array", () => {
    expect(parseConflicts("")).toEqual([]);
  });

  it("single conflict line -> single StowConflict", () => {
    const stderr =
      "* cannot stow .config/nvim over existing target .config/nvim since neither a link nor a directory";

    const result = parseConflicts(stderr);

    expect(result).toEqual([
      new StowConflict({
        source: ".config/nvim",
        target: ".config/nvim",
        reason: "neither a link nor a directory",
      }),
    ]);
  });

  it("multiple conflict lines -> multiple StowConflicts", () => {
    const stderr = `WARNING: some warning
* cannot stow .bashrc over existing target .bashrc since neither a link nor a directory
LINK: creating new link: .profile
* cannot stow .zshrc over existing target .zshrc since it is a directory`;

    const result = parseConflicts(stderr);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(
      new StowConflict({
        source: ".bashrc",
        target: ".bashrc",
        reason: "neither a link nor a directory",
      }),
    );
    expect(result[1]).toEqual(
      new StowConflict({
        source: ".zshrc",
        target: ".zshrc",
        reason: "it is a directory",
      }),
    );
  });

  it("mixed valid/invalid lines -> only valid parsed", () => {
    const stderr = `some random output
* cannot stow foo over existing target bar since reason here
invalid conflict line format
* another invalid line
* cannot stow a over existing target b since c`;

    const result = parseConflicts(stderr);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(
      new StowConflict({ source: "foo", target: "bar", reason: "reason here" }),
    );
    expect(result[1]).toEqual(
      new StowConflict({ source: "a", target: "b", reason: "c" }),
    );
  });

  it("handles paths with special chars", () => {
    const stderr =
      "* cannot stow .config/my-app over existing target .config/my-app since file exists";

    const result = parseConflicts(stderr);

    expect(result).toEqual([
      new StowConflict({
        source: ".config/my-app",
        target: ".config/my-app",
        reason: "file exists",
      }),
    ]);
  });

  it("handles paths with spaces", () => {
    const stderr =
      "* cannot stow path with spaces over existing target other path since some reason";

    const result = parseConflicts(stderr);

    expect(result).toEqual([
      new StowConflict({
        source: "path with spaces",
        target: "other path",
        reason: "some reason",
      }),
    ]);
  });

  it("handles unicode in paths", () => {
    const stderr =
      "* cannot stow .config/日本語 over existing target .config/日本語 since exists";

    const result = parseConflicts(stderr);

    expect(result).toEqual([
      new StowConflict({
        source: ".config/日本語",
        target: ".config/日本語",
        reason: "exists",
      }),
    ]);
  });

  it("blank lines ignored", () => {
    const stderr = `
* cannot stow a over existing target b since c

`;
    const result = parseConflicts(stderr);

    expect(result).toHaveLength(1);
  });
});
