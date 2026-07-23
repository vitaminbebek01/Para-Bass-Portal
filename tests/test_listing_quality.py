import unittest

from etsy_hybrid_module.listing_quality import calculate_listing_readiness


class ListingQualityTests(unittest.TestCase):
    def test_complete_listing_has_explainable_high_score(self):
        details = {
            "material": "epoxy",
            "color": "ivory",
            "quantity": "set of 10",
            "personalization": "name and date",
            "occasion": "wedding",
            "packaging": "White Box",
            "processing_time": "1-5 business days",
            "price": "24.90",
            "stock": "10",
            "product_notes": "Handmade finished magnet favor.",
        }
        listing = {
            "title": "Personalized Epoxy Magnet Wedding Favor with Ivory Flowers",
            "tags": [{"keyword": f"valid tag {index}"} for index in range(1, 14)],
            "description": "A" * 600,
            "category_suggestion": "Party Favors",
            "attributes": ["Ivory", "Epoxy"],
        }
        photos = [
            {"brightness": 120, "sharpness": 20}
            for _ in range(5)
        ]

        result = calculate_listing_readiness(details, listing, photos)

        self.assertGreaterEqual(result["score"], 85)
        self.assertEqual(sum(result["breakdown"].values()), result["score"])
        self.assertIn("Etsy sıralama garantisi değil", result["disclaimer"])

    def test_missing_inputs_produce_actionable_warnings(self):
        result = calculate_listing_readiness({}, {}, [])

        self.assertLess(result["score"], 50)
        self.assertTrue(result["warnings"])
        self.assertEqual(result["breakdown"]["photo_quality"], 0)


if __name__ == "__main__":
    unittest.main()
