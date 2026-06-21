#!/usr/bin/env python3
"""Generate the Form.io order-services JSON + ICD-10 routing map for PGX Amedix.
Reuses the proven boilerplate shapes from the skill's annotated template
(references/order-services-formio-template.json) as prototypes."""
import json, copy, os

SKILL = "/Users/nhut/Documents/GKIM/Document Skill AI/.claude/skills/import-lab-recform"
OUT = "/Users/nhut/Documents/GKIM/Document Skill AI/pgx-amedix-2026"
FORM_NAME = "[DEV] [AI] order services PGX Amedix"

tpl = json.load(open(os.path.join(SKILL, "references/order-services-formio-template.json")))
proto = {c.get("type") + ("_sel" if c.get("type") == "select" and c.get("multiple") else ""): c
         for c in tpl["components"]}
P_select   = next(c for c in tpl["components"] if c["type"] == "select" and not c.get("multiple"))
P_html_ph  = next(c for c in tpl["components"] if c["type"] == "htmlelement" and "order_service_html" == c.get("key"))
P_sboxes   = next(c for c in tpl["components"] if c["type"] == "selectboxes")
P_hidden   = next(c for c in tpl["components"] if c["type"] == "hidden")
P_header   = next(c for c in tpl["components"] if c["type"] == "htmlelement" and c.get("key") == "html")
P_selmulti = next(c for c in tpl["components"] if c["type"] == "select" and c.get("multiple"))
P_submit   = next(c for c in tpl["components"] if c["type"] == "button")

def cp(proto, **over):
    c = copy.deepcopy(proto)
    c.update(over)
    return c

# ---- PGx panels (SELECT ONE) + gene composition ----
PANELS = [
    ("Focused PGx",        "CYP2C19, CYP2D6, CYP2C9, CYP2B6, CYP3A5, DPYD, TPMT, NUDT15, SLCO1B1"),
    ("Comprehensive PGx",  "CYP2C19, CYP2D6, CYP2C9, CYP2B6, CYP3A5, DPYD, TPMT, NUDT15, UGT1A1, SLCO1B1, IFNL3, NAT2, G6PD"),
    ("Pain Management",    "CYP2C19, CYP2D6, CYP2C9, CYP2B6, CYP3A5, SLCO1B1"),
    ("Psychiatry",         "CYP2C19, CYP2D6, CYP2C9, CYP2B6, CYP3A5, UGT1A1, SLCO1B1"),
    ("Cardiology",         "CYP2C19, CYP2D6, CYP2C9, CYP2B6, CYP3A5, SLCO1B1, NAT2"),
    ("Neurology",          "CYP2C19, CYP2D6, CYP2C9, CYP2B6, UGT1A1, SLCO1B1"),
    ("Oncology",           "CYP2C19, CYP2D6, CYP2C9, CYP2B6, DPYD, TPMT, NUDT15, UGT1A1"),
    ("Addiction Medicine", "CYP2C19, CYP2D6, CYP2C9, CYP2B6, CYP3A5, UGT1A1"),
]

components = []

# 1. Test Panel (select, required)
sel = cp(P_select, id="pgxpanel")
sel["data"] = {"custom": "", "json": "", "resource": "", "url": "",
               "values": [{"label": n, "value": n} for n, _ in PANELS]}
sel["placeholder"] = "Select Test Panel"
components.append(sel)

# 2. Placeholder HTML (until a panel is picked)
ph = cp(P_html_ph, id="pgxhtml")
ph["content"] = '<p class="fs-14 fw-500 text-gray-3"><i>Gene parameters will appear here once you select a Test Panel.</i></p>'
components.append(ph)

