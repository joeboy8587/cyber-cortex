import importlib.util
import unittest

spec = importlib.util.spec_from_file_location("faa_stage_registry", "scripts/faa-stage-registry.py")
if spec is None or spec.loader is None:
    raise RuntimeError("Staging module not found")
stage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage)


class StagingSafetyTests(unittest.TestCase):
    def test_staging_never_writes_source_or_current_registry(self):
        statement = stage.insert_statement("master_staging", ["n_number", "name"], [{"n_number": "913KC", "name": "O'BRIEN"}])
        self.assertIn('INSERT INTO faa_registry_20261021."master_staging"', statement["query"])
        self.assertNotIn("O'BRIEN", statement["query"])
        self.assertEqual(statement["params"][0][0]["name"], "O'BRIEN")

    def test_evidence_tables_cannot_be_import_targets(self):
        with self.assertRaises(ValueError):
            stage.insert_statement("evidence_flight_dump_20260103_unsealed", ["id"], [])

    def test_all_five_coowner_fields_keep_existing_names(self):
        for i in range(1, 6):
            self.assertEqual(stage.column_name(f"OTHER NAMES({i})"), f"other_names_{i}_")


if __name__ == "__main__":
    unittest.main()