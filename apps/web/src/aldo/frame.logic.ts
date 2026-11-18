import "culori/css";
import { converter, parse } from "culori/fn";

const rgb = converter("rgb");
export function frameRgb(value: string): readonly number[] | null {
  const parsed = parse(value);
  if (!parsed) return null;
  const color = rgb(parsed);
  return [color.r, color.g, color.b, color.alpha ?? 1];
}

export function frameComposite(front: readonly number[], back: readonly number[]): number[] {
  const alpha = front[3] ?? 1;
  return [0, 1, 2].map((i) => front[i]! * alpha + back[i]! * (1 - alpha));
}

function luminance(color: readonly number[]): number {
  return color.slice(0, 3).reduce((sum, channel, i) => {
    const c = Math.max(0, Math.min(1, channel));
    return (
      sum + (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i]!
    );
  }, 0);
}
export function frameContrast(a: readonly number[], b: readonly number[]): number {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The approved monochrome mark, chosen against the theme's actual backdrop.
 * Raise the dimmest opacity on midtone custom palettes, preserving 3:1 in motion. */
export function framePaint(background: readonly number[]) {
  const black = [0, 0, 0],
    white = [1, 1, 1];
  const ink = frameContrast(black, background) >= frameContrast(white, background) ? black : white;
  let minimum = 0.72 * 0.76;
  while (
    frameContrast(frameComposite([...ink, minimum], background), background) < 3.1 &&
    minimum < 1
  )
    minimum = Math.min(1, minimum + 0.005);
  const raised = minimum > 0.72 * 0.76;
  return {
    color: `rgb(${ink.map((v) => v * 255).join(" ")})`,
    floor: raised ? Math.max(0.72, Math.sqrt(minimum)) : 0.72,
    low: raised ? Math.max(0.76, Math.sqrt(minimum)) : 0.76,
  };
}
