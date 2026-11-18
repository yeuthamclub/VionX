-- VionX X01 cost plan F1: grade 1-12 item generation does not need deep reasoning; medium effort
-- cuts output tokens. Kept in sync with packages/ai DEFAULT_TASK_CONFIG by a unit test.
update ops.ai_task_config set effort = 'medium' where task = 'item_generation';
