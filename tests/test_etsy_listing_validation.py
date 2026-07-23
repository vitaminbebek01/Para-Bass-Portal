import unittest
from pathlib import Path

from etsy_hybrid_module.gemini_rag_engine import (
    build_listing_prompt,
    build_short_title,
    comparison_key,
    finalize_full_title,
    prepare_locked_tags,
    validate_and_finalize_listing,
)


ROOT = Path(__file__).resolve().parents[1]
RULES_PATH = ROOT / "etsy_hybrid_module" / "etsy_rules_compact.md"


class EtsyListingValidationTests(unittest.TestCase):
    def test_confirmed_product_details_are_added_without_empty_values(self):
        prompt = build_listing_prompt(
            [],
            RULES_PATH,
            product_type="Epoxy Magnet",
            product_details={
                "material": "epoxy and dried flowers",
                "color": "ivory",
                "price": "",
            },
        )

        self.assertIn("epoxy and dried flowers", prompt)
        self.assertIn('"color": "ivory"', prompt)
        self.assertNotIn('"price"', prompt)
        self.assertIn("YENİ BİLGİ UYDURMA", prompt)

    def setUp(self):
        keywords = [
            "wedding candle", "wedding favor", "wedding decor", "candle gift",
            "party candle", "bridal shower", "guest favor", "table decor",
            "small candle", "event favor", "elegant favor", "party favor",
            "wedding keepsake", "candle decor", "bridal favor", "guest gift",
            "event candle", "wedding table", "favor candle", "party keepsake",
            "wedding token", "bridal keepsake", "event keepsake",
        ]
        self.erank = [
            {"keyword": keyword, "searches": 1000 - index, "competition": 5000 + index}
            for index, keyword in enumerate(keywords)
        ]

    def test_prompt_contains_custom_keyword_and_all_concepts(self):
        prompt = build_listing_prompt(
            self.erank,
            str(RULES_PATH),
            product_type="Candle",
            selected_concepts=["Wedding", "Baby Shower", "Birthday"],
            custom_keyword="rustic candle favor",
        )
        self.assertIn("- Wedding", prompt)
        self.assertIn("- Baby Shower", prompt)
        self.assertIn("- Birthday", prompt)
        self.assertIn("- rustic candle favor", prompt)
        self.assertIn("140 characters or fewer", prompt)
        self.assertNotIn("PDF KURALLARI (ANAYASA)", prompt)

    def test_blank_custom_keyword_adds_no_placeholder_section(self):
        prompt = build_listing_prompt(
            self.erank,
            str(RULES_PATH),
            product_type="Candle",
            selected_concepts=["Wedding"],
            custom_keyword="   ",
        )
        self.assertNotIn("KULLANICININ ÖZEL ANAHTAR KELİMESİ", prompt)
        self.assertNotIn("None", prompt)

    def test_full_and_short_titles_keep_word_boundaries(self):
        raw_title = (
            "Personalized Wedding Candle Favor, Elegant Bridal Shower Table Decoration, "
            "Handmade Guest Keepsake, Premium Celebration Gift, Premium Celebration Gift"
        )
        full_title = finalize_full_title(raw_title)
        short_title = build_short_title(full_title)
        self.assertLessEqual(len(full_title), 140)
        self.assertLessEqual(len(short_title), 70)
        self.assertTrue(full_title.startswith(short_title))
        self.assertNotIn("Premium Celebration Gift, Premium Celebration Gift", full_title)

    def test_locked_tag_normalization_preserves_first_display_form(self):
        self.assertEqual(prepare_locked_tags([" Baby   Shower "]), ["Baby Shower"])
        with self.assertRaisesRegex(ValueError, "birden fazla"):
            prepare_locked_tags(["Baby Shower", " baby   shower "])
        with self.assertRaisesRegex(ValueError, "20 karakter"):
            prepare_locked_tags(["personalized wedding keepsake"])

    def test_tags_are_unique_relevant_and_locked_tag_is_unchanged(self):
        result = {
            "title": "Elegant Wedding Candle Favor for a Bridal Celebration",
            "tags": [
                "Baby Shower", "wedding candle", "Wedding Candle",
                "this tag is far too long", "casino poker",
            ],
            "backup_tags": ["wedding favor", "wedding decor", "candle gift"],
            "description": "A premium wedding candle favor.",
        }
        finalized = validate_and_finalize_listing(
            result,
            self.erank,
            product_type="Candle",
            selected_concepts=["Wedding", "Baby Shower"],
            locked_tags=["Baby Shower"],
        )
        tags = [item["keyword"] for item in finalized["tags"]]
        keys = [comparison_key(tag) for tag in tags]
        self.assertEqual(len(tags), 13)
        self.assertEqual(len(set(keys)), 13)
        self.assertTrue(all(len(tag) <= 20 for tag in tags))
        self.assertEqual(tags[0], "Baby Shower")
        self.assertEqual(tags[1:5], ["wedding candle", "wedding favor", "wedding decor", "candle gift"])
        self.assertNotIn("casino poker", tags)
        self.assertLessEqual(len(finalized["title"]), 140)
        self.assertLessEqual(len(finalized["short_title"]), 70)


if __name__ == "__main__":
    unittest.main()
