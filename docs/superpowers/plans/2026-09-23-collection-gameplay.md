# 图鉴收集玩法改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「星星之火」从无脑点击改成轻量收集游戏：每次驱散可能发现不同稀有度的地点，徽章提供中期目标，图鉴成为核心页面。

**Architecture:** 纯逻辑（稀有度、徽章判定）放在 `cloudfunctions/clearFog/gameplay.js`，用 `node --test` 做 TDD；云函数写入稀有度与徽章并返回给前端；前端只负责展示结果卡片、图鉴、徽章墙。不做社交、不做 PvP，符合个人小程序限制。

**Tech Stack:** 微信小程序（WXML/WXSS/JS）、微信云开发云函数（wx-server-sdk）、Node.js 内置 `node:test`。

**范围说明（Scope）：** 本计划只覆盖「图鉴收集」主轴，完成后即可玩起来。以下两块**另开计划**，不要塞进本次：
- 计划 B：驱散前预览/更重的地点选择策略
- 计划 C：全服点亮进度（共享世界状态，非社交）

---

## 玩法规则（实现时以此为准）

### 稀有度

输入：`placeName`、`firstInCity`、`firstInDistrict`、`nearestDistanceMeters`（到任意已有驱散点的最近距离；50km 内没有则记为 `100000`）。

| 等级 | id | 名称 | 条件（score 累加） | XP 加成 |
|------|-----|------|-------------------|---------|
| 常见 | `common` | 常见 | score &lt; 1 | +0 |
| 少见 | `uncommon` | 少见 | score ≥ 1 | +30 |
| 珍稀 | `rare` | 珍稀 | score ≥ 3 | +100 |
| 史诗 | `epic` | 史诗 | score ≥ 5 | +250 |

score 规则：
- `firstInCity` → +3
- `firstInDistrict` → +1
- `nearestDistanceMeters ≥ 50000` → +2；`≥ 20000` → +1
- `placeName` 命中稀有词/稀有短名后缀 → +3（保证至少珍稀）；命中少见词/少见短名后缀 → +1（互斥，取高）
- 非字符串 `placeName`（如 `null`）归一为 `''` 再匹配，不抛错

稀有词（多字词，不含单字）：`古镇 古城 遗址 森林 湿地 瀑布 峡谷 沙漠 草原 温泉 雪山 火山 海岛 海滨 湖泊 溶洞 石林 冰川 戈壁 山脉 名山 圣山`
稀有短名后缀（仅 2–3 字名结尾命中）：`山 峰 湖 岛 峡 瀑 峪 崖`（如「香山」「西湖」）
少见词（多字词）：`公园 广场 寺庙 古寺 古塔 古桥 大学 博物馆 纪念馆 故居 陵园 书院 港口 海湾 园林 动物园 植物园 美术馆 科技馆 大桥`
少见短名后缀（仅 2–3 字名结尾命中）：`寺 庙 塔 桥 陵 湾`（如「法源寺」）

注意：`上海`、`中山公园` 等不得因单字「海」「山」误判为稀有。

### XP

```
xpGained = 50 + rarityBonus[rarity] + (firstInCity ? 500 : 0) + (firstInDistrict ? 50 : 0)
```

去掉旧逻辑里「新城市 +500」的重复计算。

### 徽章（首次满足即写入 `users.badges`）

| id | 名称 | 条件 |
|----|------|------|
| `first_light` | 初火 | `totalCleared ≥ 1` |
| `spark_10` | 启明 | `totalCleared ≥ 10` |
| `spark_50` | 燎原 | `totalCleared ≥ 50` |
| `city_3` | 游城 | `cityCount ≥ 3` |
| `city_10` | 行省 | `cityCount ≥ 10` |
| `rare_1` | 秘境 | `rareCount ≥ 1`（rare 或 epic） |
| `epic_1` | 史诗 | `epicCount ≥ 1` |
| `max_level` | 世界点亮者 | `xp ≥ 20000` |

### 前端行为

- 图鉴**取消 Lv.4 锁**，所有用户可进。
- 驱散/认领成功后弹「发现卡片」：地名、稀有度、+XP、新徽章。
- 个人页增加「徽章墙」。
- 图鉴展示稀有度色点、收集统计（总发现 / 珍稀以上 / 城市数）。

---

## File Structure

| 文件 | 职责 |
|------|------|
| `cloudfunctions/clearFog/gameplay.js` | 纯逻辑：稀有度、徽章目录与判定（服务端权威） |
| `tests/gameplay.test.js` | `node --test` 单测 |
| `cloudfunctions/clearFog/index.js` | 接入稀有度/徽章/新 XP，写库并返回 |
| `cloudfunctions/getUserStats/index.js` | 返回 `badges`、`rareCount`、`epicCount` |
| `cloudfunctions/getMyDiscoveries/index.js` | 返回 `rarity`，并附收集汇总 |
| `miniprogram/utils/gameplay.js` | 前端展示元数据：稀有度颜色文案、徽章目录 |
| `miniprogram/pages/fogmap/fogmap.js` + `.wxml` + `.wxss` | 发现结果卡片 |
| `miniprogram/pages/discovery/discovery.js` + `.wxml` + `.wxss` | 图鉴升级 |
| `miniprogram/pages/profile/profile.js` + `.wxml` + `.wxss` | 徽章墙 |

---

### Task 1: 稀有度纯逻辑

**Files:**
- Create: `cloudfunctions/clearFog/gameplay.js`
- Test: `tests/gameplay.test.js`

- [x] **Step 1: 写失败测试**

创建 `tests/gameplay.test.js`：

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeRarity, RARITY_XP_BONUS } = require('../cloudfunctions/clearFog/gameplay');

