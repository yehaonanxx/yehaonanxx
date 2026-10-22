const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  settleAttempts,
  WALLET_CAP,
  REGEN_FLOOR,
  REGEN_INTERVAL_MS,
  INITIAL_ATTEMPTS
} = require('../cloudfunctions/clearFog/gameplay');

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

test('经济常量与 spec 一致', () => {
  assert.equal(INITIAL_ATTEMPTS, 5);
  assert.equal(WALLET_CAP, 10);
  assert.equal(REGEN_FLOOR, 3);
  assert.equal(REGEN_INTERVAL_MS, 4 * HOUR);
});

test('不足 4 小时不恢复', () => {
  const ts = NOW - (3 * HOUR + 59 * 60 * 1000);
  const r = settleAttempts({ attempts: 0, attemptUpdatedAtMs: ts, nowMs: NOW });
  assert.equal(r.attempts, 0);
  assert.equal(r.attemptUpdatedAtMs, ts);
  assert.equal(r.changed, false);
});

test('满 4 小时恢复 1 次并推进时间戳', () => {
  const ts = NOW - 4 * HOUR;
  const r = settleAttempts({ attempts: 0, attemptUpdatedAtMs: ts, nowMs: NOW });
  assert.equal(r.attempts, 1);
  assert.equal(r.attemptUpdatedAtMs, ts + 4 * HOUR);
  assert.equal(r.changed, true);
});

test('7 小时恢复 1 次，剩余 3 小时保留', () => {
  const ts = NOW - 7 * HOUR;
  const r = settleAttempts({ attempts: 0, attemptUpdatedAtMs: ts, nowMs: NOW });
  assert.equal(r.attempts, 1);
  assert.equal(r.attemptUpdatedAtMs, ts + 4 * HOUR);
});

test('长期离开只补到保底线 3，多余时间作废', () => {
  const r = settleAttempts({
    attempts: 0,
    attemptUpdatedAtMs: NOW - 100 * HOUR,
    nowMs: NOW
  });
  assert.equal(r.attempts, REGEN_FLOOR);
  assert.equal(r.attemptUpdatedAtMs, NOW);
});

test('保底线之上不恢复、不囤积时间', () => {
  const ts = NOW - 100 * HOUR;
  const r = settleAttempts({ attempts: 5, attemptUpdatedAtMs: ts, nowMs: NOW });
  assert.equal(r.attempts, 5);
  assert.equal(r.attemptUpdatedAtMs, ts);
  assert.equal(r.changed, false);
});

test('缺时间戳按「立即补到 3」处理', () => {
  const r = settleAttempts({ attempts: 1, attemptUpdatedAtMs: null, nowMs: NOW });
  assert.equal(r.attempts, 3);
  assert.equal(r.attemptUpdatedAtMs, NOW);
  assert.equal(r.changed, true);
});

test('缺时间戳但已高于保底线：保留次数并补时间戳', () => {
  const r = settleAttempts({ attempts: 5, attemptUpdatedAtMs: null, nowMs: NOW });
  assert.equal(r.attempts, 5);
  assert.equal(r.attemptUpdatedAtMs, NOW);
  assert.equal(r.changed, true);
});

test('存量超上限夹到钱包上限 10', () => {
  const r = settleAttempts({ attempts: 200, attemptUpdatedAtMs: NOW, nowMs: NOW });
  assert.equal(r.attempts, WALLET_CAP);
  assert.equal(r.changed, true);
});

test('2 次 + 8 小时 → 封顶 3 且时间戳置 now', () => {
  const r = settleAttempts({
    attempts: 2,
    attemptUpdatedAtMs: NOW - 8 * HOUR,
    nowMs: NOW
  });
  assert.equal(r.attempts, 3);
  assert.equal(r.attemptUpdatedAtMs, NOW);
});

test('时间戳来自未来时不产生负恢复', () => {
  const ts = NOW + HOUR;
  const r = settleAttempts({ attempts: 0, attemptUpdatedAtMs: ts, nowMs: NOW });
  assert.equal(r.attempts, 0);
  assert.equal(r.attemptUpdatedAtMs, ts);
});
