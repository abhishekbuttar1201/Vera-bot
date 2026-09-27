'use strict';

class Store {
  constructor() {
    this.contexts = new Map(); // "scope:context_id" -> { version, payload }
    this.conversations = new Map(); // conversation_id -> { turns: [], sentBodies: Set, merchant_id, customer_id }
    this.actionedTriggers = new Set(); // trigger context_ids already turned into an action (anti-repeat across ticks)
  }

  key(scope, id) {
    return `${scope}:${id}`;
  }

  upsert(scope, contextId, version, payload) {
    const k = this.key(scope, contextId);
    const cur = this.contexts.get(k);
    if (cur && typeof version === 'number' && cur.version >= version) {
      return { accepted: false, reason: 'stale_version', current_version: cur.version };
    }
    this.contexts.set(k, { version: version ?? 0, payload });
    return { accepted: true };
  }

  get(scope, contextId) {
    const rec = this.contexts.get(this.key(scope, contextId));
    return rec ? rec.payload : null;
  }

  counts() {
    const out = { category: 0, merchant: 0, customer: 0, trigger: 0 };
    for (const k of this.contexts.keys()) {
      const scope = k.split(':')[0];
      if (out[scope] !== undefined) out[scope]++;
    }
    return out;
  }

  allOfScope(scope) {
    const out = [];
    for (const [k, v] of this.contexts.entries()) {
      if (k.startsWith(`${scope}:`)) out.push({ context_id: k.slice(scope.length + 1), ...v });
    }
    return out;
  }

  wasActioned(triggerId) {
    return this.actionedTriggers.has(triggerId);
  }
  markActioned(triggerId) {
    this.actionedTriggers.add(triggerId);
  }

  newConversation(conversationId, merchantId, customerId) {
    this.conversations.set(conversationId, {
      turns: [],
      sentBodies: new Set(),
      merchant_id: merchantId,
      customer_id: customerId,
      lastReplyText: null,
      repeatCount: 0,
    });
  }

  getConversation(conversationId) {
    return this.conversations.get(conversationId) || null;
  }

  recordSentBody(conversationId, body) {
    const c = this.conversations.get(conversationId);
    if (c && body) c.sentBodies.add(body);
  }

  wasBodyAlreadySent(conversationId, body) {
    const c = this.conversations.get(conversationId);
    return !!(c && c.sentBodies.has(body));
  }

  recordReply(conversationId, text) {
    const c = this.conversations.get(conversationId);
    if (!c) return { repeatCount: 0 };
    if (c.lastReplyText && c.lastReplyText === text) {
      c.repeatCount += 1;
    } else {
      c.repeatCount = 0;
      c.lastReplyText = text;
    }
    c.turns.push({ from: 'them', text });
    return { repeatCount: c.repeatCount };
  }

  recordOurTurn(conversationId, text) {
    const c = this.conversations.get(conversationId);
    if (c) c.turns.push({ from: 'bot', text });
  }
}

module.exports = new Store();