test('无特征地点为 common', () => {
  const r = computeRarity({
    placeName: '某小区门口',
    firstInCity: false,
    firstInDistrict: false,
    nearestDistanceMeters: 500
  });
  assert.equal(r, 'common');
});

test('新城市+新区 → rare', () => {
  const r = computeRarity({
    placeName: '某小区门口',
    firstInCity: true,
    firstInDistrict: true,
    nearestDistanceMeters: 500
  });
  // 3 + 1 = 4 → rare
  assert.equal(r, 'rare');
});

test('仅新行政区 +1 → uncommon', () => {
  const r = computeRarity({
    placeName: '某路',
    firstInCity: false,
    firstInDistrict: true,
    nearestDistanceMeters: 500
  });
  assert.equal(r, 'uncommon');
});

test('边疆 50km 外 +2 → uncommon', () => {
  const r = computeRarity({
    placeName: '空地',
    firstInCity: false,
    firstInDistrict: false,
    nearestDistanceMeters: 60000
  });
  assert.equal(r, 'uncommon');
});

test('稀有词 +3 → rare', () => {
  const r = computeRarity({
    placeName: '香山',
    firstInCity: false,
    firstInDistrict: false,
    nearestDistanceMeters: 500
  });
  assert.equal(r, 'rare');
});

test('新城市 + 稀有词 + 边疆 → epic', () => {
  const r = computeRarity({
    placeName: '西湖',
    firstInCity: true,
    firstInDistrict: true,
    nearestDistanceMeters: 80000
  });
  // 3+1+2+3 = 9 → epic
  assert.equal(r, 'epic');
});

test('少见词与稀有词互斥取高', () => {
  // 「森林公园」含稀有词「森林」(+3)，不叠加少见词「公园」
  const r = computeRarity({
    placeName: '奥林匹克森林公园',
    firstInCity: false,
    firstInDistrict: false,
    nearestDistanceMeters: 500
  });
  assert.equal(r, 'rare');
});

test('null placeName 不抛错且为 common', () => {
  const r = computeRarity({
    placeName: null,
    firstInCity: false,
    firstInDistrict: false,
    nearestDistanceMeters: 500
  });
  assert.equal(r, 'common');
});

test('中山公园不是稀有（不因「山」误判）', () => {
  const r = computeRarity({
    placeName: '中山公园',
    firstInCity: false,
    firstInDistrict: false,
    nearestDistanceMeters: 500
  });
  assert.equal(r, 'uncommon');
});

test('上海不因单字「海」误判稀有', () => {
  const r = computeRarity({
    placeName: '上海',
    firstInCity: false,
    firstInDistrict: false,
    nearestDistanceMeters: 500
  });
  assert.equal(r, 'common');
});

test('法源寺 2–3 字后缀 → uncommon', () => {
  const r = computeRarity({
    placeName: '法源寺',
    firstInCity: false,
    firstInDistrict: false,
    nearestDistanceMeters: 500
  });
  assert.equal(r, 'uncommon');
});

test('香山仍为稀有（短名后缀）', () => {
  const r = computeRarity({
    placeName: '香山',
    firstInCity: false,
    firstInDistrict: false,
    nearestDistanceMeters: 500
  });
  assert.equal(r, 'rare');
});

test('RARITY_XP_BONUS 覆盖四档', () => {
  assert.deepEqual(RARITY_XP_BONUS, {
    common: 0,
    uncommon: 30,
    rare: 100,
    epic: 250
  });
});
```

- [x] **Step 2: 运行测试确认失败**

```bash
cd "D:/test/lightworld - 副本"
node --test tests/gameplay.test.js
```

Expected: FAIL，提示 `Cannot find module .../gameplay`

- [x] **Step 3: 写最小实现**

创建 `cloudfunctions/clearFog/gameplay.js`：

```js
const RARE_KEYWORDS = [
  '古镇', '古城', '遗址', '森林', '湿地', '瀑布', '峡谷',
  '沙漠', '草原', '温泉', '雪山', '火山', '海岛', '海滨',
  '湖泊', '溶洞', '石林', '冰川', '戈壁', '山脉', '名山', '圣山'
];

// 仅当名称为 2–3 字且以这些字结尾时视为稀有（如「香山」「西湖」）
const RARE_SUFFIX = ['山', '峰', '湖', '岛', '峡', '瀑', '峪', '崖'];

const UNCOMMON_KEYWORDS = [
  '公园', '广场', '寺庙', '古寺', '古塔', '古桥', '大学',
  '博物馆', '纪念馆', '故居', '陵园', '书院', '港口', '海湾',
  '园林', '动物园', '植物园', '美术馆', '科技馆', '大桥'
];

// 仅当名称为 2–3 字且以这些字结尾时视为少见（如「法源寺」）
const UNCOMMON_SUFFIX = ['寺', '庙', '塔', '桥', '陵', '湾'];

const RARITY_XP_BONUS = {
  common: 0,
  uncommon: 30,
  rare: 100,
  epic: 250
};

function hasRareName(name) {
  if (RARE_KEYWORDS.some((k) => name.includes(k))) return true;
  if (name.length >= 2 && name.length <= 3 && RARE_SUFFIX.some((s) => name.endsWith(s))) return true;
  return false;
}

function hasUncommonName(name) {
  if (UNCOMMON_KEYWORDS.some((k) => name.includes(k))) return true;
  if (name.length >= 2 && name.length <= 3 && UNCOMMON_SUFFIX.some((s) => name.endsWith(s))) return true;
  return false;
}

/**
 * @param {{placeName?:string, firstInCity?:boolean, firstInDistrict?:boolean, nearestDistanceMeters?:number}} input
 * @returns {'common'|'uncommon'|'rare'|'epic'}
 */
