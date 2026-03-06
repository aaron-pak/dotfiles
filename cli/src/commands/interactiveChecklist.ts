import { Prompt } from "@effect/cli";
import { Terminal } from "@effect/platform";
import { Effect } from "effect";

type ChecklistChoice<Value> = {
  readonly value: Value;
  readonly title: string;
  readonly detail?: string;
  readonly selected?: boolean;
};

type ChecklistExtraAction<Extra extends string> = {
  readonly key: string;
  readonly action: Extra;
  readonly label: string;
};

type ChecklistPromptResult<Value, Extra extends string> =
  | {
      readonly _tag: "cancel";
    }
  | {
      readonly _tag: "confirm";
      readonly values: readonly Value[];
    }
  | {
      readonly _tag: "extra";
      readonly action: Extra;
      readonly values: readonly Value[];
    };

type ChecklistPromptOptions<Value, Extra extends string> = {
  readonly message: string;
  readonly choices: readonly ChecklistChoice<Value>[];
  readonly footer: readonly string[];
  readonly maxPerPage?: number;
  readonly min?: number;
  readonly selectionMode?: "single" | "multiple";
  readonly showSelectionSummary?: boolean;
  readonly selectHoveredWhenEmpty?: boolean;
  readonly emptySelectionError?: string;
  readonly extraActions?: readonly ChecklistExtraAction<Extra>[];
};

type PromptState = {
  readonly index: number;
  readonly selectedIndices: ReadonlySet<number>;
  readonly error: string | undefined;
};

const color = {
  reset: "\u001B[0m",
  bold: "\u001B[1m",
  green: "\u001B[38;5;114m",
  muted: "\u001B[38;5;245m",
  secondary: "\u001B[38;5;250m",
  cyan: "\u001B[38;5;117m",
  red: "\u001B[38;5;203m",
  white: "\u001B[97m",
};

const promptSymbol = "?";
const confirmSymbol = "✔";
const cancelSymbol = "✖";
const pointer = "›";
const pointerMuted = " ";
const bubbleOn = "●";
const bubbleOff = "○";
const leftPad = "    ";

const maxPerPageDefault = 10;

const wrapColor = (value: string, shade: string) =>
  `${shade}${value}${color.reset}`;

const padLine = (value: string) => `${leftPad}${value}`;

const beep = <State, Output>(): Prompt.Prompt.Action<State, Output> => ({
  _tag: "Beep",
});

const nextFrame = <State, Output>(
  state: State,
): Prompt.Prompt.Action<State, Output> => ({
  _tag: "NextFrame",
  state,
});

const submit = <State, Output>(
  value: Output,
): Prompt.Prompt.Action<State, Output> => ({
  _tag: "Submit",
  value,
});

const getVisibleWindow = (
  index: number,
  total: number,
  maxPerPage: number,
) => {
  if (total <= maxPerPage) {
    return {
      start: 0,
      end: total,
    };
  }

  const half = Math.floor(maxPerPage / 2);
  const unclampedStart = Math.max(index - half, 0);
  const maxStart = Math.max(total - maxPerPage, 0);
  const start = Math.min(unclampedStart, maxStart);

  return {
    start,
    end: Math.min(start + maxPerPage, total),
  };
};

const compactValues = <Value>(values: readonly (Value | undefined)[]) =>
  values.filter((value) => value !== undefined);

const selectedIndicesForAction = <Value, Extra extends string>(
  state: PromptState,
  options: ChecklistPromptOptions<Value, Extra>,
) => {
  if (options.selectionMode === "single") {
    return options.choices.length === 0 ? [] : [state.index];
  }

  if (state.selectedIndices.size > 0) {
    return [...state.selectedIndices].sort((left, right) => left - right);
  }

  if (options.selectHoveredWhenEmpty === true && options.choices.length > 0) {
    return [state.index];
  }

  return [];
};

const selectedValuesForAction = <Value, Extra extends string>(
  state: PromptState,
  options: ChecklistPromptOptions<Value, Extra>,
) =>
  compactValues(
    selectedIndicesForAction(state, options).map(
      (index) => options.choices[index]?.value,
    ),
  );

const selectedTitlesForAction = <Value, Extra extends string>(
  state: PromptState,
  options: ChecklistPromptOptions<Value, Extra>,
) =>
  compactValues(
    selectedIndicesForAction(state, options).map(
      (index) => options.choices[index]?.title,
    ),
  );

const selectionError = <Value, Extra extends string>(
  options: ChecklistPromptOptions<Value, Extra>,
) => options.emptySelectionError ?? "Select at least one item.";

