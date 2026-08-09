import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  getOpenTokenExpiresAtMs,
  getRefreshTokenExpiresAtMs,
  getTokenRefreshDueAtMs,
  type ChanjetState,
} from '../erp.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const receivedAt = Date.parse('2026-07-26T00:00:00.000Z');

afterEach(() => {
  delete process.env.CHANJET_AUTO_REFRESH_LEAD_HOURS;
  delete process.env.CHANJET_AUTO_REFRESH_MAX_AGE_HOURS;
});

describe('Chanjet token refresh timing', () => {
  it('uses the documented fallback lifetimes for open and refresh tokens', () => {
    const state: ChanjetState = {
      openTokenReceivedAt: new Date(receivedAt).toISOString(),
      refreshTokenReceivedAt: new Date(receivedAt).toISOString(),
    };

    assert.equal(getOpenTokenExpiresAtMs(state), receivedAt + 6 * DAY_MS);
    assert.equal(getRefreshTokenExpiresAtMs(state), receivedAt + 29 * DAY_MS);
  });

  it('refreshes before either the open token deadline or refresh-token max age', () => {
    const state: ChanjetState = {
      openTokenReceivedAt: new Date(receivedAt).toISOString(),
      refreshTokenReceivedAt: new Date(receivedAt).toISOString(),
      tokenExpiresIn: 6 * 24 * 60 * 60,
    };

    assert.equal(getTokenRefreshDueAtMs(state), receivedAt + 5 * DAY_MS);
  });

  it('honors bounded lead and max-age settings', () => {
    process.env.CHANJET_AUTO_REFRESH_LEAD_HOURS = '48';
    process.env.CHANJET_AUTO_REFRESH_MAX_AGE_HOURS = '72';
    const state: ChanjetState = {
      openTokenReceivedAt: new Date(receivedAt).toISOString(),
      refreshTokenReceivedAt: new Date(receivedAt).toISOString(),
      tokenExpiresIn: 10 * 24 * 60 * 60,
    };

    assert.equal(getTokenRefreshDueAtMs(state), receivedAt + 3 * DAY_MS);
  });
});
