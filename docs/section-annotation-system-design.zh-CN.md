# Beatmap Lens 分段标注系统 v1 修订设计稿

版本：1.3

状态：已验收

日期：2026-08-04

适用范围：Inspector 私有的本地分段标注工作区

基线：`8fff17f` 及此前三个分段标注提交

本文是原《Beatmap Lens Section Annotation v1 — Detailed Specification》的修订版系统设计。
未在本文明确修改的源文件身份、时间坐标、播放、渲染、正例语义和本地存储决策继续有效。
本文已完成设计验收；具体实现需另行授权，并按第 13 节分阶段落地。

## 1. 结论与修订范围

系统仍然是一个 Chromium-first、local-only、单专家使用的研究标注工具。核心目标不是维护一套不可推翻的“真理”，而是可靠保存专家在某一时刻、依据某一套判断语义所作出的可修订观测。

本次采用以下方向：

| 议题 | 决定 |
| --- | --- |
| 已完成 chart 留有离屏草稿时仍能导出旧 gold | 必须修复；release 同时检查整个 dataset 的 meaningful drafts |
| Foundation exemplar 指向可编辑或可删除的 gold | 取消 live 外键；exemplar 角色归属于 gold annotation 本身 |
| gold 是否不可变 | 否；gold 是当前专家观测，可以编辑或删除 |
| Foundation 是否不可变 | 只有已写入的内容寻址快照字节不可覆盖；当前 Foundation 可以通过后继 revision 演进 |
| candidate tag | v1 暂不实现；Foundation tag 只有 `active` 和 `retired` |
| Codex 打标 | Codex 是 annotation provenance／producer，不是 section tag 或 tag status |
| discard | 必须提供；当前任务一次点击放弃全部未提交标注内容，不修改 canonical gold |
| lane 区域拖选 | 必须提供；普通拖动只表达起点和终点 |
| stable note reference 性能 | 必须修复；删除冗余的逐 note 行哈希，以精确 source identity 和规范字段定位 |
| 整体性能边界 | 按真实标注旅程设预算；先修打开、拖选、草稿和重复校验，不为理论规模盲目加缓存或 Worker |
| 多标签页并发 | 明确不支持，不加锁、不广播、不处理 last-writer race |
| 数据卫生 | 只保留保证研究结果可解释、可恢复、可导出的必要约束 |

本设计额外纳入两个低成本的一致性修正：

- future-version sidecar 的只读状态优先于旧草稿冲突状态。
- 只修改 range、note 或 judgment note 时保留原 annotation 的 Foundation pin；只有新增或改变标签/示例角色时才采用当前 Foundation。

## 2. 目标、成功标准与非目标

### 2.1 目标

1. 从现有 catalog manifest 和用户选择的 `.osu` corpus 批量建立可浏览任务队列。
2. 在单张谱面中快速创建时间范围、选择 note、添加或移除标签、设置 salience，并显式保存为 gold。
3. 所有未提交操作通过 IndexedDB 热草稿恢复；切任务、切工作区和刷新不应轻易丢失工作。
4. 专家可以随时修订或删除 gold，也可以给 gold 增加、改变或移除 exemplar 角色。
5. tag 的语义与 annotation 的来源正交；Codex 产出的判断使用 active tag，并在 prediction record 上记录 producer。
6. release 只包含没有未决草稿的 complete canonical gold，不导出旧的完成状态。
7. 在当前真实 corpus 和稠密 4K–7K 支持范围内，首次进入、切换谱面、拖选、热草稿和播放都满足第 2.3 节的可感知性能预算。
8. 所有 annotation 类型、存储和实现继续留在 Inspector 内部，不改变 `packages/beatmap-lens` 公共 API。

### 2.2 明确不做

- 不做多专家、多用户、多标签页或云同步。
- 不做 Web Locks、BroadcastChannel、服务端数据库或跨文件事务。
- 不做 gold event sourcing、永久审计链、tombstone 或自动 merge。
- 不把 Foundation 或 gold 描述成客观真理。
- 当前实施阶段不生成 Codex prediction；只保留并说明已有 prediction provenance/review contract。
- 不做自动分段、负样本推导或模型特征导出。
- 不做 `.osz` 批处理、波形 UI、Canvas/WebGL 重写。
- 不做 Worker、WASM、持久化 parsed-chart cache、通用虚拟列表或复杂 range tree，除非真实测量越过第 10.5 节的升级阈值。
- 不为超出有效 `.osu` 基线的假想坏输入增加恢复层。
- 不引入新的运行时依赖、服务、账户、API key 或配置项。

### 2.3 真实场景性能预算

性能以专家完成标注的实际路径为边界，而不是以某个孤立函数的理论复杂度为目标：

```text
进入工作区 ──► 打开／切换谱面 ──► 连续播放、定位与拖选 ──► hot draft
                                      │                         │
                                      └──── 添加／移除标签 ─────┘
                                                                  │
                                                                  ▼
                                                        显式 canonical save
                                                                  │
                                                                  ▼
                                                           偶发 release
```

优先级依次为：不丢工作、连续交互不阻塞、切图延迟可预测、首次加载可接受；release 是低频冷路径，不以牺牲编辑路径为代价优化。

当前验收基线使用 122 张已映射真实谱面，总计约 7.1 MiB、245,165 个 notes；其中最密图约 5,857 个 notes、169,524 bytes。绝对时间只用于同机浏览器手工验收，不作为易受机器差异影响的 CI 硬断言。

