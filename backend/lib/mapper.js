"use strict";

const { providerMessage } = require("./client");

const PHONE_TYPES = new Set(["mobile", "landline", "voip", "unknown"]);
const RELATION_GROUPS = new Set(["family", "associate"]);

function asBoolInt(value) {
  if (value === undefined || value === null) return null;
  return value ? 1 : 0;
}

function asBool(value) {
  if (value === undefined || value === null) return null;
  return Boolean(value);
}

function cents(value) {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 100);
}

function asJson(value) {
  if (value === undefined) return null;
  return JSON.stringify(value);
}

function parseJsonField(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function phoneType(value) {
  if (value === undefined || value === null || value === "") return null;
  const type = String(value).toLowerCase();
  return PHONE_TYPES.has(type) ? type : "unknown";
}

function relationGroup(value) {
  if (value === undefined || value === null || value === "") return null;
  const group = String(value).toLowerCase();
  return RELATION_GROUPS.has(group) ? group : null;
}

function insertSearch(db, providerId, input, body, inputKey) {
  const info = db
    .prepare(
      `INSERT INTO searches (
         provider_id, search_type, first_name, last_name, street, city, state,
         zip, input_key, request_json, purpose, is_test, source
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'single')`
    )
    .run(
      providerId,
      input.type,
      input.first_name,
      input.last_name,
      input.street,
      input.city,
      input.state,
      input.zip,
      inputKey,
      JSON.stringify(body),
      input.purpose,
      input.test ? 1 : 0
    );
  return Number(info.lastInsertRowid);
}

function insertRawResponse(db, searchId, endpoint, httpStatus, text) {
  const info = db
    .prepare(
      "INSERT INTO raw_responses (search_id, endpoint, http_status, body) VALUES (?, ?, ?, ?)"
    )
    .run(searchId, endpoint, httpStatus, text ?? "");
  return Number(info.lastInsertRowid);
}

function markSearchError(db, searchId, message) {
  db.prepare(
    `UPDATE searches
     SET status = 'error', error_message = ?, completed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?`
  ).run(String(message || "Unknown error").slice(0, 500), searchId);
}

function savePerson(db, searchId, rawId, person, rank) {
  const report = person.report || {};
  const info = db
    .prepare(
      `INSERT INTO persons (
         search_id, raw_response_id, provider_person_id, rank, full_name,
         first_name, last_name, aliases, age, deceased, likely_deceased,
         date_of_death, is_owner, last_seen_at_address, locked
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      searchId,
      rawId,
      person.person_id ?? null,
      person.index ?? rank,
      person.name ?? report.name ?? null,
      report.first_name ?? null,
      report.last_name ?? null,
      asJson(report.aliases || []),
      person.age ?? report.age ?? null,
      asBoolInt(person.deceased ?? report.deceased),
      asBoolInt(person.likely_deceased ?? report.likely_deceased),
      report.date_of_death ?? null,
      asBoolInt(person.owner),
      person.last_seen_here ?? null,
      asBoolInt(person.locked) ?? 0
    );
  const personId = Number(info.lastInsertRowid);

  (report.phones || []).forEach((phone, i) => {
    if (!phone || !phone.number) return;
    db.prepare(
      `INSERT INTO person_phones (
         person_id, rank, number, display, phone_type, carrier,
         disconnected, business, flagged, first_seen, last_seen
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      personId,
      i + 1,
      phone.number,
      phone.display ?? null,
      phoneType(phone.type),
      phone.carrier ?? null,
      asBoolInt(phone.disconnected),
      asBoolInt(phone.business),
      asBoolInt(phone.flagged),
      phone.first_seen ?? null,
      phone.last_seen ?? null
    );
  });

  (report.emails || []).forEach((email, i) => {
    const address = email && (email.address || email.email);
    if (!address) return;
    db.prepare(
      "INSERT INTO person_emails (person_id, rank, email, inactive, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(
      personId,
      i + 1,
      address,
      asBoolInt(email.inactive),
      email.first_seen ?? null,
      email.last_seen ?? null
    );
  });

  (report.addresses || []).forEach((address, i) => {
    if (!address) return;
    db.prepare(
      `INSERT INTO person_addresses (
         person_id, rank, street, city, state, zip, county,
         first_seen, last_seen, owned_now, owned_before
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      personId,
      i + 1,
      address.street ?? null,
      address.city ?? null,
      address.state ?? null,
      address.zip ?? null,
      address.county ?? null,
      address.first_seen ?? null,
      address.last_seen ?? null,
      asBoolInt(address.owned),
      asBoolInt(address.owned_before)
    );
  });

  (report.relatives || []).forEach((rel, i) => {
    if (!rel) return;
    db.prepare(
      `INSERT INTO person_relatives (
         person_id, rank, relationship, relation_group, full_name,
         first_name, last_name, age, deceased, likely_deceased,
         address, phones, emails
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      personId,
      i + 1,
      rel.relationship ?? null,
      relationGroup(rel.group ?? rel.relation_group),
      rel.name ?? null,
      rel.first_name ?? null,
      rel.last_name ?? null,
      rel.age ?? null,
      asBoolInt(rel.deceased),
      asBoolInt(rel.likely_deceased),
      asJson(rel.address ?? null),
      asJson(rel.phones || []),
      asJson(rel.emails || [])
    );
  });

  (report.properties || []).forEach((property) => {
    if (!property) return;
    let addr = property.address || {};
    if (typeof addr === "string") addr = { street: addr };
    const propInfo = db
      .prepare(
        `INSERT INTO properties (
           person_id, street, city, state, zip, county, parcel_number,
           mailing_address, owners, owned_now, estimated_value_cents,
           assessed_value_cents, assessed_year, living_sqft, lot_sqft,
           bedrooms, bathrooms, year_built, in_foreclosure, extra
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        personId,
        addr.street ?? null,
        addr.city ?? null,
        addr.state ?? null,
        addr.zip ?? null,
        property.county ?? addr.county ?? null,
        property.parcel_number ?? null,
        asJson(property.mailing_address ?? null),
        asJson(property.owners || []),
        asBoolInt(property.owned_now),
        cents(property.market_value),
        cents(property.assessed_value),
        property.assessed_year ?? null,
        property.building_sqft ?? null,
        property.lot_sqft ?? null,
        property.bedrooms ?? null,
        property.bathrooms ?? null,
        property.year_built ?? null,
        asBoolInt(property.foreclosure),
        asJson({ foreclosure: property.foreclosure ?? null })
      );
    const propertyId = Number(propInfo.lastInsertRowid);
    (property.sales || []).forEach((sale) => {
      db.prepare(
        `INSERT INTO property_events (
           property_id, event_type, event_date, amount_cents, party, document_type, details
         ) VALUES (?, 'sale', ?, ?, ?, ?, ?)`
      ).run(
        propertyId,
        sale.date ?? null,
        cents(sale.price),
        sale.buyer ?? null,
        sale.deed_type ?? null,
        asJson(sale)
      );
    });
    (property.loans || []).forEach((loan) => {
      db.prepare(
        `INSERT INTO property_events (
           property_id, event_type, event_date, amount_cents, document_type, details
         ) VALUES (?, 'loan', ?, ?, ?, ?)`
      ).run(
        propertyId,
        loan.date ?? null,
        cents(loan.amount),
        loan.type ?? null,
        asJson(loan)
      );
    });
  });

  return personId;
}

function applySearchResult(db, { searchId, providerId, rawId, httpStatus, text, data }) {
  if (httpStatus === 200 && data && typeof data === "object") {
    const people = Array.isArray(data.people) ? data.people : [];
    const status = people.length ? "match" : "no_match";
    const skips = Number(data.skips_used) || 0;
    db.prepare(
      `UPDATE searches
       SET status = ?, provider_search_id = ?, skips_used = ?, reused = ?,
           completed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ?`
    ).run(status, data.search_id ?? null, skips, data.reused ? 1 : 0, searchId);
    people.forEach((person, i) => savePerson(db, searchId, rawId, person, i + 1));
    if (skips > 0) {
      db.prepare(
        "INSERT INTO skip_ledger (provider_id, search_id, reason, skips) VALUES (?, ?, 'search_hit', ?)"
      ).run(providerId, searchId, skips);
    }
    return status;
  }
  const message = providerMessage(httpStatus, data);
  markSearchError(db, searchId, message);
  return "error";
}

function mapPhone(row) {
  return {
    number: row.number,
    display: row.display,
    type: row.phone_type,
    carrier: row.carrier,
    disconnected: asBool(row.disconnected),
    flagged: asBool(row.flagged),
    business: asBool(row.business),
    first_seen: row.first_seen,
    last_seen: row.last_seen,
  };
}

function mapEmail(row) {
  return {
    email: row.email,
    inactive: asBool(row.inactive),
    first_seen: row.first_seen,
    last_seen: row.last_seen,
  };
}

function mapAddress(row) {
  return {
    street: row.street,
    city: row.city,
    state: row.state,
    zip: row.zip,
    county: row.county,
    first_seen: row.first_seen,
    last_seen: row.last_seen,
    owned_now: asBool(row.owned_now),
    owned_before: asBool(row.owned_before),
  };
}

function mapRelative(row) {
  return {
    relationship: row.relationship,
    relation_group: row.relation_group,
    name: row.full_name,
    first_name: row.first_name,
    last_name: row.last_name,
    age: row.age,
    deceased: asBool(row.deceased),
    likely_deceased: asBool(row.likely_deceased),
    address: parseJsonField(row.address, null),
    phones: parseJsonField(row.phones, []),
    emails: parseJsonField(row.emails, []),
  };
}

function mapProperty(db, row) {
  const events = db
    .prepare(
      "SELECT event_type, event_date, amount_cents, party, document_type FROM property_events WHERE property_id = ? ORDER BY id"
    )
    .all(row.id)
    .map((event) => ({
      event_type: event.event_type,
      event_date: event.event_date,
      amount_cents: event.amount_cents,
      party: event.party,
      document_type: event.document_type,
    }));
  return {
    street: row.street,
    city: row.city,
    state: row.state,
    zip: row.zip,
    county: row.county,
    parcel_number: row.parcel_number,
    mailing_address: parseJsonField(row.mailing_address, null),
    owners: parseJsonField(row.owners, []),
    owned_now: asBool(row.owned_now),
    estimated_value_cents: row.estimated_value_cents,
    assessed_value_cents: row.assessed_value_cents,
    assessed_year: row.assessed_year,
    living_sqft: row.living_sqft,
    lot_sqft: row.lot_sqft,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    year_built: row.year_built,
    in_foreclosure: asBool(row.in_foreclosure),
    events,
  };
}

function messageForSearch(db, search) {
  if (search.status === "error") return search.error_message;
  const raw = db
    .prepare("SELECT body FROM raw_responses WHERE search_id = ? ORDER BY id DESC LIMIT 1")
    .get(search.id);
  if (!raw) return null;
  const data = parseJsonField(raw.body, {});
  return data && typeof data.message === "string" ? data.message : null;
}

function loadNormalizedSearch(db, searchId) {
  const search = db
    .prepare(
      `SELECT s.*, p.name AS provider_name, p.slug AS provider
       FROM searches s
       JOIN providers p ON p.id = s.provider_id
       WHERE s.id = ?`
    )
    .get(searchId);
  if (!search) return null;

  const people = db
    .prepare("SELECT * FROM persons WHERE search_id = ? ORDER BY rank, id")
    .all(searchId)
    .map((person) => {
      const phones = db
        .prepare("SELECT * FROM person_phones WHERE person_id = ? ORDER BY rank, id")
        .all(person.id)
        .map(mapPhone);
      const emails = db
        .prepare("SELECT * FROM person_emails WHERE person_id = ? ORDER BY rank, id")
        .all(person.id)
        .map(mapEmail);
      const addresses = db
        .prepare("SELECT * FROM person_addresses WHERE person_id = ? ORDER BY rank, id")
        .all(person.id)
        .map(mapAddress);
      const relatives = db
        .prepare("SELECT * FROM person_relatives WHERE person_id = ? ORDER BY rank, id")
        .all(person.id)
        .map(mapRelative);
      const properties = db
        .prepare("SELECT * FROM properties WHERE person_id = ? ORDER BY id")
        .all(person.id)
        .map((property) => mapProperty(db, property));
      return {
        id: person.id,
        rank: person.rank,
        name: person.full_name,
        age: person.age,
        deceased: asBool(person.deceased),
        is_owner: asBool(person.is_owner),
        locked: Boolean(person.locked),
        phones,
        emails,
        addresses,
        relatives,
        properties,
      };
    });

  return {
    search_id: search.id,
    provider: search.provider,
    status: search.status,
    skips_used: search.skips_used,
    reused: Boolean(search.reused),
    message: messageForSearch(db, search),
    people,
  };
}

function listHistory(db) {
  return db
    .prepare("SELECT * FROM v_search_history")
    .all()
    .map((row) => ({
      id: row.id,
      created_at: row.created_at,
      provider: row.provider,
      search_type: row.search_type,
      input_key: row.input_key,
      status: row.status,
      people_found: row.people_found,
      skips_used: row.skips_used,
      cost_cents: row.cost_cents,
      is_test: Boolean(row.is_test),
    }));
}

module.exports = {
  insertSearch,
  insertRawResponse,
  markSearchError,
  savePerson,
  applySearchResult,
  loadNormalizedSearch,
  listHistory,
};
