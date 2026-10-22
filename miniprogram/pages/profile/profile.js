const db = require('../../utils/db');
const { BADGE_META } = require('../../utils/gameplay');

const MAX_RING = 10;

const LEVELS = [
  { name: '微光',   xp: 0,     unlock: '' },
  { name: '火种',   xp: 200,   unlock: '长按地图任意位置驱散迷雾，每天1次' },
  { name: '烛光',   xp: 800,   unlock: '高倍缩放可见星座连线特效，认领+1次/天' },
  { name: '火炬',   xp: 2000,  unlock: '认领次数提升至3次/天' },
  { name: '篝火',   xp: 5000,  unlock: '认领次数提升至4次/天' },
  { name: '星火',   xp: 10000, unlock: '认领次数提升至5次/天' },
  { name: '曙光',   xp: 20000, unlock: '排行榜获得「世界点亮者」荣誉标识，认领+2次/天' },
];

function getLevel(totalXp) {
  let level = 0;
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (totalXp >= LEVELS[i].xp) { level = i; break; }
  }
  const current = LEVELS[level];
  const next = level < LEVELS.length - 1 ? LEVELS[level + 1] : null;
  let progress = 1;
  if (next) {
    progress = (totalXp - current.xp) / (next.xp - current.xp);
  }
  return {
    level: level + 1,
    name: current.name,
    unlock: current.unlock,
    nextName: next ? next.name : null,
    nextXp: next ? next.xp : null,
    progress: Math.min(Math.max(progress, 0), 1)
  };
}

