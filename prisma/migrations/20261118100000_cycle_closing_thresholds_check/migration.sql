-- WF-C4 / WF-C5: the closing-condition thresholds of a cycle (src/domain/closing-conditions.ts) are
-- read from this row, never hard-coded (Q-03 open). A negative value is a configuration error the
-- domain refuses at runtime; this constraint keeps it out of the database in the first place.
ALTER TABLE "cycle" ADD CONSTRAINT "cycle_closing_thresholds_non_negative"
  CHECK ("min_performance_goals" >= 0 AND "required_weight_sum" >= 0 AND "min_development_goals" >= 0);
