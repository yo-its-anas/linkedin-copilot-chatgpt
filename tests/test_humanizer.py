"""Regression checks for meaningful Unicode and protected source material."""
import importlib.util
import unittest
from pathlib import Path

folder = Path(__file__).resolve().parents[1] / 'skills' / 'linkedin-humanize'
spec = importlib.util.spec_from_file_location('humanize', folder / 'humanize.py')
humanize = importlib.util.module_from_spec(spec)
spec.loader.exec_module(humanize)

class HumanizerTests(unittest.TestCase):
    def clean(self, value, normalize=False):
        return humanize.humanize(value, humanize.load_lexicon(), normalize)[0].rstrip('\n')

    def test_preserves_emoji_joiners_script_marks_and_spacing(self):
        value = '👩‍💻 می‌خواهم \u200fالعربية\u200e 10\u00a0kg 👨‍👩‍👧‍👦'
        self.assertEqual(self.clean(value), value)

    def test_preserves_default_typography(self):
        value = '“Good work”—a real quote…'
        self.assertEqual(self.clean(value), value)

    def test_protects_links_code_and_quotes(self):
        value = 'https://example.org/robust?x=leverage `robust` "leverage this"'
        self.assertEqual(self.clean(value), value)

    def test_optional_typography_changes_prose(self):
        self.assertEqual(self.clean('Hello—world', True), 'Hello, world')

    def test_lexical_suggestions_preserve_case(self):
        self.assertEqual(self.clean('Leverage this tool.'), 'Use this tool.')

if __name__ == '__main__':
    unittest.main()