# 3. Test Parameters — one selectboxes per panel (value = its gene composition)
for i, (name, genes) in enumerate(PANELS, start=1):
    sb = cp(P_sboxes, id=f"pgxtp{i}", key=f"order_service_test_parameters_{i}")
    sb["attributes"] = {"data-desc": name}
    sb["customConditional"] = f"show = data.order_service_test_panel === '{name}';"
    sb["validate"] = dict(sb["validate"])
    sb["validate"]["custom"] = f"valid = data.order_service_test_panel ==='{name}'?true:false;"
    sb["values"] = [{"label": genes, "shortcut": "", "value": genes}]
    components.append(sb)

# 4. Aggregator (hidden) — map panel -> its parameters_<N>
arms = " ".join(
    f"data.order_service_test_panel === '{n}' ? data.order_service_test_parameters_{i} :"
    for i, (n, _) in enumerate(PANELS, start=1))
agg = cp(P_hidden, id="pgxagg")
agg["calculateValue"] = f"value = {arms} '';"
components.append(agg)

# 5. Section header — Clinical Assessment
hdr = cp(P_header, id="pgxhdr1", key="html_adr")
hdr["content"] = '<div class="bg-light rce-pt-5 rce-pb-5 rce-pr-10 rce-pl-10 fw-600 text-black">Adverse Drug Reactions &amp; Treatment Failure History</div>'
components.append(hdr)

# radio helper
def radio(key, label, opts, required=False):
    return {
        "type": "radio", "input": True, "key": key, "label": label,
        "id": "id" + key[-8:], "inline": True, "optionsLabelPosition": "right",
        "values": [{"label": o, "value": o, "shortcut": ""} for o in opts],
        "tableView": False, "persistent": True, "clearOnHide": True,
        "validate": {"required": required, "custom": "", "customPrivate": False,
                     "onlyAvailableItems": False, "multiple": False,
                     "strictDateValidation": False, "unique": False},
        "validateOn": "change", "customConditional": "", "defaultValue": None,
        "conditional": {"eq": "", "show": None, "when": None},
        "attributes": {}, "properties": {}, "data": {}, "fieldSet": False,
        "hideLabel": False, "labelPosition": "top",
    }

# 6. Adverse drug reaction / treatment failure history (Yes/No)
components.append(radio("order_service_adverse_drug_reaction_history",
                        "Patient has a history of an adverse drug reaction or a failed medication", ["Yes", "No"]))
# 7. Family history of severe drug reaction (Yes/No)
components.append(radio("order_service_family_history_severe_drug_reaction",
                        "Family history of severe drug reaction", ["Yes", "No"]))

# Section header — Medications
hdr2 = cp(P_header, id="pgxhdr2", key="html_meds")
hdr2["content"] = '<div class="bg-light rce-pt-5 rce-pb-5 rce-pr-10 rce-pl-10 fw-600 text-black">Active Medication List &amp; Drug Therapy Context</div>'
components.append(hdr2)

# 8a. Medication list attached? (Yes/No)
components.append(radio("order_service_medication_list_attached", "Medication list attached?", ["Yes", "No"]))

# 8b. Active medication list datagrid (shown when not attached)
datagrid = {
    "type": "datagrid", "input": True, "key": "order_service_active_medication_list",
    "label": "Active Medication List", "id": "pgxmeds", "reorder": False,
    "addAnotherPosition": "bottom", "layoutFixed": False, "enableRowGroups": False,
    "initEmpty": False, "tableView": False, "persistent": True, "clearOnHide": True,
    "customConditional": "show = data.order_service_medication_list_attached === 'No';",
    "conditional": {"eq": "", "show": None, "when": None},
    "validate": {"required": False, "custom": "", "customPrivate": False,
                 "multiple": False, "strictDateValidation": False, "unique": False,
                 "maxLength": "", "minLength": ""},
    "validateOn": "change", "attributes": {}, "properties": {}, "addons": [],
    "defaultValue": [{}], "labelPosition": "top", "hideLabel": False,
    "components": [
        {"type": "textfield", "input": True, "key": "medication", "label": "Medication",
         "id": "pgxmedname", "tableView": True, "persistent": True,
         "validate": {"required": False, "custom": "", "customPrivate": False,
                      "multiple": False, "strictDateValidation": False, "unique": False},
         "validateOn": "change", "attributes": {}, "properties": {}, "conditional": {"eq": "", "show": None, "when": None}},
        {"type": "selectboxes", "input": True, "inputType": "checkbox", "key": "usage",
         "label": "Usage", "id": "pgxmedusage", "inline": True, "optionsLabelPosition": "right",
         "values": [{"label": "Current", "value": "Current", "shortcut": ""},
                    {"label": "Future", "value": "Future", "shortcut": ""}],
         "tableView": False, "persistent": True,
         "validate": {"required": False, "custom": "", "customPrivate": False, "onlyAvailableItems": False,
                      "multiple": False, "strictDateValidation": False, "unique": False},
         "validateOn": "change", "attributes": {}, "properties": {}, "data": {}, "conditional": {"eq": "", "show": None, "when": None}},
    ],
}
components.append(datagrid)

