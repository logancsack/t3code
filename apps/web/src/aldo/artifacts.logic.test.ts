import { describe, expect, it } from "vite-plus/test";

import {
  arrange,
  artifactsField,
  artifactsOf,
  chartScale,
  chartTable,
  csvOf,
  downloadHref,
  fileShape,
  formatValue,
  inlineSrc,
  linkRows,
  niceMax,
  withoutShownLinks,
  type AldoArtifact,
  type AldoFileArtifact,
} from "./artifacts.logic";

const SHARE = "/s/abcdefghijklmnop1234";
const DEMO = "https://store-1.public.blob.vercel-storage.com/artifacts/thread_1/2048-x7.mp4";
const DEMO_FILE = "/demo/a_0123456789ab/file";
const file = (url: string, contentType = "image/png"): AldoFileArtifact => ({
  kind: "file",
  url,
  title: "Cat",
  contentType,
});

describe("artifactsOf", () => {
  it("keeps what Aldo sends: a share, a thread's recording, a chart and a table", () => {
    const chart = {
      kind: "chart",
      title: "Hours",
      type: "bar",
      labels: ["Mon", "Tue"],
      series: [{ name: "Machines", values: [1.5, 3, 9] }],
      unit: "h",
    };
    const table = { kind: "table", columns: ["Name", "Cost"], rows: [["Fix", "$4"], ["Docs"]] };
    expect(
      artifactsOf([file(SHARE), file(DEMO, "video/mp4"), file(DEMO_FILE), chart, table]),
    ).toEqual([
      file(SHARE),
      file(DEMO, "video/mp4"),
      file(DEMO_FILE),
      { ...chart, series: [{ name: "Machines", values: [1.5, 3] }] },
      {
        kind: "table",
        columns: ["Name", "Cost"],
        rows: [
          ["Fix", "$4"],
          ["Docs", ""],
        ],
      },
    ]);
  });

  it("leaves out what it can't show safely: another site's address, a script, a broken shape", () => {
    expect(
      artifactsOf([
        file("https://tracker.example/pixel.png"),
        file("javascript:alert(1)"),
        file("/s/short"),
        file(`${DEMO}?x=1`),
        file("/demo/a_0123456789ab/poster"),
        file("/demo/a_0123456789ab/file?x=1"),
        file("/demo/short/file"),
        { kind: "chart", type: "radar", labels: ["a"], series: [{ name: "", values: [1] }] },
        { kind: "chart", type: "pie", labels: ["a", "b"], series: [{ name: "", values: [1, -1] }] },
        { kind: "chart", type: "scatter", series: [{ name: "", points: [{ x: "1", y: 2 }] }] },
        { kind: "chart", type: "line", labels: ["a", "b"], series: [{ name: "", values: [1] }] },
        { kind: "table", columns: [], rows: [["a"]] },
        { kind: "html", html: "<script>" },
        null,
        "file",
      ]),
    ).toEqual([]);
    expect(artifactsOf("nope")).toEqual([]);
    expect(artifactsField(undefined)).toEqual({});
  });

  it("keeps the colors it is given as hex, on series, a pie's slices and scatter points, and drops the rest", () => {
    const [column, pie, scatter] = artifactsOf([
      {
        kind: "chart",
        type: "column",
        labels: ["a"],
        series: [
          { name: "Gain", values: [1], color: " #16A34A " },
          { name: "Loss", values: [1], color: "red" },
          { name: "Net", values: [1], color: "#abc" },
        ],
      },
      {
        kind: "chart",
        type: "pie",
        labels: ["a", "b", "c"],
        series: [
          { name: "S", values: [1, 2, 3], colors: ["#111111", "nope", "#222222", "#333333"] },
        ],
      },
      {
        kind: "chart",
        type: "scatter",
        series: [
          {
            name: "S",
            color: "#7c3aed",
            points: [
              { x: 1, y: 2, color: "#0ea5e9" },
              { x: 2, y: 3, color: "url(x)" },
            ],
          },
        ],
      },
    ]) as Extract<ReturnType<typeof artifactsOf>[number], { kind: "chart" }>[];
    expect(column!.series.map((s) => s.color)).toEqual(["#16a34a", undefined, "#abc"]);
    expect(pie!.series[0]!.colors).toEqual(["#111111", "", "#222222"]);
    expect(scatter!.series[0]!.color).toBe("#7c3aed");
    expect(scatter!.series[0]!.points).toEqual([
      { x: 1, y: 2, color: "#0ea5e9" },
      { x: 2, y: 3 },
    ]);
  });

  it("keeps every type of chart: stacked, a combo's lines, a pie's one series, a scatter chart's points", () => {
    const values = (n: number) => ({ name: `S${n}`, values: [n, n + 1] });
    expect(
      artifactsOf([
        {
          kind: "chart",
          type: "column",
          labels: ["Q1", "Q2"],
          series: [values(1), values(2)],
          stacked: true,
        },
        { kind: "chart", type: "line", labels: ["Q1", "Q2"], series: [values(1)], stacked: true },
        {
          kind: "chart",
          type: "combo",
          labels: ["Q1", "Q2"],
          series: [values(1), { ...values(2), mark: "line" }, { ...values(3), mark: "area" }],
        },
        { kind: "chart", type: "donut", labels: ["A", "B"], series: [values(1), values(2)] },
        {
          kind: "chart",
          type: "scatter",
          labels: ["ignored"],
          series: [
            {
              name: "Cos",
              points: [
                { x: 1, y: 2, label: "Acme" },
                { x: Infinity, y: 1 },
              ],
            },
          ],
          xAxis: "Growth",
          xUnit: "%",
          yAxis: "P/E",
        },
      ]),
    ).toEqual([
      {
        kind: "chart",
        title: "",
        type: "column",
        labels: ["Q1", "Q2"],
        series: [values(1), values(2)],
        stacked: true,
      },
      // A line doesn't stack, nor does one series.
      { kind: "chart", title: "", type: "line", labels: ["Q1", "Q2"], series: [values(1)] },
      {
        kind: "chart",
        title: "",
        type: "combo",
        labels: ["Q1", "Q2"],
        series: [values(1), { ...values(2), mark: "line" }, values(3)],
      },
      { kind: "chart", title: "", type: "donut", labels: ["A", "B"], series: [values(1)] },
      {
        kind: "chart",
        title: "",
        type: "scatter",
        labels: [],
        series: [{ name: "Cos", values: [], points: [{ x: 1, y: 2, label: "Acme" }] }],
        xAxis: "Growth",
        yAxis: "P/E",
        xUnit: "%",
      },
    ]);
  });

  it("shows six at most", () => {
    expect(artifactsOf(Array.from({ length: 9 }, () => file(SHARE)))).toHaveLength(6);
  });
});

