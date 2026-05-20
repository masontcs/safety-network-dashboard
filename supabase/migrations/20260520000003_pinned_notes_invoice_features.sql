-- ─── 1. Pinned notes support ──────────────────────────────────────────────────
ALTER TABLE ar_customer_notes
  ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS ar_customer_notes_pinned_idx
  ON ar_customer_notes (customer_id, is_pinned)
  WHERE is_pinned = true;

-- ─── 2. Invoice status column ─────────────────────────────────────────────────
ALTER TABLE ar_invoices
  ADD COLUMN IF NOT EXISTS invoice_status text NULL
  CHECK (invoice_status IS NULL OR invoice_status IN (
    'disputed', 'short_pay', 'payment_pending', 'lien_filed', 'in_legal', 'write_off'
  ));

-- ─── 3. Invoice notes table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ar_invoice_notes (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id uuid        NOT NULL REFERENCES ar_invoices(id) ON DELETE CASCADE,
  content    text        NOT NULL,
  created_by uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ar_invoice_notes_invoice_id_idx
  ON ar_invoice_notes (invoice_id);

ALTER TABLE ar_invoice_notes ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read invoice notes
CREATE POLICY "authenticated_read_invoice_notes" ON ar_invoice_notes
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- AR admins (admin + ar_manager) can write invoice notes
CREATE POLICY "ar_admin_write_invoice_notes" ON ar_invoice_notes
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role IN ('admin', 'ar_manager')
    )
  );

-- ─── 4. Add invoice notes to realtime ─────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE ar_invoice_notes;
