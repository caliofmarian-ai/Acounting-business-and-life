import test from 'node:test';
import assert from 'node:assert/strict';
import {
  brandedSender,
  configuredReplyTo,
  emailTargetUrl,
  renderTransactionalEmail
} from '../email-presentation.js';

test('Caliof department sender keeps the verified mailbox and adds the product identity',()=>{
  assert.equal(
    brandedSender('security@caliof.com','security'),
    'Caliof · Business & Life Security <security@caliof.com>'
  );
  assert.equal(
    brandedSender('Existing Name <billing@caliof.com>','billing'),
    'Caliof · Business & Life Billing <billing@caliof.com>'
  );
});

test('Reply-To is opt-in and department scoped',()=>{
  assert.equal(configuredReplyTo({},'support'),'');
  assert.equal(
    configuredReplyTo({RESEND_REPLY_TO_SUPPORT:'support@caliof.com'},'support'),
    'support@caliof.com'
  );
  assert.equal(configuredReplyTo({RESEND_REPLY_TO_SUPPORT:'not-an-email'},'support'),'');
});

test('support email CTA deep-links to the exact ticket',()=>{
  assert.equal(
    emailTargetUrl({baseUrl:'https://caliof.com',entityType:'support_ticket',entityId:'184'}),
    'https://caliof.com/?support_ticket=184'
  );
});

test('transactional email presents Business & Life as a Caliof product',()=>{
  const out=renderTransactionalEmail({
    subject:'Payment confirmed',
    body:'Your payment was confirmed.',
    department:'billing',
    roleHint:'merchant',
    actionUrl:'https://caliof.com',
    actionLabel:'View payment'
  });
  assert.match(out.html,/CALIOF/);
  assert.match(out.html,/Business &amp; Life by Caliof/);
  assert.match(out.html,/Billing · Merchant/);
  assert.match(out.html,/View payment/);
  assert.match(out.text,/CALIOF — Business & Life/);
  assert.match(out.text,/Business & Life by Caliof/);
});

test('auth HTML links are preserved in the plain-text fallback',()=>{
  const out=renderTransactionalEmail({
    subject:'Verify your Business & Life email',
    bodyHtml:'<p>Verify your email.</p><p><a href="https://caliof.com/?verify_token=abc">Verify email</a></p>',
    department:'security'
  });
  assert.match(out.text,/Verify email \(https:\/\/caliof\.com\/\?verify_token=abc\)/);
});
