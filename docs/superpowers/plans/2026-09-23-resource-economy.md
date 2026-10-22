# Resource Economy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把日均可用驱散行动从 0.5 次提到最高 8 次 —— 合并为单一次数钱包（自然恢复 + 签到 + 火种兑换），长按认领改为等级解锁的范围制，离线按点亮量产火种，并加一个每日一次的「巡夜」。

**Architecture:** 所有数值与判定抽成纯函数放进 `gameplay.js`（不 `require('wx-server-sdk')`），云函数 `index.js` 只做 IO 与写库。同一份 `gameplay.js` 复制到 4 个云函数目录 + 1 个小程序目录，由契约测试锁死五份完全一致（微信云函数之间无法共享模块，只能靠拷贝 + 测试护栏）。客户端只做展示与预检，服务端永远是唯一裁决者。

**Tech Stack:** 微信小程序（原生 WXML/WXSS/Canvas 2D）、微信云开发（云函数 Node.js + wx-server-sdk ~2.6.3）、`node:test` 单测（Node v24.15.0）

**Spec:** `docs/superpowers/specs/2026-09-23-resource-economy-design.md`

---

## 执行前必读

1. **分支**：`feature/collection-gameplay`。
2. **工作区有用户未提交的改动**：`miniprogram/pages/leaderboard/leaderboard.wxss`。**本计划任何步骤都禁止 `git add -A` / `git add .` / `git commit -a`**，只 `git add` 该步骤明确列出的文件。
3. **测试命令**：`node --test`（Node v24.15.0，`node:test` 内建）。
4. **云函数不在自动步骤内部署**，全部改完后见 Task 15 的部署与手工验证清单。Task 12–14 的客户端改动依赖 Task 6/8/10 的服务端返回，**部署前不要手工验证这些流程**。
5. 纯逻辑任务（Task 1–5）走完整 TDD；IO 接线任务（Task 6–14）的逻辑已在 Task 1–5 覆盖，只写代码 + 跑全量测试，行为验证靠 Task 15 的手工清单。

## File Structure

| 动作 | 路径 | 职责 |
|---|---|---|
| 修改 | `cloudfunctions/clearFog/gameplay.js` | **唯一权威副本**：稀有度、徽章、经济常量、全部纯函数 |
| 新建 | `tests/economy-regen.test.js` | 恢复结算单测 |
| 新建 | `tests/economy-ember.test.js` | 火种产出/兑换单测 |
| 新建 | `tests/economy-level.test.js` | 等级/认领半径/恢复文案单测 |
| 新建 | `tests/economy-landing.test.js` | 巡夜归属单测 |
| 新建 | `tests/gameplay-contract.test.js` | 五份 `gameplay.js` 一致性契约 |
| 复制 | `cloudfunctions/getUserStats/gameplay.js` | 惰性结算用 |
| 复制 | `cloudfunctions/initUser/gameplay.js` | 种子常量用 |
| 新建 | `cloudfunctions/collectEmber/{package.json,index.js,gameplay.js}` | 火种 → 次数兑换（新云函数） |
| 修改 | `cloudfunctions/initUser/index.js` | 统一种子为 5 + 补新字段 |
| 修改 | `cloudfunctions/getUserStats/index.js` | 种子 + 惰性结算 + 返回火种 |
| 修改 | `cloudfunctions/checkIn/index.js` | 每次签到 +1 次数 |
| 修改 | `cloudfunctions/clearFog/index.js` | 删认领限额、加范围校验、巡夜、`uncommonCount` |
| 覆盖 | `miniprogram/utils/gameplay.js` | 与权威副本同内容（含展示 meta） |
| 修改 | `miniprogram/utils/db.js` | `collectEmber()` + `clearFog` 传当前定位 |
| 修改 | `miniprogram/pages/fogmap/fogmap.{js,wxml,wxss}` | 认领卡范围、火种收获卡、巡夜结果卡 |
| 修改 | `miniprogram/pages/profile/{js,wxml,wxss}` | 等级奖励文案、资源状态条、签到文案 |

---

### Task 1: 恢复结算纯函数 `settleAttempts`

**Files:**
- Modify: `cloudfunctions/clearFog/gameplay.js`
- Test: `tests/economy-regen.test.js`

- [ ] **Step 1: 写失败测试**

创建 `tests/economy-regen.test.js`：

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  settleAttempts,
  WALLET_CAP,
  REGEN_FLOOR,
  REGEN_INTERVAL_MS,
  INITIAL_ATTEMPTS
} = require('../cloudfunctions/clearFog/gameplay');

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

test('经济常量与 spec 一致', () => {
  assert.equal(INITIAL_ATTEMPTS, 5);
  assert.equal(WALLET_CAP, 10);
  assert.equal(REGEN_FLOOR, 3);
  assert.equal(REGEN_INTERVAL_MS, 4 * HOUR);
});

test('不足 4 小时不恢复', () => {
  const ts = NOW - (3 * HOUR + 59 * 60 * 1000);
  const r = settleAttempts({ attempts: 0, attemptUpdatedAtMs: ts, nowMs: NOW });
  assert.equal(r.attempts, 0);
  assert.equal(r.attemptUpdatedAtMs, ts);
  assert.equal(r.changed, false);
});

test('满 4 小时恢复 1 次并推进时间戳', () => {
  const ts = NOW - 4 * HOUR;
  const r = settleAttempts({ attempts: 0, attemptUpdatedAtMs: ts, nowMs: NOW });
  assert.equal(r.attempts, 1);
  assert.equal(r.attemptUpdatedAtMs, ts + 4 * HOUR);
  assert.equal(r.changed, true);
});

test('7 小时恢复 1 次，剩余 3 小时保留', () => {
  const ts = NOW - 7 * HOUR;
  const r = settleAttempts({ attempts: 0, attemptUpdatedAtMs: ts, nowMs: NOW });
  assert.equal(r.attempts, 1);
  assert.equal(r.attemptUpdatedAtMs, ts + 4 * HOUR);
});

test('长期离开只补到保底线 3，多余时间作废', () => {
  const r = settleAttempts({
    attempts: 0,
    attemptUpdatedAtMs: NOW - 100 * HOUR,
    nowMs: NOW
  });
  assert.equal(r.attempts, REGEN_FLOOR);
  assert.equal(r.attemptUpdatedAtMs, NOW);
});

test('保底线之上不恢复、不囤积时间', () => {
  const ts = NOW - 100 * HOUR;
  const r = settleAttempts({ attempts: 5, attemptUpdatedAtMs: ts, nowMs: NOW });
  assert.equal(r.attempts, 5);
  assert.equal(r.attemptUpdatedAtMs, ts);
  assert.equal(r.changed, false);
});

test('缺时间戳按「立即补到 3」处理', () => {
  const r = settleAttempts({ attempts: 1, attemptUpdatedAtMs: null, nowMs: NOW });
  assert.equal(r.attempts, 3);
  assert.equal(r.attemptUpdatedAtMs, NOW);
  assert.equal(r.changed, true);
});

test('缺时间戳但已高于保底线：保留次数并补时间戳', () => {
  const r = settleAttempts({ attempts: 5, attemptUpdatedAtMs: null, nowMs: NOW });
  assert.equal(r.attempts, 5);
  assert.equal(r.attemptUpdatedAtMs, NOW);
  assert.equal(r.changed, true);
});

test('存量超上限夹到钱包上限 10', () => {
  const r = settleAttempts({ attempts: 200, attemptUpdatedAtMs: NOW, nowMs: NOW });
  assert.equal(r.attempts, WALLET_CAP);
  assert.equal(r.changed, true);
});

test('2 次 + 8 小时 → 封顶 3 且时间戳置 now', () => {
  const r = settleAttempts({
    attempts: 2,
    attemptUpdatedAtMs: NOW - 8 * HOUR,
    nowMs: NOW
  });
  assert.equal(r.attempts, 3);
  assert.equal(r.attemptUpdatedAtMs, NOW);
});

