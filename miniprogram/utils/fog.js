const { geoToPixel, metersToPixels } = require('./location');

// ── Scale tracking ──

let _currentScale = 15;

function setScale(scale) {
  _currentScale = scale;
}

const HEATMAP_SCALE = 10; // Below this scale, use heatmap

// ── Seeded random ──

function seededRandom(seed) {
  let s = seed;
  return function() {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ── Cloud texture ──

function drawCloudLayer(ctx, w, h, rand, count, minR, maxR, baseAlpha) {
  for (let i = 0; i < count; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = minR + rand() * (maxR - minR);
    const alpha = baseAlpha * (0.4 + rand() * 0.6);

    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
    grad.addColorStop(0.5, `rgba(255, 255, 255, ${alpha * 0.5})`);
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  }
}

function drawCloudBase(ctx, w, h, seed) {
  ctx.fillStyle = 'rgba(50, 80, 85, 0.92)';
  ctx.fillRect(0, 0, w, h);
  drawCloudLayer(ctx, w, h, seededRandom(seed), 40, 60, 200, 0.12);
  drawCloudLayer(ctx, w, h, seededRandom(seed + 1), 30, 30, 100, 0.15);
  drawCloudLayer(ctx, w, h, seededRandom(seed + 2), 20, 15, 50, 0.1);
}

let _cloudCache = null;
let _cloudCacheKey = '';

function beginCloudCache(w, h, region) {
  const seed = Math.round((region.southwest.latitude + region.northeast.longitude) * 1000) & 0x7fffffff;
  const key = `${w}_${h}_${seed}`;

  if (_cloudCache && _cloudCacheKey === key) return;

  try {
    if (!_cloudCache) {
      _cloudCache = wx.createOffscreenCanvas({ type: '2d', width: w, height: h });
    }
    _cloudCache.width = w;
    _cloudCache.height = h;

    const cctx = _cloudCache.getContext('2d');
    cctx.clearRect(0, 0, w, h);
    drawCloudBase(cctx, w, h, seed);
    _cloudCacheKey = key;
  } catch (e) {
    _cloudCache = null;
    _cloudCacheKey = '';
  }
}

// ── Cleanup ──

function endCloudCache() {
  _cloudCache = null;
  _cloudCacheKey = '';
}

// ── Heatmap (global zoom) — aggregate light rings ──

const CLUSTER_DIST = 30;

function clusterScreenPoints(points, mergeDist) {
  const cell = mergeDist;
  const grid = new Map();
  const clusters = [];

  function key(cx, cy) {
    return cx + ':' + cy;
  }

  points.forEach((p) => {
    const cx = Math.floor(p.x / cell);
    const cy = Math.floor(p.y / cell);
    let target = null;

    for (let dx = -1; dx <= 1 && !target; dx++) {
      for (let dy = -1; dy <= 1 && !target; dy++) {
        const list = grid.get(key(cx + dx, cy + dy));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const c = clusters[list[i]];
          const ddx = c.x - p.x;
          const ddy = c.y - p.y;
          if (ddx * ddx + ddy * ddy <= mergeDist * mergeDist) {
            target = c;
            break;
          }
        }
      }
    }

    if (target) {
      const n = target.count;
      target.x = (target.x * n + p.x) / (n + 1);
      target.y = (target.y * n + p.y) / (n + 1);
      target.count = n + 1;
    } else {
      const idx = clusters.length;
      clusters.push({ x: p.x, y: p.y, count: 1 });
      const k = key(cx, cy);
      let list = grid.get(k);
      if (!list) {
        list = [];
        grid.set(k, list);
      }
      list.push(idx);
    }
  });

  return clusters;
}

function drawLightRing(ctx, x, y, count) {
  // 0 → single point, 1 → dense city
  const boost = Math.min(1, Math.log(count + 1) / Math.log(24));
  const ringR = 14 + 16 * boost;
  const coreA = 0.55 + 0.35 * boost;
  const ringA = 0.35 + 0.4 * boost;

  // Ambient fill (soft body under the ring)
  const haloR = ringR * 2.2;
  const halo = ctx.createRadialGradient(x, y, ringR * 0.2, x, y, haloR);
  halo.addColorStop(0, `rgba(255, 196, 110, ${0.12 + 0.1 * boost})`);
  halo.addColorStop(0.5, `rgba(255, 170, 80, ${0.05 + 0.05 * boost})`);
  halo.addColorStop(1, 'rgba(255, 150, 60, 0)');
  ctx.beginPath();
  ctx.arc(x, y, haloR, 0, Math.PI * 2);
  ctx.fillStyle = halo;
  ctx.fill();

  // Bloom ring (drawn fat→thin for glow)
  ctx.beginPath();
  ctx.arc(x, y, ringR, 0, Math.PI * 2);
  ctx.lineWidth = 6 + 4 * boost;
  ctx.strokeStyle = `rgba(240, 192, 64, ${ringA * 0.35})`;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x, y, ringR, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = `rgba(255, 230, 160, ${ringA})`;
  ctx.stroke();

  // Core
  const coreR = 2.5 + 2.5 * boost;
  const core = ctx.createRadialGradient(x, y, 0, x, y, coreR * 3);
  core.addColorStop(0, `rgba(255, 248, 230, ${coreA})`);
  core.addColorStop(0.35, `rgba(255, 220, 140, ${coreA * 0.55})`);
  core.addColorStop(1, 'rgba(255, 200, 100, 0)');
  ctx.beginPath();
  ctx.arc(x, y, coreR * 3, 0, Math.PI * 2);
  ctx.fillStyle = core;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x, y, coreR * 0.55, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255, 255, 250, ${Math.min(1, coreA + 0.2)})`;
  ctx.fill();
}

function renderHeatmap(ctx, width, height, clearedAreas, region, mapHeight) {
  ctx.clearRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;

  // Dark base — slightly translucent so map stays readable at global zoom
  ctx.fillStyle = 'rgba(12, 16, 26, 0.78)';
  ctx.fillRect(0, 0, width, height);

  if (clearedAreas.length === 0) return;

  const points = clearedAreas.map((area) => {
    return geoToPixel(area.latitude, area.longitude, region, width, mapHeight);
  });
  const clusters = clusterScreenPoints(points, CLUSTER_DIST);

  ctx.globalCompositeOperation = 'lighter';
  clusters.forEach((c) => {
    drawLightRing(ctx, c.x, c.y, c.count);
  });
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

// ── Fog with circles ──

const MIN_RADIUS_PX = 20;

function renderFogCircles(ctx, width, height, clearedAreas, region, mapHeight) {
  beginCloudCache(width, height, region);

  ctx.clearRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;

  if (_cloudCache) {
    ctx.drawImage(_cloudCache, 0, 0, width, height);
  } else {
    const seed = Math.round((region.southwest.latitude + region.northeast.longitude) * 1000) & 0x7fffffff;
    drawCloudBase(ctx, width, height, seed);
  }

  ctx.globalCompositeOperation = 'destination-out';
  ctx.globalAlpha = 1;

  clearedAreas.forEach(area => {
    const { x, y } = geoToPixel(area.latitude, area.longitude, region, width, mapHeight);
    const radiusPx = Math.max(metersToPixels(area.radius, region, width, mapHeight), MIN_RADIUS_PX);

    ctx.beginPath();
    ctx.arc(x, y, radiusPx, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 1)';
    ctx.fill();

    const gradient = ctx.createRadialGradient(x, y, radiusPx * 0.5, x, y, radiusPx);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 1)');
    ctx.beginPath();
    ctx.arc(x, y, radiusPx, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
  });

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

/**
 * Main render — dispatches to heatmap or fog based on zoom scale
 */
function renderFog(ctx, width, height, clearedAreas, region, mapHeight) {
  if (_currentScale < HEATMAP_SCALE) {
    renderHeatmap(ctx, width, height, clearedAreas, region, mapHeight);
  } else {
    renderFogCircles(ctx, width, height, clearedAreas, region, mapHeight);
  }
}

/**
 * Clearing animation — only plays at high zoom, at low zoom just re-render heatmap
 */
function animateClear(ctx, x, y, maxRadius, canvasWidth, canvasHeight, clearedAreas, region, mapHeight, callback) {
  // At low zoom, skip animation and just re-render heatmap
  if (_currentScale < HEATMAP_SCALE) {
    renderHeatmap(ctx, canvasWidth, canvasHeight, clearedAreas, region, mapHeight);
    if (callback) callback();
    return;
  }

  const totalFrames = 40;
  let frame = 0;

  beginCloudCache(canvasWidth, canvasHeight, region);

  function animate() {
    frame++;
    const progress = frame / totalFrames;

    if (progress >= 1) {
      renderFogCircles(ctx, canvasWidth, canvasHeight, clearedAreas, region, mapHeight);
      if (callback) callback();
      return;
    }

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    ctx.drawImage(_cloudCache, 0, 0, canvasWidth, canvasHeight);

    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 1;

    const existingAreas = clearedAreas.slice(0, -1);
    existingAreas.forEach(area => {
      const pos = geoToPixel(area.latitude, area.longitude, region, canvasWidth, mapHeight);
      const rPx = Math.max(metersToPixels(area.radius, region, canvasWidth, mapHeight), MIN_RADIUS_PX);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, rPx, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 1)';
      ctx.fill();
    });

    const easeProgress = 1 - Math.pow(1 - progress, 3);
    const mainRadius = easeProgress * Math.max(maxRadius, MIN_RADIUS_PX);

    if (mainRadius > 0) {
      ctx.beginPath();
      ctx.arc(x, y, mainRadius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 1)';
      ctx.fill();
    }

    for (let i = 0; i < 4; i++) {
      const ringProgress = Math.max(0, progress - i * 0.08);
      if (ringProgress <= 0) continue;

      const ringEase = 1 - Math.pow(1 - ringProgress, 2);
      const ringRadius = ringEase * Math.max(maxRadius, MIN_RADIUS_PX);
      const ringOpacity = Math.max(0, 1 - ringProgress * 1.5);

      if (ringOpacity <= 0 || ringRadius <= 0) continue;

      ctx.beginPath();
      ctx.arc(x, y, ringRadius, 0, Math.PI * 2);
      ctx.lineWidth = 4;
      ctx.strokeStyle = `rgba(0, 0, 0, ${ringOpacity})`;
      ctx.stroke();
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    setTimeout(animate, 25);
  }

  animate();
}

/**
 * Filter cleared areas to only those visible in current region
 */
function filterVisibleAreas(clearedAreas, region) {
  const { southwest, northeast } = region;
  return clearedAreas.filter(area => {
    return area.latitude >= southwest.latitude &&
           area.latitude <= northeast.latitude &&
           area.longitude >= southwest.longitude &&
           area.longitude <= northeast.longitude;
  });
}

// ── Stars & Constellations ──

const STAR_BASE_RADIUS = 5;
const STAR_GLOW_RADIUS = 28;
const CONSTELLATION_DIST = 200;
const TWINKLE_SPEED = 0.002;

function renderStars(ctx, width, height, clearedAreas, region, mapHeight, time) {
  ctx.clearRect(0, 0, width, height);
  if (clearedAreas.length === 0) return;

  const positions = clearedAreas.map(area => {
    const { x, y } = geoToPixel(area.latitude, area.longitude, region, width, mapHeight);
    return { x, y };
  });

  // Constellation lines
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = '#a5b4fc';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const dx = positions[i].x - positions[j].x;
      const dy = positions[i].y - positions[j].y;
      if (Math.sqrt(dx * dx + dy * dy) < CONSTELLATION_DIST) {
        ctx.beginPath();
        ctx.moveTo(positions[i].x, positions[i].y);
        ctx.lineTo(positions[j].x, positions[j].y);
        ctx.stroke();
      }
    }
  }

  // Stars with additive blending
  ctx.globalCompositeOperation = 'lighter';

  positions.forEach((pos, i) => {
    const twinkle = 0.55 + 0.45 * Math.sin(time * TWINKLE_SPEED + i * 1.7);
    const r = STAR_BASE_RADIUS * twinkle;

    // Outer glow
    const outerGlow = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, STAR_GLOW_RADIUS * 1.5);
    outerGlow.addColorStop(0, `rgba(180, 200, 255, ${0.5 * twinkle})`);
    outerGlow.addColorStop(0.4, `rgba(150, 170, 255, ${0.15 * twinkle})`);
    outerGlow.addColorStop(1, 'rgba(150, 170, 255, 0)');
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, STAR_GLOW_RADIUS * 1.5, 0, Math.PI * 2);
    ctx.fillStyle = outerGlow;
    ctx.fill();

    // Inner glow
    const glow = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, STAR_GLOW_RADIUS);
    glow.addColorStop(0, `rgba(220, 235, 255, ${0.8 * twinkle})`);
    glow.addColorStop(0.5, `rgba(180, 200, 255, ${0.25 * twinkle})`);
    glow.addColorStop(1, 'rgba(160, 180, 255, 0)');
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, STAR_GLOW_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();

    // Core
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(240, 248, 255, ${twinkle})`;
    ctx.fill();
  });

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

module.exports = {
  renderFog,
  animateClear,
  filterVisibleAreas,
  endCloudCache,
  setScale,
  renderStars
};
