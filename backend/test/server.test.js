"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { createApp } = require("../server");

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        server,
        base: `http://127.0.0.1:${port}`,
      });
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

test("GET / serves the InvestorTrace index.html page", async () => {
  const { server, base } = await listen(createApp());
  try {
    const res = await fetch(base + "/");
    const body = await res.text();
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /html/);
    assert.match(body, /<title>InvestorTrace/);
    assert.match(body, /id="searchForm"/);
  } finally {
    await close(server);
  }
});

test("POST /api/search returns 400 with a clear message for invalid input", async () => {
  const { server, base } = await listen(createApp());
  try {
    const missing = await fetch(base + "/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ first_name: "Zzyzxtest" }),
    });
    const missingBody = await missing.json();
    assert.equal(missing.status, 400);
    assert.equal(missingBody.status, "error");
    assert.match(missingBody.message, /name search|address search/);

    const badZip = await fetch(base + "/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        first_name: "Zzyzxtest",
        last_name: "Qwxnoperson",
        zip: "85",
      }),
    });
    const badZipBody = await badZip.json();
    assert.equal(badZip.status, 400);
    assert.match(badZipBody.message, /Zip must be 5 digits/);
  } finally {
    await close(server);
  }
});

test("GET /api/searches/:id rejects a non-integer id", async () => {
  const { server, base } = await listen(createApp());
  try {
    const res = await fetch(base + "/api/searches/abc");
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.status, "error");
  } finally {
    await close(server);
  }
});
