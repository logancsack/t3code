import type {
  PreviewAnnotationContextRecord,
  PreviewAnnotationPayload,
  ReviewCommentContextRecord,
  ThreadContextRecord,
  UserInputQuestion,
} from "@t3tools/contracts";
import {
  projectComposerContextForProvider,
  replaceComposerContextReferences,
} from "@t3tools/shared/composerContextReferences";
import { formatThreadLink } from "@t3tools/shared/threadLinks";
import {
  buildPendingUserInputAnswers,
  normalizeSelectedOptionValues,
  resolvePendingUserInputAnswer,
  type PendingUserInputAnswer,
  type PendingUserInputDraftAnswer,
} from "@t3tools/client-runtime/state/pending-user-input";

import { collectInlineContextIds } from "./lib/composerContextReferences";
import {
  previewAnnotationContextRecord,
  reviewCommentContextRecord,
} from "./lib/composerContextRecords";
import type { ReviewCommentContext } from "./reviewCommentContext";

type AnswerContextRecord =
  | ThreadContextRecord
  | ReviewCommentContextRecord
  | PreviewAnnotationContextRecord;

// Diff comments and preview annotations land in the thread draft even when their chip is in an answer.
export function answerContextRecords(
  questionDraft: { threadContexts: ReadonlyArray<ThreadContextRecord> } | null | undefined,
  threadDraft:
    | {
        reviewComments: ReadonlyArray<ReviewCommentContext>;
        previewAnnotations: ReadonlyArray<PreviewAnnotationPayload>;
      }
    | null
    | undefined,
): AnswerContextRecord[] {
  return [
    ...(questionDraft?.threadContexts ?? []),
    ...(threadDraft?.reviewComments ?? []).map(reviewCommentContextRecord),
    ...(threadDraft?.previewAnnotations ?? []).map((annotation) =>
      previewAnnotationContextRecord(annotation),
    ),
  ];
}

export function projectPendingUserInputAnswer(
  answer: unknown,
  records: ReadonlyArray<AnswerContextRecord>,
) {
  if (typeof answer !== "string" || records.length === 0) return answer;
  const recordsById = new Map(records.map((record) => [record.contextId, record]));
  return replaceComposerContextReferences(answer, (reference) => {
    const record = recordsById.get(reference.contextId);
    if (record?.kind !== reference.kind) return reference.source;
    return record.kind === "thread"
      ? formatThreadLink(record, reference.label)
      : projectComposerContextForProvider({ text: reference.source, records: [record] });
  });
}

// Question drafts retain deleted chip records for undo; only transfer referenced records.
export function threadContextsReferencedByAnswer(
  answer: string,
  threadContexts: ReadonlyArray<ThreadContextRecord>,
) {
  const referencedIds = new Set(collectInlineContextIds(answer));
  return threadContexts.filter((record) => referencedIds.has(record.contextId));
}

export interface PendingUserInputProgress<Q extends UserInputQuestion = UserInputQuestion> {
  questionIndex: number;
  activeQuestion: Q | null;
  activeDraft: PendingUserInputDraftAnswer | undefined;
  selectedOptionValues: ReadonlyArray<string>;
  customAnswer: string;
  resolvedAnswer: PendingUserInputAnswer | null;
  usingCustomAnswer: boolean;
  answeredQuestionCount: number;
  isLastQuestion: boolean;
  isComplete: boolean;
  canAdvance: boolean;
}

const DISPLACED_ANSWER_SEPARATOR = "\n\n";

export function carryDisplacedCustomAnswerIntoPrompt(
  prompt: string,
  customAnswer: string | undefined,
): string {
  const displaced = customAnswer?.trim() ?? "";
  if (displaced.length === 0) {
    return prompt;
  }
  if (prompt.trim().length === 0) {
    return displaced;
  }
  return `${prompt.trimEnd()}${DISPLACED_ANSWER_SEPARATOR}${displaced}`;
}

/**
 * Takes set-aside answer text back out of the thread draft once it is the answer again.
 * `laterDisplaced` is what was set aside after it, in order: together they locate this copy,
 * so equal text inside another answer or the user's own draft is never the one removed.
 */
export function withdrawDisplacedCustomAnswerFromPrompt(
  prompt: string,
  displaced: string,
  laterDisplaced: ReadonlyArray<string> = [],
): string {
  const text = displaced.trim();
  if (text.length === 0) return prompt;
  const later = laterDisplaced.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  const suffix = [text, ...later].join(DISPLACED_ANSWER_SEPARATOR);
  if (!prompt.endsWith(suffix)) return prompt;
  const before = prompt.slice(0, prompt.length - suffix.length);
  const after = later.join(DISPLACED_ANSWER_SEPARATOR);
  if (before.length === 0) return after;
  if (!before.endsWith(DISPLACED_ANSWER_SEPARATOR)) return prompt;
  return after.length === 0 ? before.slice(0, -DISPLACED_ANSWER_SEPARATOR.length) : before + after;
}

function countAnsweredPendingUserInputQuestions(
  questions: ReadonlyArray<UserInputQuestion>,
  draftAnswers: Record<string, PendingUserInputDraftAnswer>,
): number {
  return questions.reduce((count, question) => {
    return resolvePendingUserInputAnswer(question, draftAnswers[question.id]) !== null
      ? count + 1
      : count;
  }, 0);
}

export function derivePendingUserInputProgress<Q extends UserInputQuestion>(
  questions: ReadonlyArray<Q>,
  draftAnswers: Record<string, PendingUserInputDraftAnswer>,
  questionIndex: number,
): PendingUserInputProgress<Q> {
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
    selectedOptionValues: activeQuestion
      ? normalizeSelectedOptionValues(activeQuestion, activeDraft?.selectedOptionValues)
      : [],
    customAnswer,
    resolvedAnswer,
    usingCustomAnswer:
      (activeQuestion?.initialAnswer !== undefined ? customAnswer : customAnswer.trim()).length > 0,
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
export function describePendingUserInputOption(
  option: Pick<UserInputQuestion["options"][number], "label">,
): {
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
 * The recommended answers an unanswered question carries on with; null unless
 * every question has one. The delay runs from when it was asked, or from
 * `shownAt` if later, so someone who opens the thread late has time to read it.
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
