/**
 * Template approval workflow — status transition validation.
 *
 * States: DRAFT → REVIEW → APPROVED → PUBLISHED (+ ARCHIVED from any)
 */

const ALLOWED_TRANSITIONS = {
  DRAFT:     ["REVIEW", "ARCHIVED"],
  REVIEW:    ["APPROVED", "DRAFT", "ARCHIVED"],
  APPROVED:  ["PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["DRAFT", "ARCHIVED"],
  ARCHIVED:  ["DRAFT"],
};

/** Human-readable labels for transition buttons */
const TRANSITION_LABELS = {
  "DRAFT→REVIEW":      "Submit for Review",
  "REVIEW→APPROVED":   "Approve",
  "REVIEW→DRAFT":      "Reject",
  "APPROVED→PUBLISHED": "Publish",
  "PUBLISHED→DRAFT":   "New Revision",
  "ARCHIVED→DRAFT":    "Reactivate",
  // ARCHIVED transitions
  "DRAFT→ARCHIVED":    "Archive",
  "REVIEW→ARCHIVED":   "Archive",
  "APPROVED→ARCHIVED": "Archive",
  "PUBLISHED→ARCHIVED":"Archive",
};

/**
 * Validate whether a status transition is allowed.
 * @param {string} from - Current status
 * @param {string} to - Target status
 * @returns {{ valid: boolean, error?: string }}
 */
function validateTransition(from, to) {
  if (!ALLOWED_TRANSITIONS[from]) {
    return { valid: false, error: `Unknown status: ${from}` };
  }
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    const allowed = ALLOWED_TRANSITIONS[from].join(", ");
    return { valid: false, error: `Cannot transition from ${from} to ${to}. Allowed: ${allowed}` };
  }
  return { valid: true };
}

/**
 * Check if a transition requires a reason (e.g. rejection).
 */
function requiresReason(from, to) {
  return from === "REVIEW" && to === "DRAFT";
}

/**
 * Check if content editing is locked for a given status.
 */
function isContentLocked(status) {
  return status === "APPROVED" || status === "PUBLISHED";
}

/**
 * Get allowed transitions from a given status.
 * @returns {Array<{ to: string, label: string, requiresReason: boolean }>}
 */
function getAllowedTransitions(from) {
  const targets = ALLOWED_TRANSITIONS[from] || [];
  return targets.map((to) => ({
    to,
    label: TRANSITION_LABELS[`${from}→${to}`] || to,
    requiresReason: requiresReason(from, to),
  }));
}

module.exports = {
  ALLOWED_TRANSITIONS,
  TRANSITION_LABELS,
  validateTransition,
  requiresReason,
  isContentLocked,
  getAllowedTransitions,
};
