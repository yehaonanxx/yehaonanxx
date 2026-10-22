const RARITY_META = {
  common: { name: '常见', color: '#8b9bb4', glow: 'rgba(139,155,180,0.35)' },
  uncommon: { name: '少见', color: '#38bdf8', glow: 'rgba(56,189,248,0.45)' },
  rare: { name: '珍稀', color: '#c084fc', glow: 'rgba(192,132,252,0.55)' },
  epic: { name: '史诗', color: '#fbbf24', glow: 'rgba(251,191,36,0.65)' }
};

const BADGE_META = [
  { id: 'first_light', name: '初火', desc: '完成首次驱散', icon: '✦' },
  { id: 'spark_10', name: '启明', desc: '驱散 10 次', icon: '✧' },
  { id: 'spark_50', name: '燎原', desc: '驱散 50 次', icon: '☄' },
  { id: 'city_3', name: '游城', desc: '发现 3 座城市', icon: '城' },
  { id: 'city_10', name: '行省', desc: '发现 10 座城市', icon: '省' },
  { id: 'rare_1', name: '秘境', desc: '发现珍稀地点', icon: '◆' },
  { id: 'epic_1', name: '史诗', desc: '发现史诗地点', icon: '★' },
  { id: 'max_level', name: '世界点亮者', desc: '达到最高等级', icon: '☀' }
];

function getRarityMeta(rarity) {
  return RARITY_META[rarity] || RARITY_META.common;
}

function getBadgeMeta(id) {
  return BADGE_META.find((b) => b.id === id) || null;
}

module.exports = {
  RARITY_META,
  BADGE_META,
  getRarityMeta,
  getBadgeMeta
};