const eraseRenderedText = (text: string, columns: number) => {
  const lines = text.split(/\r?\n/);
  let rows = 0;

  for (const line of lines) {
    const visibleLength = line.replace(/\u001B\[[0-9;]*m/g, "").length;
    rows += 1 + Math.floor(Math.max(visibleLength - 1, 0) / Math.max(columns, 1));
  }

  if (rows <= 0) {
    return "";
  }

  let clear = "\u001B[2K\r";
  for (let index = 1; index < rows; index++) {
    clear += "\u001B[1A\u001B[2K\r";
  }
  return clear;
};

const updateHighlightedIndex = (
  state: PromptState,
  total: number,
  direction: "up" | "down",
): PromptState => {
  if (total === 0) {
    return state;
  }

  const nextIndex =
    direction === "up"
      ? state.index === 0
        ? total - 1
        : state.index - 1
      : (state.index + 1) % total;

  return {
    index: nextIndex,
    selectedIndices: state.selectedIndices,
    error: undefined,
  };
};

const toggleSelectedIndex = (
  state: PromptState,
  index: number,
): PromptState => {
  const selectedIndices = new Set(state.selectedIndices);

  if (selectedIndices.has(index)) {
    selectedIndices.delete(index);
  } else {
    selectedIndices.add(index);
  }

  return {
    index: state.index,
    selectedIndices,
    error: undefined,
  };
};

const renderChecklistFrame = <Value, Extra extends string>(
  state: PromptState,
  options: ChecklistPromptOptions<Value, Extra>,
) =>
  Terminal.Terminal.pipe(
    Effect.flatMap((terminal) => terminal.columns),
    Effect.map((columns) => {
      const maxPerPage = options.maxPerPage ?? maxPerPageDefault;
      const visibleWindow = getVisibleWindow(
        state.index,
        options.choices.length,
        maxPerPage,
      );
      const visibleChoices = options.choices.slice(
        visibleWindow.start,
        visibleWindow.end,
      );
      const selectedTitles = selectedTitlesForAction(state, options);
      const selectionMode = options.selectionMode ?? "multiple";
      const showSelectionSummary =
        options.showSelectionSummary ?? selectionMode !== "single";

      const lines = options.message
        .split(/\r?\n/)
        .map((line, index) =>
          index === 0
            ? wrapColor(padLine(`${promptSymbol} ${line}`), `${color.bold}${color.white}`)
            : wrapColor(padLine(line), color.secondary),
        );

      lines.push("");

      for (const [relativeIndex, choice] of visibleChoices.entries()) {
        const absoluteIndex = visibleWindow.start + relativeIndex;
        const highlighted = absoluteIndex === state.index;
        const prefix = highlighted ? pointer : pointerMuted;
        const title = choice.title;
        const detail = choice.detail ?? "";
        const marker =
          selectionMode === "single"
            ? `${highlighted ? wrapColor(prefix, color.cyan) : prefix}`
            : `${highlighted ? wrapColor(prefix, color.cyan) : prefix} ${
                state.selectedIndices.has(absoluteIndex)
                  ? wrapColor(bubbleOn, color.green)
                  : wrapColor(bubbleOff, color.muted)
              }`;
        const row =
          detail.length === 0
            ? `${marker} ${wrapColor(title, color.white)}`
            : `${marker} ${wrapColor(title, color.white)} ${wrapColor(detail, color.muted)}`;
        lines.push(padLine(row));
      }

      lines.push("");
      const hiddenAbove = visibleWindow.start;
      const hiddenBelow = options.choices.length - visibleWindow.end;
      const overflowParts: string[] = [];
      if (hiddenAbove > 0) {
        overflowParts.push(`↑ ${hiddenAbove} more`);
      }
      if (hiddenBelow > 0) {
        overflowParts.push(`↓ ${hiddenBelow} more`);
      }
      lines.push(
        wrapColor(
          padLine(overflowParts.length === 0 ? " " : overflowParts.join("   ")),
          color.muted,
        ),
      );
      if (showSelectionSummary) {
        lines.push("");
        const selectedLine =
          selectedTitles.length === 0
            ? `${wrapColor("Selected:", color.green)} ${wrapColor("none", color.secondary)}`
            : `${wrapColor("Selected:", color.green)} ${wrapColor(selectedTitles.join(", "), color.white)}`;
        lines.push(padLine(selectedLine));
      }
      lines.push("");
      lines.push(...options.footer.map((line) => wrapColor(padLine(line), color.muted)));

      if (state.error !== undefined) {
        lines.push("");
        lines.push(wrapColor(padLine(state.error), color.red));
      }

      const rendered = `${lines.join("\n")}\n`;
      return columns >= 0 ? rendered : rendered;
    }),
  );

const renderChecklistSubmission = <Value, Extra extends string>(
  result: ChecklistPromptResult<Value, Extra>,
  options: ChecklistPromptOptions<Value, Extra>,
) =>
  Effect.succeed(() => {
    const symbol =
      result._tag === "cancel" ? cancelSymbol : confirmSymbol;
    const label =
      result._tag === "cancel"
        ? "Cancelled"
        : result._tag === "extra"
          ? result.action
          : compactValues(
                result.values.map((value) =>
                  options.choices.find((choice) => choice.value === value)?.title,
                ),
              ).join(", ");
    const lines = options.message
      .split(/\r?\n/)
      .map((line, index) =>
        index === 0
          ? wrapColor(padLine(`${symbol} ${line}`), `${color.bold}${color.white}`)
          : wrapColor(padLine(line), color.secondary),
      );
    return `${lines.join("\n")} ${wrapColor(label, color.white)}\n`;
  }).pipe(Effect.map((render) => render()));

const clearChecklistFrame = <Value, Extra extends string>(
  state: PromptState,
  options: ChecklistPromptOptions<Value, Extra>,
) =>
  Terminal.Terminal.pipe(
    Effect.flatMap((terminal) =>
      terminal.columns.pipe(
        Effect.flatMap((columns) =>
          renderChecklistFrame(state, options).pipe(
            Effect.map((rendered) => eraseRenderedText(rendered, columns)),
          ),
        ),
      ),
    ),
  );

const initialSelectedIndices = <Value>(
  choices: readonly ChecklistChoice<Value>[],
) => {
  const indices = new Set<number>();
  for (const [index, choice] of choices.entries()) {
    if (choice.selected === true) {
      indices.add(index);
    }
  }
  return indices;
};

const runChecklistPrompt = <Value, Extra extends string>(
  options: ChecklistPromptOptions<Value, Extra>,
) =>
  Prompt.custom<PromptState, ChecklistPromptResult<Value, Extra>>(
    {
      index: 0,
      selectedIndices: initialSelectedIndices(options.choices),
      error: undefined,
    },
    {
      render: (state, action) =>
        action._tag === "Submit"
          ? renderChecklistSubmission(action.value, options)
          : renderChecklistFrame(state, options),
      process: (input, state) => {
        switch (input.key.name) {
          case "k":
          case "up":
            return Effect.succeed(
              nextFrame<PromptState, ChecklistPromptResult<Value, Extra>>(
                updateHighlightedIndex(state, options.choices.length, "up"),
              ),
            );
          case "j":
          case "down":
          case "tab":
            return Effect.succeed(
              nextFrame<PromptState, ChecklistPromptResult<Value, Extra>>(
                updateHighlightedIndex(state, options.choices.length, "down"),
              ),
            );
          case "space":
            if ((options.selectionMode ?? "multiple") === "single") {
              return Effect.succeed(
                beep<PromptState, ChecklistPromptResult<Value, Extra>>(),
              );
            }
            if (options.choices.length === 0) {
              return Effect.succeed(
                beep<PromptState, ChecklistPromptResult<Value, Extra>>(),
              );
            }

            return Effect.succeed(
              nextFrame<PromptState, ChecklistPromptResult<Value, Extra>>(
                toggleSelectedIndex(state, state.index),
              ),
            );
          case "left":
          case "right":
          case "h":
          case "l":
            return Effect.succeed(
              beep<PromptState, ChecklistPromptResult<Value, Extra>>(),
            );
          case "escape":
            return Effect.succeed(
              submit<PromptState, ChecklistPromptResult<Value, Extra>>({
                _tag: "cancel",
              }),
            );
          case "enter":
          case "return": {
            const values = selectedValuesForAction(state, options);
            const min = options.min ?? 0;
            if (values.length < min) {
              return Effect.succeed(
                nextFrame<PromptState, ChecklistPromptResult<Value, Extra>>({
                  index: state.index,
                  selectedIndices: state.selectedIndices,
                  error: selectionError(options),
                }),
              );
            }

            return Effect.succeed(
              submit<PromptState, ChecklistPromptResult<Value, Extra>>({
                _tag: "confirm",
                values,
              }),
            );
          }
          default: {
            const extraAction = options.extraActions?.find(
              (action) => action.key === input.key.name,
            );

            if (extraAction !== undefined) {
              const values = selectedValuesForAction(state, options);
              if (values.length === 0) {
                return Effect.succeed(
                  nextFrame<PromptState, ChecklistPromptResult<Value, Extra>>({
                    index: state.index,
                    selectedIndices: state.selectedIndices,
                    error: selectionError(options),
                  }),
                );
              }

              return Effect.succeed(
                submit<PromptState, ChecklistPromptResult<Value, Extra>>({
                  _tag: "extra",
                  action: extraAction.action,
                  values,
                }),
              );
            }

            return Effect.succeed(
              beep<PromptState, ChecklistPromptResult<Value, Extra>>(),
            );
          }
        }
      },
      clear: (state) => clearChecklistFrame(state, options),
    },
  );

export {
  runChecklistPrompt,
  type ChecklistChoice,
  type ChecklistExtraAction,
  type ChecklistPromptOptions,
  type ChecklistPromptResult,
};