function computeRarity(input) {
  const {
    placeName,
    firstInCity = false,
    firstInDistrict = false,
    nearestDistanceMeters = 0
  } = input || {};

  const name = typeof placeName === 'string' ? placeName : '';

  let score = 0;
  if (firstInCity) score += 3;
  if (firstInDistrict) score += 1;
  if (nearestDistanceMeters >= 50000) score += 2;
  else if (nearestDistanceMeters >= 20000) score += 1;

  if (hasRareName(name)) score += 3;
  else if (hasUncommonName(name)) score += 1;

  if (score >= 5) return 'epic';
  if (score >= 3) return 'rare';
  if (score >= 1) return 'uncommon';
  return 'common';
}

module.exports = {
  computeRarity,
  RARITY_XP_BONUS,
  RARE_KEYWORDS,
  RARE_SUFFIX,
  UNCOMMON_KEYWORDS,
  UNCOMMON_SUFFIX
};
```

- [x] **Step 4: 运行测试确认通过**

```bash
cd "D:/test/lightworld - 副本"
node --test tests/gameplay.test.js
```

Expected: 全部 PASS

- [x] **Step 5: Commit**

```bash
git add cloudfunctions/clearFog/gameplay.js tests/gameplay.test.js
git commit -m "feat: add rarity scoring logic with unit tests"
```

---

### Task 2: 徽章纯逻辑

**Files:**
- Modify: `cloudfunctions/clearFog/gameplay.js`
- Test: `tests/gameplay.test.js`

- [x] **Step 1: 追加失败测试**

在 `tests/gameplay.test.js` 末尾追加：

```js
const { evaluateNewBadges, BADGE_DEFS } = require('../cloudfunctions/clearFog/gameplay');

test('首次驱散得初火', () => {
  const earned = evaluateNewBadges(
    { totalCleared: 1, cityCount: 1, rareCount: 0, epicCount: 0, xp: 50 },
    []
  );
  assert.deepEqual(earned, ['first_light']);
});

test('已拥有的徽章不重复发放', () => {
  const earned = evaluateNewBadges(
    { totalCleared: 1, cityCount: 1, rareCount: 0, epicCount: 0, xp: 50 },
    ['first_light']
  );
  assert.deepEqual(earned, []);
});

test('一次可发放多个徽章', () => {
  const earned = evaluateNewBadges(
    { totalCleared: 10, cityCount: 3, rareCount: 1, epicCount: 0, xp: 2000 },
    []
  );
  assert.deepEqual(earned.sort(), ['city_3', 'first_light', 'rare_1', 'spark_10'].sort());
});

test('史诗徽章只看 epicCount', () => {
  const earned = evaluateNewBadges(
    { totalCleared: 1, cityCount: 1, rareCount: 1, epicCount: 0, xp: 50 },
    []
  );
  assert.ok(!earned.includes('epic_1'));
  const earned2 = evaluateNewBadges(
    { totalCleared: 1, cityCount: 1, rareCount: 1, epicCount: 1, xp: 50 },
    []
  );
  assert.ok(earned2.includes('epic_1'));
});

test('满级徽章 xp>=20000', () => {
  const earned = evaluateNewBadges(
    { totalCleared: 1, cityCount: 1, rareCount: 0, epicCount: 0, xp: 20000 },
    []
  );
  assert.ok(earned.includes('max_level'));
});

test('BADGE_DEFS 含 8 个徽章', () => {
  assert.equal(BADGE_DEFS.length, 8);
});
```

- [x] **Step 2: 运行测试确认失败**

```bash
cd "D:/test/lightworld - 副本"
node --test tests/gameplay.test.js
```

Expected: FAIL，`evaluateNewBadges is not a function`

- [x] **Step 3: 在 gameplay.js 中追加徽章逻辑**

在 `module.exports` 之前追加：

```js
const BADGE_DEFS = [
  { id: 'first_light', name: '初火', desc: '完成首次驱散', check: (s) => s.totalCleared >= 1 },
  { id: 'spark_10', name: '启明', desc: '驱散 10 次', check: (s) => s.totalCleared >= 10 },
  { id: 'spark_50', name: '燎原', desc: '驱散 50 次', check: (s) => s.totalCleared >= 50 },
  { id: 'city_3', name: '游城', desc: '发现 3 座城市', check: (s) => s.cityCount >= 3 },
  { id: 'city_10', name: '行省', desc: '发现 10 座城市', check: (s) => s.cityCount >= 10 },
  { id: 'rare_1', name: '秘境', desc: '发现珍稀地点', check: (s) => s.rareCount >= 1 },
  { id: 'epic_1', name: '史诗', desc: '发现史诗地点', check: (s) => s.epicCount >= 1 },
  { id: 'max_level', name: '世界点亮者', desc: '达到最高等级', check: (s) => s.xp >= 20000 }
];

/**
 * @param {{totalCleared:number, cityCount:number, rareCount:number, epicCount:number, xp:number}} state
 * @param {string[]} ownedIds
 * @returns {string[]} newly earned badge ids
 */
