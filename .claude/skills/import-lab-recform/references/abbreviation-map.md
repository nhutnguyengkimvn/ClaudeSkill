# Abbreviation Map

Maps what is read from the **PDF content** to the Short Codes and Lab names used
throughout the system.

## Form Title → Short Code

Match the form title (the text above `TEST REQUISITION FORM` on page 1, reported
by `scripts/detect-recform-type.py`) to a Short Code:

| Form Title (in PDF) | Short Code |
|---------------------|------------|
| IMMUNODEFICIENCY | IMMUNO |
| GERMLINE CANCER GENETIC | CGX |
| PHARMACOGENOMICS (PGX) | PGX |
| NEUROLOGICAL DISORDERS | NEURO |
| DIABETES ETIOLOGY & DRUG RESPONSE | DIABETES |

> Match is keyword-based, not exact: if the title *contains* `IMMUNODEFICIENCY`
> → IMMUNO; `CANCER GENETIC` → CGX; `PHARMACOGENOMICS` or `PGX` → PGX;
> `NEUROLOGICAL` → NEURO; `DIABETES` → DIABETES.
> If no row matches → use the first word of the title in UPPERCASE as the Short
> Code, and confirm with the user.

## Lab Candidate → Lab Name

Normalize the lab candidates reported by the detector (from email domains and
`X Laboratory` / `X Lab LLC` phrases) to a clean Lab brand:

| Candidate seen in PDF | Lab Name |
|-----------------------|----------|
| `AMEDiX`, `AmedixLab`, `Amedix Laboratory` | Amedix |
| `Hightech`, `Hightec`, `Hightech Lab LLC` | Hightec |

> If no known lab matches → use the most brand-like candidate (drop generic
> words like "Laboratory", "Lab", "LLC", "Inc") and confirm with the user.

## Adding New Test Types / Labs

To add a new test type, append a row to the **Form Title → Short Code** table.
To add a new lab, append a row to the **Lab Candidate → Lab Name** table.

## Derived Name Rules

| Field | Formula | Example |
|-------|---------|---------|
| Short Code | lookup tables above | `CGX` |
| Name | Lab name | `Amedix` |
| Description | `<TestType> - <Lab> 2026` | `CGX - Amedix 2026` |
| ReqForm Tab Name | `<SHORTCODE> <Lab>` | `CGX Amedix` |
| Specialty Tab Name | `tt <SHORTCODE>` | `tt CGX` |
| Specialty Key | `tt-<shortcode_lowercase>-2026` | `tt-cgx-2026` |
| Specialty Name | `<SHORTCODE>-2026` | `CGX-2026` |
| Specialty Display Name | `<SHORTCODE>` | `CGX` |
