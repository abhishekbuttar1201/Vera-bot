'use strict';

/**
 * Fallback voice profiles, used only if a pushed CategoryContext payload
 * doesn't include its own `voice` block. The real per-category `payload`
 * pushed via POST /v1/context (scope="category") always wins when present
 * — this is just a safety net so the bot never goes generic-promotional.
 */
const CATEGORY_VOICE_FALLBACK = {
  dentists: { tone: 'peer_clinical', taboos: ['cure', 'guaranteed', 'best in the world'] },
  salons: { tone: 'trend_aesthetic', taboos: ['medical claims', 'guaranteed results'] },
  restaurants: { tone: 'operator_casual', taboos: ['medical claims', 'stale dated offers'] },
  gyms: { tone: 'coach_motivational', taboos: ['cure obesity', 'guaranteed results', 'medical claims'] },
  pharmacies: { tone: 'peer_clinical', taboos: ['diagnose', 'prescribe', 'guaranteed cure'] },
};

/**
 * Registry of canonical trigger kinds from challenge-brief.md §4.3.
 * `defaultCta` follows constraint #3 in the brief: binary YES/STOP for
 * action triggers, open_ended for things worth a reply but no hard ask,
 * none for pure-information / no-action-needed triggers.
 * `customerCapable` marks kinds that can legitimately target a specific
 * customer (scope: "customer") rather than just the merchant.
 */
const TRIGGER_KINDS = {
  // --- external ---
  festival_upcoming: { defaultCta: 'binary_yes_stop', customerCapable: false },
  weather_heatwave: { defaultCta: 'open_ended', customerCapable: false },
  local_news_event: { defaultCta: 'open_ended', customerCapable: false },
  research_digest: { defaultCta: 'open_ended', customerCapable: false },
  category_research_digest_release: { defaultCta: 'open_ended', customerCapable: false },
  regulation_change: { defaultCta: 'none', customerCapable: false },
  competitor_opened: { defaultCta: 'open_ended', customerCapable: false },
  category_trend_movement: { defaultCta: 'open_ended', customerCapable: false },

  // --- internal ---
  perf_spike: { defaultCta: 'binary_yes_stop', customerCapable: false },
  perf_dip: { defaultCta: 'binary_yes_stop', customerCapable: false },
  milestone_reached: { defaultCta: 'none', customerCapable: false },
  dormant_with_vera: { defaultCta: 'open_ended', customerCapable: false },
  customer_lapsed_soft: { defaultCta: 'binary_yes_stop', customerCapable: true },
  recall_due: { defaultCta: 'binary_yes_stop', customerCapable: true }, // brief Appendix B uses this name
  appointment_tomorrow: { defaultCta: 'none', customerCapable: true },
  review_theme_emerged: { defaultCta: 'binary_yes_stop', customerCapable: false },
  scheduled_recurring: { defaultCta: 'open_ended', customerCapable: false },
};

function triggerMeta(kind) {
  return TRIGGER_KINDS[kind] || { defaultCta: 'open_ended', customerCapable: false };
}

module.exports = { CATEGORY_VOICE_FALLBACK, TRIGGER_KINDS, triggerMeta };
