/**
 * 官方 Spine runtime 渲染器（spine-ts 3.8 canvas bundle + node-canvas）
 *
 * 与自研软件光栅化（render-service.ts）不同，本渲染器使用 Esoteric 官方算法：
 * IK 约束、权重蒙皮、曲线插值、FFD 变形、混合模式全部与游戏内一致 —— 预览即所见即所得。
 *
 * 依赖：vendor/spine-ts/spine-canvas.js（官方 bundle，已内嵌 spine-core）+ node-canvas。
 * 在无法加载 node-canvas 的环境（如 Cocos 扩展 Electron 主进程）会抛错，调用方应回退自研渲染。
 */
declare const require: any;

import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";
import { unpremultiply } from "./atlas-utils";
import { uses43 } from "./format";

let spine: any = null;
let canvasMod: any = null;

/** 加载 spine-ts canvas bundle（全局脚本，挂到 globalThis.spine），只加载一次 */
function getSpine(): any {
  if (spine) return spine;
  const bundle = path.join(__dirname, "..", "..", "vendor", "spine-ts", "spine-canvas.js");
  if (!fs.existsSync(bundle)) throw new Error(`spine-ts bundle 不存在：${bundle}`);
  const vm = require("vm");
  vm.runInThisContext(fs.readFileSync(bundle, "utf8"), { filename: "spine-canvas.js" });
  spine = (globalThis as any).spine;
  if (!spine || !spine.canvas || !spine.canvas.SkeletonRenderer) {
    throw new Error("spine-ts canvas bundle 加载失败（缺少 spine.canvas.SkeletonRenderer）");
  }
  return spine;
}

/** 加载 node-canvas */
function getCanvas(): any {
  if (canvasMod) return canvasMod;
  try {
    canvasMod = require("canvas");
  } catch (e) {
    throw new Error("无法加载 node-canvas（官方渲染依赖）：" + ((e as Error).message || String(e)));
  }
  return canvasMod;
}

/** 官方渲染是否可用（环境具备 spine bundle + node-canvas） */
export function isRuntimeRenderAvailable(): boolean {
  try {
    getSpine();
    getCanvas();
    return true;
  } catch {
    return false;
  }
}

function loadImage(canvas: any, src: Buffer): Promise<any> {
  return new Promise((resolve, reject) => {
    const img = new canvas.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图集图片加载失败"));
    img.src = src;
  });
}

export interface RuntimeFrameOptions {
  skeletonJsonPath: string;
  atlasPath: string;
  imagePath: string;
  animationName?: string;
  time?: number;
  width?: number;
  height?: number;
  /** 是否叠加骨骼线框 + 关节点（便于 AI 核对绑骨/枢轴） */
  wireframe?: boolean;
}

export interface RuntimeFrameResult {
  width: number;
  height: number;
  rgba: Buffer;
  animationName: string;
  time: number;
}

/** Canvas expects straight RGBA. Spine packs can contain premultiplied atlas pages. */
async function pageImage(canvas: any, file: string, pma: boolean): Promise<any> {
  if (!pma) return loadImage(canvas, fs.readFileSync(file));
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  unpremultiply(data);
  const page = canvas.createCanvas(info.width, info.height);
  const ctx = page.getContext("2d");
  const pixels = ctx.createImageData(info.width, info.height);
  pixels.data.set(data);
  ctx.putImageData(pixels, 0, 0);
  return page;
}

