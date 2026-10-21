// A brand's logo on a neutral tile, the same size wherever Settings names a
// model, an account or an app (Models, Connections, Vault). Marks keep their
// own colors; black ones follow the theme. Anything without a mark gets its
// initial on the same tile.
import { useId, type CSSProperties, type ReactNode } from "react";

import {
  AzureDevOpsIcon,
  BitbucketIcon,
  ClaudeAI,
  GitHubIcon,
  GitLabIcon,
  GrokIcon,
  MuseCodeIcon,
  OpenAI,
} from "../components/Icons";
import { cn } from "../lib/utils";
import { BRAND_MARKS, CANVA_WORDMARK, type BrandMark } from "./brandMarks";

/** The Aldo "Open Frame" mark (SidebarChrome's), for Aldo's own models. */
function AldoMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 42 32">
      <path d="M1 28 13.4 4h8.7L10.6 28H1Z" fill="currentColor" />
      <path d="M23.9 4h8.7L41 28h-9.6L23.9 4Z" fill="currentColor" />
    </svg>
  );
}

function MicrosoftMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 23 23">
      <path fill="#F25022" d="M1 1h10v10H1z" />
      <path fill="#7FBA00" d="M12 1h10v10H12z" />
      <path fill="#00A4EF" d="M1 12h10v10H1z" />
      <path fill="#FFB900" d="M12 12h10v10H12z" />
    </svg>
  );
}

/** Canva's app icon: the "C" of its wordmark, white on its teal-to-violet disc. */
function CanvaMark({ className }: { className?: string }) {
  const gradient = `${useId().replaceAll(":", "")}-canva`;
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 37 37">
      <defs>
        <linearGradient id={gradient} x1="0.25" y1="0" x2="0.75" y2="1">
          <stop offset="0.1" stopColor="#00C4CC" />
          <stop offset="0.55" stopColor="#3D6BE6" />
          <stop offset="1" stopColor="#6420FF" />
        </linearGradient>
      </defs>
      <circle cx="18.5" cy="18.5" r="18.5" fill={`url(#${gradient})`} />
      {/* The wordmark's first letter: a nested viewport clips the rest. */}
      <svg x="8.6" y="5.8" width="19" height="26" viewBox="0 0 27 37">
        <path d={CANVA_WORDMARK} fill="#fff" />
      </svg>
    </svg>
  );
}

/** Zapier's app icon: its orange asterisk (its catalog mark is the wordmark, unreadable this small). */
function ZapierMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24">
      {[0, 45, 90, 135].map((angle) => (
        <rect
          key={angle}
          x="9.75"
          y="1"
          width="4.5"
          height="22"
          rx="0.6"
          fill="#FF4F00"
          transform={`rotate(${angle} 12 12)`}
        />
      ))}
    </svg>
  );
}

function DataMark({ mark, className }: { mark: BrandMark; className?: string }) {
  const [x, y, w, h] = mark.viewBox.split(" ").map(Number) as [number, number, number, number];
  return (
    <svg aria-hidden="true" className={className} viewBox={mark.viewBox}>
      {mark.backdrop?.shape === "disc" ? (
        <circle cx={x + w / 2} cy={y + h / 2} r={Math.min(w, h) / 2} fill={mark.backdrop.fill} />
      ) : mark.backdrop ? (
        <rect x={x} y={y} width={w} height={h} rx={w * 0.22} fill={mark.backdrop.fill} />
      ) : null}
      {mark.paths.map((path) => (
        <path
          key={path.d.slice(0, 32)}
          d={path.d}
          {...(path.evenOdd ? { fillRule: "evenodd" as const, clipRule: "evenodd" as const } : {})}
          {...(path.opacity === undefined ? {} : { fillOpacity: path.opacity })}
          className={path.fill ? "fill-(--brand) dark:fill-(--brand-dark)" : "fill-current"}
          style={
            path.fill
              ? ({ "--brand": path.fill, "--brand-dark": path.dark ?? path.fill } as CSSProperties)
              : undefined
          }
        />
      ))}
    </svg>
  );
}

const MARKS: Readonly<Record<string, (className: string) => ReactNode>> = {
  aldo: (c) => <AldoMark className={c} />,
  claude: (c) => <ClaudeAI className={c} />,
  codex: (c) => <OpenAI className={c} />,
  grok: (c) => <GrokIcon className={c} />,
  muse: (c) => <MuseCodeIcon className={c} />,
  github: (c) => <GitHubIcon className={c} />,
  gitlab: (c) => <GitLabIcon className={c} />,
  bitbucket: (c) => <BitbucketIcon className={c} />,
  azure: (c) => <AzureDevOpsIcon className={c} />,
  microsoft: (c) => <MicrosoftMark className={c} />,
  canva: (c) => <CanvaMark className={c} />,
  zapier: (c) => <ZapierMark className={c} />,
};

/** Whether there's a logo for this id (a catalog's, a model's or a code host's). */
export function aldoHasBrandMark(id: string): boolean {
  return id in MARKS || id in BRAND_MARKS;
}

/**
 * The service a host is (api.runwayml.com is Runway's), from the first of
 * them that's known, or null.
 */
