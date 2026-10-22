const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();

  const { data } = await db.collection('users').where({ _id: OPENID }).get();

  if (data.length === 0) {
    return { clearAttempts: 0, lastCheckInDate: '', openid: OPENID };
  }

  return { ...data[0], openid: OPENID };
};
