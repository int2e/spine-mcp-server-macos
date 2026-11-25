#!/usr/bin/env node
/**
 * spine-mcp-server 入口（Phase 1 基础设施 + Phase 2 核心封装自测）
 *
 * 子命令（Phase 2 自测用；MCP 服务器将在 Phase 3 接入）：
 *   check                       —— 校验 Spine CLI 并显示配置摘要
 *   info <path>                 —— 对项目执行 Info 命令并显示输出
 *   version <path>              —— 检测项目版本（版本兼容提示）
 *   reader <json>               —— 解析导出 JSON，显示结构化项目信息
 *   export <spine> <outdir> [json|binary|texture|video]
 *                               —— 测试导出
 *   import <spine> <json>       —— 测试导入（自动备份 + -r 导入）
 *   clean <spine>               —— 测试 -m 清理（复制到临时文件后执行）
 *   roundtrip <spine> <outdir>  —— 完整往返：导出→改骨骼帧→导入→验证
 *   help                        —— 显示帮助
 *
 * 用法：`node dist/index.js <command> [args]`
 */
import { configManager } from "./config-manager";
import { logger } from "./logger";
import { cliExecutor } from "./spine/cli-executor";
import { versionValidator } from "./spine/version-validator";
import { getProjectInfo } from "./spine/info-service";
import { readProjectJson } from "./spine/project-reader";
import { exportProject } from "./spine/export-service";
import { modifyProject, readJsonForExport } from "./spine/modify-service";
import { importJson } from "./spine/import-service";
import { cleanProject } from "./spine/cleanup-service";
import { findBone, updateBoneKeyframe } from "./spine/json-handler";
import { toSpineError } from "./utils/error-codes";
import { createTempDir, removeDir, ensureDir } from "./utils/file-utils";
import { startMcpServer } from "./server";

const HELP_TEXT = `
spine-mcp-server — Spine 3.8.x / 4.3.x MCP 服务器

用法:
  node dist/index.js <command> [args]

命令:
  check               校验 Spine CLI 并显示配置摘要
  info <path>         对 .spine 项目执行 Info 命令（版本/骨骼/插槽/动画）
  version <path>      检测 .spine 或 .json 文件的 Spine 版本
  reader <json>       解析导出 JSON，显示结构化项目信息
  export <spine> <outdir> [json|binary|texture|video]  测试导出
  import <spine> <json>          测试导入（自动备份 + -r 导入）
  clean <spine>       测试 -m 清理（在临时副本上执行）
  roundtrip <spine> <outdir>     完整往返：导出→改骨骼帧→导入→验证
  mcp                         启动 MCP stdio 服务器（供 Trae/Cursor 等 AI 客户端连接）
  help                        显示本帮助

环境变量（见 .env.example）:
  SPINE_EXE            Spine 命令行工具路径
  SPINE_VERSION        固定编辑器版本，例如 4.3.26
  LOG_LEVEL            error|warn|info|debug
  CLI_TIMEOUT_MS       CLI 执行超时（毫秒）
`;

/** check 命令：校验环境 */
async function cmdCheck(): Promise<void> {
  configManager.assertSpineExists();
  logger.info("✅ Spine CLI 校验通过");
  console.log(configManager.summarize());

  // 探测 CLI 版本
  try {
    const out = await cliExecutor.execToString(["--version"]);
    logger.info(`CLI --version 输出:\n${out}`);
  } catch (err) {
    // --version 可能不受支持，降级提示
    logger.warn(`--version 探测失败: ${toSpineError(err).message}`);
  }
}

/** info 命令：Info 命令输出 */
async function cmdInfo(filePath: string): Promise<void> {
  const out = await cliExecutor.execToString(["-i", filePath]);
  console.log(out);
}

/** version 命令：检测版本 */
async function cmdVersion(filePath: string): Promise<void> {
  const result = await versionValidator.detect(filePath);
  console.log(`文件     : ${filePath}`);
  console.log(`版本     : ${result.version}`);
  console.log(`目标版本 : ${result.isSupported ? "支持" : "尚未适配"}`);
  if (result.warning) {
    console.log(`警告     : ${result.warning}`);
  }
}

/** reader 命令：解析导出 JSON 显示结构化信息 */
async function cmdReader(jsonPath: string): Promise<void> {
  const info = readProjectJson(jsonPath);
  console.log(`版本     : ${info.version}`);
  console.log(`骨骼     : ${info.bones.length} 个`);
  console.log(`插槽     : ${info.slots.length} 个`);
  console.log(`皮肤     : ${info.skins.map((s) => s.name).join(", ") || "无"}`);
  console.log(`动画     : ${info.animations.map((a) => `${a.name}(${a.duration.toFixed(2)}s/${a.keyframeCount}帧)`).join(", ") || "无"}`);
  console.log(`事件     : ${info.events.join(", ") || "无"}`);
  if (info.compatibilityWarning) {
    console.log(`警告     : ${info.compatibilityWarning}`);
  }
}

