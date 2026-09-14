ALTER TABLE experts
  ALTER COLUMN daily_publication_limit SET DEFAULT 3,
  ALTER COLUMN voice_profile SET DEFAULT
    '{"description":"От первого лица. Прямо, спокойно и конкретно. Объяснять продукт через путь клиента, продажи и реальную работу бизнеса. Короткие абзацы, живые примеры, без давления.","avoid":"Нейрослоп, канцелярит, обещания гарантированного роста, выдуманные кейсы и цифры, перегруз технологиями, агрессивные продажи.","examples":[]}'::jsonb;

UPDATE experts
SET
  daily_publication_limit = CASE
    WHEN daily_publication_limit = 5 THEN 3
    ELSE daily_publication_limit
  END,
  voice_profile = CASE
    WHEN voice_profile = '{"description":"","avoid":"","examples":[]}'::jsonb
      THEN '{"description":"От первого лица. Прямо, спокойно и конкретно. Объяснять продукт через путь клиента, продажи и реальную работу бизнеса. Короткие абзацы, живые примеры, без давления.","avoid":"Нейрослоп, канцелярит, обещания гарантированного роста, выдуманные кейсы и цифры, перегруз технологиями, агрессивные продажи.","examples":[]}'::jsonb
    ELSE voice_profile
  END;
