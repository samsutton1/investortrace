"use strict";

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

function parseTestFlag(value) {
  if (value === undefined || value === null) return { ok: true, value: true };
  if (value === true || value === 1 || value === "1" || value === "true") {
    return { ok: true, value: true };
  }
  if (value === false || value === 0 || value === "0" || value === "false") {
    return { ok: true, value: false };
  }
  return { ok: false };
}

function validateSearch(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Request body must be a JSON object." };
  }

  const first_name = clean(body.first_name);
  const last_name = clean(body.last_name);
  const street = clean(body.street);
  const city = clean(body.city);
  let state = clean(body.state);
  const zip = clean(body.zip);
  const purpose = clean(body.purpose);
  const testFlag = parseTestFlag(body.test);
  if (!testFlag.ok) {
    return { error: 'Field "test" must be a boolean.' };
  }

  if (!last_name && !street) {
    return {
      error:
        "Provide a name search (first_name, last_name, and zip or city+state) or an address search (street, and zip or city+state).",
    };
  }
  if (!zip && !(city && state)) {
    return { error: "Each search needs a zip, or a city and state." };
  }
  if (state) {
    if (!/^[A-Za-z]{2}$/.test(state)) {
      return { error: "State must be a two-letter code, like AZ." };
    }
    state = state.toUpperCase();
  }
  if (zip && !/^\d{5}(-\d{4})?$/.test(zip)) {
    return { error: "Zip must be 5 digits, or 5+4 digits." };
  }
  if (last_name && !first_name) {
    return { error: "Name searches need both first_name and last_name." };
  }

  const type = last_name ? "name" : "address";
  return {
    ok: true,
    input: {
      type,
      first_name: type === "name" ? first_name : null,
      last_name: type === "name" ? last_name : null,
      street,
      city,
      state,
      zip,
      purpose,
      test: testFlag.value,
    },
  };
}

function apiBody(input) {
  const body = {};
  for (const key of ["first_name", "last_name", "street", "city", "state", "zip"]) {
    if (input[key]) body[key] = input[key];
  }
  return body;
}

function inputKey(input, body) {
  const values = Object.keys(body)
    .sort()
    .map((key) => String(body[key]).trim().toLowerCase());
  return [input.type, ...values].join("|");
}

module.exports = { validateSearch, apiBody, inputKey, clean };
