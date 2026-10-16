import {
  getSharedHighlighter,
  VirtualizedFile,
  Virtualizer,
  type FileContents,
} from "@pierre/diffs";
import { Editor, TextDocument } from "@pierre/diffs/editor";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const renderingManagerUrl = new URL(
  "./managers/UniversalRenderingManager.js",
  import.meta.resolve("@pierre/diffs"),
);
const { clearRenderQueue } = (await import(/* @vite-ignore */ renderingManagerUrl.href)) as {
  clearRenderQueue(): void;
};

// Layout measurements are controlled here. The real reconciler, document and
// renderer calculate positions. This does not simulate native CSS wrapping.
class MeasuredElement {
  static geometryReads = 0;
  children: MeasuredElement[] = [];
  dataset: Record<string, string> = {};
  nextElementSibling: MeasuredElement | null = null;
  width = 283;

  constructor(readonly height = 0) {}

  getBoundingClientRect() {
    MeasuredElement.geometryReads += 1;
    return { top: 0, height: this.height, width: this.width };
  }
}

class MeasuredCodeElement extends MeasuredElement {
  readonly tagName = "CODE";

  get firstElementChild() {
    return this.children[0] ?? null;
  }
}

const observers: RecordedResizeObserver[] = [];
const animationFrames = new Map<number, FrameRequestCallback>();
let nextFrameId = 0;

class RecordedResizeObserver {
  readonly targets = new Set<Element>();

  constructor(readonly callback: ResizeObserverCallback) {
    observers.push(this);
  }

  observe(target: Element) {
    this.targets.add(target);
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  disconnect() {
    this.targets.clear();
  }

  deliver(target: HTMLElement) {
    const rect = target.getBoundingClientRect();
    const size = { inlineSize: rect.width, blockSize: rect.height };
    this.callback(
      [
        {
          target,
          contentRect: rect,
          contentBoxSize: [size],
          borderBoxSize: [size],
          devicePixelContentBoxSize: [size],
        },
      ],
      this as unknown as ResizeObserver,
    );
  }
}

function drainRenderFrames() {
  const errors = vi.spyOn(console, "error");
  try {
    for (let frame = 0; animationFrames.size > 0; frame += 1) {
      if (frame === 10) throw new Error("The production render queue did not settle");
      const callbacks = [...animationFrames.values()];
      animationFrames.clear();
      for (const callback of callbacks) callback(frame);
    }
    expect(errors).not.toHaveBeenCalled();
  } finally {
    errors.mockRestore();
  }
}

function measuredElement(element: MeasuredElement): HTMLElement {
  return element as unknown as HTMLElement;
}

class LayoutVirtualizer extends Virtualizer {
  override getOffsetInScrollContainer(_element: HTMLElement) {
    return 0;
  }
}

class MeasuredFile extends VirtualizedFile {
  override top = 0;

  override attachEditor(editor: Parameters<VirtualizedFile["attachEditor"]>[0]) {
    this.editor = editor;
    return () => {
      this.editor = undefined;
    };
  }

  async initialize(file: FileContents) {
    this.prepareCodeViewItem(file, 0);
    await this.fileRenderer.initializeHighlighter();
    expect(
      this.fileRenderer.renderFile(file, {
        startingLine: 5950,
        totalLines: 51,
        bufferBefore: 0,
        bufferAfter: 0,
      }),
    ).toBeDefined();
    this.fileContainer = measuredElement(new MeasuredElement());
  }

  measure(
    rows: ReadonlyArray<readonly [lineIndex: number, height: number]>,
    contentWidth = 226.25,
  ) {
    const content = new MeasuredElement();
    content.width = contentWidth;
    content.children = rows.map(([lineIndex, height]) => {
      const row = new MeasuredElement(height);
      row.dataset.lineIndex = String(lineIndex);
      return row;
    });
    const code = new MeasuredCodeElement();
    code.width = contentWidth + 56.75;
    code.children = [new MeasuredElement(), content];
    this.code = measuredElement(code);
    this.reconcileHeights();
  }

  resizeContent(contentWidth: number, codeWidth = contentWidth + 56.75) {
    const code = this.code;
    const content = code?.children[1];
    if (!(code instanceof MeasuredElement) || !(content instanceof MeasuredElement)) {
      throw new Error("Expected measured code and content");
    }
    code.width = codeWidth;
    content.width = contentWidth;
  }

