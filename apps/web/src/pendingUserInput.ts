import type { UserInputQuestion, UserInputQuestionOption } from "@t3tools/contracts";

export interface PendingUserInputDraftAnswer {
  selectedOptionValues?: string[];
  customAnswer?: string;
  attachmentCount?: number;
  attachmentsBlocked?: boolean;
}

export interface PendingUserInputProgress {
  questionIndex: number;
  activeQuestion: UserInputQuestion | null;
  activeDraft: PendingUserInputDraftAnswer | undefined;
  selectedOptionValues: string[];
  customAnswer: string;
  resolvedAnswer: string | string[] | null;
  usingCustomAnswer: boolean;
  answeredQuestionCount: number;
  isLastQuestion: boolean;
  isComplete: boolean;
  canAdvance: boolean;
}

function normalizeDraftAnswer(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeSelectedOptionValues(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  // Provider option IDs must stay unchanged, including whitespace.
  return Array.from(new Set(value.filter((entry) => typeof entry === "string")));
}

export function resolvePendingUserInputAnswer(
  question: UserInputQuestion,
  draft: PendingUserInputDraftAnswer | undefined,
): string | string[] | null {
  if (draft?.attachmentsBlocked) return null;
  const customAnswer =
    question.allowCustomAnswer === false ? null : normalizeDraftAnswer(draft?.customAnswer);
  if (customAnswer) {
    return customAnswer;
  }

  const selectedOptionValues = normalizeSelectedOptionValues(draft?.selectedOptionValues).filter(
    (value) => question.options.some((option) => (option.value ?? option.label) === value),
  );
  if (question.multiSelect) {
    return selectedOptionValues.length > 0
      ? selectedOptionValues
      : question.allowCustomAnswer !== false && (draft?.attachmentCount ?? 0) > 0
        ? ""
        : null;
  }

  return (
    selectedOptionValues[0] ??
    (question.allowCustomAnswer !== false && (draft?.attachmentCount ?? 0) > 0 ? "" : null)
  );
}

export function setPendingUserInputCustomAnswer(
  draft: PendingUserInputDraftAnswer | undefined,
  customAnswer: string,
): PendingUserInputDraftAnswer {
  const selectedOptionValues =
    customAnswer.trim().length > 0
      ? undefined
      : normalizeSelectedOptionValues(draft?.selectedOptionValues);

  return {
    customAnswer,
    ...(selectedOptionValues && selectedOptionValues.length > 0 ? { selectedOptionValues } : {}),
  };
}

export function togglePendingUserInputOptionSelection(
  question: UserInputQuestion,
  draft: PendingUserInputDraftAnswer | undefined,
  optionValue: string,
): PendingUserInputDraftAnswer {
  if (question.multiSelect) {
    const selectedOptionValues = normalizeSelectedOptionValues(draft?.selectedOptionValues);
    const nextSelectedOptionValues = selectedOptionValues.includes(optionValue)
      ? selectedOptionValues.filter((value) => value !== optionValue)
      : [...selectedOptionValues, optionValue];

    return {
      customAnswer: "",
      ...(nextSelectedOptionValues.length > 0
        ? { selectedOptionValues: nextSelectedOptionValues }
        : {}),
    };
  }

  return {
    customAnswer: "",
    selectedOptionValues: [optionValue],
  };
}

export function buildPendingUserInputAnswers(
  questions: ReadonlyArray<UserInputQuestion>,
  draftAnswers: Record<string, PendingUserInputDraftAnswer>,
): Record<string, string | string[]> | null {
  const answers: Record<string, string | string[]> = {};

  for (const question of questions) {
    const answer = resolvePendingUserInputAnswer(question, draftAnswers[question.id]);
    if (answer === null) {
      return null;
    }
    answers[question.id] = answer;
  }

  return answers;
}

/** Answers written as a message, one "Header: answer" line per question. */
export function formatPendingUserInputAnswersAsMessage(
  questions: ReadonlyArray<UserInputQuestion>,
  answers: Record<string, string | string[]>,
): string {
  return questions
    .map((question) => {
      const answer = answers[question.id] ?? "";
      return `${question.header}: ${Array.isArray(answer) ? answer.join(", ") : answer}`;
    })
    .join("\n");
}

export function countAnsweredPendingUserInputQuestions(
  questions: ReadonlyArray<UserInputQuestion>,
  draftAnswers: Record<string, PendingUserInputDraftAnswer>,
): number {
  return questions.reduce((count, question) => {
    return resolvePendingUserInputAnswer(question, draftAnswers[question.id]) !== null
      ? count + 1
      : count;
  }, 0);
}

export function derivePendingUserInputProgress(
  questions: ReadonlyArray<UserInputQuestion>,
  draftAnswers: Record<string, PendingUserInputDraftAnswer>,
  questionIndex: number,
): PendingUserInputProgress {
  const normalizedQuestionIndex =
    questions.length === 0 ? 0 : Math.max(0, Math.min(questionIndex, questions.length - 1));
  const activeQuestion = questions[normalizedQuestionIndex] ?? null;
  const activeDraft = activeQuestion ? draftAnswers[activeQuestion.id] : undefined;
  const resolvedAnswer = activeQuestion
    ? resolvePendingUserInputAnswer(activeQuestion, activeDraft)
    : null;
  const customAnswer =
    activeQuestion?.allowCustomAnswer === false ? "" : (activeDraft?.customAnswer ?? "");
  const answeredQuestionCount = countAnsweredPendingUserInputQuestions(questions, draftAnswers);
  const isLastQuestion =
    questions.length === 0 ? true : normalizedQuestionIndex >= questions.length - 1;

  return {
    questionIndex: normalizedQuestionIndex,
    activeQuestion,
    activeDraft,
    selectedOptionValues: normalizeSelectedOptionValues(activeDraft?.selectedOptionValues),
    customAnswer,
    resolvedAnswer,
    usingCustomAnswer: customAnswer.trim().length > 0,
    answeredQuestionCount,
    isLastQuestion,
    isComplete: buildPendingUserInputAnswers(questions, draftAnswers) !== null,
    canAdvance: resolvedAnswer !== null,
  };
}

// Codex, Claude and OpenCode tell their models to mark the option they
// recommend by ending its label with "(Recommended)".
const RECOMMENDED_LABEL_SUFFIX = /\s*\(recommended\)\s*$/i;

/** An option's label as shown, without the provider's "(Recommended)" mark. */
export function describePendingUserInputOption(option: UserInputQuestionOption): {
  label: string;
  recommended: boolean;
} {
  const label = option.label.replace(RECOMMENDED_LABEL_SUFFIX, "");
  return label.length > 0 && label !== option.label
    ? { label, recommended: true }
    : { label: option.label, recommended: false };
}

/** How long a question the provider gave a recommended answer waits for one. */
export const PENDING_USER_INPUT_CARRY_ON_DELAY_MS = 10 * 60 * 1000;

export interface PendingUserInputCarryOn {
  /** The recommended answer to each question, as the provider expects it. */
  answers: Record<string, string | string[]>;
  /** Each answer as the card names it. */
  labels: string[];
  /** When it carries on with them, in epoch milliseconds. */
  at: number;
}

/**
 * The answers a question carries on with when nobody answers it: the options
 * its provider recommends. Null unless every question has one, so a question
 * without a default always waits for the user. It waits the full delay from
 * when it was asked, or from `shownAt` (when this page first showed it) if
 * that's later, so someone who opens the thread late has time to read it.
 */
export function derivePendingUserInputCarryOn(
  input: {
    questions: ReadonlyArray<UserInputQuestion>;
    createdAt: string;
  },
  shownAt?: number,
): PendingUserInputCarryOn | null {
  const askedAt = Date.parse(input.createdAt);
  if (!Number.isFinite(askedAt) || input.questions.length === 0) return null;
  const answers: Record<string, string | string[]> = {};
  const labels: string[] = [];
  for (const question of input.questions) {
    const recommended = question.options.filter(
      (option) => describePendingUserInputOption(option).recommended,
    );
    const picked = question.multiSelect ? recommended : recommended.slice(0, 1);
    const values = picked.map((option) => option.value ?? option.label);
    const [first] = values;
    if (first === undefined) return null;
    answers[question.id] = question.multiSelect ? values : first;
    labels.push(picked.map((option) => describePendingUserInputOption(option).label).join(", "));
  }
  const from = shownAt !== undefined && shownAt > askedAt ? shownAt : askedAt;
  return { answers, labels, at: from + PENDING_USER_INPUT_CARRY_ON_DELAY_MS };
}

/** What the card says about carrying on, given the time it carries on at. */
export function formatPendingUserInputCarryOn(
  carryOn: Pick<PendingUserInputCarryOn, "labels">,
  time: string,
): string {
  const answer = carryOn.labels.length === 1 ? `“${carryOn.labels[0]}”` : "the recommended answers";
  return `Carries on with ${answer} at ${time} if you don’t answer.`;
}
