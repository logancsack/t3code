// Prism's liquid glass. Apple's material is a lens, not a blur: the middle
// passes the backdrop almost untouched and a bezel at the rim bends it, with
// a highlight where the dome's curve faces the light. A browser can do that
// with an SVG displacement map fed to backdrop-filter, but the map has to
// match the element's size, so this runtime builds one per lensed element
// and hands it to the stylesheet through two custom properties:
//
//   --prism-lens  the filter (url(#...)), Chromium only: Safari and Firefox
//                 cannot run an SVG filter as a backdrop filter, so they get
//                 the same glass minus the bend
//   --prism-rim   the rim light, a white image with alpha, every browser
//
// The stylesheet decides where they apply (see index.css); this file only
// knows which elements to measure. Maps are cached by size, so a toolbar of
// identical buttons shares one filter.

export type LensParams = Readonly<{
  /** Width of the refracting rim as a fraction of the shorter side. */
  bezel: number;
  /** Cap on that width in CSS px, so big panels keep a thin rim. */
  bezelMax: number;
  /** How far the backdrop is pulled at the very edge, in CSS px. */
  shift: number;
  /** Steepest incidence angle the dome reaches, in radians. */
  thetaMax: number;
  /** Index of refraction (glass is about 1.5). */
  ior: number;
  /** Red/blue split at the rim, 0 for none. */
  chroma: number;
  /** Brightness of the rim light, its width in CSS px, and how tightly the
      lit arcs hug the corners that face the light. */
  rimGain: number;
  rimWidth: number;
  rimExp: number;
  /** Faint shading inside the rim that reads as the glass's thickness. */
  thick: number;
}>;

/**
 * The one material, calibrated against iOS 26: thick glass whose bend
 * follows the control's size (a 28px button barely bends, the composer
 * does), a rim a couple of pixels wide with bright arcs on the corners that
 * face the light, and a faint chromatic split at the edge.
 */
export const LENS_CONTROL: LensParams = {
  bezel: 0.35,
  bezelMax: 36,
  shift: 14,
  thetaMax: 1.1,
  ior: 1.52,
  chroma: 0.5,
  rimGain: 1.2,
  rimWidth: 2.4,
  rimExp: 3,
  thick: 0.06,
};

/**
 * Which elements get a lens. Controls only: the composer, primary buttons,
 * the Aldo dock, and the thread toolbar's pills. Sidebars, sheets, dialogs,
 * and menus stay frosted; glass is a lot on a surface that size.
 */
const LENSED: ReadonlyArray<{ selector: string; params: LensParams; radius?: number }> = [
  {
    // The composer shell is square; its glass pseudo rounds itself to 22px,
    // or clips to that shape when a context strip hangs off it.
    selector: '[data-slot="composer-shell"]',
    params: LENS_CONTROL,
    radius: 22,
  },
  {
    selector:
      '[data-chat-composer-main-surface], [data-aldo-dock], [data-slot="button"][data-variant="default"], [data-composer-send], [data-chat-header] [data-slot="button"], [data-chat-header] [data-slot="menu-trigger"], [data-chat-header] [data-toolbar-control]',
    params: LENS_CONTROL,
  },
];
const LENSED_SELECTOR = LENSED.map((entry) => entry.selector).join(", ");

/** Maps are built at most this many pixels; larger elements scale a smaller map up. */
const MAX_MAP_PIXELS = 160_000;
/** Cached maps not in use beyond this count are dropped, oldest first. */
const CACHE_LIMIT = 48;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
/** The squircle dome Apple favors: flat middle, soft turn, steep at the edge. */
const profile = (x: number) => Math.pow(1 - Math.pow(1 - x, 4), 0.25);

/**
 * Distance inward from a rounded rectangle's edge, and the outward direction
 * there, for a point relative to the centre.
 */
function edgeOf(px: number, py: number, hw: number, hh: number, r: number) {
  const ax = Math.abs(px);
  const ay = Math.abs(py);
  const qx = ax - (hw - r);
  const qy = ay - (hh - r);
  if (qx > 0 && qy > 0) {
    const len = Math.hypot(qx, qy) || 1e-6;
    return { d: r - len, dx: (Math.sign(px) * qx) / len, dy: (Math.sign(py) * qy) / len };
  }
  if (qx > qy) return { d: hw - ax, dx: Math.sign(px) || 1, dy: 0 };
  return { d: hh - ay, dx: 0, dy: Math.sign(py) || 1 };
}

