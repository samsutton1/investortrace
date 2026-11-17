-- Made-up test data only (no real people). Load after schema.sql.
INSERT INTO providers (slug, name, api_base_url, status, notes) VALUES
 ('deepskiptrace','DeepSkipTrace','https://deepskiptrace.com/api/v1','testing','Temporary POC provider. Results for own business only; no resale without a separate agreement.'),
 ('demo_b','Demo Provider B',NULL,'testing','Placeholder for the permanent provider.');
INSERT INTO searches (provider_id, search_type, first_name, last_name, zip, input_key, status, skips_used, completed_at)
 VALUES (1,'name','Jane','Sample','85001','name|jane|sample|85001','match',1,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        (2,'name','Jane','Sample','85001','name|jane|sample|85001','match',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT INTO raw_responses (search_id, endpoint, http_status, body) VALUES
 (1,'POST /search',200,'{"status":"match","people":[{"name":"Jane Sample"}]}'),
 (2,'POST /lookup',200,'{"results":[{"fullName":"Jane Sample"}]}');
INSERT INTO persons (search_id, raw_response_id, provider_person_id, rank, full_name, first_name, last_name, age, is_owner)
 VALUES (1,1,'p-demo-1',1,'Jane Sample','Jane','Sample',52,1),(2,2,'b-demo-1',1,'Jane Sample','Jane','Sample',52,1);
INSERT INTO person_phones (person_id, rank, number, display, phone_type, carrier, disconnected, flagged)
 VALUES (1,1,'6025550100','(602) 555-0100','mobile','Demo Wireless',0,0),
        (2,1,'6025550100','(602) 555-0100','mobile','Demo Wireless',0,0),
        (2,2,'6025550199','(602) 555-0199','landline',NULL,1,0);
INSERT INTO properties (person_id, street, city, state, zip, parcel_number, owned_now, in_foreclosure)
 VALUES (1,'123 Sample St','Phoenix','AZ','85001','000-00-000',1,1);
INSERT INTO property_events (property_id, event_type, event_date, amount_cents, document_type)
 VALUES (1,'loan','2019-06',25000000,'deed of trust'),(1,'foreclosure','2026-09',NULL,'notice of trustee sale');
INSERT INTO skip_ledger (provider_id, search_id, person_id, reason, skips) VALUES (1,1,NULL,'search_hit',1),(2,2,NULL,'search_hit',1);
UPDATE persons SET review_status='verified', reviewed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1;