| 场景 | 代表输入 | 目标 | 失败信号 |
| --- | --- | --- | --- |
| 进入工作区 | 当前 122 张本地谱面 | 到首张可编辑的 P95 小于 500ms | 用户持续等待空工作区或 loading 阻塞 |
| 切换谱面 | 最密真实图，不计 audio decode | P95 小于 150ms | 切换时出现可感知冻结 |
| lane／overview 拖选 | 最密图连续激进拖动 10 秒 | 60Hz 下交互 P95 小于 16.7ms，且无 Inspector 导致的 50ms long task | 拖动落后于指针或松手后跳变 |
| hot autosave | pointerup、切任务或切模式 | pointerup 后 300ms 内持久化；导航边界必须 await flush | 中途范围被写入、返回后恢复旧状态或丢失最后操作 |
| 范围内 notes 列表 | 误拖到全曲 | 同时挂载的列表行不超过 200，仍显示总数并可分页 | 一次建立数千 checkbox DOM |
| 连续播放 | 最密图默认速度与 30px/s，各 30 秒 | 无由 Inspector 引起的持续掉帧或 50ms long task | 几何移动平滑但外围响应式 UI 拖慢整帧 |

添加标签、移除标签、Commit/Update 和 discard 的步骤数也属于性能：常用语义操作不得因后台校验、队列刷新或 autosave 增加额外确认与等待。

## 3. 系统边界与数据流

系统保留五类数据，但它们承担不同职责：

1. `dataset.json`：dataset 身份、catalog 来源和当前 Foundation 指针。
2. `foundations/`：内容寻址的判断语义快照，只描述 policy 和 tag 语义。
3. `annotations/`：每个精确 `.osu` source hash 对应一个 canonical 当前观测文档。
4. IndexedDB：目录 handle、偏好和可丢弃的 hot autosave draft。
5. `exports/`：由 complete 且无未决草稿的 canonical gold 生成的 release。

```text
catalog manifest ─┐
                  ├─► 任务加载器 ─► BeatmapSession ─► AnnotateWorkspace
.osu corpus ──────┘          │              │              │
                             │              │              ├─► IndexedDB 草稿
                             │              │              │
                             ▼              └──────────────┴─► DatasetDirectory
                         任务队列                                │
                                                                ├─► annotations/
                                                                ├─► foundations/
                                                                └─► release builder ─► exports/
```

没有组件把 IndexedDB 草稿当作 canonical 数据；也没有可变 annotation index。任务状态继续由 catalog、sidecar 扫描和草稿枚举派生。

## 4. 语义模型

### 4.1 Gold 是可修订观测

- 每条 gold 表示专家对一个时间范围和一组明确 note 的当前判断。
- gold 可以新增、编辑和删除；删除后系统不保留产品级永久历史。
- 缺失标签仍不表示负例。
- 同一 section 可以有多个标签，每个标签独立拥有 salience。
- `salience = 2` 表示明显、主导、具有诊断性；`salience = 1` 表示存在但为支持性、混合、局部或过渡性。
- salience 不是信心、难度、质量或模型概率。

### 4.2 Foundation 是版本化判断语义

Foundation 负责说明“专家在这次判断中如何使用标签”，不负责保存观测实例。

- 每个已写入的 Foundation 文件仍以精确字节 SHA-256 内容寻址，不允许覆盖同名文件。
- `dataset.json.currentFoundation` 指向当前使用的 revision。
- gold 继续 pin 它被解释时所用的精确 Foundation digest。
- tag 只有 `active` 和 `retired`；v1 不实现 candidate tag 或 candidate activation。
- catalog category 只是 suggestion，不会自动进入 Foundation tag registry。
- 原 v1 的全局 policy 和已建立 tag 定义规则保持不变；本次不扩大为任意语义重写。
- exemplar 不再位于 `FoundationTagV1`，因此专家观测不会因为进入 Foundation 而永久冻结。

“历史 Foundation 字节不可覆盖”只用于可复现性，不等于“专家判断永远不可修订”。

### 4.3 Exemplar 是 gold 的角色

新增 Inspector-private 概念 `GoldExemplarRoleV1`，包含：

| 字段 | 规则 |
| --- | --- |
| `tagId` | 该示例针对的 tag |
| `kind` | `strong`、`weak` 或 `counterexample` |

`GoldAnnotationV1` 新增按 `tagId` 唯一排序的 `exemplarRoles` 数组。

约束：

- `strong` 和 `weak` 的 `tagId` 必须同时存在于该 gold 的 labels。
- `counterexample` 的 `tagId` 必须不存在于该 gold 的 labels，但必须是该 gold 所 pin Foundation 中的 active tag。
- counterexample 是专家显式添加的角色，不能从普通“没有该标签”自动推导。
- 同一 gold 可以针对多个 tag 拥有 exemplar 角色，但同一 `tagId` 只能有一个 kind。
- 改标签时，UI 自动移除已不兼容的 exemplar role；底层 validator 仍拒绝任何残留矛盾。
- 删除 gold 时，exemplar role 随该对象一起删除，不产生悬空引用。
- promotion、换 kind 和移除 role 都先进入当前 annotation draft，再通过同一次 canonical save 提交。

Foundation 详情中的 exemplar 数量和列表只在用户展开详情时按 canonical sidecar 派生，不再保存第二份索引，也不做后台常驻扫描。release row 直接携带 gold 的 `exemplarRoles`，但不会把 counterexample 自动转换成普通负样本。

### 4.4 Tag 状态与 annotation 来源正交

`candidate` 不再承担任何 tag 或 annotation 语义。系统明确分开两条轴：

| 轴 | 值 | 含义 |
| --- | --- | --- |
| Tag 状态 | `active` / `retired` | 这个语义标签现在能否用于新判断 |
| Annotation provenance | human / Codex | 这次 section 判断是谁产生的 |

本次移除的是 candidate tag。range 内“与选区相交、等待专家取舍的 notes”仍可在实现内部称为 candidate notes，但 UI 优先称为“范围内 notes”，避免与标签或来源混淆。

人类专家创建的 canonical gold 位于 `annotations[]`。Codex 产生的一次打标位于 `predictions[]`，使用同一 Foundation 中的 active tag；其来源由 prediction record 的 `producerId`、`skillVersion` 和 `modelVersion` 表达，而不是给 section 添加 `candidate` 标签。

Codex prediction 的处理规则：

