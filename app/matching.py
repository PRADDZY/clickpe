"""Bounded page contract shared by the API and exported n8n Postgres node."""

MAX_DECISIONS = 400

# Named parameters are converted to n8n's $1/$2 by scripts/Sync-Workflows.py.
PAGE_QUERY = """
WITH policies AS MATERIALIZED (
  SELECT rp.product_id,s.snapshot_id::text,s.rules FROM run_policy rp
  JOIN policy_snapshot s ON s.snapshot_id=rp.snapshot_id WHERE rp.run_id=%(run_id)s
), bounds AS (
  SELECT LEAST(200,GREATEST(1,400/GREATEST(COUNT(*),1)))::int AS page_size,
         COUNT(*) AS product_count FROM policies
), page AS MATERIALIZED (
  SELECT user_id,monthly_income,credit_score,employment_status,age
  FROM batch_user WHERE run_id=%(run_id)s AND user_id>%(cursor)s
  ORDER BY user_id LIMIT (SELECT page_size+1 FROM bounds)
), numbered AS (
  SELECT *,ROW_NUMBER() OVER (ORDER BY user_id) AS seq FROM page
)
SELECT %(run_id)s::text AS run_id,%(cursor)s::text AS cursor_user_id,
  (SELECT product_count FROM bounds) AS product_count,
  COALESCE(jsonb_agg(to_jsonb(n)-'seq' || jsonb_build_object('products',
    (SELECT COALESCE(jsonb_agg(p ORDER BY product_id),'[]'::jsonb) FROM policies p)) ORDER BY user_id)
    FILTER (WHERE seq<=(SELECT page_size FROM bounds)),'[]'::jsonb) AS users,
  COUNT(*)>(SELECT page_size FROM bounds) AS has_more,
  COALESCE(MAX(user_id) FILTER (WHERE seq<=(SELECT page_size FROM bounds)),%(cursor)s::text) AS last_user_id
FROM numbered n
"""
