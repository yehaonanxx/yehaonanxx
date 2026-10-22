const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeRarity, RARITY_XP_BONUS, evaluateNewBadges, BADGE_DEFS } = require('../cloudfunctions/clearFog/gameplay');

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
  assert.deepEqual(earned, ['first_light', 'spark_10', 'city_3', 'rare_1']);
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

test('BADGE_DEFS 含 8 个徽章且 ID 稳定', () => {
  assert.equal(BADGE_DEFS.length, 8);
  assert.deepEqual(BADGE_DEFS.map((b) => b.id), [
    'first_light', 'spark_10', 'spark_50', 'city_3',
    'city_10', 'rare_1', 'epic_1', 'max_level'
  ]);
});

test('客户端 BADGE_META 与服务端 BADGE_DEFS 契约一致', () => {
  const { BADGE_META } = require('../miniprogram/utils/gameplay');
  assert.deepEqual(
    BADGE_META.map((b) => ({ id: b.id, name: b.name, desc: b.desc })),
    BADGE_DEFS.map((b) => ({ id: b.id, name: b.name, desc: b.desc }))
  );
});

test('null state 不抛错', () => {
  const earned = evaluateNewBadges(null, []);
  assert.deepEqual(earned, []);
});

test('spark_50 与 city_10 达标发放', () => {
  const earned = evaluateNewBadges(
    { totalCleared: 50, cityCount: 10, rareCount: 0, epicCount: 0, xp: 0 },
    []
  );
  assert.ok(earned.includes('spark_50'));
  assert.ok(earned.includes('city_10'));
});

test('阈值差 1 不发放', () => {
  const earned = evaluateNewBadges(
    { totalCleared: 0, cityCount: 2, rareCount: 0, epicCount: 0, xp: 19999 },
    []
  );
  assert.ok(!earned.includes('first_light'));
  assert.ok(!earned.includes('city_3'));
  assert.ok(!earned.includes('max_level'));
});
