-- 評価フォームの2系統化（0003）
--
-- rubric_type:
--   'expert'   … 従来の6観点ルーブリック（各0-3点、合計18点満点）
--   'audience' … 一般視聴者向けアンケート（各1-5点、合計30点満点）
--
-- 追加のみ（既存列の変更・削除はしない）。既存データはすべて 'expert' 扱い。

-- 評価者ごとに、どちらのフォームを表示するかを決める
ALTER TABLE judges ADD COLUMN rubric_type TEXT DEFAULT 'expert';

-- 採点行にも、どちらのフォームで入力されたかを記録する（後から混ぜて集計しないため）
ALTER TABLE scores ADD COLUMN rubric_type TEXT DEFAULT 'expert';

UPDATE judges SET rubric_type = 'expert' WHERE rubric_type IS NULL OR rubric_type = '';
UPDATE scores SET rubric_type = 'expert' WHERE rubric_type IS NULL OR rubric_type = '';

CREATE INDEX IF NOT EXISTS idx_scores_rubric_type ON scores(rubric_type);