Page({
  data: {
    statusBarHeight: 0,
    clearAttempts: 0,
    totalCleared: 0,
    totalArea: 0,
    areaDisplay: '0',
    areaDetail: '0.00',
    hasCheckedIn: false,
    ringDeg: 0,
    nickName: '',
    avatarUrl: '',
    nickInput: '',
    saving: false,
    showProfileModal: false,
    levelName: '微光',
    levelNum: 1,
    nextLevelName: '',
    nextLevelXp: 0,
    levelProgress: 0,
    checkInProgress: 0,
    showLevels: false,
    allLevels: [],
    showBadges: false,
    badgeList: [],
    checkInCount: 0,
    totalXp: 0,
    showLevelUp: false,
    levelUpTo: {}
  },

  onLoad() {
    this.setData({ statusBarHeight: wx.getSystemInfoSync().statusBarHeight });
  },

  onShow() {
    this.loadStats();
  },

  onPullDownRefresh() {
    this.loadStats().then(() => wx.stopPullDownRefresh());
  },

  async loadStats() {
    try {
      const stats = await db.getUserStats();
      const today = new Date().toISOString().slice(0, 10);
      const totalCleared = stats.totalCleared || 0;
      const totalArea = stats.totalArea || 0;
      const totalAreaKm2 = totalArea / 1e6;
      const ringDeg = Math.min(totalCleared / MAX_RING, 1) * 360;
      const totalXp = stats.xp || 0;

      const nickName = stats.nickName || '';
      const avatarUrl = stats.avatarUrl || '';
      const level = getLevel(totalXp);
      const checkInCount = stats.checkInCount || 0;

      // 检查升级
      const lastLevel = wx.getStorageSync('lastLevel') || 0;
      if (level.level > lastLevel && lastLevel > 0) {
        this.setData({
          showLevelUp: true,
          levelUpTo: { level: level.level, name: level.name, unlock: level.unlock }
        });
      }
      wx.setStorageSync('lastLevel', level.level);
      wx.setStorageSync('userLevel', level.level);

      const claimLimits = [[2,1],[3,2],[4,3],[5,4],[6,5],[7,7]];
      const allLevels = LEVELS.map((l, i) => {
        const lv = i + 1;
        const claimEntry = claimLimits.find(c => c[0] === lv);
        const claimText = claimEntry ? `认领${claimEntry[1]}次/天` : '';
        return {
          lv,
          name: l.name,
          xp: l.xp,
          xpText: l.xp > 0 ? `${l.xp} XP` : '初始',
          unlock: l.unlock || claimText || '',
          current: lv === level.level
        };
      });

      const update = {
        clearAttempts: stats.clearAttempts || 0,
        totalCleared,
        totalArea,
        totalXp,
        hasCheckedIn: stats.lastCheckInDate === today,
        areaDisplay: this.formatArea(totalAreaKm2),
        areaDetail: totalAreaKm2.toFixed(2),
        ringDeg,
        nickName,
        levelName: level.name,
        levelNum: level.level,
        nextLevelName: level.nextName || '',
        nextLevelXp: level.nextXp || 0,
        checkInProgress: checkInCount % 2,
        checkInCount,
        levelProgress: level.progress,
        allLevels,
        badgeList: BADGE_META.map((b) => ({
          ...b,
          earned: (stats.badges || []).includes(b.id)
        }))
      };

      // Don't overwrite avatar/nickname if user is editing
      if (!this._avatarChanged) {
        update.avatarUrl = avatarUrl;
      }
      if (!this.data.showProfileModal) {
        update.nickInput = nickName;
      }

      this.setData(update);
    } catch (err) {
      console.error('Load stats failed:', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  onEditProfile() {
    this._avatarChanged = false;
    this.setData({
      showProfileModal: true,
      nickInput: this.data.nickName,
      avatarUrl: this.data.avatarUrl
    });
  },

  noop() {},

  onToggleLevels() {
    this.setData({ showLevels: !this.data.showLevels });
  },

  onToggleBadges() {
    this.setData({ showBadges: !this.data.showBadges });
  },

  onOpenDiscovery() {
    wx.navigateTo({ url: '/pages/discovery/discovery' });
  },

  onCloseProfileModal() {
    this._avatarChanged = false;
    this.setData({ showProfileModal: false });
  },

  onChooseAvatar() {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      success: (res) => {
        this._avatarChanged = true;
        this.setData({ avatarUrl: res.tempFilePaths[0] });
      }
    });
  },

  onNickInput(e) {
    this.setData({ nickInput: e.detail.value });
  },

  async onSaveProfile() {
    const nickName = this.data.nickInput.trim();
    if (!nickName || this.data.saving) return;
    this.setData({ saving: true });

    try {
      let avatarUrl = null;
      const avatarPath = this.data.avatarUrl;
      console.log('[onSaveProfile] avatarPath:', avatarPath);

      if (avatarPath && avatarPath.startsWith('cloud://')) {
        avatarUrl = avatarPath;
      } else if (avatarPath) {
        const cloudPath = `avatars/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
        console.log('[onSaveProfile] uploading to:', cloudPath);
        const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath: avatarPath });
        console.log('[onSaveProfile] uploadRes:', JSON.stringify(uploadRes));
        avatarUrl = uploadRes.fileID;
      }

      const data = { nickName, avatarUrl: avatarUrl || '' };
      console.log('[onSaveProfile] saving data:', JSON.stringify(data));
      await db.saveProfile(data);
      this.setData({
        nickName,
        ...(avatarUrl ? { avatarUrl } : {}),
        showProfileModal: false
      });
      wx.showToast({ title: '保存成功', icon: 'success' });
    } catch (err) {
      console.error('Save profile failed:', err);
      wx.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  async onCheckIn() {
    try {
      const result = await db.checkIn();
      if (result.success) {
        this.setData({
          clearAttempts: result.clearAttempts,
          hasCheckedIn: true,
          checkInProgress: result.checkInCount % 2,
          checkInCount: result.checkInCount,
          totalXp: (this.data.totalXp || 0) + (result.xpGained || 0)
        });
        let msg = '签到成功';
        if (result.gained) msg += '，获得 1 次驱散';
        msg += ` +${result.xpGained || 20} XP`;
        wx.showToast({ title: msg, icon: 'success' });
        // 重新加载以检查升级
        this.loadStats();
      } else {
        wx.showToast({ title: result.message, icon: 'none' });
      }
    } catch (err) {
      console.error('Check-in failed:', err);
      wx.showToast({ title: '签到失败', icon: 'none' });
    }
  },

  onCloseLevelUp() {
    this.setData({ showLevelUp: false });
  },

  formatArea(km2) {
    if (km2 >= 10000) return (km2 / 10000).toFixed(1) + '万';
    if (km2 >= 1000) return km2.toFixed(0);
    if (km2 >= 1) return km2.toFixed(1);
    return km2.toFixed(2);
  }
});
