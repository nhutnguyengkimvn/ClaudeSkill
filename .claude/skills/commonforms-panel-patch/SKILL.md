---
name: commonforms-panel-patch
description: >
  Phân tích file JSON annotation của CommonForms PDF (Amedix lab requisition forms)
  kết hợp với nội dung PDF để tạo file patch JSON mapping UUID → tên field mới theo panel.
  Dùng khi user cung cấp: (1) JSON annotation của một PDF form, (2) file PDF (hoặc text
  content của PDF). Output là một file `*_patch.json` chứa mapping uuid → new_contents,
  dùng với script apply_patch.py. Trigger khi user nói "tạo patch", "phân tích json",
  "map panel", "diagnosis_icd10codes", hoặc upload PDF kèm JSON annotation của Amedix form.
---

# CommonForms Panel Patch — Skill

Tạo file patch JSON để đổi tên các field `diagnosis_icd10codes__<ICD>` thành
`diagnosis_icd10codes_panel_<PanelName>__<ICD>` dựa trên vị trí (page + y-coordinate)
của mỗi checkbox trong PDF annotation JSON.

---

## Tổng quan workflow

```
Input:
  - JSON annotation (từ CommonForms PDF tool)  ← document hoặc paste
  - PDF file (để đọc panel names + boundaries) ← upload hoặc text content

Output:
  - *_patch.json  (uuid → new_contents mapping)

Dùng với:
  - apply_patch.py (đã có sẵn tại /mnt/user-data/outputs/apply_patch.py)
```

---

## Bước 1 — Đọc và lọc JSON annotation

JSON annotation là một array các object. Mỗi object có:
- `name` (uuid)
- `page` (0-indexed)
- `rect` (tọa độ `[x1, y1, x2, y2]`) → **y2 = rect[3]** là giá trị y dùng để map panel
- `contents` (tên field)
- `subject` (loại: `Checkbox`, `Textbox`)

**Lọc chỉ lấy các item có `contents` bắt đầu bằng `diagnosis_icd10codes__`:**

```python
diag_items = [
    item for item in data
    if item.get("contents", "").startswith("diagnosis_icd10codes__")
]
```

Mỗi item cần extract:
- `uuid` = `item["name"]`
- `icd_code` = `item["contents"].replace("diagnosis_icd10codes__", "")`
- `page` = `item["page"]`  (0-indexed)
- `y` = `float(item["rect"][3])`  ← y2, tức rect[3]

---

## Bước 2 — Đọc panel boundaries từ PDF

Nhìn vào PDF để xác định:

### 2a. Tên các panels
Đọc phần **TEST SELECTION** của PDF (thường từ trang 2 trở đi). Mỗi panel có header
in đậm/màu, ví dụ:
- `PHARMACOGENOMICS PROFILE`
- `MONOGENIC DIABETES GENETIC ANALYSIS`
- `METACORE-Dx`
- `COMBINED IMMUNODEFICIENCY`

### 2b. Panel boundaries

Tìm các `test_requirements_test_order_parameters_*` hoặc `test_requirements_test_parameters_*`
checkboxes trong JSON — đây là **checkbox chọn panel**, chúng có y-coordinate đánh dấu
ranh giới giữa các panels.

**Quy tắc:** items nằm **phía trên** (y lớn hơn) checkbox của panel đó thuộc panel đó,
items nằm **phía dưới** (y nhỏ hơn) thuộc panel tiếp theo bên dưới.

**Ví dụ từ các PDF đã xử lý:**

