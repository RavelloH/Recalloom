-- Search summaries are computed on demand. Remove the derived display copy.
ALTER TABLE search_chunks DROP COLUMN excerpt_projection;