it("loads a share from the page's origin, marked as shown in the chat; a recording from where it is", () => {
  expect(inlineSrc(file(SHARE))).toBe(`${SHARE}?in=chat`);
  expect(inlineSrc(file(DEMO))).toBe(DEMO);
});

it("saves a share as it is, Markdown as the file, and a Blob file as an attachment", () => {
  const origin = "https://aldo.example";
  expect(downloadHref(SHARE, origin, "image/png")).toBe(SHARE);
  expect(downloadHref(SHARE, origin, "text/markdown")).toBe(`${SHARE}?raw=1`);
  expect(downloadHref(DEMO, origin)).toBe(`${DEMO}?download=1`);
  expect(downloadHref("https://elsewhere.example/a.png", origin)).toBe(
    "https://elsewhere.example/a.png",
  );
});

it("shows a picture, a recording, a sound and a page in place, and anything else in a list", () => {
  expect(fileShape("image/svg+xml")).toBe("image");
  expect(fileShape("video/mp4")).toBe("video");
  expect(fileShape("audio/mpeg")).toBe("audio");
  expect(fileShape("text/html; charset=utf-8")).toBe("page");
  expect(fileShape("text/markdown")).toBe("page");
  expect(fileShape("application/pdf")).toBe("row");
  expect(fileShape("video/webm")).toBe("row");
});