# Section header — Clinical context / diagnosis
hdr3 = cp(P_header, id="pgxhdr3", key="html_dx")
hdr3["content"] = '<div class="bg-light rce-pt-5 rce-pb-5 rce-pr-10 rce-pl-10 fw-600 text-black">Clinical Context &amp; Diagnosis</div>'
components.append(hdr3)

# 9. Additional Clinical Context (textfield) — FIXED
components.append({
    "type": "textfield", "input": True, "key": "order_service_additional_clinical_context",
    "label": "Additional Clinical Context", "id": "pgxacc", "tableView": True,
    "persistent": True, "clearOnHide": True,
    "validate": {"required": False, "custom": "", "customPrivate": False, "multiple": False,
                 "strictDateValidation": False, "unique": False, "minLength": "", "maxLength": ""},
    "validateOn": "change", "attributes": {}, "properties": {}, "labelPosition": "top",
    "conditional": {"eq": "", "show": None, "when": None}, "customConditional": "",
})

# 10. Relevant Diagnosis (select, multiple, system-fed) — FIXED, required
reldx = cp(P_selmulti, id="pgxreldx", key="order_service_relevant_diagnosis")
reldx["label"] = "Relevant Diagnosis"
reldx["dataSrc"] = "custom"
reldx["data"] = {"custom": "values = window.currentCase?.case_data?.rawjson?.diagnosis_icd10codes || [];",
                 "json": "", "resource": "", "url": "", "values": []}
reldx["validate"] = dict(reldx["validate"]); reldx["validate"]["required"] = True
components.append(reldx)

# 11. Instructions (textarea) — FIXED
components.append({
    "type": "textarea", "input": True, "key": "order_service_instructions",
    "label": "Instructions", "id": "pgxinstr", "rows": 3, "tableView": True,
    "persistent": True, "clearOnHide": True, "autoExpand": False, "editor": "",
    "validate": {"required": False, "custom": "", "customPrivate": False, "multiple": False,
                 "strictDateValidation": False, "unique": False, "minLength": "", "maxLength": ""},
    "validateOn": "change", "attributes": {}, "properties": {}, "labelPosition": "top",
    "conditional": {"eq": "", "show": None, "when": None}, "customConditional": "",
})

# 12. Submit
components.append(cp(P_submit, id="pgxsubmit"))

form = {"components": components, "display": "form", "form": {"display": "form"}, "name": FORM_NAME}
json.dump(form, open(os.path.join(OUT, "form.json"), "w"), indent=2, ensure_ascii=False)

