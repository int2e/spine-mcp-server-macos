/**
 * 配置管理器：统一管理 SPINE_EXE、日志级别、超时等配置，消除硬编码。
 * 加载优先级：.env 文件 < 进程环境变量 < 显式传入
 */
import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";
import * as dotenv from "dotenv";
import { ErrorCode, SpineError } from "./utils/error-codes";
import { configureLogger, logger } from "./logger";
import { LogLevel, DEFAULT_CLI_TIMEOUT_MS, DEFAULT_LOG_LEVEL, MAC_SPINE_VERSION, LEGACY_SPINE_VERSION, SPINE_EXE_NAME } from "./constants";

/** 运行时配置 */
export interface Config {
  /** Spine 命令行工具绝对路径 */
  spineExe: string;
  spineVersion?: string;
  /** 日志级别 */
  logLevel: LogLevel;
  /** CLI 超时（毫秒） */
  cliTimeoutMs: number;
  /** Cocos 项目工作区路径（可选，Phase 6 使用） */
  cocosWorkspace?: string;
  /** 配置文件路径（如为 .env 加载则记录） */
  configSource: string;
}

/** 安装向导和服务使用相同的查找顺序。 */
export function findSpineLauncher(): string | undefined {
  const windows = process.platform === "win32";
  const candidates = windows ? [
    "D:/cocos/SpinePro3.8.75/Spine.com", "D:/cocos/Spine/Spine.com",
    path.join(process.env.ProgramFiles || "C:/Program Files", "Spine", "Spine.com"),
    "C:/Program Files (x86)/Spine/Spine.com", "C:/Spine/Spine.com", "D:/Spine/Spine.com", "E:/Spine/Spine.com",
  ] : ["/Applications", path.join(homedir(), "Applications")].flatMap(dir => [
    path.join(dir, "Spine.app/Contents/MacOS/Spine"), path.join(dir, "Spine/Spine.app/Contents/MacOS/Spine"),
  ]);
  for (const dir of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    candidates.push(path.join(dir, windows ? SPINE_EXE_NAME : "Spine"));
  }
  return candidates.find(candidate => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return fs.statSync(candidate).isFile();
    } catch { return false; }
  });
}

class ConfigManager {
  private config: Config | null = null;

  /** 加载 .env（若存在） */
  private loadDotEnv(): void {
    // 项目根目录 .env
    const projectRoot = path.resolve(__dirname, "..");
    const envPath = path.join(projectRoot, ".env");
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
    }
  }

  /** 读取并解析配置（幂等，可重复调用） */
  load(overrides: Partial<Config> = {}): Config {
    if (this.config && Object.keys(overrides).length === 0) {
      return this.config;
    }
    this.loadDotEnv();

    // 1) 确定 spineExe
    let spineExe = overrides.spineExe ?? process.env.SPINE_EXE?.trim();
    let source = "SPINE_EXE 环境变量/.env";
    if (!spineExe) {
      spineExe = findSpineLauncher();
      source = "自动检测";
    }

    if (spineExe && path.basename(spineExe).endsWith(".app")) spineExe = path.join(spineExe, "Contents/MacOS/Spine");
    const spineVersion = overrides.spineVersion ?? (process.env.SPINE_VERSION?.trim() || (process.platform === "darwin" ? MAC_SPINE_VERSION : undefined));

    // 2) 日志级别
    const rawLevel = overrides.logLevel ?? (process.env.LOG_LEVEL as LogLevel) ?? DEFAULT_LOG_LEVEL;
    const logLevel: LogLevel = (["error", "warn", "info", "debug"] as LogLevel[]).includes(rawLevel)
      ? rawLevel
      : DEFAULT_LOG_LEVEL;

    // 3) 超时
    const rawTimeout = overrides.cliTimeoutMs ?? Number(process.env.CLI_TIMEOUT_MS ?? DEFAULT_CLI_TIMEOUT_MS);
    const cliTimeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : DEFAULT_CLI_TIMEOUT_MS;

    // 4) Cocos 工作区
    const cocosWorkspace = overrides.cocosWorkspace ?? process.env.COCOS_WORKSPACE?.trim();

    this.config = {
      spineExe: spineExe ?? "",
      spineVersion,
      logLevel,
      cliTimeoutMs,
      cocosWorkspace,
      configSource: source,
    };

    // 联动日志器
    configureLogger(this.config.logLevel);
    return this.config;
  }

  /** 获取已加载配置（未加载则先加载） */
  get(): Config {
    if (!this.config) {
      return this.load();
    }
    return this.config;
  }

  /** 校验 Spine CLI 是否存在，不存在则抛 E_SPINE_NOT_FOUND */
  assertSpineExists(): Config {
    const cfg = this.get();
    if (!cfg.spineExe) {
      throw new SpineError(
        ErrorCode.SPINE_NOT_FOUND,
        "未找到 Spine 启动器。请设置 SPINE_EXE 指向 Spine.app 或 Spine.com。",
        "可在项目根目录复制 .env.example 为 .env 并填写 SPINE_EXE。"
      );
    }
    if (!fs.existsSync(cfg.spineExe)) {
      throw new SpineError(
        ErrorCode.SPINE_NOT_FOUND,
        `配置的 SPINE_EXE 路径不存在：${cfg.spineExe}`,
        "请检查路径是否正确，或使用安装向导自动检测。"
      );
    }
    return cfg;
  }

  /** 打印当前配置摘要（check 命令使用） */
  summarize(): string {
    const cfg = this.assertSpineExists();
    const lines = [
      `Spine CLI : ${cfg.spineExe}  (来源: ${cfg.configSource})`,
      `编辑器版本: ${cfg.spineVersion ?? "启动器默认版本"}`,
      `日志级别  : ${cfg.logLevel}`,
      `CLI 超时  : ${cfg.cliTimeoutMs} ms`,
    ];
    if (cfg.cocosWorkspace) {
      lines.push(`Cocos 工作区: ${cfg.cocosWorkspace}`);
    }
    return lines.join("\n");
  }
}

/** 全局单例 */
export const configManager = new ConfigManager();

/** 新建 JSON 使用当前配置的编辑器格式。 */
export function newSkeletonVersion(): string {
  return configManager.get().spineVersion ?? LEGACY_SPINE_VERSION;
}
