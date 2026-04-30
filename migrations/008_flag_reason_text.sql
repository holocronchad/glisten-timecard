-- 2026-04-30 — punches.flag_reason was varchar(64). Several code paths
-- (auto_close_stale_shift, primary_pin_review for Filza, geofence-relaxation)
-- write longer human-readable reasons. Result: 22001 "value too long"
-- crashes on every clock-in that hits those paths. Filza was blocked from
-- clocking in WFH this morning. Widening the column to TEXT removes the
-- length cap entirely — there's no good reason for a length limit on a
-- free-form audit string.

ALTER TABLE timeclock.punches ALTER COLUMN flag_reason TYPE TEXT;

INSERT INTO timeclock.schema_versions (version) VALUES ('008_flag_reason_text')
  ON CONFLICT DO NOTHING;
