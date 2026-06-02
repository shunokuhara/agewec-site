# AGEWEC 2026 採点ルーブリック（Draft v0.2・日英対訳 / Bilingual）

6観点 × 4段階（0〜3）。各セルは観察できる到達状態を記述した行動記述子。
JA / EN を対にしてあるので、`data-ja` / `data-en` に流し込めば既存の言語トグルでそのまま切り替わります。

採点尺度 / Scale:

- **0** = 不十分／該当しない / Insufficient or N/A
- **1** = 標準 / Standard
- **2** = 良い / Good
- **3** = 非常に良い / Excellent

---

## 観点1. 観光訴求力 / Tourism Appeal

| 点 | 記述子（JA） | Descriptor (EN) |
|---|---|---|
| 0 | 北九州を訪れたいと思わせる要素がほとんどない | Little that makes viewers want to visit Kitakyushu |
| 1 | 北九州の魅力が一定程度伝わる。標準的な観光紹介の水準 | Conveys some appeal; standard tourism-introduction level |
| 2 | 具体的な見どころ・体験が描かれ、明確な訪問動機を喚起する | Depicts concrete attractions and evokes a clear motivation to visit |
| 3 | 「すぐ行きたい」と感じる強い訴求があり、北九州ならではの独自性が際立つ | Strong "I want to go now" pull; Kitakyushu's distinctiveness stands out |

## 観点2. 感情的インパクト / Emotional Impact（SNS共有性を内包 / incl. shareability）

| 点 | 記述子（JA） | Descriptor (EN) |
|---|---|---|
| 0 | 感情的な反応をほとんど引き起こさない | Evokes almost no emotional response |
| 1 | 一定の印象は残すが、感情の動きは弱い | Leaves some impression, but emotional movement is weak |
| 2 | 驚き・郷愁・高揚などの感情を明確に喚起し、記憶に残る | Clearly evokes emotion and is memorable |
| 3 | 強い感情的没入を生み、余韻が残り、他者への共有・推奨を促す | Strong, lasting emotional immersion that prompts sharing |

## 観点3. 物語の一貫性 / Narrative Coherence

| 点 | 記述子（JA） | Descriptor (EN) |
|---|---|---|
| 0 | 構成が断片的で、伝えたいことが不明瞭 | Fragmented structure; the intended message is unclear |
| 1 | 大筋は通っているが、流れや論理に粗がある | The thread holds, but flow or logic is rough |
| 2 | 明確な構成と流れがあり、メッセージが一貫している | Clear structure and flow; consistent message |
| 3 | 主題と構成が緻密に設計され、全体が一つの物語として強く機能する | Tightly designed; the whole works as a single story |

## 観点4. AI自律性 / AI Autonomy

| 点 | 記述子（JA） | Descriptor (EN) |
|---|---|---|
| 0 | AIはほぼ使われず人手中心、またはAIは部分的補助のみ | AI barely used / human-driven, or AI only assists partially |
| 1 | AIを使うが、各工程を人が逐一指示・接続している | AI is used, but a human directs and connects each step |
| 2 | 複数のAI／ツールが連携し、工程の大部分をAIが自律実行している | Multiple AIs/tools coordinate and autonomously run most of the workflow |
| 3 | 計画〜調査〜生成〜編集まで一貫してエージェントが自律実行し、人の介入が最小 | Agents run end to end with minimal human intervention |

## 観点5. ワークフロー設計・再現性 / Workflow Design & Reproducibility

| 点 | 記述子（JA） | Descriptor (EN) |
|---|---|---|
| 0 | ワークフロー説明が乏しく、制作過程を追えない／再現できない | Thin explanation; the process cannot be traced or reproduced |
| 1 | 使用ツールと手順が一通り示されている | Tools and steps are described at a basic level |
| 2 | 各工程・ツール連携・プロンプト等が明確で、第三者が概ね再現できる | Steps, orchestration, and prompts are clear; largely reproducible |
| 3 | 設計が体系的で、エラー処理・反復・役割分担まで含め、高い再現性と工夫が示される | Systematic design with error handling, iteration, and role division |

## 観点6. 技術的独創性 / Technical Creativity & Originality

| 点 | 記述子（JA） | Descriptor (EN) |
|---|---|---|
| 0 | 既存手法の単純な踏襲で、新しさがない | Plain reuse of existing methods; nothing new |
| 1 | 標準的なツール活用にとどまる | Stays at standard tool usage |
| 2 | ツールの組み合わせや表現に明確な工夫・新規性がある | Clear ingenuity or novelty in tool use or expression |
| 3 | 独自のアプローチや予想を超える表現があり、技術・創造の両面で際立つ | Original approach that stands out technically and creatively |

---

## 総合評価 / Overall

- 各観点 0〜3、6観点で **合計 0〜18点**。総合評価は別途入力せず、6観点の合計または重み付き平均で自動算出。
- Each criterion 0–3; **total 0–18**. The overall score is computed from the six criteria (sum or weighted mean), not entered separately.
- 既定は等重み。観光系（1・2・3）と AI系（4・5・6）を 50:50 にする案を推奨 / Default equal weights; a 50:50 balance between tourism (1–3) and AI (4–6) is recommended.

## トグル実装メモ / Toggle implementation

各観点名・各記述子セルを `data-ja` / `data-en` 付きで出力すれば、既存の `toggleLang()`（`script.js`）がENボタンで採点表ごと切り替える。新規JSは不要。セル内には子要素を置かず素のテキストにすること。

```html
<td data-ja="標準的な観光紹介の水準" data-en="Standard tourism-introduction level">標準的な観光紹介の水準</td>
```

## 根拠 / Grounds（要点）

- 分析的・トピック特化・見本例／訓練を伴うルーブリックは採点信頼性を高める: Jonsson & Svingby (2007), *Educational Research Review*, 2(2), 130–144.
- カテゴリ定義の明確さが審査員間一致を左右する: Cicchetti, Showalter & Tyrer (1985), *Applied Psychological Measurement*, 9(1), 31–36.
- 2〜3点尺度は信頼性・妥当性・弁別力が相対的に低く、4点以上で改善し7点付近で頭打ち: Preston & Colman (2000), *Acta Psychologica*, 104(1), 1–15; Lozano, García-Cueto & Muñiz (2008), *Methodology*, 4(2), 73–79.
- 観点を相互に重複させないことで halo effect を避ける。
