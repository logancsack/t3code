/**
 * English-only stand-in for `gt-react` and `gt-i18n`. Aldo's cloud build ships English, the
 * source language, so GT's catalog cache, locale machinery and ICU parser stay out of it
 * (vite/aldoDeferred.ts). Every export upstream imports from those packages must exist here:
 * a missing one fails the cloud build. gtEnglish.test.tsx holds the output to GT's own.
 */
import type * as GT from "gt-react";
import type { ReactNode } from "react";

type Values = Record<string, unknown>;
type Part =
  | string
  | { readonly hash: true }
  | {
      readonly name: string;
      readonly type: string | undefined;
      readonly offset: number;
      readonly options: Record<string, ReadonlyArray<Part>> | undefined;
    };

// Options that describe the message; everything else in an options object is a variable.
const META = new Set([
  "$id",
  "$context",
  "$maxChars",
  "$hash",
  "$_hash",
  "$_source",
  "$_fallback",
  "$format",
  "$locale",
  "$requiresReview",
]);
const BRANCHING = new Set(["plural", "select", "selectordinal"]);
const cardinal = new Intl.PluralRules("en");
const ordinal = new Intl.PluralRules("en", { type: "ordinal" });
const number = new Intl.NumberFormat("en");
const parsed = new Map<string, ReadonlyArray<Part>>();

function parse(source: string): ReadonlyArray<Part> {
  let at = 0;
  const fail = (): never => {
    throw new SyntaxError(`Malformed message: ${source}`);
  };
  const space = () => {
    while (/\s/.test(source[at] ?? "")) at += 1;
  };
  const word = () => {
    const start = at;
    while (at < source.length && !/[\s,{}]/.test(source[at]!)) at += 1;
    return at === start ? fail() : source.slice(start, at);
  };

  const message = (nested: boolean, inPlural: boolean): ReadonlyArray<Part> => {
    const parts: Part[] = [];
    let text = "";
    const flush = () => {
      if (text) parts.push(text);
      text = "";
    };
    while (at < source.length) {
      const char = source[at]!;
      if (char === "}") {
        if (!nested) fail();
        break;
      }
      if (char === "'") {
        const next = source[at + 1];
        if (next === "'") {
          text += "'";
          at += 2;
        } else if (next === "{" || next === "}" || (inPlural && next === "#")) {
          at += 1;
          while (at < source.length) {
            if (source[at] !== "'") text += source[at++];
            else if (source[at + 1] === "'") {
              text += "'";
              at += 2;
            } else {
              at += 1;
              break;
            }
          }
        } else {
          text += "'";
          at += 1;
        }
      } else if (char === "{") {
        flush();
        at += 1;
        parts.push(argument());
      } else if (char === "#" && inPlural) {
        flush();
        parts.push({ hash: true });
        at += 1;
      } else {
        text += char;
        at += 1;
      }
    }
    flush();
    return parts;
  };

  const argument = (): Part => {
    space();
    const name = word();
    space();
    if (source[at] === "}") {
      at += 1;
      return { name, type: undefined, offset: 0, options: undefined };
    }
    if (source[at] !== ",") fail();
    at += 1;
    space();
    const type = word();
    space();
    if (!BRANCHING.has(type)) {
      // A formatted number takes no style here; anything else is not English-only passthrough.
      if (type !== "number" || source[at] !== "}") fail();
      at += 1;
      return { name, type, offset: 0, options: undefined };
    }
    if (source[at] !== ",") fail();
    at += 1;
    const options: Record<string, ReadonlyArray<Part>> = {};
    let offset = 0;
    for (;;) {
      space();
      if (source[at] === "}") break;
      const selector = word();
      if (selector.startsWith("offset:") && type !== "select") {
        offset = Number(selector.slice(7));
        continue;
      }
      space();
      if (source[at] !== "{") fail();
      at += 1;
      options[selector] = message(true, type !== "select");
      if (source[at] !== "}") fail();
      at += 1;
    }
    at += 1;
    if (!options.other) fail();
    return { name, type, offset, options };
  };

  return message(false, false);
}

