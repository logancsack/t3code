export const GROK_REVIEW_SENSITIVE_PATH_GLOBS = [
  "**/.grok/**",
  "**/.ssh/**",
  "**/.env",
  "**/.env.*",
  "**/.envrc",
  "**/.direnv/**",
  "**/.aws/**",
  "**/.azure/**",
  "**/.config/gcloud/**",
  "**/.kube/**",
  "**/.docker/config.json",
  "**/.git-credentials",
  "**/.netrc",
  "**/.npmrc",
  "**/.pypirc",
  "**/*.key",
  "**/*.pem",
  "**/*.p12",
  "**/*.pfx",
  "**/*.jks",
  "**/*.tfstate",
  "**/*.tfstate.*",
] as const;

const SENSITIVE_PATH_PATTERN =
  /(?:^|\/)(?:\.grok(?:\/|$)|\.ssh(?:\/|$)|\.direnv(?:\/|$)|\.aws(?:\/|$)|\.azure(?:\/|$)|\.config\/gcloud(?:\/|$)|\.kube(?:\/|$)|\.docker\/config\.json$|\.env(?:\.|$)|\.envrc$|\.git-credentials$|\.netrc$|\.npmrc$|\.pypirc$|[^/]+\.(?:key|pem|p12|pfx|jks|tfstate)(?:\.[^/]*)?$)/i;
const SAFE_SENSITIVE_DIFF_HEADER =
  /^(?:diff --git |old mode |new mode |deleted file mode |new file mode |similarity index |dissimilarity index |rename from |rename to |copy from |copy to |index |--- |\+\+\+ |Binary files )/;
const REDACTION_NOTICE = "[Patch content redacted: sensitive path]";
const CONTEXT_REDACTION_NOTICE = "[Sensitive value redacted]";

const SENSITIVE_CONTEXT_PATTERNS: ReadonlyArray<RegExp> = [
  /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /(?<=:\/\/)[^\s/:@]+:[^\s/@]+(?=@)/g,
];
const SENSITIVE_CONTEXT_ASSIGNMENT =
  /(["']?(?:auth|[A-Za-z0-9_.-]*(?:secret|token|password|passwd|api[_-]?key|private[_-]?key|client[_-]?secret|access[_-]?key|account[_-]?key|authorization|cookie)[A-Za-z0-9_.-]*)["']?\s*[:=]\s*)[^\r\n]+/gi;
const SENSITIVE_CONTEXT_HEADER =
  /^(\s*(?:authorization|proxy-authorization|cookie|set-cookie)\s*:\s*)(\S.*)$/gim;
const SENSITIVE_CONTEXT_KEY =
  /(?:secret|token|password|passwd|api[_-]?key|private[_-]?key|client[_-]?secret|access[_-]?key|authorization|cookie)/i;
const YAML_BLOCK_ASSIGNMENT =
  /^(\s*(?:-\s+)?["']?([A-Za-z0-9_.-]+)["']?\s*:\s*)[|>](?:[-+][1-9]?|[1-9][-+]?)?\s*(?:#.*)?$/i;

const ESCAPED_BYTES: Readonly<Record<string, number>> = {
  a: 0x07,
  b: 0x08,
  t: 0x09,
  n: 0x0a,
  v: 0x0b,
  f: 0x0c,
  r: 0x0d,
  '"': 0x22,
  "\\": 0x5c,
};

export function decodeGitPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) return trimmed;

  const bytes: Array<number> = [];
  const content = trimmed.slice(1, -1);
  const encoder = new TextEncoder();
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]!;
    if (character !== "\\") {
      bytes.push(...encoder.encode(character));
      continue;
    }

    const escaped = content[index + 1];
    if (escaped === undefined) {
      bytes.push(0x5c);
      continue;
    }
    const octal = /^[0-7]{1,3}/.exec(content.slice(index + 1));
    if (octal) {
      bytes.push(Number.parseInt(octal[0], 8) & 0xff);
      index += octal[0].length;
      continue;
    }
    bytes.push(ESCAPED_BYTES[escaped] ?? escaped.charCodeAt(0));
    index += 1;
  }

  return new TextDecoder().decode(Uint8Array.from(bytes));
}

