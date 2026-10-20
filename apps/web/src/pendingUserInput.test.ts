import { describe, expect, it } from "vite-plus/test";

import {
  buildPendingUserInputAnswers,
  carryDisplacedCustomAnswerIntoPrompt,
  countAnsweredPendingUserInputQuestions,
  derivePendingUserInputCarryOn,
  derivePendingUserInputProgress,
  describePendingUserInputOption,
  formatPendingUserInputAnswersAsMessage,
  formatPendingUserInputCarryOn,
  PENDING_USER_INPUT_CARRY_ON_DELAY_MS,
  resolvePendingUserInputAnswer,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
} from "./pendingUserInput";

const singleSelectQuestion = {
  id: "scope",
  header: "Scope",
  question: "What should the plan target first?",
  options: [
    {
      label: "Orchestration-first",
      description: "Focus on orchestration first",
    },
  ],
  multiSelect: false,
} as const;

const multiSelectQuestion = {
  id: "areas",
  header: "Areas",
  question: "Which areas should this change cover?",
  options: [
    {
      label: "Server",
      description: "Server",
    },
    {
      label: "Web",
      description: "Web",
    },
  ],
  multiSelect: true,
} as const;

const nativeChoiceQuestion = {
  id: "result",
  header: "Result",
  question: "Which result should be used?",
  options: [
    { value: " first\t", label: "Result", description: "First result" },
    { value: "second", label: "Result", description: "Second result" },
  ],
  allowCustomAnswer: false,
  multiSelect: false,
} as const;

describe("resolvePendingUserInputAnswer", () => {
  it("prefers a custom answer over selected options", () => {
    expect(
      resolvePendingUserInputAnswer(singleSelectQuestion, {
        selectedOptionValues: ["Orchestration-first"],
        customAnswer: "Keep the existing envelope for one release",
      }),
    ).toBe("Keep the existing envelope for one release");
  });

  it("falls back to the selected option for single-select questions", () => {
    expect(
      resolvePendingUserInputAnswer(singleSelectQuestion, {
        selectedOptionValues: ["Orchestration-first"],
      }),
    ).toBe("Orchestration-first");
  });

  it("returns all selected labels for multi-select questions", () => {
    expect(
      resolvePendingUserInputAnswer(multiSelectQuestion, {
        selectedOptionValues: ["Server", "Web"],
      }),
    ).toEqual(["Server", "Web"]);
  });

  it("clears the preset selection when a custom answer is entered", () => {
    expect(
      setPendingUserInputCustomAnswer(
        {
          selectedOptionValues: ["Server", "Web"],
        },
        "doesn't matter",
      ),
    ).toEqual({
      customAnswer: "doesn't matter",
    });
  });

  it("does not replace a required choice with a custom answer", () => {
    expect(
      resolvePendingUserInputAnswer(nativeChoiceQuestion, {
        selectedOptionValues: ["second"],
        customAnswer: "Use another result",
      }),
    ).toBe("second");
  });

  it("does not submit labels or unknown values when an option has a value", () => {
    expect(
      resolvePendingUserInputAnswer(nativeChoiceQuestion, {
        selectedOptionValues: ["Result", "unknown"],
      }),
    ).toBeNull();
  });
});

describe("togglePendingUserInputOptionSelection", () => {
  it("toggles options for multi-select questions", () => {
    expect(togglePendingUserInputOptionSelection(multiSelectQuestion, undefined, "Server")).toEqual(
      {
        customAnswer: "",
        selectedOptionValues: ["Server"],
      },
    );

    expect(
      togglePendingUserInputOptionSelection(
        multiSelectQuestion,
        {
          selectedOptionValues: ["Server", "Web"],
        },
        "Server",
      ),
    ).toEqual({
      customAnswer: "",
      selectedOptionValues: ["Web"],
    });
  });

  it("selects and removes options with the same label independently", () => {
    const question = { ...nativeChoiceQuestion, multiSelect: true };
    const firstSelected = togglePendingUserInputOptionSelection(question, undefined, " first\t");
    const bothSelected = togglePendingUserInputOptionSelection(question, firstSelected, "second");

    expect(buildPendingUserInputAnswers([question], { result: bothSelected })).toEqual({
      result: [" first\t", "second"],
    });

    const secondSelected = togglePendingUserInputOptionSelection(
      question,
      bothSelected,
      " first\t",
    );
    expect(buildPendingUserInputAnswers([question], { result: secondSelected })).toEqual({
      result: ["second"],
    });
  });
});

