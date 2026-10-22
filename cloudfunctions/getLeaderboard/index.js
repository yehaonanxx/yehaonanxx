const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const MAX_LIMIT = 50;

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();

  const { data: users } = await db.collection('users')
    .orderBy('totalArea', 'desc')
    .limit(MAX_LIMIT)
    .field({ nickName: true, avatarUrl: true, totalCleared: true, totalArea: true, xp: true, _id: true })
    .get();

  // Convert cloud avatar URLs to temp URLs
  const cloudAvatars = users.map(u => u.avatarUrl).filter(u => u && u.startsWith('cloud://'));
  let tempUrlMap = {};

  if (cloudAvatars.length > 0) {
    const { fileList } = await cloud.getTempFileURL({ fileList: cloudAvatars });
    fileList.forEach(f => {
      if (f.tempFileURL) tempUrlMap[f.fileID] = f.tempFileURL;
    });
  }

  // Build ranked list (only users with nicknames)
  const ranked = users
    .filter(u => u.nickName)
    .map((u, i) => {
      const rawAvatar = u.avatarUrl || '';
      const avatarUrl = rawAvatar.startsWith('cloud://') ? (tempUrlMap[rawAvatar] || '') : rawAvatar;
      return {
        rank: i + 1,
        userId: u._id,
        nickName: u.nickName,
        avatarUrl,
        totalCleared: u.totalCleared || 0,
        totalArea: u.totalArea || 0,
        xp: u.xp || 0
      };
    });

  // Find current user's rank
  let me = ranked.find(u => u.userId === OPENID) || null;

  // If user not in top 50, query their rank separately
  if (!me) {
    const { data: myUser } = await db.collection('users')
      .where({ _id: OPENID })
      .field({ nickName: true, avatarUrl: true, totalCleared: true, totalArea: true, xp: true })
      .get();

    if (myUser.length > 0) {
      const u = myUser[0];
      const myArea = u.totalArea || 0;
      const { total } = await db.collection('users')
        .where({ totalArea: _.gt(myArea) })
        .count();

      let avatarUrl = u.avatarUrl || '';
      if (avatarUrl.startsWith('cloud://')) {
        const { fileList } = await cloud.getTempFileURL({ fileList: [avatarUrl] });
        if (fileList[0] && fileList[0].tempFileURL) {
          avatarUrl = fileList[0].tempFileURL;
        }
      }

      me = {
        rank: total + 1,
        userId: OPENID,
        nickName: u.nickName || '',
        avatarUrl,
        totalCleared: u.totalCleared || 0,
        totalArea: myArea,
        xp: u.xp || 0
      };
    }
  }

  return { ranked, me };
};
