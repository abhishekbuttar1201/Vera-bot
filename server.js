'use strict';

const http = require('http');
const crypto = require('crypto');
const { compose } = require('./composer');
const { decideReplyAction } = require('./reply-logic');
const store = require('./store');

const PORT = process.env.PORT || 3000;
const START = Date.now();
const VALID_SCOPES = new Set(['category', 'merchant', 'customer', 'trigger']);
const MAX_ACTIONS_PER_TICK = 20;
const MAX_CONTEXT_BYTES = 500 * 1024; // 500KB cap, per §5 of the testing brief

// ====> EDIT THESE BEFORE SUBMITTING <====
const TEAM_METADATA = {
  team_name: 'CHANGE_ME',
  team_members: ['CHANGE_ME'],
  model: 'none (deterministic, no LLM calls)',
  approach: 'Deterministic 4-context composer: pure compose(category, merchant, trigger, customer?) with per-trigger-kind templates, consent-gated customer outreach, anti-repetition, and auto-reply/hostile/intent-transition handling in /v1/reply.',
  contact_email: 'CHANGE_ME@example.com',
  version: '1.0.0',
  submitted_at: new Date().toISOString(),
};
// =========================================

function send(res, status, body) {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) });
  res.end(json);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let tooBig = false;
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > MAX_CONTEXT_BYTES + 1024) {
        tooBig = true;
        req.destroy();
      }
    });
    req.on('end', () => {
      if (tooBig) return reject(Object.assign(new Error('payload_too_large'), { code: 'payload_too_large' }));
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(Object.assign(new Error('invalid_json_body'), { code: 'invalid_json_body' }));
      }
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------
// GET /v1/healthz
// ---------------------------------------------------------------------
function handleHealthz(req, res) {
  send(res, 200, {
    status: 'ok',
    uptime_seconds: Math.round((Date.now() - START) / 1000),
    contexts_loaded: store.counts(),
  });
}

// ---------------------------------------------------------------------
// GET /v1/metadata
// ---------------------------------------------------------------------
function handleMetadata(req, res) {
  send(res, 200, TEAM_METADATA);
}

// ---------------------------------------------------------------------
// POST /v1/context
// ---------------------------------------------------------------------
async function handleContext(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return send(res, 400, { accepted: false, reason: e.code || 'invalid_json_body' });
  }
  const { scope, context_id, version, payload } = body;

  if (!scope || !VALID_SCOPES.has(scope)) {
    return send(res, 400, { accepted: false, reason: 'invalid_scope', details: `scope must be one of ${[...VALID_SCOPES].join(', ')}` });
  }
  if (!context_id || payload === undefined) {
    return send(res, 400, { accepted: false, reason: 'invalid_body', details: 'context_id and payload are required' });
  }

  const result = store.upsert(scope, context_id, version, payload);
  if (!result.accepted) {
    return send(res, 409, { accepted: false, reason: result.reason, current_version: result.current_version });
  }
  return send(res, 200, {
    accepted: true,
    ack_id: `ack_${context_id}_v${version}_${crypto.randomBytes(3).toString('hex')}`,
    stored_at: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------
// POST /v1/tick
// ---------------------------------------------------------------------
async function handleTick(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return send(res, 400, { accepted: false, reason: e.code || 'invalid_json_body' });
  }
  const availableTriggerIds = Array.isArray(body.available_triggers) ? body.available_triggers : [];

  const actions = [];

  for (const triggerId of availableTriggerIds) {
    if (actions.length >= MAX_ACTIONS_PER_TICK) break;
    if (store.wasActioned(triggerId)) continue; // restraint: don't resend the same trigger

    const trigger = store.get('trigger', triggerId);
    if (!trigger) continue;

    const merchant = store.get('merchant', trigger.merchant_id);
    if (!merchant) continue;

    const category = store.get('category', merchant.category_slug);
    const customer = trigger.customer_id ? store.get('customer', trigger.customer_id) : null;

    let result;
    try {
      result = compose(category, merchant, trigger, customer);
    } catch (e) {
      continue; // can't compose safely — skip rather than send something broken
    }

    store.markActioned(triggerId);

    if (!result.body) continue; // consent-suppressed or otherwise a deliberate no-send

    const conversationId = `conv_${trigger.merchant_id}_${triggerId}`;
    store.newConversation(conversationId, trigger.merchant_id, trigger.customer_id || null);
    store.recordSentBody(conversationId, result.body);
    store.recordOurTurn(conversationId, result.body);

    actions.push({
      conversation_id: conversationId,
      merchant_id: trigger.merchant_id,
      customer_id: trigger.customer_id || null,
      send_as: result.send_as,
      trigger_id: triggerId,
      template_name: result.template_name,
      template_params: result.template_params,
      body: result.body,
      cta: result.cta,
      suppression_key: result.suppression_key,
      rationale: result.rationale,
    });
  }

  return send(res, 200, { actions });
}

// ---------------------------------------------------------------------
// POST /v1/reply
// ---------------------------------------------------------------------
async function handleReply(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return send(res, 400, { accepted: false, reason: e.code || 'invalid_json_body' });
  }
  const { conversation_id, merchant_id, customer_id, message } = body;

  if (!conversation_id || message === undefined) {
    return send(res, 400, { accepted: false, reason: 'invalid_body', details: 'conversation_id and message are required' });
  }

  if (!store.getConversation(conversation_id)) {
    store.newConversation(conversation_id, merchant_id || null, customer_id || null);
  }

  const { repeatCount } = store.recordReply(conversation_id, message);
  const decision = decideReplyAction(message, repeatCount);

  if (decision.action === 'send') {
    // Anti-repetition guard: never resend a body verbatim in the same conversation.
    if (store.wasBodyAlreadySent(conversation_id, decision.body)) {
      const fallback = { action: 'end', rationale: 'Next step would repeat a message already sent in this conversation; exiting instead of repeating.' };
      store.recordOurTurn(conversation_id, '[ended: would repeat]');
      return send(res, 200, fallback);
    }
    store.recordSentBody(conversation_id, decision.body);
    store.recordOurTurn(conversation_id, decision.body);
    return send(res, 200, { action: 'send', body: decision.body, cta: decision.cta, rationale: decision.rationale });
  }

  if (decision.action === 'wait') {
    return send(res, 200, { action: 'wait', wait_seconds: decision.wait_seconds, rationale: decision.rationale });
  }

  // action === 'end'
  store.recordOurTurn(conversation_id, '[ended conversation]');
  return send(res, 200, { action: 'end', rationale: decision.rationale });
}

// ---------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------
const routes = {
  'GET /v1/healthz': handleHealthz,
  'GET /v1/metadata': handleMetadata,
  'POST /v1/context': handleContext,
  'POST /v1/tick': handleTick,
  'POST /v1/reply': handleReply,
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const handler = routes[`${req.method} ${url.pathname}`];
  if (!handler) return send(res, 404, { error: 'not_found', route: `${req.method} ${url.pathname}` });
  try {
    await handler(req, res);
  } catch (e) {
    send(res, 500, { error: 'internal_error', message: e.message });
  }
});

server.listen(PORT, () => console.log(`vera-composer listening on :${PORT}`));

module.exports = server;
