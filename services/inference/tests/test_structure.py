from pathlib import Path
import unittest


class InferenceStructureTest(unittest.TestCase):
  def test_internal_routes_exist(self) -> None:
    source = Path("src/pronunciation_mirror_inference/main.py").read_text()

    self.assertIn("/internal/health", source)
    self.assertIn("/internal/ipa", source)
    self.assertIn("/internal/tts", source)
    self.assertIn("X-Internal-API-Key", source)


if __name__ == "__main__":
  unittest.main()
