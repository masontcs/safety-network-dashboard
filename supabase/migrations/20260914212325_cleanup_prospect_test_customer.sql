-- One-off cleanup: remove the empty test customer created while verifying the prospect-quote
-- flow end-to-end (its profile/quote/job/ticket were already removed via the admin API).
-- Idempotent: affects 0 rows on any environment where this test row never existed.
delete from billing_customers where id = '434dd4ec-cfb2-4c17-b3ee-dacebd27861a';