function evaluateNewBadges(state, ownedIds) {
  const owned = new Set(ownedIds || []);
  const earned = [];
  for (const badge of BADGE_DEFS) {
    if (!owned.has(badge.id) && badge.check(state)) {
      earned.push(badge.id);
    }
  }
  return earned;
}
```

并把 `module.exports` 改为：

```js
module.exports = {
  computeRarity,
  evaluateNewBadges,
  BADGE_DEFS,
  RARITY_XP_BONUS,
  RARE_KEYWORDS,
  RARE_SUFFIX,
  UNCOMMON_KEYWORDS,
  UNCOMMON_SUFFIX
};
```

- [x] **Step 4: 运行测试确认通过**

```bash
cd "D:/test/lightworld - 副本"
node --test tests/gameplay.test.js
```

Expected: 全部 PASS

- [x] **Step 5: Commit**

```bash
git add cloudfunctions/clearFog/gameplay.js tests/gameplay.test.js
git commit -m "feat: add badge evaluation logic with unit tests"
```

---

### Task 3: clearFog 接入稀有度 / 徽章 / 新 XP

**Files:**
- Modify: `cloudfunctions/clearFog/index.js`

- [x] **Step 1: 在 index.js 顶部引入 gameplay**

在 `const _ = db.command;` 之后加：

```js
const { computeRarity, evaluateNewBadges, RARITY_XP_BONUS, BADGE_DEFS } = require('./gameplay');
```

- [x] **Step 2: 加「最近驱散点距离」辅助函数**

在 `getClaimLimit` 之后追加：

```js
async function findNearestDistanceMeters(latitude, longitude) {
  const pad = 0.8; // ~80km 粗筛，与边疆判定尺度匹配
  const { data: nearby } = await db.collection('cleared_areas')
    .where({
      latitude: _.gte(latitude - pad).and(_.lte(latitude + pad)),
      longitude: _.gte(longitude - pad).and(_.lte(longitude + pad))
    })
    .field({ latitude: true, longitude: true })
    .limit(200)
    .get();

  if (nearby.length === 0) return 100000;

  let min = Infinity;
  for (const a of nearby) {
    const d = haversineDistance(latitude, longitude, a.latitude, a.longitude);
    if (d < min) min = d;
  }
  return min === Infinity ? 100000 : min;
}
```

注意：此函数在**写入新记录之前**调用，避免把自己算进去。

- [x] **Step 3: 替换 XP 段与结果返回**

把从 `const user = users[0];` 到 `return result;` 之前的整段替换为（注意：用户写入只在 `cleared_areas.add` 成功后执行一次，校验阶段不扣次数）：

```js
  const user = users[0];
  const today = new Date().toISOString().slice(0, 10);

  // —— 仅校验，不扣次数 ——
  if (isClaim) {
    if ((user.xp || 0) < 200) {
      return { success: false, message: 'Lv.2 解锁认领驱散' };
    }
    const claimLimit = getClaimLimit(user.xp || 0);
    const claimCount = (user.claimDate === today) ? (user.claimCount || 0) : 0;
    if (claimCount >= claimLimit) {
      return { success: false, message: '超过当日认领驱散次数' };
    }
  } else {
    if (user.clearAttempts <= 0) {
      return { success: false, message: '驱散次数不足，签到获取次数' };
    }
  }

  // 逆地理编码获取行政区域
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

  // ONE fetch for area + stats (limit 1000)
  const { data: myAreas } = await db.collection('cleared_areas')
    .where({ clearedBy: OPENID })
    .field({ latitude: true, longitude: true, radius: true, city: true, rarity: true })
    .limit(1000)
    .get();
  const totalArea = calcUnionArea(myAreas);
  const citySet = new Set(myAreas.map((a) => a.city).filter(Boolean));
  const rareCount = myAreas.filter((a) => a.rarity === 'rare' || a.rarity === 'epic').length;
  const epicCount = myAreas.filter((a) => a.rarity === 'epic').length;
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

  // —— 唯一的用户写入：扣次数 + 进度 + 徽章 ——
  const updateData = {
    totalCleared: _.inc(1),
    totalArea,
    xp: _.inc(xpGained),
    rareCount,
    epicCount
  };
  if (isClaim) {
    updateData.claimCount = (user.claimDate === today ? (user.claimCount || 0) : 0) + 1;
    updateData.claimDate = today;
  } else {
    updateData.clearAttempts = _.inc(-1);
  }
  if (newBadgeIds.length > 0) {
    updateData.badges = _.addToSet({ $each: newBadgeIds });
  }
  await db.collection('users').where({ _id: OPENID }).update({ data: updateData });

  const result = {
    success: true,
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
    isClaim: !!isClaim
  };

  if (isClaim) {
    const claimLimit = getClaimLimit(user.xp || 0);
    const newClaimCount = (user.claimDate === today ? (user.claimCount || 0) : 0) + 1;
    result.claimCount = newClaimCount;
    result.claimLimit = claimLimit;
    result.clearAttempts = user.clearAttempts;
  } else {
    result.clearAttempts = user.clearAttempts - 1;
  }

  return result;
};
```

注意：
- 徽章写入必须用 `_.addToSet({ $each: newBadgeIds })`：展开 `...ids` 只保留第一个；直接传数组会变成嵌套数组。`newBadgeIds` 为空时不要写 `badges` 字段：

```js
  const updateData = {
    totalCleared: _.inc(1),
    totalArea,
    xp: _.inc(xpGained),
    rareCount,
    epicCount
  };
  if (isClaim) {
    updateData.claimCount = (user.claimDate === today ? (user.claimCount || 0) : 0) + 1;
    updateData.claimDate = today;
  } else {
    updateData.clearAttempts = _.inc(-1);
  }
  if (newBadgeIds.length > 0) {
    updateData.badges = _.addToSet({ $each: newBadgeIds });
  }
  await db.collection('users').where({ _id: OPENID }).update({ data: updateData });
