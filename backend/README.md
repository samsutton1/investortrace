# InvestorTrace backend

Minimal Express API for the InvestorTrace proof of concept. All backend code lives in this folder so the repo root stays a static site and the existing Vercel deploy is unchanged.

The server serves `../index.html` at `/` and talks to DeepSkipTrace only from the server. The API key is read from the repo-root `.env` file or from `DEEPSKIPTRACE_KEY` in the environment. It is never sent to the browser, written to git, or printed in logs.

## Setup

- Node.js 22 or newer (this app uses the built-in `node:sqlite` module; no native SQLite addon).
- A DeepSkipTrace key in `/workspace/investortrace/.env` as `DEEPSKIPTRACE_KEY=...` (gitignored), or the same variable in the environment.

```bash
cd backend
npm install
```

## Run

```bash
cd backend
npm start
```

Listens on [http://127.0.0.1:3000](http://127.0.0.1:3000) by default. Override with `PORT` and `HOST`. The frontend is at `/`. Search results are saved to `db/investortrace.db`, which is created from `db/schema.sql` if the file is missing.

## Endpoints

### `POST /api/search`

Name search (optional street) or address search. `test` defaults to `true`.

Name:

```bash
curl -s http://127.0.0.1:3000/api/search \
  -H 'Content-Type: application/json' \
  -d '{"first_name":"Zzyzxtest","last_name":"Qwxnoperson","zip":"85001","test":true}'
```

Address (people come back locked; this server does not auto-unlock them):

```bash
curl -s http://127.0.0.1:3000/api/search \
  -H 'Content-Type: application/json' \
  -d '{"street":"123 Sample St","city":"Phoenix","state":"AZ","test":true}'
```

JSON body:

- Name: `{ "first_name", "last_name", "zip" }` or `{ "first_name", "last_name", "city", "state" }`, optional `street`
- Address: `{ "street", "zip" }` or `{ "street", "city", "state" }`
- Optional: `test` (default `true`), `purpose`

A valid search is forwarded to `POST https://deepskiptrace.com/api/v1/search` and saved into SQLite. The response is provider-agnostic:

```json
{
  "search_id": 1,
  "provider": "deepskiptrace",
  "status": "no_match",
  "skips_used": 0,
  "reused": false,
  "message": "...",
  "people": [
    {
      "id": 1,
      "rank": 1,
      "name": "...",
      "age": 40,
      "deceased": false,
      "is_owner": true,
      "locked": false,
      "phones": [{ "number": "...", "display": "...", "type": "mobile", "carrier": "...", "disconnected": false, "flagged": false }],
      "emails": [],
      "addresses": [],
      "relatives": [],
      "properties": [{ "events": [] }]
    }
  ]
}
```

`status` is `match`, `no_match`, or `error`. Invalid input returns `400`. Out of skips returns `402`. Rate limits return `429`. Provider failures return `502`, with `status: "error"` and a message.

Use only made-up test names during development. A no-match search is free. A hit costs 1 skip. Do not search real lead data.

### `GET /api/account`

Free balance check. Returns account name, remaining skips, and rate limits. Does not include the API key.

```bash
curl -s http://127.0.0.1:3000/api/account
```

### `GET /api/searches`

Search history from the `v_search_history` view, newest first.

```bash
curl -s http://127.0.0.1:3000/api/searches
```

### `GET /api/searches/:id`

The normalized saved result for one search.

```bash
curl -s http://127.0.0.1:3000/api/searches/1
```

## Tests

```bash
cd backend
npm test
```

These tests are offline: they validate input, check that `/` serves `index.html`, and run the save/normalize mapper against a made-up fixture. They do not call DeepSkipTrace.

## Notes

- Address-search matches stay locked. Opening a person is a separate, billable `POST /api/v1/people/{person_id}` call and is not done automatically.
- `*.db`, `.env`, and `node_modules/` are gitignored. Never commit the API key or a database that contains real lead data.
