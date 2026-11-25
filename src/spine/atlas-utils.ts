/**
 * Atlas 解析工具：解析 Spine .atlas 文本格式，提供 region 提取。
 * Spine 3.8 .atlas 文本格式：
 *   <页名>
 *   size: W,H
 *   format: RGBA8888
 *   filter: ...
 *   repeat: none
 *   <region名>
 *   rotate: true|false
 *   xy: X,Y
 *   size: W,H
 *   orig: OW,OH
 *   offset: OX,OY
 *   index: N
 */
export interface AtlasPage {
  name: string;
  size: { w: number; h: number };
  format?: string;
  filter?: string;
  repeat?: string;
  pma?: boolean;
}

export interface AtlasRegion {
  name: string;
  page: number;
  rotate: boolean;
  degrees?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  origWidth: number;
  origHeight: number;
  offsetX: number;
  offsetY: number;
  index: number;
}

export interface ParsedAtlas {
  pages: AtlasPage[];
  regions: AtlasRegion[];
  raw: string;
}

/** 解析 .atlas 文本 */
export function parseAtlas(text: string): ParsedAtlas {
  const pages: AtlasPage[] = [], regions: AtlasRegion[] = [];
  let page: AtlasPage | undefined, region: AtlasRegion | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { page = undefined; region = undefined; continue; }
    const colon = line.indexOf(":");
    if (colon < 0) {
      if (!page) {
        page = { name: line, size: { w: 0, h: 0 } };
        pages.push(page);
      } else {
        region = { name: line, page: pages.length - 1, rotate: false, x: 0, y: 0, width: 0, height: 0,
          origWidth: 0, origHeight: 0, offsetX: 0, offsetY: 0, index: -1 };
        regions.push(region);
      }
      continue;
    }
    const key = line.slice(0, colon).trim(), value = line.slice(colon + 1).trim();
    const nums = value.split(",").map(Number);
    if (region) {
      switch (key) {
        case "bounds": [region.x, region.y, region.width, region.height] = nums; break;
        case "offsets": [region.offsetX, region.offsetY, region.origWidth, region.origHeight] = nums; break;
        case "xy": [region.x, region.y] = nums; break;
        case "size": [region.width, region.height] = nums; break;
        case "orig": [region.origWidth, region.origHeight] = nums; break;
        case "offset": [region.offsetX, region.offsetY] = nums; break;
        case "rotate":
          region.degrees = value === "true" ? 90 : Number(value) || 0;
          region.rotate = region.degrees % 180 !== 0;
          break;
        case "index": region.index = nums[0]; break;
      }
    } else if (page) {
      if (key === "size") [page.size.w, page.size.h] = nums;
      if (key === "pma") page.pma = value === "true";
      if (key === "format" || key === "repeat" || key === "filter") page[key] = value;
    }
  }
  for (const r of regions) {
    r.origWidth ||= r.width;
    r.origHeight ||= r.height;
  }
  return { pages, regions, raw: text };
}

export function unpremultiply(data: Buffer): void {
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha === 0 || alpha === 255) continue;
    for (let channel = i; channel < i + 3; channel++) {
      data[channel] = Math.min(255, Math.round(data[channel] * 255 / alpha));
    }
  }
}

/** 查找 region（支持路径、文件名、region 子目录名匹配） */
export function findRegion(atlas: ParsedAtlas, name: string): AtlasRegion | undefined {
  const base = name.replace(/\\/g, "/");
  const fileName = base.split("/").pop();
  return atlas.regions.find(
    (r) => r.name === name || r.name === fileName || r.name === base || r.name.split("/").pop() === fileName
  );
}
