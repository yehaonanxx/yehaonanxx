const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { south, west, north, east } = event;

  // Query cleared areas within bounding box
  const { data } = await db.collection('cleared_areas')
    .where({
      latitude: _.gte(south).and(_.lte(north)),
      longitude: _.gte(west).and(_.lte(east))
    })
    .limit(1000)
    .get();

  return data;
};
