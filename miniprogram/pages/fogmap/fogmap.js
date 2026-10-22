const db = require('../../utils/db');
const fog = require('../../utils/fog');
const { geoToPixel, metersToPixels } = require('../../utils/location');
const { getRarityMeta, getBadgeMeta } = require('../../utils/gameplay');

const CLEAR_RADIUS = 2000; // 2 kilometers
const LOCATED_SCALE = 12;

Page({
  data: {
    latitude: 39.9042,
    longitude: 116.4074,
    scale: 15,
    currentScale: '',
    clearAttempts: 0,
    loading: true,
    showWelcome: false,
    showGuide: false,
    guideStep: 0,
    located: false,
    showOnlyMine: false,
    fogHidden: false,
    overviewMode: false,
    clearedCircles: [],
    claimMode: false,
    claimLat: 0,
    claimLng: 0,
    claimPlaceName: '',
    claimMarkers: [],
    claimUsed: 0,
    claimLimit: 0,
    claimWarning: '',
    showResult: false,
    result: null
  },

  ctx: null,
  starCtx: null,
  mapCtx: null,
  region: null,
  canvasWidth: 375,
  canvasHeight: 667,
  allClearedAreas: [],
  myOpenid: '',
  canvasReady: false,
  starCanvasReady: false,
  pendingRender: false,
  loadingAreas: false,
  regionChangeTimer: null,
  mapUpdatedTimer: null,
  lastLocation: null,
  _starTimer: null,
  _touchTimer: null,
  _touchStartPos: null,
  _touchStartTime: 0,

  onLoad(options) {
    if (options.latitude && options.longitude) {
      this.setData({
        latitude: parseFloat(options.latitude),
        longitude: parseFloat(options.longitude),
        scale: options.scale ? parseInt(options.scale, 10) : this.data.scale
      });
    }

    this.checkWelcome();
    this.initUser();
  },

  onUnload() {
    this.stopStarAnimation();
    fog.endCloudCache();
  },

  onReady() {
    this.mapCtx = wx.createMapContext('fogMap', this);
    fog.setScale(this.data.scale);
    this.initCanvas();
    this.loadClearedAreas();
    this.updateScale();
    this.autoLocate();

    // 老用户补引导
    if (wx.getStorageSync('welcomed') && !wx.getStorageSync('guided')) {
      this.startGuide();
    }
  },

  autoLocate() {
    new Promise((resolve) => {
      wx.getSetting({ success: resolve, fail: resolve });
    }).then((setting) => {
      if (setting.authSetting && setting.authSetting['scope.userLocation']) {
        return this.requestLocation().then((location) => {
          this.lastLocation = location;
          this.setData({
            latitude: location.latitude,
            longitude: location.longitude,
            scale: LOCATED_SCALE,
            located: true
          });
        });
      }
    }).catch(() => {
      // silently ignore — user can tap locate button manually
    });
  },

  checkWelcome() {
    const welcomed = wx.getStorageSync('welcomed');
    if (!welcomed) {
      this.setData({ showWelcome: true });
    }
  },

  onWelcomeConfirm() {
    this.requestLocation().then((location) => {
      this.lastLocation = location;
      wx.setStorageSync('welcomed', true);
      this.setData({
        showWelcome: false,
        located: true,
        latitude: location.latitude,
        longitude: location.longitude,
        scale: LOCATED_SCALE
      });
      this.startGuide();
    }).catch((err) => {
      console.error('Location request failed:', err);
      wx.setStorageSync('welcomed', true);
      this.setData({ showWelcome: false });
      wx.showToast({ title: '可稍后在右下角定位', icon: 'none' });
      this.startGuide();
    });
  },

  startGuide() {
    if (wx.getStorageSync('guided')) return;
    this.setData({ showGuide: true, guideStep: 0 });
  },

  nextGuideStep() {
    const next = this.data.guideStep + 1;
    if (next >= 4) {
      this.finishGuide();
    } else {
      this.setData({ guideStep: next });
    }
  },

  finishGuide() {
    wx.setStorageSync('guided', true);
    this.setData({ showGuide: false, guideStep: 0 });
  },

  initCanvas() {
    const sysInfo = wx.getSystemInfoSync();
    const dpr = sysInfo.pixelRatio;
    const w = sysInfo.windowWidth;
    const h = sysInfo.windowHeight;

    this.canvasWidth = w;
    this.canvasHeight = h;

    const query = wx.createSelectorQuery();
    query.select('#fogCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res[0]) return;

        const canvas = res[0].node;
        this.ctx = canvas.getContext('2d');

        const cw = res[0].width || w;
        const ch = res[0].height || h;

        canvas.width = cw * dpr;
        canvas.height = ch * dpr;
        this.ctx.scale(dpr, dpr);

        this.canvasWidth = cw;
        this.canvasHeight = ch;
        this.canvasReady = true;

        if (this.pendingRender) {
          this.pendingRender = false;
          this.renderFog();
        }

        // 星座连线需要 Lv3
        const userLevel = wx.getStorageSync('userLevel') || 0;
        if (userLevel >= 3) {
          this.startStarAnimation();
        }
      });

    // Star canvas
    const q2 = wx.createSelectorQuery();
    q2.select('#starCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res[0]) {
          console.warn('[star] canvas not found');
          return;
        }

        const canvas = res[0].node;
        this.starCtx = canvas.getContext('2d');

        const cw = res[0].width || w;
        const ch = res[0].height || h;

        canvas.width = cw * dpr;
        canvas.height = ch * dpr;
        this.starCtx.scale(dpr, dpr);

        this.starCanvasReady = true;

        // Start animation if scale and level allow
        const userLevel = wx.getStorageSync('userLevel') || 0;
        if (this.data.scale >= 10 && userLevel >= 3) {
          this.startStarAnimation();
        }
      });
  },

  initUser() {
    db.initUser().then((initResult) => {
      this.myOpenid = initResult.openid || initResult._id || '';
      return db.getUserStats();
    }).then((stats) => {
      // 缓存等级
      const xp = stats.xp || 0;
      const LEVELS_XP = [0, 200, 800, 2000, 5000, 10000, 20000];
      let userLevel = 1;
      for (let i = LEVELS_XP.length - 1; i >= 0; i--) {
        if (xp >= LEVELS_XP[i]) { userLevel = i + 1; break; }
      }
      wx.setStorageSync('userLevel', userLevel);

      // 计算认领次数
      const today = new Date().toISOString().slice(0, 10);
      const claimUsed = (stats.claimDate === today) ? (stats.claimCount || 0) : 0;
      const claimLimits = [[7,7],[6,5],[5,4],[4,3],[3,2],[2,1]];
      let claimLimit = 0;
      for (const [lv, limit] of claimLimits) {
        if (userLevel >= lv) { claimLimit = limit; break; }
      }

      this.setData({
        clearAttempts: stats.clearAttempts || 0,
        claimUsed,
        claimLimit
      });
    }).catch((err) => {
      console.error('Init user failed:', err);
      wx.showToast({ title: '初始化失败', icon: 'none' });
    });
  },

  requestLocation() {
    return new Promise((resolve, reject) => {
      wx.getLocation({
        type: 'gcj02',
        success: resolve,
        fail: reject
      });
    });
  },

  loadClearedAreas() {
    if (!this.mapCtx || this.loadingAreas) return;

    this.loadingAreas = true;
    this.getMapRegion().then((region) => {
      if (!region) {
        this.loadingAreas = false;
        return;
      }

      const latPad = region.northeast.latitude - region.southwest.latitude;
      const lngPad = region.northeast.longitude - region.southwest.longitude;

      return db.getClearedAreas({
        south: region.southwest.latitude - latPad,
        west: region.southwest.longitude - lngPad,
        north: region.northeast.latitude + latPad,
        east: region.northeast.longitude + lngPad
      }).then((areas) => {
        this.allClearedAreas = areas;
        this.syncClearedCircles();
        this.renderFog();
        this.setData({ loading: false });
        this.loadingAreas = false;
      });
    }).catch((err) => {
      console.error('Load cleared areas failed:', err);
      this.setData({ loading: false });
      this.loadingAreas = false;
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  },

  updateRegionAndRender() {
    return this.getMapRegion().then((region) => {
      if (region) {
        this.renderFog();
      }
      return region;
    });
  },

  getMapRegion() {
    return new Promise((resolve) => {
      if (!this.mapCtx) {
        resolve(null);
        return;
      }

      this.mapCtx.getRegion({
        success: (res) => {
          this.region = {
            southwest: res.southwest,
            northeast: res.northeast
          };
          resolve(this.region);
        },
        fail: () => resolve(null)
      });
    });
  },

  renderFog() {
    if (!this.ctx || !this.region) return;
    if (!this.canvasReady) {
      this.pendingRender = true;
      return;
    }

    let visibleAreas = fog.filterVisibleAreas(this.allClearedAreas, this.region);
    if (this.data.showOnlyMine) {
      visibleAreas = visibleAreas.filter((area) =>
        this.myOpenid && area.clearedBy === this.myOpenid
      );
    }

    const mapHeight = wx.getSystemInfoSync().windowHeight;

    fog.renderFog(
      this.ctx,
      this.canvasWidth,
      this.canvasHeight,
      visibleAreas,
      this.region,
      mapHeight
    );
  },

  startStarAnimation() {
    if (this._starTimer) return;
    const animate = () => {
      if (this.starCanvasReady && this.region) {
        this.renderStars();
      }
      this._starTimer = setTimeout(animate, 100);
    };
    animate();
  },

  stopStarAnimation() {
    if (this._starTimer) {
      clearTimeout(this._starTimer);
      this._starTimer = null;
    }
  },

  renderStars() {
    if (!this.starCtx || !this.starCanvasReady || !this.region) return;

    const mapHeight = wx.getSystemInfoSync().windowHeight;
    let visibleAreas = fog.filterVisibleAreas(this.allClearedAreas, this.region);
    if (this.data.showOnlyMine) {
      visibleAreas = visibleAreas.filter((area) =>
        this.myOpenid && area.clearedBy === this.myOpenid
      );
    }

    fog.renderStars(
      this.starCtx,
      this.canvasWidth,
      this.canvasHeight,
      visibleAreas,
      this.region,
      mapHeight,
      Date.now()
    );
  },

  syncClearedCircles() {
    const circles = this.allClearedAreas.map((area) => {
      const isMine = this.myOpenid && area.clearedBy === this.myOpenid;
      return {
        latitude: area.latitude,
        longitude: area.longitude,
        radius: area.radius,
        color: isMine ? '#D4A017AA' : '#3B82F6AA',
        fillColor: isMine ? '#D4A01726' : '#60A5FA26',
        strokeWidth: 2,
        isMine
      };
    });

    const clearedCircles = this.data.showOnlyMine
      ? circles.filter((c) => c.isMine)
      : circles;

    this.setData({ clearedCircles });
  },

  onToggleOnlyMine() {
    const next = !this.data.showOnlyMine;
    this.setData({ showOnlyMine: next }, () => {
      this.syncClearedCircles();
      this.renderFog();
    });
    wx.showToast({
      title: next ? '只看我的' : '显示全部',
      icon: 'none',
      duration: 1000
    });
  },

  onRegionChange(e) {
    if (e.type === 'begin' || e.type === 'ing') {
      if (!this.data.fogHidden) {
        this.setData({ fogHidden: true });
      }
      return;
    }

    // type === 'end'
    this.updateScale();
    this.loadClearedAreas();
    this.scheduleRenderAfterMapSettles();
  },

  updateScale() {
    if (!this.mapCtx) return;
    this.mapCtx.getScale({
      success: (res) => {
        this.setData({ currentScale: res.scale });
        fog.setScale(res.scale);
        // Stars only at high zoom and level >= 3
        const userLevel = wx.getStorageSync('userLevel') || 0;
        if (res.scale >= 10 && userLevel >= 3) {
          this.startStarAnimation();
        } else {
          this.stopStarAnimation();
          if (this.starCtx && this.starCanvasReady) {
            this.starCtx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
          }
        }
      }
    });
  },

  scheduleRenderAfterMapSettles() {
    [120, 320].forEach((delay) => {
      setTimeout(() => {
        this.updateRegionAndRender();
      }, delay);
    });
    setTimeout(() => {
      this.setData({ fogHidden: false });
    }, 350);
  },

  onClearFog() {
    if (this.data.clearAttempts <= 0) {
      wx.showModal({
        title: '驱散次数不足',
        content: '签到 2 次可获得 1 次驱散机会，去签到吗？',
        confirmText: '去签到',
        success: (res) => {
          if (res.confirm) {
            wx.switchTab({ url: '/pages/profile/profile' });
          }
        }
      });
      return;
    }

    wx.showLoading({ title: '驱散中...' });

    this.requestLocation().then((location) => {
      this.lastLocation = location;
      return db.clearFog(location.latitude, location.longitude, CLEAR_RADIUS).then((result) => {
        if (!result.success) {
          wx.hideLoading();
          wx.showToast({ title: result.message, icon: 'none' });
          return;
        }

        const newArea = {
          latitude: location.latitude,
          longitude: location.longitude,
          radius: CLEAR_RADIUS,
          clearedBy: this.myOpenid
        };
        this.allClearedAreas.push(newArea);

        return this.setDataAsync({
          latitude: location.latitude,
          longitude: location.longitude,
          scale: LOCATED_SCALE,
          clearAttempts: result.clearAttempts
        }).then(() => {
          this.syncClearedCircles();
          return this.waitForMapRegionSettled();
        }).then(() => {
          this.playClearAnimation(location);
          wx.hideLoading();
          this.showDiscoveryResult(result);
        });
      });
    }).catch((err) => {
      wx.hideLoading();
      console.error('Clear fog failed:', err);
      this.showLocationPermissionModal();
    });
  },

  CHINA_LAT: 35.8617,
  CHINA_LNG: 104.1954,
  CHINA_SCALE: 4,

  onMoveToLocation() {
    if (this.data.overviewMode) {
      // Switch back to current location
      const locationPromise = this.lastLocation
        ? Promise.resolve(this.lastLocation)
        : this.requestLocation();

      locationPromise.then((location) => {
        this.lastLocation = location;
        fog.setScale(LOCATED_SCALE);
        return this.setDataAsync({
          latitude: location.latitude,
          longitude: location.longitude,
          scale: LOCATED_SCALE,
          located: true,
          overviewMode: false
        });
      }).then(() => {
        return this.waitForMapRegionSettled();
      }).then(() => {
        this.renderFog();
      }).catch((err) => {
        console.error('Move to location failed:', err);
        this.showLocationPermissionModal();
      });
    } else {
      // Switch to China overview
      fog.setScale(this.CHINA_SCALE);
      this.setDataAsync({
        latitude: this.CHINA_LAT,
        longitude: this.CHINA_LNG,
        scale: this.CHINA_SCALE,
        located: false,
        overviewMode: true
      }).then(() => {
        return this.waitForMapRegionSettled();
      }).then(() => {
        this.renderFog();
      });
    }
  },

  waitForMapRegionSettled() {
    return new Promise((resolve) => {
      setTimeout(() => {
        this.getMapRegion().then(() => resolve());
      }, 350);
    });
  },

  onMapUpdated() {
    if (this.mapUpdatedTimer) {
      clearTimeout(this.mapUpdatedTimer);
    }

    this.mapUpdatedTimer = setTimeout(() => {
      this.updateRegionAndRender();
    }, 50);
  },

  setDataAsync(data) {
    return new Promise((resolve) => {
      this.setData(data, resolve);
    });
  },

  playClearAnimation(location) {
    if (!this.region || !this.ctx) return;

    const mapHeight = wx.getSystemInfoSync().windowHeight;
    const canvasHeight = this.canvasHeight;

    const { x, y } = geoToPixel(
      location.latitude,
      location.longitude,
      this.region,
      this.canvasWidth,
      mapHeight
    );
    const radiusPx = metersToPixels(CLEAR_RADIUS, this.region, this.canvasWidth, mapHeight);

    let animationAreas = this.allClearedAreas;
    if (this.data.showOnlyMine) {
      animationAreas = animationAreas.filter((area) =>
        this.myOpenid && area.clearedBy === this.myOpenid
      );
    }

    fog.animateClear(
      this.ctx,
      x,
      y,
      radiusPx,
      this.canvasWidth,
      canvasHeight,
      animationAreas,
      this.region,
      mapHeight,
      () => { this.renderFog(); }
    );
  },

  noop() {},

  showDiscoveryResult(payload) {
    const rarityMeta = getRarityMeta(payload.rarity);
    const newBadges = (payload.newBadges || []).map((b) => ({
      ...b,
      icon: (getBadgeMeta(b.id) || {}).icon || '✦'
    }));
    this.setData({
      showResult: true,
      result: {
        placeName: payload.placeName || '未知地点',
        city: payload.city || '',
        rarityName: rarityMeta.name,
        rarityColor: rarityMeta.color,
        xpGained: payload.xpGained || 0,
        firstInCity: !!payload.firstInCity,
        newBadges
      }
    });
  },

  onResultClose() {
    this.setData({ showResult: false, result: null });
  },

  onMapTouchStart(e) {
    // 多指触控（缩放）时不触发长按
    if (e.touches.length > 1) {
      if (this._touchTimer) { clearTimeout(this._touchTimer); this._touchTimer = null; }
      return;
    }
    const touch = e.touches[0];
    this._touchStartPos = { x: touch.clientX, y: touch.clientY };
    this._touchTimer = setTimeout(() => {
      this._touchTimer = null;
      if (this.mapCtx.fromScreenLocation) {
        this.mapCtx.fromScreenLocation({
          x: this._touchStartPos.x,
          y: this._touchStartPos.y,
          success: (res) => {
            this._handleClaimPress(res.latitude, res.longitude);
          },
          fail: () => {
            this.mapCtx.getCenterLocation({
              success: (r) => this._handleClaimPress(r.latitude, r.longitude)
            });
          }
        });
      } else {
        this.mapCtx.getCenterLocation({
          success: (r) => this._handleClaimPress(r.latitude, r.longitude)
        });
      }
    }, 500);
  },

  onMapTouchMove(e) {
    if (!this._touchTimer) return;
    // 多指触控时取消
    if (e.touches.length > 1) {
      clearTimeout(this._touchTimer);
      this._touchTimer = null;
      return;
    }
    if (!this._touchStartPos) return;
    const touch = e.touches[0];
    const dx = touch.clientX - this._touchStartPos.x;
    const dy = touch.clientY - this._touchStartPos.y;
    if (dx * dx + dy * dy > 100) { // moved > 10px, cancel long-press
      clearTimeout(this._touchTimer);
      this._touchTimer = null;
    }
  },

  onMapTouchEnd() {
    if (this._touchTimer) {
      clearTimeout(this._touchTimer);
      this._touchTimer = null;
    }
    this._touchStartPos = null;
  },

  _haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  },

  _handleClaimPress(latitude, longitude) {
    console.log('[claim] long-press detected at', latitude, longitude);

    // 检查附近是否已有驱散区域
    const OVERLAP_DIST = CLEAR_RADIUS * 1.5; // 3km
    let claimWarning = '';
    for (const area of this.allClearedAreas) {
      const dist = this._haversine(latitude, longitude, area.latitude, area.longitude);
      if (dist < OVERLAP_DIST) {
        claimWarning = area.clearedBy === this.myOpenid
          ? '你已经驱散过这里了，试试探索新位置吧'
          : '这片区域已被点亮，换个位置试试';
        break;
      }
    }
    let userLevel = wx.getStorageSync('userLevel') || 0;
    const LEVELS_XP = [0, 200, 800, 2000, 5000, 10000, 20000];

    const checkAndProceed = (level) => {
      if (level < 2) {
        wx.showToast({ title: 'Lv.2 解锁认领驱散', icon: 'none' });
        return;
      }

      if (this.data.claimUsed >= this.data.claimLimit) {
        wx.showToast({ title: '超过当日认领驱散次数', icon: 'none' });
        return;
      }

      this.setData({
        claimMode: true,
        claimLat: latitude.toFixed(4),
        claimLng: longitude.toFixed(4),
        claimPlaceName: '',
        claimWarning,
        claimMarkers: [{
          id: 999,
          latitude,
          longitude,
          width: 30,
          height: 30,
          callout: {
            content: '认领此处',
            color: '#ffffff',
            fontSize: 14,
            borderRadius: 8,
            bgColor: '#d4a017',
            padding: 8,
            display: 'ALWAYS'
          }
        }]
      });

      // 尝试获取地名
      this.reverseGeocodeClient(latitude, longitude);
    };

    if (userLevel < 2) {
      db.getUserStats().then((stats) => {
        const xp = stats.xp || 0;
        for (let i = LEVELS_XP.length - 1; i >= 0; i--) {
          if (xp >= LEVELS_XP[i]) { userLevel = i + 1; break; }
        }
        wx.setStorageSync('userLevel', userLevel);
        checkAndProceed(userLevel);
      }).catch((err) => {
        console.error('Get level failed:', err);
        checkAndProceed(userLevel);
      });
    } else {
      checkAndProceed(userLevel);
    }
  },

  reverseGeocodeClient(lat, lng) {
    console.log('[geocode] calling', lat, lng);
    db.reverseGeocode(lat, lng).then((res) => {
      console.log('[geocode] result', JSON.stringify(res));
      if (res && res.name) {
        this.setData({ claimPlaceName: res.name });
      }
    }).catch((err) => {
      console.error('[geocode] failed', err);
    });
  },

  onClaimCancel() {
    this.setData({ claimMode: false, claimMarkers: [], claimWarning: '' });
  },

  onClaimConfirm() {
    if (!this.data.claimMode) return;

    const lat = parseFloat(this.data.claimLat);
    const lng = parseFloat(this.data.claimLng);

    wx.showLoading({ title: '认领驱散中...' });

    db.clearFog(lat, lng, CLEAR_RADIUS, true).then((result) => {
      if (!result.success) {
        wx.hideLoading();
        wx.showToast({ title: result.message, icon: 'none' });
        return;
      }

      const newArea = {
        latitude: lat,
        longitude: lng,
        radius: CLEAR_RADIUS,
        clearedBy: this.myOpenid
      };
      this.allClearedAreas.push(newArea);

      this.setData({
        claimMode: false,
        claimMarkers: [],
        latitude: lat,
        longitude: lng,
        scale: LOCATED_SCALE,
        clearAttempts: result.clearAttempts,
        claimUsed: result.claimCount,
        claimLimit: result.claimLimit
      });
      this.syncClearedCircles();

      return this.waitForMapRegionSettled().then(() => {
        this.playClearAnimation({ latitude: lat, longitude: lng });
        wx.hideLoading();
        this.showDiscoveryResult(result);
      });
    }).catch((err) => {
      wx.hideLoading();
      console.error('Claim failed:', err);
      wx.showToast({ title: '认领失败', icon: 'none' });
    });
  },

  onShareAppMessage() {
    return {
      title: '一起点亮世界，驱散迷雾',
      path: `/pages/fogmap/fogmap?latitude=${this.data.latitude}&longitude=${this.data.longitude}&scale=${this.data.scale}`,
      imageUrl: ''
    };
  },

  showLocationPermissionModal() {
    wx.showModal({
      title: '需要位置权限',
      content: '请在设置中开启位置权限后再驱散迷雾',
      confirmText: '去设置',
      success: (res) => {
        if (res.confirm) {
          wx.openSetting();
        }
      }
    });
  }
});