- 初始 `reviewStatus` 为 `pending`。
- 专家拒绝时改为 `rejected`，不产生 gold。
- 专家接受或修改时创建一条新的 human gold，并通过 `derivedFromPredictionIds` 指向原 prediction。
- 原 Codex prediction 保持不变并改为 `reviewed`，可通过 `resultingGoldAnnotationId` 指向生成的 gold。
- prediction 的 confidence 与 tag salience 分开；confidence 是生产者估计，salience 仍描述 pattern feature 的显著程度。
- release 仍只输出 human gold，不直接输出 Codex predictions。

UI 如果未来显示 Codex 结果，文案使用“来源：Codex”或“Codex 建议”，绝不显示“candidate 标签”。当前四个实施阶段不增加 Codex 生成入口。

### 4.5 被拒绝的方案

不采用以下方案：

- 锁定被 promotion 的 gold，禁止后续编辑或删除。
- 在 Foundation 内继续保存指向 live annotation 的外键，并为编辑、删除做全库 backlink 检查。
- 把 promotion 当时的整份 gold 复制成永久 Foundation exemplar 快照，再维护跨文件 reconcile。

这些方案都会引入不符合研究项目定位的永久历史、跨文件同步或不可编辑目标。把 role 放在 gold 内部是最小且完整的方案。

## 5. 数据契约

### 5.1 Dataset 与 source identity

`DatasetManifestV1`、目录结构和 source identity 保持原设计：

- source SHA-256 来自解码前的精确 `.osu` bytes。
- BOM 或换行变化产生不同 source identity。
- sidecar 不保存本地路径、原始 `.osu` 文本或 audio bytes。
- 所有时间使用 source milliseconds，所有范围使用半开区间 `[startMs, endMs)`。
- `chartEndMs` 是最后一个 note endpoint 加一毫秒。

### 5.2 Stable note reference

`StableNoteRefV1` 表示“在某一份精确 `.osu` source 中稳定”，而不是“跨 source 修改稳定”。持久化字段修订为：

- `sourceLine`
- `column`
- `kind`
- `startMs`
- `endMs`

删除 `objectSha256`。annotation document 已保存整份 source 的 SHA-256 和 byte length，draft 以同一 source SHA 为 key，release row 也携带 source identity；在 source 不匹配就拒绝加载、且不做 fuzzy migration 的边界内，逐 HitObject 行哈希不能增加定位能力。

runtime note ID 仍只用于 UI。加载时先验证精确 source identity，再匹配 `sourceLine + column + kind + startMs + endMs` 全部五个字段。`sourceLine` 负责跨 session 定位，其他字段验证 normalizer 的解释并让 release 在没有 runtime ID 时仍可读。

### 5.3 Foundation tag

`FoundationTagV1` 保留：

- `id`、`displayName`
- `status: active | retired`
- `definition`
- inclusion/exclusion cues
- aliases
- salience clarification

删除 `candidate` status 和 `exemplars` 字段。Foundation canonical serialization 不再排序 exemplar reference。

catalog suggestion 不会预先创建 Foundation tag。专家第一次使用一个尚不存在的 suggestion 或 custom tag 时，必须填写 canonical ID、display name、definition 和至少一条 inclusion cue；系统随后直接写入一个包含新 active tag 的 Foundation revision，不经过 candidate 中间态。

### 5.4 Gold annotation

每条 gold 保存：

- UUID `id`
- 非空 `range`
- 非空、可解析的 `noteRefs`
- 非空 `labels`
- `exemplarRoles`，允许为空
- 精确 Foundation pin
- annotator ID、创建和更新时间
- 可选 judgment note
- prediction provenance

Gold 的 annotator 是完成最终判断的人类专家。即使它来自 Codex 建议，来源链也通过 `derivedFromPredictionIds` 表达，不把 gold 的 annotator 改写成 Codex。

编辑 pin 规则：

1. 只修改 range、note membership、judgment note，或只移除 exemplar role：保留原 Foundation pin。
2. 新增或改变 label、新增或改变 exemplar role：采用当前 Foundation，并要求相关 tag 当前为 active。
3. 自动清理不兼容 role 后再进行 validation。
4. 已 retired 的旧标签仍可由旧 Foundation pin 解释；无关编辑不会被迫迁移到当前 Foundation。

### 5.5 Codex prediction provenance

`SilverPredictionV1` 表示一次尚未成为 human gold 的 Codex section 判断。它保存：

- 独立 prediction UUID
- range、note refs、active tag labels 和 Foundation pin
- `producerId`，用于标识 Codex producer／agent
- `skillVersion` 和 `modelVersion`
- 可选 prediction confidence
- `reviewStatus: pending | reviewed | rejected`
- 可选 `resultingGoldAnnotationId`
- 创建时间

这里的 labels 与 human gold 使用相同 tag ID 和 salience 语义，不存在 candidate label。annotation provenance 属于整个 prediction record，不属于某个 label，也不复用 `.osu` 的 source identity 字段。

当前 Inspector 不生成 prediction；这部分是现有 future-facing contract 的明确语义边界。

### 5.6 Annotation document

一张谱面仍对应一个 sidecar：

`annotations/{sourceSha256}.section-annotations.v1.json`

文档继续包含：

- source、seedContext、reviewState 和 revision
- 当前 `annotations[]`
- future-facing `predictions[]`
- 不进入训练导出的 `reviewNotes[]`

add、update、delete 或 complete 都继续执行确定性序列化、base revision/digest 比较、文件写入、read-back、hash 和完整 validation。完整 workflow validation 只在 `DatasetDirectory.saveAnnotation` 存储边界执行一次；Vue 可以做输入级即时反馈，但不重复 source inspect、ref resolve 或整份 document validation。

### 5.7 Hot autosave draft

`AnnotationDraft` 继续以 `datasetId + sourceSha256` 为 key，保存：

- canonical base revision 和 digest
- range 与尚未解析成功的原始输入文本
- 最终选择的 note refs 和 manual exclusions 可恢复信息
- labels、salience 和 `exemplarRoles`
- judgment note、review-note composer、editing annotation ID
- 当前 session undo stack
- playhead 和 visual speed

