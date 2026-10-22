const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event) => {

  try {
    const level = event.level === 'province' ? 'province' : 'city';

    const res = await db.collection('cleared_areas')
      .aggregate()
      .match({
        [level]: db.command.neq('')
      })
      .group({
        _id: '$' + level,
        totalCount: {
          $sum: 1
        },
        users: {
          $addToSet: '$clearedBy'
        }
      })
      .sort({
        totalCount: -1
      })
      .limit(20)
      .end();


    return {
      success: true,
      regions: res.list
    };

  } catch (e) {

    return {
      success:false,
      error:e.message
    };

  }
};