describe("buildPendingUserInputAnswers", () => {
  it("returns a canonical answer map for complete prompts", () => {
    expect(
      buildPendingUserInputAnswers(
        [
          singleSelectQuestion,
          {
            id: "compat",
            header: "Compat",
            question: "How strict should compatibility be?",
            options: [
              {
                label: "Keep current envelope",
                description: "Preserve current wire format",
              },
            ],
            multiSelect: false,
          },
        ],
        {
          scope: {
            selectedOptionValues: ["Orchestration-first"],
          },
          compat: {
            customAnswer: "Keep the current envelope for one release window",
          },
        },
      ),
    ).toEqual({
      scope: "Orchestration-first",
      compat: "Keep the current envelope for one release window",
    });
  });

  it("returns arrays for answered multi-select prompts", () => {
    expect(
      buildPendingUserInputAnswers([multiSelectQuestion], {
        areas: {
          selectedOptionValues: ["Server", "Web"],
        },
      }),
    ).toEqual({
      areas: ["Server", "Web"],
    });
  });

  it("returns null when any question is unanswered", () => {
    expect(buildPendingUserInputAnswers([singleSelectQuestion], {})).toBeNull();
  });

  it.each([" first\t", ""])("preserves the exact selected option value %j", (value) => {
    const question = {
      ...nativeChoiceQuestion,
      options: [{ ...nativeChoiceQuestion.options[0], value }, nativeChoiceQuestion.options[1]],
    };
    const draft = togglePendingUserInputOptionSelection(question, undefined, value);

    expect(buildPendingUserInputAnswers([question], { result: draft })).toEqual({ result: value });
    expect(derivePendingUserInputProgress([question], { result: draft }, 0)).toMatchObject({
      selectedOptionValues: [value],
      answeredQuestionCount: 1,
      canAdvance: true,
      isComplete: true,
    });
  });
});

describe("pending user input question progress", () => {
  const questions = [
    singleSelectQuestion,
    {
      id: "compat",
      header: "Compat",
      question: "How strict should compatibility be?",
      options: [
        {
          label: "Keep current envelope",
          description: "Preserve current wire format",
        },
      ],
      multiSelect: false,
    },
  ] as const;

  it("counts only answered questions", () => {
    expect(
      countAnsweredPendingUserInputQuestions(questions, {
        scope: {
          selectedOptionValues: ["Orchestration-first"],
        },
      }),
    ).toBe(1);
  });

  it("derives the active question and advancement state", () => {
    expect(
      derivePendingUserInputProgress(
        questions,
        {
          scope: {
            selectedOptionValues: ["Orchestration-first"],
          },
        },
        0,
      ),
    ).toMatchObject({
      questionIndex: 0,
      activeQuestion: questions[0],
      selectedOptionValues: ["Orchestration-first"],
      customAnswer: "",
      resolvedAnswer: "Orchestration-first",
      answeredQuestionCount: 1,
      isLastQuestion: false,
      isComplete: false,
      canAdvance: true,
    });
  });

  it("treats multi-select questions as answered when they have selected options", () => {
    expect(
      derivePendingUserInputProgress(
        [multiSelectQuestion],
        {
          areas: {
            selectedOptionValues: ["Server", "Web"],
          },
        },
        0,
      ),
    ).toMatchObject({
      selectedOptionValues: ["Server", "Web"],
      resolvedAnswer: ["Server", "Web"],
      canAdvance: true,
      isComplete: true,
    });
  });

  it("requires an option when custom answers are disabled", () => {
    const drafts = { result: { customAnswer: "Use another result" } };

    expect(buildPendingUserInputAnswers([nativeChoiceQuestion], drafts)).toBeNull();
    expect(derivePendingUserInputProgress([nativeChoiceQuestion], drafts, 0)).toMatchObject({
      customAnswer: "",
      usingCustomAnswer: false,
      resolvedAnswer: null,
      answeredQuestionCount: 0,
      canAdvance: false,
      isComplete: false,
    });
  });
});

