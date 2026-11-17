"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("node:assert/strict");
const test = require("node:test");
const { ROOT } = require("../lib/env");
const { openDb, getProvider } = require("../lib/db");
const { validateSearch, apiBody, inputKey } = require("../lib/validate");
const {
  insertSearch,
  insertRawResponse,
  applySearchResult,
  loadNormalizedSearch,
  listHistory,
} = require("../lib/mapper");

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "search-match.json"), "utf8")
);

function memoryDb() {
  return openDb(ROOT, ":memory:");
}

test("validateSearch requires a name or an address plus a location", () => {
  assert.equal(validateSearch(null).error.includes("JSON object"), true);
  assert.match(validateSearch({}).error, /name search|address search/);
  assert.match(
    validateSearch({ first_name: "Zzyzxtest", last_name: "Qwxnoperson" }).error,
    /zip|city and state/
  );
  assert.match(
    validateSearch({ first_name: "Zzyzxtest", zip: "85001" }).error,
    /name search|address search/
  );
  assert.match(
    validateSearch({ last_name: "Qwxnoperson", zip: "85001" }).error,
    /first_name and last_name/
  );
  assert.match(validateSearch({ street: "123 Sample St" }).error, /zip|city and state/);
  assert.match(
    validateSearch({ first_name: "A", last_name: "B", zip: "8500" }).error,
    /Zip must be 5 digits/
  );
  assert.match(
    validateSearch({ street: "123 Sample St", city: "Phoenix", state: "Arizona" }).error,
    /two-letter/
  );
});

test("validateSearch accepts name+zip and address+city/state, and defaults test to true", () => {
  const name = validateSearch({
    first_name: "Zzyzxtest",
    last_name: "Qwxnoperson",
    zip: "85001",
  });
  assert.equal(name.ok, true);
  assert.equal(name.input.type, "name");
  assert.equal(name.input.test, true);
  assert.equal(name.input.zip, "85001");

  const address = validateSearch({
    street: "123 Sample St",
    city: "Phoenix",
    state: "az",
    test: false,
    purpose: "testing",
  });
  assert.equal(address.ok, true);
  assert.equal(address.input.type, "address");
  assert.equal(address.input.state, "AZ");
  assert.equal(address.input.test, false);
});

test("save/normalize maps a fixture search into the schema without calling the API", () => {
  const db = memoryDb();
  const provider = getProvider(db);
  const input = {
    type: "name",
    first_name: "Zzyzx",
    last_name: "Fixtureperson",
    street: null,
    city: null,
    state: null,
    zip: "85001",
    purpose: "testing",
    test: true,
  };
  const body = apiBody(input);
  const searchId = insertSearch(db, provider.id, input, body, inputKey(input, body));
  const rawId = insertRawResponse(
    db,
    searchId,
    "POST /api/v1/search",
    200,
    JSON.stringify(fixture)
  );
  const status = applySearchResult(db, {
    searchId,
    providerId: provider.id,
    rawId,
    httpStatus: 200,
    text: JSON.stringify(fixture),
    data: fixture,
  });
  assert.equal(status, "match");

  const personCount = db.prepare("SELECT COUNT(*) AS n FROM persons WHERE search_id = ?").get(searchId).n;
  const phoneCount = db.prepare("SELECT COUNT(*) AS n FROM person_phones").get().n;
  const emailCount = db.prepare("SELECT COUNT(*) AS n FROM person_emails").get().n;
  const addressCount = db.prepare("SELECT COUNT(*) AS n FROM person_addresses").get().n;
  const relativeCount = db.prepare("SELECT COUNT(*) AS n FROM person_relatives").get().n;
  const propertyCount = db.prepare("SELECT COUNT(*) AS n FROM properties").get().n;
  const eventCount = db.prepare("SELECT COUNT(*) AS n FROM property_events").get().n;
  const ledger = db.prepare("SELECT skips, reason FROM skip_ledger WHERE search_id = ?").get(searchId);
  const search = db.prepare("SELECT * FROM searches WHERE id = ?").get(searchId);

  assert.equal(personCount, 2);
  assert.equal(phoneCount, 2);
  assert.equal(emailCount, 1);
  assert.equal(addressCount, 1);
  assert.equal(relativeCount, 1);
  assert.equal(propertyCount, 1);
  assert.equal(eventCount, 2);
  assert.equal(ledger.skips, 1);
  assert.equal(ledger.reason, "search_hit");
  assert.equal(search.status, "match");
  assert.equal(search.skips_used, 1);
  assert.equal(search.reused, 0);
  assert.equal(search.provider_search_id, "dst_test_search_fixture_001");
  assert.equal(search.is_test, 1);

  const raw = db.prepare("SELECT body FROM raw_responses WHERE id = ?").get(rawId);
  assert.equal(raw.body, JSON.stringify(fixture));

  const relative = db.prepare("SELECT first_name, last_name, relation_group FROM person_relatives").get();
  assert.equal(relative.first_name, "Qwxno");
  assert.equal(relative.last_name, "Fixtureperson");
  assert.equal(relative.relation_group, "family");

  const property = db.prepare("SELECT assessed_year, estimated_value_cents, assessed_value_cents, in_foreclosure FROM properties").get();
  assert.equal(property.assessed_year, 2025);
  assert.equal(property.estimated_value_cents, 31000050);
  assert.equal(property.assessed_value_cents, 25000000);
  assert.equal(property.in_foreclosure, 1);

  const locked = db.prepare("SELECT locked, full_name FROM persons WHERE provider_person_id = ?").get(
    "dst_test_person_fixture_locked"
  );
  assert.equal(locked.locked, 1);
  assert.equal(locked.full_name, "Locked Fixtureperson");

  const result = loadNormalizedSearch(db, searchId);
  assert.equal(result.search_id, searchId);
  assert.equal(result.provider, "deepskiptrace");
  assert.equal(result.status, "match");
  assert.equal(result.skips_used, 1);
  assert.equal(result.reused, false);
  assert.equal(result.message, "Fixture match used only in offline tests.");
  assert.equal(result.people.length, 2);
  assert.equal(result.people[0].name, "Zzyzx Fixtureperson");
  assert.equal(result.people[0].locked, false);
  assert.equal(result.people[0].is_owner, true);
  assert.equal(result.people[0].phones[0].type, "mobile");
  assert.equal(result.people[0].phones[1].disconnected, true);
  assert.equal(result.people[0].phones[1].flagged, true);
  assert.equal(result.people[0].emails[0].email, "zzyzx.fixtureperson@example.com");
  assert.equal(result.people[0].addresses[0].street, "123 Sample St");
  assert.equal(result.people[0].relatives[0].name, "Qwxno Fixtureperson");
  assert.equal(result.people[0].properties[0].events.length, 2);
  assert.equal(result.people[0].properties[0].events[0].event_type, "sale");
  assert.equal(result.people[0].properties[0].events[1].event_type, "loan");
  assert.equal(result.people[1].locked, true);
  assert.equal(result.people[1].phones.length, 0);
  assert.equal(result.people[1].properties.length, 0);

  const history = listHistory(db);
  assert.equal(history[0].id, searchId);
  assert.equal(history[0].people_found, 2);
  assert.equal(history[0].skips_used, 1);
  db.close();
});

