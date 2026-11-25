/**
 * 安装向导：检测 Spine / Cocos Creator 环境，生成 .env 配置。
 * 用法：node scripts/installer.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

const COCOS_CANDIDATES = process.platform === 'darwin'
  ? ['/Applications/Cocos/Creator']
  : ['C:/ProgramData/cocos/editors/Creator'];

function findCocos() {
  for (const c of COCOS_CANDIDATES) {
    if (!fs.existsSync(c)) continue;
    try {
      const vers = fs.readdirSync(c);
      if (vers.length) return path.join(c, vers[vers.length - 1]);
    } catch (e) {}
  }
  return null;
}

function findNode() {
  return process.execPath;
}

async function main() {
  console.log('========================================');
  console.log(' Spine MCP Server — 安装向导');
  console.log('========================================\n');

  // 1. 检测 Node
  const node = findNode();
  console.log(`[1/4] Node.js : ${node ? node : '未找到'}`);
  if (!node) {
    console.error('错误：需要 Node.js 20+。请先安装 Node.js。');
    process.exit(1);
  }

  // 安装依赖 + 构建
  console.log('\n正在安装依赖并构建...');
  if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
    execSync('npm ci', { cwd: ROOT, stdio: 'inherit' });
  }
  execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });

  // 2. 检测 Spine
  const { configManager } = require(path.join(ROOT, 'dist', 'config-manager.js'));
  const { spineExe: spine, spineVersion } = configManager.get();
  console.log(`[2/4] Spine   : ${spine ? spine : '⚠️ 未自动检测到，请设置 SPINE_EXE'}`);

  // 3. 检测 Cocos Creator
  const cocos = findCocos();
  console.log(`[3/4] Cocos   : ${cocos ? cocos : '⚠️ 未检测到（可选，仅面板需要）'}`);

  // 4. 写入 .env
  const envPath = path.join(ROOT, '.env');
  const envContent = [
    `# 由安装向导自动生成 ${new Date().toISOString()}`,
    `SPINE_EXE=${spine || ''}`,
    ...(spineVersion ? [`SPINE_VERSION=${spineVersion}`] : []),
    'LOG_LEVEL=info',
    `# Cocos Creator（可选）`,
    `COCOS_CREATOR=${cocos || ''}`,
  ].join('\n');
  if (!fs.existsSync(envPath)) fs.writeFileSync(envPath, envContent + '\n', { flag: 'wx' });
  console.log(`[4/4] 配置文件 ${envPath}`);

  console.log('\n========================================');
  console.log(' ✅ 安装完成！');
  console.log(' 下一步：');
  console.log('  1. 将 cocos-extension 目录安装为 Cocos Creator 扩展（扩展管理器中添加本地扩展）');
  console.log('  2. 打开面板，配置 Spine 路径并启动服务');
  console.log('  3. 复制 AI 客户端配置到 Trae / Cursor');
  console.log('========================================');
}

main().catch((e) => {
  console.error('安装失败：', e);
  process.exit(1);
});