```

- 旧代码里「新城市 +500」在 XP 计算中已由 `firstInCity` 覆盖，删除原 `if (region.city) { ... cityAreas.length <= 1 ... }` 那段。

- [x] **Step 4: 语法自检**

```bash
node --check "cloudfunctions/clearFog/index.js"
node --check "cloudfunctions/clearFog/gameplay.js"
node --test tests/gameplay.test.js
```

Expected: 无语法错误，测试全 PASS

- [x] **Step 5: Commit**

```bash
git add cloudfunctions/clearFog/index.js
git commit -m "feat: clearFog awards rarity, badges, and tiered XP"
```

---

### Task 4: getUserStats / getMyDiscoveries 返回收集数据

**Files:**
- Modify: `cloudfunctions/getUserStats/index.js`
- Modify: `cloudfunctions/getMyDiscoveries/index.js`
- Modify: `miniprogram/utils/db.js`（无需改签名，透传即可，确认注释）

- [x] **Step 1: getUserStats 返回 badges 与稀有统计**

把 `getUserStats/index.js` 的 `return { ... }` 改为：

```js
  return {
    clearAttempts: user.clearAttempts || 0,
    lastCheckInDate: user.lastCheckInDate || '',
    createdAt: user.createdAt,
    nickName: user.nickName || '',
    avatarUrl,
    totalCleared: user.totalCleared || 0,
    totalArea: user.totalArea || 0,
    checkInCount: user.checkInCount || 0,
    xp: user.xp || 0,
    claimCount: user.claimCount || 0,
    claimDate: user.claimDate || '',
    badges: user.badges || [],
    rareCount: user.rareCount || 0,
    epicCount: user.epicCount || 0
  };
```

- [x] **Step 2: getMyDiscoveries 返回 rarity 与汇总**

把 `getMyDiscoveries/index.js` 整文件替换为：

```js
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();

  const { data } = await db.collection('cleared_areas')
    .where({ clearedBy: OPENID })
    .orderBy('city', 'asc')
    .orderBy('createdAt', 'desc')
    .limit(500)
    .get();

  const discoveries = data.map((d) => ({
    ...d,
    rarity: d.rarity || 'common'
  }));

  const citySet = new Set(discoveries.map((d) => d.city).filter(Boolean));
  const rareCount = discoveries.filter((d) => d.rarity === 'rare' || d.rarity === 'epic').length;
  const epicCount = discoveries.filter((d) => d.rarity === 'epic').length;

  return {
    discoveries,
    summary: {
      total: discoveries.length,
      cityCount: citySet.size,
      rareCount,
      epicCount
    }
  };
};
```

- [x] **Step 3: 语法自检**

```bash
node --check "cloudfunctions/getUserStats/index.js"
node --check "cloudfunctions/getMyDiscoveries/index.js"
```

Expected: 无输出（语法正确）

- [x] **Step 4: Commit**

```bash
git add cloudfunctions/getUserStats/index.js cloudfunctions/getMyDiscoveries/index.js
git commit -m "feat: expose badges and discovery rarity via cloud APIs"
```

---

### Task 5: 前端展示元数据 `utils/gameplay.js`

**Files:**
- Create: `miniprogram/utils/gameplay.js`

- [x] **Step 1: 写展示元数据**

创建 `miniprogram/utils/gameplay.js`：

```js
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

module.exports = {
  RARITY_META,
  BADGE_META,
  getRarityMeta,
  getBadgeMeta
};
```

- [x] **Step 2: Commit**

```bash
git add miniprogram/utils/gameplay.js
git commit -m "feat: add client-side rarity and badge display metadata"
```

---

### Task 6: 驱散成功后的「发现卡片」

**Files:**
- Modify: `miniprogram/pages/fogmap/fogmap.js`
- Modify: `miniprogram/pages/fogmap/fogmap.wxml`
- Modify: `miniprogram/pages/fogmap/fogmap.wxss`

- [x] **Step 1: fogmap.js 引入元数据并扩展 data**

在文件顶部加：

```js
const { getRarityMeta, getBadgeMeta } = require('../../utils/gameplay');
```

`data` 中增加：

```js
    showResult: false,
    result: null
```

- [x] **Step 2: 增加结果处理与关闭方法**

在 `noop() {}` 附近追加：

```js
  showDiscoveryResult(payload) {
    const rarityMeta = getRarityMeta(payload.rarity);
    const newBadges = (payload.newBadges || []).map((b) => ({
      ...b,
      icon: (getBadgeMeta(b.id) || {}).icon || '✦'
    }));
    this.setData({
      showResult: true,
      result: {
        placeName: payload.placeName || '未知地点',
        city: payload.city || '',
        rarityName: rarityMeta.name,
        rarityColor: rarityMeta.color,
        rarityGlow: rarityMeta.glow,
        xpGained: payload.xpGained || 0,
        firstInCity: !!payload.firstInCity,
        newBadges
      }
    });
  },

  onResultClose() {
    this.setData({ showResult: false, result: null });
  },
```

- [x] **Step 3: 在驱散/认领成功回调里调用**

`onClearFog` 中，把成功后的 toast 段改为：

```js
        }).then(() => {
          this.playClearAnimation(location);
          wx.hideLoading();
          this.showDiscoveryResult(result);
        });
```

即删掉原来的 `wx.showToast({ title: xpMsg, ... })` 两行，改为 `this.showDiscoveryResult(result);`。

`onClaimConfirm` 中同样，把：

```js
        this.playClearAnimation({ latitude: lat, longitude: lng });
        wx.hideLoading();
        const xpMsg = result.xpGained ? `认领成功 +${result.xpGained} XP` : '认领成功';
        wx.showToast({ title: xpMsg, icon: 'success' });
```

改为：

```js
        this.playClearAnimation({ latitude: lat, longitude: lng });
        wx.hideLoading();
        this.showDiscoveryResult(result);
