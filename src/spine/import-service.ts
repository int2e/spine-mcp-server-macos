import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { configManager } from "../config-manager";
import { isSpine43 } from "../constants";
import { cliExecutor } from "./cli-executor";
import { getProjectInfo, getSkeletonName } from "./info-service";
import { ImportOptions } from "../types";
import { ErrorCode, SpineError } from "../utils/error-codes";
import { backupFile } from "../utils/file-utils";

export interface ImportResult {
  projectPath: string;
  backupPath?: string;
  skeletonName: string;
}

/** Detect edits made while the export, mutation and import were running. */
export function projectRevision(projectPath: string): string | undefined {
  const st = fs.statSync(projectPath, { bigint: true, throwIfNoEntry: false });
  return st && `${st.ino}:${st.size}:${st.mtimeNs}:${st.ctimeNs}`;
}

async function editorVersion(): Promise<string> {
  const pinned = configManager.get().spineVersion;
  if (pinned) return pinned;
  const output = await cliExecutor.execToString(["--version"]);
  const match = output.match(/^Spine (\d+\.\d+\.\d+(?:-beta)?)(?:\s|$)/im)
    ?? output.match(/^Spine Launcher (3\.8\.\d+)(?:\s|$)/im);
  if (!match) throw new SpineError(ErrorCode.CLI_EXEC_FAILED, "无法识别编辑器版本，请设置 SPINE_VERSION。");
  return match[1];
}

export async function importJson(
  projectPath: string, jsonPath: string, options: ImportOptions = {},
  roundTrip?: { revision: string; animationNames?: string[] },
): Promise<ImportResult> {
  if (!fs.existsSync(jsonPath)) throw new SpineError(ErrorCode.INVALID_ARGUMENT, `文件不存在：${jsonPath}`);
  const expectedRevision = roundTrip?.revision ?? projectRevision(projectPath);
  const animationNames = roundTrip?.animationNames;
  const exists = expectedRevision !== undefined;
  const name = options.skeletonName ?? (exists ? await getSkeletonName(projectPath) : undefined);
  if (!name) throw new SpineError(ErrorCode.INVALID_ARGUMENT, "创建项目时请提供 skeletonName。");
  const version = await editorVersion();
  const modern = isSpine43(version);
  if (exists) {
    const info = await getProjectInfo(projectPath);
    if (info.version.split(".").slice(0, 2).join(".") !== version.split(".").slice(0, 2).join(".")) {
      throw new SpineError(ErrorCode.INVALID_ARGUMENT, `工程版本 ${info.version} 与编辑器 ${version} 不匹配，请指定 SPINE_VERSION=${info.version}。`);
    }
  }
  // Stage beside the destination so relative image/audio paths and the filesystem stay the same.
  const staged = path.join(path.dirname(projectPath), `.spine-mcp-${randomUUID()}.spine`);
  try {
    // A 3.8 round-trip needs a new output file. A normal import needs the existing project.
    if (exists && (modern || !roundTrip)) fs.copyFileSync(projectPath, staged, fs.constants.COPYFILE_EXCL);
    const args = ["-i", jsonPath, "-o", staged];
    if (modern) {
      args.push("--to", name);
      for (const animation of animationNames ?? []) args.push("-a", animation);
      if (exists) args.push("--replace");
      args.push("-r");
    } else {
      args.push("-r", name);
    }
    const run = await cliExecutor.exec({ args });
    if (modern && animationNames) {
      const imported = new Set([...run.stdout.matchAll(/^Imported animation:\s*(.+)$/gmi)].map(m => m[1].trim()));
      const warning = (run.stdout + "\n" + run.stderr).split(/\r?\n/).find(line => /^\s*WARN(?:ING)?[: ]/i.test(line));
      if (warning || animationNames.some(animation => !imported.has(animation))) {
        throw new SpineError(ErrorCode.CLI_EXEC_FAILED, warning ?? "Spine 未确认导入所请求的动画。");
      }
    }
    if (!fs.statSync(staged, { throwIfNoEntry: false })?.size) {
      throw new SpineError(ErrorCode.CLI_EXEC_FAILED, "Spine 没有生成导入后的项目。");
    }
    if (projectRevision(projectPath) !== expectedRevision) {
      throw new SpineError(ErrorCode.INVALID_ARGUMENT, "工程在操作期间已修改，请重新读取后重试。");
    }
    const backupPath = exists && options.backup !== false ? backupFile(projectPath) : undefined;
    fs.renameSync(staged, projectPath);
    return { projectPath, backupPath, skeletonName: name };
  } finally {
    fs.rmSync(staged, { force: true });
  }
}

export async function importJsonInPlace(projectPath: string, jsonPath: string, skeletonName?: string): Promise<ImportResult> {
  const revision = projectRevision(projectPath);
  if (revision === undefined) throw new SpineError(ErrorCode.INVALID_ARGUMENT, `目标项目不存在：${projectPath}`);
  return importJson(projectPath, jsonPath, { skeletonName }, { revision });
}
