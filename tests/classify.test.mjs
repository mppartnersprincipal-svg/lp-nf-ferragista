// Atribuição de canal e leitura de user-agent (api/_lib/classify.js), mesmas regras da Gaspar/Sólida.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyChannel, parseUA, isBotUA } from '../api/_lib/classify.js';

test('gclid always means Google Ads', () => {
  assert.equal(classifyChannel({ gclid: true }), 'google_ads');
  assert.equal(classifyChannel({ gclid: true, referrer_host: 'google.com' }), 'google_ads');
});

test('google + paid medium without gclid is Google Ads', () => {
  for (const utm_medium of ['cpc', 'ppc', 'paid', 'ads', 'display']) {
    assert.equal(classifyChannel({ utm_source: 'google', utm_medium }), 'google_ads', utm_medium);
  }
});

test('link opened from inside the Ads panel or raw ValueTrack is direct, even with gclid', () => {
  assert.equal(classifyChannel({ gclid: true, referrer_host: 'ads.google.com' }), 'direct');
  assert.equal(classifyChannel({ gclid: true, utm_term: '{keyword}' }), 'direct');
  assert.equal(classifyChannel({ utm_source: 'google', utm_medium: 'cpc', utm_term: '{matchtype}' }), 'direct');
});

test('Instagram and Facebook split organic vs Meta Ads by medium', () => {
  assert.equal(classifyChannel({ utm_source: 'instagram' }), 'instagram');
  assert.equal(classifyChannel({ utm_source: 'ig', utm_medium: 'paid_social' }), 'meta_ads');
  assert.equal(classifyChannel({ utm_source: 'facebook' }), 'facebook');
  assert.equal(classifyChannel({ utm_source: 'fb', utm_medium: 'cpc' }), 'meta_ads');
  assert.equal(classifyChannel({ utm_source: 'meta', utm_medium: 'paid' }), 'meta_ads');
});

test('unknown utm_source is other; referrer decides when there is no UTM', () => {
  assert.equal(classifyChannel({ utm_source: 'newsletter' }), 'other');
  assert.equal(classifyChannel({}), 'direct');
  assert.equal(classifyChannel({ referrer_host: 'google.com.br' }), 'google_organic');
  assert.equal(classifyChannel({ referrer_host: 'l.instagram.com' }), 'instagram');
  assert.equal(classifyChannel({ referrer_host: 'm.facebook.com' }), 'facebook');
  assert.equal(classifyChannel({ referrer_host: 'bing.com' }), 'search_other');
  assert.equal(classifyChannel({ referrer_host: 'portaldaobra.com.br' }), 'referral');
});

test('UTM wins over referrer and matching is case-insensitive', () => {
  assert.equal(classifyChannel({ utm_source: 'Google', utm_medium: 'CPC', referrer_host: 'facebook.com' }), 'google_ads');
  assert.equal(classifyChannel({ utm_source: 'INSTAGRAM', referrer_host: 'google.com' }), 'instagram');
});

test('parseUA detects device, browser and OS', () => {
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  const android = 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0 Mobile Safari/537.36';
  const tablet = 'Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
  const edge = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0';
  assert.deepEqual(parseUA(iphone), { device: 'mobile', browser: 'Safari', os: 'iOS' });
  assert.deepEqual(parseUA(android), { device: 'mobile', browser: 'Samsung Internet', os: 'Android' });
  assert.deepEqual(parseUA(tablet), { device: 'tablet', browser: 'Chrome', os: 'Android' });
  assert.deepEqual(parseUA(edge), { device: 'desktop', browser: 'Edge', os: 'Windows' });
  assert.deepEqual(parseUA(''), { device: 'desktop', browser: 'Outro', os: 'Outro' });
});

test('bots, previews and scripts are ignored', () => {
  for (const ua of ['Googlebot/2.1', 'facebookexternalhit/1.1', 'WhatsApp/2.23', 'HeadlessChrome/120', 'curl/8.0', 'python-requests/2.31', 'Chrome-Lighthouse']) {
    assert.equal(isBotUA(ua), true, ua);
  }
  assert.equal(isBotUA('Mozilla/5.0 (Windows NT 10.0) Chrome/120.0'), false);
});
