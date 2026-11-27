CREATE TABLE IF NOT EXISTS board_clipboards (
  browser_key text NOT NULL,
  account_key text NOT NULL,
  pieces jsonb NOT NULL,
  PRIMARY KEY (browser_key, account_key)
);
