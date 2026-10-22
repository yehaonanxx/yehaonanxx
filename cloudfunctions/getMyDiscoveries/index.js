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

  const { total } = await db.collection('cleared_areas')
    .where({ clearedBy: OPENID })
    .count();

  const { data: users } = await db.collection('users')
    .where({ _id: OPENID })
    .field({ rareCount: true, epicCount: true })
    .get();
  const user = users[0] || {};

  const citySet = new Set(discoveries.map((d) => d.city).filter(Boolean));
  const rareCount = user.rareCount != null
    ? user.rareCount
    : discoveries.filter((d) => d.rarity === 'rare' || d.rarity === 'epic').length;
  const epicCount = user.epicCount != null
    ? user.epicCount
    : discoveries.filter((d) => d.rarity === 'epic').length;

  return {
    discoveries,
    summary: {
      total,
      cityCount: citySet.size,
      rareCount,
      epicCount
    }
  };
};
