import test from 'node:test';
import assert from 'node:assert/strict';
import { consentForm, page } from '../src/auth-page.js';

test('OAuth consent CSP permits verified client redirect origin (including redirect after POST)', () => {
  const response=page('授权','<form method="post"></form>',200,'https://chatgpt.com');
  const csp=response.headers.get('content-security-policy')??'';
  assert.match(csp,/(?:^|;)\s*form-action 'self' https:\/\/chatgpt\.com(?:;|$)/);
  assert.doesNotMatch(csp,/form-action\s+self\b/);
  assert.match(csp,/frame-ancestors 'none'/);
  assert.equal(response.headers.get('cache-control'),'no-store');
});

test('OAuth consent only lists a normalized callback origin', () => {
  const response=page('授权','',200,'https://example.org/callback?x=1');
  const csp=response.headers.get('content-security-policy')??'';
  assert.match(csp,/form-action 'self' https:\/\/example\.org;/);
  assert.doesNotMatch(csp,/callback|x=1/);
});

test('OAuth failure page does not admit arbitrary external form destinations', () => {
  const response=page('授权错误','<p>错误</p>',400);
  const csp=response.headers.get('content-security-policy')??'';
  assert.match(csp,/(?:^|;)\s*form-action 'self'(?:;|$)/);
  assert.doesNotMatch(csp,/chatgpt\.com/);
});

test('OAuth consent form explicitly preserves original authorization query on POST', () => {
  const request=new Request('https://recalloom.example/authorize?response_type=code&client_id=test-client&scope=notes%3Aread%20notes%3Awrite');
  const html=consentForm(request,'ChatGPT','chatgpt.com','test-handle',['notes:read','notes:write']);
  assert.match(html,/<form method="post" action="\/authorize\?response_type=code&#38;client_id=test-client&#38;scope=notes%3Aread%20notes%3Awrite">/);
  assert.match(html,/name="handle" value="test-handle"/);
  assert.match(html,/name="scope" value="notes:read"/);
  assert.match(html,/name="scope" value="notes:write"/);
});

test('OAuth consent sanitizes client-supplied display fields on retry', () => {
  const request=new Request('https://recalloom.example/authorize?state=ok');
  const html=consentForm(request,'<script>alert(1)</script>','chatgpt.com','handle',['notes:read'],'Bad <secret>');
  assert.doesNotMatch(html,/<script>/);
  assert.match(html,/&#60;script&#62;/);
  assert.match(html,/Bad &#60;secret&#62;/);
  assert.match(html,/role="alert"/);
});

test('OAuth page escapes untrusted title', async () => {
  const response=page('<script>alert(1)</script>','OK');
  const html=await response.text();
  assert.doesNotMatch(html,/<script>/);
  assert.match(html,/&#60;script&#62;/);
});