it("accepts attachment-only answers after every upload finishes", () => {
  const questions = [
    { id: "spec", header: "Spec", question: "Provide a spec", options: [], multiSelect: false },
  ];
  expect(buildPendingUserInputAnswers(questions, { spec: { attachmentCount: 1 } })).toEqual({
    spec: "",
  });
  expect(
    buildPendingUserInputAnswers(questions, {
      spec: { attachmentCount: 1, attachmentsBlocked: true },
    }),
  ).toBeNull();
  expect(
    buildPendingUserInputAnswers([{ ...questions[0]!, allowCustomAnswer: false }], {
      spec: { attachmentCount: 1 },
    }),
  ).toBeNull();
});

describe("carryDisplacedCustomAnswerIntoPrompt", () => {
  it("keeps the thread draft when nothing was typed into the answer", () => {
    expect(carryDisplacedCustomAnswerIntoPrompt("draft", undefined)).toBe("draft");
    expect(carryDisplacedCustomAnswerIntoPrompt("draft", "   ")).toBe("draft");
  });

  it("moves the typed answer into an empty thread draft", () => {
    expect(carryDisplacedCustomAnswerIntoPrompt("", "also rename the flag ")).toBe(
      "also rename the flag",
    );
  });

  it("appends the typed answer after an existing thread draft", () => {
    expect(carryDisplacedCustomAnswerIntoPrompt("first half\n", "second half")).toBe(
      "first half\n\nsecond half",
    );
  });
});

describe("formatPendingUserInputAnswersAsMessage", () => {
  it("writes one line per question, joining multi-select answers", () => {
    expect(
      formatPendingUserInputAnswersAsMessage([singleSelectQuestion, multiSelectQuestion], {
        scope: "Orchestration-first",
        areas: ["Server", "Web"],
      }),
    ).toBe("Scope: Orchestration-first\nAreas: Server, Web");
  });
});

describe("describePendingUserInputOption", () => {
  it("drops the provider's recommended mark from the label and flags the option", () => {
    expect(
      describePendingUserInputOption({ label: "Keep both (Recommended)", description: "" }),
    ).toEqual({ label: "Keep both", recommended: true });
    expect(
      describePendingUserInputOption({ label: "Keep both (recommended) ", description: "" }),
    ).toEqual({ label: "Keep both", recommended: true });
  });

  it("leaves other labels alone", () => {
    expect(describePendingUserInputOption({ label: "Keep both", description: "" })).toEqual({
      label: "Keep both",
      recommended: false,
    });
    expect(
      describePendingUserInputOption({ label: "(Recommended) Keep both", description: "" }),
    ).toEqual({ label: "(Recommended) Keep both", recommended: false });
    // A label that is only the mark has nothing else to show.
    expect(describePendingUserInputOption({ label: "(Recommended)", description: "" })).toEqual({
      label: "(Recommended)",
      recommended: false,
    });
  });
});