```

- [x] **Step 4: wxml 增加结果卡片**

在 `</view>`（根节点闭合）前追加：

```xml
  <!-- Discovery result card -->
  <cover-view class="result-mask" wx:if="{{showResult && result}}" bindtap="onResultClose">
    <cover-view class="result-card" catchtap="noop">
      <cover-view class="result-glow" style="background: {{result.rarityGlow}};"></cover-view>
      <cover-view class="result-title">发现地点</cover-view>
      <cover-view class="result-place">{{result.placeName}}</cover-view>
      <cover-view class="result-city" wx:if="{{result.city}}">{{result.city}}</cover-view>
      <cover-view class="result-rarity" style="color: {{result.rarityColor}}; border-color: {{result.rarityColor}};">
        {{result.rarityName}}
      </cover-view>
      <cover-view class="result-xp">+{{result.xpGained}} XP</cover-view>
      <cover-view class="result-first" wx:if="{{result.firstInCity}}">新城市解锁 +500</cover-view>
      <cover-view class="result-badges" wx:if="{{result.newBadges.length}}">
        <cover-view class="result-badge-title">获得徽章</cover-view>
        <cover-view class="result-badge" wx:for="{{result.newBadges}}" wx:key="id">
          <cover-view class="result-badge-icon">{{item.icon}}</cover-view>
          <cover-view class="result-badge-name">{{item.name}}</cover-view>
          <cover-view class="result-badge-desc">{{item.desc}}</cover-view>
        </cover-view>
      </cover-view>
      <cover-view class="result-btn" bindtap="onResultClose">继续探索</cover-view>
    </cover-view>
  </cover-view>
```

- [x] **Step 5: wxss 追加样式**

在 `fogmap.wxss` 末尾追加：

```css
.result-mask {
  position: fixed;
  left: 0; right: 0; top: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 99999;
  display: flex;
  align-items: center;
  justify-content: center;
}

.result-card {
  position: relative;
  width: 560rpx;
  background: #1a2233;
  border-radius: 24rpx;
  padding: 48rpx 40rpx 36rpx;
  overflow: hidden;
  text-align: center;
}

.result-glow {
  position: absolute;
  left: 50%; top: -80rpx;
  width: 320rpx; height: 320rpx;
  margin-left: -160rpx;
  border-radius: 50%;
  filter: blur(40rpx);
  opacity: 0.5;
  pointer-events: none;
}

.result-title {
  color: rgba(255,255,255,0.45);
  font-size: 24rpx;
  letter-spacing: 4rpx;
}

.result-place {
  color: #fff;
  font-size: 36rpx;
  font-weight: 600;
  margin-top: 16rpx;
}

.result-city {
  color: rgba(255,255,255,0.4);
  font-size: 24rpx;
  margin-top: 8rpx;
}

.result-rarity {
  display: inline-block;
  margin-top: 20rpx;
  padding: 6rpx 24rpx;
  border: 2rpx solid;
  border-radius: 999rpx;
  font-size: 24rpx;
}

.result-xp {
  color: #38bdf8;
  font-size: 32rpx;
  font-weight: 600;
  margin-top: 20rpx;
}

.result-first {
  color: #fbbf24;
  font-size: 22rpx;
  margin-top: 8rpx;
}

.result-badges {
  margin-top: 28rpx;
  padding-top: 24rpx;
  border-top: 1rpx solid rgba(255,255,255,0.08);
  text-align: left;
}

.result-badge-title {
  color: rgba(255,255,255,0.4);
  font-size: 22rpx;
  margin-bottom: 16rpx;
  text-align: center;
}

.result-badge {
  display: flex;
  align-items: center;
  margin-top: 12rpx;
}

.result-badge-icon {
  width: 56rpx;
  height: 56rpx;
  line-height: 56rpx;
  text-align: center;
  border-radius: 50%;
  background: rgba(212, 160, 23, 0.15);
  color: #d4a017;
  font-size: 28rpx;
  margin-right: 16rpx;
  flex-shrink: 0;
}

.result-badge-name {
  color: #fff;
  font-size: 26rpx;
  margin-right: 12rpx;
}

.result-badge-desc {
  color: rgba(255,255,255,0.35);
  font-size: 22rpx;
}

