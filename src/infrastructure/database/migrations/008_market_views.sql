CREATE OR REPLACE VIEW market_top_accounts AS
SELECT
  username,
  post_count,
  question_count,
  total_engagement,
  peak_engagement,
  score,
  last_post_at,
  updated_at
FROM market_accounts
ORDER BY score DESC, last_post_at DESC NULLS LAST
LIMIT 50;

CREATE OR REPLACE VIEW market_top_questions AS
SELECT
  id,
  username,
  text,
  post_url,
  query,
  like_count,
  reply_count,
  repost_count,
  quote_count,
  posted_at,
  (like_count + reply_count * 2 + repost_count * 3 + quote_count * 3) AS engagement_score
FROM market_posts
WHERE position(chr(63) in text) > 0
ORDER BY engagement_score DESC, posted_at DESC NULLS LAST
LIMIT 100;
