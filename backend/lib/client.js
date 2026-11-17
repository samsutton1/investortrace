"use strict";

const { API_BASE } = require("./db");

async function dstRequest(method, apiPath, key, body) {
  if (!key) {
    const err = new Error("API key is not configured.");
    err.code = "NO_KEY";
    throw err;
  }
  const headers = {
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
  };
  const options = {
    method,
    headers,
    signal: AbortSignal.timeout(60000),
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const res = await fetch(API_BASE + apiPath, options);
  const text = await res.text();
  return { status: res.status, text };
}

function parseJson(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function providerMessage(httpStatus, data) {
  if (data && typeof data === "object") {
    if (typeof data.detail === "string" && data.detail.trim()) return data.detail.trim();
    if (typeof data.message === "string" && data.message.trim()) return data.message.trim();
  }
  if (httpStatus === 402) return "Out of skips.";
  if (httpStatus === 429) return "Rate limit exceeded. Try again shortly.";
  if (httpStatus === 401 || httpStatus === 403) {
    return "The skip-trace provider rejected the request.";
  }
  if (httpStatus >= 500) return "The skip-trace provider is temporarily unavailable.";
  return "The skip-trace provider returned an error.";
}

function responseStatus(httpStatus) {
  if (httpStatus === 200) return 200;
  if (httpStatus === 402 || httpStatus === 429) return httpStatus;
  if (httpStatus === 401 || httpStatus === 403) return 502;
  if (httpStatus >= 500) return 502;
  if (httpStatus >= 400) return 502;
  return 502;
}

function sanitizeAccount(data) {
  const account = data.account && typeof data.account === "object" ? data.account : {};
  const balance = data.balance && typeof data.balance === "object" ? data.balance : data.balance;
  const limits = data.limits && typeof data.limits === "object" ? data.limits : {};
  const keyMeta = data.key && typeof data.key === "object" ? data.key : {};
  return {
    account: {
      name: account.name ?? null,
      status: account.status ?? null,
      period_end: account.period_end ?? null,
    },
    balance: balance ?? null,
    limits: {
      calls_per_minute: limits.calls_per_minute ?? null,
      account_calls_per_minute: limits.account_calls_per_minute ?? null,
    },
    key: {
      id: keyMeta.id ?? null,
      name: keyMeta.name ?? null,
    },
  };
}

module.exports = {
  dstRequest,
  parseJson,
  providerMessage,
  responseStatus,
  sanitizeAccount,
};
