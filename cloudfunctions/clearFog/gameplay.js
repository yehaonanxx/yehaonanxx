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
 * @param {{totalCleared?:number, cityCount?:number, rareCount?:number, epicCount?:number, xp?:number}} state
 * @param {string[]} ownedIds
 * @returns {string[]} newly earned badge ids
 */
function evaluateNewBadges(state, ownedIds) {
  const s = state || {};
  const owned = new Set(Array.isArray(ownedIds) ? ownedIds : []);
  const earned = [];
  for (const badge of BADGE_DEFS) {
    if (!owned.has(badge.id) && badge.check(s)) {
      earned.push(badge.id);
    }
  }
  return earned;
}

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
