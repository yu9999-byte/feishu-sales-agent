BEGIN;

ALTER TABLE playbook_optimization_reviews
  DROP CONSTRAINT IF EXISTS
    playbook_optimization_reviews_tenant_id_candidate_id_fkey;

ALTER TABLE playbook_optimization_reviews
  ADD CONSTRAINT playbook_optimization_reviews_tenant_id_candidate_id_fkey
  FOREIGN KEY (tenant_id, candidate_id)
  REFERENCES playbook_optimization_candidates(tenant_id, id)
  ON DELETE CASCADE;

ALTER TABLE playbook_optimization_reviews
  DROP CONSTRAINT IF EXISTS
    playbook_optimization_reviews_tenant_id_reviewer_member_id_fkey;

ALTER TABLE playbook_optimization_reviews
  ADD CONSTRAINT playbook_optimization_reviews_tenant_id_reviewer_member_id_fkey
  FOREIGN KEY (tenant_id, reviewer_member_id)
  REFERENCES tenant_members(tenant_id, id)
  ON DELETE CASCADE;

COMMIT;
