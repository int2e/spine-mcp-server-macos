// Requires an activated Spine 4.3 editor. All writes go to a new temporary project.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { exportJson } from '../dist/spine/export-service.js';
import { cliExecutor } from '../dist/spine/cli-executor.js';

const version = process.env.SPINE_VERSION || '4.3.26';
process.env.SPINE_VERSION = version;

test('Spine 4.3 MCP reads, imports, edits and exports a multi-skeleton project', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'Spine 4.3 MCP '));
  const projectPath = path.join(dir, 'Character test.spine');
  const jsonPath = path.join(dir, 'source.json');
  const client = new Client({ name: 'spine-integration', version: '1' });
  const env = { SPINE_VERSION: version };
  if (process.env.SPINE_EXE) env.SPINE_EXE = process.env.SPINE_EXE;
  const server = fileURLToPath(new URL('../dist/index.js', import.meta.url));
  async function call(name, args) {
    const res = await client.callTool({ name, arguments: args }, undefined, { timeout: 180000 });
    assert.ok(!res.isError, `${name} ${res.content[0].text}`);
    return res.content[0].text;
  }
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [server, 'mcp'], env, stderr: 'ignore' }));
    assert.ok((await client.listTools()).tools.some(t => t.name === 'spine_control_bone'));
    fs.writeFileSync(jsonPath, JSON.stringify({ skeleton: { spine: version, images: './images/' },
      bones: [{ name: 'root' }, { name: 'arm', parent: 'root' }],
      animations: { idle: { bones: { arm: { rotate: [{}, { time: 1, value: 20 }] } } } } }));
    await call('spine_import_animation', { projectPath, jsonPath, skeletonName: 'Hero Rig' });
    await cliExecutor.exec({ args: ['-i', jsonPath, '-o', projectPath, '--to', 'Other', '-r'] });
    assert.match(await call('spine_get_project_info', { projectPath }), /Hero Rig/);
    const before = fs.readFileSync(projectPath);
    await call('spine_control_bone', { projectPath, animationName: 'idle', boneName: 'arm', frameIndex: 0, rotation: 37 });
    assert.ok(fs.readdirSync(dir).filter(f => f.endsWith('.bak')).some(f => before.equals(fs.readFileSync(path.join(dir, f)))));
    await call('spine_pose_to_animation', { projectPath, animationName: 'wave', poses: [
      { time: 0, bones: { arm: { rotation: -15, x: 1, y: 2 } } },
      { time: 1, bones: { arm: { rotation: 30, x: 3, y: 4 } } },
    ] });
    await call('spine_set_bone', { projectPath, boneName: 'arm', length: 18 });
    const files = await exportJson(projectPath, path.join(dir, 'verify'));
    const read = name => JSON.parse(fs.readFileSync(files.find(f => path.basename(f) === name + '.json')));
    const hero = read('Hero Rig'), other = read('Other');
    assert.equal(hero.skeleton.spine, version);
    assert.equal(hero.bones.find(b => b.name === 'arm').length, 18);
    assert.equal(hero.animations.idle.bones.arm.rotate[0].value, 37);
    assert.equal(hero.animations.wave.bones.arm.rotate.at(-1).value, 30);
    assert.equal(hero.animations.wave.bones.arm.translate[0].curve.length, 8);
    assert.equal(other.animations.idle.bones.arm.rotate[0].value ?? 0, 0);
    assert.deepEqual(Object.keys(other.animations), ['idle']);
    assert.equal(other.bones.find(b => b.name === 'arm').length ?? 0, 0);
    const lastGood = fs.readFileSync(projectPath);
    fs.writeFileSync(jsonPath, '{invalid json');
    const failed = await client.callTool({ name: 'spine_import_animation', arguments: { projectPath, jsonPath, skeletonName: 'Hero Rig' } });
    assert.equal(failed.isError, true);
    assert.deepEqual(fs.readFileSync(projectPath), lastGood);
    assert.ok(!fs.readdirSync(dir).some(f => f.startsWith('.spine-mcp-')));
  } finally {
    await client.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