其中 range、note、label、salience、exemplar role、judgment note、review-note text 的变化属于 meaningful draft。playhead、视觉速度和视口移动只作为已有草稿的恢复位置；它们单独变化时不创建 draft。

仅点击“编辑”并把一个 canonical gold 原样载入右栏不创建 draft；第一次实际内容变化才进入 `draft-pending`。

## 6. 批量任务加载与队列

首次使用流程保持：

1. 设置本地 pseudonymous annotator ID。
2. 选择或创建 dataset directory。
3. 选择 catalog manifest。
4. 选择 corpus directory。
5. 加载或创建初始 Foundation。

任务加载器继续从 manifest path 中去掉 `corpus.root`，再通过已授权 directory handle 解析相对路径。绝对路径只存在于内存。

队列状态为：

- unseen
- draft
- in-progress
- complete
- missing-source
- save-conflict
- save-error
- readonly-future

加载队列时只调用一次 `SessionStore.listDrafts(datasetId)` 建立 draft map，不再对 122 个任务逐个串行读取 IndexedDB。每个任务仍只做 source inspect；stable note refs 只在真正打开单张谱面时生成。

当前 corpus 的完整读取、解析和整文件 SHA 是约 0.2 秒量级的本地暖缓存工作，不为它引入专用 metadata parser、Worker、全量 chart cache 或渐进式 queue 状态机。queue scan 不生成 stable refs，也不保留全部 parsed charts。

只有 Chromium 实测“选择 workspace 到首张可编辑”的 P95 超过 500ms，或 corpus 扩大到当前约十倍／迁移到明显更慢的文件系统时，才把队列升级为：先显示 catalog shell、优先解析将要打开的 task、其余任务以最多四路并发在后台补齐。该升级不改变 canonical 数据格式。

future-version sidecar 始终显示 `readonly-future`。即使存在旧 v1 草稿，也不能被降级为 conflict 或进入可写 session；用户可以显式放弃那个本地旧草稿。

## 7. 草稿状态、切换与 discard

### 7.1 状态模型

```text
clean
  │ range / note / label / role / text 改变
  ▼
draft-pending ──160ms（非拖动编辑）──► draft-saved
  │                         │
  ├─切任务/切模式/导出──────┘  先 await flush
  │
  ├─commit/update──────────► canonical-saving
  │                              ├─成功─► clean
  │                              └─失败─► conflict/error，draft 保留
  │
  └─discard────────────────► clean，canonical 不变
```

继续使用现有 160ms debounce，不增加新状态存储层。

连续 pointer gesture 是一个交互事务：首次越过 2px 阈值后进入 `draft-pending`，但 pointermove 期间不启动 IndexedDB debounce。最新坐标由 `requestAnimationFrame` 每帧最多应用一次，queue 只在 clean 首次转为 draft 时更新一次；pointerup 或 pointercancel 应用最终预览并立即持久化。这样不会把一个拖选过程中的暂态范围保存成可恢复草稿。

必须主动 flush 的边界：

- 打开另一个 task。
- Annotate 切换到 Inspect。
- release preview 和 confirm。
- canonical commit/update/delete/complete。
- lane 或 overview 拖选的 pointerup／pointercancel。
- 页面进入 hidden 状态时做 best-effort flush。

不增加 `beforeunload` 弹窗，也不在 pointermove 中写 IndexedDB 或 canonical 文件。

### 7.2 一次点击 discard

右栏 Commit/Update 控件旁增加一个符合 Inspector 40px hit target 的 quiet “放弃草稿”按钮。仅在当前任务存在 meaningful draft 时显示，不使用 modal 二次确认。

点击后按顺序执行：

1. 暂停播放并取消尚未执行的 draft timer。
2. 等待同一 task 已在执行的 IndexedDB draft write 完成，避免旧写入在删除后重新出现。
3. 删除当前 `datasetId + sourceSha256` 的 IndexedDB draft；删除失败则保持当前编辑器不变并显示错误。
4. 删除成功后清空未提交的 range、note membership、labels、salience、exemplar roles、judgment note、review-note composer、edit target 和 undo stack。
5. queue 恢复为 canonical document 的 `complete` / `in-progress`；没有 sidecar 时恢复 `unseen`。
6. 保留当前 task、playhead、visual speed、Music 设置和 canonical annotation list。
7. 在当前 playhead 创建新的默认一秒编辑区。

编辑已有 gold 后 discard 的含义是“退出本次修改”；原 gold、原角色和 Foundation 都不变。

离屏草稿不在 queue row 放危险小按钮。用户先打开 draft task，再点击放弃，共两步。

## 8. Release 与 dataset-wide draft gate

release preview 和 confirm 都执行同一套核心检查：

1. flush 当前草稿。
2. 扫描 canonical sidecars。
3. 通过 `SessionStore.listDrafts(datasetId)` 枚举整个 dataset 的 meaningful drafts。
4. 计算 `complete canonical source hashes ∩ meaningful draft source hashes`。
5. 交集非空时阻止 preview/confirm，并报告受影响任务数量。
6. 只属于 unseen 或 in-progress chart 的草稿不阻止其他 complete chart 导出，因为它们本来不会进入 release。

`buildGoldRelease` 必须接收 `DatasetDirectory` 和 `SessionStore`，draft 检查不是可选参数，也不由 Vue 传入一个活动任务布尔值。`flushDraft` 同时等待尚未完成的 draft write，之后才能调用 release builder。

confirm 使用 preview 的 `exportedAt` 重新构建 artifact；canonical 内容或 draft blockers 有变化时刷新 preview，要求再次确认。

release 包含：

- complete canonical gold rows，包括 `exemplarRoles`
- release manifest 和统计
- gold 所 pin 的精确 Foundation copies

release 排除：

- draft、in-progress document、prediction、review note
- 路径、原始 `.osu`、audio 和模型特征

写出顺序采用最小防护：先写 Foundation copies，再写 gold JSONL，最后写 `release.json`。不增加 staging directory、事务或自动清理；没有 manifest 的目录不视为完成 release。

## 9. Annotation 工作区与交互

### 9.1 布局

继续遵循 Inspector 的 precision-paper 设计语言：

