/**
 * Phase 8 单元测试（Node 内置 test runner，零依赖）
 * 运行：node --test tests/unit-tests.mjs
 * 覆盖：json-handler 核心函数（upsert 时间轴/约束/绘制顺序/权重网格重排/事件/曲线/动画时长）
 *      + atlas-utils 解析
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const h = require('../dist/spine/json-handler.js');
const atlas = require('../dist/spine/atlas-utils.js');

// ---------------- upsertTimelineFrame（关键帧 time=0 省略 time） ----------------
test('updateBoneKeyframe 处理 time=0 省略 time 的帧（不产生重复帧）', () => {
  const json = {
    bones: [{ name: 'head', rotation: 0 }],
    animations: { idle: { bones: { head: { rotate: [{ angle: -4.18 }] } } } },
  };
  h.updateBoneKeyframe(json, 'idle', 'head', 0, { rotation: 30 });
  const tl = json.animations.idle.bones.head.rotate;
  assert.equal(tl.length, 1, '应更新已有帧而非新增');
  assert.equal(tl[0].angle, 30);
});

test('updateBoneKeyframe 无帧时新建', () => {
  const json = { bones: [{ name: 'root', rotation: 0 }], animations: { walk: { bones: {} } } };
  h.updateBoneKeyframe(json, 'walk', 'root', 5, { rotation: 15 });
  const tl = json.animations.walk.bones.root.rotate;
  assert.equal(tl.length, 1);
  assert.equal(tl[0].time, 5);
  assert.equal(tl[0].angle, 15);
});

// ---------------- 约束 ----------------
test('addIk 设置全局唯一 order（多类型不冲突）', () => {
  const json = { bones: [{ name: 'a' }, { name: 'b' }, { name: 't' }] };
  h.addIk(json, 'ik1', ['a', 'b'], 't');
  h.addIk(json, 'ik2', ['a', 'b'], 't');
  h.addTransform(json, 'tf1', ['a'], 't');
  const ik2 = h.findConstraint(json, 'ik', 'ik2');
  const tf1 = h.findConstraint(json, 'transform', 'tf1');
  assert.equal(ik2.order, 1);
  assert.equal(tf1.order, 2, 'order 应跨类型递增');
});

test('addIk 引用不存在骨骼时报错', () => {
  const json = { bones: [{ name: 'a' }] };
  assert.throws(() => h.addIk(json, 'bad', ['a', 'ghost'], 'a'));
});

test('deleteConstraint 移除动画时间轴', () => {
  const json = {
    bones: [{ name: 'a' }, { name: 'b' }, { name: 't' }],
    ik: [{ name: 'ik1', order: 0, bones: ['a', 'b'], target: 't' }],
    animations: { idle: { ik: { ik1: [{ mix: 0 }] } } },
  };
  h.deleteConstraint(json, 'ik', 'ik1');
  assert.equal(json.ik.length, 0);
  assert.ok(!json.animations.idle.ik.ik1, '时间轴应被删除');
});

test('updateConstraintKeyframe 写约束时间轴', () => {
  const json = {
    bones: [{ name: 'a' }, { name: 'b' }, { name: 't' }],
    ik: [{ name: 'ik1', order: 0, bones: ['a', 'b'], target: 't' }],
    animations: { idle: {} },
  };
  h.updateConstraintKeyframe(json, 'ik', 'idle', 'ik1', 0.3, { mix: 0.6 });
  assert.equal(json.animations.idle.ik.ik1[0].mix, 0.6);
});

// ---------------- 绘制顺序 ----------------
test('setDrawOrder 按插槽原始顺序排序 offsets', () => {
  const json = {
    slots: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
    animations: { x: {} },
  };
  // 用户希望新顺序 [c, a, b]：c=0,a=1,b=2；按原始顺序排序后应为 a(1),b(2),c(0)
  h.setDrawOrder(json, 'x', 0.3, ['c', 'a', 'b']);
  const offsets = json.animations.x.draworder[0].offsets;
  assert.deepEqual(offsets.map((o) => o.slot), ['a', 'b', 'c'], '应按插槽原始顺序排序');
  assert.deepEqual(offsets.map((o) => o.offset), [1, 2, 0]);
});

// ---------------- 权重网格重排 ----------------
test('deleteBone 权重网格顶点骨骼索引重排', () => {
  // 3 根骨骼：a(0), b(1), c(2)
  // vertex0 由 a+b 影响：count=2 → (0,1,1,1),(1,2,1,1)
  // vertex1 由 b+c 影响：count=2 → (1,1,2,2),(2,2,2,2)
  const json = {
    bones: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
    slots: [{ name: 's', bone: 'a' }],
    skins: [{ name: 'default', attachments: { s: { m: { type: 'mesh', vertices: [2, 0, 1, 1, 1, 1, 2, 1, 1, 2, 1, 1, 2, 2, 2, 2, 2, 2] } } } }],
    animations: {},
  };
  // 删除 b(1)：vertex0 只剩 a(0→0)；vertex1 只剩 c(2→1)
  h.deleteBone(json, 'b');
  assert.deepEqual(json.bones.map((b) => b.name), ['a', 'c']);
  const v = json.skins[0].attachments.s.m.vertices;
  // vertex0：count=1 → bone0(x1,y1,w1)；vertex1：count=1 → bone新索引1(x2,y2,w2)
  assert.deepEqual(v, [1, 0, 1, 1, 1, 1, 1, 2, 2, 2], '影响被删除骨骼的条目应移除且索引重排');
});

test('deleteBone 移除子骨骼与插槽', () => {
  const json = {
    bones: [{ name: 'root' }, { name: 'child', parent: 'root' }],
    slots: [{ name: 's', bone: 'child' }],
    skins: [{ name: 'default', attachments: {} }],
    animations: { a: { bones: { child: { rotate: [{ angle: 1 }] } } } },
  };
  h.deleteBone(json, 'root');
  assert.equal(json.bones.length, 0);
  assert.equal(json.slots.length, 0);
  assert.ok(!json.animations.a.bones.child);
});

// ---------------- 事件 / 曲线 / 动画时长 ----------------
test('addEventKeyframe 自动定义事件并排序', () => {
  const json = { animations: { a: { events: [] } } };
  h.addEvent(json, 'hit', { int: 1 });
  h.addEventKeyframe(json, 'a', 0.5, 'hit', { int: 2 });
  h.addEventKeyframe(json, 'a', 0.1, 'hit');
  assert.ok(json.events.hit);
  assert.deepEqual(json.animations.a.events.map((e) => e.time), [0.1, 0.5], '应按时间排序');
});

test('setCurve 支持 stepped / bezier / linear', () => {
  const json = { animations: { a: { bones: { root: { rotate: [{ time: 0, angle: 0 }, { time: 1, angle: 90 }] } } } } };
  h.setCurve(json, 'a', 'bones.root.rotate', 0, 'stepped');
  assert.equal(json.animations.a.bones.root.rotate[0].curve, 'stepped');
  h.setCurve(json, 'a', 'bones.root.rotate', 0, 'bezier', { c1x: 0.1, c1y: 0.1, c2x: 0.9, c2y: 0.9 });
  assert.equal(json.animations.a.bones.root.rotate[0].curve, 0.1, 'bezier cx1');
  assert.equal(json.animations.a.bones.root.rotate[0].c2, 0.1, 'bezier cy1');
  assert.equal(json.animations.a.bones.root.rotate[0].c3, 0.9, 'bezier cx2');
  assert.equal(json.animations.a.bones.root.rotate[0].c4, 0.9, 'bezier cy2');
  h.setCurve(json, 'a', 'bones.root.rotate', 0, 'linear');
  assert.ok(!json.animations.a.bones.root.rotate[0].curve, 'linear 应删除 curve 字段');
});

test('scaleAnimationDuration 缩放全部时间轴', () => {
  const json = { animations: { a: { bones: { root: { rotate: [{ time: 0, angle: 0 }, { time: 1, angle: 90 }] } } } } };
  const d = h.scaleAnimationDuration(json, 'a', 2);
  assert.equal(d, 2);
  assert.equal(json.animations.a.bones.root.rotate[1].time, 2);
});

test('scaleProjectJson 缩放骨骼位置与附件', () => {
  const json = {
    skeleton: { width: 100, height: 200 },
    bones: [{ name: 'root', x: 10, y: 20, length: 5 }],
    slots: [],
    skins: [{ name: 'default', attachments: { s: { r: { type: 'region', x: 4, y: 8, width: 16, height: 16 } } } }],
    animations: { a: { bones: { root: { translate: [{ time: 0, x: 1, y: 2 }] } } } },
  };
  h.scaleProjectJson(json, 0.5);
  assert.equal(json.bones[0].x, 5);
  assert.equal(json.skins[0].attachments.s.r.width, 8);
  assert.equal(json.animations.a.bones.root.translate[0].x, 0.5);
  assert.equal(json.skeleton.width, 50);
});

// ---------------- atlas 解析 ----------------
test('parseAtlas 解析多 region 与属性', () => {
  const text = [
    'atlas.png',
    'size: 512, 512',
    'format: RGBA8888',
    'filter: Linear, Linear',
    'repeat: none',
    'head',
    'rotate: true',
    'xy: 0, 0',
    'size: 100, 80',
    'orig: 100, 80',
    'offset: 0, 0',
    'index: -1',
    'body',
    'xy: 100, 0',
    'size: 200, 120',
    'orig: 200, 120',
    'offset: 0, 0',
    'index: -1',
  ].join('\n');
  const a = atlas.parseAtlas(text);
  assert.equal(a.pages.length, 1);
  assert.equal(a.regions.length, 2);
  assert.equal(a.regions[0].name, 'head');
  assert.equal(a.regions[0].rotate, true);
  assert.equal(a.regions[0].width, 100);
  assert.equal(a.regions[1].name, 'body');
  assert.equal(a.regions[1].x, 100);
});

test('findRegion 支持路径/文件名匹配', () => {
  const a = atlas.parseAtlas('atlas.png\nsize: 10, 10\nformat: RGBA8888\nfilter: Linear, Linear\nrepeat: none\ngoblin/head\nxy: 0,0\nsize: 5,5\norig: 5,5\noffset: 0,0\nindex: -1');
  assert.ok(atlas.findRegion(a, 'goblin/head'));
  assert.ok(atlas.findRegion(a, 'head'), '应支持文件名匹配');
});

// ---------------- 其他 json-handler ----------------
test('addAttachment region 需要 width/height（生成含字段）', () => {
  const json = { bones: [{ name: 'root' }], slots: [{ name: 's', bone: 'root' }], skins: [{ name: 'default', attachments: {} }] };
  h.addAttachment(json, 's', 'hat', 'region', { path: 'hat', width: 100, height: 50 });
  const att = json.skins[0].attachments.s.hat;
  assert.equal(att.type, 'region');
  assert.equal(att.width, 100);
});

test('deleteAttachment 清除插槽默认附件', () => {
  const json = { bones: [{ name: 'root' }], slots: [{ name: 's', bone: 'root', attachment: 'hat' }], skins: [{ name: 'default', attachments: { s: { hat: { type: 'region', path: 'hat' } } } }] };
  h.deleteAttachment(json, 's', 'hat');
  assert.ok(!json.skins[0].attachments.s.hat);
  assert.ok(!json.slots[0].attachment);
});

test('updateDeformKeyframe 写 FFD deform 时间轴', () => {
  const json = { animations: { a: {} } };
  h.updateDeformKeyframe(json, 'a', 'default', 's', 'm', 0, [0, 0, 1, 1]);
  assert.deepEqual(json.animations.a.deform.default.s.m[0].vertices, [0, 0, 1, 1]);
});

test('updateSlotKeyframe 写附件与颜色时间轴', () => {
  const json = { animations: { a: {} } };
  const n = h.updateSlotKeyframe(json, 'a', 's', 0, { attachment: 'hat', color: 'ff0000ff' });
  assert.equal(n, 2);
  assert.equal(json.animations.a.slots.s.attachment[0].name, 'hat');
  assert.equal(json.animations.a.slots.s.color[0].color, 'ff0000ff');
});

test('setBone / setSlotSetup 更新 Setup 属性', () => {
  const json = { bones: [{ name: 'root' }], slots: [{ name: 's', bone: 'root' }] };
  h.setBone(json, 'root', { rotation: 45, length: 10 });
  h.setSlotSetup(json, 's', { blend: 'additive', color: 'ff0000ff' });
  assert.equal(json.bones[0].rotation, 45);
  assert.equal(json.slots[0].blend, 'additive');
});

test('version checks distinguish 4.3 and 3.8 patch releases from other formats', () => {
  const { isSupportedVersion } = require('../dist/constants.js');
  const { parseProjectJson } = require('../dist/spine/project-reader.js');
  for (const v of ['4.3.1', '4.3.26', '3.8.75', '3.8.99']) {
    assert.equal(isSupportedVersion(v), true);
    assert.equal(parseProjectJson({ skeleton: { spine: v } }).compatibilityWarning, undefined);
  }
  const imported = parseProjectJson({ skeleton: { spine: '4.3.26', fps: 60 } }, { sourceVersion: '3.8.75' });
  assert.deepEqual([imported.version, imported.exportVersion, imported.fps], ['3.8.75', '4.3.26', 60]);
  for (const v of ['4.2.43', '4.30.1', '3.80.75', '4.3.x', undefined]) assert.equal(isSupportedVersion(v), false);
});

test('4.3 edits use split axes, native rotation, absolute curves and duration-scaled handles', () => {
  const doc = { skeleton: { spine: '4.3.26' }, bones: [{ name: 'arm', x: 8 }],
    animations: { wave: { bones: { arm: { rotate: [{}, { time: 2, value: 40 }], translatex: [{ value: 8 }] } } } } };
  const tl = doc.animations.wave.bones.arm;
  h.updateBoneKeyframe(doc, 'wave', 'arm', 0, { rotation: 20, x: 7, y: 1 });
  assert.deepEqual(tl.rotate[0], { value: 20 });
  assert.deepEqual(tl.translatex[0], { value: 7 });
  assert.equal(tl.translatey[0].value, 1);
  assert.equal(tl.translate, undefined);
  h.setCurve(doc, 'wave', 'bones.arm.rotate', 0, 'bezier', { c1x: .25, c1y: .1, c2x: .75, c2y: .9 });
  assert.deepEqual(tl.rotate[0].curve, [.5, 22, 1.5, 38]);
  h.scaleAnimationDuration(doc, 'wave', 4);
  assert.deepEqual(tl.rotate[0].curve, [1, 22, 3, 38]);
});

test('4.3 draw order, slot colors and deform timelines use native data structures', () => {
  const doc = { skeleton: { spine: '4.3.26' }, slots: ['a', 'b', 'c'].map(name => ({ name })), animations: { a: {} } };
  h.setDrawOrder(doc, 'a', 0, ['c', 'a', 'b']);
  h.updateSlotKeyframe(doc, 'a', 'a', 0, { color: 'ff0000ff' });
  h.updateDeformKeyframe(doc, 'a', 'default', 'a', 'mesh', 0, [2, 4]);
  const anim = doc.animations.a;
  assert.deepEqual(anim.drawOrder[0].offsets.map(o => o.offset), [1, 1, -2]);
  assert.equal(anim.slots.a.rgba[0].color, 'ff0000ff');
  h.renameSlot(doc, 'a', 'renamed');
  assert.equal(anim.drawOrder[0].offsets[0].slot, 'renamed');
  assert.deepEqual(anim.attachments.default.renamed.mesh.deform[0].vertices, [2, 4]);
});

test('4.3 constraints preserve cross-type ordering and references', () => {
  const doc = { skeleton: { spine: '4.3.26' }, bones: ['root', 'arm', 'target'].map(name => ({ name })),
    slots: [{ name: 'rail', bone: 'root' }], constraints: [{ type: 'physics', name: 'spring', bone: 'arm' }], animations: { idle: {} } };
  h.addIk(doc, 'aim', ['arm'], 'target');
  h.addTransform(doc, 'follow', ['arm'], 'target', { translateMix: .5 });
  h.addPath(doc, 'path', ['arm'], 'rail');
  assert.deepEqual(doc.constraints.map(c => c.type), ['physics', 'ik', 'transform', 'path']);
  assert.equal(doc.constraints[2].source, 'target');
  assert.equal(doc.constraints[2].mixY, .5);
  assert.deepEqual(doc.constraints[2].properties.x.to.x, {});
  h.updateConstraintKeyframe(doc, 'path', 'idle', 'path', .2, { position: 1, translateMix: .2 });
  assert.deepEqual(doc.animations.idle.path.path.mix[0], { time: .2, mixX: .2, mixY: .2 });
  assert.equal(doc.animations.idle.path.path.position[0].value, 1);
  h.renameBone(doc, 'target', 'hand');
  assert.equal(doc.constraints[1].target, 'hand');
  assert.equal(doc.constraints[2].source, 'hand');
  h.deleteConstraint(doc, 'path', 'path');
  assert.equal(doc.animations.idle.path.path, undefined);
});

test('4.3 animation import retains source meshes across skins and slots', () => {
  const { prepareAnimationImport } = require('../dist/spine/modify-service.js');
  const doc = { slots: [{ name: 'a', attachment: 'tile' }],
    skins: [{ name: 'default', attachments: { a: { tile: {}, unused: {} }, b: { base: { type: 'mesh' } } } },
      { name: 'extra', attachments: { a: { linked: { type: 'linkedmesh', source: 'base', slot: 'b' } } } }],
    animations: { wave: { attachments: { extra: { a: { linked: { deform: [{}] } } } } }, other: {} } };
  prepareAnimationImport(doc, ['wave']);
  assert.deepEqual(Object.keys(doc.animations), ['wave']);
  assert.deepEqual(Object.keys(doc.skins[0].attachments.a), ['tile']);
  assert.equal(doc.skins[0].attachments.b.base.type, 'mesh');
  assert.equal(doc.skins[1].attachments.a.linked.source, 'base');
});

test('multi-page 4.3 atlas parses compact bounds, trimming and numeric rotation', () => {
  const parsed = atlas.parseAtlas('a.png\nsize:128,128\npma:true\nhead\nbounds:3,4,40,15\noffsets:2,7,50,30\nrotate:90\n\nb.png\nsize:64,64\nboot\nbounds:1,2,12,8\n');
  assert.deepEqual(parsed.pages.map(p => p.name), ['a.png', 'b.png']);
  assert.equal(parsed.pages[0].pma, true);
  const [head, boot] = parsed.regions;
  assert.deepEqual([head.x, head.y, head.width, head.height, head.origWidth, head.offsetY, head.degrees], [3, 4, 40, 15, 50, 7, 90]);
  assert.deepEqual([boot.page, boot.origWidth, boot.origHeight], [1, 12, 8]);
});

test('4.3 mirrored draw-order offsets remain valid for the opposite slot', () => {
  const { mirrorAnimation } = require('../dist/spine/animation-mirror-service.js');
  const { drawOrderSlots } = require('../dist/spine/format.js');
  const setup = ['arm_l', 'body', 'arm_r'];
  const doc = { skeleton: { spine: '4.3.26' }, slots: setup.map(name => ({ name })),
    animations: { wave: { drawOrder: [{ offsets: [{ slot: 'arm_l', offset: 2 }] }] } } };
  mirrorAnimation(doc, 'wave', { outputName: 'opposite' });
  assert.deepEqual(drawOrderSlots(setup, doc.animations.opposite.drawOrder[0].offsets), ['arm_r', 'arm_l', 'body']);
  h.deleteSlot(doc, 'body');
  assert.deepEqual(drawOrderSlots(['arm_l', 'arm_r'], doc.animations.opposite.drawOrder[0].offsets), ['arm_r', 'arm_l']);
});
