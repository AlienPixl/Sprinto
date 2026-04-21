import crypto from "node:crypto";

const OPENID_CONFIG_TTL_MS = 1000 * 60 * 60;
const ENTRA_SCOPES = ["openid", "profile", "email", "User.Read", "GroupMember.Read.All"];
const openIdConfigCache = new Map();
const jwksCache = new Map();

function toBase64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function randomBase64Url(byteLength = 32) {
  return toBase64Url(crypto.randomBytes(byteLength));
}

function normalizePublicBaseUrl(baseUrl) {
  const normalized = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!normalized) {
    throw new Error("Microsoft Entra requires Public base URL.");
  }

  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("Microsoft Entra requires a valid Public base URL.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Microsoft Entra requires Public base URL to start with http:// or https://.");
  }

  return parsed.toString().replace(/\/+$/, "");
}

function normalizeEmailLikeValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized.includes("@") ? normalized : "";
}

function normalizeStringArray(values = []) {
  if (!Array.isArray(values)) {
    return [];
  }

  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function normalizeCaseInsensitiveArray(values = []) {
  return [...new Set(normalizeStringArray(values).map((value) => value.toLowerCase()))];
}

function parseJwtSegment(segment) {
  return JSON.parse(Buffer.from(String(segment || ""), "base64url").toString("utf8"));
}

function decodeJwt(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) {
    throw new Error("Microsoft Entra returned an invalid ID token.");
  }

  return {
    header: parseJwtSegment(parts[0]),
    payload: parseJwtSegment(parts[1]),
    signingInput: `${parts[0]}.${parts[1]}`,
    signature: Buffer.from(parts[2], "base64url"),
  };
}

async function readErrorPayload(response) {
  try {
    const payload = await response.json();
    if (payload?.error_description) {
      return payload.error_description;
    }
    if (payload?.error?.message) {
      return payload.error.message;
    }
    if (payload?.error) {
      return payload.error;
    }
  } catch {
  }

  try {
    const text = await response.text();
    return text || "";
  } catch {
    return "";
  }
}

async function fetchJson(url, init, defaultErrorMessage) {
  const response = await fetch(url, init);
  if (!response.ok) {
    const message = await readErrorPayload(response);
    throw new Error(message || defaultErrorMessage);
  }
  return response.json();
}

async function getOpenIdConfiguration(tenantId) {
  const normalizedTenantId = String(tenantId || "").trim();
  const cacheEntry = openIdConfigCache.get(normalizedTenantId);

  if (cacheEntry && cacheEntry.expiresAt > Date.now()) {
    return cacheEntry.value;
  }

  const value = await fetchJson(
    `https://login.microsoftonline.com/${encodeURIComponent(normalizedTenantId)}/v2.0/.well-known/openid-configuration`,
    { method: "GET" },
    "Unable to load Microsoft Entra OpenID configuration.",
  );

  openIdConfigCache.set(normalizedTenantId, {
    value,
    expiresAt: Date.now() + OPENID_CONFIG_TTL_MS,
  });
  return value;
}

async function getJwk(tenantId, kid) {
  const normalizedTenantId = String(tenantId || "").trim();
  const normalizedKid = String(kid || "").trim();
  const cacheKey = `${normalizedTenantId}:${normalizedKid}`;
  const cacheEntry = jwksCache.get(cacheKey);

  if (cacheEntry && cacheEntry.expiresAt > Date.now()) {
    return cacheEntry.value;
  }

  const configuration = await getOpenIdConfiguration(normalizedTenantId);
  const jwks = await fetchJson(configuration.jwks_uri, { method: "GET" }, "Unable to load Microsoft Entra signing keys.");
  const key = Array.isArray(jwks?.keys) ? jwks.keys.find((candidate) => candidate?.kid === normalizedKid) : null;

  if (!key) {
    throw new Error("Unable to verify the Microsoft Entra ID token signing key.");
  }

  const value = {
    key,
    issuer: configuration.issuer,
    tokenEndpoint: configuration.token_endpoint,
  };
  jwksCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + OPENID_CONFIG_TTL_MS,
  });
  return value;
}

function verifyTokenTiming(payload) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const skewSeconds = 60;
  const expiresAt = Number(payload?.exp || 0);
  const notBefore = Number(payload?.nbf || payload?.iat || 0);

  if (!Number.isFinite(expiresAt) || expiresAt <= nowSeconds - skewSeconds) {
    throw new Error("Microsoft Entra ID token has expired.");
  }

  if (Number.isFinite(notBefore) && notBefore > nowSeconds + skewSeconds) {
    throw new Error("Microsoft Entra ID token is not yet valid.");
  }
}

