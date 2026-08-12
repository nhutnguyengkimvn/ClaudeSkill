# SPEC — BE: xử lý `cleared_keys` khi save case section

**Ngày:** 2026-08-12 · **Owner:** BE · **Cặp với:** `spec-fe-cleared-keys.md`

## 1. Vấn đề

Save section hiện tại là **merge / PATCH**: key nào không có trong payload thì BE bỏ
qua. Field bị ẩn theo điều kiện thì Form.io xoá key khỏi payload → BE bỏ qua → **giá
trị cũ nằm lại trong DB**.

Ví dụ: `social_history_screening_alcohol` đổi từ `Yes` sang `No`, nhưng
`..._alcohol_counseling_exclusive_duration` vẫn còn `10` trong DB. Field này quyết định
billing (rule 5–15 phút) → là lỗi data, ảnh hưởng claim.

FE không thể tự giải quyết bằng config Form.io (đã thử 2 cách, fail). Hợp đồng mới:
FE gửi kèm danh sách key đã bị clear, BE xoá đúng những key đó.

## 2. Contract (BE nhận)

```jsonc
PATCH /api/cases/{caseId}/sections/{sectionKey}
{
  "data": { /* như hiện tại */ },
  "cleared_keys": ["social_history_screening_alcohol_counseling_exclusive_duration", "..."],
  "meta": { "section_key": "social_history_screening", "form_version": "<optional>" }
}
```

- `cleared_keys` **optional** để tương thích client cũ:
  - **absent** → hành vi y như hiện tại (không clear gì). Bắt buộc giữ nhánh này để
    deploy BE trước FE được.
  - `[]` → không có gì clear (client mới, không field nào ẩn).
  - có phần tử → xử lý theo §3.
- Validate: array of string, tối đa **500** phần tử, mỗi key match
  `^[a-z0-9_]{1,120}$`. Sai format → **400**, không silently ignore.

## 3. Semantics

Thứ tự xử lý trong **cùng một transaction**:

1. Merge `data` như hiện tại.
2. Lọc `cleared_keys` theo §4 (bỏ key không hợp lệ, ghi log).
3. Với mỗi key còn lại → set về rỗng:
   - Lưu dạng JSONB map → **xoá key** khỏi object.
   - Lưu dạng column → set **NULL**.
   Chọn một cách và ghi rõ vào code comment; phải nhất quán với cách "chưa nhập bao giờ"
   được biểu diễn, để downstream (MER, Progress Note) không phân biệt được 2 trạng thái.
4. Recompute derived (§5).
5. Ghi audit (§6).

Quy tắc phụ:

- Key xuất hiện **cả trong `data` và `cleared_keys`** → `data` thắng, bỏ khỏi danh sách
  clear, log `cleared_ignored: reason=present_in_data`. Đây là **tín hiệu FE chưa strip
  key khỏi `data`**: Form.io bản mới KHÔNG tự xoá value của field đang ẩn dù
  `clearOnHide: true` (đo được trên preview local), nên FE phải tự strip — xem spec FE
  §3. Nếu reason này xuất hiện thường xuyên thì alert: bug FE đang làm cơ chế clear
  vô hiệu.
- Clear một key vốn đã rỗng → no-op, không lỗi. Idempotent.
- **Không cascade**: BE chỉ clear đúng list FE gửi, không tự suy diễn thêm field con.
  Ngoại lệ duy nhất là derived value ở §5.

## 4. Lọc bắt buộc — 3 lớp (không bỏ lớp nào)

Một key chỉ được clear khi thoả **cả 3**:

1. **Thuộc section đang save** (`sectionKey` trong URL / `meta.section_key`). Key của
   section khác → ignore + log. Chặn việc save một section xoá data section khác.
2. **Role của caller có quyền ghi** field đó theo role config (`EDIT` / `RES`). PSS gửi
   lên key doctor-only → ignore + log. FE đã lọc theo `roleApplied`, nhưng đây là lớp
   phòng thủ độc lập — nếu FE có bug thì đây là thứ chặn việc xoá sạch dữ liệu bác sĩ.
3. **Tồn tại trong form schema** của template + version đó. Key lạ / key đã bị xoá khỏi
   template → ignore + log.

Key bị loại: **ignore + log**, không throw. Một key rác không được làm fail cả lần save.

## 5. Derived value

Nếu key bị clear là input của một field tính toán thì phải xử lý, không thì con số
tính toán còn lại sẽ mâu thuẫn với input rỗng:

- `social_history_screening_alcohol_score` (CAGE score) — tính từ 4 câu CAGE.
- `social_history_screening_summary_statement` — sinh từ `..._alcohol_overall_assessment`.
- `test_requirements_depression_screening_score`, `sdoh_hits_score` — cùng pattern.
- Cờ điều kiện billing dựa trên `..._counseling_exclusive_duration`.
- Master Encounter Report / Progress Note đã generate: đánh dấu cần regenerate.

Cách làm: sau khi clear, recompute lại các derived field của section theo đúng công thức
đang có; nếu mọi input đều rỗng → derived cũng về rỗng.

## 6. Audit & traceability