test("a 200 no-match result is saved as no_match with no skip ledger row", () => {
  const db = memoryDb();
  const provider = getProvider(db);
  const input = {
    type: "name",
    first_name: "Zzyzxtest",
    last_name: "Qwxnoperson",
    street: null,
    city: null,
    state: null,
    zip: "85001",
    purpose: "testing",
    test: true,
  };
  const body = apiBody(input);
  const payload = {
    status: "no_match",
    type: "name",
    search_id: "dst_test_search_nomatch",
    reused: false,
    skips_used: 0,
    result_count: 0,
    truncated: false,
    people: [],
    message: "No people matched this search.",
  };
  const searchId = insertSearch(db, provider.id, input, body, inputKey(input, body));
  const rawId = insertRawResponse(db, searchId, "POST /api/v1/search", 200, JSON.stringify(payload));
  const status = applySearchResult(db, {
    searchId,
    providerId: provider.id,
    rawId,
    httpStatus: 200,
    text: JSON.stringify(payload),
    data: payload,
  });
  assert.equal(status, "no_match");
  const search = db.prepare("SELECT status, skips_used FROM searches WHERE id = ?").get(searchId);
  assert.equal(search.status, "no_match");
  assert.equal(search.skips_used, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM persons").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM skip_ledger").get().n, 0);
  const result = loadNormalizedSearch(db, searchId);
  assert.equal(result.status, "no_match");
  assert.equal(result.message, "No people matched this search.");
  assert.equal(result.people.length, 0);
  db.close();
});

test("402, 429, and 5xx are saved as status error with a message", () => {
  const cases = [
    [402, { detail: "Your account is out of skips." }, "Your account is out of skips."],
    [429, { detail: "Too many requests." }, "Too many requests."],
    [503, {}, "The skip-trace provider is temporarily unavailable."],
  ];
  for (const [httpStatus, data, expected] of cases) {
    const db = memoryDb();
    const provider = getProvider(db);
    const input = {
      type: "name",
      first_name: "Zzyzxtest",
      last_name: "Qwxnoperson",
      street: null,
      city: null,
      state: null,
      zip: "85001",
      purpose: "testing",
      test: true,
    };
    const body = apiBody(input);
    const searchId = insertSearch(db, provider.id, input, body, inputKey(input, body));
    const text = JSON.stringify(data);
    const rawId = insertRawResponse(db, searchId, "POST /api/v1/search", httpStatus, text);
    const status = applySearchResult(db, {
      searchId,
      providerId: provider.id,
      rawId,
      httpStatus,
      text,
      data,
    });
    assert.equal(status, "error");
    const result = loadNormalizedSearch(db, searchId);
    assert.equal(result.status, "error");
    assert.equal(result.message, expected);
    assert.equal(result.people.length, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM skip_ledger").get().n, 0);
    db.close();
  }
});
