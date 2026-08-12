# SPEC — FE: gửi `cleared_keys` khi save case section

**Ngày:** 2026-08-12 · **Owner:** FE · **Cặp với:** `spec-be-cleared-keys.md`

## 1. Vấn đề

Field bị ẩn theo điều kiện (`conditional`) có `clearOnHide: true` → Form.io **xoá key
khỏi `data`** → payload không có key → BE merge kiểu PATCH coi "absent = không đổi"
→ **giá trị cũ còn nguyên trong DB**.

Ví dụ thật: `social_history_screening_alcohol = Yes`, provider nhập
`..._alcohol_counseling_exclusive_duration = 10`, save. Sau đó đổi alcohol = `No`,
save → duration bị ẩn, key mất khỏi payload, DB vẫn giữ `10`. Field này tính
billing (rule 5–15 phút) nên đây là data sai, không chỉ data rác.

Đã thử 2 cách chỉ sửa config Form.io (`calculateValue`, logic Set Value) — **fail**,
lý do ghi trong `.claude/skills/analyze-clickup-task/knowledge/learned-rules.md`
(entry 2026-08-12). Kết luận: phải để FE nói rõ "những key này đã bị clear".

## 2. Giải pháp

Mỗi lần save một section, FE gửi thêm mảng `cleared_keys` — danh sách key của các
component **đang bị ẩn do điều kiện dữ liệu**. BE nhận list này và xoá đúng những key
đó (spec BE).

**Giữ nguyên `clearOnHide: true` trong sheet** — không đổi config Form.io. Thông tin
"đã clear" nằm ở `cleared_keys`, không nằm ở `data`.

## 3. API contract (FE gửi)

```jsonc
PATCH /api/cases/{caseId}/sections/{sectionKey}
{
  "data": { /* như hiện tại: chỉ field đang hiện + có value */ },
  "cleared_keys": [
    "social_history_screening_alcohol_counseling_exclusive_duration",
    "social_history_screening_counseling_provided",
    "social_history_screening_alcohol_overall_assessment"
  ],
  "meta": { "section_key": "social_history_screening", "form_version": "<nếu có>" }
}
```

Quy tắc:

- **Luôn gửi field `cleared_keys`**, kể cả khi rỗng → gửi `[]`. Không được omit.
  BE phân biệt `absent` = client cũ (legacy behaviour) vs `[]` = không có gì để clear.
- Mảng string, unique, không thứ tự.
- **FE phải tự xoá key khỏi `data`** trước khi gửi, không được tin `clearOnHide` làm
  việc đó. Đo trên preview (`preview/`, Form.io bản mới nhất): component
  `visible: false`, `clearOnHide: true`, mà value **vẫn nằm trong**
  `form.data` và `form.submission.data` — gọi `checkData()` / `triggerChange()` cũng
  không xoá. Nếu để nguyên thì payload mang giá trị cũ, BE ghi lại giá trị cũ, và cả
  cơ chế này vô nghĩa. Thứ tự đúng: **tính cleared list → strip các key đó khỏi `data`
  → gửi cả hai.**
- Không key nào được xuất hiện ở cả `data` và `cleared_keys`. Nếu vẫn trùng thì đó là
  bug FE (chưa strip) — BE sẽ ưu tiên `data` và log `present_in_data`.

## 4. Cách gom `cleared_keys`

Tính **tại thời điểm save**, từ Form.io instance đang live (không đọc từ schema cache).

```js
function collectClearedKeys(form, currentRole) {
  const cleared = new Set();

  form.everyComponent((comp) => {
    const c = comp.component || {};
    if (!c.key || c.input === false) return;              // bỏ content/button/layout
    if (['button', 'content', 'htmlelement'].includes(c.type)) return;

    // chỉ xét component trong section đang save (xem §5.1)
    // bỏ component nằm trong datagrid/editgrid/tree (xem §5.3)
    if (['datagrid', 'editgrid', 'tree'].includes(comp.parent?.type)) return;

    const isHidden = comp.visible === false || c.hidden === true;
    if (!isHidden) return;

    // KHÔNG clear field bị ẩn vì ROLE (xem §5.2)
    if (isHiddenByRole(c, currentRole)) return;

    cleared.add(comp.path || c.key);
  });

  return [...cleared];
}

// Field bị ẩn do phân quyền: arm logic có roleApplied trùng role hiện tại
// và có action set Hidden = true (đúng convention *-HIDE đang dùng trong form).
function isHiddenByRole(c, currentRole) {
  return (c.logic || []).some((arm) =>
    arm.roleApplied &&
    (arm.roleApplied === currentRole || arm.roleApplied === window.config_role_name) &&
    (arm.actions || []).some((a) => a.property?.value === 'hidden' && a.state === true)
  );
}
```