function normalize(v: [number, number, number]): [number, number, number] {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

export type LensMaps = Readonly<{
  /** RGBA, R = x shift and G = y shift with 128 for none. */
  map: Uint8ClampedArray<ArrayBuffer>;
  /** RGBA, white with the rim light in alpha. */
  rim: Uint8ClampedArray<ArrayBuffer>;
  /** Map size in its own pixels (the element may be larger). */
  width: number;
  height: number;
  /** Displacement scale for the filter, in CSS px. */
  scale: number;
}>;

/**
 * Build the displacement map and rim light for an element of `width` by
 * `height` CSS px with corner radius `radius`. Pure, so it is testable and
 * cacheable; encoding to images happens in the runtime.
 */
export function buildLensMaps(
  width: number,
  height: number,
  radius: number,
  params: LensParams,
): LensMaps {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const r = clamp(radius, 0, Math.min(w, h) / 2);
  const step = Math.max(1, Math.ceil(Math.sqrt((w * h) / MAX_MAP_PIXELS)));
  const mw = Math.ceil(w / step);
  const mh = Math.ceil(h / step);
  const bezel = Math.min(params.bezel * Math.min(w, h), params.bezelMax);
  const map = new Uint8ClampedArray(mw * mh * 4);
  const rim = new Uint8ClampedArray(mw * mh * 4);
  // Light from the upper left, and a weaker one from the lower right so the
  // far edge glows too, as the real material does.
  const lightA = normalize([-0.55, -0.75, 0.42]);
  const lightB = normalize([0.55, 0.75, 0.3]);
  // Everything the dome contributes depends only on the distance into the
  // bezel, so it is sampled once along that distance: rays come straight
  // down, meet the dome at its local slope, refract once (Snell), and the
  // lateral shift grows toward the edge; the normal tilts outward by the
  // same angle and lights the rim.
  const SAMPLES = 256;
  const bend = new Float32Array(SAMPLES + 1);
  const sinT = new Float32Array(SAMPLES + 1);
  const cosT = new Float32Array(SAMPLES + 1);
  const dd = 0.004;
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const slope = (profile(clamp(t + dd, 0, 1)) - profile(clamp(t - dd, 0, 1))) / (2 * dd);
    const theta = Math.min(Math.atan(slope), params.thetaMax);
    const refracted = Math.asin(Math.sin(theta) / params.ior);
    bend[i] = t >= 1 ? 0 : Math.tan(theta - refracted) / Math.tan(params.thetaMax);
    sinT[i] = Math.sin(theta);
    cosT[i] = Math.cos(theta);
  }
  const thickness = new Float32Array(SAMPLES + 1);
  for (let i = 0; i <= SAMPLES; i++) thickness[i] = Math.pow(1 - i / SAMPLES, 3) * params.thick;
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const px = (x + 0.5) * step - w / 2;
      const py = (y + 0.5) * step - h / 2;
      const e = edgeOf(px, py, w / 2, h / 2, r);
      const inside = e.d >= 0;
      const t = clamp(e.d / bezel, 0, 1);
      const i = Math.round(t * SAMPLES);
      const shift = inside ? bend[i]! : 0;
      const o = (y * mw + x) * 4;
      // The eye at the edge sees inner content: sample toward the centre.
      map[o] = Math.round(128 - e.dx * shift * 127);
      map[o + 1] = Math.round(128 - e.dy * shift * 127);
      map[o + 2] = 128;
      map[o + 3] = 255;
      // Rim light: a line a few pixels wide whatever the size, bright where
      // the dome faces the light (the upper-left corner, the top edge),
      // fainter on the far side, plus a faint shading inside it that reads
      // as thickness.
      let glow = 0;
      if (inside) {
        const nx = sinT[i]! * e.dx;
        const ny = sinT[i]! * e.dy;
        const nz = cosT[i]!;
        const kA = Math.pow(
          Math.max(0, nx * lightA[0] + ny * lightA[1] + nz * lightA[2]),
          params.rimExp,
        );
        const kB = Math.pow(
          Math.max(0, nx * lightB[0] + ny * lightB[1] + nz * lightB[2]),
          params.rimExp + 1,
        );
        const band = Math.exp(-Math.pow(e.d / params.rimWidth, 2));
        glow = band * (0.8 * kA + 0.35 * kB) * params.rimGain + thickness[i]!;
      }
      rim[o] = 255;
      rim[o + 1] = 255;
      rim[o + 2] = 255;
      rim[o + 3] = Math.round(clamp(glow, 0, 1) * 255);
    }
  }
  // Thickness, and so the bend, follows the control's size.
  const scale = Math.min(params.shift, Math.max(4, 0.1 * Math.min(w, h)));
  return { map, rim, width: mw, height: mh, scale };
}