function verifyIdTokenSignature(signingInput, signature, jwk) {
  if (String(jwk?.kty || "") !== "RSA") {
    throw new Error("Microsoft Entra returned an unsupported signing key type.");
  }

  const publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
  const verified = crypto.verify("RSA-SHA256", Buffer.from(signingInput, "utf8"), publicKey, signature);
  if (!verified) {
    throw new Error("Microsoft Entra ID token signature verification failed.");
  }
}

function inferUsernameFromClaims(payload) {
  const preferredUsername = String(payload?.preferred_username || "").trim();
  const email = normalizeEmailLikeValue(payload?.email) || normalizeEmailLikeValue(preferredUsername) || normalizeEmailLikeValue(payload?.upn);
  return preferredUsername || email || `entra-${String(payload?.oid || "").slice(0, 8) || "user"}`;
}

function inferDisplayNameFromClaims(payload) {
  return String(payload?.name || payload?.preferred_username || payload?.email || "").trim();
}

export function isEntraGroupOverage(payload = {}) {
  if (payload?.hasgroups === true) {
    return true;
  }

  const claimNames = payload?._claim_names;
  return Boolean(claimNames && typeof claimNames === "object" && claimNames.groups);
}

export function resolveEntraRedirectUri(settings = {}) {
  const baseUrl = normalizePublicBaseUrl(settings.publicBaseUrl);
  return new URL("/api/auth/entra/callback", `${baseUrl}/`).toString();
}

export function resolveEntraPostLoginRedirectUrl(settings = {}, returnToPath = "/", authError = "") {
  const baseUrl = normalizePublicBaseUrl(settings.publicBaseUrl);
  const safeReturnToPath = sanitizeEntraReturnToPath(returnToPath);
  const redirectUrl = new URL(safeReturnToPath, `${baseUrl}/`);

  if (authError) {
    redirectUrl.searchParams.set("authError", authError);
  } else {
    redirectUrl.searchParams.delete("authError");
  }

  return redirectUrl.toString();
}

export function sanitizeEntraReturnToPath(value, fallback = "/") {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return fallback;
  }

  try {
    const parsed = new URL(normalized);
    return `${parsed.pathname || "/"}${parsed.search || ""}`;
  } catch {
  }

  if (!normalized.startsWith("/")) {
    return fallback;
  }

  if (normalized.startsWith("/api/auth/entra")) {
    return fallback;
  }

  return normalized;
}

export function validateEntraSettings(settings = {}, { requireConfiguredSecret = true } = {}) {
  const tenantId = String(settings.entraTenantId || "").trim();
  const clientId = String(settings.entraClientId || "").trim();
  const clientSecret = String(settings.entraClientSecret || "").trim();
  const clientSecretConfigured = Boolean(clientSecret || settings.entraClientSecretConfigured);

  if (!tenantId) {
    throw new Error("Microsoft Entra is enabled but Tenant ID is missing.");
  }
  if (!clientId) {
    throw new Error("Microsoft Entra is enabled but Client ID is missing.");
  }
  if (requireConfiguredSecret && !clientSecretConfigured) {
    throw new Error("Microsoft Entra is enabled but Client secret is missing.");
  }

  return {
    tenantId,
    clientId,
    clientSecret,
    clientSecretConfigured,
    redirectUri: resolveEntraRedirectUri(settings),
  };
}

export function createEntraLoginRequest(settings = {}, returnToPath = "/") {
  const { tenantId, clientId, redirectUri } = validateEntraSettings(settings);
  const state = randomBase64Url(24);
  const nonce = randomBase64Url(24);
  const codeVerifier = randomBase64Url(48);
  const codeChallenge = toBase64Url(crypto.createHash("sha256").update(codeVerifier).digest());
  const url = new URL(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", ENTRA_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  return {
    authorizationUrl: url.toString(),
    state,
    nonce,
    codeVerifier,
    returnToPath: sanitizeEntraReturnToPath(returnToPath),
  };
}

