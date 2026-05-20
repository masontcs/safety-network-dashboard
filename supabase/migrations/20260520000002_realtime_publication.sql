-- Enable Supabase Realtime for AR tables so all connected clients
-- receive live INSERT / UPDATE / DELETE events via WebSocket.

alter publication supabase_realtime add table ar_customers;
alter publication supabase_realtime add table ar_customer_notes;
alter publication supabase_realtime add table ar_customer_assignments;