/** export 命令：测试导出 */
async function cmdExport(spinePath: string, outDir: string, format: string): Promise<void> {
  ensureDir(outDir);
  const files = await exportProject(spinePath, outDir, { format: format as any });
  console.log(`导出完成 : ${files.length} 个文件`);
  files.forEach((f) => console.log(`  - ${f}`));
}

/** import 命令：测试导入 */
async function cmdImport(spinePath: string, jsonPath: string, skeletonName?: string): Promise<void> {
  const result = await importJson(spinePath, jsonPath, { skeletonName });
  console.log(`导入成功 : ${result.projectPath}`);
  console.log(`骨架名   : ${result.skeletonName}`);
  if (result.backupPath) {
    console.log(`备份     : ${result.backupPath}`);
  }
}

/** clean 命令：在临时副本上测试 -m 清理（避免破坏原项目） */
async function cmdClean(spinePath: string): Promise<void> {
  const fs = require("fs");
  const path = require("path");
  const tempDir = createTempDir("spine-clean-");
  const copyPath = path.join(tempDir, path.basename(spinePath));
  fs.copyFileSync(spinePath, copyPath);
  try {
    const result = await cleanProject(copyPath);
    console.log(`清理完成 : 骨架 ${result.skeletonName}，移除 ${result.removedKeys} 个未使用关键帧`);
    console.log(`（已在临时副本上执行，原项目未改动）`);
  } finally {
    removeDir(tempDir);
  }
}

/** roundtrip 命令：导出 → 修改骨骼关键帧 → 导入 → 验证（在临时副本上执行，不动原项目） */
async function cmdRoundtrip(spinePath: string, outDir: string): Promise<void> {
  const fs = require("fs");
  const path = require("path");
  const tempDir = fs.mkdtempSync(path.join(ensureDir(outDir), ".spine-roundtrip-"));
  try {
    const copy = path.join(tempDir, path.basename(spinePath));
    fs.copyFileSync(spinePath, copy);
    const info = await getProjectInfo(copy);
    const animation = info.animations[0], bone = info.bones[0];
    if (!animation || !bone) throw new Error("验证往返需要至少一个动画和一根骨骼。");
    let expected = 0;
    await modifyProject(copy, json => {
      expected = (findBone(json, bone)?.rotation ?? 0) + 10;
      updateBoneKeyframe(json, animation, bone, 0, { rotation: expected });
    });
    const data = await readJsonForExport(copy, info.skeletonName);
    const frames = data.animations?.[animation]?.bones?.[bone]?.rotate ?? [];
    const first = frames.find((frame: any) => (frame.time ?? 0) === 0);
    if (!first || Math.abs((first.value ?? first.angle ?? 0) - expected) > 1e-5) {
      throw new Error(`动画 ${animation} 骨骼 ${bone} 的第 0 帧回读失败。`);
    }
    console.log(`回读成功：${animation} / ${bone} 第 0 帧旋转 ${expected}°`);
  } finally {
    removeDir(tempDir);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? "help";

  // 先加载配置（若 SPINE_EXE 缺失，check/其余命令会给出友好错误）
  try {
    configManager.load();
  } catch (err) {
    logger.error(toSpineError(err).toFriendlyString());
    process.exit(1);
  }

  try {
    switch (command) {
      case "check":
        await cmdCheck();
        break;
      case "info":
        requireArg(args, 1, "info <path>");
        await cmdInfo(args[1]);
        break;
      case "version":
        requireArg(args, 1, "version <path>");
        await cmdVersion(args[1]);
        break;
      case "reader":
        requireArg(args, 1, "reader <json>");
        await cmdReader(args[1]);
        break;
      case "export":
        requireArg(args, 2, "export <spine> <outdir> [format]");
        await cmdExport(args[1], args[2], args[3] ?? "json");
        break;
      case "import":
        requireArg(args, 2, "import <spine> <json> [skeletonName]");
        await cmdImport(args[1], args[2], args[3]);
        break;
      case "clean":
        requireArg(args, 1, "clean <spine>");
        await cmdClean(args[1]);
        break;
      case "roundtrip":
        requireArg(args, 2, "roundtrip <spine> <outdir>");
        await cmdRoundtrip(args[1], args[2]);
        break;
      case "mcp":
        // 启动 MCP stdio 服务器（长驻进程）
        await startMcpServer();
        break;
      case "help":
      case "-h":
      case "--help":
        console.log(HELP_TEXT);
        break;
      default:
        logger.error(`未知命令：${command}`);
        console.log(HELP_TEXT);
        process.exit(1);
    }
  } catch (err) {
    const spineErr = toSpineError(err);
    logger.error(spineErr.toFriendlyString());
    process.exit(1);
  }
}

/** 参数数量校验 */
function requireArg(args: string[], index: number, usage: string): void {
  if (!args[index]) {
    logger.error(`缺少参数：${usage}`);
    console.log(HELP_TEXT);
    process.exit(1);
  }
}

// 仅在直接作为入口运行时执行（避免被测试框架引入时误执行）
if (require.main === module) {
  main();
}