```
# Diabetes Etiology (page 1, 0-indexed)
y > 527   → Pharmacogenomics Profile
431 < y ≤ 527 → Monogenic Diabetes Genetic Analysis
343 < y ≤ 431 → Extended Panel (Pediatric/Syndromic/Neonatal)
y ≤ 343   → Mitochondrial Diabetes (MIDD) Reflex Testing

# Metabolic Disorders
# Page 1:
y > 385   → METACORE-Dx
y ≤ 385   → HEPATOMET-Dx
# Page 2:
y > 278   → NEUROMYO-PLEX
y ≤ 278   → MITOGENOME-3600
# Page 3:
y > 585   → MITOGENOME-3600 NGS Panel
y ≤ 585   → MITOGENOME-3600 Extended Panel (Pediatric)

# Immunodeficiency
# Page 0: → Combined Immunodeficiency (tất cả)
# Page 1:
y > 709   → Antibody Deficiency and CVID
559 < y ≤ 709 → Severe Combined Immunodeficiency
434 < y ≤ 559 → Immune Dysregulation
y ≤ 434   → Adult-Onset Severe Inherited Immunodeficiency
```

### 2c. Cách tìm boundary chính xác

```python
# Tìm các panel-selector checkboxes
panel_selectors = [
    item for item in data
    if (item.get("contents", "").startswith("test_requirements_test_order_parameters_")
        or item.get("contents", "").startswith("test_requirements_test_parameters_"))
    and item.get("subject") == "Checkbox"
]

# Sort theo page rồi y giảm dần (top-to-bottom = y lớn → nhỏ trong PDF coord)
panel_selectors.sort(key=lambda x: (x["page"], -float(x["rect"][3])))

for sel in panel_selectors:
    print(f"page={sel['page']} y={sel['rect'][3]:.1f} → {sel['contents'][:60]}")
```

Từ output này, đọc PDF để đối chiếu tên panel với y-coordinate của checkbox.

---

## Bước 3 — Viết hàm get_panel()

Sau khi xác định boundaries, viết hàm mapping:

```python
def get_panel(page, y):
    # Ví dụ cho Diabetes Etiology:
    if page == 1:  # page index 0-based
        if y > 527:
            return "Pharmacogenomics Profile"
        elif y > 431:
            return "Monogenic Diabetes Genetic Analysis"
        elif y > 343:
            return "Extended Panel (Pediatric/Syndromic/Neonatal)"
        else:
            return "Mitochondrial Diabetes (MIDD) Reflex Testing"
    return None
```

> **Lưu ý:** page trong JSON là 0-indexed. PDF page 1 = `page=0` trong JSON,
> PDF page 2 = `page=1`, v.v.

---

## Bước 4 — Build patch dict và export

```python
import json

patch = {}
no_panel = []

for item in diag_items:
    uuid = item["name"]
    icd  = item["contents"].replace("diagnosis_icd10codes__", "")
    page = item["page"]
    y    = float(item["rect"][3])

    panel = get_panel(page, y)
    if panel:
        patch[uuid] = f"diagnosis_icd10codes_panel_{panel}__{icd}"
    else:
        no_panel.append((uuid, item["contents"], page, y))

# Kiểm tra
print(f"Mapped: {len(patch)}, No panel: {len(no_panel)}")
for x in no_panel:
    print(f"  MISSING: page={x[2]} y={x[3]:.1f} → {x[1]}")

# Export
with open("output_patch.json", "w", encoding="utf-8") as f:
    json.dump(patch, f, ensure_ascii=False, indent=2)
```

---

## Bước 5 — Áp dụng patch

Dùng script `apply_patch.py` (tại `/mnt/user-data/outputs/apply_patch.py`):

```bash
# Sửa đường dẫn patch file trong script trước khi chạy
python3 apply_patch.py input.json output.json
```

---

## Quy tắc đặt tên

Format chuẩn:
```
diagnosis_icd10codes_panel_{PanelName}__{ICD_CODE}
```

- `PanelName`: lấy **đúng tên** từ PDF header (giữ nguyên case, spaces, dấu ngoặc)
- `ICD_CODE`: lấy nguyên phần sau `diagnosis_icd10codes__` (giữ nguyên)

Ví dụ:
```
diagnosis_icd10codes_panel_Pharmacogenomics Profile__E78.010
diagnosis_icd10codes_panel_METACORE-Dx__E74.21
diagnosis_icd10codes_panel_Combined Immunodeficiency__D83.0
```

