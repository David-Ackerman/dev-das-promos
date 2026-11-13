-- Short product name shown in the posts ("Smartwatch Bettdow") instead of the
-- store's long title. Written by the AI with the caption; null = derive it from
-- the title (shortProductName). The site keeps the full title.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS short_title text;
