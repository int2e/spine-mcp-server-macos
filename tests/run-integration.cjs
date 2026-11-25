// The original 3.8 integration fixtures belong to the Windows example installation.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { configManager } = require('../dist/config-manager.js');
const { isSpine43 } = require('../dist/constants.js');

const tests = isSpine43(configManager.get().spineVersion) ? ['spine43-integration.mjs'] : [
  'self-test-tools.cjs',
  'self-test-p4.cjs',
  'self-test-p5.cjs',
  'self-test-cut-assemble.cjs',
  'self-test-generate-anim.cjs',
  'self-test-visualize.cjs',
  'self-test-effects.cjs',
  'self-test-mirror-skin-wave.cjs',
  'self-test-pipeline-plus.cjs',
  'self-test-render.cjs',
  'self-test-mcp.cjs',
  'self-test-extension.cjs',
];
for (const script of tests) {
  const run = spawnSync(process.execPath, [path.join(__dirname, script)], { stdio: 'inherit' });
  if (run.error) throw run.error;
  if (run.status !== 0) process.exit(run.status ?? 1);
}
