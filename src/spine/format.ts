import { isSpine43 } from "../constants";
import { ErrorCode, SpineError } from "../utils/error-codes";

export function uses43(json: any): boolean {
  return isSpine43(json.skeleton?.spine);
}

export function constraintsOf(json: any, type: string): any[] {
  return uses43(json) ? (json.constraints ?? []).filter((c: any) => c.type === type) : json[type] ?? [];
}

/** The tool accepts normalized easing, but 4.3 stores time/value handles for each channel. */
export interface Bezier { c1x: number; c1y: number; c2x: number; c2y: number }

function curveValues(frame: any, timeline: string): number[] {
  switch (timeline) {
    case "translate": case "shear": return [frame.x ?? 0, frame.y ?? 0];
    case "scale": return [frame.x ?? 1, frame.y ?? 1];
    case "rotate": case "translatex": case "translatey": case "shearx": case "sheary":
    case "position": case "spacing": return [frame.value ?? 0];
    case "alpha": case "scalex": case "scaley": return [frame.value ?? 1];
    case "rgba": case "rgb": case "rgba2": case "rgb2": {
      const color = frame.color ?? frame.light ?? "ffffffff";
      const bytes = color.slice(0, timeline.startsWith("rgba") ? 8 : 6) + (timeline.endsWith("2") ? (frame.dark ?? "000000").slice(0, 6) : "");
      return bytes.match(/../g).map((b: string) => parseInt(b, 16) / 255);
    }
    default: throw new SpineError(ErrorCode.INVALID_ARGUMENT, `时间轴 ${timeline} 不支持此贝塞尔操作。`);
  }
}

export function setBezier(frame: any, next: any, timeline: string, b: Bezier, modern: boolean): void {
  if (!modern) {
    Object.assign(frame, { curve: b.c1x, c2: b.c1y, c3: b.c2x, c4: b.c2y });
    return;
  }
  if (!next) throw new SpineError(ErrorCode.FRAME_OUT_OF_RANGE, "贝塞尔曲线需要下一关键帧。");
  const start = frame.time ?? 0, duration = (next.time ?? 0) - start;
  const end = curveValues(next, timeline);
  frame.curve = curveValues(frame, timeline).flatMap((value, i) => {
    const delta = end[i] - value;
    return [start + duration * b.c1x, value + delta * b.c1y, start + duration * b.c2x, value + delta * b.c2y];
  });
}

type SlotOffset = { slot: string; offset: number };

/** 4.3 stores a sparse permutation as displacements from each slot's setup index. */
export function drawOrderSlots(setup: string[], offsets: SlotOffset[]): string[] {
  const order: string[] = new Array(setup.length);
  const moved = new Set<string>();
  for (const { slot, offset } of offsets) {
    const from = setup.indexOf(slot), to = from + offset;
    if (from < 0 || to < 0 || to >= order.length || order[to] !== undefined || moved.has(slot)) {
      throw new SpineError(ErrorCode.INVALID_ARGUMENT, `绘制顺序中有无效的插槽偏移 ${slot} (${offset})。`);
    }
    moved.add(slot);
    order[to] = slot;
  }
  const remaining = setup.filter(slot => !moved.has(slot));
  let next = 0;
  return Array.from(order, slot => slot ?? remaining[next++]);
}

export function drawOrderOffsets(setup: string[], order: string[]): SlotOffset[] {
  const positions = new Map(order.map((name, i) => [name, i]));
  return setup.map((slot, i) => ({ slot, offset: positions.get(slot)! - i })).filter(o => o.offset !== 0);
}