function headerPath(value: string): string {
  return decodeGitPath(value).replace(/^(?:\.\/|[ab]\/)/, "");
}

function splitGitHeaderPaths(value: string): ReadonlyArray<string> {
  const paths: Array<string> = [];
  let current = "";
  let quoted = false;
  let escaped = false;

  for (const character of value.trim()) {
    if (!quoted && /\s/.test(character)) {
      if (current) paths.push(current);
      current = "";
      continue;
    }
    current += character;
    if (escaped) {
      escaped = false;
    } else if (character === "\\" && quoted) {
      escaped = true;
    } else if (character === '"') {
      quoted = !quoted;
    }
  }
  if (current) paths.push(current);
  return paths;
}

function headerContainsSensitivePath(line: string): boolean {
  if (line.startsWith("--- ") || line.startsWith("+++ ")) {
    const path = line.slice(4).trim();
    return path !== "/dev/null" && SENSITIVE_PATH_PATTERN.test(headerPath(path));
  }
  if (!line.startsWith("diff --git ")) return false;
  return splitGitHeaderPaths(line.slice("diff --git ".length)).some((path) =>
    SENSITIVE_PATH_PATTERN.test(headerPath(path)),
  );
}

function redactDiffBlock(lines: ReadonlyArray<string>): {
  readonly lines: ReadonlyArray<string>;
  readonly redacted: boolean;
} {
  const firstHunk = lines.findIndex((line) => line.startsWith("@@ "));
  const headers = firstHunk === -1 ? lines : lines.slice(0, firstHunk);
  if (!headers.some(headerContainsSensitivePath)) return { lines, redacted: false };
  return {
    lines: [...headers.filter((line) => SAFE_SENSITIVE_DIFF_HEADER.test(line)), REDACTION_NOTICE],
    redacted: true,
  };
}

export function redactSensitiveDiffWithMetadata(diff: string): {
  readonly diff: string;
  readonly redacted: boolean;
} {
  const lines = diff.split(/\r?\n/);
  const output: Array<string> = [];
  let block: Array<string> = [];
  let redacted = false;

  const flush = () => {
    const result = redactDiffBlock(block);
    output.push(...result.lines);
    redacted ||= result.redacted;
    block = [];
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ") && block.length > 0) flush();
    block.push(line);
  }
  flush();

  return { diff: output.join("\n"), redacted };
}

export function redactSensitiveDiff(diff: string): string {
  return redactSensitiveDiffWithMetadata(diff).diff;
}

export function redactSensitiveContextWithMetadata(text: string): {
  readonly text: string;
  readonly redacted: boolean;
} {
  let output = redactSensitiveYamlBlocks(text);
  for (const pattern of SENSITIVE_CONTEXT_PATTERNS) {
    output = output.replace(pattern, CONTEXT_REDACTION_NOTICE);
  }
  output = output.replace(SENSITIVE_CONTEXT_ASSIGNMENT, `$1${CONTEXT_REDACTION_NOTICE}`);
  output = output.replace(SENSITIVE_CONTEXT_HEADER, `$1${CONTEXT_REDACTION_NOTICE}`);
  return { text: output, redacted: output !== text };
}

function redactSensitiveYamlBlocks(text: string): string {
  const lines = text.split(/\r?\n/);
  let redacted = false;

  for (let index = 0; index < lines.length; index += 1) {
    const header = YAML_BLOCK_ASSIGNMENT.exec(lines[index]!);
    if (!header || !SENSITIVE_CONTEXT_KEY.test(header[2]!)) continue;

    const headerIndent = /^\s*/.exec(lines[index]!)?.[0].length ?? 0;
    let end = index + 1;
    while (end < lines.length) {
      const line = lines[end]!;
      if (line.trim().length === 0) {
        end += 1;
        continue;
      }
      const indentation = /^\s*/.exec(line)?.[0].length ?? 0;
      if (indentation <= headerIndent) break;
      end += 1;
    }

    lines[index] = `${header[1]}${CONTEXT_REDACTION_NOTICE}`;
    lines.splice(index + 1, end - index - 1);
    redacted = true;
  }

  return redacted ? lines.join("\n") : text;
}
