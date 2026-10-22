const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const today = new Date().toISOString().slice(0, 10);

  const { data } = await db.collection('users').where({ _id: OPENID }).get();

  if (data.length === 0) {
    return { success: false, message: '用户不存在' };
  }

  const user = data[0];

  if (user.lastCheckInDate === today) {
    return { success: false, message: '今日已签到' };
  }

  const newCount = (user.checkInCount || 0) + 1;
  const gained = newCount % 2 === 0 ? 1 : 0;

  const xpGained = 20;
  const updateData = {
    checkInCount: _.inc(1),
    lastCheckInDate: today,
    xp: _.inc(xpGained)
  };
  if (gained) {
    updateData.clearAttempts = _.inc(1);
  }

  await db.collection('users').where({ _id: OPENID }).update({
    data: updateData
  });

  return {
    success: true,
    clearAttempts: user.clearAttempts + gained,
    lastCheckInDate: today,
    checkInCount: newCount,
    gained,
    xpGained
  };
};
