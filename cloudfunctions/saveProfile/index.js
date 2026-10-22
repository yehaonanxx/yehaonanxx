const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { nickName, avatarUrl } = event;

  console.log('[saveProfile] received:', JSON.stringify({ nickName, avatarUrl }));

  if (!nickName && !avatarUrl) {
    return { success: false, message: '缺少参数' };
  }

  const updateData = {};
  if (nickName) updateData.nickName = nickName;
  if (avatarUrl) updateData.avatarUrl = avatarUrl;

  console.log('[saveProfile] updateData:', JSON.stringify(updateData));

  const { data: users } = await db.collection('users').where({ _id: OPENID }).get();

  if (users.length === 0) {
    await db.collection('users').add({
      data: {
        _id: OPENID,
        clearAttempts: 1,
        lastCheckInDate: '',
        createdAt: db.serverDate(),
        ...updateData
      }
    });
  } else {
    await db.collection('users').where({ _id: OPENID }).update({
      data: updateData
    });
  }

  return { success: true };
};
