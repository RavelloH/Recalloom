import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validLink,validImage} from '../web/src/tiptap/editor-actions';

test('Tiptap link dialog permits web/mail/phone/internal references only',()=>{
 for(const url of ['https://example.com/a?b=1','http://example.com','#topic','/library/doc','mailto:demo@example.com','tel:+123456789'])
  assert.equal(validLink(url),true,url);
 for(const url of ['','javascript:alert(1)','data:text/html,abc','file:///etc/passwd','//evil.test/p','https://exa mple.com','https://','https://example.com\nother'])
  assert.equal(validLink(url),false,url);
});
test('Tiptap image dialog rejects executable and inline data URLs',()=>{
 for(const url of ['https://example.com/picture.png','http://example.com/test.webp','/assets/p.png'])
  assert.equal(validImage(url),true,url);
 for(const url of ['','data:image/png;base64,AA','javascript:alert(1)','file:///a.png','//example.com/a.png','https://a b/a.png','ftp://example.com/a'])
  assert.equal(validImage(url),false,url);
});
