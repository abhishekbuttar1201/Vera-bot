'use strict';
/* Drives the real server through: warmup -> context push -> tick -> reply
 * (including auto-reply-loop and intent-transition scenarios), using data
 * shaped exactly like the brief's own Dr. Meera / Priya examples.
 * Run with: npm test */

const http = require('http');

let PORT;
function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const r = http.request(
      { hostname: 'localhost', port: PORT, path, method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} },
      (res) => {
        let chunks = '';
        res.on('data', (c) => (chunks += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: chunks ? JSON.parse(chunks) : null });
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? '  ok ' : 'FAIL'}  - ${label}`);
  if (!cond) failures++;
}

async function main() {
  process.env.PORT = 0;
  const server = require('./server');
  await new Promise((resolve) => server.on('listening', resolve));
  PORT = server.address().port;
  console.log(`test server on :${PORT}\n--- Phase 1: warmup ---`);

  let r = await req('GET', '/v1/healthz');
  check('healthz 200 before any context', r.status === 200);

  r = await req('GET', '/v1/metadata');
  check('metadata has all required fields', ['team_name', 'team_members', 'model', 'approach', 'contact_email', 'version', 'submitted_at'].every((k) => k in r.body));

  const category = {
    slug: 'dentists',
    offer_catalog: [{ title: 'Dental Cleaning @ \u20b9299', value: '299', audience: 'new_user' }],
    voice: { tone: 'peer_clinical', vocab_allowed: ['fluoride varnish', 'caries'], taboos: ['cure', 'guaranteed'] },
    peer_stats: { avg_rating: 4.4, avg_reviews: 62, avg_ctr: 0.03, scope: 'delhi_solo_practices' },
    digest: [{ id: 'd_2026W17_jida_fluoride', kind: 'research', title: '3-mo fluoride recall cuts caries 38% better than 6-mo', source: 'JIDA Oct 2026, p.14', trial_n: 2100, patient_segment: 'high_risk_adults', summary: '...' }],
    seasonal_beats: [{ month_range: 'Nov-Feb', note: 'exam-stress bruxism spike' }],
    trend_signals: [{ query: 'clear aligners delhi', delta_yoy: 0.62, segment_age: '28-45' }],
  };

  const merchant = {
    merchant_id: 'm_001_drmeera',
    category_slug: 'dentists',
    identity: { name: "Dr. Meera's Dental Clinic", city: 'Delhi', locality: 'Lajpat Nagar', verified: true, languages: ['en', 'hi'] },
    subscription: { status: 'active', plan: 'Pro', days_remaining: 82 },
    performance: { window_days: 30, views: 2410, calls: 18, directions: 45, ctr: 0.021, delta_7d: { views_pct: 0.18, calls_pct: -0.05 } },
    offers: [{ id: 'o_meera_001', title: 'Dental Cleaning @ \u20b9299', status: 'active' }],
    conversation_history: [],
    customer_aggregate: { total_unique_ytd: 540, lapsed_180d_plus: 78, retention_6mo_pct: 0.38 },
    signals: ['stale_posts:22d', 'ctr_below_peer_median', 'high_risk_adult_cohort'],
  };

  const customer = {
    customer_id: 'c_001_priya',
    merchant_id: 'm_001_drmeera',
    identity: { name: 'Priya', language_pref: 'hi-en mix' },
    relationship: { first_visit: '2025-11-04', last_visit: '2025-11-12', visits_total: 4, services_received: ['cleaning', 'cleaning', 'whitening', 'cleaning'] },
    state: 'lapsed_soft',
    preferences: { preferred_slots: 'weekday_evening', channel: 'whatsapp' },
    consent: { opted_in_at: '2025-11-04', scope: ['recall_reminders', 'appointment_reminders'] },
  };

  const triggerResearch = {
    id: 'trg_research', scope: 'merchant', kind: 'research_digest', source: 'external',
    merchant_id: 'm_001_drmeera', customer_id: null,
    payload: { category: 'dentists', top_item_id: 'd_2026W17_jida_fluoride' },
    urgency: 2, suppression_key: 'research:dentists:2026-W17', expires_at: '2026-05-03T00:00:00Z',
  };

  const triggerRecall = {
    id: 'trg_recall', scope: 'customer', kind: 'recall_due', source: 'internal',
    merchant_id: 'm_001_drmeera', customer_id: 'c_001_priya',
    payload: { available_slots: ['Wed 6pm', 'Thu 5pm'] },
    urgency: 3, suppression_key: 'recall:c_001_priya', expires_at: '2026-06-01T00:00:00Z',
  };

  console.log('\n--- push base contexts ---');
  r = await req('POST', '/v1/context', { scope: 'category', context_id: 'dentists', version: 1, payload: category, delivered_at: new Date().toISOString() });
  check('category context accepted', r.body.accepted === true);

  r = await req('POST', '/v1/context', { scope: 'merchant', context_id: 'm_001_drmeera', version: 1, payload: merchant, delivered_at: new Date().toISOString() });
  check('merchant context accepted', r.body.accepted === true);

  const stale = await req('POST', '/v1/context', { scope: 'merchant', context_id: 'm_001_drmeera', version: 1, payload: merchant, delivered_at: new Date().toISOString() });
  check('re-posting same version returns 409 stale_version', stale.status === 409 && stale.body.reason === 'stale_version');

  r = await req('POST', '/v1/context', { scope: 'customer', context_id: 'c_001_priya', version: 1, payload: customer, delivered_at: new Date().toISOString() });
  check('customer context accepted', r.body.accepted === true);

  r = await req('POST', '/v1/context', { scope: 'trigger', context_id: 'trg_research', version: 1, payload: triggerResearch, delivered_at: new Date().toISOString() });
  check('trigger (research) context accepted', r.body.accepted === true);

  r = await req('POST', '/v1/context', { scope: 'trigger', context_id: 'trg_recall', version: 1, payload: triggerRecall, delivered_at: new Date().toISOString() });
  check('trigger (recall) context accepted', r.body.accepted === true);

  const bad = await req('POST', '/v1/context', { scope: 'nonsense', context_id: 'x', version: 1, payload: {} });
  check('invalid scope returns 400', bad.status === 400 && bad.body.reason === 'invalid_scope');

  const health2 = await req('GET', '/v1/healthz');
  check('contexts_loaded reflects all 5 pushes', health2.body.contexts_loaded.category === 1 && health2.body.contexts_loaded.merchant === 1 && health2.body.contexts_loaded.customer === 1 && health2.body.contexts_loaded.trigger === 2);

  console.log('\n--- Phase 2: tick ---');
  const tick1 = await req('POST', '/v1/tick', { now: new Date().toISOString(), available_triggers: ['trg_research', 'trg_recall'] });
  check('tick returns 2 actions', tick1.body.actions.length === 2);

  const researchAction = tick1.body.actions.find((a) => a.trigger_id === 'trg_research');
  check('research action has all required fields', researchAction && ['conversation_id', 'merchant_id', 'send_as', 'template_name', 'template_params', 'body', 'cta', 'suppression_key', 'rationale'].every((k) => k in researchAction));
  check('research body cites the real trial_n (2100)', researchAction.body.includes('2100'));
  check('research body cites the real source (JIDA)', researchAction.body.includes('JIDA'));
  check('research send_as is "vera" (merchant-facing)', researchAction.send_as === 'vera');

  const recallAction = tick1.body.actions.find((a) => a.trigger_id === 'trg_recall');
  check('recall action targets the customer', recallAction && recallAction.customer_id === 'c_001_priya');
  check('recall send_as is "merchant_on_behalf"', recallAction.send_as === 'merchant_on_behalf');
  check('recall body names the customer (Priya)', recallAction.body.includes('Priya'));
  check('recall body cites the real offer price (\u20b9299)', recallAction.body.includes('299'));
  check('recall body cites the real slots', recallAction.body.includes('Wed 6pm'));

  const tick2 = await req('POST', '/v1/tick', { now: new Date().toISOString(), available_triggers: ['trg_research', 'trg_recall'] });
  check('same triggers are not re-actioned on a second tick (restraint)', tick2.body.actions.length === 0);

  console.log('\n--- consent gate ---');
  const noConsentCustomer = { ...customer, customer_id: 'c_002_noconsent', consent: { opted_in_at: null, scope: [] } };
  await req('POST', '/v1/context', { scope: 'customer', context_id: 'c_002_noconsent', version: 1, payload: noConsentCustomer, delivered_at: new Date().toISOString() });
  const triggerNoConsent = { ...triggerRecall, id: 'trg_recall_noconsent', customer_id: 'c_002_noconsent', suppression_key: 'recall:c_002' };
  await req('POST', '/v1/context', { scope: 'trigger', context_id: 'trg_recall_noconsent', version: 1, payload: triggerNoConsent, delivered_at: new Date().toISOString() });
  const tick3 = await req('POST', '/v1/tick', { now: new Date().toISOString(), available_triggers: ['trg_recall_noconsent'] });
  check('customer with no consent scope produces no action (suppressed)', tick3.body.actions.length === 0);

  console.log('\n--- Phase 4-style replay: auto-reply loop ---');
  const convId = researchAction.conversation_id;
  const canned = 'Thank you for contacting us. Our team will revert shortly.';
  let last;
  for (let i = 0; i < 4; i++) {
    last = await req('POST', '/v1/reply', { conversation_id: convId, merchant_id: 'm_001_drmeera', customer_id: null, from_role: 'merchant', message: canned, received_at: new Date().toISOString(), turn_number: i + 1 });
  }
  check('bot exits after repeated canned auto-reply', last.body.action === 'end');

  console.log('\n--- Phase 4-style replay: intent transition ---');
  const convId2 = recallAction.conversation_id;
  const affirm = await req('POST', '/v1/reply', { conversation_id: convId2, merchant_id: 'm_001_drmeera', customer_id: 'c_001_priya', from_role: 'customer', message: 'yes ok lets do it', received_at: new Date().toISOString(), turn_number: 1 });
  check('affirmative reply moves straight to action (no re-qualifying question)', affirm.body.action === 'send' && !affirm.body.body.includes('?'));

  console.log('\n--- Phase 4-style replay: hostile / off-topic ---');
  const convId3 = 'conv_test_hostile';
  await req('POST', '/v1/tick', {}); // no-op, just to ensure server stable
  const hostile = await req('POST', '/v1/reply', { conversation_id: convId3, merchant_id: 'm_001_drmeera', customer_id: null, from_role: 'merchant', message: 'this is useless bakwas', received_at: new Date().toISOString(), turn_number: 1 });
  check('hostile reply gets a de-escalating single-line response, not a crash', hostile.status === 200 && hostile.body.action === 'send');

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
  server.close(() => process.exit(failures === 0 ? 0 : 1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
