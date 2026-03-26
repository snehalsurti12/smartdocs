/**
 * Role permission matrix and middleware helpers.
 */

const ROLE_HIERARCHY = { AUTHOR: 1, REVIEWER: 2, PUBLISHER: 3, ADMIN: 4 };

const PERMISSIONS = {
  "template:create":   ["AUTHOR", "REVIEWER", "PUBLISHER", "ADMIN"],
  "template:edit":     ["AUTHOR", "REVIEWER", "PUBLISHER", "ADMIN"],
  "template:delete":   ["ADMIN"],
  "template:submit":   ["AUTHOR", "REVIEWER", "PUBLISHER", "ADMIN"],
  "template:approve":  ["REVIEWER", "PUBLISHER", "ADMIN"],
  "template:publish":  ["PUBLISHER", "ADMIN"],
  "template:archive":  ["PUBLISHER", "ADMIN"],
  "user:manage":       ["ADMIN"],
  "project:manage":    ["ADMIN"],
  "chain:manage":      ["ADMIN"],
};

/**
 * Check if a role can perform an action.
 */
function canPerform(role, action) {
  const allowed = PERMISSIONS[action];
  if (!allowed) return false;
  return allowed.includes(role);
}

/**
 * Check if roleA has at least the same level as roleB.
 */
function hasMinRole(userRole, minRole) {
  return (ROLE_HIERARCHY[userRole] || 0) >= (ROLE_HIERARCHY[minRole] || 0);
}

/**
 * Require a specific permission — returns 403 error object if denied.
 */
function requirePermission(user, action) {
  if (!user) return { denied: true, status: 401, error: "Authentication required." };
  if (!canPerform(user.role, action)) {
    return { denied: true, status: 403, error: `Insufficient permissions. Required: ${action}` };
  }
  return { denied: false };
}

module.exports = {
  ROLE_HIERARCHY,
  PERMISSIONS,
  canPerform,
  hasMinRole,
  requirePermission,
};
