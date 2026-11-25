/**
 * 修改服务：封装「导出 → 修改 JSON → 原地导入替换」的标准 Round-Trip 流程。
 * 所有修改类工具（control_bone/rename/set_attachment 等）复用此服务。
 */
import * as path from "path";
import { exportProject } from "./export-service";
import { isDeepStrictEqual } from "util";
import { isSpine43 } from "../constants";
import { importJson, projectRevision } from "./import-service";
import { getProjectInfo } from "./info-service";
import { readJsonFile, writeJsonFile, createTempDir, removeDir, ensureDir } from "../utils/file-utils";
import { ErrorCode, SpineError } from "../utils/error-codes";
import { validateJsonReferences } from "./validate-service";

export interface ModifyResult {
  /** 备份文件路径 */
  backupPath?: string;
  /** 骨架名 */
  skeletonName: string;
  /** fps（Info 命令） */
  fps: number;
  /** 修改后自动引用校验发现的问题（空数组 = 无问题） */
  warnings: string[];
}

/** Keep the attachments the temporary animation source actually needs. Large projects can have
 * tens of thousands of attachments which the editor would otherwise re-import for a single key. */
export function prepareAnimationImport(json: any, names: string[]): void {
  const selected = new Set(names);
  for (const c of json.constraints ?? []) if (c.type === "slider" && c.animation) selected.add(c.animation);
  json.animations = Object.fromEntries([...selected].map(name => [name, json.animations[name]]));
  if (!json.skins) return;
  const skins: Map<string, any> = new Map(json.skins.map((s: any) => [s.name, s]));
  const kept = new Map<string, Record<string, Record<string, any>>>();
  function keep(skin: string, slot: string, name: string | undefined): void {
    if (!name) return;
    const attachment = skins.get(skin)?.attachments?.[slot]?.[name];
    if (!attachment) return;
    if (!kept.has(skin)) kept.set(skin, Object.create(null));
    const entries = (kept.get(skin)![slot] ??= Object.create(null));
    if (Object.hasOwn(entries, name)) return;
    entries[name] = attachment;
    if (attachment.source) keep(attachment.skin || "default", attachment.slot || slot, attachment.source);
  }
  for (const skin of skins.keys()) {
    for (const slot of json.slots ?? []) keep(skin, slot.name, slot.attachment);
    for (const anim of Object.values<any>(json.animations)) {
      for (const [slot, tl] of Object.entries<any>(anim.slots ?? {})) {
        for (const frame of tl.attachment ?? []) keep(skin, slot, frame.name);
      }
      for (const [slot, entries] of Object.entries<any>(anim.attachments?.[skin] ?? {})) {
        for (const name of Object.keys(entries)) keep(skin, slot, name);
      }
    }
  }
  for (const [name, skin] of skins) skin.attachments = kept.get(name) ?? {};
}

/**
 * 对 .spine 项目执行一次 Round-Trip 修改。
 * @param projectPath  .spine 项目
 * @param modifyFn     修改函数，接收解析后的 JSON 对象，直接原地修改
 * @param skeletonName 骨架名（可选，自动获取）
 */
export async function modifyProject(
  projectPath: string,
  modifyFn: (json: any) => void,
  skeletonName?: string
): Promise<ModifyResult> {
  const revision = projectRevision(projectPath);
  if (revision === undefined) {
    throw new SpineError(ErrorCode.INVALID_ARGUMENT, `项目文件不存在：${projectPath}`);
  }
  const tempDir = createTempDir("spine-modify-");
  try {
    const info = await getProjectInfo(projectPath);
    const name = skeletonName ?? info.skeletonName;
    const files = (await exportProject(projectPath, tempDir, { format: "json", exportAll: isSpine43(info.version) })).filter(f => f.endsWith(".json"));
    const jsonFile = files.find(f => path.basename(f, ".json") === name) ?? (files.length === 1 ? files[0] : undefined);
    if (!jsonFile || !name) throw new SpineError(ErrorCode.CLI_EXEC_FAILED, `无法定位骨架 ${name} 的导出 JSON。`);
    const json = readJsonFile(jsonFile);
    modifyFn(json);
    const warnings = validateJsonReferences(json);
    const result = { skeletonName: name, fps: info.fps || 30, warnings };
    let animationNames: string[] | undefined;
    if (isSpine43(json.skeleton?.spine)) {
      // 4.3 can import individual animations, preserving editor-only data in the existing skeleton.
      const { animations: before = {}, ...oldSetup } = readJsonFile(jsonFile);
      const { animations: after = {}, ...newSetup } = json;
      if (isDeepStrictEqual(oldSetup, newSetup) && Object.keys(before).every(key => Object.hasOwn(after, key))) {
        animationNames = Object.keys(after).filter(key => !isDeepStrictEqual(before[key], after[key]));
        if (!animationNames.length) return result;
        prepareAnimationImport(json, animationNames);
      }
    }
    writeJsonFile(jsonFile, json, false);
    const imported = await importJson(projectPath, jsonFile, { skeletonName: name }, { revision, animationNames });
    return { ...result, backupPath: imported.backupPath };
  } finally {
    removeDir(tempDir);
  }
}

/** 便捷：导出项目 JSON 并读取为对象（只读工具用，自动清理临时目录） */
export async function readJsonForExport(projectPath: string, skeletonName?: string): Promise<any> {
  const tempDir = createTempDir("spine-read-");
  const exportDir = path.join(tempDir, "export");
  ensureDir(exportDir);
  try {
    const files = await exportProject(projectPath, exportDir, { format: "json" });
    const jsonFiles = files.filter(f => f.endsWith(".json"));
    const name = skeletonName ?? (jsonFiles.length > 1 ? (await getProjectInfo(projectPath)).skeletonName : undefined);
    const jsonFile = name ? jsonFiles.find(f => path.basename(f, ".json") === name) ?? (jsonFiles.length === 1 ? jsonFiles[0] : undefined) : jsonFiles[0];
    if (!jsonFile) {
      throw new SpineError(ErrorCode.CLI_EXEC_FAILED, "导出未产生 JSON 文件。");
    }
    return readJsonFile(jsonFile);
  } finally {
    removeDir(tempDir);
  }
}

/** 便捷：获取 fps（供 frameToTime 使用） */
export async function getFps(projectPath: string): Promise<number> {
  const info = await getProjectInfo(projectPath);
  return info.fps || 30;
}