test('时间戳来自未来时不产生负恢复', () => {
  const ts = NOW + HOUR;
  const r = settleAttempts({ attempts: 0, attemptUpdatedAtMs: ts, nowMs: NOW });
  assert.equal(r.attempts, 0);
  assert.equal(r.attemptUpdatedAtMs, ts);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/economy-regen.test.js`
Expected: FAIL —— `settleAttempts is not a function`，常量断言也失败（`undefined`），fail > 0

- [ ] **Step 3: 在 `cloudfunctions/clearFog/gameplay.js` 追加常量与实现**

追加到 `module.exports` 之前：

```js
// ── Economy: attempt regeneration ──

const LEVELS_XP = [0, 200, 800, 2000, 5000, 10000, 20000];
const WALLET_CAP = 10;                    // 钱包硬上限
const REGEN_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 小时 +1
const REGEN_FLOOR = 3;                    // 自然恢复只补到 3
const INITIAL_ATTEMPTS = 5;               // 新用户初始

/**
 * 惰性结算自然恢复。
 *
 * 关键不变量：时间戳只在「真正恢复」和「扣减」时前进，所以长期满额不会囤积
 * 出一次瞬间补满；钱包降到保底线以下时，累计时长只从上次扣减算起。
 *
 * @param {{attempts?:number, attemptUpdatedAtMs?:number|null, nowMs:number}} input
 * @returns {{attempts:number, attemptUpdatedAtMs:number, changed:boolean}}
 */
function settleAttempts({ attempts, attemptUpdatedAtMs, nowMs }) {
  const raw = Math.max(Number(attempts) || 0, 0);
  const capped = Math.min(raw, WALLET_CAP);
  const tsMissing =
    attemptUpdatedAtMs == null || !Number.isFinite(attemptUpdatedAtMs);

  // 缺时间戳：视为当前时刻；不足保底线的直接补到保底线
  if (tsMissing) {
    return {
      attempts: Math.max(capped, REGEN_FLOOR),
      attemptUpdatedAtMs: nowMs,
      changed: true
    };
  }

  // 保底线之上没有可恢复量。
  // 若走 min(attempts + recovered, REGEN_FLOOR) 会把 attempts=5 直接砍成 3。
  if (capped >= REGEN_FLOOR) {
    return { attempts: capped, attemptUpdatedAtMs, changed: capped !== raw };
  }

  const recovered = Math.floor((nowMs - attemptUpdatedAtMs) / REGEN_INTERVAL_MS);
  if (recovered <= 0) {
    return { attempts: capped, attemptUpdatedAtMs, changed: capped !== raw };
  }

  const sum = capped + recovered;
  if (sum >= REGEN_FLOOR) {
    return { attempts: REGEN_FLOOR, attemptUpdatedAtMs: nowMs, changed: true };
  }

  return {
    attempts: sum,
    attemptUpdatedAtMs: attemptUpdatedAtMs + recovered * REGEN_INTERVAL_MS,
    changed: true
  };
}
```

修改 `module.exports`，在现有键之后追加：

```js
module.exports = {
  computeRarity,
  evaluateNewBadges,
  BADGE_DEFS,
  RARITY_XP_BONUS,
  RARE_KEYWORDS,
  RARE_SUFFIX,
  UNCOMMON_KEYWORDS,
  UNCOMMON_SUFFIX,
  // 经济
  LEVELS_XP,
  WALLET_CAP,
  REGEN_INTERVAL_MS,
  REGEN_FLOOR,
  INITIAL_ATTEMPTS,
  settleAttempts
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/economy-regen.test.js`
Expected: PASS，fail 0

- [ ] **Step 5: 提交**

```bash
git add cloudfunctions/clearFog/gameplay.js tests/economy-regen.test.js
git commit -m "feat: add pure attempt regeneration settle logic"
```

---

### Task 2: 火种产出与兑换纯函数

**Files:**
- Modify: `cloudfunctions/clearFog/gameplay.js`
- Test: `tests/economy-ember.test.js`

- [ ] **Step 1: 写失败测试**

创建 `tests/economy-ember.test.js`：

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  emberRatePerDay,
  deriveEmberCounts,
  accrueEmber,
  convertEmber,
  BLOCK_AREA_KM2,
  BASE_RATE_PER_KM2,
  RARITY_EMBER_MULT,
  EMBER_CAP,
  EMBER_PER_ATTEMPT,
  WALLET_CAP
} = require('../cloudfunctions/clearFog/gameplay');

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const UNIT = BLOCK_AREA_KM2 * BASE_RATE_PER_KM2; // 1 块 common 的日产能 ≈1.8855

test('火种常量与 spec 一致', () => {
  assert.equal(EMBER_CAP, 30);
  assert.equal(EMBER_PER_ATTEMPT, 10);
  assert.ok(Math.abs(BLOCK_AREA_KM2 - Math.PI * 4) < 1e-9);
  assert.ok(Math.abs(BASE_RATE_PER_KM2 - 0.15) < 1e-9);
  assert.deepEqual(RARITY_EMBER_MULT, { common: 1, uncommon: 1.5, rare: 2.5, epic: 4 });
});

// ── deriveEmberCounts ──

test('legacy 无 uncommonCount：uncommon 记 0', () => {
  const c = deriveEmberCounts({ totalCleared: 10, rareCount: 2, epicCount: 1 });
  assert.deepEqual(c, { common: 7, uncommon: 0, rare: 2, epic: 1 });
});

test('有 uncommonCount 时按字段取', () => {
  const c = deriveEmberCounts({
    totalCleared: 10, rareCount: 2, epicCount: 1, uncommonCount: 3
  });
  assert.deepEqual(c, { common: 4, uncommon: 3, rare: 2, epic: 1 });
});

test('计数异常时 common 不为负', () => {
  const c = deriveEmberCounts({ totalCleared: 1, rareCount: 5 });
  assert.equal(c.common, 0);
});

// ── emberRatePerDay ──

test('1 块 common @Lv1 = 12.57 × 0.15 / 天', () => {
  const r = emberRatePerDay({ common: 1, uncommon: 0, rare: 0, epic: 0 }, 1);
  assert.ok(Math.abs(r - UNIT) < 1e-9, `实际 ${r}`);
});

test('稀有度加权：1 rare = 2.5 × common', () => {
  const r = emberRatePerDay({ common: 0, uncommon: 0, rare: 1, epic: 0 }, 1);
  assert.ok(Math.abs(r - UNIT * RARITY_EMBER_MULT.rare) < 1e-9);
});

test('等级系数：Lv7 = 1.6 × Lv1', () => {
  const lv1 = emberRatePerDay({ common: 1, uncommon: 0, rare: 0, epic: 0 }, 1);
  const lv7 = emberRatePerDay({ common: 1, uncommon: 0, rare: 0, epic: 0 }, 7);
  assert.ok(Math.abs(lv7 - lv1 * 1.6) < 1e-9);
});

// ── accrueEmber ──

test('16 块 common 满 24h 攒到封顶 30', () => {
  const r = accrueEmber({
    ember: 0, emberUpdatedAtMs: NOW - DAY, nowMs: NOW,
    counts: { common: 16, uncommon: 0, rare: 0, epic: 0 }, level: 1
  });
  assert.equal(r.ember, EMBER_CAP);
  assert.equal(r.pending, EMBER_CAP);
  assert.equal(r.emberUpdatedAtMs, NOW);
});

test('半天只攒一半', () => {
  const r = accrueEmber({
    ember: 0, emberUpdatedAtMs: NOW - 12 * HOUR, nowMs: NOW,
    counts: { common: 1, uncommon: 0, rare: 0, epic: 0 }, level: 1
  });
  assert.ok(Math.abs(r.pending - UNIT / 2) < 1e-9);
});

test('离开 3 天按 24h 计，不按 72h', () => {
  const r = accrueEmber({
    ember: 0, emberUpdatedAtMs: NOW - 3 * DAY, nowMs: NOW,
    counts: { common: 1, uncommon: 0, rare: 0, epic: 0 }, level: 1
  });
  assert.ok(Math.abs(r.pending - UNIT) < 1e-9, `实际 ${r.pending}`);
});

test('余额已满不产出', () => {
  const r = accrueEmber({
    ember: EMBER_CAP, emberUpdatedAtMs: NOW - DAY, nowMs: NOW,
    counts: { common: 100, uncommon: 0, rare: 0, epic: 0 }, level: 1
  });
  assert.equal(r.pending, 0);
  assert.equal(r.ember, EMBER_CAP);
  assert.equal(r.emberUpdatedAtMs, NOW);
});

test('缺时间戳：pending 0 且时间戳补为 now', () => {
  const r = accrueEmber({
    ember: 5, emberUpdatedAtMs: null, nowMs: NOW,
    counts: { common: 1, uncommon: 0, rare: 0, epic: 0 }, level: 1
  });
  assert.equal(r.pending, 0);
  assert.equal(r.ember, 5);
  assert.equal(r.emberUpdatedAtMs, NOW);
});

// ── convertEmber ──

test('30 火种 + 钱包 3 → 兑 3，火种 0，钱包 6', () => {
  const r = convertEmber(30, 3);
  assert.deepEqual(r, { convert: 3, ember: 0, wallet: 6 });
});

test('18 火种 + 钱包 0 → 兑 1，余 8', () => {
  const r = convertEmber(18, 0);
  assert.deepEqual(r, { convert: 1, ember: 8, wallet: 1 });
});

test('不足 10 火种不兑换', () => {
  const r = convertEmber(9, 0);
  assert.equal(r.convert, 0);
  assert.equal(r.ember, 9);
});

test('100 火种 + 钱包 9 → 只兑 1，余 90（钱包满 10）', () => {
  const r = convertEmber(100, 9);
  assert.deepEqual(r, { convert: 1, ember: 90, wallet: WALLET_CAP });
});

test('钱包已满时不兑换', () => {
  const r = convertEmber(5, WALLET_CAP);
  assert.equal(r.convert, 0);
  assert.equal(r.wallet, WALLET_CAP);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/economy-ember.test.js`
Expected: FAIL —— `emberRatePerDay is not a function`，fail > 0

- [ ] **Step 3: 追加常量与实现**

在 `cloudfunctions/clearFog/gameplay.js` 的 `module.exports` 之前追加：

```js
// ── Economy: embers ──

const EMBER_CAP = 30;                     // 火种余额上限（未收割）
const EMBER_PER_ATTEMPT = 10;             // 10 火种 = 1 次驱散
const BLOCK_RADIUS_M = 2000;
const BLOCK_AREA_KM2 =
  Math.PI * (BLOCK_RADIUS_M / 1000) * (BLOCK_RADIUS_M / 1000); // ≈12.566 km²
const BASE_RATE_PER_KM2 = 0.15;           // 火种 / km² / 天
const RARITY_EMBER_MULT = { common: 1, uncommon: 1.5, rare: 2.5, epic: 4 };
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 从 users 文档的计数器推导火种产出的稀有度分布。
 * 不扫 cleared_areas —— 避开 1000 行上限与蒙特卡洛面积计算。
 * legacy 用户没有 uncommonCount → 记 0，common = total − rare − epic − uncommon。
 */
function deriveEmberCounts(user) {
  const u = user || {};
  const total = u.totalCleared || 0;
  const rare = u.rareCount || 0;
  const epic = u.epicCount || 0;
  const uncommon = u.uncommonCount != null ? u.uncommonCount : 0;
  return {
    common: Math.max(total - rare - epic - uncommon, 0),
    uncommon,
    rare,
    epic
  };
}

function emberLevelCoeff(level) {
  return 1 + 0.1 * ((Number(level) || 1) - 1);
}

/** 每满 24h 的火种产能 */
function emberRatePerDay(counts, level) {
  const c = counts || {};
  const weighted =
    (c.common || 0) * RARITY_EMBER_MULT.common +
    (c.uncommon || 0) * RARITY_EMBER_MULT.uncommon +
    (c.rare || 0) * RARITY_EMBER_MULT.rare +
    (c.epic || 0) * RARITY_EMBER_MULT.epic;
  return BLOCK_AREA_KM2 * BASE_RATE_PER_KM2 * weighted * emberLevelCoeff(level);
}

/**
 * 惰性结算火种累计。elapsedDays 夹到 ≤1；结算后时间戳一律置为 nowMs
 * （无论是否触及上限），所以余额满期间的时间不累积。
 */
function accrueEmber({ ember, emberUpdatedAtMs, nowMs, counts, level }) {
  const before = Math.max(Number(ember) || 0, 0);
  const ts =
    emberUpdatedAtMs == null || !Number.isFinite(emberUpdatedAtMs)
      ? nowMs
      : emberUpdatedAtMs;

  let elapsedMs = nowMs - ts;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) elapsedMs = 0;
  if (elapsedMs > DAY_MS) elapsedMs = DAY_MS;

  const room = Math.max(EMBER_CAP - before, 0);
  const pending = Math.min(
    emberRatePerDay(counts, level) * (elapsedMs / DAY_MS),
    room
  );

  return { ember: before + pending, emberUpdatedAtMs: nowMs, pending };
}

/** 火种 → 次数兑换（10:1，受钱包上限约束，余数留在火种余额） */
function convertEmber(ember, wallet) {
  const e = Math.max(Number(ember) || 0, 0);
  const w = Math.min(Math.max(Number(wallet) || 0, 0), WALLET_CAP);
  const convert = Math.min(Math.floor(e / EMBER_PER_ATTEMPT), WALLET_CAP - w);
  if (convert <= 0) return { convert: 0, ember: e, wallet: w };
  return {
    convert,
    ember: e - convert * EMBER_PER_ATTEMPT,
    wallet: w + convert
  };
}
```

`module.exports` 追加这些键：

```js
  // 经济：火种
  EMBER_CAP,
  EMBER_PER_ATTEMPT,
  BLOCK_RADIUS_M,
  BLOCK_AREA_KM2,
  BASE_RATE_PER_KM2,
  RARITY_EMBER_MULT,
  DAY_MS,
  deriveEmberCounts,
  emberRatePerDay,
  accrueEmber,
  convertEmber,
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/economy-ember.test.js`
Expected: PASS，fail 0

同时回归 Task 1：

Run: `node --test tests/economy-regen.test.js`
Expected: PASS，fail 0

- [ ] **Step 5: 提交**

```bash
git add cloudfunctions/clearFog/gameplay.js tests/economy-ember.test.js
git commit -m "feat: add pure ember accrual and conversion logic"
```

---

### Task 3: 等级、认领半径、恢复提示文案

**Files:**
- Modify: `cloudfunctions/clearFog/gameplay.js`
- Test: `tests/economy-level.test.js`

- [ ] **Step 1: 写失败测试**

创建 `tests/economy-level.test.js`：

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  getLevelByXp,
  getClaimRadiusMeters,
  regenHint,
  LEVELS_XP,
  CLAIM_RADIUS_BY_LEVEL,
  REGEN_FLOOR
} = require('../cloudfunctions/clearFog/gameplay');

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

test('XP → 等级边界', () => {
  assert.equal(getLevelByXp(0), 1);
  assert.equal(getLevelByXp(199), 1);
  assert.equal(getLevelByXp(200), 2);
  assert.equal(getLevelByXp(2000), 4);
  assert.equal(getLevelByXp(19999), 6);
  assert.equal(getLevelByXp(20000), 7);
  assert.equal(getLevelByXp(99999), 7);
  assert.equal(LEVELS_XP.length, 7);
});

test('认领半径表与 spec 一致', () => {
  assert.equal(getClaimRadiusMeters(1), 0);
  assert.equal(getClaimRadiusMeters(2), 15000);
  assert.equal(getClaimRadiusMeters(3), 30000);
  assert.equal(getClaimRadiusMeters(4), 60000);
  assert.equal(getClaimRadiusMeters(5), 150000);
  assert.equal(getClaimRadiusMeters(6), 500000);
  assert.equal(getClaimRadiusMeters(7), Infinity);
});

test('异常等级一律不可认领', () => {
  assert.equal(getClaimRadiusMeters(null), 0);
  assert.equal(getClaimRadiusMeters(undefined), 0);
  assert.equal(getClaimRadiusMeters(99), 0);
  assert.equal(CLAIM_RADIUS_BY_LEVEL[1], 0);
});

test('达保底线显示「保底已满」', () => {
  assert.equal(regenHint(REGEN_FLOOR, NOW - 100 * HOUR, NOW).text, '保底已满');
  assert.equal(regenHint(5, NOW - 100 * HOUR, NOW).text, '保底已满');
});

test('恢复中显示剩余小时', () => {
  assert.equal(regenHint(0, NOW - HOUR, NOW).text, '3 小时后 +1');
  assert.equal(regenHint(1, NOW, NOW).text, '4 小时后 +1');
});

test('刚过恢复点显示「即将恢复 1 次」', () => {
  assert.equal(regenHint(2, NOW - 4 * HOUR, NOW).text, '即将恢复 1 次');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/economy-level.test.js`
Expected: FAIL —— `getLevelByXp is not a function`，fail > 0

- [ ] **Step 3: 追加实现**

在 `cloudfunctions/clearFog/gameplay.js` 的 `module.exports` 之前追加：

```js
// ── Economy: level & claim range ──

// 等级 → 长按认领半径（米）。Lv1 = 0 表示未解锁；Lv7 = 无限。
const CLAIM_RADIUS_BY_LEVEL = {
  1: 0,
  2: 15000,
  3: 30000,
  4: 60000,
  5: 150000,
  6: 500000,
  7: Infinity
};

function getLevelByXp(xp) {
  const x = Number(xp) || 0;
  let level = 1;
  for (let i = LEVELS_XP.length - 1; i >= 0; i--) {
    if (x >= LEVELS_XP[i]) {
      level = i + 1;
      break;
    }
  }
  return level;
}

function getClaimRadiusMeters(level) {
  if (level == null) return 0;
  const r = CLAIM_RADIUS_BY_LEVEL[level];
  return typeof r === 'number' ? r : 0;
}

/** 「我的」页恢复提示文案 */
function regenHint(attempts, attemptUpdatedAtMs, nowMs) {
  const a = Number(attempts) || 0;
  if (a >= REGEN_FLOOR) return { text: '保底已满', readyInMs: 0 };

  const ts =
    attemptUpdatedAtMs == null || !Number.isFinite(attemptUpdatedAtMs)
      ? nowMs
      : attemptUpdatedAtMs;
  const wait = Math.max(ts + REGEN_INTERVAL_MS - nowMs, 0);
  const hours = Math.ceil(wait / (60 * 60 * 1000));

  return {
    text: hours >= 1 ? `${hours} 小时后 +1` : '即将恢复 1 次',
    readyInMs: wait
  };
}
```

`module.exports` 追加：

```js
  // 经济：等级与认领范围
  CLAIM_RADIUS_BY_LEVEL,
  getLevelByXp,
  getClaimRadiusMeters,
  regenHint,
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/economy-level.test.js`
Expected: PASS，fail 0

- [ ] **Step 5: 提交**

```bash
git add cloudfunctions/clearFog/gameplay.js tests/economy-level.test.js
git commit -m "feat: add level, claim radius, and regen hint pure logic"
```

---

### Task 4: 巡夜归属纯函数

**Files:**
- Modify: `cloudfunctions/clearFog/gameplay.js`
- Test: `tests/economy-landing.test.js`

- [ ] **Step 1: 写失败测试**

创建 `tests/economy-landing.test.js`：

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  haversineM,
  findNearestOverlap,
  classifyLanding,
  OVERLAP_DIST_M,
  NIGHT_WATCH_EMBER,
  NIGHT_WATCH_XP,
  BLOCK_RADIUS_M
} = require('../cloudfunctions/clearFog/gameplay');

const BASE_LAT = 39.9042;
const BASE_LNG = 116.4074;
const MINE = 'openid-mine';
const OTHER = 'openid-other';

// 纯纬度偏移：1° 球面弧长 = 6371000 × π/180 ≈ 111194.9 m
function latAt(km) {
  return BASE_LAT + (km * 1000) / 111194.9;
}

test('常量与 spec 一致', () => {
  assert.equal(BLOCK_RADIUS_M * 1.5, OVERLAP_DIST_M);
  assert.equal(OVERLAP_DIST_M, 3000);
  assert.equal(NIGHT_WATCH_EMBER, 10);
  assert.equal(NIGHT_WATCH_XP, 10);
});

test('haversine 同点为 0，1 度纬度约 111.19 km', () => {
  assert.equal(haversineM(BASE_LAT, BASE_LNG, BASE_LAT, BASE_LNG), 0);
  const d = haversineM(BASE_LAT, BASE_LNG, BASE_LAT + 1, BASE_LNG);
  assert.ok(Math.abs(d - 111194.9) < 300, `实际 ${d}`);
});

test('无重叠 → free', () => {
  const r = classifyLanding([], BASE_LAT, BASE_LNG, MINE);
  assert.equal(r.kind, 'free');
  assert.equal(r.distanceMeters, 0);
});

test('自己的区域 2km 内 → mine', () => {
  const areas = [{ latitude: latAt(2), longitude: BASE_LNG, clearedBy: MINE }];
  const r = classifyLanding(areas, BASE_LAT, BASE_LNG, MINE);
  assert.equal(r.kind, 'mine');
  assert.ok(Math.abs(r.distanceMeters - 2000) < 5, `实际 ${r.distanceMeters}`);
});

test('他人区域 2km 内 → other', () => {
  const areas = [{ latitude: latAt(2), longitude: BASE_LNG, clearedBy: OTHER }];
  const r = classifyLanding(areas, BASE_LAT, BASE_LNG, MINE);
  assert.equal(r.kind, 'other');
});

test('2.99km 触发重叠，3.01km 不触发', () => {
  const near = [{ latitude: latAt(2.99), longitude: BASE_LNG, clearedBy: MINE }];
  assert.equal(classifyLanding(near, BASE_LAT, BASE_LNG, MINE).kind, 'mine');

  const far = [{ latitude: latAt(3.01), longitude: BASE_LNG, clearedBy: MINE }];
  assert.equal(classifyLanding(far, BASE_LAT, BASE_LNG, MINE).kind, 'free');
});

test('同时压到两块：他人更近 → other（取最近者，不看返回顺序）', () => {
  const areas = [
    { latitude: latAt(2.9), longitude: BASE_LNG, clearedBy: MINE },
    { latitude: latAt(1.0), longitude: BASE_LNG, clearedBy: OTHER }
  ];
  const r = classifyLanding(areas, BASE_LAT, BASE_LNG, MINE);
  assert.equal(r.kind, 'other');
  assert.ok(r.distanceMeters < 1100);
});

test('同时压到两块：我的更近 → mine', () => {
  const areas = [
    { latitude: latAt(2.9), longitude: BASE_LNG, clearedBy: OTHER },
    { latitude: latAt(1.0), longitude: BASE_LNG, clearedBy: MINE }
  ];
  const r = classifyLanding(areas, BASE_LAT, BASE_LNG, MINE);
  assert.equal(r.kind, 'mine');
  assert.ok(r.distanceMeters < 1100);
});

test('findNearestOverlap 忽略非法坐标', () => {
  const areas = [
    { latitude: null, longitude: null, clearedBy: MINE },
    { clearedBy: MINE }
  ];
  assert.equal(findNearestOverlap(areas, BASE_LAT, BASE_LNG), null);
});

test('自定义重叠半径生效', () => {
  const areas = [{ latitude: latAt(4), longitude: BASE_LNG, clearedBy: MINE }];
  assert.equal(classifyLanding(areas, BASE_LAT, BASE_LNG, MINE, 5000).kind, 'mine');
  assert.equal(classifyLanding(areas, BASE_LAT, BASE_LNG, MINE, 3000).kind, 'free');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/economy-landing.test.js`
Expected: FAIL —— `haversineM is not a function`，fail > 0

- [ ] **Step 3: 追加实现**

在 `cloudfunctions/clearFog/gameplay.js` 的 `module.exports` 之前追加：

```js
// ── Landing classification（巡夜归属）──

const NIGHT_WATCH_EMBER = 10;
const NIGHT_WATCH_XP = 10;
const OVERLAP_DIST_M = BLOCK_RADIUS_M * 1.5; // 3000

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
      Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * 找出距离落点最近、且在重叠半径内的区域。
 *
 * 任意两块区域互相 ≥3km，但它们的 3km 判定圈在相距 <6km 时会重叠，
 * 于是同一个落点可能同时命中「我的」与「他人的」区域。
 * 必须取最近者定归属 —— 不能依赖数据库返回顺序（那是不确定的）。
 */
function findNearestOverlap(areas, lat, lng, maxDist = OVERLAP_DIST_M) {
  let best = null;
  let bestDist = Infinity;

  for (const area of areas || []) {
    if (
      area == null ||
      !Number.isFinite(area.latitude) ||
      !Number.isFinite(area.longitude)
    ) {
      continue;
    }
    const d = haversineM(lat, lng, area.latitude, area.longitude);
    if (d < maxDist && d < bestDist) {
      best = area;
      bestDist = d;
    }
  }

  return best ? { area: best, distanceMeters: bestDist } : null;
}

/**
 * @param {Array} areas 候选已点亮区域
 * @param {number} lat 落点纬度
 * @param {number} lng 落点经度
 * @param {string} myOpenid 当前用户 openid
 * @param {number} [maxDist] 重叠半径，默认 OVERLAP_DIST_M
 * @returns {{kind:'free'|'mine'|'other', area:Object|null, distanceMeters:number}}
 *   free = 无重叠可驱散；mine = 落在自己区域上（巡夜）；other = 落在他人区域上
 */
function classifyLanding(areas, lat, lng, myOpenid, maxDist = OVERLAP_DIST_M) {
  const hit = findNearestOverlap(areas, lat, lng, maxDist);
  if (!hit) return { kind: 'free', area: null, distanceMeters: 0 };

  const mine = !!myOpenid && hit.area.clearedBy === myOpenid;
  return {
    kind: mine ? 'mine' : 'other',
    area: hit.area,
    distanceMeters: hit.distanceMeters
  };
}
```

`module.exports` 追加：

```js
  // 巡夜归属
  NIGHT_WATCH_EMBER,
  NIGHT_WATCH_XP,
  OVERLAP_DIST_M,
  haversineM,
  findNearestOverlap,
  classifyLanding,
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/economy-landing.test.js`
Expected: PASS，fail 0

- [ ] **Step 5: 提交**

```bash
git add cloudfunctions/clearFog/gameplay.js tests/economy-landing.test.js
git commit -m "feat: add nearest-overlap landing classification for night watch"
```

---

### Task 5: 合并展示 meta 并同步四份 gameplay.js

微信云函数之间无法共享模块，所以同一份 `gameplay.js` 复制到 4 个目录 + 小程序端共 5 处，由契约测试锁死一致。

**Files:**
- Modify: `cloudfunctions/clearFog/gameplay.js`（把客户端展示 meta 合并进来）
- Create: `cloudfunctions/getUserStats/gameplay.js`
- Create: `cloudfunctions/initUser/gameplay.js`
- Overwrite: `miniprogram/utils/gameplay.js`
- Test: `tests/gameplay-contract.test.js`

> ⚠️ **顺序不可颠倒**：必须先完成 Step 2 的合并，再执行 Step 3 的复制。
> 若先复制，`miniprogram/utils/gameplay.js` 会被服务端版本覆盖、丢失 `RARITY_META` / `BADGE_META` / `getRarityMeta` / `getBadgeMeta`，`fogmap.js`、`discovery.js`、`profile.js` 会直接报错。

- [ ] **Step 1: 写失败测试**

创建 `tests/gameplay-contract.test.js`：

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');

const PATHS = [
  '../cloudfunctions/clearFog/gameplay',
  '../cloudfunctions/getUserStats/gameplay',
  '../cloudfunctions/initUser/gameplay',
  '../miniprogram/utils/gameplay'
];

test('四份 gameplay.js 导出键完全一致', () => {
  const keys = PATHS.map((p) => Object.keys(require(p)).sort());
  assert.deepEqual(keys[0], keys[1]);
  assert.deepEqual(keys[0], keys[2]);
  assert.deepEqual(keys[0], keys[3]);
});

test('同名导出内容一致（函数比源码文本，其余比值）', () => {
  const mods = PATHS.map((p) => require(p));
  for (const key of Object.keys(mods[0])) {
    for (let i = 1; i < mods.length; i++) {
      const a = mods[0][key];
      const b = mods[i][key];
      if (typeof a === 'function') {
        assert.equal(String(a), String(b), `${key} 在第 ${i + 1} 份不一致`);
      } else {
        assert.deepEqual(a, b, `${key} 在第 ${i + 1} 份不一致`);
      }
    }
  }
});

test('小程序端仍导出页面依赖的展示函数', () => {
  const client = require('../miniprogram/utils/gameplay');
  assert.equal(typeof client.getRarityMeta, 'function');
  assert.equal(typeof client.getBadgeMeta, 'function');
  assert.equal(typeof client.RARITY_META, 'object');
  assert.equal(typeof client.BADGE_META, 'object');
  assert.equal(typeof client.classifyLanding, 'function');
  assert.equal(typeof client.settleAttempts, 'function');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/gameplay-contract.test.js`
Expected: FAIL —— `Cannot find module '.../getUserStats/gameplay'`，fail > 0

- [ ] **Step 3: 把客户端展示 meta 合并进权威副本**

在 `cloudfunctions/clearFog/gameplay.js` 的 `module.exports` 之前追加（内容取自现有 `miniprogram/utils/gameplay.js`，一字不改）：

```js
// ── 客户端展示用 meta（小程序端与云函数共用同一份文件）──

const RARITY_META = {
  common: { name: '常见', color: '#8b9bb4', glow: 'rgba(139,155,180,0.35)' },
  uncommon: { name: '少见', color: '#38bdf8', glow: 'rgba(56,189,248,0.45)' },
  rare: { name: '珍稀', color: '#c084fc', glow: 'rgba(192,132,252,0.55)' },
  epic: { name: '史诗', color: '#fbbf24', glow: 'rgba(251,191,36,0.65)' }
};

const BADGE_META = [
  { id: 'first_light', name: '初火', desc: '完成首次驱散', icon: '✦' },
  { id: 'spark_10', name: '启明', desc: '驱散 10 次', icon: '✧' },
  { id: 'spark_50', name: '燎原', desc: '驱散 50 次', icon: '☄' },
  { id: 'city_3', name: '游城', desc: '发现 3 座城市', icon: '城' },
  { id: 'city_10', name: '行省', desc: '发现 10 座城市', icon: '省' },
  { id: 'rare_1', name: '秘境', desc: '发现珍稀地点', icon: '◆' },
  { id: 'epic_1', name: '史诗', desc: '发现史诗地点', icon: '★' },
  { id: 'max_level', name: '世界点亮者', desc: '达到最高等级', icon: '☀' }
];

function getRarityMeta(rarity) {
  return RARITY_META[rarity] || RARITY_META.common;
}

function getBadgeMeta(id) {
  return BADGE_META.find((b) => b.id === id) || null;
}
```

`module.exports` 追加：

```js
  // 展示 meta（客户端依赖）
  RARITY_META,
  BADGE_META,
  getRarityMeta,
  getBadgeMeta,
```

- [ ] **Step 4: 复制到其余四处**

Run（PowerShell）：

```powershell
Copy-Item cloudfunctions/clearFog/gameplay.js cloudfunctions/getUserStats/gameplay.js -Force
Copy-Item cloudfunctions/clearFog/gameplay.js cloudfunctions/initUser/gameplay.js -Force
Copy-Item cloudfunctions/clearFog/gameplay.js miniprogram/utils/gameplay.js -Force
```

Expected: 无输出，三个文件生成

- [ ] **Step 5: 跑全部测试确认通过**

Run: `node --test`
Expected: 全部 PASS，fail 0（含既有 `tests/gameplay.test.js` 的 23 项徽章/稀有度契约测试）

- [ ] **Step 6: 提交**

```bash
git add cloudfunctions/clearFog/gameplay.js cloudfunctions/getUserStats/gameplay.js cloudfunctions/initUser/gameplay.js miniprogram/utils/gameplay.js tests/gameplay-contract.test.js
git commit -m "feat: unify gameplay module across cloud functions and client"
```

---

### Task 6: 新增 collectEmber 云函数

**Files:**
- Create: `cloudfunctions/collectEmber/package.json`
- Create: `cloudfunctions/collectEmber/index.js`
- Create: `cloudfunctions/collectEmber/gameplay.js`
- Modify: `tests/gameplay-contract.test.js`（加入第 5 份拷贝）

- [ ] **Step 1: 创建 package.json**

创建 `cloudfunctions/collectEmber/package.json`：

```json
{
  "name": "collectEmber",
  "version": "1.0.0",
  "main": "index.js",
  "dependencies": {
    "wx-server-sdk": "~2.6.3"
  }
}
```

- [ ] **Step 2: 创建 index.js**

创建 `cloudfunctions/collectEmber/index.js`：

```js
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const { convertEmber, WALLET_CAP, EMBER_PER_ATTEMPT } = require('./gameplay');

/**
 * 火种 → 次数兑换（10:1）。
 *
 * 用带条件的 update 做 CAS：同时约束 ember 与 clearAttempts，
 * 读到的值若已被并发改写则 0 条命中，重读重试一次。
 * 这是全项目唯一需要防重复兑换的写路径。
 */
exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();

  for (let tries = 0; tries < 2; tries++) {
    const { data } = await db.collection('users')
      .where({ _id: OPENID })
      .get();

    if (data.length === 0) {
      return { success: false, message: '用户不存在' };
    }

    const user = data[0];
    const { convert, ember, wallet } = convertEmber(user.ember, user.clearAttempts);

    if (convert <= 0) {
      return {
        success: false,
        message: wallet >= WALLET_CAP ? '钱包已满，花一次再收' : '火种不足 10',
        ember: Math.floor(Math.max(user.ember || 0, 0)),
        clearAttempts: user.clearAttempts || 0
      };
    }

    const { stats } = await db.collection('users')
      .where({
        _id: OPENID,
        ember: _.gte(convert * EMBER_PER_ATTEMPT),
        clearAttempts: _.lte(WALLET_CAP - convert)
      })
      .update({
        data: {
          ember: _.inc(-convert * EMBER_PER_ATTEMPT),
          clearAttempts: _.inc(convert)
        }
      });

    if (stats.updated === 1) {
      return {
        success: true,
        converted: convert,
        ember: Math.floor(ember),
        clearAttempts: wallet
      };
    }
    // CAS 未命中：被并发改写，重读重试
  }

  return { success: false, message: '请重试' };
};
```

- [ ] **Step 3: 复制 gameplay.js**

Run（PowerShell）：

```powershell
Copy-Item cloudfunctions/clearFog/gameplay.js cloudfunctions/collectEmber/gameplay.js -Force
```

Expected: 无输出

- [ ] **Step 4: 契约测试加入第 5 份拷贝**

修改 `tests/gameplay-contract.test.js` 的 `PATHS`，并在 `initUser` 之后插入 `collectEmber`，并把标题改为五份：

```js
const PATHS = [
  '../cloudfunctions/clearFog/gameplay',
  '../cloudfunctions/getUserStats/gameplay',
  '../cloudfunctions/initUser/gameplay',
  '../cloudfunctions/collectEmber/gameplay',
  '../miniprogram/utils/gameplay'
];

test('五份 gameplay.js 导出键完全一致', () => {
  const keys = PATHS.map((p) => Object.keys(require(p)).sort());
  assert.deepEqual(keys[0], keys[1]);
  assert.deepEqual(keys[0], keys[2]);
  assert.deepEqual(keys[0], keys[3]);
  assert.deepEqual(keys[0], keys[4]);
});
```

（「同名导出内容一致」那个测试用 `for` 循环遍历 `mods`，无需改动即可覆盖第 5 份。）

- [ ] **Step 5: 跑全部测试**

Run: `node --test`
Expected: 全部 PASS，fail 0

- [ ] **Step 6: 提交**

```bash
git add cloudfunctions/collectEmber tests/gameplay-contract.test.js
git commit -m "feat: add collectEmber cloud function with CAS conversion"
```

---

### Task 7: 统一种子（initUser）

**Files:**
- Modify: `cloudfunctions/initUser/index.js`

> `getUserStats` 的建档分支在 Task 8 一并重写，避免同一文件连改两次。

- [ ] **Step 1: 重写 `cloudfunctions/initUser/index.js`**

完整文件内容：

```js
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { INITIAL_ATTEMPTS } = require('./gameplay');

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();

  // Check if user exists
  const { data } = await db.collection('users').where({ _id: OPENID }).get();

  if (data.length === 0) {
    const nowMs = Date.now();
    await db.collection('users').add({
      data: {
        _id: OPENID,
        clearAttempts: INITIAL_ATTEMPTS,
        attemptUpdatedAtMs: nowMs,
        ember: 0,
        emberUpdatedAtMs: nowMs,
        uncommonCount: 0,
        nightWatchDate: '',
        totalCleared: 0,
        checkInCount: 0,
        lastCheckInDate: '',
        xp: 0,
        createdAt: db.serverDate()
      }
    });
    return {
      isNew: true,
      clearAttempts: INITIAL_ATTEMPTS,
      ember: 0,
      lastCheckInDate: '',
      xp: 0
    };
  }

  return { isNew: false, ...data[0] };
};
```

改动点：种子 5（原来是 5，但缺 `totalCleared`/`checkInCount`，`getUserStats` 建的是 1，两处不一致）+ 补齐 5 个新字段。

- [ ] **Step 2: 跑全部测试**

Run: `node --test`
Expected: 全部 PASS，fail 0

- [ ] **Step 3: 提交**

```bash
git add cloudfunctions/initUser/index.js
git commit -m "fix: unify user seeding to 5 attempts with economy fields"
```

---

### Task 8: getUserStats 惰性结算

**Files:**
- Modify: `cloudfunctions/getUserStats/index.js`

- [ ] **Step 1: 重写 `cloudfunctions/getUserStats/index.js`**

完整文件内容：

```js
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const {
  settleAttempts,
  accrueEmber,
  deriveEmberCounts,
  getLevelByXp,
  regenHint,
  INITIAL_ATTEMPTS,
  EMBER_CAP,
  WALLET_CAP
} = require('./gameplay');

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();

  const { data } = await db.collection('users').where({ _id: OPENID }).get();
  const nowMs = Date.now();

  let user;
  if (data.length === 0) {
    await db.collection('users').add({
      data: {
        _id: OPENID,
        clearAttempts: INITIAL_ATTEMPTS,
        attemptUpdatedAtMs: nowMs,
        ember: 0,
        emberUpdatedAtMs: nowMs,
        uncommonCount: 0,
        nightWatchDate: '',
        totalCleared: 0,
        checkInCount: 0,
        lastCheckInDate: '',
        xp: 0,
        createdAt: db.serverDate()
      }
    });
    user = {
      clearAttempts: INITIAL_ATTEMPTS,
      attemptUpdatedAtMs: nowMs,
      ember: 0,
      emberUpdatedAtMs: nowMs,
      totalCleared: 0,
      checkInCount: 0,
      lastCheckInDate: '',
      xp: 0
    };
  } else {
    user = data[0];
  }

  // ── 惰性结算：自然恢复 + 火种累计 ──
  const settle = settleAttempts({
    attempts: user.clearAttempts,
    attemptUpdatedAtMs: user.attemptUpdatedAtMs,
    nowMs
  });
  const accrual = accrueEmber({
    ember: user.ember,
    emberUpdatedAtMs: user.emberUpdatedAtMs,
    nowMs,
    counts: deriveEmberCounts(user),
    level: getLevelByXp(user.xp || 0)
  });

  const needAttempts = settle.changed;
  const needEmber = accrual.emberUpdatedAtMs !== user.emberUpdatedAtMs;
  if (needAttempts || needEmber) {
    const write = {};
    if (needAttempts) {
      write.clearAttempts = settle.attempts;
      write.attemptUpdatedAtMs = settle.attemptUpdatedAtMs;
    }
    if (needEmber) {
      write.ember = accrual.ember;
      write.emberUpdatedAtMs = accrual.emberUpdatedAtMs;
    }
    await db.collection('users').where({ _id: OPENID }).update({ data: write });
  }

  // Convert cloud avatar URL to temp URL
  let avatarUrl = user.avatarUrl || '';
  if (avatarUrl.startsWith('cloud://')) {
    const { fileList } = await cloud.getTempFileURL({ fileList: [avatarUrl] });
    if (fileList[0] && fileList[0].tempFileURL) {
      avatarUrl = fileList[0].tempFileURL;
    }
  }

  return {
    // 资源
    clearAttempts: settle.attempts,
    attemptUpdatedAtMs: settle.attemptUpdatedAtMs,
    ember: accrual.ember,
    pendingEmber: accrual.pending,
    emberCap: EMBER_CAP,
    walletCap: WALLET_CAP,
    regenHint: regenHint(settle.attempts, settle.attemptUpdatedAtMs, nowMs).text,
    // 原有字段
    lastCheckInDate: user.lastCheckInDate || '',
    createdAt: user.createdAt,
    nickName: user.nickName || '',
    avatarUrl,
    totalCleared: user.totalCleared || 0,
    totalArea: user.totalArea || 0,
    checkInCount: user.checkInCount || 0,
    xp: user.xp || 0,
    badges: user.badges || [],
    rareCount: user.rareCount || 0,
    epicCount: user.epicCount || 0
  };
};
```

改动点说明：

- 建档分支种子与 Task 7 对齐（5 次 + 新字段）。
- 惰性结算：只有 `settle.changed` 或火种时间戳前进时才写库，避免每次打开都写。
- **移除返回值里的 `claimCount` / `claimDate`**（已废弃）。读这两个字段的客户端代码在 Task 12 / 14 删除，读到 `undefined` 时现有表达式安全降级为 0，不会崩。

- [ ] **Step 2: 跑全部测试**

Run: `node --test`
Expected: 全部 PASS，fail 0

- [ ] **Step 3: 提交**

```bash
git add cloudfunctions/getUserStats/index.js
git commit -m "feat: settle attempts and embers lazily in getUserStats"
```

---

### Task 9: 签到每次 +1

**Files:**
- Modify: `cloudfunctions/checkIn/index.js`

- [ ] **Step 1: 重写 `cloudfunctions/checkIn/index.js`**

完整文件内容：

```js
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const today = new Date().toISOString().slice(0, 10);

  const { data } = await db.collection('users')
    .where({ _id: OPENID })
    .get();

  if (data.length === 0) {
    return { success: false, message: '用户不存在' };
  }

  const user = data[0];

  if (user.lastCheckInDate === today) {
    return { success: false, message: '今日已签到' };
  }

  const newCount = (user.checkInCount || 0) + 1;
  const xpGained = 20;
  const gained = 1; // 每次签到都 +1（原为偶数次才给）

  await db.collection('users').where({ _id: OPENID }).update({
    data: {
      checkInCount: _.inc(1),
      lastCheckInDate: today,
      xp: _.inc(xpGained),
      clearAttempts: _.inc(gained)
    }
  });

  return {
    success: true,
    clearAttempts: (user.clearAttempts || 0) + gained,
    lastCheckInDate: today,
    checkInCount: newCount,
    gained,
    xpGained
  };
};
```

说明：这里不主动夹紧钱包上限。若已满 10 仍 +1 得到 11，下一次 `getUserStats` 的 `settleAttempts` 会夹回 10，而 `profile.js` 的 `onCheckIn` 在 toast 后立刻调 `loadStats()`，玩家看不到这个瞬时值。

- [ ] **Step 2: 跑全部测试**

Run: `node --test`
Expected: 全部 PASS，fail 0

- [ ] **Step 3: 提交**

```bash
git add cloudfunctions/checkIn/index.js
git commit -m "feat: grant one clear attempt on every check-in"
```

---

### Task 10: clearFog 改造（范围校验 + 巡夜 + 结算扣减）

**Files:**
- Modify: `cloudfunctions/clearFog/index.js`

- [ ] **Step 1: 更新 import**

把第 8 行：

```js
const { computeRarity, evaluateNewBadges, RARITY_XP_BONUS, BADGE_DEFS } = require('./gameplay');
```

改为：

```js
const {
  computeRarity,
  evaluateNewBadges,
  RARITY_XP_BONUS,
  BADGE_DEFS,
  settleAttempts,
  getClaimRadiusMeters,
  getLevelByXp,
  classifyLanding,
  EMBER_CAP,
  NIGHT_WATCH_EMBER,
  NIGHT_WATCH_XP
} = require('./gameplay');
```

- [ ] **Step 2: 删除 `getClaimLimit` 函数**

删除第 99–115 行整段（`// 等级对应的每日认领次数` 到 `getClaimLimit` 函数结束的右花括号）。

Expected: 文件中不再出现 `claimLimit`、`claimCount`、`claimDate`

- [ ] **Step 3: 整体替换 `exports.main`**

删除现有 `exports.main = async (event, context) => { ... };` 全部内容，替换为：

```js
exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const {
    latitude,
    longitude,
    radius,
    isClaim,
    currentLatitude,
    currentLongitude
  } = event;

  const roundedLat = Math.round(latitude * 10000) / 10000;
  const roundedLng = Math.round(longitude * 10000) / 10000;
  const nowMs = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  const { data: users } = await db.collection('users')
    .where({ _id: OPENID })
    .get();

  if (users.length === 0) {
    return { success: false, message: '用户不存在' };
  }
  const user = users[0];

  // ── 1) 先结算自然恢复（不扣减），后续判定与扣减都用结算后的值 ──
  const settle = settleAttempts({
    attempts: user.clearAttempts,
    attemptUpdatedAtMs: user.attemptUpdatedAtMs,
    nowMs
  });

  // ── 2) 长按认领：范围校验（服务端按 xp 自行推导等级，不信任客户端）──
  const level = getLevelByXp(user.xp || 0);
  if (isClaim) {
    const claimRadius = getClaimRadiusMeters(level);
    if (!claimRadius) {
      return { success: false, message: 'Lv.2 解锁长按认领' };
    }

    const curLat = Number(currentLatitude);
    const curLng = Number(currentLongitude);
    if (!Number.isFinite(curLat) || !Number.isFinite(curLng)) {
      return { success: false, message: '缺少当前位置，无法校验认领范围' };
    }

    const distM = haversineDistance(curLat, curLng, latitude, longitude);
    if (Number.isFinite(claimRadius) && distM > claimRadius) {
      return {
        success: false,
        message: `超出认领范围（最远 ${Math.round(claimRadius / 1000)} km）`,
        claimRadiusMeters: claimRadius
      };
    }
  }

  // ── 3) 重叠判定：最近者定归属（顺带识别巡夜）──
  const OVERLAP_FACTOR = 1.5;
  const overlapDist = radius * OVERLAP_FACTOR; // 2km × 1.5 = 3km
  const latPad = (overlapDist / 6371000) * (180 / Math.PI);
  const lngPad = latPad / Math.cos(latitude * Math.PI / 180);

  const { data: nearby } = await db.collection('cleared_areas')
    .where({
      latitude: _.gte(latitude - latPad).and(_.lte(latitude + latPad)),
      longitude: _.gte(longitude - lngPad).and(_.lte(longitude + lngPad))
    })
    .get();

  const landing = classifyLanding(nearby, latitude, longitude, OPENID, overlapDist);

  if (landing.kind === 'other') {
    return { success: false, message: '这片区域已被其他人点亮，换个地方探索吧' };
  }

  // ── 4) 巡夜：落在自己已点亮的区域上，不扣次数、不写新区域 ──
  if (landing.kind === 'mine') {
    if (user.nightWatchDate === today) {
      return { success: false, message: '今天已经巡过夜了，明天再来' };
    }

    const before = Math.max(Number(user.ember) || 0, 0);
    const after = Math.min(before + NIGHT_WATCH_EMBER, EMBER_CAP);

    await db.collection('users').where({ _id: OPENID }).update({
      data: {
        ember: after,
        nightWatchDate: today,
        xp: _.inc(NIGHT_WATCH_XP)
      }
    });

    return {
      success: true,
      type: 'nightWatch',
      emberGained: after - before,
      ember: after,
      xpGained: NIGHT_WATCH_XP,
      totalXp: (user.xp || 0) + NIGHT_WATCH_XP,
      placeName: landing.area.placeName || '夜巡之地',
      city: landing.area.city || '',
      newBadges: [],
      clearAttempts: settle.attempts,
      isClaim: !!isClaim
    };
  }

  // ── 5) 次数检查（用结算后的值）──
  if (settle.attempts <= 0) {
    return { success: false, message: '驱散次数不足：4 小时后自动恢复，或收取火种' };
  }

  // ── 6) 逆地理编码获取行政区域 ──
  const region = await reverseGeocode(roundedLat, roundedLng);

  // 新城市 / 新行政区（查写入前计数）/ 边疆距离
  let firstInCity = false;
  let firstInDistrict = false;
  if (region.city) {
    const { total: cityCountBefore } = await db.collection('cleared_areas')
      .where({ clearedBy: OPENID, city: region.city })
      .count();
    firstInCity = cityCountBefore === 0;
    if (region.district) {
      const { total: districtCountBefore } = await db.collection('cleared_areas')
        .where({ clearedBy: OPENID, city: region.city, district: region.district })
        .count();
      firstInDistrict = districtCountBefore === 0;
    }
  }

  const nearestDistanceMeters = await findNearestDistanceMeters(latitude, longitude);

  const rarity = computeRarity({
    placeName: region.placeName || '',
    firstInCity,
    firstInDistrict,
    nearestDistanceMeters
  });

  // 记录驱散区域
  const addRes = await db.collection('cleared_areas').add({
    data: {
      latitude: roundedLat,
      longitude: roundedLng,
      radius,
      clearedBy: OPENID,
      province: region.province,
      city: region.city,
      district: region.district,
      placeName: region.placeName,
      rarity,
      createdAt: db.serverDate()
    }
  });

  // XP：基础 + 稀有度 + 新城市 + 新行政区
  const xpGained = 50
    + RARITY_XP_BONUS[rarity]
    + (firstInCity ? 500 : 0)
    + (firstInDistrict ? 50 : 0);

  // ONE fetch for area (limit 1000) — used for union area + cityCount
  const { data: myAreas } = await db.collection('cleared_areas')
    .where({ clearedBy: OPENID })
    .field({ latitude: true, longitude: true, radius: true, city: true, rarity: true })
    .limit(1000)
    .get();

  const totalArea = calcUnionArea(myAreas);
  const citySet = new Set(myAreas.map((a) => a.city).filter(Boolean));
  const isRareOrEpic = rarity === 'rare' || rarity === 'epic';
  const isEpic = rarity === 'epic';

  // 稀有计数：增量维护，避免 1000 行截断回退；legacy 无字段时用扫描播种一次
  let rareCount;
  let epicCount;
  let uncommonCount;
  let rarityCountsWrite;
  if (user.rareCount == null || user.epicCount == null || user.uncommonCount == null) {
    rareCount = myAreas.filter((a) => a.rarity === 'rare' || a.rarity === 'epic').length;
    epicCount = myAreas.filter((a) => a.rarity === 'epic').length;
    uncommonCount = myAreas.filter((a) => a.rarity === 'uncommon').length;
    rarityCountsWrite = { rareCount, epicCount, uncommonCount };
  } else {
    rareCount = user.rareCount + (isRareOrEpic ? 1 : 0);
    epicCount = user.epicCount + (isEpic ? 1 : 0);
    uncommonCount = user.uncommonCount + (rarity === 'uncommon' ? 1 : 0);
    rarityCountsWrite = {
      rareCount: _.inc(isRareOrEpic ? 1 : 0),
      epicCount: _.inc(isEpic ? 1 : 0),
      uncommonCount: _.inc(rarity === 'uncommon' ? 1 : 0)
    };
  }

  const totalCleared = (user.totalCleared || 0) + 1;
  const newXp = (user.xp || 0) + xpGained;

  // 徽章
  const ownedBadges = user.badges || [];
  const newBadgeIds = evaluateNewBadges(
    {
      totalCleared,
      cityCount: citySet.size,
      rareCount,
      epicCount,
      xp: newXp
    },
    ownedBadges
  );

  const badgeMeta = {};
  for (const b of BADGE_DEFS) badgeMeta[b.id] = b;

  // ── 唯一的用户写入：结算 + 扣次数 + 进度 + 徽章 ──
  const updateData = {
    clearAttempts: settle.attempts - 1,
    attemptUpdatedAtMs: nowMs, // 扣减时推进时间戳，防止囤积恢复时长
    totalCleared: _.inc(1),
    totalArea,
    xp: _.inc(xpGained),
    ...rarityCountsWrite
  };
  if (newBadgeIds.length > 0) {
    updateData.badges = _.addToSet({ $each: newBadgeIds });
  }

  try {
    await db.collection('users').where({ _id: OPENID }).update({ data: updateData });
  } catch (err) {
    // 用户写入失败则回滚区域，避免“已点亮但无奖励”的死格
    try {
      await db.collection('cleared_areas').doc(addRes._id).remove();
    } catch (rollbackErr) {
      console.error('rollback cleared_areas failed:', rollbackErr);
    }
    return { success: false, message: '写入失败，请重试' };
  }

  return {
    success: true,
    type: 'clear',
    xpGained,
    totalXp: newXp,
    rarity,
    placeName: region.placeName || '',
    city: region.city || '',
    firstInCity,
    firstInDistrict,
    newBadges: newBadgeIds.map((id) => ({
      id,
      name: badgeMeta[id].name,
      desc: badgeMeta[id].desc
    })),
    areaId: addRes._id,
    clearAttempts: settle.attempts - 1,
    isClaim: !!isClaim
  };
};
```

保留不动的辅助函数：`reverseGeocode`、`calcUnionArea`、`haversineDistance`、`findNearestDistanceMeters`。

- [ ] **Step 4: 自检残留引用**

Run（PowerShell）：

```powershell
Select-String -Path cloudfunctions/clearFog/index.js -Pattern "claimLimit|claimCount|claimDate|getClaimLimit"
```

Expected: 无输出

- [ ] **Step 5: 跑全部测试**

Run: `node --test`
Expected: 全部 PASS，fail 0

- [ ] **Step 6: 提交**

```bash
git add cloudfunctions/clearFog/index.js
git commit -m "feat: merge attempt currency, add ranged claim, night watch, uncommon counter"
```

---

### Task 11: db.js 接口

**Files:**
- Modify: `miniprogram/utils/db.js`

- [ ] **Step 1: 扩展 `clearFog` 签名**

把 `miniprogram/utils/db.js` 第 36–47 行的 `clearFog` 替换为：

```js
/**
 * Clear fog at a location
 * @param {number} latitude
 * @param {number} longitude
 * @param {number} radius - radius in meters
 * @param {boolean} isClaim - 长按认领（服务端会做范围校验）
 * @param {number} currentLatitude - 认领时的当前位置（范围校验用）
 * @param {number} currentLongitude
 */
async function clearFog(latitude, longitude, radius, isClaim, currentLatitude, currentLongitude) {
  const { result } = await wx.cloud.callFunction({
    name: 'clearFog',
    data: {
      latitude,
      longitude,
      radius,
      isClaim: isClaim || false,
      currentLatitude,
      currentLongitude
    }
  });
  return result;
}
```

- [ ] **Step 2: 新增 `collectEmber`**

在 `reverseGeocode` 函数之后、`module.exports` 之前追加：

```js
/**
 * 收取火种并按 10:1 兑换为驱散次数
 */
async function collectEmber() {
  const { result } = await wx.cloud.callFunction({ name: 'collectEmber' });
  return result;
}
```

- [ ] **Step 3: 导出**

把 `module.exports` 改为：

```js
module.exports = {
  initUser,
  getUserInfo,
  checkIn,
  clearFog,
  collectEmber,
  getClearedAreas,
  getUserStats,
  saveProfile,
  getLeaderboard,
  getRegionLeaderboard,
  getMyDiscoveries,
  reverseGeocode
};
```

- [ ] **Step 4: 跑全部测试**

Run: `node --test`
Expected: 全部 PASS，fail 0

- [ ] **Step 5: 提交**

```bash
git add miniprogram/utils/db.js
git commit -m "feat: add collectEmber api and pass current location for claim range"
```

---

### Task 12: fogmap 认领卡（范围显示 + 超范围禁用）

**Files:**
- Modify: `miniprogram/pages/fogmap/fogmap.js`
- Modify: `miniprogram/pages/fogmap/fogmap.wxml`
- Modify: `miniprogram/pages/fogmap/fogmap.wxss`

- [ ] **Step 1: 更新 import**

把 `fogmap.js` 第 4 行：

```js
const { getRarityMeta, getBadgeMeta } = require('../../utils/gameplay');
```

改为：

```js
const {
  getRarityMeta,
  getBadgeMeta,
  getClaimRadiusMeters,
  classifyLanding,
  EMBER_PER_ATTEMPT,
  WALLET_CAP,
  EMBER_CAP
} = require('../../utils/gameplay');
```

（后三个常量 Task 13 用，这里一并引入避免改两次同一行。）

- [ ] **Step 2: 修改 data**

在 `data` 中删除 `claimUsed: 0` 和 `claimLimit: 0` 两行，追加：

```js
    claimDistance: '',
    claimRangeText: '',
    claimOutOfRange: false,
    claimNightWatch: false,
    claimConfirmText: '驱散此处',
```

- [ ] **Step 3: 删除 initUser 里的认领限额计算**

在 `initUser()` 的 `setData` 调用中，删除这一段（第 241–249 行）：

```js
      // 计算认领次数
      const today = new Date().toISOString().slice(0, 10);
      const claimUsed = (stats.claimDate === today) ? (stats.claimCount || 0) : 0;
      const claimLimits = [[7,7],[6,5],[5,4],[4,3],[3,2],[2,1]];
      let claimLimit = 0;
      for (const [lv, limit] of claimLimits) {
        if (userLevel >= lv) { claimLimit = limit; break; }
      }
```

并把 `setData` 的参数从：

```js
      this.setData({
        clearAttempts: stats.clearAttempts || 0,
        claimUsed,
        claimLimit
      });
```

改为：

```js
      this.setData({
        clearAttempts: stats.clearAttempts || 0
      });
```

- [ ] **Step 4: 整体替换 `_handleClaimPress`**

删除现有 `_handleClaimPress(latitude, longitude) { ... }` 全部内容，替换为：

```js
  _handleClaimPress(latitude, longitude) {
    console.log('[claim] long-press detected at', latitude, longitude);

    let userLevel = wx.getStorageSync('userLevel') || 0;
    const LEVELS_XP = [0, 200, 800, 2000, 5000, 10000, 20000];

    const checkAndProceed = (level) => {
      if (level < 2) {
        wx.showToast({ title: 'Lv.2 解锁长按认领', icon: 'none' });
        return;
      }

      const radiusM = getClaimRadiusMeters(level);
      const unlimited = !Number.isFinite(radiusM);

      const openCard = (current) => {
        const distanceM = this._haversine(
          current.latitude, current.longitude, latitude, longitude
        );
        const outOfRange = !unlimited && distanceM > radiusM;

        // 归属判定与服务端同源（最近者定归属）
        const landing = classifyLanding(
          this.allClearedAreas, latitude, longitude, this.myOpenid
        );
        const nightWatch = landing.kind === 'mine';

        let warning = '';
        if (outOfRange) {
          warning = `超出认领范围（最远 ${Math.round(radiusM / 1000)} km）`;
        } else if (landing.kind === 'other') {
          warning = '这片区域已被其他人点亮，换个位置试试';
        }

        const isNight = nightWatch && !warning;

        this.setData({
          claimMode: true,
          claimLat: latitude.toFixed(4),
          claimLng: longitude.toFixed(4),
          claimPlaceName: '',
          claimWarning: warning,
          claimOutOfRange: outOfRange,
          claimNightWatch: isNight,
          claimConfirmText: isNight ? '巡夜' : '驱散此处',
          claimDistance: (distanceM / 1000).toFixed(1),
          claimRangeText: unlimited
            ? '无距离限制'
            : `上限 ${Math.round(radiusM / 1000)} km`,
          claimMarkers: [{
            id: 999,
            latitude,
            longitude,
            width: 30,
            height: 30,
            callout: {
              content: isNight ? '巡夜此处' : '认领此处',
              color: '#ffffff',
              fontSize: 14,
              borderRadius: 8,
              bgColor: isNight ? '#f59e0b' : '#d4a017',
              padding: 8,
              display: 'ALWAYS'
            }
          }]
        });

        // 尝试获取地名
        this.reverseGeocodeClient(latitude, longitude);
      };

      if (this.lastLocation) {
        openCard(this.lastLocation);
      } else {
        this.requestLocation()
          .then((loc) => {
            this.lastLocation = loc;
            openCard(loc);
          })
          .catch(() => {
            wx.showToast({ title: '需要位置权限才能认领', icon: 'none' });
          });
      }
    };

    if (userLevel < 2) {
      db.getUserStats().then((stats) => {
        const xp = stats.xp || 0;
        for (let i = LEVELS_XP.length - 1; i >= 0; i--) {
          if (xp >= LEVELS_XP[i]) { userLevel = i + 1; break; }
        }
        wx.setStorageSync('userLevel', userLevel);
        checkAndProceed(userLevel);
      }).catch((err) => {
        console.error('Get level failed:', err);
        checkAndProceed(userLevel);
      });
    } else {
      checkAndProceed(userLevel);
    }
  },
```

> 行为变化：范围与归属判定都提前到弹卡时，超范围/被占直接禁用确认按钮（复用现有 `claimWarning` 机制）；没有定位权限时不再允许认领（服务端也要求当前定位）。

- [ ] **Step 5: 修改 `onClaimConfirm`**

把函数开头改成（`lastLocation` 守卫必须放在 `wx.showLoading` 之前，避免提前转圈）：

```js
  onClaimConfirm() {
    if (!this.data.claimMode) return;
    if (this.data.claimWarning) return; // 超范围 / 被占：按钮为禁用态，这里兜底
    if (!this.lastLocation) {
      wx.showToast({ title: '需要位置权限才能认领', icon: 'none' });
      return;
    }

    const lat = parseFloat(this.data.claimLat);
    const lng = parseFloat(this.data.claimLng);

    wx.showLoading({ title: '认领驱散中...' });

    db.clearFog(
      lat,
      lng,
      CLEAR_RADIUS,
      true,
      this.lastLocation.latitude,
      this.lastLocation.longitude
    ).then((result) => {
```

并把该 `.then` 回调里这一段：

```js
      this.setData({
        claimMode: false,
        claimMarkers: [],
        latitude: lat,
        longitude: lng,
        scale: LOCATED_SCALE,
        clearAttempts: result.clearAttempts,
        claimUsed: result.claimCount,
        claimLimit: result.claimLimit
      });
```

改为：

```js
      this.setData({
        claimMode: false,
        claimMarkers: [],
        latitude: lat,
        longitude: lng,
        scale: LOCATED_SCALE,
        clearAttempts: result.clearAttempts
      });
```

（`result.type === 'nightWatch'` 的分支在 Task 13 加。）

- [ ] **Step 6: 修改 wxml 认领卡**

把 `fogmap.wxml` 第 74–86 行的整个 `.claim-card` 替换为：

```xml
  <!-- Claim confirm card -->
  <cover-view class="claim-card" wx:if="{{claimMode}}" catchtap="noop">
    <cover-view class="claim-info">
      <cover-view class="claim-label">认领驱散</cover-view>
      <cover-view class="claim-place" wx:if="{{claimPlaceName}}">{{claimPlaceName}}</cover-view>
      <cover-view class="claim-coords" wx:else>{{claimLat}}, {{claimLng}}</cover-view>
      <cover-view class="claim-range">距你 {{claimDistance}} km · {{claimRangeText}}</cover-view>
      <cover-view class="claim-night" wx:if="{{claimNightWatch}}">巡夜：+10 火种（每日 1 次，不耗次数）</cover-view>
      <cover-view class="claim-warning" wx:if="{{claimWarning}}">{{claimWarning}}</cover-view>
    </cover-view>
    <cover-view class="claim-actions">
      <cover-view class="claim-btn claim-cancel" bindtap="onClaimCancel">取消</cover-view>
      <cover-view class="claim-btn {{claimWarning ? 'claim-btn-disabled' : 'claim-confirm'}}" bindtap="onClaimConfirm">{{claimConfirmText}}</cover-view>
    </cover-view>
  </cover-view>
```

- [ ] **Step 7: 追加 wxss**

在 `fogmap.wxss` 的 `/* ── Claim card ── */` 区块内、`.claim-btn-disabled` 规则之后追加：

```css
.claim-range {
  font-size: 22rpx;
  color: rgba(56, 189, 248, 0.85);
  margin-top: 8rpx;
}

.claim-night {
  font-size: 22rpx;
  color: #fbbf24;
  margin-top: 6rpx;
}
```

- [ ] **Step 8: 自检残留引用**

Run（PowerShell）：

```powershell
Select-String -Path miniprogram/pages/fogmap/fogmap.js -Pattern "claimUsed|claimLimit"
Select-String -Path miniprogram/pages/fogmap/fogmap.wxml -Pattern "claimUsed|claimLimit"
```

Expected: 两处均无输出

- [ ] **Step 9: 跑全部测试**

Run: `node --test`
Expected: 全部 PASS，fail 0

- [ ] **Step 10: 提交**

```bash
git add miniprogram/pages/fogmap/fogmap.js miniprogram/pages/fogmap/fogmap.wxml miniprogram/pages/fogmap/fogmap.wxss
git commit -m "feat: show claim range and distance, drop daily claim counter"
```

---

### Task 13: 火种收获卡 + 巡夜结果卡 + 文案

**Files:**
- Modify: `miniprogram/pages/fogmap/fogmap.js`
- Modify: `miniprogram/pages/fogmap/fogmap.wxml`
- Modify: `miniprogram/pages/fogmap/fogmap.wxss`

- [ ] **Step 1: data 追加**

在 `fogmap.js` 的 `data` 中 `result: null` 之后追加：

```js
    emberDisplay: 0,
    emberCap: 30,
    walletCap: 10,
    showEmberCard: false,
    emberCard: { pending: 0, total: 0, cap: 30 }
```

- [ ] **Step 2: initUser 触发收获卡**

把 `initUser()` 里的 `setData` 调用（Task 12 改过后是 `this.setData({ clearAttempts: stats.clearAttempts || 0 });`）改为：

```js
      const ember = stats.ember || 0;
      const walletCap = stats.walletCap || WALLET_CAP;
      const emberCap = stats.emberCap || EMBER_CAP;
      const canCollect = ember >= EMBER_PER_ATTEMPT
        && (stats.clearAttempts || 0) < walletCap;

      this.setData({
        clearAttempts: stats.clearAttempts || 0,
        emberDisplay: Math.floor(ember),
        emberCap,
        walletCap,
        showEmberCard: canCollect,
        emberCard: {
          pending: Math.floor(stats.pendingEmber || 0),
          total: Math.floor(ember),
          cap: emberCap
        }
      });
```

> 判定用**余额**而不是 `pendingEmber`：上次弹卡未收时，下次结算的 `pendingEmber` 趋近 0，用它当条件卡就再也不出现了，而余额其实一直够兑换。

- [ ] **Step 3: 新增收割与文案处理方法**

在 `onResultClose()` 之后追加：

```js
  onEmberCollect() {
    if (this._collectingEmber) return;
    this._collectingEmber = true;

    db.collectEmber().then((res) => {
      this._collectingEmber = false;
      if (!res.success) {
        this.setData({ showEmberCard: false });
        wx.showToast({ title: res.message || '收取失败', icon: 'none' });
        return;
      }
      this.setData({
        showEmberCard: false,
        clearAttempts: res.clearAttempts,
        emberDisplay: res.ember,
        emberCard: { pending: 0, total: res.ember, cap: this.data.emberCap }
      });
      wx.showToast({ title: `+${res.converted} 次驱散`, icon: 'success' });
    }).catch(() => {
      this._collectingEmber = false;
      wx.showToast({ title: '收取失败，请重试', icon: 'none' });
    });
  },

  onEmberDismiss() {
    this.setData({ showEmberCard: false });
  },
```

- [ ] **Step 4: ✦ 流程加巡夜分支**

在 `onClearFog()` 的 `if (!result.success) { ... }` 块之后（即 `return` 结束的 `}` 之后）插入：

```js
        if (result.type === 'nightWatch') {
          return this.setDataAsync({
            clearAttempts: result.clearAttempts,
            emberDisplay: Math.floor(result.ember || 0)
          }).then(() => {
            wx.hideLoading();
            this.showDiscoveryResult(result);
          });
        }
```

放在 `const newArea = { ... };` **之前**——巡夜不写新区域，绝不能 push 进 `allClearedAreas`。

- [ ] **Step 5: 认领流程加巡夜分支**

在 `onClaimConfirm()` 的 `if (!result.success) { ... }` 块之后插入：

```js
      if (result.type === 'nightWatch') {
        this.setData({
          claimMode: false,
          claimMarkers: [],
          clearAttempts: result.clearAttempts,
          emberDisplay: Math.floor(result.ember || 0)
        });
        wx.hideLoading();
        this.showDiscoveryResult(result);
        return;
      }
```

同样放在 `const newArea = { ... };` 之前。

- [ ] **Step 6: 替换 `showDiscoveryResult`**

删除现有 `showDiscoveryResult(payload) { ... }`，替换为：

```js
  showDiscoveryResult(payload) {
    const newBadges = (payload.newBadges || []).map((b) => ({
      ...b,
      icon: (getBadgeMeta(b.id) || {}).icon || '✦'
    }));

    if (payload.type === 'nightWatch') {
      this.setData({
        showResult: true,
        result: {
          type: 'nightWatch',
          placeName: payload.placeName || '夜巡归来',
          city: payload.city || '',
          rarityName: '巡夜',
          rarityColor: '#f59e0b',
          xpGained: payload.xpGained || 0,
          emberGained: payload.emberGained || 0,
          firstInCity: false,
          newBadges
        }
      });
      return;
    }

    const rarityMeta = getRarityMeta(payload.rarity);
    this.setData({
      showResult: true,
      result: {
        type: 'clear',
        placeName: payload.placeName || '未知地点',
        city: payload.city || '',
        rarityName: rarityMeta.name,
        rarityColor: rarityMeta.color,
        xpGained: payload.xpGained || 0,
        emberGained: 0,
        firstInCity: !!payload.firstInCity,
        newBadges
      }
    });
  },
```

- [ ] **Step 7: 次数不足弹窗文案**

把 `onClearFog()` 开头的：

```js
        content: '签到 2 次可获得 1 次驱散机会，去签到吗？',
```

改为：

```js
        content: '4 小时后自动恢复 1 次，签到也可 +1，火种可兑换更多。现在去签到？',
```

- [ ] **Step 8: wxml 结果卡分支**

把 `fogmap.wxml` 第 107–131 行整个结果卡替换为：

```xml
  <!-- Discovery result card -->
  <cover-view class="result-mask" wx:if="{{showResult && result}}" bindtap="onResultClose">
    <cover-view class="result-card" catchtap="noop">
      <cover-view class="result-accent" style="background: {{result.rarityColor}};"></cover-view>
      <cover-view class="result-title">{{result.type === 'nightWatch' ? '巡夜' : '发现地点'}}</cover-view>
      <cover-view class="result-place">{{result.placeName}}</cover-view>
      <cover-view class="result-city" wx:if="{{result.city}}">{{result.city}}</cover-view>
      <cover-view class="result-rarity-row">
        <cover-view class="result-rarity" style="color: {{result.rarityColor}}; border-color: {{result.rarityColor}};">{{result.rarityName}}</cover-view>
      </cover-view>
      <cover-view class="result-ember" wx:if="{{result.type === 'nightWatch'}}">+{{result.emberGained}} 火种</cover-view>
      <cover-view class="result-xp">+{{result.xpGained}} XP</cover-view>
      <cover-view class="result-first" wx:if="{{result.firstInCity}}">新城市解锁 +500</cover-view>
      <cover-view class="result-first" wx:if="{{result.type === 'nightWatch'}}">每日 1 次，不消耗驱散次数</cover-view>
      <cover-view class="result-badges" wx:if="{{result.newBadges.length}}">
        <cover-view class="result-badge-title">获得徽章</cover-view>
        <cover-view class="result-badge" wx:for="{{result.newBadges}}" wx:key="id">
          <cover-view class="result-badge-icon">{{item.icon}}</cover-view>
          <cover-view class="result-badge-text">
            <cover-view class="result-badge-name">{{item.name}}</cover-view>
            <cover-view class="result-badge-desc">{{item.desc}}</cover-view>
          </cover-view>
        </cover-view>
      </cover-view>
      <cover-view class="result-btn" bindtap="onResultClose">继续探索</cover-view>
    </cover-view>
  </cover-view>
```

- [ ] **Step 9: wxml 新增火种收获卡**

在上面结果卡之后、`</view>`（container 结束）之前插入：

```xml
  <!-- Ember harvest card -->
  <cover-view class="ember-mask" wx:if="{{showEmberCard}}" bindtap="onEmberDismiss">
    <cover-view class="ember-card" catchtap="noop">
      <cover-view class="ember-accent"></cover-view>
      <cover-view class="ember-title">火种收获</cover-view>
      <cover-view class="ember-gain" wx:if="{{emberCard.pending > 0}}">+{{emberCard.pending}}</cover-view>
      <cover-view class="ember-total">火种余额 {{emberCard.total}}/{{emberCard.cap}}</cover-view>
      <cover-view class="ember-desc">10 火种可兑换 1 次驱散</cover-view>
      <cover-view class="ember-btn" bindtap="onEmberCollect">收取并兑换</cover-view>
      <cover-view class="ember-later" bindtap="onEmberDismiss">稍后</cover-view>
    </cover-view>
  </cover-view>
```

- [ ] **Step 10: 追加 wxss**

在 `fogmap.wxss` 末尾追加：

```css
/* ── Result: night watch ── */

.result-ember {
  color: #fbbf24;
  font-size: 36rpx;
  font-weight: 700;
  margin-top: 24rpx;
  font-family: 'DIN Alternate', 'Menlo', monospace;
}

/* ── Ember harvest card (cover-view safe) ── */

.ember-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 99999;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 60rpx;
}

.ember-card {
  width: 100%;
  background: #181d2e;
  border: 1rpx solid rgba(245, 158, 11, 0.35);
  border-radius: 32rpx;
  padding: 48rpx 40rpx 40rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.ember-accent {
  width: 80rpx;
  height: 6rpx;
  border-radius: 3rpx;
  background: #f59e0b;
  margin-bottom: 28rpx;
}

.ember-title {
  color: rgba(255, 255, 255, 0.4);
  font-size: 24rpx;
  letter-spacing: 6rpx;
}

.ember-gain {
  color: #fbbf24;
  font-size: 64rpx;
  font-weight: 700;
  margin-top: 20rpx;
  font-family: 'DIN Alternate', 'Menlo', monospace;
}

.ember-total {
  color: #f0f4ff;
  font-size: 28rpx;
  margin-top: 16rpx;
}

.ember-desc {
  color: rgba(255, 255, 255, 0.45);
  font-size: 24rpx;
  margin-top: 8rpx;
  text-align: center;
}

.ember-btn {
  width: 100%;
  height: 88rpx;
  line-height: 88rpx;
  margin-top: 40rpx;
  background: #d4a017;
  color: #fff;
  font-size: 32rpx;
  font-weight: 600;
  letter-spacing: 4rpx;
  border-radius: 999rpx;
  text-align: center;
}

.ember-later {
  margin-top: 24rpx;
  color: rgba(255, 255, 255, 0.4);
  font-size: 26rpx;
}
```

- [ ] **Step 11: 跑全部测试**

Run: `node --test`
Expected: 全部 PASS，fail 0

- [ ] **Step 12: 提交**

```bash
git add miniprogram/pages/fogmap/fogmap.js miniprogram/pages/fogmap/fogmap.wxml miniprogram/pages/fogmap/fogmap.wxss
git commit -m "feat: add ember harvest card and night watch result"
```

---

### Task 14: profile 等级奖励、资源状态条、文案

**Files:**
- Modify: `miniprogram/pages/profile/profile.js`
- Modify: `miniprogram/pages/profile/profile.wxml`
- Modify: `miniprogram/pages/profile/profile.wxss`

- [ ] **Step 1: 替换 LEVELS 奖励文案**

把 `profile.js` 第 6–14 行的 `LEVELS` 数组替换为（等级名沿用现值，只有 `unlock` 换成范围制）：

```js
const LEVELS = [
  { name: '微光',   xp: 0,     unlock: '' },
  { name: '火种',   xp: 200,   unlock: '长按地图认领，范围 15 公里' },
  { name: '烛光',   xp: 800,   unlock: '认领范围扩至 30 公里，高倍缩放可见星座连线特效' },
  { name: '火炬',   xp: 2000,  unlock: '认领范围扩至 60 公里' },
  { name: '篝火',   xp: 5000,  unlock: '认领范围扩至 150 公里' },
  { name: '星火',   xp: 10000, unlock: '认领范围扩至 500 公里' },
  { name: '曙光',   xp: 20000, unlock: '认领范围无限制，排行榜「世界点亮者」标识' }
];
```

- [ ] **Step 2: data 增删**

在 `data` 中删除 `checkInProgress: 0`，追加：

```js
    emberDisplay: 0,
    emberCap: 30,
    walletCap: 10,
    regenText: '',
```

- [ ] **Step 3: loadStats 删除认领限额、加资源字段**

删除这段（第 106–119 行）：

```js
      const claimLimits = [[2,1],[3,2],[4,3],[5,4],[6,5],[7,7]];
      const allLevels = LEVELS.map((l, i) => {
        const lv = i + 1;
        const claimEntry = claimLimits.find(c => c[0] === lv);
        const claimText = claimEntry ? `认领${claimEntry[1]}次/天` : '';
        return {
          lv,
          name: l.name,
          xp: l.xp,
          xpText: l.xp > 0 ? `${l.xp} XP` : '初始',
          unlock: l.unlock || claimText || '',
          current: lv === level.level
        };
      });
```

替换为：

```js
      const allLevels = LEVELS.map((l, i) => ({
        lv: i + 1,
        name: l.name,
        xp: l.xp,
        xpText: l.xp > 0 ? `${l.xp} XP` : '初始',
        unlock: l.unlock || '',
        current: (i + 1) === level.level
      }));
```

在 `const update = {` 的对象里，把 `clearAttempts: stats.clearAttempts || 0,` 那一行之后插入：

```js
        emberDisplay: Math.floor(stats.ember || 0),
        emberCap: stats.emberCap || 30,
        walletCap: stats.walletCap || 10,
        regenText: stats.regenHint || '',
```

并删除 `checkInProgress: checkInCount % 2,` 一行（`checkInCount` 保留）。

- [ ] **Step 4: 签到 toast 文案**

把 `onCheckIn()` 里的：

```js
        let msg = '签到成功';
        if (result.gained) msg += '，获得 1 次驱散';
        msg += ` +${result.xpGained || 20} XP`;
        wx.showToast({ title: msg, icon: 'success' });
```

替换为：

```js
        const msg = `签到成功，+1 次驱散 +${result.xpGained || 20} XP`;
        wx.showToast({ title: msg, icon: 'success' });
```

- [ ] **Step 5: wxml 加资源状态条**

在 `profile.wxml` 的 `<!-- Stats row -->` 区块（`.stats-row` 结束 `</view>` 之后）插入：

```xml
  <!-- Resource bar -->
  <view class="resource-bar">
    <view class="resource-item">
      <view class="resource-dot" style="background: #f59e0b;"></view>
      <text class="resource-text">火种 {{emberDisplay}}/{{emberCap}}</text>
    </view>
    <view class="resource-divider"></view>
    <view class="resource-item">
      <view class="resource-dot" style="background: #38bdf8;"></view>
      <text class="resource-text">次数 {{clearAttempts}}/{{walletCap}}</text>
    </view>
    <view class="resource-divider"></view>
    <view class="resource-item">
      <text class="resource-text resource-hint">{{regenText}}</text>
    </view>
  </view>
```

- [ ] **Step 6: wxml 签到与规则文案**

把签到面板里的：

```xml
      <text class="checkin-sub">累计签到 2 次获得 1 次驱散机会（{{checkInProgress}}/2）</text>
```

改为：

```xml
      <text class="checkin-sub">每日签到 +1 次驱散 +20 XP</text>
```

把驱散说明里的：

```xml
        <text class="rule-text">长按地图可在任意位置认领驱散（Lv.2 解锁）</text>
```

改为：

```xml
        <text class="rule-text">长按地图可在范围内认领驱散（Lv.2 解锁 15 公里，随等级扩大到无限制）</text>
```

把：

```xml
        <text class="rule-text">签到 2 次获得 1 次驱散机会，认领次数随等级提升</text>
```

改为：

```xml
        <text class="rule-text">每日签到 +1 次驱散，收取火种可兑换更多次数（10 火种 = 1 次）</text>
```

- [ ] **Step 7: wxss 加状态条样式**

在 `profile.wxss` 末尾追加：

```css
/* ── Resource bar ── */

.resource-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  padding: 22rpx 32rpx;
  margin-bottom: 28rpx;
  background: rgba(255, 255, 255, 0.04);
  border: 1rpx solid rgba(255, 255, 255, 0.08);
  border-radius: 20rpx;
}

.resource-item {
  display: flex;
  align-items: center;
  gap: 10rpx;
}

.resource-dot {
  width: 14rpx;
  height: 14rpx;
  border-radius: 50%;
  flex-shrink: 0;
}

.resource-text {
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.7);
  font-family: 'DIN Alternate', 'Menlo', monospace;
}

.resource-hint {
  color: rgba(255, 255, 255, 0.4);
}

.resource-divider {
  width: 1rpx;
  height: 24rpx;
  background: rgba(255, 255, 255, 0.12);
}
```

- [ ] **Step 8: 自检残留引用**

Run（PowerShell）：

```powershell
Select-String -Path miniprogram/pages/profile/profile.js -Pattern "claimLimits|checkInProgress"
Select-String -Path miniprogram/pages/profile/profile.wxml -Pattern "checkInProgress"
```

Expected: 三处均无输出

- [ ] **Step 9: 跑全部测试**

Run: `node --test`
Expected: 全部 PASS，fail 0

- [ ] **Step 10: 提交**

```bash
git add miniprogram/pages/profile/profile.js miniprogram/pages/profile/profile.wxml miniprogram/pages/profile/profile.wxss
git commit -m "feat: show resource bar and ranged claim level rewards"
```

---

### Task 15: 全量测试、部署、手工验证

**Files:**
- 无代码改动（部署 + 验证）

- [ ] **Step 1: 跑全量单测**

Run: `node --test`
Expected: 全部 PASS，fail 0。若有失败，先修复再继续，不要带着红灯部署。

- [ ] **Step 2: 部署云函数**

微信开发者工具 → 云开发 → 对下列每个目录**右键 →「上传并部署：云端安装依赖」**：

1. `cloudfunctions/clearFog`
2. `cloudfunctions/getUserStats`
3. `cloudfunctions/initUser`
4. `cloudfunctions/checkIn`
5. `cloudfunctions/collectEmber`（新函数，必须首次部署）

> `uploadCloudFunction.sh` 只部署 `quickstartFunctions`，对本计划无效，不要用它。

Expected: 五个函数在云开发控制台可见，`collectEmber` 首次出现

- [ ] **Step 3: 手工验证清单**

按顺序执行，全部符合预期才算完成：

| # | 操作 | 预期 |
|---|---|---|
| 1 | 新注册用户打开小程序 | `users` 文档：`clearAttempts = 5`、`ember = 0`、`attemptUpdatedAtMs`/`emberUpdatedAtMs` 存在 |
| 2 | 「我的」页签到 | toast「+1 次驱散 +20 XP」；**连续两天各签一次都给次数**（不再是隔天给） |
| 3 | 「我的」页状态条 | 显示「火种 0/30 · 次数 n/10」+ 恢复提示（≥3 显示「保底已满」） |
| 4 | Lv1 长按地图 | toast「Lv.2 解锁长按认领」 |
| 5 | Lv2 长按 >15km 处 | 认领卡显示「距你 xx km · 上限 15 km」，**确认按钮禁用**（灰） |
| 6 | Lv2 长按 ≤15km 空白处 | 确认可用，成功后次数 −1，地图出现新圆 |
| 7 | 点**自己**已点亮区域（✦ 或长按） | 结果卡「巡夜」，`+10 火种` `+10 XP`，**次数不减**，`cleared_areas` 无新增行 |
| 8 | 再点一次同一区域 | toast「今天已经巡过夜了，明天再来」 |
| 9 | 点**他人**已点亮区域 | toast「这片区域已被其他人点亮…」 |
| 10 | 火种 ≥10 且次数 <10 时打开地图 | 弹「火种收获」卡，点「收取并兑换」→ toast「+1 次驱散」，`ember` 减 10、`clearAttempts` 加 1 |
| 11 | 次数 = 10 时再打开 | 收获卡**不弹**（钱包满） |
| 12 | 火种 18、点收取 | 兑 1 次，余额余 8（10:1 向下取整） |
| 13 | 次数降到 0 后等 4 小时（或控制台改 `attemptUpdatedAtMs` 回拨 4h） | 再查 `getUserStats` 次数 +1 |
| 14 | 次数 = 0 时点 ✦ | 弹窗文案「4 小时后自动恢复 1 次，签到也可 +1，火种可兑换更多…」 |
| 15 | 「我的」页等级详情 | Lv2–Lv7 显示半径文案，**无「认领 N 次/天」** |
| 16 | 把 `users.uncommonCount` 置 null 后驱散一个少见地点 | `uncommonCount` 被播种为正确值而非 1（legacy 播种分支） |

- [ ] **Step 4: 收尾提交（如有遗留改动）**

Run（PowerShell）：

```powershell
git status --short
```

Expected: 只剩用户自己的 `miniprogram/pages/leaderboard/leaderboard.wxss`（**不要提交它**）。若本计划产生其它遗留改动，说明有步骤漏提交，回到对应任务补 `git add <该任务列出的文件>`。

---

## 计划自检（写完后核对）

- **Spec 覆盖**：§4.1 双轨入账 → Task 1/2/9；§4.2 结算规则 → Task 1/8/10；§5 半径表 → Task 3/10/12/14；§6 火种 → Task 2/8；§7 巡夜 → Task 4/10/13；§8 收割交互 → Task 6/11/13；§9 数据模型 → Task 7/8/10；§10 云函数表 → Task 6–10；§11 客户端 → Task 11–14；§12 可测性与五份拷贝 → Task 5/6；§15 测试清单 → Task 1–5 + Task 15。
- **已知取舍**：`clearFog` 的「检查次数与扣减非原子」为既有问题，spec §2 列为非目标，本期不修；`collectEmber` 是唯一新增的 CAS 写路径。
- **部署顺序**：服务端（Task 6/8/9/10）与客户端（Task 11–14）必须一起上线，见 Task 15 Step 2。