export function resolveEntraLogoutUrl(settings = {}, returnToPath = "/") {
  const { tenantId } = validateEntraSettings(settings, { requireConfiguredSecret: false });
  const postLogoutRedirect = resolveEntraPostLoginRedirectUrl(settings, sanitizeEntraReturnToPath(returnToPath || "/"));
  const url = new URL(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/logout`);
  url.searchParams.set("post_logout_redirect_uri", postLogoutRedirect);
  return url.toString();
}

export async function exchangeEntraAuthorizationCode(settings = {}, code, codeVerifier) {
  const { tenantId, clientId, clientSecret, redirectUri } = validateEntraSettings(settings);
  const configuration = await getOpenIdConfiguration(tenantId);
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code: String(code || ""),
    redirect_uri: redirectUri,
    code_verifier: String(codeVerifier || ""),
  });

  return fetchJson(
    configuration.token_endpoint,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    },
    "Microsoft Entra token exchange failed.",
  );
}

export async function verifyEntraIdToken(settings = {}, idToken, expectedNonce) {
  const { tenantId, clientId } = validateEntraSettings(settings, { requireConfiguredSecret: false });
  const { header, payload, signingInput, signature } = decodeJwt(idToken);

  if (String(header?.alg || "") !== "RS256") {
    throw new Error("Microsoft Entra returned an unsupported ID token algorithm.");
  }
  if (!String(header?.kid || "").trim()) {
    throw new Error("Microsoft Entra returned an ID token without a signing key identifier.");
  }

  const { key, issuer } = await getJwk(tenantId, header.kid);
  verifyIdTokenSignature(signingInput, signature, key);
  verifyTokenTiming(payload);

  if (String(payload?.aud || "") !== clientId) {
    throw new Error("Microsoft Entra ID token audience does not match the configured Client ID.");
  }
  if (String(payload?.iss || "") !== String(issuer || "")) {
    throw new Error("Microsoft Entra ID token issuer does not match the configured tenant.");
  }
  if (String(payload?.tid || "") !== tenantId) {
    throw new Error("Microsoft Entra ID token tenant does not match the configured tenant.");
  }
  if (String(payload?.nonce || "") !== String(expectedNonce || "")) {
    throw new Error("Microsoft Entra ID token nonce validation failed.");
  }
  if (!String(payload?.oid || "").trim()) {
    throw new Error("Microsoft Entra ID token did not include a stable user object ID.");
  }

  return payload;
}

export async function fetchEntraPhotoDataUrl(accessToken) {
  if (!String(accessToken || "").trim()) {
    return "";
  }

  const response = await fetch("https://graph.microsoft.com/v1.0/me/photo/$value", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (response.status === 404) {
    return "";
  }

  if (!response.ok) {
    throw new Error("Unable to load the Microsoft Entra avatar.");
  }

  const contentType = String(response.headers.get("content-type") || "image/jpeg").trim() || "image/jpeg";
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) {
    return "";
  }

  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

export async function fetchEntraGroupIds(accessToken) {
  if (!String(accessToken || "").trim()) {
    return [];
  }

  const groupIds = new Set();
  let nextUrl = "https://graph.microsoft.com/v1.0/me/transitiveMemberOf/microsoft.graph.group?$select=id&$top=999";

  while (nextUrl) {
    const payload = await fetchJson(
      nextUrl,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      "Unable to load Microsoft Entra group memberships.",
    );

    for (const entry of Array.isArray(payload?.value) ? payload.value : []) {
      const id = String(entry?.id || "").trim();
      if (id) {
        groupIds.add(id);
      }
    }

    nextUrl = String(payload?.["@odata.nextLink"] || "").trim();
  }

  return [...groupIds];
}

export function resolveEntraIdentityFromClaims(payload = {}) {
  const externalId = String(payload?.oid || "").trim();
  const tenantId = String(payload?.tid || "").trim();
  const email =
    normalizeEmailLikeValue(payload?.email) ||
    normalizeEmailLikeValue(payload?.preferred_username) ||
    normalizeEmailLikeValue(payload?.upn);
  const username = inferUsernameFromClaims(payload);
  const displayName = inferDisplayNameFromClaims(payload) || username;

  return {
    externalId,
    tenantId,
    username,
    displayName,
    email,
    appRoleValues: normalizeCaseInsensitiveArray(Array.isArray(payload?.roles) ? payload.roles : []),
    groupIds: normalizeCaseInsensitiveArray(Array.isArray(payload?.groups) ? payload.groups : []),
    groupsOverage: isEntraGroupOverage(payload),
  };
}