- 顶栏：dataset、chart、queue progress、save/draft 状态。
- 左栏：任务队列、catalog hints、chart facts、只读 source。
- 中央：暗色 falling-note viewport、overview timeline、playback strip。
- 右栏：selection editor、标签与 salience、exemplar roles、existing annotations、Foundation details、commit/discard。
- 小于 920px 时继续使用 Source / Preview / Details 切换，保持 40px hit target。

### 9.2 Lane 区域的最小拖选

主 viewport 与 overview、手工输入共用同一个 range 和 note-selection 状态，不创建第二份 selection store。

| 操作 | 结果 |
| --- | --- |
| 空白 lane 单击，移动不足 2px | seek，不创建 draft |
| 空白 lane 普通拖动 | 用按下点和当前点创建或替换 selection |
| `Shift` + lane 拖动 | 保留原垂直 scrub，只移动 playhead |
| `Alt/Option` + 普通拖动 | 创建 selection，但不吸附 |
| 点击 note | toggle note，不触发 lane 拖选 |
| 点击 saved annotation band | seek 到 annotation |

实现规则：

- pointerdown 时固定本次手势为 `select` 或 `scrub`，并暂停播放。
- selection 使用固定的起始 playhead，将 viewport Y 反算为 source time。
- 正反方向拖动都排序为 `[startMs, endMs)`；上下边界 clamp 到 chart 范围。
- 越过 2px 阈值且首次形成有效范围时只记录一次 undo。
- 复用 `createTimelineRange` 和 `applyTimelineRange`，因此吸附、manual exclusions、范围内 note 重算和 hot draft 语义保持一致。
- pointermove 只覆盖“本帧最后坐标”，通过单个 `requestAnimationFrame` 更新 selection preview；不得为每个原始事件重复复制 queue、失效 release preview 或重置 autosave timer。
- 首次 meaningful move 只执行一次 clean → draft 状态转换；pointerup／pointercancel 应用最后一帧并立即 flush。
- viewport 内不增加 selection body move、边缘 handles 或最近边缘 resize。移动和精调继续由 overview timeline 与手工输入承担。

提示文案为：`拖动选择 · Shift 拖动定位 · Alt 自由放置`。默认 cursor 改为 crosshair。

### 9.3 Note、标签、角色与保存

快速流程：

1. seek、scrub 或 lane 拖动定位区域。
2. 在 viewport、overview 或输入框调整起止时间。
3. 点击 note 改变最终 membership。
4. 添加一个或多个 active tag，设置各自 salience。
5. 可选地给当前 gold 添加 exemplar role。
6. 按 Enter 或点击 Commit/Update 保存。
7. 保存成功后清空编辑器，playhead 留在范围末端。

右栏必须支持：

- 添加 active tag。
- 从 draft 移除 tag。
- 改变 salience。
- 添加、换 kind、移除 exemplar role。
- add/update/delete gold。
- undo 当前 session 编辑。
- 一次点击 discard。
- 显式 mark chart complete。

范围内 notes 的勾选列表始终显示总数，但同时只挂载最多 200 行，通过简单上一页／下一页访问其余 notes。该上限防止误拖到全曲时创建数千 checkbox DOM；不引入通用虚拟列表依赖。列表内部文案使用“范围内 notes”，不使用可能与 tag 状态混淆的 candidate。

tag 创建流程不再包含 candidate：

1. suggestion 已对应 active tag 时，直接加入当前 draft。
2. suggestion 或 custom tag 尚不存在时，专家填写定义与 inclusion cue。
3. 系统写入并验证包含该 active tag 的新 Foundation revision。
4. 更新并验证 `dataset.json.currentFoundation`，再把 tag 加入 annotation draft。

retired tag 只能解释旧 annotation，不能重新用于新标签。

### 9.4 Playback 与渲染

渲染数据结构保持原设计：

- audio 可选；synthetic clock 独立完成整个流程。
- Music 开启时 media clock authoritative，切换时保持 source time。
- visual speed 不改变 clock 或 playback rate。
- 三个 viewport 高度的 note buffer、keyed SVG、单 note-group transform。
- overview 使用固定分辨率 density path，不按总 note 数创建 DOM。
- chart/session 切换时释放 object URL 和 controller。

默认 240px/s、三个 viewport 高度的 buffer 在当前 corpus 最坏约包含 173 个 notes；即使 30px/s 的极端慢速约为 1,220 个，尚不足以证明需要 Canvas/WebGL 重写。

性能统计必须覆盖相邻 `requestAnimationFrame` 间隔、Vue DOM patch 和浏览器 paint。只测 reactive assignment 或 scene controller 回调耗时不能作为“播放顺滑”的证据；低频 instrumentation 最多以 4Hz 更新 UI，时间文字等非几何状态无需跟随每个 RAF 重绘。

当前阶段不预先拆分播放组件。只有第 2.3 节的 30 秒真实 trace 出现 Inspector 导致的持续掉帧或 50ms long task，才把稳定 note scene 隔离为小组件：buffer revision 变化时更新 note DOM，普通 RAF 只更新外层 transform，并把非几何 UI 限频。几何移动仍保持逐帧。

## 10. 真实工作流性能边界

### 10.1 判断原则与当前量级

性能决策先回答“专家是否会等待或失去操作反馈”，再回答某个循环是否能从 `O(N)` 变成 `O(log N)`。当前真实基线为：

- 122 张映射谱面，总计约 7.1 MiB、245,165 个 notes。
- 最密图约 5,857 个 notes、169,524 bytes。
- 本地暖缓存原型中，全部谱面读取、parse/normalize 和整文件 SHA 合计约为 0.2 秒量级。
- 旧 stable-ref 创建在最密图上约需 1.8 秒并产生约 134 MiB RSS 增量，是实际热点。
- 对最密图做一次线性 range filter 约为 0.03ms；误拖全曲后创建 5,857 行 DOM 才是交互风险。

