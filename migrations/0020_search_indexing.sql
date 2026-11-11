-- Round 6 (ADR 0019): 1 = the member agreed that search engines may list the public page. Default 0 (noindex).
ALTER TABLE members ADD COLUMN search_indexable INTEGER NOT NULL DEFAULT 0;