# ---- ICD-10 routing map (flat: primary/secondary) ----
PRIMARY = {
 "B20": "Human immunodeficiency virus [HIV] disease",
 "C18.9": "Malignant neoplasm of colon, unspecified",
 "C50.919": "Malignant neoplasm of unspecified site of unspecified female breast",
 "C91.00": "Acute lymphoblastic leukemia not having achieved remission",
 "E78.00": "Pure hypercholesterolemia, unspecified",
 "E78.2": "Mixed hyperlipidemia",
 "F11.23": "Opioid dependence with withdrawal",
 "F20.0": "Paranoid schizophrenia",
 "F31.4": "Bipolar disorder, current episode depressed, severe, without psychotic features",
 "F32.1": "Major depressive disorder, single episode, moderate",
 "F32.2": "Major depressive disorder, single episode, severe without psychotic features",
 "F33.1": "Major depressive disorder, recurrent, moderate",
 "F33.2": "Major depressive disorder, recurrent, severe without psychotic features",
 "F41.1": "Generalized anxiety disorder",
 "F43.12": "Post-traumatic stress disorder, chronic",
 "F90.2": "Attention-deficit hyperactivity disorder, combined type",
 "G40.209": "Localization-related (focal) (partial) symptomatic epilepsy and epileptic syndromes with complex partial seizures, not intractable, without status epilepticus",
 "G89.29": "Other chronic pain",
 "I25.10": "Atherosclerotic heart disease of native coronary artery without angina pectoris",
 "I48.0": "Paroxysmal atrial fibrillation",
 "K21.9": "Gastro-esophageal reflux disease without esophagitis",
 "M10.9": "Gout, unspecified",
 "Z94.0": "Kidney transplant status",
 "Z94.1": "Heart transplant status",
 "Z94.4": "Liver transplant status",
}
SECONDARY = {
 "F17.210": "Nicotine dependence, cigarettes, uncomplicated",
 "G47.00": "Insomnia, unspecified",
 "R45.851": "Suicidal ideations",
 "R52": "Pain, unspecified",
 "Z16.32": "Resistance to antifungal drug(s)",
 "Z17.0": "Estrogen receptor positive [ER+] status",
 "Z51.11": "Encounter for antineoplastic chemotherapy",
 "Z51.12": "Encounter for antineoplastic immunotherapy",
 "Z79.01": "Long-term (current) use of anticoagulants",
 "Z79.02": "Long-term (current) use of antithrombotics/antiplatelets",
 "Z79.1": "Long term (current) use of non-steroidal anti-inflammatories (NSAID)",
 "Z79.4": "Long term (current) use of insulin",
 "Z79.621": "Long term (current) use of immunosuppressant",
 "Z79.810": "Long term (current) use of selective estrogen receptor modulators (SERMs)",
 "Z79.84": "Long term (current) use of oral hypoglycemic drugs",
 "Z79.891": "Long-term (current) use of opiate analgesic",
 "Z79.899": "Other long-term (current) drug therapy",
 "Z85.038": "Personal history of other malignant neoplasm of large intestine",
 "Z85.3": "Personal history of malignant neoplasm of breast",
 "Z86.59": "Personal history of other mental and behavioral disorders",
 "Z92.21": "Personal history of antineoplastic chemotherapy",
 "Z95.1": "Presence of aortocoronary bypass graft",
 "Z95.5": "Presence of coronary angioplasty implant and graft",
}
routing = {
    "reqform": "PGX - Amedix 2026", "lab": "Amedix", "test_type": "PGX",
    "map_type": "flat",
    "panels_offered": [n for n, _ in PANELS],
    "icd10": (
        [{"code": c, "description": d, "category": "primary"} for c, d in PRIMARY.items()] +
        [{"code": c, "description": d, "category": "secondary"} for c, d in SECONDARY.items()]
    ),
    "note": "Codes extracted verbatim from the reqform's single Primary/Secondary list. "
            "Used for routing only; they do NOT populate the form's Relevant Diagnosis field "
            "(which is system-fed from the case). Medical-necessity/coding responsibility stays "
            "with the ordering physician per 42 CFR 410.32.",
}
json.dump(routing, open(os.path.join(OUT, "pgx-amedix-2026_routing_map.json"), "w"), indent=2, ensure_ascii=False)

print("components:", len(components))
print("primary:", len(PRIMARY), "secondary:", len(SECONDARY), "total icd10:", len(routing["icd10"]))
print("OK form.json + routing_map.json written")
