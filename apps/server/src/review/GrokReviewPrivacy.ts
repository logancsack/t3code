export const GROK_REVIEW_SENSITIVE_PATH_GLOBS = [
  "**/.grok/**",
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
  /(?:^|\/)(?:\.grok(?:\/|$)|\.env(?:\.|$)|\.git-credentials$|\.netrc$|\.npmrc$|\.pypirc$|[^/]+\.(?:key|pem)$)/i;
const SAFE_SENSITIVE_DIFF_HEADER =
  /^(?:diff --git |old mode |new mode |deleted file mode |new file mode |similarity index |dissimilarity index |rename from |rename to |copy from |copy to |index |--- |\+\+\+ |Binary files )/;
const REDACTION_NOTICE = "[Patch content redacted: sensitive path]";

function unquoteGitPath(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
}

function headerPath(value: string): string {
  return unquoteGitPath(value).replace(/^(?:\.\/|[ab]\/)/, "");
}

function headerContainsSensitivePath(line: string): boolean {
  if (line.startsWith("--- ") || line.startsWith("+++ ")) {
    const path = line.slice(4).trim();
    return path !== "/dev/null" && SENSITIVE_PATH_PATTERN.test(headerPath(path));
  }
  if (!line.startsWith("diff --git ")) return false;
  return line
    .slice("diff --git ".length)
    .split(/\s+/)
    .some((path) => SENSITIVE_PATH_PATTERN.test(headerPath(path)));
}

function redactDiffBlock(lines: ReadonlyArray<string>): ReadonlyArray<string> {
  if (!lines.some(headerContainsSensitivePath)) return lines;
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
