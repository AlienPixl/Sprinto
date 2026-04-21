import net from "node:net";

function escapeLdapFilter(value) {
  return String(value || "")
    .replace(/\\/g, "\\5c")
    .replace(/\*/g, "\\2a")
    .replace(/\(/g, "\\28")
    .replace(/\)/g, "\\29")
    .replace(/\0/g, "\\00");
}

function normalizeMemberOf(memberOf) {
  if (Array.isArray(memberOf)) {
    return memberOf.map((value) => String(value));
  }
  if (!memberOf) {
    return [];
  }
  return [String(memberOf)];
}

function deriveGroupIdentifiers(groupDn) {
  const normalized = String(groupDn || "").trim();
  if (!normalized) {
    return [];
  }
  const identifiers = [normalized];
  const cnMatch = normalized.match(/CN=([^,]+)/i);
  if (cnMatch?.[1]) {
    identifiers.push(cnMatch[1]);
  }
  return identifiers;
}

function normalizeExternalId(rawValue) {
  if (Buffer.isBuffer(rawValue)) {
    return rawValue.toString("hex");
  }
  return String(rawValue || "").trim();
}

function toBuffer(rawValue) {
  if (!rawValue) {
    return null;
  }
  if (Buffer.isBuffer(rawValue)) {
    return rawValue;
  }
  if (rawValue instanceof Uint8Array) {
    return Buffer.from(rawValue);
  }
  if (Array.isArray(rawValue) && rawValue.length > 0) {
    return toBuffer(rawValue[0]);
  }
  if (typeof rawValue === "string") {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      return null;
    }
    try {
      return Buffer.from(trimmed, "base64");
    } catch {
      return Buffer.from(trimmed, "binary");
    }
  }
  return null;
}