/** The SVG filter: the map bends the backdrop, once per channel when chroma splits them. */
export function lensFilterMarkup(
  id: string,
  width: number,
  height: number,
  mapUrl: string,
  scale: number,
  chroma: number,
): string {
  const open = `<filter id="${id}" x="0" y="0" width="${width}" height="${height}" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">`;
  const image = `<feImage href="${mapUrl}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" result="map"/>`;
  const displace = (factor: number, result: string) =>
    `<feDisplacementMap in="SourceGraphic" in2="map" scale="${(scale * factor).toFixed(2)}" xChannelSelector="R" yChannelSelector="G" result="${result}"/>`;
  if (!chroma) return `${open}${image}${displace(1, "out")}</filter>`;
  const keep = (channel: "r" | "g" | "b", input: string, result: string) => {
    const row = {
      r: "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0",
      g: "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0",
      b: "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0",
    }[channel];
    return `<feColorMatrix in="${input}" type="matrix" values="${row}  0 0 0 1 0" result="${result}"/>`;
  };
  return (
    `${open}${image}` +
    displace(1 - 0.07 * chroma, "dr") +
    keep("r", "dr", "cr") +
    displace(1, "dg") +
    keep("g", "dg", "cg") +
    displace(1 + 0.09 * chroma, "db") +
    keep("b", "db", "cb") +
    `<feComposite in="cr" in2="cg" operator="arithmetic" k2="1" k3="1" result="crg"/>` +
    `<feComposite in="crg" in2="cb" operator="arithmetic" k2="1" k3="1"/></filter>`
  );
}

// ---- Runtime --------------------------------------------------------------

type CacheEntry = {
  filterId: string | null;
  rimUrl: string;
  users: number;
  filter: SVGElement | null;
};

function toDataUrl(data: Uint8ClampedArray<ArrayBuffer>, width: number, height: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return "";
  context.putImageData(new ImageData(data, width, height), 0, 0);
  return canvas.toDataURL("image/png");
}

/** Only Chromium runs an SVG filter inside backdrop-filter; others get the rim without the bend. */
function supportsLensFilter(): boolean {
  const data = (navigator as Navigator & { userAgentData?: { brands: Array<{ brand: string }> } })
    .userAgentData;
  if (data) return data.brands.some((entry) => /chromium/i.test(entry.brand));
  const ua = navigator.userAgent;
  return /Chrome\/\d+/.test(ua) && !/Firefox|FxiOS/.test(ua);
}

/** The element's corner radius, or its backdrop pseudo's when the rounding lives there (the composer). */
function cornerRadius(element: Element, width: number, height: number): number {
  for (const pseudo of [undefined, "::before"]) {
    const raw = getComputedStyle(element, pseudo).borderTopLeftRadius.trim();
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value) || value <= 0) continue;
    // A capsule's radius is written as infinity; the shape caps it anyway.
    const radius = raw.endsWith("%") ? (Math.min(width, height) * value) / 100 : value;
    return Math.min(radius, Math.min(width, height) / 2);
  }
  return 0;
}

function lensedEntry(element: Element): (typeof LENSED)[number] | null {
  for (const entry of LENSED) if (element.matches(entry.selector)) return entry;
  return null;
}

