"use strict";

const path = require("path");
const express = require("express");
const { ROOT, loadEnv, getApiKey } = require("./lib/env");
const { openDb, getProvider } = require("./lib/db");
const { validateSearch, apiBody, inputKey } = require("./lib/validate");
const {
  dstRequest,
  parseJson,
  providerMessage,
  responseStatus,
  sanitizeAccount,
} = require("./lib/client");
const {
  insertSearch,
  insertRawResponse,
  markSearchError,
  applySearchResult,
  loadNormalizedSearch,
  listHistory,
} = require("./lib/mapper");

loadEnv(ROOT);

function withDb(fn) {
  const db = openDb(ROOT);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));

  app.get("/", (_req, res) => {
    res.sendFile(path.join(ROOT, "index.html"));
  });
  app.get("/index.html", (_req, res) => {
    res.sendFile(path.join(ROOT, "index.html"));
  });

  app.get("/api/account", async (_req, res) => {
    const key = getApiKey();
    if (!key) {
      return res.status(503).json({
        status: "error",
        message: "API key is not configured on the server.",
      });
    }
    try {
      const { status, text } = await dstRequest("GET", "/account", key);
      const data = parseJson(text);
      if (status !== 200) {
        return res.status(responseStatus(status)).json({
          status: "error",
          message: providerMessage(status, data),
        });
      }
      return res.json(sanitizeAccount(data));
    } catch (err) {
      if (err && err.name === "TimeoutError") {
        return res.status(502).json({
          status: "error",
          message: "The skip-trace provider timed out.",
        });
      }
      return res.status(502).json({
        status: "error",
        message: "Could not reach the skip-trace provider.",
      });
    }
  });

  app.get("/api/searches", (_req, res) => {
    const searches = withDb((db) => listHistory(db));
    res.json({ searches });
  });

  app.get("/api/searches/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ status: "error", message: "Search id must be a positive integer." });
    }
    const result = withDb((db) => loadNormalizedSearch(db, id));
    if (!result) {
      return res.status(404).json({ status: "error", message: "Search not found." });
    }
    res.json(result);
  });

  app.post("/api/search", async (req, res) => {
    const checked = validateSearch(req.body);
    if (checked.error) {
      return res.status(400).json({ status: "error", message: checked.error });
    }
    const key = getApiKey();
    if (!key) {
      return res.status(503).json({
        status: "error",
        message: "API key is not configured on the server.",
      });
    }

    const input = checked.input;
    const body = apiBody(input);
    const keyStr = inputKey(input, body);
    const db = openDb(ROOT);
    let searchId;
    try {
      const provider = getProvider(db);
      searchId = insertSearch(db, provider.id, input, body, keyStr);
      let status;
      let text;
      try {
        ({ status, text } = await dstRequest("POST", "/search", key, body));
      } catch (err) {
        const message =
          err && err.name === "TimeoutError"
            ? "The skip-trace provider timed out."
            : "Could not reach the skip-trace provider.";
        markSearchError(db, searchId, message);
        return res.status(502).json({
          search_id: searchId,
          provider: provider.slug,
          status: "error",
          skips_used: 0,
          reused: false,
          message,
          people: [],
        });
      }
      const data = parseJson(text);
      const rawId = insertRawResponse(db, searchId, "POST /api/v1/search", status, text);
      applySearchResult(db, {
        searchId,
        providerId: provider.id,
        rawId,
        httpStatus: status,
        text,
        data,
      });
      const result = loadNormalizedSearch(db, searchId);
      const httpOut = status === 200 ? 200 : responseStatus(status);
      return res.status(httpOut).json(result);
    } catch (err) {
      if (searchId) {
        try {
          markSearchError(db, searchId, "Failed to save the search result.");
        } catch {
          // ignore secondary write failures
        }
      }
      return res.status(500).json({
        search_id: searchId ?? null,
        provider: "deepskiptrace",
        status: "error",
        skips_used: 0,
        reused: false,
        message: "Internal server error.",
        people: [],
      });
    } finally {
      db.close();
    }
  });

  app.use("/api", (_req, res) => {
    res.status(404).json({ status: "error", message: "Not found." });
  });

  return app;
}

const app = createApp();

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || "127.0.0.1";
  app.listen(port, host, () => {
    console.log(`InvestorTrace backend listening on http://${host}:${port}`);
  });
}

module.exports = { app, createApp };
