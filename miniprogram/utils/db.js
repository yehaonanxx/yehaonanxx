const db = wx.cloud.database();
const clearedAreas = db.collection('cleared_areas');
const users = db.collection('users');

/**
 * Initialize user record if not exists
 * Returns user document
 */
async function initUser() {
  const { result } = await wx.cloud.callFunction({ name: 'initUser' });
  return result;
}

/**
 * Get user info (attempts, check-in status)
 */
async function getUserInfo() {
  const { result } = await wx.cloud.callFunction({ name: 'getUserInfo' });
  return result;
}

/**
 * Perform daily check-in, returns updated user info
 */
async function checkIn() {
  const { result } = await wx.cloud.callFunction({ name: 'checkIn' });
  return result;
}

/**
 * Clear fog at current location
 * @param {number} latitude
 * @param {number} longitude
 * @param {number} radius - radius in meters
 */
async function clearFog(latitude, longitude, radius, isClaim) {
  const { result } = await wx.cloud.callFunction({
    name: 'clearFog',
    data: {
      latitude,
      longitude,
      radius,
      isClaim: isClaim || false
    }
  });
  return result;
}

/**
 * Get all cleared areas within a bounding box
 * @param {Object} bounds - {south, west, north, east}
 */
async function getClearedAreas(bounds) {
  const { result } = await wx.cloud.callFunction({
    name: 'getClearedAreas',
    data: bounds
  });
  return result;
}

/**
 * Get user stats (clears, area, attempts)
 */
async function getUserStats() {
  const { result } = await wx.cloud.callFunction({ name: 'getUserStats' });
  return result;
}

/**
 * Save user profile (nickName, avatarUrl)
 */
async function saveProfile(data) {
  const { result } = await wx.cloud.callFunction({
    name: 'saveProfile',
    data
  });
  return result;
}

/**
 * Get leaderboard data
 */
async function getLeaderboard() {
  const { result } = await wx.cloud.callFunction({ name: 'getLeaderboard' });
  return result;
}

/**
 * Get region leaderboard data
 */
async function getRegionLeaderboard(level) {
  const { result } = await wx.cloud.callFunction({
    name: 'getRegionLeaderboard',
    data: { level }
  });
  return result;
}

/**
 * Get current user's discovered locations
 */
async function getMyDiscoveries() {
  const { result } = await wx.cloud.callFunction({ name: 'getMyDiscoveries' });
  return result;
}

async function reverseGeocode(latitude, longitude) {
  const { result } = await wx.cloud.callFunction({
    name: 'reverseGeocode',
    data: { latitude, longitude }
  });
  return result;
}

module.exports = {
  initUser,
  getUserInfo,
  checkIn,
  clearFog,
  getClearedAreas,
  getUserStats,
  saveProfile,
  getLeaderboard,
  getRegionLeaderboard,
  getMyDiscoveries,
  reverseGeocode
};
