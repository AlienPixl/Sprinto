import { describe, expect, it } from "vitest";
import { readDatabaseConfig } from "./db-config.js";

describe("database config", () => {
  it("uses plain connection settings by default", () => {
    expect(readDatabaseConfig({ DATABASE_URL: "postgres://example" })).toEqual({
      connectionString: "postgres://example",
    });
  });

  it("builds ssl config from env flags and mounted files", () => {
    const config = readDatabaseConfig(
      {
        DATABASE_URL: "postgres://example",
        SPRINTO_DB_SSL_ENABLED: "true",
        SPRINTO_DB_SSL_REJECT_UNAUTHORIZED: "false",
        SPRINTO_DB_SSL_CA_FILE: "/run/secrets/db-ca.crt",
        SPRINTO_DB_SSL_CERT_FILE: "/run/secrets/db-client.crt",
        SPRINTO_DB_SSL_KEY_FILE: "/run/secrets/db-client.key",
      },
      {
        readFileSync(filePath) {
          return `contents:${filePath}`;
        },
      },
    );

    expect(config).toEqual({
      connectionString: "postgres://example",
      ssl: {
        rejectUnauthorized: false,
        ca: "contents:/run/secrets/db-ca.crt",
        cert: "contents:/run/secrets/db-client.crt",
        key: "contents:/run/secrets/db-client.key",
      },
    });
  });

  it("requires client certificate and key together", () => {
    expect(() =>
      readDatabaseConfig({
        DATABASE_URL: "postgres://example",
        SPRINTO_DB_SSL_ENABLED: "true",
        SPRINTO_DB_SSL_CERT_FILE: "/run/secrets/db-client.crt",
      })
    ).toThrow("Database SSL client certificate and key must be provided together.");
  });

  it("fails fast when a referenced ssl file cannot be read", () => {
    expect(() =>
      readDatabaseConfig(
        {
          DATABASE_URL: "postgres://example",
          SPRINTO_DB_SSL_ENABLED: "true",
          SPRINTO_DB_SSL_CA_FILE: "/run/secrets/db-ca.crt",
        },
        {
          readFileSync() {
            throw new Error("ENOENT");
          },
        },
      )
    ).toThrow('Unable to read database SSL CA file at "/run/secrets/db-ca.crt". ENOENT');
  });
});

