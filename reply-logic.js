'use strict';

const CANNED_PATTERNS = /(thank you for contacting|automated (assistant|reply)|will get back to you|team tak pahuncha|shukriya.*team|we will revert)/i;
const AFFIRMATIVE = /\b(yes|y|ok|okay|sure|go ahead|let'?s do it|approve|send it|do it|haan|theek hai|thik hai)\b/i;
const NEGATIVE = /\b(no|not interested|stop|don'?t|do not|cancel|nahi chahiye|band karo|not now)\b/i;
const WAIT_LIKE = /\b(later|busy|call (me )?back|abhi nahi|thodi der|remind me)\b/i;
const HOSTILE = /\b(fuck|f\*ck|idiot|useless|shut up|bakwas|bewakoof|nonsense)\b/i;
const OFF_TOPIC = /\b(gst|income tax|itr|loan|insurance|file my taxes)\b/i;

function classify(text) {
  const t = String(text || '');
  return {
    cannedLike: CANNED_PATTERNS.test(t),
    affirmative: AFFIRMATIVE.test(t),
    negative: NEGATIVE.test(t),
    waitLike: WAIT_LIKE.test(t),
    hostile: HOSTILE.test(t),
    offTopic: OFF_TOPIC.test(t),
  };
}

/**
 * decideReplyAction(conversation, text, repeatCount) -> the /v1/reply response body
 * repeatCount: how many times in a row the exact same reply text has arrived
 * (3+ in a row = treat as WhatsApp Business auto-reply, per the brief's own hint).
 */
function decideReplyAction(text, repeatCount) {
  const c = classify(text);

  if (repeatCount >= 2 || (c.cannedLike && repeatCount >= 1)) {
    return {
      action: 'end',
      rationale: 'Detected repeated/canned auto-reply text — exiting gracefully instead of burning further turns.',
    };
  }

  if (c.hostile) {
    return {
      action: 'send',
      body: "No worries — happy to help whenever you're ready. I'll leave this here for now.",
      cta: 'none',
      rationale: 'Reply read as hostile/abusive; de-escalating with one polite line and staying on-mission rather than engaging further.',
    };
  }

  if (c.offTopic) {
    return {
      action: 'end',
      rationale: 'Reply is off-topic for what this bot handles (e.g. tax/loan/insurance questions); politely declining scope rather than improvising.',
    };
  }

  if (c.affirmative) {
    return {
      action: 'send',
      body: 'Great — sending it now.',
      cta: 'none',
      rationale: 'Merchant/customer gave explicit affirmative intent; moving straight to action instead of re-qualifying.',
    };
  }

  if (c.negative) {
    return {
      action: 'end',
      rationale: 'Explicit decline received; exiting the conversation gracefully rather than pushing further.',
    };
  }

  if (c.waitLike) {
    return {
      action: 'wait',
      wait_seconds: 1800,
      rationale: 'Recipient asked for time; backing off 30 minutes before any further contact.',
    };
  }

  return {
    action: 'send',
    body: 'Just to confirm — should I go ahead, yes or no?',
    cta: 'binary_yes_stop',
    rationale: 'Reply intent was unclear; asking one single binary question rather than re-explaining or adding a second CTA.',
  };
}

module.exports = { classify, decideReplyAction };