因此当前优化顺序为：删除冗余的 per-note digest、消除重复 load/validation、合并拖动事件并限制 DOM；不因为看到线性扫描就引入新索引，也不因为队列有 122 项就缓存全部 chart。

### 10.2 Source-bound note identity

整份 `.osu` bytes 的 SHA-256 和 byte length 是 source 的唯一真实性边界。`StableNoteRefV1` 不再保存 `objectSha256`，只保存第 5.2 节的五个规范字段。

单张谱面 session 的流程为：

1. 读取 source bytes 后只做一次 decode、parse、normalize 和整文件 SHA。
2. 从 normalized notes 同步建立 `runtime note ID → StableNoteRefV1` map，供编辑和 hot draft 使用。
3. 同时建立 `五字段 tuple key → ManiaNote` index，供 sidecar、draft 和 prediction/review-note 恢复。
4. workflow validation 将 annotations、predictions 和 review notes 的 refs 去重后一次解析；每条 ref 仍核对全部五字段。
5. runtime ID 绝不写入 sidecar，source hash 不一致时仍直接失败，不尝试跨 source 迁移。

复杂度为：

- source inspect：`O(B + N)`。
- ref map 创建：`O(N)`，不读取 source lines、不做 per-note crypto。
- 已持久化 refs 解析：`O(N + R)`。
- hot autosave：`O(selected notes)`，不重新扫描 source bytes 或整张 chart。

其中 `B` 是 source bytes，`N` 是 notes，`R` 是 document 中去重后的 persisted refs。删除 `objectSha256` 后不再需要 lazy ref、行字节缓存或跨 session hash cache；简单的 eager map 更小也更容易验证。

### 10.3 单遍 load、validation 与 save

同一次用户操作中的完整工作不得重复执行：

- queue load 一次枚举 dataset drafts，再按 source SHA 派生全部状态；不做逐任务 IndexedDB transaction。
- `loadBeatmapSession` 的 inspected source、parsed chart 和 note index 直接传给 workflow validator；validator 不重新 decode、parse、normalize 或计算 source SHA。
- 同一 document pin 的 Foundation 按 digest 去重读取；同一个 `DatasetDirectory` session 可按 Foundation SHA 缓存已完成验证的 Promise。缓存只复用内容寻址文件的当前字节，不代表 Foundation 语义永久不可修订，也不跨 workspace 持久化。
- 删除 workflow validation 后额外的 gold-only ref resolve。
- canonical save 只在 `DatasetDirectory.saveAnnotation` 边界执行一次完整 workflow validation；Vue 负责形成用户意图，不提前重复整套校验。
- write 后的 read-back、canonical parse、digest 和 revision 校验继续保留，因为它验证实际落盘结果，不属于重复工作。
- release 复用一次 sidecar scan 和一次 draft map；它是低频冷路径，不建立常驻 mutable index。

不缓存全部 122 张 parsed charts。当前原型表明那会以数百 MiB heap/RSS 换取不显著的本地切图收益；source parse 留在真正打开的单图 session 中。

### 10.4 交互事务与 DOM 边界

lane 和 overview 的连续 drag 共享同一性能语义：

1. 原始 pointermove 只记录最新位置。
2. 一个 `requestAnimationFrame` 最多应用一次 range/selection preview。
3. clean → draft、queue 状态和 release-preview invalidation 在一次手势中各最多发生一次。
4. pointermove 不触发 IndexedDB；pointerup／pointercancel 才形成最终 draft 并立即持久化。
5. 切任务、切模式或窗口 hidden 时，若手势仍存在，先 finalize 最后预览再 flush。
6. 范围内 notes 列表每页最多 200 行；viewport note 高亮仍可覆盖完整 selection。

不把 `rangeCandidates` 换成 interval tree。当前约 6,000 notes 的线性筛选远低于一帧预算，增加另一套索引只会扩大 selection 状态和测试面。已有 `ManiaNoteTimeIndex` 继续服务 viewport buffer 和吸附，不为理论一致性强迫所有查询走同一个抽象。

### 10.5 以测量触发的升级

以下优化只有达到触发条件后才进入后续设计；当前 v1 不预先实现：

| 触发条件 | 首选升级 | 仍不直接采用 |
| --- | --- | --- |
| 当前 corpus 到首图可编辑的 P95 超过 500ms | catalog shell 先显示；目标 task 优先；其余最多四路后台扫描 | 无限 `Promise.all`、持久化 parsed cache |
| corpus 扩大约十倍或位于慢速外接／网络文件系统，且 trace 显示 parse CPU 主导 | 先做渐进队列；仍不足时才评估 parse Worker | 仅凭文件数直接上 Worker/WASM |
| 最密图 30 秒播放出现 Inspector 导致的持续掉帧或 50ms long task | 隔离稳定 note scene，RAF 只改 transform，非几何 UI 限频 | Canvas/WebGL 全面重写 |
| 专家经常整曲选择且 200 行分页仍妨碍 note 取舍 | 基于现有分页做固定窗口 | 引入通用虚拟列表依赖 |

性能指标必须来自 Chromium 的真实工作流 trace。微基准用于定位数量级，但不能替代包含 Vue patch、DOM 和 paint 的端到端测量。

## 11. 适度的数据卫生

### 11.1 必须阻止

- source hash 或 byte length 不匹配。
- note ref 无法在精确 source 中解析，或任一规范字段与 normalized note 不匹配。
- range 非法、为空或选中 note 不与范围相交。
- gold 没有 note 或 label。
- label/role 在所 pin Foundation 中无效。
- strong/weak/counterexample role 与同一 gold labels 矛盾。
- canonical write/read-back/hash/parse 失败。
- complete chart 存在 meaningful draft 时构建 release。
- future contract 被 v1 代码覆盖。

### 11.2 只警告，不阻止

- annotation overlap。
- same-tag overlap。
- 不同 gold 对同一局部给出不同观测。
- 专家后来修改或删除先前被视为 exemplar 的 gold。

最后一项不再构成 referential-integrity 错误，因为 role 与 gold 同生共灭。

### 11.3 明确不保证