function inferAvatarMimeType(buffer) {
  if (!buffer || buffer.length < 4) {
    return "image/jpeg";
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    return "image/jpeg";
  }
  if (
    buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    buffer[0] === 0x47
    && buffer[1] === 0x49
    && buffer[2] === 0x46
    && buffer[3] === 0x38
  ) {
    return "image/gif";
  }
  if (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString("ascii") === "RIFF"
    && buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return "image/jpeg";
}

function normalizeAvatarDataUrl(rawValue) {
  const buffer = toBuffer(rawValue);
  if (!buffer || buffer.length === 0) {
    return "";
  }
  return `data:${inferAvatarMimeType(buffer)};base64,${buffer.toString("base64")}`;
}

function getAvatarAttribute(settings) {
  return String(settings?.adAvatarAttribute || "thumbnailPhoto").trim() || "thumbnailPhoto";
}

function buildIdentifierFilter(identifier, method, settings) {
  const escapedIdentifier = escapeLdapFilter(identifier);
  const loginAttribute = settings.adLoginAttribute || "sAMAccountName";
  const emailAttribute = settings.adEmailAttribute || "mail";

  if (method === "email") {
    return `(${emailAttribute}=${escapedIdentifier})`;
  }

  if (method === "both" && loginAttribute !== emailAttribute) {
    return `(|(${loginAttribute}=${escapedIdentifier})(${emailAttribute}=${escapedIdentifier}))`;
  }

  return `(${loginAttribute}=${escapedIdentifier})`;
}

function validateDirectorySettings(settings) {
  const requiredFields = [
    ["adServerUrl", "Server / URL"],
    ["adBaseDn", "Base DN"],
    ["adBindUsername", "Bind username (UPN)"],
    ["adBindPassword", "Bind password"],
    ["adLoginAttribute", "Login attribute"],
    ["adEmailAttribute", "Email attribute"],
    ["adDisplayNameAttribute", "Display name attribute"],
    ["adExternalIdAttribute", "External ID attribute"],
  ];

  const missing = requiredFields.find(([field]) => !String(settings?.[field] || "").trim());
  if (missing) {
    throw new Error(`Active Directory is not fully configured. Missing ${missing[1]}.`);
  }
}

function getConnectionSecurity(settings) {
  const normalized = String(settings?.adConnectionSecurity || "ldap").trim().toLowerCase();
  if (normalized === "ldaps" || normalized === "starttls") {
    return normalized;
  }
  return "ldap";
}

function buildTlsOptions(settings) {
  const certificate = String(settings?.adCaCertificate || "").trim();
  const rejectUnauthorized = !Boolean(settings?.adAllowUntrustedCertificate);
  const tlsOptions = { rejectUnauthorized };

  if (certificate) {
    tlsOptions.ca = [certificate];
  }

  return tlsOptions;
}

function buildDirectoryUrl(settings) {
  const rawServer = String(settings?.adServerUrl || "").trim();
  const transport = getConnectionSecurity(settings);
  const rawPort = Number(settings?.adServerPort || (transport === "ldaps" ? 636 : 389));
  const normalizedHost = rawServer.replace(/^[a-z]+:\/\//i, "");
  const protocol = transport === "ldaps" ? "ldaps" : "ldap";
  const normalizedServer = `${protocol}://${normalizedHost}`;
  const url = new URL(normalizedServer);

  if (Number.isFinite(rawPort) && rawPort > 0) {
    url.port = String(rawPort);
  }

  return url.toString();
}

async function testDirectorySocket(settings) {
  const url = new URL(buildDirectoryUrl(settings));
  const transport = getConnectionSecurity(settings);
  const port = Number(url.port || (transport === "ldaps" ? 636 : 389));

  return new Promise((resolve, reject) => {
    const socket = net.connect({
      host: url.hostname,
      port,
      timeout: 5000,
    });

    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
    };

    socket.once("connect", () => {
      cleanup();
      resolve();
    });
    socket.once("timeout", () => {
      cleanup();
      reject(new Error("Unable to reach the configured Active Directory server and port."));
    });
    socket.once("error", () => {
      cleanup();
      reject(new Error("Unable to reach the configured Active Directory server and port."));
    });
  });
}

async function createDirectoryClient(settings) {
  const { Client } = await import("ldapts");
  const transport = getConnectionSecurity(settings);
  const tlsOptions = buildTlsOptions(settings);
  const client = new Client({
    url: buildDirectoryUrl(settings),
    timeout: 5000,
    connectTimeout: 5000,
    ...(transport === "ldaps" ? { tlsOptions } : {}),
  });

  if (transport === "starttls") {
    await client.startTLS(tlsOptions);
  }

  return client;
}

export async function listActiveDirectoryUsers(settings) {
  validateDirectorySettings(settings);
  const client = await createDirectoryClient(settings);
  const avatarAttribute = getAvatarAttribute(settings);

  try {
    await client.bind(settings.adBindUsername, settings.adBindPassword);
    const search = await client.search(settings.adBaseDn, {
      scope: "sub",
      filter: "(&(objectClass=user)(!(objectClass=computer)))",
      attributes: [
        "dn",
        settings.adLoginAttribute,
        settings.adEmailAttribute,
        settings.adDisplayNameAttribute,
        settings.adExternalIdAttribute,
        avatarAttribute,
        "memberOf",
      ],
      paged: true,
    });

    return (search.searchEntries || [])
      .map((entry) => {
        const groupDns = normalizeMemberOf(entry.memberOf);
        const groupIdentifiers = [...new Set(groupDns.flatMap(deriveGroupIdentifiers).map((value) => value.toLowerCase()))];
        const externalId = normalizeExternalId(entry[settings.adExternalIdAttribute]);
        const username = String(entry[settings.adLoginAttribute] || "").trim();
        const displayName = String(entry[settings.adDisplayNameAttribute] || entry[settings.adLoginAttribute] || "").trim();
        const email = String(entry[settings.adEmailAttribute] || "").trim();
        const avatarDataUrl = normalizeAvatarDataUrl(entry[avatarAttribute]);

        return {
          distinguishedName: String(entry.dn || "").trim(),
          externalId,
          username,
          displayName,
          email,
          avatarDataUrl,
          groupIdentifiers,
        };
      })
      .filter((entry) => entry.externalId && entry.username);
  } finally {
    await client.unbind().catch(() => {});
  }
}

export async function authenticateAgainstActiveDirectory(identifier, password, method, settings) {
  validateDirectorySettings(settings);
  if (!String(password || "")) {
    return null;
  }

  const client = await createDirectoryClient(settings);
  const avatarAttribute = getAvatarAttribute(settings);

  try {
    let entry = null;
    try {
      await client.bind(settings.adBindUsername, settings.adBindPassword);

      const search = await client.search(settings.adBaseDn, {
        scope: "sub",
        filter: `(&(objectClass=user)${buildIdentifierFilter(identifier, method, settings)})`,
        attributes: [
          "dn",
          settings.adLoginAttribute,
          settings.adEmailAttribute,
          settings.adDisplayNameAttribute,
          settings.adExternalIdAttribute,
          avatarAttribute,
          "memberOf",
        ],
        sizeLimit: 2,
      });

      if ((search.searchEntries?.length || 0) > 1) {
        throw new Error("Active Directory lookup returned multiple users for this login.");
      }

      entry = search.searchEntries?.[0];
      if (!entry || !entry.dn) {
        return null;
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Active Directory lookup returned multiple users")) {
        throw error;
      }
      throw new Error("Unable to connect to Active Directory with the configured server or service account.");
    }

    try {
      await client.bind(entry.dn, password);
    } catch {
      return null;
    }

    const groupDns = normalizeMemberOf(entry.memberOf);
    const groupIdentifiers = [...new Set(groupDns.flatMap(deriveGroupIdentifiers).map((value) => value.toLowerCase()))];
    const externalId = normalizeExternalId(entry[settings.adExternalIdAttribute]);

    return {
      externalId,
      username: String(entry[settings.adLoginAttribute] || "").trim(),
      displayName: String(entry[settings.adDisplayNameAttribute] || entry[settings.adLoginAttribute] || "").trim(),
      email: String(entry[settings.adEmailAttribute] || "").trim(),
      avatarDataUrl: normalizeAvatarDataUrl(entry[avatarAttribute]),
      groupIdentifiers,
    };
  } finally {
    await client.unbind().catch(() => {});
  }
}

export async function testActiveDirectoryConnection(identifier, method, settings) {
  validateDirectorySettings(settings);
  const trimmedIdentifier = String(identifier || "").trim();
  const avatarAttribute = getAvatarAttribute(settings);

  try {
    await testDirectorySocket(settings);
  } catch (error) {
    return {
      ok: false,
      checks: [
        {
          key: "server-port",
          label: "Server and port",
          ok: false,
          message: error instanceof Error ? error.message : "Unable to reach the configured Active Directory server and port.",
        },
      ],
      user: null,
    };
  }

  const checks = [];
  checks.push({
    key: "server-port",
    label: "Server and port",
    ok: true,
    message: "The configured Active Directory server and port are reachable.",
  });

  let client = null;
  try {
    try {
      client = await createDirectoryClient(settings);
      await client.bind(settings.adBindUsername, settings.adBindPassword);
      checks.push({
        key: "service-bind",
        label: "Service account bind",
        ok: true,
        message: "The Active Directory server accepted the configured bind username and password.",
      });
    } catch {
      checks.push({
        key: "service-bind",
        label: "Service account bind",
        ok: false,
        message:
          getConnectionSecurity(settings) === "starttls"
            ? "Unable to establish a StartTLS connection or sign in with the configured service account."
            : "Unable to connect to Active Directory with the configured server or service account.",
      });
      return { ok: false, checks, user: null };
    }

    try {
      await client.search(settings.adBaseDn, {
        scope: "base",
        filter: "(objectClass=*)",
        attributes: ["dn"],
        sizeLimit: 1,
      });
      checks.push({
        key: "base-dn",
        label: "Base DN",
        ok: true,
        message: "The configured Base DN can be searched.",
      });
    } catch {
      checks.push({
        key: "base-dn",
        label: "Base DN",
        ok: false,
        message: "The configured Base DN could not be searched.",
      });
      return { ok: false, checks, user: null };
    }

    if (!trimmedIdentifier) {
      checks.push(
        {
          key: "login-attribute",
          label: "Login attribute",
          ok: false,
          message: "Enter a test user login or email to validate this attribute.",
        },
        {
          key: "email-attribute",
          label: "Email attribute",
          ok: false,
          message: "Enter a test user login or email to validate this attribute.",
        },
        {
          key: "external-id-attribute",
          label: "External ID attribute",
          ok: false,
          message: "Enter a test user login or email to validate this attribute.",
        },
        {
          key: "display-name-attribute",
          label: "Display name attribute",
          ok: false,
          message: "Enter a test user login or email to validate this attribute.",
        },
        {
          key: "avatar-attribute",
          label: "Avatar attribute",
          ok: false,
          message: "Enter a test user login or email to validate this attribute.",
        }
      );

      return { ok: false, checks, user: null };
    }

    let entry = null;
    try {
      const search = await client.search(settings.adBaseDn, {
        scope: "sub",
        filter: `(&(objectClass=user)${buildIdentifierFilter(trimmedIdentifier, method, settings)})`,
        attributes: [
          "dn",
          settings.adLoginAttribute,
          settings.adEmailAttribute,
          settings.adDisplayNameAttribute,
          settings.adExternalIdAttribute,
          avatarAttribute,
          "memberOf",
        ],
        sizeLimit: 2,
      });

      if ((search.searchEntries?.length || 0) > 1) {
        checks.push({
          key: "test-user",
          label: "Test user",
          ok: false,
          message: "The configured lookup returned multiple users for this identifier.",
        });
        return { ok: false, checks, user: null };
      }

      entry = search.searchEntries?.[0];
      if (!entry || !entry.dn) {
        checks.push({
          key: "test-user",
          label: "Test user",
          ok: false,
          message: "No user was found with the provided test login or email.",
        });
        return { ok: false, checks, user: null };
      }
    } catch {
      checks.push({
        key: "test-user",
        label: "Test user",
        ok: false,
        message: "The user lookup failed for the provided test login or email.",
      });
      return { ok: false, checks, user: null };
    }

    checks.push({
      key: "test-user",
      label: "Test user",
      ok: true,
      message: `User found: ${entry.dn}`,
    });

    const username = String(entry[settings.adLoginAttribute] || "").trim();
    const email = String(entry[settings.adEmailAttribute] || "").trim();
    const displayName = String(entry[settings.adDisplayNameAttribute] || "").trim();
    const externalId = normalizeExternalId(entry[settings.adExternalIdAttribute]);
    const avatarDataUrl = normalizeAvatarDataUrl(entry[avatarAttribute]);

    checks.push(
      {
        key: "login-attribute",
        label: "Login attribute",
        ok: Boolean(username),
        message: username || `No value returned for ${settings.adLoginAttribute}.`,
      },
      {
        key: "email-attribute",
        label: "Email attribute",
        ok: Boolean(email),
        message: email || `No value returned for ${settings.adEmailAttribute}.`,
      },
      {
        key: "display-name-attribute",
        label: "Display name attribute",
        ok: Boolean(displayName),
        message: displayName || `No value returned for ${settings.adDisplayNameAttribute}.`,
      },
      {
        key: "external-id-attribute",
        label: "External ID attribute",
        ok: Boolean(externalId),
        message: externalId || `No value returned for ${settings.adExternalIdAttribute}.`,
      },
      {
        key: "avatar-attribute",
        label: "Avatar attribute",
        ok: Boolean(avatarDataUrl),
        message: avatarDataUrl ? `Value returned for ${avatarAttribute}.` : `No value returned for ${avatarAttribute}.`,
      }
    );

    const groupIdentifiers = [
      ...new Set(
        normalizeMemberOf(entry.memberOf)
          .flatMap(deriveGroupIdentifiers)
          .map((value) => value.toLowerCase())
      ),
    ];

    return {
      ok: checks.every((check) => check.ok),
      checks,
      user: {
        distinguishedName: entry.dn,
        username,
        email,
        displayName,
        externalId,
        avatarConfigured: Boolean(avatarDataUrl),
        groupIdentifiers,
      },
    };
  } finally {
    await client?.unbind().catch(() => {});
  }
}
