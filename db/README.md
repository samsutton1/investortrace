# InvestorTrace database

Proof-of-concept schema for storing skip-trace searches from any provider.

- **Engine:** SQLite (one file, no server). Moves to Postgres later with small type changes, noted at the top of `schema.sql`.
- **Create a test database:** `sqlite3 db/investortrace.db < db/schema.sql`, then optionally `sqlite3 db/investortrace.db < db/sample_data.sql` for made-up test rows.
- **Provider-agnostic:** each provider's raw answer is saved untouched in `raw_responses`; an adapter per provider fills the normalized tables, so results line up side by side.
- **Never commit a real database file or real lead data.** `*.db` is meant to stay local.

## Tables

| Table | Holds |
| --- | --- |
| `providers` | Each data vendor (DeepSkipTrace now, a permissible provider later), status, cost, and terms notes |
| `searches` | Every lookup: type (name, address, phone, email), the input, a normalized `input_key` for comparing providers, status, skips and cost, test flag, timestamps |
| `batches` | Bulk CSV uploads; each record becomes a search |
| `raw_responses` | The provider's JSON exactly as received, per call |
| `persons` | Normalized people from a search: name, aliases, age, deceased flags, owner of searched address, locked/unlocked, and a **verified / discarded** review status |
| `person_phones` | Number, type, carrier, disconnected, business, flagged, seen dates, DNC/litigator scrub status, review status |
| `person_emails` | Address, inactive flag, seen dates, review status |
| `person_addresses` | Address history with county, seen dates, owned now / owned before |
| `person_relatives` | Relatives and associates with their phones and emails |
| `properties` | Properties tied to a person: APN, mailing address, owners, value, size, year built, foreclosure flag |
| `property_events` | Sales, loans, and foreclosure filings |
| `skip_ledger` | Every billable unit (search hit, unlock, refill), for spend tracking |

## Views

- `v_search_history`: searches newest first with people found, skips, and cost
- `v_provider_comparison`: the same input across providers, one row per phone
- `v_provider_stats`: hit rate and spend per provider
