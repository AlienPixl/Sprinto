function resolveProviderFlags(settings = {}) {
  const hasLocalAuthEnabled = typeof settings.localAuthEnabled === "boolean";
  const hasActiveDirectoryEnabled = typeof settings.activeDirectoryEnabled === "boolean";
  const hasEntraAuthEnabled = typeof settings.entraAuthEnabled === "boolean";

  if (hasLocalAuthEnabled || hasActiveDirectoryEnabled || hasEntraAuthEnabled) {
    return {
      localAuthEnabled: hasLocalAuthEnabled ? Boolean(settings.localAuthEnabled) : true,
      activeDirectoryEnabled: hasActiveDirectoryEnabled ? Boolean(settings.activeDirectoryEnabled) : false,
      entraAuthEnabled: hasEntraAuthEnabled ? Boolean(settings.entraAuthEnabled) : false,
    };
  }

  const legacyMode = String(settings.ssoMode || "").trim();
  if (legacyMode === "Active Directory") {
    return {
      localAuthEnabled: false,
      activeDirectoryEnabled: true,
    };
  }

  if (legacyMode === "Active Directory + Local") {
    return {
      localAuthEnabled: true,
      activeDirectoryEnabled: true,
    };
  }

  return {
    localAuthEnabled: true,
    activeDirectoryEnabled: false,
    entraAuthEnabled: false,
  };
}

export function isActiveDirectoryEnabled(settings) {
  return resolveProviderFlags(settings).activeDirectoryEnabled;
}

export function isLocalAuthEnabled(settings) {
  return resolveProviderFlags(settings).localAuthEnabled;
}

export function isEntraAuthEnabled(settings) {
  return resolveProviderFlags(settings).entraAuthEnabled;
}

export function hasEnabledAuthProvider(settings) {
  const providerFlags = resolveProviderFlags(settings);
  return providerFlags.localAuthEnabled || providerFlags.activeDirectoryEnabled || providerFlags.entraAuthEnabled;
}

export function hasPasswordAuthProvider(settings) {
  const providerFlags = resolveProviderFlags(settings);
  return providerFlags.localAuthEnabled || providerFlags.activeDirectoryEnabled;
}

export async function resolveAuthenticatedUser({
  identifier,
  password,
  method,
  settings,
  authenticateRecoveryUser,
  authenticateDirectoryUser,
  authenticateLocalUser,
}) {
  const recoveryUser = await authenticateRecoveryUser(identifier, password, method);
  if (recoveryUser) {
    return recoveryUser;
  }

  const activeDirectoryEnabled = isActiveDirectoryEnabled(settings);
  const localAuthEnabled = isLocalAuthEnabled(settings);

  if (activeDirectoryEnabled) {
    try {
      const directoryUser = await authenticateDirectoryUser(identifier, password, method, settings);
      if (directoryUser) {
        return directoryUser;
      }
    } catch (error) {
      if (!localAuthEnabled) {
        throw error;
      }
    }
  }

  if (localAuthEnabled) {
    return authenticateLocalUser(identifier, password, method);
  }

  return null;
}