it("drops the lines that only link to what's shown, and keeps every other word", () => {
  const text = [
    "Fixed the checkout and recorded it.",
    "",
    "Shared link: https://aldo.example/s/abcdefghijklmnop1234",
    `Recording: ${DEMO}`,
    "Pull request: https://github.com/acme/shop/pull/7",
    "Thread: https://aldo.example/aldo-1/t1",
  ].join("\n");
  expect(withoutShownLinks(text, [file(SHARE), file(DEMO, "video/mp4")])).toBe(
    [
      "Fixed the checkout and recorded it.",
      "",
      "Pull request: https://github.com/acme/shop/pull/7",
      "Thread: https://aldo.example/aldo-1/t1",
    ].join("\n"),
  );
  // Nothing shown, nothing dropped; a link inside a sentence stays.
  expect(withoutShownLinks(text, [])).toBe(text);
  const sentence = "See https://aldo.example/s/abcdefghijklmnop1234 for it";
  expect(withoutShownLinks(sentence, [file(SHARE)])).toBe(sentence);
});

it("drops a shown file's line when its label has a colon too", () => {
  const text = "Ready.\n\nChart: returns since April: https://aldo.example/s/abcdefghijklmnop1234";
  expect(withoutShownLinks(text, [file(SHARE)])).toBe("Ready.");
});

describe("linkRows", () => {
  it("lists the links a thread's result ends with, a pull request by its repository and number", () => {
    const text = [
      "Fixed the checkout. See https://acme.example/notes for why.",
      "",
      "Pull request: https://github.com/acme/shop/pull/7",
      "Fix the cart: https://github.com/acme/shop/pull/8",
      "Preview: https://shop-git-fix.vercel.app/",
      "vercel.com: https://vercel.com/acme/shop",
    ].join("\n");
    expect(linkRows(text)).toEqual({
      text: "Fixed the checkout. See https://acme.example/notes for why.",
      links: [
        {
          url: "https://github.com/acme/shop/pull/7",
          title: "acme/shop #7",
          type: "Pull request",
        },
        { url: "https://github.com/acme/shop/pull/8", title: "Fix the cart", type: "Pull request" },
        {
          url: "https://shop-git-fix.vercel.app/",
          title: "Preview",
          type: "shop-git-fix.vercel.app",
        },
        { url: "https://vercel.com/acme/shop", title: "vercel.com", type: "Link" },
      ],
    });
  });

  it("leaves words alone: a link in a sentence, and a link line with words after it", () => {
    const text = "Pull request: https://github.com/acme/shop/pull/7\nIt's waiting on review.";
    expect(linkRows(text)).toEqual({ text, links: [] });
    expect(linkRows("")).toEqual({ text: "", links: [] });
  });
});

describe("arrange", () => {
  const chart: AldoArtifact = {
    kind: "chart",
    title: "Hours",
    type: "bar",
    labels: ["Mon"],
    series: [{ name: "Hours", values: [1] }],
  };
  const table: AldoArtifact = { kind: "table", columns: ["A"], rows: [["1"]] };
  const page = { ...file("/s/pagepagepagepage5678", "text/html"), title: "Page" };
  const report = { ...file("/s/reportreportreport12", "text/markdown"), title: "Report" };
  const csv = { ...file("/s/csvcsvcsvcsvcsvcsv12", "text/csv"), title: "Closes" };
  const picture = file(SHARE);
  const other = { ...file("/s/otherotherotherother1"), title: "Dog" };
  const video = file(DEMO, "video/mp4");
  const sound = file("/s/soundsoundsound9999", "audio/mpeg");

  it("leads with what Aldo draws, a recording, a table, the pictures, a page, then a sound", () => {
    expect(arrange([page, picture, chart, table, { ...chart, title: "Cost" }]).lead).toEqual([
      chart,
      { ...chart, title: "Cost" },
    ]);
    expect(arrange([picture, table, video, { ...video, url: `${DEMO}2` }]).lead).toEqual([video]);
    // An agent's picture of a chart may not read on a phone: the table leads, the picture is listed.
    expect(arrange([page, picture, report, csv, table])).toEqual({
      lead: [table],
      rest: [page, picture, report, csv],
    });
    expect(arrange([page, picture, other]).lead).toEqual([picture, other]);
    expect(arrange([csv, report, page, sound]).lead).toEqual([report]);
    expect(arrange([csv, sound]).lead).toEqual([sound]);
    expect(arrange([csv])).toEqual({ lead: [], rest: [csv] });
  });

  it("lists a file once: its link twice, or a copy of the same title, type and size", () => {
    const sized = { ...csv, bytes: 930 };
    const copy = { ...sized, url: "/s/copycopycopycopycopy" };
    const another = { ...sized, url: "/s/anotheranotheranoth", title: "Indexed closes" };
    expect(arrange([sized, copy, { ...sized }, another]).rest).toEqual([sized, another]);
  });
});

