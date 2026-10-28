import test from 'node:test';
import assert from 'node:assert/strict';
import { page } from '../src/auth-page.js';

test('OAuth consent form CSP permits same-origin POST and not arbitrary destinations', () => {
  const response=page('授权','<form method="post"><button>授权</button></form>');
  const csp=response.headers.get('content-security-policy')??'';
  assert.match(csp,/(?:^|;)\s*form-action 'self'(?:;|$)/);
  assert.doesNotMatch(csp, /form-action\s+self\b/);
  assert.doesNotMatch(csp, /chatgpt\.com/);
  assert.match(csp,/frame-ancestors 'none'/);
  assert.equal(response.headers.get('cache-control'),'no-store');
});

test('OAuth page escapes untrusted title', async () => {
  const response=page('<script>alert(1)</script>','OK');
  const html=await response.text();
  assert.doesNotMatch(html,/<script>/);
  assert.match(html,/&#60;script&#62;/);
});
