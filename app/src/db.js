import crypto from "node:crypto";
import { Pool } from "pg";
import { readDatabaseConfig } from "./db-config.js";

export const pool = new Pool(readDatabaseConfig());

export const query = (text, params = []) => pool.query(text, params);

export async function tx(work) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export const newId = () => crypto.randomUUID();
export const newToken = () => crypto.randomBytes(24).toString("hex");

export function hashPassword(password) {
  const salt = crypto.createHash("sha256").update(`sprinto:${password}`).digest("hex");
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

export const verifyPassword = (password, hash) => hashPassword(password) === hash;
