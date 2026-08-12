# Preview: sheet → Form.io, chạy local

Dựng form Form.io từ sheet field-mapping để xem trước **trước khi** import vào platform:
show/hide theo điều kiện, required theo role, và payload thực sự sẽ push lên.

## Chạy

```bash
cd plans/260812-1035-cleared-keys-hidden-field-spec/preview

# 1. sinh form.json từ sheet (cache ở .cache/, thêm --no-cache để lấy bản mới)
../../../.claude/skills/.venv/bin/python3 sheet_to_formio.py \
    --tab Wellness_HRA --section social_history_screening

# 2. serve rồi mở http://localhost:8811
python3 -m http.server 8811
```

Tiện ích khác của script:

```bash
sheet_to_formio.py --tabs                    # list tab + gid
sheet_to_formio.py --sections Wellness_HRA   # list section key của 1 tab
sheet_to_formio.py --roles                   # tổng hợp role token + giá trị permission
```

## Trên trang preview

- **persona (cột sheet)** — Sale / PSS / Provider → áp permission từ cột tương ứng:
  `HIDE` → hidden, `VIEW` → disabled, `EDIT`/`RES` → nhập được.
- **window.role** — set cả `window.role` và `window.config_role_name`, có sẵn các token
  đang dùng trong platform + ô tự nhập. Đổi token thì persona tự nhảy theo map
  `ROLE_TO_PERSONA` trong `index.html` (sửa map đó nếu tên role thật khác).
- **submission data** — đúng thứ FE sẽ push.
- **cleared_keys** — chạy **nguyên** thuật toán trong `spec-fe-cleared-keys.md` §1.3,
  gồm cả việc loại field ẩn vì role.
- **field đang ẩn — vì sao** — phân biệt `conditional` với `role`, để thấy ngay field nào
  được phép clear và field nào không.

## Độ chính xác

`additional_component_props JSON` (AD) và `customFormIOfield` (AE) được merge **verbatim**,
`append_logic` được nối vào `logic` — giống đúng cách form thật làm. Kiểm chứng: component
`social_history_screening_alcohol_counseling_exclusive_duration` sinh ra khớp với bản
compiled lấy từ form thật (cùng `conditional`, `customClass`, `validate`, `clearOnHide`,
2 arm `Res12Aug` / `requiredlabelRes12Aug`).

Phần **xấp xỉ**, không phải bản importer thật:

- Các arm `<ROLE>-HIDE` do preview tự sinh từ 3 cột permission (platform sinh phía server).
  Danh sách token trong `SALE_ROLE_TOKENS` là những token quan sát được từ một component
  thật — nếu platform có role khác thì thêm vào.
- Label được bọc sẵn HTML giống form thật; các thuộc tính chỉ dùng cho render nội bộ của
  platform (`display_priority`, `wrappedType`, `raw_label`…) có thể thiếu.
- Row không có `Field Type`/`field_key` bị bỏ (Care Plan grid — 4 row ở Social History).
- Form.io ở đây là bản mới nhất từ CDN (`vendor/`), có thể khác version platform đang chạy.
  Chính vì vậy nên dùng preview để **đối chiếu hành vi**, không dùng làm bằng chứng cuối cùng.

## Phát hiện đáng chú ý

Trên bản Form.io này: field đang ẩn theo `conditional`, `clearOnHide: true`, mà value **vẫn
nằm trong** `form.data` / `form.submission.data`; gọi `checkData()` hay `triggerChange()`
cũng không xoá. Vì vậy spec FE §3 yêu cầu FE **tự strip** các key trong `cleared_keys` ra
khỏi `data` chứ không tin `clearOnHide` — nếu không, payload vẫn mang giá trị cũ và BE ghi
lại giá trị cũ.
