// One HTML message on the Mail page, in a frame of its own: the mail is
// someone else's markup, so it never runs in the app. Its frame is sandboxed
// without the app's origin (nothing in it reaches Aldo, its cookies or this
// page), what it may load is set by mail.logic.ts's policy, and the markup
// itself is made safe first: no scripts, frames, plugins, refreshes or bases,
// no event handlers, only web, mail and phone links (each opening a new tab)
// and only web and inline images. The one script the frame runs is ours,
// carrying a nonce made for it, and only tells this page how tall the mail is.

import { useEffect, useMemo, useRef, useState } from "react";

import {
  inlineImageOrigins,
  mailContentSecurityPolicy,
  mailDocument,
  parseMailFrameMessage,
  withInlineImages,
  type AldoMailInlineImage,
} from "./mail.logic";

/**
 * Elements that never stay: what runs, embeds, navigates or changes how the
 * rest loads, fields to type into (nothing in mail can be sent from here, and
 * a password box inside Aldo would only help a phish), and SVG's animations
 * (which can set a link's address after it's checked). SVG's names are
 * matched as written.
 */
const DROPPED = [
  "script",
  "noscript",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "portal",
  "meta",
  "base",
  "title",
  "template",
  "input",
  "textarea",
  "select",
  "animate",
  "set",
  "animateMotion",
  "animateTransform",
].join(",");

/** Attributes that hold an address. */
const URL_ATTRIBUTES = new Set([
  "href",
  "src",
  "action",
  "formaction",
  "background",
  "poster",
  "cite",
  "longdesc",
  "lowsrc",
  "dynsrc",
  "data",
  "xlink:href",
]);

/** Whether an address may stay: web addresses, mail and phone links, and images written into the mail. */
function safeUrl(value: string, attribute: string, element: string): boolean {
  const url = value.trim();
  if (url.startsWith("#")) return attribute === "href";
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();
  if (scheme === "http" || scheme === "https") return true;
  if (attribute === "href") return scheme === "mailto" || scheme === "tel";
  return (
    scheme === "data" &&
    (element === "img" || element === "source") &&
    /^data:image\/(?:png|gif|jpe?g|webp|bmp|avif);/i.test(url)
  );
}

/** An address without a scheme of its own (`//host/path`) is a web one. */
const absolute = (value: string) => (/^\s*\/\//.test(value) ? `https:${value.trim()}` : value);

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/** The mail's markup made safe: its styles for the head, its body's attributes and its body. */
export function sanitizeMailHtml(html: string): {
  readonly head: string;
  readonly bodyAttributes: string;
  readonly body: string;
} {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const element of doc.querySelectorAll(DROPPED)) element.remove();
  for (const link of doc.querySelectorAll("link")) {
    const stylesheet = /\bstylesheet\b/i.test(link.getAttribute("rel") ?? "");
    if (!stylesheet || !/^https?:/i.test(absolute(link.getAttribute("href") ?? ""))) link.remove();
  }
  for (const element of [
    doc.body,
    ...doc.body.querySelectorAll("*"),
    ...doc.head.querySelectorAll("*"),
  ]) {
    const name = element.localName;
    // A copy: removing an attribute changes the element's own list.
    for (const attribute of Array.from(element.attributes)) {
      const key = attribute.name.toLowerCase();
      if (key.startsWith("on") || key === "ping" || key === "srcdoc" || key === "target") {
        element.removeAttribute(attribute.name);
      } else if (URL_ATTRIBUTES.has(key)) {
        const value = absolute(attribute.value);
        if (safeUrl(value, key === "xlink:href" ? "href" : key, name)) {
          if (value !== attribute.value) element.setAttribute(attribute.name, value);
        } else {
          element.removeAttribute(attribute.name);
        }
      } else if (key === "srcset") {
        const candidates = attribute.value.split(",").map((part) => absolute(part.trim()));
        const safe = candidates.every((part) => safeUrl(part.split(/\s+/)[0] ?? "", "src", name));
        if (safe) element.setAttribute(attribute.name, candidates.join(", "));
        else element.removeAttribute(attribute.name);
      }
    }
    if (name === "a" || name === "area") {
      const href = element.getAttribute("href") ?? "";
      // A link within the mail stays in it; every other opens a new tab, which can't reach back.
      if (href.startsWith("#")) element.setAttribute("target", "_self");
      else element.setAttribute("rel", "noopener noreferrer");
    }
  }
  const head = [...doc.head.querySelectorAll("style, link")].map((el) => el.outerHTML).join("");
  const bodyAttributes = [...doc.body.attributes]
    .filter((attribute) => /^[a-z][a-z0-9-]*$/i.test(attribute.name))
    .map((attribute) => `${attribute.name}="${escapeAttribute(attribute.value)}"`)
    .join(" ");
  return { head, bodyAttributes, body: doc.body.innerHTML };
}

function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** How tall a message's frame starts, and at most gets (a longer one scrolls inside). */
const MIN_HEIGHT = 48;
const MAX_HEIGHT = 30_000;

export function AldoMailFrame(props: {
  readonly html: string;
  readonly images: ReadonlyArray<AldoMailInlineImage>;
  /** Images, styles and fonts from the web load (the sender learns it was opened). */
  readonly remote: boolean;
  readonly title: string;
}) {
  const { html, images, remote } = props;
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(MIN_HEIGHT * 3);
  const { nonce, document } = useMemo(() => {
    const nonce = newNonce();
    const safe = sanitizeMailHtml(withInlineImages(html, images));
    const policy = mailContentSecurityPolicy({
      nonce,
      remote,
      imageOrigins: inlineImageOrigins(images),
    });
    return { nonce, document: mailDocument({ nonce, policy, ...safe }) };
  }, [html, images, remote]);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const reported = parseMailFrameMessage(event.data, nonce);
      if (reported !== null) setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, reported)));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [nonce]);
  // The border is the wrapper's, so the frame is as tall as the mail.
  return (
    <div className="overflow-hidden rounded-lg border border-border/70 bg-white">
      <iframe
        ref={frame}
        title={props.title}
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        srcDoc={document}
        className="block w-full"
        style={{ height }}
      />
    </div>
  );
}
