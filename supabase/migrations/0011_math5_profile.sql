-- ADR-001: add Toán 5 as a ninth library profile (outside the 8 launch libraries of CONTRACT D6).
-- Numbered 0011 so it does not collide with 0010 on the open x01-retry-rejected branch.
insert into library.subject_profiles
  (grade, subject, title_vi, template_share, group_share, written_share, read_aloud_default, tts_lang, image_level, item_type_mix)
values
  (5, 'math',   'Toán 5',             0.45, 0.00, 0.00, false, 'vi', 'MEDIUM',
   '{"single_choice":0.30,"numeric":0.35,"fill_blank":0.10,"multi_choice":0.05,"true_false":0.05,"ordering":0.05,"matching":0.05,"picture_choice":0.05}');