## 5. Các bẫy bắt buộc xử lý

### 5.1 Scope theo section — QUAN TRỌNG NHẤT

Chỉ được gom key **thuộc section đang save**. Nếu gom cả form thì một lần PSS save
Compliance sẽ báo clear luôn field của section khác → **wipe data section khác**.
Platform này đã có tiền lệ đúng lỗi đó (click Save của section đang ẩn ghi rỗng và
xoá data section khác), nên đây là rule cứng.

Nếu mỗi section là một Form.io instance riêng → dùng đúng instance đó, tự nhiên đúng
scope. Nếu là một form chung → filter theo `section_key` của component trước khi gom.

### 5.2 Field ẩn vì ROLE không được coi là cleared

Form đang có sẵn các arm `SALES_STAFF-HIDE`, `ADMIN_MEDICAL-HIDE`, … kèm
`roleApplied`. Với role PSS thì các field doctor-only đang `hidden` — nếu đưa vào
`cleared_keys` thì **PSS save một lần là xoá sạch dữ liệu bác sĩ đã nhập**.

→ Loại theo `isHiddenByRole()` ở trên. BE cũng chặn lớp thứ hai theo role config
(spec BE §4) — hai lớp độc lập, không bỏ lớp nào.

### 5.3 Component trong datagrid / editgrid (v1: out of scope)

`everyComponent()` đi vào cả con của datagrid, mà data path của chúng là
`parent[index].child` chứ không phải `child`. Gửi key trần lên là sai địa chỉ.

→ v1 **bỏ hẳn** (skip theo `comp.parent?.type`). Care Plan grid
(`..._alcohol_care_plan`, `..._tobacco_care_plan`) nằm trong nhóm này. Ghi vào ticket
là known limitation; khi cần thì mở rộng contract sang path đầy đủ.

### 5.4 Thời điểm tính

Sau khi `form.checkData()` chạy xong / ngay trước khi build body. Tính sớm hơn thì
`comp.visible` chưa cập nhật theo lần đổi cuối cùng của user.

### 5.5 Case mới, chưa từng có data

Gate là `undefined` → dependent đang ẩn → key vào `cleared_keys` → BE clear một key
vốn đã rỗng. Vô hại, đúng idempotent. Không cần lọc.

## 6. Acceptance criteria

1. alcohol = Yes → duration = 10 → save → payload: `data` có duration = 10,
   `cleared_keys` **không** chứa duration.
2. Đổi alcohol = No → save → payload: `data` **không** có duration,
   `cleared_keys` **có** duration (và các dependent khác của alcohol).
   Test này phải pass **kể cả khi** Form.io không tự xoá value khỏi `data` — đây là
   ca đã đo được là fail nếu FE không tự strip (§3).
3. Login PSS, save Compliance → `cleared_keys` **không** chứa bất kỳ field doctor-only
   nào (kiểm bằng cách đối chiếu role config của section).
4. Không có field nào bị ẩn → gửi `"cleared_keys": []`, không omit.
5. `cleared_keys` không bao giờ giao với `Object.keys(data)`.
6. Không có key nào của datagrid child xuất hiện trong `cleared_keys`.
7. Save 2 lần liên tiếp không đổi gì → `cleared_keys` giống nhau (deterministic).

## 7. Rollout

BE deploy trước (chấp nhận `cleared_keys` absent = behaviour cũ) → FE ship sau, bọc
feature flag để tắt nhanh nếu có sự cố. FE tắt flag = quay về hành vi hiện tại, không
cần BE rollback.

## 8. Cần xác nhận

- Mỗi section là 1 Form.io instance riêng hay 1 form chung? Quyết định cách filter ở §5.1.
- Tên biến role dùng cái nào là chuẩn: `window.role` hay `window.config_role_name`?
  Trong logic của form đang thấy dùng cả hai (`window.role === 'SALES_STAFF' || window.config_role_name === ...`).
