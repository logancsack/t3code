export const GROK_REVIEW_SENSITIVE_PATH_GLOBS = [
  "**/.grok/**",
  "**/.ssh/**",
  "**/.env",
  "**/.env.*",
  "**/.git-credentials",
  "**/.netrc",
  "**/.npmrc",
  "**/.pypirc",
  "**/*.key",
  "**/*.pem",
] as const;

const SENSITIVE_PATH_PATTERN =
  /(?:^|\/)(?:\.grok(?:\/|$)|\.ssh(?:\/|$)|\.env(?:\.|$)|\.git-credentials$|\.netrc$|\.npmrc$|\.pypirc$|[^/]+\.(?:key|pem)$)/i;
const SAFE_SENSITIVE_DIFF_HEADER =
  /^(?:diff --git |old mode |new mode |deleted file mode |new file mode |similarity index |dissimilarity index |rename from |rename to |copy from |copy to |index |--- |\+\+\+ |Binary files )/;
const REDACTION_NOTICE = "[Patch content redacted: sensitive path]";

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

function redactDiffBlock(lines: ReadonlyArray<string>): ReadonlyArray<string> {
  const firstHunk = lines.findIndex((line) => line.startsWith("@@ "));
  const headers = firstHunk === -1 ? lines : lines.slice(0, firstHunk);
  if (!headers.some(headerContainsSensitivePath)) return lines;
  return [...lines.filter((line) => SAFE_SENSITIVE_DIFF_HEADER.test(line)), REDACTION_NOTICE];
}

export function redactSensitiveDiff(diff: string): string {
  const lines = diff.split(/\r?\n/);
  const output: Array<string> = [];
  let block: Array<string> = [];

  const flush = () => {
    output.push(...redactDiffBlock(block));
    block = [];
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ") && block.length > 0) flush();
    block.push(line);
  }
  flush();

  return output.join("\n");
}
