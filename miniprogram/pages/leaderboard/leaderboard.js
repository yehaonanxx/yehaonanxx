const db = require('../../utils/db');

const LEVELS_XP = [0, 200, 800, 2000, 5000, 10000, 20000];
const LEVEL_NAMES = ['微光', '火种', '烛光', '火炬', '篝火', '星火', '曙光'];

function getLevelName(xp) {
  let level = 0;
  for (let i = LEVELS_XP.length - 1; i >= 0; i--) {
    if (xp >= LEVELS_XP[i]) { level = i; break; }
  }
  return { level: level + 1, name: LEVEL_NAMES[level] || '微光' };
}

Page({
  data: {
    statusBarHeight: 0,
    loading: true,
    activeTab: 'user',
    ranked: [],
    restList: [],
    me: null,
    regionList: [],
    regionLevel: 'city',
    showProfileModal: false,
    avatarUrl: '',
    nickInput: '',
    saving: false
  },

  onLoad() {
    this.setData({ statusBarHeight: wx.getSystemInfoSync().statusBarHeight });
  },

  onShow() {
    this.loadData();
  },

  onPullDownRefresh() {
    this.loadData().then(() => wx.stopPullDownRefresh());
  },

  onSwitchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.activeTab) return;
    this.setData({ activeTab: tab, regionList: [] });
    if (tab === 'region') {
      this.loadRegionData();
    }
  },

  onSwitchRegionLevel(e) {
    const level = e.currentTarget.dataset.level;
    if (level === this.data.regionLevel) return;
    this.setData({ regionLevel: level, regionList: [] });
    this.loadRegionData();
  },

  async loadData() {
    try {
      this.setData({ loading: true });
      const result = await db.getLeaderboard();
      const ranked = (result.ranked || [])
        .filter(u => u.totalArea > 0)
        .map(u => {
          const lv = getLevelName(u.xp || 0);
          return {
            ...u,
            areaDisplay: this.formatArea(u.totalArea / 1e6),
            levelNum: lv.level,
            levelName: lv.name,
            isMaxLevel: lv.level >= 7
          };
        });
      const restList = ranked.slice(3, 20);
      const me = result.me ? (() => {
        const lv = getLevelName(result.me.xp || 0);
        return {
          ...result.me,
          areaDisplay: this.formatArea((result.me.totalArea || 0) / 1e6),
          levelNum: lv.level,
          levelName: lv.name,
          isMaxLevel: lv.level >= 7
        };
      })() : null;

      this.setData({ ranked, restList, me, loading: false });

      if (this.data.activeTab === 'region' && this.data.regionList.length === 0) {
        this.loadRegionData();
      }
    } catch (err) {
      console.error('Load leaderboard failed:', err);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  async loadRegionData() {
    try {
      const result = await db.getRegionLeaderboard(this.data.regionLevel);
      const regionList = (result.regions || []).map((r, i) => ({
        rank: i + 1,
        name: r._id || '未知',
        totalCount: r.totalCount,
        userCount: (r.users || []).length
      }));
      this.setData({ regionList });
    } catch (err) {
      console.error('Load region leaderboard failed:', err);
      wx.showToast({ title: '区域排行加载失败', icon: 'none' });
    }
  },

  formatArea(km2) {
    if (km2 >= 10000) return (km2 / 10000).toFixed(1) + '万';
    if (km2 >= 1000) return km2.toFixed(0);
    if (km2 >= 1) return km2.toFixed(1);
    return km2.toFixed(2);
  },

  onShowProfileModal() {
    this._avatarChanged = false;
    this.setData({ showProfileModal: true, nickInput: '' });
  },

  noop() {},

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

      if (avatarPath && avatarPath.startsWith('cloud://')) {
        avatarUrl = avatarPath;
      } else if (avatarPath) {
        const cloudPath = `avatars/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
        const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath: avatarPath });
        avatarUrl = uploadRes.fileID;
      }

      await db.saveProfile({ nickName, avatarUrl: avatarUrl || '' });
      this.setData({ showProfileModal: false, saving: false });
      wx.showToast({ title: '保存成功', icon: 'success' });
      this.loadData();
    } catch (err) {
      console.error('Save profile failed:', err);
      this.setData({ saving: false });
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  }
});
