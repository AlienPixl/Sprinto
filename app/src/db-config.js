import fs from "node:fs";

const DEFAULT_DATABASE_URL = "postgres://sprinto:sprinto@localhost:5432/sprinto";

function parseBooleanEnv(value, defaultValue = false) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return defaultValue;
  }

  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function readTextFile(readFileSync, filePath, label) {
  try {
    return readFileSync(filePath, "utf8");
  } catch (error) {
    const reason = error instanceof Error && error.message ? ` ${error.message}` : "";
    throw new Error(`Unable to read ${label} at "${filePath}".${reason}`);
  }
}

export function readDatabaseConfig(env = process.env, deps = { readFileSync: fs.readFileSync }) {
  const connectionString = String(env.DATABASE_URL || DEFAULT_DATABASE_URL).trim() || DEFAULT_DATABASE_URL;
  const sslEnabled = parseBooleanEnv(env.SPRINTO_DB_SSL_ENABLED, false);
  const sslRejectUnauthorized = parseBooleanEnv(env.SPRINTO_DB_SSL_REJECT_UNAUTHORIZED, true);
  const sslCaFile = String(env.SPRINTO_DB_SSL_CA_FILE || "").trim();
  const sslCertFile = String(env.SPRINTO_DB_SSL_CERT_FILE || "").trim();
  const sslKeyFile = String(env.SPRINTO_DB_SSL_KEY_FILE || "").trim();

  if (!sslEnabled) {
    return { connectionString };
  }

  if ((sslCertFile && !sslKeyFile) || (!sslCertFile && sslKeyFile)) {
    throw new Error("Database SSL client certificate and key must be provided together.");
  }

  const ssl = {
    rejectUnauthorized: sslRejectUnauthorized,
  };

  if (sslCaFile) {
    ssl.ca = readTextFile(deps.readFileSync, sslCaFile, "database SSL CA file");
  }

  if (sslCertFile && sslKeyFile) {
    ssl.cert = readTextFile(deps.readFileSync, sslCertFile, "database SSL client certificate file");
    ssl.key = readTextFile(deps.readFileSync, sslKeyFile, "database SSL client key file");
  }

  return {
    connectionString,
    ssl,
  };
}

