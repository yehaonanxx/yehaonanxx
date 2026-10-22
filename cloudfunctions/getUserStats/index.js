const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();

  const { data } = await db.collection('users').where({ _id: OPENID }).get();

  let user;
  if (data.length === 0) {
    await db.collection('users').add({
      data: {
        _id: OPENID,
        clearAttempts: 1,
        totalCleared: 0,
        checkInCount: 0,
        lastCheckInDate: '',
        xp: 0,
        createdAt: db.serverDate()
      }
    });
    user = { clearAttempts: 1, totalCleared: 0, checkInCount: 0, lastCheckInDate: '', xp: 0 };
  } else {
    user = data[0];
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
};
