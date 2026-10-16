// What a card quotes (an email, a plan, a command), a few lines with the rest a
// tap away, and an agent's own words in it as its thread shows them: T3's chat
// markdown, which loads with the first one rather than with the app. With no
// workspace here, a path on the agent's machine shows as the thread's file
// chip (its name and line), or as code when it's relative to that workspace,
// not as a link to nowhere; a web link stays a link.

import type { Nodes, Root } from "mdast";
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";

import { Skeleton } from "../components/ui/skeleton";
import { cn } from "~/lib/utils";
import { FOCUS } from "./surface";

export const loadChatMarkdown = () => import("../components/ChatMarkdown");
const ChatMarkdown = lazy(loadChatMarkdown);

/** A link with no scheme that isn't absolute (`src/a.ts#L3`): its words as code. */
const WORKSPACE_LINKS = [
  () => (tree: Root) => {
    const walk = (node: Nodes) => {
      if (!("children" in node)) return;
      for (const [i, child] of node.children.entries()) {
        if (child.type === "link" && !/^(?:[a-z][a-z\d+-]*:|[/#])/i.test(child.url)) {
          const value = child.children.map((c) => ("value" in c ? c.value : "")).join("");
          (node.children as Nodes[])[i] = { type: "inlineCode", value };
        } else walk(child);
      }
    };
    walk(tree);
  },
];

/** Lines a quote shows before "Show all" (literal, for Tailwind). */
const CLAMP = { 3: "max-h-[3lh]", 4: "max-h-[4lh]", 6: "max-h-[6lh]", 10: "max-h-[10lh]" } as const;

/**
 * A quote cut short at a height, not at a character, so what's in it (markdown
 * too) is never broken: it fades out, and "Show all" shows the rest, so what's
 * said yes to can be read in full first. Its parent lays it out in a column.
 */
export function Quoted(props: {
  readonly lines: keyof typeof CLAMP;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const text = useRef<HTMLDivElement>(null);
  const [whole, setWhole] = useState(false);
  const [long, setLong] = useState(false);
  useEffect(() => {
    const element = text.current;
    if (!element || whole) return;
    const observer = new ResizeObserver(() =>
      setLong(element.scrollHeight > element.clientHeight + 1),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [whole]);
  return (
    <>
      <div
        ref={text}
        className={cn(
          "min-w-0 break-words",
          // Cut short, it fades out rather than ending on an ellipsis (a blank line can be the last shown).
          !whole && ["overflow-hidden", CLAMP[props.lines]],
          !whole && long && "[mask-image:linear-gradient(to_bottom,black_60%,transparent)]",
          props.className,
        )}
      >
        {props.children}
      </div>
      {long ? (
        <button
          type="button"
          aria-expanded={whole}
          className={cn(
            FOCUS,
            "self-start rounded-sm font-medium text-[13px] text-muted-foreground leading-5 hover:text-foreground",
          )}
          onClick={() => setWhole((was) => !was)}
        >
          {whole ? "Show less" : "Show all"}
        </button>
      ) : null}
    </>
  );
}

/** An agent's words (a plan, the brief of a thread to start, a thread's turn), rendered. */
export function AgentMarkdown(props: { readonly text: string; readonly className?: string }) {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-2 py-1">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-4/5" />
          <Skeleton className="h-3.5 w-2/3" />
        </div>
      }
    >
      <ChatMarkdown {...props} cwd={undefined} extraRemarkPlugins={WORKSPACE_LINKS} />
    </Suspense>
  );
}