- 多标签页写入原子性。
- 全 dataset 跨文件事务。
- 防篡改审计历史。
- 自动修复人工修改过的 canonical JSON。
- 任意未来 schema 的迁移。
- release directory 的事务式清理。

## 12. 验证与验收

### 12.1 自动测试

Draft 与 release：

- `listDrafts(datasetId)` 不混入其他 dataset。
- complete A 有离屏 draft、当前打开 clean B 时，preview 和 confirm 都被阻止。
- preview 后才产生 draft，confirm 会重新检查。
- in-progress draft 不阻止 clean complete chart 导出。
- discard 删除 draft，恢复 queue canonical 状态，不改变 gold。
- future sidecar 加旧 draft 仍然只读。

Gold 与 exemplar role：

- promotion、换 kind、移除 role 都通过 annotation draft/canonical save。
- strong/weak 必须有对应 label；counterexample 必须显式且没有对应 label。
- 改标签自动删除不兼容 role；底层 validator 拒绝手工构造的矛盾对象。
- 删除 gold 后没有残留 role 或 Foundation backlink。
- deterministic JSON round-trip 保持 role 排序。
- release 只携带 complete canonical roles。

Tag 与 provenance：

- Foundation validator 只接受 `active` 和 `retired`，不再创建 candidate tag。
- catalog suggestion 不会自动写入 Foundation；首次使用时直接创建 active tag。
- Codex prediction 只能使用其 pinned Foundation 中的 active tag。
- `producerId`、`skillVersion` 和 `modelVersion` 表达 Codex 来源，labels 中不存在 candidate。
- review/reject/accept 后的 prediction 与 human gold provenance 双向一致。

Lane selection：

- Y 到 source time 的判断线、上下边界和 clamp。
- 正向、反向、吸附、Alt free placement 和零长度拖动。
- 普通 drag 改 range，Shift-drag 只 scrub。
- note click 和 saved-band click 不误触 lane selection。
- 同一帧内多次 pointermove 只应用最后坐标；一次连续拖动只生成一个 undo step 和一次 clean → draft 转换。
- pointermove 不写 IndexedDB；pointerup／pointercancel 持久化最终范围且可在重载后恢复。
- 全曲范围仍只挂载一页最多 200 行 notes，总数和翻页后的 toggle 结果正确。

Stable refs：

- canonical round-trip 不再包含 `objectSha256`。
- runtime ID 改变仍可解析。
- source SHA／byte length 或五个规范字段中任一个不匹配仍阻止保存。
- 同一 source 中语义相同但 source line 不同的 notes 仍可精确区分。
- gold、prediction、review-note refs 共用一个 index 并在一个 batch 中全部验证。

生命周期性能不变量：

- queue load 对一个 dataset 只调用一次 `listDrafts`。
- 打开单图只 inspect source 一次，workflow validation 不重新 parse/hash。
- 同一 Foundation SHA 在一个 `DatasetDirectory` session 中只完成一次读取验证。
- 一次 canonical save 只在 storage boundary 执行一次完整 workflow validation，write/read-back 校验仍执行。
- hot autosave 的工作量只与最终 selected notes 数量相关，不读取 source bytes。

回归：

- synthetic/media playback、loop、Music 切换和 object URL 生命周期。
- 4K–7K buffered rendering、overview density 和 keyboard shortcuts。
- active tag 直接创建、review note、completion 与 deterministic release。

### 12.2 浏览器手工验收

使用 Chromium 和当前 catalog：

1. 加载全部 122 个当前可解析任务并打开一个稠密 chart，记录到首张可编辑与切图 P95。
2. lane 拖选、note toggle、添加两个不同 salience 标签；确认拖动跟手且只有 pointerup 后写入最终草稿。
3. 切换任务并返回，草稿精确恢复。
4. 切到 Inspect 再返回，草稿仍存在。
5. 编辑已有 gold 后一次点击 discard，canonical gold 保持原样。
6. 添加 exemplar role、保存、重载、改 kind、移除并再次保存。
7. complete A 留草稿、切到 B，确认 release 被阻止；回到 A discard 后可导出。
8. Music 有/无两种情况下完成选区播放和保存。
9. 将最密图范围扩到全曲，确认显示总 note 数、列表 DOM 不超过 200 行且可分页编辑。
10. 在最密集真实 chart 上分别以默认速度和 30px/s 执行 30 秒连续播放与激进 scrub；用 Chromium Performance trace 检查相邻 RAF、Vue patch、DOM 和 paint，按第 2.3 节预算验收。

### 12.3 命令

- `pnpm check`
- `pnpm exec vitest bench --run benchmarks/inspector-annotation.bench.ts`
- `pnpm --filter @pulsefield/beatmap-lens-inspector build`
- `pnpm dev`

## 13. 可独立合并的实施顺序

整体预计影响 12 个以上现有文件和若干测试文件，超过八文件；原因是合同、持久化、UI 和验证必须同步，但不增加服务或公共 API。每一阶段完成后系统都保持可用。

### 阶段一：dataset-wide draft gate 与 discard

范围：

- `session-store.ts`：增加 `listDrafts(datasetId)` 和共享 meaningful-draft 判定。
- `task-queue.ts`：一次性读取 draft map；future read-only 优先。
- `release.ts`：complete canonical 与 dataset drafts 的交集 gate。
- `AnnotateWorkspace.vue`：flush 边界、一次点击 discard、release 文案和模式切换。
- 对应 session-store、task-queue、release 测试。

完成标准：离屏 complete draft 不可能进入 release；任何当前 annotation draft 都可以一次点击放弃。

该阶段不改 canonical schema，可以单独回滚。

### 阶段二：统一 v1 canonical 语义与 source-bound note identity

范围：