/** Decode atlas pages once per render request, including a sequence or a video. */
export async function prepareRuntime(json: any, atlasText: string, imagePath: string, atlasDir = path.dirname(imagePath)) {
  const modern = uses43(json);
  const runtime: any = modern ? await import("@esotericsoftware/spine-canvas") : getSpine();
  const rendererModule = modern ? runtime : runtime.canvas;
  const canvas = getCanvas();
  let atlas;
  if (modern) {
    atlas = new runtime.TextureAtlas(atlasText);
    for (const [i, page] of atlas.pages.entries()) {
      const file = i === 0 ? imagePath : path.join(atlasDir, page.name);
      page.setTexture(new rendererModule.CanvasTexture(await pageImage(canvas, file, page.pma)));
    }
  } else {
    const texture = new rendererModule.CanvasTexture(await loadImage(canvas, fs.readFileSync(imagePath)));
    atlas = new runtime.TextureAtlas(atlasText, () => texture);
  }
  const reader = new runtime.SkeletonJson(new runtime.AtlasAttachmentLoader(atlas));
  const data = reader.readSkeletonData(json);
  return (opts: Pick<RuntimeFrameOptions, "time" | "width" | "height" | "animationName" | "wireframe">): RuntimeFrameResult => {
    const skeleton = new runtime.Skeleton(data);
    const state = new runtime.AnimationState(new runtime.AnimationStateData(data));
    const animationName = opts.animationName ?? data.animations[0]?.name ?? "";
    const time = opts.time ?? 0;
    if (animationName) state.setAnimation(0, animationName, false);
    state.update(time);
    state.apply(skeleton);
    if (modern) skeleton.update(time);
    skeleton.updateWorldTransform(modern ? runtime.Physics.update : undefined);
    const pose = (bone: any) => modern ? bone.appliedPose : bone;
    const bones = skeleton.bones.map(pose);
    let minX = Math.min(...bones.map((b: any) => b.worldX)), maxX = Math.max(...bones.map((b: any) => b.worldX));
    let minY = Math.min(...bones.map((b: any) => b.worldY)), maxY = Math.max(...bones.map((b: any) => b.worldY));
    if (modern) {
      const bounds = skeleton.getBoundsRect();
      if (Number.isFinite(bounds.width) && bounds.width > 0) {
        minX = bounds.x; minY = bounds.y; maxX = minX + bounds.width; maxY = minY + bounds.height;
      }
    }
    const width = opts.width || 512, height = opts.height || 512;
    const ctx = canvas.createCanvas(width, height).getContext("2d");
    const scale = Math.min(width * 0.8 / Math.max(1, maxX - minX), height * 0.8 / Math.max(1, maxY - minY));
    ctx.translate(width / 2, height / 2);
    ctx.scale(scale, -scale);
    ctx.translate(-(minX + maxX) / 2, -(minY + maxY) / 2);
    const renderer = new rendererModule.SkeletonRenderer(ctx);
    if (modern) renderer.triangleRendering = true;
    renderer.draw(skeleton);
    if (opts.wireframe) {
      ctx.strokeStyle = "rgba(255,90,60,0.95)";
      ctx.lineWidth = 1.5 / scale;
      ctx.fillStyle = "rgba(120,200,255,0.95)";
      for (const bone of skeleton.bones) {
        const b = pose(bone);
        if (bone.parent) {
          ctx.beginPath();
          ctx.moveTo(pose(bone.parent).worldX, pose(bone.parent).worldY);
          ctx.lineTo(b.worldX, b.worldY);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(b.worldX, b.worldY, 3.5 / scale, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return { width, height, rgba: Buffer.from(ctx.getImageData(0, 0, width, height).data), animationName, time };
  };
}

export async function renderRuntimeFrame(opts: RuntimeFrameOptions): Promise<RuntimeFrameResult> {
  const json = JSON.parse(fs.readFileSync(opts.skeletonJsonPath, "utf8"));
  const render = await prepareRuntime(json, fs.readFileSync(opts.atlasPath, "utf8"), opts.imagePath, path.dirname(opts.atlasPath));
  return render(opts);
}

/** 渲染单帧并写入 PNG 文件 */
export async function renderRuntimeFrameToPng(
  opts: RuntimeFrameOptions & { outputPath: string }
): Promise<{ width: number; height: number; animationName: string; time: number }> {
  const frame = await renderRuntimeFrame(opts);
  const canvas = getCanvas();
  const c = canvas.createCanvas(frame.width, frame.height);
  const ctx = c.getContext("2d");
  ctx.putImageData(new canvas.ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height), 0, 0);
  fs.writeFileSync(opts.outputPath, c.toBuffer("image/png"));
  return { width: frame.width, height: frame.height, animationName: frame.animationName, time: frame.time };
}