function createRuntime() {
  const lens = supportsLensFilter();
  const cache = new Map<string, CacheEntry>();
  const tracked = new Map<
    Element,
    { key: string | null; observer: ResizeObserver; settle: number }
  >();
  let defs: SVGDefsElement | null = null;
  let frame = 0;
  const pending = new Set<Element>();
  /** A size has to hold this long before its map is built, so a composer
      growing line by line or a panel animating its width builds once. */
  const SETTLE_MS = 120;

  function defsHost(): SVGDefsElement {
    if (defs?.isConnected) return defs;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("data-prism-glass", "");
    svg.setAttribute("style", "position:absolute;width:0;height:0;overflow:hidden");
    defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    svg.append(defs);
    document.body.append(svg);
    return defs;
  }

  function entryFor(
    key: string,
    width: number,
    height: number,
    radius: number,
    params: LensParams,
  ): CacheEntry {
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key);
      cache.set(key, cached); // most recently used last
      return cached;
    }
    const maps = buildLensMaps(width, height, radius, params);
    const rimUrl = toDataUrl(maps.rim, maps.width, maps.height);
    let filterId: string | null = null;
    let filter: SVGElement | null = null;
    if (lens) {
      filterId = `prism-lens-${cache.size}-${Math.round(width)}x${Math.round(height)}-${Math.round(radius)}`;
      const host = defsHost();
      host.insertAdjacentHTML(
        "beforeend",
        lensFilterMarkup(
          filterId,
          Math.round(width),
          Math.round(height),
          toDataUrl(maps.map, maps.width, maps.height),
          maps.scale,
          params.chroma,
        ),
      );
      filter = host.lastElementChild as SVGElement;
    }
    const entry: CacheEntry = { filterId, rimUrl, users: 0, filter };
    cache.set(key, entry);
    trim();
    return entry;
  }

  function trim() {
    if (cache.size <= CACHE_LIMIT) return;
    for (const [key, entry] of cache) {
      if (cache.size <= CACHE_LIMIT) break;
      if (entry.users > 0) continue;
      entry.filter?.remove();
      cache.delete(key);
    }
  }

  function release(element: Element) {
    const state = tracked.get(element);
    if (!state) return;
    if (state.key) {
      const entry = cache.get(state.key);
      if (entry) entry.users -= 1;
    }
    state.observer.disconnect();
    clearTimeout(state.settle);
    tracked.delete(element);
    pending.delete(element);
    (element as HTMLElement).style.removeProperty("--prism-lens");
    (element as HTMLElement).style.removeProperty("--prism-rim");
  }

  function apply(element: Element) {
    const state = tracked.get(element);
    const entry = lensedEntry(element);
    if (!state || !entry || !element.isConnected) return;
    const params = entry.params;
    const width = (element as HTMLElement).offsetWidth;
    const height = (element as HTMLElement).offsetHeight;
    if (width < 2 || height < 2) return;
    const radius = cornerRadius(element, width, height) || entry.radius || 0;
    const key = `${width}x${height}:${Math.round(radius)}`;
    if (key === state.key) return;
    if (state.key) {
      const previous = cache.get(state.key);
      if (previous) previous.users -= 1;
    }
    const cached = entryFor(key, width, height, radius, params);
    cached.users += 1;
    state.key = key;
    const style = (element as HTMLElement).style;
    if (cached.filterId) style.setProperty("--prism-lens", `url(#${cached.filterId})`);
    style.setProperty("--prism-rim", `url("${cached.rimUrl}")`);
  }

  function flush() {
    frame = 0;
    const batch = [...pending];
    pending.clear();
    for (const element of batch) apply(element);
  }

  function schedule(element: Element) {
    pending.add(element);
    if (!frame) frame = requestAnimationFrame(flush);
  }

  /** Builds once the element's size has settled; the first build is immediate. */
  function settle(element: Element) {
    const state = tracked.get(element);
    if (!state) return;
    if (state.key === null) {
      schedule(element);
      return;
    }
    clearTimeout(state.settle);
    state.settle = window.setTimeout(() => schedule(element), SETTLE_MS);
  }

  function track(element: Element) {
    if (tracked.has(element) || !lensedEntry(element)) return;
    const observer = new ResizeObserver(() => settle(element));
    tracked.set(element, { key: null, observer, settle: 0 });
    observer.observe(element);
    schedule(element);
  }

  function scan(root: ParentNode) {
    if (root instanceof Element && root.matches(LENSED_SELECTOR)) track(root);
    for (const element of root.querySelectorAll(LENSED_SELECTOR)) track(element);
  }

  const mutations = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.removedNodes) {
        if (!(node instanceof Element)) continue;
        for (const element of Array.from(tracked.keys()))
          if (node === element || node.contains(element)) release(element);
      }
      for (const node of record.addedNodes) if (node instanceof Element) scan(node);
    }
  });

  return {
    start() {
      document.documentElement.dataset.prismLens = lens ? "svg" : "none";
      scan(document.body);
      mutations.observe(document.body, { childList: true, subtree: true });
    },
    stop() {
      mutations.disconnect();
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      for (const element of Array.from(tracked.keys())) release(element);
      for (const entry of cache.values()) entry.filter?.remove();
      cache.clear();
      defs?.parentElement?.remove();
      defs = null;
      delete document.documentElement.dataset.prismLens;
    },
  };
}

/**
 * Runs the glass while the Prism theme is on: watches the document's theme
 * id and starts or stops with it. Safe to call once at startup.
 */
export function installPrismGlass(): () => void {
  if (typeof document === "undefined" || typeof ResizeObserver === "undefined") return () => {};
  let runtime: ReturnType<typeof createRuntime> | null = null;
  const sync = () => {
    const on = document.documentElement.dataset.themeId === "prism";
    if (on && !runtime) {
      runtime = createRuntime();
      runtime.start();
    } else if (!on && runtime) {
      runtime.stop();
      runtime = null;
    }
  };
  const observer = new MutationObserver(sync);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme-id"],
  });
  if (document.body) sync();
  else document.addEventListener("DOMContentLoaded", sync, { once: true });
  return () => {
    observer.disconnect();
    runtime?.stop();
    runtime = null;
  };
}
