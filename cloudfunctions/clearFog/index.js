const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const { computeRarity, evaluateNewBadges, RARITY_XP_BONUS, BADGE_DEFS } = require('./gameplay');

// ★ 替换为你的腾讯地图 key
const MAP_KEY = 'PYUBZ-TB23A-EJLKS-CJ5E6-2QVPK-FTB2Z';

function reverseGeocode(latitude, longitude) {
  return new Promise((resolve) => {
    const url = `https://apis.map.qq.com/ws/geocoder/v1/?location=${latitude},${longitude}&key=${MAP_KEY}`;
    https.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.status === 0 && json.result && json.result.address_component) {
            const c = json.result.address_component;
            const r = json.result;
            const placeName = (r.formatted_addresses && r.formatted_addresses.recommend)
              || (r.pois && r.pois[0] && r.pois[0].title)
              || '';
            resolve({ province: c.province, city: c.city, district: c.district, placeName });
          } else {
            resolve({ province: '', city: '', district: '', placeName: '' });
          }
        } catch (e) {
          resolve({ province: '', city: '', district: '', placeName: '' });
        }
      });
    }).on('error', () => {
      resolve({ province: '', city: '', district: '', placeName: '' });
    });
  });
}

// 蒙特卡洛计算圆的并集面积（处理重叠）
function calcUnionArea(areas, samples = 2000) {
  if (areas.length === 0) return 0;
  if (areas.length === 1) return Math.PI * areas[0].radius * areas[0].radius;

  const R = 6371000;
  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;

  for (const a of areas) {
    const latPad = (a.radius / R) * (180 / Math.PI);
    const lngPad = latPad / Math.cos(a.latitude * Math.PI / 180);
    minLat = Math.min(minLat, a.latitude - latPad);
    maxLat = Math.max(maxLat, a.latitude + latPad);
    minLng = Math.min(minLng, a.longitude - lngPad);
    maxLng = Math.max(maxLng, a.longitude + lngPad);
  }

  const latRange = maxLat - minLat;
  const lngRange = maxLng - minLng;
  const avgLat = (minLat + maxLat) / 2;

  const circles = areas.map(a => {
    const latPad = (a.radius / R) * (180 / Math.PI);
    const lngPad = latPad / Math.cos(a.latitude * Math.PI / 180);
    return { lat: a.latitude, lng: a.longitude, rLat: latPad, rLng: lngPad };
  });

  let hits = 0;
  for (let i = 0; i < samples; i++) {
    const lat = minLat + Math.random() * latRange;
    const lng = minLng + Math.random() * lngRange;
    for (const c of circles) {
      const dLat = (lat - c.lat) / c.rLat;
      const dLng = (lng - c.lng) / c.rLng;
      if (dLat * dLat + dLng * dLng <= 1) {
        hits++;
        break;
      }
    }
  }

  const boxArea = latRange * (Math.PI / 180) * R * lngRange * (Math.PI / 180) * R * Math.cos(avgLat * Math.PI / 180);
  return boxArea * (hits / samples);
}

// Haversine 距离（米）
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 等级对应的每日认领次数
function getClaimLimit(xp) {
  const levels = [
    { xp: 0, claim: 0 },
    { xp: 200, claim: 1 },
    { xp: 800, claim: 2 },
    { xp: 2000, claim: 3 },
    { xp: 5000, claim: 4 },
    { xp: 10000, claim: 5 },
    { xp: 20000, claim: 7 },
  ];
  let limit = 0;
  for (const l of levels) {
    if (xp >= l.xp) limit = l.claim;
  }
  return limit;
}

// 边疆距离：按 20km/50km 阈值分档探测，保证 computeRarity 档位判定可靠。
// 返回值保证落在正确档位（<20km / 20–50km / ≥50km），不保证是精确最近距离。
async function findNearestDistanceMeters(latitude, longitude) {
  const R = 6371000;
  // box=查询包围盒半径（米）；hit=命中时返回的代表距离（落入该档）
  const tiers = [
    { box: 20000, hit: 15000 },
    { box: 50000, hit: 30000 },
    { box: 120000, hit: 60000 }
  ];

  for (const tier of tiers) {
    const latPad = (tier.box / R) * (180 / Math.PI);
    const lngPad = latPad / Math.cos(latitude * Math.PI / 180);
    const { data: nearby } = await db.collection('cleared_areas')
      .where({
        latitude: _.gte(latitude - latPad).and(_.lte(latitude + latPad)),
        longitude: _.gte(longitude - lngPad).and(_.lte(longitude + lngPad))
      })
      .field({ latitude: true, longitude: true })
      .limit(1000)
      .get();

    for (const a of nearby) {
      const d = haversineDistance(latitude, longitude, a.latitude, a.longitude);
      if (d < tier.box) return Math.min(d, tier.hit);
    }
  }
  return 100000;
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { latitude, longitude, radius, isClaim } = event;

  const roundedLat = Math.round(latitude * 10000) / 10000;
  const roundedLng = Math.round(longitude * 10000) / 10000;

  const OVERLAP_FACTOR = 1.5;
  const overlapDist = radius * OVERLAP_FACTOR; // 2km × 1.5 = 3km

  // 粗筛：经纬度范围内的记录
  const latPad = (overlapDist / 6371000) * (180 / Math.PI);
  const lngPad = latPad / Math.cos(latitude * Math.PI / 180);

  const { data: nearby } = await db.collection('cleared_areas')
    .where({
      latitude: _.gte(latitude - latPad).and(_.lte(latitude + latPad)),
      longitude: _.gte(longitude - lngPad).and(_.lte(longitude + lngPad))
    })
    .get();

  // 精筛：实际距离 < 3km 的算重叠
  const overlap = nearby.find(a =>
    haversineDistance(latitude, longitude, a.latitude, a.longitude) < overlapDist
  );

  if (overlap) {
    const msg = overlap.clearedBy === OPENID
      ? '你已经驱散过这里了，试试探索新位置吧'
      : '这片区域已被其他人点亮，换个地方探索吧';
    return { success: false, message: msg };
  }

  const { data: users } = await db.collection('users')
    .where({ _id: OPENID })
    .get();

  if (users.length === 0) {
    return { success: false, message: '用户不存在' };
  }

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
  let rareEpicWrite;
  if (user.rareCount == null || user.epicCount == null) {
    rareCount = myAreas.filter((a) => a.rarity === 'rare' || a.rarity === 'epic').length;
    epicCount = myAreas.filter((a) => a.rarity === 'epic').length;
    rareEpicWrite = { rareCount, epicCount };
  } else {
    rareCount = user.rareCount + (isRareOrEpic ? 1 : 0);
    epicCount = user.epicCount + (isEpic ? 1 : 0);
    rareEpicWrite = {
      rareCount: _.inc(isRareOrEpic ? 1 : 0),
      epicCount: _.inc(isEpic ? 1 : 0)
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

  // —— 唯一的用户写入：扣次数 + 进度 + 徽章 ——
  const updateData = {
    totalCleared: _.inc(1),
    totalArea,
    xp: _.inc(xpGained),
    ...rareEpicWrite
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
    result.clearAttempts = user.clearAttempts; // 不消耗，原样返回
  } else {
    result.clearAttempts = user.clearAttempts - 1;
  }

  return result;
};