.result-btn {
  margin-top: 36rpx;
  background: linear-gradient(135deg, #d4a017, #f0c040);
  color: #10131c;
  font-size: 28rpx;
  font-weight: 600;
  border-radius: 999rpx;
  padding: 20rpx 0;
}
```

- [x] **Step 6: 微信开发者工具手测**

在开发者工具中：
1. 编译打开地图页，点 ✦ 驱散。
2. Expected: 弹出「发现地点」卡片，显示地名、稀有度、+XP；点「继续探索」关闭。
3. 长按认领一次，Expected: 同样出卡片。
4. 若返回数据缺字段，卡片显示「未知地点 / 常见」不白屏。

- [x] **Step 7: Commit**

```bash
git add miniprogram/pages/fogmap/fogmap.js miniprogram/pages/fogmap/fogmap.wxml miniprogram/pages/fogmap/fogmap.wxss
git commit -m "feat: show discovery result card after clearing fog"
```

---

### Task 7: 图鉴页升级

**Files:**
- Modify: `miniprogram/pages/discovery/discovery.js`
- Modify: `miniprogram/pages/discovery/discovery.wxml`
- Modify: `miniprogram/pages/discovery/discovery.wxss`
- Modify: `miniprogram/pages/profile/profile.js`（取消 Lv.4 锁）
- Modify: `miniprogram/pages/profile/profile.wxml`（去掉 🔒）

- [x] **Step 1: 取消图鉴等级锁**

`profile.js` 中 `onOpenDiscovery` 改为：

```js
  onOpenDiscovery() {
    wx.navigateTo({ url: '/pages/discovery/discovery' });
  },
```

`profile.wxml` 中：

```xml
      <text class="profile-name">我的图鉴{{levelNum < 4 ? ' 🔒' : ''}}</text>
```

改为：

```xml
      <text class="profile-name">我的图鉴</text>
```

- [x] **Step 2: discovery.js 使用 rarity 与 summary**

顶部引入：

```js
const { getRarityMeta, RARITY_META } = require('../../utils/gameplay');
```

`data` 增加：

```js
    summary: { total: 0, cityCount: 0, rareCount: 0, epicCount: 0 },
    rarityLegend: []
```

`onLoad` 中加：

```js
    this.setData({
      rarityLegend: Object.keys(RARITY_META).map((k) => ({
        key: k,
        name: RARITY_META[k].name,
        color: RARITY_META[k].color
      }))
    });
```

`onShow` 删除等级拦截，只保留 `this.loadData();`：

```js
  onShow() {
    this.loadData();
  },
```

`loadData` 中，把 `getMyDiscoveries` 结果处理改为：

```js
      const result = await db.getMyDiscoveries();
      const discoveries = result.discoveries || [];

      const cityMap = {};
      discoveries.forEach(item => {
        const city = item.city || '未知城市';
        if (!cityMap[city]) {
          cityMap[city] = [];
        }
        const rarity = item.rarity || 'common';
        const rm = getRarityMeta(rarity);
        cityMap[city].push({
          placeName: item.placeName || item.district || '未知地点',
          date: this.formatDate(item.createdAt),
          rarity,
          rarityName: rm.name,
          rarityColor: rm.color
        });
      });

      const cities = Object.keys(cityMap)
        .map(name => ({
          name,
          places: cityMap[name],
          count: cityMap[name].length
        }))
        .sort((a, b) => b.count - a.count);

      this.setData({
        cities,
        totalCount: discoveries.length,
        summary: result.summary || {
          total: discoveries.length,
          cityCount: cities.length,
          rareCount: 0,
          epicCount: 0
        },
        loading: false
      });
```

- [x] **Step 3: discovery.wxml 增加统计条与稀有度色点**

在 `<view class="header">` 之后、loading 之前插入：

```xml
  <!-- Summary -->
  <view class="summary-row" wx:if="{{!loading && summary.total > 0}}">
    <view class="summary-item">
      <text class="summary-num">{{summary.total}}</text>
      <text class="summary-label">发现</text>
    </view>
    <view class="summary-item">
      <text class="summary-num">{{summary.rareCount}}</text>
      <text class="summary-label">珍稀以上</text>
    </view>
    <view class="summary-item">
      <text class="summary-num">{{summary.epicCount}}</text>
      <text class="summary-label">史诗</text>
    </view>
    <view class="summary-item">
      <text class="summary-num">{{summary.cityCount}}</text>
      <text class="summary-label">城市</text>
    </view>
  </view>

  <view class="rarity-legend" wx:if="{{!loading && rarityLegend.length}}">
    <view class="legend-item" wx:for="{{rarityLegend}}" wx:key="key">
      <view class="legend-dot" style="background: {{item.color}};"></view>
      <text class="legend-text">{{item.name}}</text>
    </view>
  </view>
```

`place-item` 中，把 `<view class="place-dot"></view>` 改为：

```xml
          <view class="place-dot" style="background: {{place.rarityColor}};"></view>
```

并在 `place-name` 后加稀有度标签：

```xml
          <text class="place-rarity" style="color: {{place.rarityColor}};">{{place.rarityName}}</text>
```

空状态文案改为：

```xml
    <text class="empty-text">暂无发现</text>
    <text class="empty-sub">驱散迷雾即可收集地点，稀有地点给更多 XP</text>
```

- [x] **Step 4: discovery.wxss 追加样式**

```css
.summary-row {
  display: flex;
  justify-content: space-around;
  padding: 24rpx 32rpx 8rpx;
}

.summary-item {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.summary-num {
  color: #fff;
  font-size: 36rpx;
  font-weight: 600;
}

.summary-label {
  color: rgba(255,255,255,0.4);
  font-size: 22rpx;
  margin-top: 6rpx;
}

.rarity-legend {
  display: flex;
  justify-content: center;
  gap: 24rpx;
  padding: 16rpx 0 8rpx;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.legend-dot {
  width: 14rpx;
  height: 14rpx;
  border-radius: 50%;
}

.legend-text {
  color: rgba(255,255,255,0.45);
  font-size: 20rpx;
}

.place-rarity {
  font-size: 20rpx;
  margin-left: 12rpx;
}
```

- [x] **Step 5: 手测图鉴**

开发者工具中：
1. 「我的」→「我的图鉴」，无等级锁，直接进入。
2. Expected: 顶部有 4 项统计，列表地点带稀有度色点与标签。
3. 无数据时显示新空状态文案。

- [x] **Step 6: Commit**

```bash
git add miniprogram/pages/discovery/discovery.js miniprogram/pages/discovery/discovery.wxml miniprogram/pages/discovery/discovery.wxss miniprogram/pages/profile/profile.js miniprogram/pages/profile/profile.wxml
git commit -m "feat: unlock and enrich discovery codex with rarity"
```

---

### Task 8: 个人页徽章墙

**Files:**
- Modify: `miniprogram/pages/profile/profile.js`
- Modify: `miniprogram/pages/profile/profile.wxml`
- Modify: `miniprogram/pages/profile/profile.wxss`

- [x] **Step 1: profile.js 引入徽章目录并渲染**

顶部引入：

```js
const { BADGE_META } = require('../../utils/gameplay');
```

`data` 增加：

```js
    badgeList: []
```

`loadStats` 的 `update` 中增加：

```js
        badgeList: BADGE_META.map((b) => ({
          ...b,
          earned: (stats.badges || []).includes(b.id)
        }))
```

并在 `onOpenDiscovery` 之前追加方法：

```js
  onToggleBadges() {
    this.setData({ showBadges: !this.data.showBadges });
  },
```

`data` 同时增加 `showBadges: false`。

- [x] **Step 2: profile.wxml 增加徽章墙区块**

在「个人信息」section 之前插入：

```xml
  <view class="section">
    <view class="section-title" bindtap="onToggleBadges">
      <text>徽章墙</text>
      <text class="section-arrow {{showBadges ? 'section-arrow-open' : ''}}">></text>
    </view>
    <view class="badge-grid" wx:if="{{showBadges}}">
      <view class="badge-cell {{item.earned ? 'badge-earned' : 'badge-locked'}}" wx:for="{{badgeList}}" wx:key="id">
        <view class="badge-icon">{{item.icon}}</view>
        <text class="badge-name">{{item.name}}</text>
        <text class="badge-desc">{{item.desc}}</text>
      </view>
    </view>
  </view>
```

- [x] **Step 3: profile.wxss 追加样式**

```css
.badge-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
  padding: 16rpx 0;
}

.badge-cell {
  width: calc(50% - 8rpx);
  box-sizing: border-box;
  border-radius: 16rpx;
  padding: 20rpx 16rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.badge-earned {
  background: rgba(212, 160, 23, 0.12);
  border: 1rpx solid rgba(212, 160, 23, 0.45);
}

.badge-locked {
  background: rgba(255, 255, 255, 0.04);
  border: 1rpx solid rgba(255, 255, 255, 0.08);
}

.badge-icon {
  width: 72rpx;
  height: 72rpx;
  line-height: 72rpx;
  text-align: center;
  border-radius: 50%;
  font-size: 32rpx;
  margin-bottom: 12rpx;
}

.badge-earned .badge-icon {
  background: rgba(212, 160, 23, 0.2);
  color: #d4a017;
}

.badge-locked .badge-icon {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.2);
}

.badge-name {
  font-size: 26rpx;
}

.badge-earned .badge-name {
  color: #fff;
}

.badge-locked .badge-name {
  color: rgba(255, 255, 255, 0.35);
}

.badge-desc {
  font-size: 20rpx;
  margin-top: 6rpx;
  color: rgba(255, 255, 255, 0.3);
  text-align: center;
}
```

- [x] **Step 4: 手测徽章墙**

1. 「我的」→「徽章墙」展开。
2. Expected: 8 个徽章，已获得高亮，未获得置灰。
3. 新账号完成一次驱散后返回，Expected: 「初火」点亮；若弹出结果卡片则同时显示徽章。

- [x] **Step 5: Commit**

```bash
git add miniprogram/pages/profile/profile.js miniprogram/pages/profile/profile.wxml miniprogram/pages/profile/profile.wxss
git commit -m "feat: add badge wall on profile page"
```

---

### Task 9: 回归手测清单 + 云函数上传说明

**Files:**
- Modify: `docs/superpowers/plans/2026-09-23-collection-gameplay.md`（勾选步骤即可，无新代码）

- [x] **Step 1: 全量单元测试**

```bash
cd "D:/test/lightworld - 副本"
node --test tests/gameplay.test.js
```

Expected: 全部 PASS

- [x] **Step 2: 语法检查全部改动过的 JS**

```bash
node --check "cloudfunctions/clearFog/index.js"
node --check "cloudfunctions/clearFog/gameplay.js"
node --check "cloudfunctions/getUserStats/index.js"
node --check "cloudfunctions/getMyDiscoveries/index.js"
node --check "miniprogram/utils/gameplay.js"
node --check "miniprogram/pages/fogmap/fogmap.js"
node --check "miniprogram/pages/discovery/discovery.js"
node --check "miniprogram/pages/profile/profile.js"
```

Expected: 无报错输出

- [ ] **Step 3: 微信侧手测脚本（需开发者工具）**

按顺序验证：
1. 新用户登录 → 引导 → 驱散 1 次 → 发现卡片出现 → 徽章墙有「初火」。
2. 图鉴无锁可进，统计数字正确，色点随稀有度变化。
3. 认领驱散（若未到 Lv.2 会被拦截，属预期）同样走发现卡片。
4. 签到 2 次拿次数后继续驱散，XP 累计正确。
5. 旧数据驱散记录无 `rarity` 字段时，图鉴显示「常见」，不报错。

- [ ] **Step 4: 上传云函数（人工在开发者工具执行）**

对 `clearFog`、`getUserStats`、`getMyDiscoveries` 三个云函数目录右键 → **上传并部署：云端安装依赖**。

- [x] **Step 5: 最终 Commit**

```bash
git add -u
git commit -m "docs: complete collection gameplay plan checklist"
```

---

## 执行状态（2026-09-23）

代码任务 1–9 已完成（分支 `feature/collection-gameplay`）。自动化验证：`node --test tests/gameplay.test.js` 22/22 通过；全部改动 JS `node --check` 通过。

**人工步骤（Step 3/4）待在微信开发者工具执行：**
1. 上传并部署 `clearFog`、`getUserStats`、`getMyDiscoveries`（云端安装依赖）
2. 按 Step 3 清单手测：发现卡片、图鉴解锁与稀有度色点、徽章墙、旧数据无 `rarity` 显示「常见」
3. 实现中相对计划的修正：结果卡片 `z-index` 提到 `99999`（原 1000 会被地图按钮压住）；Lv.4 等级文案去掉已取消的图鉴锁描述

---

## Self-Review 记录

- **Spec coverage:** 稀有度（Task 1/3）、徽章（Task 2/3/8）、XP 分层（Task 3）、发现反馈（Task 6）、图鉴核心化（Task 7）均有对应任务。计划 B/C 明确排除。
- **Placeholder scan:** 全步骤含完整代码或精确命令，无 TBD。
- **Type consistency:** `computeRarity` / `evaluateNewBadges` / `RARITY_XP_BONUS` / `BADGE_DEFS` / `getRarityMeta` / `BADGE_META` / `rarity` / `badges` / `rareCount` / `epicCount` / `newBadges` 在前后任务中命名一致。