- `contracts.ts`：将 tag status 收窄为 `active | retired`，新增 `GoldExemplarRoleV1`，从 Foundation tag 移除 exemplar refs，并从 `StableNoteRefV1` 删除 `objectSha256`。
- `foundation.ts`：删除 candidate bootstrap/activation；首次使用 suggestion/custom tag 时直接创建 active tag。
- `stable-note-ref.ts`：以五字段 tuple 同步创建和解析 source-bound refs，不拆 source lines、不做 per-note digest。
- `canonical-json.ts`：确定性排序 roles 和修订后的 note refs。
- `quality.ts`：promotion/换 kind/remove 改为 annotation document 操作。
- `validation.ts`：验证同一 gold 内的 role/label/Foundation 关系，并在精确 source 下核对 note ref 五字段。
- `beatmap-session.ts`：创建和编辑 gold 时保留或清理 roles，并执行 Foundation pin 规则。
- `session-store.ts` 与 workspace：draft、discard 和 UI 支持 roles。
- `release.ts`：release row 携带 roles 和修订后的 refs。
- contract、quality、directory、release 测试。
- 新增 ADR，明确 gold 是可修订观测、Codex 是 prediction provenance、note ref 受整份 source identity 约束，并取代 ADR 0002 中的 candidate/exemplar/line-digest 决策。

完成标准：编辑或删除 gold 不会产生跨文件悬空；所有 exemplar 变更都可 hot autosave、save 和 discard；catalog suggestion 可直接建立 active tag；系统中不再出现 candidate tag 或 per-note `objectSha256`；runtime ID 变化后 ref 仍可在精确 source 中恢复。

该阶段假设当前 v1 尚无必须兼容的外部 dataset。实现前只读扫描实际 dataset：若存在 candidate Foundation tags、非空 legacy Foundation exemplars 或包含 `objectSha256` 的 sidecar／release，则先停在阶段一，由用户决定是否需要一次性迁移。旧 note refs 可以通过删除冗余字段做确定性迁移，但不在产品中预先加入通用迁移框架或永久双格式 reader。

### 阶段三：lane 两端点拖选与交互事务边界

范围：

- `AnnotateWorkspace.vue`：`select | scrub` 手势分流、单 RAF 合并、幂等 dirty/queue 转换、pointerup flush，以及范围内 notes 的 200 行分页。
- `buffered-scene.ts`：viewport Y 到 source time 的纯函数。
- `style.css`：cursor 和提示。
- buffered-scene、timeline-range、selection gesture 和分页测试。

完成标准：普通 drag 创建/替换 selection，Shift-drag scrub，note click 不误触；一次手势只有一个 undo、一次 clean → draft 和一次最终持久化；全曲范围不挂载超过 200 行 notes；draft 可恢复。

不改变持久化 schema，可独立回滚。

### 阶段四：单遍生命周期与真实性能验收

范围：

- `source-identity.ts`、`validation.ts`、`beatmap-session.ts`：复用一次 inspected source 和一个 document ref index，删除重复 parse/hash/resolve。
- `dataset-directory.ts`：同一 session 按 Foundation SHA 复用已验证 Promise，并只在 storage boundary 做一次完整 save validation。
- `AnnotateWorkspace.vue`：删除重复的 UI 完整 workflow validation；把帧指标改为相邻 RAF 和低频 UI 汇报。
- `task-queue.ts`：验证每个 dataset 只批量读取一次 drafts，不保留全部 parsed charts。
- 新增 `benchmarks/inspector-annotation.bench.ts`，覆盖 queue 数量级、密集图 session open、ref create/resolve 和 hot-draft build；浏览器 trace 覆盖 Vue patch、DOM 和 paint。
- 对应生命周期调用计数测试和现有回归测试。

完成标准：load、save 和 release 没有重复完整 validation；当前 corpus 满足第 2.3 节预算；`pnpm check` 全部通过。若 30 秒播放 trace 未达标，同阶段只采用第 10.5 节的 note-scene 隔离和非几何 UI 限频，不升级到 Canvas/WebGL。

不改变阶段二已经确定的数据格式，可直接代码回滚。

## 14. 风险、回滚与前提

### 14.1 最脆弱前提

本设计依赖“一个专家、一个 Chromium tab、本地约百张有效 `.osu`、专家通常标注几秒到几十秒 section、当前 v1 尚无必须保持兼容的外部 release dataset”。

- 如果改为多 tab，preview 与写出之间仍可能出现 last-writer race，届时必须重新引入锁或协调。
- 如果已有不可丢弃的 candidate/Foundation exemplar/旧 note-ref 数据，阶段二不能直接修改 v1 schema，必须先执行经用户确认的一次性迁移或改用新 contract version。
- 如果 corpus 扩大约十倍、位于慢速文件系统，或工作区首次可编辑 P95 超过 500ms，按第 10.5 节先升级渐进队列，而不是继续维持当前全量前置加载。
- 如果专家经常整曲选择或长期使用 30px/s，200 行分页继续保留，playback note-scene 隔离从触发式优化升级为必要实现。
- 如果未来 normalizer 改变五字段语义或同一 HitObject 的展开规则，必须升级 `normalizerId`／contract；当前 v1 不尝试 fuzzy migration。

### 14.2 回滚

- 阶段一、三、四不改变 canonical schema，直接回退代码即可。
- 阶段二同时改变 tag/exemplar 和 stable-note-ref schema；在真实 dataset 写入前必须保留 dataset 目录副本，若回滚则恢复该副本和旧 Inspector 代码。
- 新 Foundation snapshot 若因中途失败未成为 current，可以留在 `foundations/`，不需要清理。
- canonical save 失败继续保留 IndexedDB draft；discard 永远不删除 canonical sidecar。

## 15. 对外实体变化

- 公共 package API：`+0`
- 新服务：`+0`
- 新依赖：`+0`
- 新配置、环境变量、命令：`+0`
- 新 Inspector-private 接口：`SessionStore.listDrafts(datasetId)`、`GoldExemplarRoleV1`
- 复用的 provenance 接口：`SilverPredictionV1.producerId`、`skillVersion`、`modelVersion`
- canonical 变化：gold 增加 `exemplarRoles`；Foundation tag 移除 `candidate` status 和 `exemplars`；`StableNoteRefV1` 移除冗余 `objectSha256`

推荐按上述四个阶段实施，不扩展到并发控制或完整历史系统。