- Ghi activity-log entry như các save khác (`updated the case on <Section>`), thêm
  danh sách key đã clear.
- Log riêng cho field liên quan billing (2 field `*_counseling_exclusive_duration`):
  ai clear, lúc nào, giá trị cũ là gì. Cần cho việc đối chiếu claim về sau.
- Ghi cả những key bị **ignore** ở §4 kèm lý do — đây là tín hiệu FE có bug.

## 7. Response

Trả về data của section sau khi đã merge + clear + recompute, để FE reconcile mà không
phải gọi thêm GET:

```jsonc
{
  "section_key": "social_history_screening",
  "data": { /* state sau cùng */ },
  "cleared_applied": ["..."],          // đã clear thật
  "cleared_ignored": [ { "key": "...", "reason": "role_not_writable" } ]
}
```

## 8. Backfill data cũ (task riêng, không nằm trong endpoint)

Case hiện có đã mang sẵn giá trị stale — fix endpoint **không** dọn được lịch sử. Cần 1
script one-off, chạy dry-run trước rồi mới apply:

> Với mỗi case: nếu gate không phải `Yes` mà dependent còn value → clear dependent + log
> (case_id, key, giá trị cũ).

Bảng dependency cho **Social History Screening** (đọc từ cột AD của
`Wellness_HRA` / `Wellness Lite_HRA`, đã bỏ các row `content` vì không lưu data):

| Gate | Điều kiện hiện | Dependent keys |
|---|---|---|
| `social_history_screening_alcohol` | `Yes` | `..._alcohol_yes`, 4 câu CAGE (`..._have_you_ever_felt_you_needed_to_cut_down_on_your_drinking`, `..._have_people_annoyed_you_by_criticizing_your_drinking`, `..._have_you_ever_felt_guilty_about_drinking`, `..._have_you_ever_felt_you_needed_a_drink_first_thing_in_the_morning_...`), `..._alcohol_score`, `..._alcohol_overall_assessment`, `..._summary_statement`, `..._counseling_provided`, `..._alcohol_counseling_exclusive_duration` |
| `social_history_screening_counseling_provided` | `Yes` | `..._alcohol_topics_discussed`, `..._alcohol_counseling_notes` |
| `social_history_screening_alcohol_topics_discussed` | `Other` | `..._alcohol_topics_discussed_other` |
| `social_history_screening_smoke` | `Yes` | `..._smoke_yes`, `..._smoke_yes_years`, `..._quitting_smoking`, `..._tobacco_use_status`, `..._secondhand_smoke`, `..._tobacco_counseling_provided` |
| `social_history_screening_secondhand_smoke` | `Yes` | `..._secondhand_smoke_yes` |
| `social_history_screening_tobacco_counseling_provided` | `Yes` | `..._tobacco_counseling_exclusive_duration`, `..._tobacco_topics_discussed` |
| `social_history_screening_tobacco_topics_discussed` | `Other` | `..._tobacco_topics_discussed_other` |
| `social_history_screening_drugs` | `Yes` | `..._drugs_yes` |
| `social_history_screening_drugs_yes` | `Other:` | `..._drugs_yes_other` |

Bảng này **chỉ mới cover Social History**. Các section khác (Medications, Medical
History, Depression Screening, Functional Safety, Opt-In Consent…) có cùng pattern —
cần quét cột AD của từng tab để lấy đủ trước khi chạy backfill toàn bộ. Cách quét:
`additional_component_props JSON` (cột AD) → `conditional.when` là gate,
`field_key` (cột O) là dependent.

Ưu tiên chạy trước cho 2 field billing:
`social_history_screening_alcohol_counseling_exclusive_duration`,
`social_history_screening_tobacco_counseling_exclusive_duration`.

## 9. Acceptance criteria

1. `cleared_keys` absent → kết quả **giống hệt** hành vi hiện tại (regression test cho
   client cũ).
2. `cleared_keys: []` → không clear gì, không lỗi.
3. Gửi duration trong `cleared_keys` → DB về rỗng; GET lại không còn giá trị.
4. Gửi cùng request 2 lần → kết quả giống nhau (idempotent).
5. Role PSS gửi key doctor-only → **không** bị clear, có log `cleared_ignored`.
6. Gửi key của section khác → không bị clear, có log.
7. Gửi key không tồn tại trong schema → không bị clear, có log, HTTP vẫn 200.
8. `cleared_keys` có 501 phần tử hoặc key sai charset → **400**.
9. Clear 4 câu CAGE → `..._alcohol_score` được recompute về rỗng/0, không giữ điểm cũ.
10. Key có mặt ở cả `data` và `cleared_keys` → giá trị trong `data` được lưu.

## 10. Cần xác nhận

- Section data lưu dạng JSONB map hay column? Quyết định "xoá key" vs "set NULL" (§3.3).
- Downstream (MER, Progress Note, billing) đang phân biệt `null` với "key không tồn tại"
  không? Nếu có thì phải chọn đúng một dạng.
- Có endpoint/entrypoint nào khác cũng ghi section data (import, migration, admin tool)
  không? Nếu có thì cần áp cùng semantics, không thì bug quay lại qua đường khác.