it("writes figures as Aldo does, on a scale that ends on a round number", () => {
  expect(formatValue(12, "$")).toBe("$12");
  expect(formatValue(-3.5, "$")).toBe("-$3.5");
  expect(formatValue(8, "%")).toBe("8%");
  expect(formatValue(40, "mm")).toBe("40 mm");
  expect(formatValue(1234.567)).toBe("1,234.57");
  expect(niceMax([3, 7.2])).toBe(10);
  expect(niceMax([0.18])).toBe(0.2);
  expect(niceMax([230])).toBe(250);
  expect(niceMax([])).toBe(1);
  // Below zero, the scale reaches past it: a loss isn't drawn as nothing.
  expect(chartScale([3, 7.2])).toEqual({ top: 10, bottom: 0 });
  expect(chartScale([-10, 40])).toEqual({ top: 50, bottom: -10 });
  expect(chartScale([-10, -100, 0])).toEqual({ top: 0, bottom: -100 });
  expect(chartScale([0])).toEqual({ top: 1, bottom: 0 });
});

it("writes a scale's ticks short", () => {
  expect(formatValue(1500, "$", true)).toBe("$1.5K");
  expect(formatValue(2_000_000, undefined, true)).toBe("2M");
});

it("gives a pie's shares and a scatter chart's points as a table", () => {
  const pie = {
    kind: "chart" as const,
    title: "Holders",
    type: "pie" as const,
    labels: ["Berkshire", "Others"],
    series: [{ name: "Stake", values: [45, 55] }],
    unit: "%",
  };
  expect(chartTable(pie)).toEqual({
    title: "Holders",
    columns: ["", "Stake", "Share"],
    rows: [
      ["Berkshire", "45%", "45%"],
      ["Others", "55%", "55%"],
    ],
  });
  expect(chartTable(pie, true).columns).toEqual(["", "Stake (%)", "Share (%)"]);
  expect(
    chartTable({
      kind: "chart",
      title: "Value",
      type: "scatter",
      labels: [],
      series: [
        {
          name: "Cos",
          values: [],
          points: [
            { x: 12, y: 30, label: "Acme" },
            { x: 4, y: 9 },
          ],
        },
      ],
      xAxis: "Growth",
      xUnit: "%",
    }),
  ).toEqual({
    title: "Value",
    columns: ["", "Growth", "y"],
    rows: [
      ["Acme", "12%", "30"],
      ["", "4%", "9"],
    ],
  });
});

it("gives a chart's data as a table, and a table as CSV a spreadsheet won't run", () => {
  expect(
    chartTable({
      kind: "chart",
      title: "Spend",
      type: "line",
      labels: ["Mon", "Tue"],
      series: [{ name: "", values: [4, 6] }],
      unit: "$",
    }),
  ).toEqual({
    title: "Spend",
    columns: ["", "Value"],
    rows: [
      ["Mon", "$4"],
      ["Tue", "$6"],
    ],
  });
  // Saved, each figure as it was sent, however small.
  expect(
    chartTable(
      {
        kind: "chart",
        title: "Error rate",
        type: "bar",
        labels: ["Mon", "Tue"],
        series: [{ name: "Rate", values: [0.001, -0.0049] }],
        unit: "%",
      },
      true,
    ),
  ).toEqual({
    title: "Error rate",
    columns: ["", "Rate (%)"],
    rows: [
      ["Mon", "0.001"],
      ["Tue", "-0.0049"],
    ],
  });
  expect(
    csvOf(
      ["Name", "Note"],
      [
        ["=HYPERLINK(1)", 'say "hi", then'],
        ["-12.5", "+1 more"],
      ],
    ),
  ).toBe('Name,Note\r\n\'=HYPERLINK(1),"say ""hi"", then"\r\n-12.5,\'+1 more\r\n');
});
