const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();

  // Check if user exists
  const { data } = await db.collection('users').where({ _id: OPENID }).get();

  if (data.length === 0) {
    // Create new user with 5 free attempts
    await db.collection('users').add({
      data: {
        _id: OPENID,
        clearAttempts: 5,
        lastCheckInDate: '',
        xp: 0,
        createdAt: db.serverDate()
      }
    });
    return { isNew: true, clearAttempts: 5, lastCheckInDate: '', xp: 0 };
  }

  return { isNew: false, ...data[0] };
};
