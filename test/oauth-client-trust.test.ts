import test from 'node:test';
import assert from 'node:assert/strict';
import {consentForm} from '../src/auth-page.js';

test('OAuth consent distinguishes verified publisher domain and unverified display names',()=>{
  const request=new Request('https://recalloom.example/authorize?state=approved');
  const unverified=consentForm(request,'<Fake Client>','127.0.0.1','nonce',['notes:read']);
  assert.match(unverified,/尚无已验证的域名/);
  assert.doesNotMatch(unverified,/<Fake Client>/);
  const verified=consentForm(request,'Trusted','localhost','nonce',['notes:read'],'','publisher.example',true);
  assert.match(verified,/客户端域名：<strong>publisher\.example<\/strong>/);
  assert.match(verified,/本机接收 OAuth 令牌/);
  assert.doesNotMatch(verified,/尚无已验证的域名/);
});
