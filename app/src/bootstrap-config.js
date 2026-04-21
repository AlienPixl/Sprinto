const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

export function parseBooleanEnv(value, defaultValue = false) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return defaultValue;
  }

  const normalized = String(value).trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) {
    return true;
  }
  if (FALSE_VALUES.has(normalized)) {
    return false;
  }
  return defaultValue;
}

export function readBootstrapConfig(env = process.env) {
  return {
    seedDemoData: parseBooleanEnv(env.SPRINTO_SEED_DEMO_DATA, false),
    recoveryAdminEnabled: parseBooleanEnv(env.SPRINTO_RECOVERY_ADMIN_ENABLED, false),
    recoveryAdminUsername: String(env.SPRINTO_RECOVERY_ADMIN_USERNAME || "").trim(),
    recoveryAdminPassword: String(env.SPRINTO_RECOVERY_ADMIN_PASSWORD || ""),
    recoveryAdminDisplayName: String(env.SPRINTO_RECOVERY_ADMIN_DISPLAY_NAME || "").trim() || "System Recovery Admin",
  };
}

export function validateBootstrapConfig(config, { initialUserCount = 0 } = {}) {
  const errors = [];
  if (config.recoveryAdminEnabled) {
    if (!config.recoveryAdminUsername) {
      errors.push("Recovery admin is enabled but SPRINTO_RECOVERY_ADMIN_USERNAME is missing.");
    }
    if (!config.recoveryAdminPassword) {
      errors.push("Recovery admin is enabled but SPRINTO_RECOVERY_ADMIN_PASSWORD is missing.");
    }
    if (config.seedDemoData && ["admin", "master", "user"].includes(String(config.recoveryAdminUsername || "").trim().toLowerCase())) {
      errors.push("The recovery admin username cannot reuse a built-in demo username when demo seed data is enabled.");
    }
  }

  if (Number(initialUserCount || 0) === 0 && !config.seedDemoData && !config.recoveryAdminEnabled) {
    errors.push("Sprinto cannot start an empty installation without either demo seed data or a configured recovery admin.");
  }

  return errors;
}

export function shouldSeedDemoData(config, { initialUserCount = 0, demoSeeded = false } = {}) {
  return Boolean(config.seedDemoData) && Number(initialUserCount || 0) === 0 && !demoSeeded;
}

export function isSystemManagedAuthSource(authSource) {
  return String(authSource || "").trim().toLowerCase() === "system";
}
