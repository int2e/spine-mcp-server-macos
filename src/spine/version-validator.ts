/**
 * 版本校验器：识别项目/文件的 Spine 版本。
 *
 * 实现策略（已实测验证）：
 * - .json 文件：直接读取 JSON 中的 skeleton.spine 字段
 * - .spine 项目（二进制）：调用 `Spine.com -i <path>`（Info 命令），
 *   从 stdout 解析 `Spine version: x.y.z`
 */
import * as fs from "fs";
import * as path from "path";
import { cliExecutor } from "./cli-executor";
import { logger } from "../logger";
import { isSupportedVersion, versionWarning } from "../constants";
import { ErrorCode, SpineError } from "../utils/error-codes";

/** 版本检测结果 */
export interface VersionResult {
  version: string;
  /** 文件是否为 .json（数据文件） */
  isJson: boolean;
  /** 是否为支持的版本 */
  isSupported: boolean;
  /** 若版本尚未适配，附带友好警告 */
  warning?: string;
}

/** 从 JSON 内容中提取 spine 版本 */
function versionFromJson(raw: string): string | undefined {
  try {
    const data = JSON.parse(raw);
    return data?.skeleton?.spine;
  } catch {
    return undefined;
  }
}

/** 从 Info 命令 stdout 中解析项目版本，如 `Spine version: 3.8.55` */
function versionFromInfoOutput(stdout: string): string | undefined {
  const m = stdout.match(/Spine version:\s*([0-9]+\.[0-9]+\.[0-9]+(?:\.[0-9]+)?)/i);
  if (m) {
    return m[1];
  }
  return undefined;
}

class VersionValidator {
  /**
   * 检测文件版本。
   * @param filePath .spine 项目文件或 .json 数据文件
   */
  async detect(filePath: string): Promise<VersionResult> {
    if (!fs.existsSync(filePath)) {
      throw new SpineError(
        ErrorCode.INVALID_ARGUMENT,
        `文件不存在：${filePath}`,
        "请传入有效的绝对路径。"
      );
    }
    const ext = path.extname(filePath).toLowerCase();
    const isJson = ext === ".json";
    let version: string | undefined;

    if (isJson) {
      // JSON 数据文件：直接读取
      const raw = fs.readFileSync(filePath, "utf8");
      version = versionFromJson(raw);
      if (!version) {
        // 可能是导出设置类 JSON，无 skeleton.spine
        return {
          version: "unknown",
          isJson: true,
          isSupported: false,
          warning: "该 JSON 不是 Spine 数据文件（缺少 skeleton.spine 字段）。",
        };
      }
    } else {
      // 二进制 .spine：走 Info 命令
      const stdout = await cliExecutor.execToString(["-i", filePath]);
      version = versionFromInfoOutput(stdout);
      if (!version) {
        throw new SpineError(
          ErrorCode.CLI_EXEC_FAILED,
          "无法从 Spine CLI 输出中识别版本号。",
          "请确认该文件是有效的 Spine 项目文件。"
        );
      }
    }

    const isSupported = isSupportedVersion(version);
    const warning = versionWarning(version);
    if (warning) logger.warn(warning);

    return { version, isJson, isSupported, warning };
  }

  /** 检查支持的版本系列 */
  isSupported(version: string): boolean {
    return isSupportedVersion(version);
  }
}

/** 全局单例 */
export const versionValidator = new VersionValidator();
