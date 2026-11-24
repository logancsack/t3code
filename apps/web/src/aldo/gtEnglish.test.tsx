import * as Real from "gt-react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vite-plus/test";

import catalog from "../i18n/translations/en.json";
import * as English from "./gtEnglish";

const sources = Object.values(catalog).filter((entry) => typeof entry === "string");
const variablesOf = (source: string, value: unknown) =>
  Object.fromEntries(
    [...source.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g)].map((match) => [match[1]!, value]),
  );

it("formats every English catalog message as GT does", () => {
  const formatted = (gt: typeof Real | typeof English) =>
    sources.flatMap((source) => [
      // No variables: GT falls back to the source text when a value is missing.
      gt.gtFallback(source),
      ...[0, 1, 2, 1234.5, "codex", "it's {x}"].flatMap((value) => {
        const variables = variablesOf(source, value);
        return [
          gt.gtFallback(source, variables),
          gt.mFallback(source, variables),
          gt.mFallback(gt.msg(source, { ...variables, $context: "c" })),
        ];
      }),
    ]);
  expect(formatted(English)).toEqual(formatted(Real));
});

it("encodes and decodes msg() as GT does", () => {
  const encoded = (gt: typeof Real | typeof English) => {
    const message = gt.msg("{count, plural, one {# file} other {# files}} in {place}", {
      count: 1234,
      place: "a:b",
      $context: "c",
    });
    const { $_hash: _, ...options } = gt.decodeOptions(message) ?? {};
    return [
      gt.decodeMsg(message),
      options,
      gt.msg("Plain"),
      gt.msg(["a", "b"]),
      gt.decodeMsg("Time: {t}"),
      gt.decodeOptions("Time: {t}"),
      gt.decodeOptions("Plain"),
      gt.mFallback(null),
    ];
  };
  expect(encoded(English)).toEqual(encoded(Real));
  expect(English.mFallback(English.msg("It''s {n}", { n: 2, $context: "c" }))).toBe("It's 2");
});

// GT's hooks need its initialized browser runtime; in English they format as its fallbacks do.
const useReal = () => ({ t: Real.gtFallback, m: Real.mFallback, locale: "en" });
const useEnglish = () => ({
  t: English.useGT(),
  m: English.useMessages(),
  locale: English.useLocale(),
});

it("renders T, Var, Branch and the hooks as GT does in English", () => {
  const rendered = (gt: typeof Real | typeof English, useHooks: typeof useReal) => {
    function Hooks() {
      const { t, m, locale } = useHooks();
      return (
        <p lang={locale}>
          {t("{count, plural, =0 {None} one {# thread} other {# threads}}", {
            count: 2,
            $context: "c",
          })}
          {m(gt.msg("On {machine}", { machine: "m1", $context: "c" }))}
          {m(gt.msg("Plain"))}
        </p>
      );
    }
    return renderToStaticMarkup(
      <gt.GTProvider locale="en" translations={{ en: {} }}>
        <gt.T context="c">
          Open{" "}
          <b>
            the <gt.Var>{"x & y"}</gt.Var> thread
          </b>{" "}
          as a{" "}
          <gt.Branch branch="mr" mr="merge request" cr="change request">
            pull request
          </gt.Branch>
          <gt.Branch branch="pr" mr="MR">
            PR
          </gt.Branch>
        </gt.T>
        <Hooks />
      </gt.GTProvider>,
    );
  };
  expect(rendered(English, useEnglish)).toBe(rendered(Real, useReal));
});
