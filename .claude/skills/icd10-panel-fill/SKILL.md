---
name: icd10-panel-fill
description: Fill PDF annotation `contents` from a UUID→value mapping. Use when given a mapping {uuid: "diagnosis_icd10codes_panel_<Panel>__<ICD>"} and a target JSON array of annotation objects (each with `name`=UUID and short-form `contents` like "diagnosis_icd10codes__<ICD>"). Matches by `name` (UUID), backs up, verifies. Triggers: "tiếp cho file này", "đổi diagnosis_icd10codes", "map panel theo UUID".
---

# ICD10 Panel Fill

Replace each annotation object's `contents` with the full panel string from a UUID→value mapping, matching on the object's `name` (UUID).

**Principles:** KISS · backup before write · verify after write.

## Input

1. **Mapping** (user pastes JSON): `{ "<uuid>": "diagnosis_icd10codes_panel_<Panel>__<ICD>", ... }`
2. **Target file** (path the user gives): a JSON **array** of objects; each object has `name` (UUID) and `contents`.

## Steps

1. Save the pasted mapping to `/tmp/icd_map.json` (use the Write tool).
2. **Dry-run check** — confirm UUIDs match and how many need changing:
   ```bash
   python3 - "$TARGET" <<'PY'
   import json,sys
   data=json.load(open(sys.argv[1])); m=json.load(open('/tmp/icd_map.json'))
   byname={o.get('name'):o for o in data}
   present=[k for k in m if k in byname]
   need=sum(1 for k in present if byname[k].get('contents')!=m[k])
   miss=[k for k in m if k not in byname]
   print(f"mapping={len(m)} present={len(present)} need-change={need} missing={len(miss)}")
   for k in miss[:10]: print("  missing:",k)
   PY
   ```
   If `missing > 0`, report the missing UUIDs to the user before proceeding.
3. **Apply** — backup, then update `contents` by UUID, then verify:
   ```bash
   cp "$TARGET" "$TARGET.bak"
   python3 - "$TARGET" <<'PY'
   import json,sys
   p=sys.argv[1]; data=json.load(open(p)); m=json.load(open('/tmp/icd_map.json'))
   changed=[]
   for o in data:
       n=o.get('name')
       if n in m and o.get('contents')!=m[n]:
           changed.append((o.get('contents'),m[n])); o['contents']=m[n]
   json.dump(data,open(p,'w'),ensure_ascii=False,indent=2)
   d2=json.load(open(p)); bn={o.get('name'):o for o in d2}
   bad=[k for k in m if bn.get(k,{}).get('contents')!=m[k]]
   print("changed:",len(changed),"| not-applied:",len(bad))
   for a,b in changed[:3]: print("  ",a,"->",b)
   PY
   ```
4. Report: number changed, backup path, one sample. List missing UUIDs (if any) as unresolved.

## Notes

- `$TARGET` = the target file path (e.g. `/Users/nhut/Desktop/anot-neuro.json`).
- Idempotent: entries already in panel form are skipped (`contents != mapping` guard).
- Only the `contents` field changes; all other fields and key order are preserved.
- Mapping value is used verbatim — do **not** reconstruct the panel string from the ICD code (a code can belong to many panels; only the UUID is authoritative).