export function aldoBrandForHosts(hosts: ReadonlyArray<string> | null): string | null {
  for (const host of hosts ?? []) {
    const name = host.toLowerCase().replace(/^\*\./, "");
    for (const [id, domains] of BRAND_DOMAINS) {
      if (domains.some((domain) => name === domain || name.endsWith(`.${domain}`))) return id;
    }
  }
  return null;
}

/** The service a vault item is for: from its hosts, or a word in its name (ANTHROPIC_API_KEY). */
export function aldoBrandForVaultItem(item: {
  readonly hosts?: ReadonlyArray<string> | null;
  readonly origin?: string | null;
  readonly name: string;
}): string | null {
  const hosts = [...(item.hosts ?? [])];
  if (item.origin) {
    try {
      hosts.push(new URL(item.origin).hostname);
    } catch {
      // Not an address: its name may still say.
    }
  }
  const byHost = aldoBrandForHosts(hosts);
  if (byHost) return byHost;
  const words = item.name.toLowerCase().split(/[^a-z0-9]+/);
  for (const [id, names] of BRAND_WORDS) {
    if (names.some((name) => words.includes(name))) return id;
  }
  return null;
}

const BRAND_WORDS: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
  ["claude", ["anthropic", "claude"]],
  ["codex", ["openai", "chatgpt"]],
  ["grok", ["xai", "grok"]],
  ["github", ["github", "gh"]],
  ["gitlab", ["gitlab"]],
  ["bitbucket", ["bitbucket"]],
  ["google", ["google", "gmail", "gcp"]],
  ["microsoft", ["microsoft", "azure", "outlook"]],
  ["runway", ["runway", "runwayml"]],
  ["luma", ["luma"]],
  ["fal", ["fal"]],
  ["higgsfield", ["higgsfield"]],
  ["replicate", ["replicate"]],
  ["elevenlabs", ["elevenlabs"]],
  ["stripe", ["stripe"]],
  ["paypal", ["paypal"]],
  ["notion", ["notion"]],
  ["linear", ["linear"]],
  ["atlassian", ["atlassian", "jira", "confluence"]],
  ["airtable", ["airtable"]],
  ["webflow", ["webflow"]],
  ["supabase", ["supabase"]],
  ["sentry", ["sentry"]],
  ["huggingface", ["huggingface", "hf"]],
  ["zapier", ["zapier"]],
  ["canva", ["canva"]],
  ["granola", ["granola"]],
];

const BRAND_DOMAINS: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
  ["claude", ["anthropic.com", "claude.ai"]],
  ["codex", ["openai.com", "chatgpt.com"]],
  ["grok", ["x.ai"]],
  ["github", ["github.com", "githubusercontent.com"]],
  ["gitlab", ["gitlab.com"]],
  ["bitbucket", ["bitbucket.org"]],
  ["azure", ["dev.azure.com", "visualstudio.com"]],
  ["google", ["googleapis.com", "google.com"]],
  ["microsoft", ["microsoft.com", "microsoftonline.com", "office.com"]],
  ["runway", ["runwayml.com", "dev.runwayml.com"]],
  ["luma", ["lumalabs.ai"]],
  ["fal", ["fal.ai", "fal.run", "fal.media"]],
  ["higgsfield", ["higgsfield.ai"]],
  ["replicate", ["replicate.com"]],
  ["elevenlabs", ["elevenlabs.io"]],
  ["stripe", ["stripe.com"]],
  ["paypal", ["paypal.com"]],
  ["notion", ["notion.com", "notion.so"]],
  ["linear", ["linear.app"]],
  ["atlassian", ["atlassian.com", "atlassian.net"]],
  ["airtable", ["airtable.com"]],
  ["webflow", ["webflow.com"]],
  ["supabase", ["supabase.co", "supabase.com"]],
  ["sentry", ["sentry.io"]],
  ["huggingface", ["huggingface.co"]],
  ["zapier", ["zapier.com"]],
  ["canva", ["canva.com"]],
  ["granola", ["granola.ai", "granola.so"]],
];

export function AldoBrandMark({ id, className }: { id: string; className?: string }) {
  const custom = MARKS[id];
  if (custom) return custom(cn("text-foreground", className));
  const mark = BRAND_MARKS[id];
  return mark ? <DataMark mark={mark} className={cn("text-foreground", className)} /> : null;
}

/** The same tile around an icon, for what has no logo (the agents' inbox). */
export function AldoIconTile({ icon, className }: { icon: ReactNode; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background text-muted-foreground shadow-xs/5 dark:bg-white/[0.04] [&_svg]:size-4",
        className,
      )}
    >
      {icon}
    </span>
  );
}

export function AldoBrandTile({
  id,
  name,
  size = "md",
  className,
}: {
  /** The catalog's, model's or host's id; unknown ones show the name's initial. */
  id: string;
  name: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const markClass = size === "sm" ? "size-3.5" : "size-[18px]";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center border border-border/70 bg-background shadow-xs/5 dark:bg-white/[0.04]",
        size === "sm" ? "size-6 rounded-md" : "size-8 rounded-lg",
        className,
      )}
    >
      {aldoHasBrandMark(id) ? (
        <AldoBrandMark id={id} className={markClass} />
      ) : (
        <span className="font-semibold text-muted-foreground text-xs">
          {name.trim().slice(0, 1).toUpperCase()}
        </span>
      )}
    </span>
  );
}
