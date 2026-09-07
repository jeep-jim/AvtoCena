import test from 'node:test';
import assert from 'node:assert/strict';
import { publicResponseChallenge } from '../scripts/lib/public-response-challenge.mjs';
test('contact form captcha scripts do not mark an ordinary listing as blocked', () => {
  assert.equal(publicResponseChallenge('<title>Cars for sale</title><script src="https://www.google.com/recaptcha/api.js"></script><script>grecaptcha.execute("public-key")</script><main>Cars</main>'), false);
});
test('visible access challenges still stop the pilot', () => {
  assert.equal(publicResponseChallenge('<title>Security check</title>'), true);
  assert.equal(publicResponseChallenge('<title>Pardon Our Interruption</title><main>Enable JavaScript to continue</main>'), true);
  assert.equal(publicResponseChallenge('<main>Please verify you are human</main>'), true);
  assert.equal(publicResponseChallenge('<title>安全验证</title>'), true);
  assert.equal(publicResponseChallenge('<meta http-equiv="refresh" content="0; url=/has_been_cr_blocked_AWS.html">'), true);
  assert.equal(publicResponseChallenge('<iframe src="/_Incapsula_Resource?incident=example"></iframe>'), true);
});


test('script-only HTTP 200 browser challenge is detected without executing it', () => {
  assert.equal(publicResponseChallenge('<html><script>window.solveChallenge("fixture");document.cookie="EO-Bot-Js-Token=fixture"</script></html>'), true);
  assert.equal(publicResponseChallenge('<script>window.solveChallenge = function() {};</script><main>Vehicle listing</main>'), false);
});