function render(parts: ReadonlyArray<Part>, values: Values, pound: string): string {
  let out = "";
  for (const part of parts) {
    if (typeof part === "string") out += part;
    else if ("hash" in part) out += pound;
    else {
      if (!(part.name in values)) throw new Error(`No value for ${part.name}`);
      const value = values[part.name];
      if (part.options === undefined) {
        out += part.type === "number" ? number.format(Number(value)) : String(value);
      } else if (part.type === "select") {
        out += render(part.options[String(value)] ?? part.options.other!, values, pound);
      } else {
        const count = Number(value) - part.offset;
        const rules = part.type === "plural" ? cardinal : ordinal;
        const branch =
          part.options[`=${String(value)}`] ??
          part.options[rules.select(count)] ??
          part.options.other!;
        out += render(branch, values, number.format(count));
      }
    }
  }
  return out;
}

/** Formats an ICU message with English rules. Throws on a malformed message or a missing value. */
function format(source: string, values: Values): string {
  let parts = parsed.get(source);
  if (!parts) {
    parts = parse(source);
    parsed.set(source, parts);
  }
  return render(parts, values, "");
}

function variablesOf(options: Values): Values {
  return Object.fromEntries(Object.entries(options).filter(([key]) => !META.has(key)));
}

function interpolate(message: string, options: Values): string {
  if (typeof message !== "string") return message;
  try {
    return format(message, variablesOf(options));
  } catch {
    return message;
  }
}

function toBase64(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(encoded: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)));
}

function encodeMessage(message: string, options: Values): string {
  if (options.$format === "STRING") {
    return `${message}:${toBase64(JSON.stringify({ ...options, $_hash: "", $_source: message }))}`;
  }
  let text: string;
  try {
    text = format(message, variablesOf(options));
  } catch {
    return message;
  }
  return `${text}:${toBase64(JSON.stringify({ ...options, $_source: message, $_hash: "" }))}`;
}

// The catalog hash GT stores in `$_hash` is left empty: nothing looks a message up in English.
export const msg = ((message: string | ReadonlyArray<string>, options?: Values) => {
  if (!options) return message;
  if (typeof message === "string") return encodeMessage(message, options);
  return message.map((entry, index) =>
    encodeMessage(entry, {
      ...options,
      ...(typeof options.$id === "string" ? { $id: `${options.$id}.${index}` } : {}),
    }),
  );
}) as typeof GT.msg;

export const decodeMsg = ((encoded: unknown) =>
  typeof encoded === "string" && encoded.lastIndexOf(":") !== -1
    ? encoded.slice(0, encoded.lastIndexOf(":"))
    : encoded) as typeof GT.decodeMsg;

export const decodeOptions = ((encoded: string) => {
  const colon = encoded.lastIndexOf(":");
  if (colon === -1) return null;
  try {
    return JSON.parse(fromBase64(encoded.slice(colon + 1)));
  } catch {
    return null;
  }
}) as typeof GT.decodeOptions;

export const gtFallback = ((message: string | null | undefined, options: Values = {}) =>
  message ? interpolate(message, options) : message) as typeof GT.gtFallback;

export const mFallback = ((encoded: string | null | undefined, options: Values = {}) => {
  if (!encoded) return encoded;
  const decoded: Values | null = decodeOptions(encoded);
  return typeof decoded?.$_hash === "string" && typeof decoded.$_source === "string"
    ? decodeMsg(encoded)
    : interpolate(encoded, options);
}) as typeof GT.mFallback;

export const useGT = (() => gtFallback) as typeof GT.useGT;
export const useMessages = (() => mFallback) as typeof GT.useMessages;
export const useLocale = (() => "en") as typeof GT.useLocale;

const children = ({ children }: { readonly children?: ReactNode }) => children;
export const T = children as typeof GT.T;
export const Var = children as typeof GT.Var;
export const GTProvider = children as unknown as typeof GT.GTProvider;

export const Branch = (({
  children,
  branch,
  ...branches
}: {
  readonly children?: ReactNode;
  readonly branch?: unknown;
  readonly [name: string]: unknown;
}) => {
  const name = branch?.toString();
  const chosen = name !== undefined && !name.startsWith("data-") ? branches[name] : undefined;
  return chosen === undefined ? children : chosen;
}) as typeof GT.Branch;

export const initializeGTSPA = (() => Promise.resolve()) as unknown as typeof GT.initializeGTSPA;
export const getTranslationsSnapshot = ((locale: string) =>
  Promise.resolve({ [locale]: {} })) as unknown as typeof GT.getTranslationsSnapshot;
export const getReactI18nCache = (() => ({
  lookupTranslation: () => undefined,
})) as unknown as typeof GT.getReactI18nCache;
