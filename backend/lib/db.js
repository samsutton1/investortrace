"use strict";

const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const PROVIDER_SLUG = "deepskiptrace";
const PROVIDER_NAME = "DeepSkipTrace";
const API_BASE = "https://deepskiptrace.com/api/v1";

function resolveDbPath(rootDir, dbPath) {
  return dbPath || process.env.INVESTORTRACE_DB || path.join(rootDir, "db", "investortrace.db");
}

function openDb(rootDir, dbPath) {
  const resolved = resolveDbPath(rootDir, dbPath);
  const isMemory = resolved === ":memory:";
  const existed = !isMemory && fs.existsSync(resolved);
  if (!isMemory && !existed) {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
  }
  const db = new DatabaseSync(resolved);
  db.exec("PRAGMA foreign_keys = ON");
  if (!existed) {
    const schema = fs.readFileSync(path.join(rootDir, "db", "schema.sql"), "utf8");
    db.exec(schema);
  }
  db.prepare(
    `INSERT OR IGNORE INTO providers (slug, name, api_base_url, status)
     VALUES (?, ?, ?, 'testing')`
  ).run(PROVIDER_SLUG, PROVIDER_NAME, API_BASE);
  return db;
}

function getProvider(db) {
  return db.prepare("SELECT id, slug, name FROM providers WHERE slug = ?").get(PROVIDER_SLUG);
}

module.exports = { openDb, getProvider, PROVIDER_SLUG, PROVIDER_NAME, API_BASE };