---

## Edge cases cần chú ý

### Cùng ICD code xuất hiện nhiều lần
Bình thường — mỗi UUID là duy nhất, cùng ICD có thể ở nhiều panels khác nhau.
Xử lý bình thường, map theo UUID.

### Item không có panel (no_panel list)
Kiểm tra lại boundary. Thường xảy ra khi:
- Item nằm đúng tại y-boundary → điều chỉnh `>` vs `>=`
- Item thuộc phần header/footer → bỏ qua (không phải diagnosis item thực sự)
- Item ở page không có panel → xem lại PDF cấu trúc

### Rect format bất thường
Một số item có rect dạng `"26,720.7..."` (thiếu khoảng cách) — parse cẩn thận:
```python
rect_str = item["rect"]
# rect đã là string "x1,y1,x2,y2" hoặc array
if isinstance(rect_str, str):
    parts = rect_str.split(",")
    y = float(parts[3])
else:
    y = float(rect_str[3])
```

### Multi-page panels
Một số panels trải dài nhiều trang (ví dụ Neurological có 3 pages).
Xử lý từng page riêng với boundary riêng.

---

## Script hoàn chỉnh (template)

```python
import json

# Load JSON annotation
with open("annotations.json", encoding="utf-8") as f:
    data = json.load(f)

# Lọc diagnosis items
diag_items = [
    item for item in data
    if isinstance(item.get("contents"), str)
    and item["contents"].startswith("diagnosis_icd10codes__")
]

print(f"Found {len(diag_items)} diagnosis items")

# --- ĐIỀN VÀO ĐÂY SAU KHI ĐỌC PDF ---
def get_panel(page, y):
    # TODO: điền boundaries dựa trên PDF
    pass

# Build patch
patch = {}
no_panel = []

for item in diag_items:
    uuid  = item["name"]
    icd   = item["contents"].replace("diagnosis_icd10codes__", "")
    page  = item["page"]
    rect  = item["rect"]
    y     = float(rect[3]) if isinstance(rect, list) else float(rect.split(",")[3])
    panel = get_panel(page, y)

    if panel:
        patch[uuid] = f"diagnosis_icd10codes_panel_{panel}__{icd}"
    else:
        no_panel.append((uuid, item["contents"], page, y))

# Report
from collections import Counter
print(f"\nTotal mapped: {len(patch)}")
panel_counts = Counter(v.split("__")[0] for v in patch.values())
for p, c in sorted(panel_counts.items()):
    print(f"  {c:3d} items → {p}")

if no_panel:
    print(f"\nWARNING: {len(no_panel)} items without panel:")
    for x in no_panel:
        print(f"  page={x[2]} y={x[3]:.1f} → {x[1]}")

# Export
output_file = "output_patch.json"
with open(output_file, "w", encoding="utf-8") as f:
    json.dump(patch, f, ensure_ascii=False, indent=2)
print(f"\nSaved: {output_file}")
```

---

## apply_patch.py (reference)

```python
import json, sys

PATCH_FILE = "output_patch.json"  # đổi tên tùy form

with open(PATCH_FILE, encoding="utf-8") as f:
    patch = json.load(f)

input_file  = sys.argv[1]
output_file = sys.argv[2]

with open(input_file, encoding="utf-8") as f:
    data = json.load(f)

count = 0
for item in data:
    uid = item.get("name")
    if uid in patch:
        item["contents"] = patch[uid]
        count += 1

with open(output_file, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f"Patched {count} items → {output_file}")
```

---

## Các form đã xử lý (tham khảo)

| Form | Panels | Pages có diagnosis |
|------|--------|-------------------|
| Diabetes Etiology | 4 panels | page 1 |
| Metabolic Disorders | 6 panels | page 1, 2, 3 |
| Immunodeficiency | 5 panels | page 0, 1 |
| Neurological Disorders | 14 panels | page 1, 2, 3 |
