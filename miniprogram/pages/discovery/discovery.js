const db = require('../../utils/db');
const { getRarityMeta, RARITY_META } = require('../../utils/gameplay');

Page({
  data: {
    statusBarHeight: 0,
    loading: true,
    cities: [],
    totalCount: 0,
    summary: { total: 0, cityCount: 0, rareCount: 0, epicCount: 0 },
    rarityLegend: []
  },

  onLoad() {
    this.setData({
      statusBarHeight: wx.getSystemInfoSync().statusBarHeight,
      rarityLegend: Object.keys(RARITY_META).map((k) => ({
        key: k,
        name: RARITY_META[k].name,
        color: RARITY_META[k].color
      }))
    });
  },

  onShow() {
    this.loadData();
  },

  onPullDownRefresh() {
    this.loadData().then(() => wx.stopPullDownRefresh());
  },

  async loadData() {
    try {
      this.setData({ loading: true });
      const result = await db.getMyDiscoveries();
      const discoveries = result.discoveries || [];

      // Group by city
      const cityMap = {};
      discoveries.forEach(item => {
        const city = item.city || '未知城市';
        if (!cityMap[city]) {
          cityMap[city] = [];
        }
        const rarity = item.rarity || 'common';
        const rm = getRarityMeta(rarity);
        cityMap[city].push({
          placeName: item.placeName || item.district || '未知地点',
          date: this.formatDate(item.createdAt),
          rarity,
          rarityName: rm.name,
          rarityColor: rm.color
        });
      });

      // Convert to array and sort by count desc
      const cities = Object.keys(cityMap)
        .map(name => ({
          name,
          places: cityMap[name],
          count: cityMap[name].length
        }))
        .sort((a, b) => b.count - a.count);

      this.setData({
        cities,
        totalCount: discoveries.length,
        summary: result.summary || {
          total: discoveries.length,
          cityCount: cities.length,
          rareCount: 0,
          epicCount: 0
        },
        loading: false
      });
    } catch (err) {
      console.error('Load discoveries failed:', err);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  formatDate(dateStr) {
    if (!dateStr) return '';
    // Handle both ISO string and { $date: ... } formats
    const d = typeof dateStr === 'object' && dateStr.$date ? new Date(dateStr.$date) : new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    const m = d.getMonth() + 1;
    const day = d.getDate();
    return `${m}月${day}日`;
  },

  onBack() {
    wx.navigateBack();
  }
});