  observeLayout() {
    const pre = new MeasuredElement();
    if (!(this.code instanceof MeasuredElement)) throw new Error("Expected measured code");
    pre.children = [this.code];
    this.resizeManager.setup(measuredElement(pre) as HTMLPreElement, {
      disableAnnotations: true,
      columnVariables: "measure",
    });
    const code = this.code;
    const observer = observers.find((candidate) => candidate.targets.has(code));
    if (observer === undefined) throw new Error("The real resize manager did not observe code");
    return () => observer.deliver(code);
  }

  dispose() {
    this.fileContainer = undefined;
    this.code = undefined;
    this.cleanUp();
  }
}

const instances: MeasuredFile[] = [];
const editors: Editor<undefined>[] = [];

beforeAll(async () => {
  await getSharedHighlighter({
    themes: ["pierre-dark"],
    langs: ["text"],
    preferredHighlighter: "shiki-wasm",
  });
});

beforeEach(() => {
  observers.length = 0;
  animationFrames.clear();
  MeasuredElement.geometryReads = 0;
  vi.stubGlobal("HTMLElement", MeasuredElement);
  vi.stubGlobal("Document", MeasuredElement);
  vi.stubGlobal("ResizeObserver", RecordedResizeObserver);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = ++nextFrameId;
    animationFrames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => animationFrames.delete(id));
});

afterEach(() => {
  for (const editor of editors.splice(0)) editor.cleanUp();
  for (const instance of instances.splice(0)) instance.dispose();
  clearRenderQueue();
  animationFrames.clear();
  vi.unstubAllGlobals();
});

async function makeFixture(
  overflow: "wrap" | "scroll" = "wrap",
  lineCount = 6001,
  contentWidth = 226.25,
) {
  const contents = Array.from({ length: lineCount }, (_, index) => `line ${index}`).join("\n");
  const file: FileContents = {
    name: "wrapped.txt",
    contents,
    cacheKey: `wrapped:${overflow}`,
    lang: "text",
  };
  const document = new TextDocument(file.name, contents, "text");
  const instance = new MeasuredFile(
    {
      overflow,
      disableFileHeader: true,
      theme: "pierre-dark",
      preferredHighlighter: "shiki-wasm",
      useTokenTransformer: true,
      controlledSelection: true,
    },
    new LayoutVirtualizer(),
  );
  instances.push(instance);
  await instance.initialize(file);
  instance.measure(
    [
      [0, 80],
      [120, 60],
      [4999, 100],
      [5000, 80],
      [5999, 100],
      [6000, 60],
    ],
    contentWidth,
  );
  const apply = (change: { startLine: number } | undefined, passStartLine = true) => {
    if (change === undefined) throw new Error("Expected a document change");
    file.contents = document.getText();
    instance.applyDocumentChange(
      document,
      undefined,
      false,
      passStartLine ? change.startLine : undefined,
    );
  };
  const append = () => {
    const position = document.positionAt(document.getText().length);
    apply(document.applyEdits([{ range: { start: position, end: position }, newText: "\n" }]));
  };
  return { instance, document, file, apply, append };
}

describe("wrapped editor document changes", () => {
  it("retains the unchanged prefix through repeated Enter, undo and redo", async () => {
    const { instance, document, apply, append } = await makeFixture();
    const before = instance.getLinePosition(6001);
    for (let count = 0; count < 60; count += 1) append();
    expect(document.lineCount).toBe(6061);
    expect(instance.getLinePosition(6001)?.top).toBe(before!.top);
    apply(document.undo()?.[0]);
    expect(instance.getLinePosition(6001)?.top).toBe(before!.top);
    apply(document.redo()?.[0]);
    expect(document.lineCount).toBe(6061);
    expect(instance.getLinePosition(6001)?.top).toBe(before!.top);
  });
});

describe("wrapped measurement widths", () => {
  it("repairs an edit before resize delivery when the real resize and render queues drain", async () => {
    const { instance, append } = await makeFixture();
    instance.measure([[6000, 60]]);
    const deliverResize = instance.observeLayout();
    instance.resizeContent(482.25);
    const readsBeforeEdit = MeasuredElement.geometryReads;
    append();
    expect(MeasuredElement.geometryReads).toBe(readsBeforeEdit);
    // No synchronous geometry read: the resize entry owns invalidation.
    expect(instance.getLineHeight(0)).toBe(80);
    deliverResize();
    drainRenderFrames();
    expect(instance.getLineHeight(0)).toBe(20);
    expect(instance.getLinePosition(6001)).toEqual({ top: 120008, height: 60 });
  });

  it("ignores stale resize deliveries after cleanup", async () => {
    const { instance } = await makeFixture();
    const deliverResize = instance.observeLayout();
    instance.dispose();
    clearRenderQueue();
    animationFrames.clear();
    deliverResize();
    expect(animationFrames.size).toBe(0);
  });
});

