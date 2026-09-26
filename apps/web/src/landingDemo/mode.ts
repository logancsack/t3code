export const LANDING_DEMO_ENVIRONMENT_ID = "aldo-browser-demo";
export const LANDING_DEMO_PROJECT_ID = "aldo-demo-project";
export const LANDING_DEMO_THREAD_ID = "aldo-demo-thread";

export function isLandingDemo(url?: URL): boolean {
  let resolved = url ?? null;
  if (resolved === null && typeof window !== "undefined") {
    try {
      resolved = new URL(window.location.href, "http://localhost");
    } catch {
      return false;
    }
  }
  return resolved?.searchParams.get("aldoDemo") === "1";
}

/** The demo served as a hub: repository projects, each thread on its own machine. */
export function isLandingDemoHub(url?: URL): boolean {
  if (!isLandingDemo(url)) return false;
  const resolved = url ?? new URL(window.location.href, "http://localhost");
  return resolved.searchParams.get("aldoDemoHub") === "1";
}
