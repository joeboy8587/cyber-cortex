# Confirm FAA registry promotion

The new FAA files are fully staged and verified: **317,901 registrations** and **94,134 aircraft references**. Previous registry copies are preserved. Original detections are unchanged.

Approve the exact statements below to update matching FAA records and add new ones in one transaction; **2,282 older registrations absent from the new public release remain retained**. This confirmation is required before replacing current registry values. Read-only enrichment and historical/current identity distinctions follow promotion.

## Exact statements for confirmation
```sql
-- Execute only after explicit confirmation of these exact UPDATE statements.
-- All statements belong to one gateway queries transaction with staging checks.
UPDATE public.faa_master AS m
SET (serial_number, mfr_mdl_code, eng_mfr_mdl, year_mfr, type_registrant,
     name, street, street2, city, state, zip_code, region, county, country,
     last_action_date, cert_issue_date, certification, type_aircraft, type_engine,
     status_code, mode_s_code, fract_owner, air_worth_date, other_names_1_,
     other_names_2_, other_names_3_, other_names_4_, other_names_5_, expiration_date,
     unique_id, kit_mfr, kit_model, mode_s_code_hex)
  = (s.serial_number, s.mfr_mdl_code, s.eng_mfr_mdl, s.year_mfr, s.type_registrant,
     s.name, s.street, s.street2, s.city, s.state, s.zip_code, s.region, s.county, s.country,
     s.last_action_date, s.cert_issue_date, s.certification, s.type_aircraft, s.type_engine,
     s.status_code, s.mode_s_code, s.fract_owner, s.air_worth_date, s.other_names_1_,
     s.other_names_2_, s.other_names_3_, s.other_names_4_, s.other_names_5_, s.expiration_date,
     s.unique_id, s.kit_mfr, s.kit_model, s.mode_s_code_hex)
FROM faa_registry_20261021.master_staging AS s
WHERE m.n_number = s.n_number AND to_jsonb(m) IS DISTINCT FROM to_jsonb(s);

INSERT INTO public.faa_master
SELECT s.* FROM faa_registry_20261021.master_staging AS s
WHERE NOT EXISTS (SELECT 1 FROM public.faa_master AS m WHERE m.n_number = s.n_number);

UPDATE public.faa_aircraft_ref AS r
SET (mfr, model, type_acft, type_eng, ac_cat, build_cert_ind, no_eng, no_seats,
     ac_weight, speed, tc_data_sheet, tc_data_holder)
  = (s.mfr, s.model, s.type_acft, s.type_eng, s.ac_cat, s.build_cert_ind, s.no_eng,
     s.no_seats, s.ac_weight, s.speed, s.tc_data_sheet, s.tc_data_holder)
FROM faa_registry_20261021.aircraft_ref_staging AS s
WHERE r.code = s.code AND to_jsonb(r) IS DISTINCT FROM to_jsonb(s);

INSERT INTO public.faa_aircraft_ref
SELECT s.* FROM faa_registry_20261021.aircraft_ref_staging AS s
WHERE NOT EXISTS (SELECT 1 FROM public.faa_aircraft_ref AS r WHERE r.code = s.code);
```

No detection tables are update targets. The retained archive is currently named `public.evidence_flight_dump_20260103_unsealed`; no separate sealed copy has been verified.