// Supply inert DOM transport so public Editor edits execute its real tokenizer
// and layout handoff. No native wrapping, observer delivery or scrolling is modeled.
class EditorElement extends MeasuredElement {
  style: Record<string, string> = {};
  parentElement: EditorElement | null = null;

  appendChild(child: EditorElement) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  prepend(child: EditorElement) {
    child.parentElement = this;
    this.children.unshift(child);
  }

  replaceChildren(...children: (EditorElement | string)[]) {
    this.children = [];
    for (const child of children) if (typeof child !== "string") this.appendChild(child);
  }

  setAttribute() {}
  removeAttribute() {}
  addEventListener() {}
  removeEventListener() {}
  after() {}

  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    }
  }

  set innerHTML(value: string) {
    expect(value.startsWith("<svg")).toBe(true);
    this.replaceChildren(new EditorElement());
  }

  get firstElementChild() {
    return this.children[0] ?? null;
  }

  querySelectorAll(selector: string) {
    expect(selector).toBe("[data-code]");
    return this.children.filter((child) => "code" in child.dataset);
  }

  querySelector(selector: string) {
    expect(selector).toBe("[data-deletions]");
    return null;
  }

  getContext() {
    return { measureText: (text: string) => ({ width: text.length * 8 }) };
  }
}

async function makeEditorFixture(lineCount: number) {
  const { instance, file } = await makeFixture("wrap", lineCount);
  vi.stubGlobal("SVGSVGElement", EditorElement);
  vi.stubGlobal("Document", EditorElement);
  vi.stubGlobal(
    "document",
    Object.assign(new EditorElement(), { createElement: () => new EditorElement() }),
  );
  vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("getComputedStyle", () => ({
    paddingTop: "0px",
    fontSize: "13px",
    fontFamily: "monospace",
    tabSize: "2",
    lineHeight: "20px",
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  instance.setOptions({
    ...instance.options,
    useTokenTransformer: true,
    controlledSelection: true,
    themeType: "dark",
  });
  const content = new EditorElement();
  content.dataset.content = "";
  const gutter = new EditorElement();
  gutter.dataset.gutter = "";
  const code = new EditorElement();
  code.dataset.code = "";
  code.appendChild(gutter);
  code.appendChild(content);
  const shadow = new EditorElement();
  shadow.appendChild(code);
  const host = Object.assign(new EditorElement(), { shadowRoot: shadow });
  const highlighter = await getSharedHighlighter({
    themes: ["pierre-dark"],
    langs: ["text"],
    preferredHighlighter: "shiki-wasm",
  });
  const editor = new Editor<undefined>();
  editors.push(editor);
  editor.edit(instance);
  editor.__syncRenderView(highlighter, measuredElement(host), file, undefined, {
    startingLine: 0,
    totalLines: 1,
    bufferBefore: 0,
    bufferAfter: 0,
  });
  const append = (count: number) => {
    const lines = editor.getText().split("\n");
    const end = { line: lines.length - 1, character: lines.at(-1)!.length };
    editor.applyEdits([{ range: { start: end, end }, newText: "\n".repeat(count) }]);
  };
  const remove = (count: number) => {
    const lines = editor.getText().split("\n");
    const startLine = lines.length - count - 1;
    editor.applyEdits([
      {
        range: {
          start: { line: startLine, character: lines[startLine]!.length },
          end: { line: lines.length - 1, character: lines.at(-1)!.length },
        },
        newText: "",
      },
    ]);
  };
  return { instance, editor, append, remove };
}

describe("editor gutter-width changes", () => {
  it("clears newly measured prefixes on undo and redo across a digit boundary", async () => {
    const { instance, editor, append } = await makeEditorFixture(9999);
    append(1);
    instance.measure([[0, 100]]);
    editor.undo();
    expect(editor.getText().split("\n")).toHaveLength(9999);
    expect(instance.getLineHeight(0)).toBe(20);
    instance.measure([[0, 80]]);
    editor.redo();
    expect(editor.getText().split("\n")).toHaveLength(10000);
    expect(instance.getLineHeight(0)).toBe(20);
  });
});