describe("derivePendingUserInputCarryOn", () => {
  const askedAt = "2026-10-20T10:32:00.000Z";
  const recommendedQuestion = {
    id: "layout",
    header: "Layout",
    question: "Which layout should the page use?",
    options: [
      { label: "Two columns", description: "Side by side" },
      { label: "One column (Recommended)", description: "Stacked" },
      { label: "Grid (Recommended)", description: "Tiles" },
    ],
    multiSelect: false,
  };

  it("carries on with the recommended option ten minutes after the question was asked", () => {
    expect(
      derivePendingUserInputCarryOn({ questions: [recommendedQuestion], createdAt: askedAt }),
    ).toEqual({
      // The provider gets the label it sent, mark and all.
      answers: { layout: "One column (Recommended)" },
      labels: ["One column"],
      at: Date.parse(askedAt) + PENDING_USER_INPUT_CARRY_ON_DELAY_MS,
    });
    expect(PENDING_USER_INPUT_CARRY_ON_DELAY_MS).toBe(10 * 60 * 1000);
  });

  it("waits the full time from when the page first showed it, if that's later", () => {
    const shownAt = Date.parse(askedAt) + 60 * 60 * 1000;
    expect(
      derivePendingUserInputCarryOn(
        { questions: [recommendedQuestion], createdAt: askedAt },
        shownAt,
      )?.at,
    ).toBe(shownAt + PENDING_USER_INPUT_CARRY_ON_DELAY_MS);
    expect(
      derivePendingUserInputCarryOn(
        { questions: [recommendedQuestion], createdAt: askedAt },
        Date.parse(askedAt) - 1000,
      )?.at,
    ).toBe(Date.parse(askedAt) + PENDING_USER_INPUT_CARRY_ON_DELAY_MS);
  });

  it("answers with an option's value when it has one", () => {
    expect(
      derivePendingUserInputCarryOn({
        questions: [
          {
            ...recommendedQuestion,
            options: [{ value: "one", label: "One column (Recommended)", description: "" }],
          },
        ],
        createdAt: askedAt,
      })?.answers,
    ).toEqual({ layout: "one" });
  });

  it("carries on with every recommended option of a multi-select question", () => {
    expect(
      derivePendingUserInputCarryOn({
        questions: [{ ...recommendedQuestion, multiSelect: true }],
        createdAt: askedAt,
      }),
    ).toMatchObject({
      answers: { layout: ["One column (Recommended)", "Grid (Recommended)"] },
      labels: ["One column, Grid"],
    });
  });

  it("needs a recommended answer for every question", () => {
    expect(
      derivePendingUserInputCarryOn({
        questions: [recommendedQuestion, singleSelectQuestion],
        createdAt: askedAt,
      }),
    ).toBeNull();
    expect(
      derivePendingUserInputCarryOn({
        questions: [
          recommendedQuestion,
          {
            ...singleSelectQuestion,
            options: [{ label: "Orchestration-first (Recommended)", description: "" }],
          },
        ],
        createdAt: askedAt,
      }),
    ).toMatchObject({
      answers: { layout: "One column (Recommended)", scope: "Orchestration-first (Recommended)" },
      labels: ["One column", "Orchestration-first"],
    });
  });

  it("never invents a default", () => {
    expect(
      derivePendingUserInputCarryOn({ questions: [multiSelectQuestion], createdAt: askedAt }),
    ).toBeNull();
    expect(derivePendingUserInputCarryOn({ questions: [], createdAt: askedAt })).toBeNull();
    expect(
      derivePendingUserInputCarryOn({ questions: [recommendedQuestion], createdAt: "not a date" }),
    ).toBeNull();
  });
});

describe("formatPendingUserInputCarryOn", () => {
  it("names a single answer and the time it carries on at", () => {
    expect(formatPendingUserInputCarryOn({ labels: ["One column"] }, "10:42 AM")).toBe(
      "Carries on with “One column” at 10:42 AM if you don’t answer.",
    );
  });

  it("sums up answers to several questions", () => {
    expect(formatPendingUserInputCarryOn({ labels: ["One column", "Server"] }, "10:42 AM")).toBe(
      "Carries on with the recommended answers at 10:42 AM if you don’t answer.",
    );
  });
});
