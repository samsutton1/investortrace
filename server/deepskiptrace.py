"""DeepSkipTrace adapter for InvestorTrace (proof of concept).

Reads the API key from the DEEPSKIPTRACE_KEY environment variable or from a local
.env file (never committed). Calls the API, saves the raw answer, and fills the
normalized tables in db/schema.sql.

Usage:
  python server/deepskiptrace.py account
  python server/deepskiptrace.py search --first Jane --last Sample --zip 85001 [--test]
"""
import argparse, json, os, sqlite3, sys, urllib.request, urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = "https://deepskiptrace.com/api/v1"
DB_PATH = Path(os.environ.get("INVESTORTRACE_DB", ROOT / "db" / "investortrace.db"))
SLUG = "deepskiptrace"


def load_key():
    key = os.environ.get("DEEPSKIPTRACE_KEY")
    env = ROOT / ".env"
    if not key and env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("DEEPSKIPTRACE_KEY="):
                key = line.split("=", 1)[1].strip()
    if not key:
        sys.exit("DEEPSKIPTRACE_KEY is not set (env var or .env)")
    return key


def call(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bearer {load_key()}",
                                          "Content-Type": "application/json",
                                          "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def db():
    new = not DB_PATH.exists()
    c = sqlite3.connect(DB_PATH)
    c.execute("PRAGMA foreign_keys = ON")
    if new:
        c.executescript((ROOT / "db" / "schema.sql").read_text())
    c.execute("INSERT OR IGNORE INTO providers (slug, name, api_base_url, status) VALUES (?,?,?, 'testing')",
              (SLUG, "DeepSkipTrace", BASE))
    return c


def b(v):
    return None if v is None else int(bool(v))


def cents(v):
    return None if v is None else int(round(float(v) * 100))


def save_person(c, search_id, raw_id, p, rank):
    r = p.get("report") or {}
    cur = c.execute("""INSERT INTO persons (search_id, raw_response_id, provider_person_id, rank, full_name,
        first_name, last_name, aliases, age, deceased, likely_deceased, date_of_death, is_owner,
        last_seen_at_address, locked) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (search_id, raw_id, p.get("person_id"), p.get("index", rank), p.get("name"),
         r.get("first_name"), r.get("last_name"), json.dumps(r.get("aliases") or []), p.get("age"),
         b(p.get("deceased")), b(p.get("likely_deceased")), r.get("date_of_death"), b(p.get("owner")),
         p.get("last_seen_here"), b(p.get("locked")) or 0))
    pid = cur.lastrowid
    for i, ph in enumerate(r.get("phones") or [], 1):
        c.execute("""INSERT INTO person_phones (person_id, rank, number, display, phone_type, carrier,
            disconnected, business, flagged, first_seen, last_seen) VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (pid, i, ph.get("number"), ph.get("display"), ph.get("type"), ph.get("carrier"),
             b(ph.get("disconnected")), b(ph.get("business")), b(ph.get("flagged")),
             ph.get("first_seen"), ph.get("last_seen")))
    for i, em in enumerate(r.get("emails") or [], 1):
        c.execute("INSERT INTO person_emails (person_id, rank, email, inactive, first_seen, last_seen) VALUES (?,?,?,?,?,?)",
                  (pid, i, em.get("address"), b(em.get("inactive")), em.get("first_seen"), em.get("last_seen")))
    for i, a in enumerate(r.get("addresses") or [], 1):
        c.execute("""INSERT INTO person_addresses (person_id, rank, street, city, state, zip, county,
            first_seen, last_seen, owned_now, owned_before) VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (pid, i, a.get("street"), a.get("city"), a.get("state"), a.get("zip"), a.get("county"),
             a.get("first_seen"), a.get("last_seen"), b(a.get("owned")), b(a.get("owned_before"))))
    for i, rel in enumerate(r.get("relatives") or [], 1):
        c.execute("""INSERT INTO person_relatives (person_id, rank, relationship, relation_group, full_name,
            first_name, last_name, age, deceased, likely_deceased, address, phones, emails)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (pid, i, rel.get("relationship"), rel.get("group"), rel.get("name"), rel.get("first_name"),
             rel.get("last_name"), rel.get("age"), b(rel.get("deceased")), b(rel.get("likely_deceased")),
             json.dumps(rel.get("address")), json.dumps(rel.get("phones") or []), json.dumps(rel.get("emails") or [])))
    for pr in r.get("properties") or []:
        addr = pr.get("address") or {}
        if isinstance(addr, str):
            addr = {"street": addr}
        cur = c.execute("""INSERT INTO properties (person_id, street, city, state, zip, county, parcel_number,
            mailing_address, owners, owned_now, estimated_value_cents, assessed_value_cents, assessed_year,
            living_sqft, lot_sqft, bedrooms, bathrooms, year_built, in_foreclosure, extra)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (pid, addr.get("street"), addr.get("city"), addr.get("state"), addr.get("zip"), pr.get("county"),
             pr.get("parcel_number"), json.dumps(pr.get("mailing_address")), json.dumps(pr.get("owners") or []),
             b(pr.get("owned_now")), cents(pr.get("market_value")), cents(pr.get("assessed_value")),
             pr.get("assessed_year"), pr.get("building_sqft"), pr.get("lot_sqft"), pr.get("bedrooms"),
             pr.get("bathrooms"), pr.get("year_built"), b(pr.get("foreclosure")),
             json.dumps({"foreclosure": pr.get("foreclosure")})))
        prop_id = cur.lastrowid
        for s in pr.get("sales") or []:
            c.execute("INSERT INTO property_events (property_id, event_type, event_date, amount_cents, party, document_type, details) VALUES (?,?,?,?,?,?,?)",
                      (prop_id, "sale", s.get("date"), cents(s.get("price")), s.get("buyer"), s.get("deed_type"), json.dumps(s)))
        for l in pr.get("loans") or []:
            c.execute("INSERT INTO property_events (property_id, event_type, event_date, amount_cents, document_type, details) VALUES (?,?,?,?,?,?)",
                      (prop_id, "loan", l.get("date"), cents(l.get("amount")), l.get("type"), json.dumps(l)))


def search(args):
    body = {k: v for k, v in {"first_name": args.first, "last_name": args.last, "street": args.street,
            "city": args.city, "state": args.state, "zip": args.zip, "phone": args.phone,
            "email": args.email}.items() if v}
    kind = "phone" if args.phone else "email" if args.email else "name" if args.last else "address"
    key = "|".join([kind] + [str(body[k]).strip().lower() for k in sorted(body)])
    c = db()
    prov = c.execute("SELECT id FROM providers WHERE slug=?", (SLUG,)).fetchone()[0]
    sid = c.execute("""INSERT INTO searches (provider_id, search_type, first_name, last_name, street, city, state,
        zip, phone, email, input_key, request_json, purpose, is_test, source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'api')""",
        (prov, kind, args.first, args.last, args.street, args.city, args.state, args.zip, args.phone,
         args.email, key, json.dumps(body), args.purpose, int(args.test))).lastrowid
    status, text = call("POST", "/search", body)
    raw_id = c.execute("INSERT INTO raw_responses (search_id, endpoint, http_status, body) VALUES (?,?,?,?)",
                       (sid, "POST /api/v1/search", status, text)).lastrowid
    try:
        data = json.loads(text)
    except ValueError:
        data = {}
    if status == 200:
        st = "match" if data.get("people") else "no_match"
        c.execute("UPDATE searches SET status=?, provider_search_id=?, skips_used=?, reused=?, completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
                  (st, data.get("search_id"), data.get("skips_used") or 0, b(data.get("reused")) or 0, sid))
        for i, p in enumerate(data.get("people") or [], 1):
            save_person(c, sid, raw_id, p, i)
        if data.get("skips_used"):
            c.execute("INSERT INTO skip_ledger (provider_id, search_id, reason, skips) VALUES (?,?, 'search_hit', ?)",
                      (prov, sid, data["skips_used"]))
    else:
        c.execute("UPDATE searches SET status='error', error_message=?, completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
                  (text[:500], sid))
    c.commit()
    return sid, status, data


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("account")
    s = sub.add_parser("search")
    for f in ["first", "last", "street", "city", "state", "zip", "phone", "email"]:
        s.add_argument("--" + f)
    s.add_argument("--purpose", default="testing")
    s.add_argument("--test", action="store_true")
    a = ap.parse_args()
    if a.cmd == "account":
        st, text = call("GET", "/account")
        print(st, text)
    else:
        sid, st, data = search(a)
        print(json.dumps({"search_row": sid, "http_status": st, "status": data.get("status"),
                          "skips_used": data.get("skips_used"), "result_count": data.get("result_count"),
                          "people": len(data.get("people") or []), "message": data.get("message"),
                          "keys": sorted(data.keys())}, indent=1))
