import unittest
from unittest.mock import patch

from etsy_hybrid_module import db_handler
from etsy_hybrid_module.erank_scoring import (
    calculate_keyword_score,
    clean_erank_records,
    parse_erank_csv,
)


class ErankScoringTests(unittest.TestCase):
    def test_latest_duplicate_row_wins_and_low_volume_is_removed(self):
        csv_content = """Keyword,Average Searches,Average Clicks,Average CTR,Etsy Competition,Trend Change
epoxy magnet,100,60,60%,2500,5%
low volume phrase,20,10,50%,1000,0%
epoxy magnet,150,90,70%,3000,10%
high competition phrase,500,350,80%,150000,12%
"""
        records, stats, _ = parse_erank_csv(csv_content, "Epoxy Magnet")
        by_keyword = {item["keyword"]: item for item in records}

        self.assertEqual(len(records), 2)
        self.assertEqual(by_keyword["epoxy magnet"]["searches"], 150)
        self.assertEqual(by_keyword["epoxy magnet"]["competition"], 3000)
        self.assertEqual(stats["duplicates_collapsed"], 1)
        self.assertEqual(stats["rejected_low_search"], 1)
        self.assertEqual(stats["high_competition"], 1)

    def test_click_ctr_and_trend_data_affect_score(self):
        basic = calculate_keyword_score(300, 10000, word_count=2)
        enriched = calculate_keyword_score(
            300,
            10000,
            clicks=300,
            ctr=100,
            trend=50,
            word_count=2,
        )
        weak_engagement = calculate_keyword_score(
            300,
            10000,
            clicks=10,
            ctr=5,
            trend=-50,
            word_count=2,
        )
        self.assertGreater(enriched, basic)
        self.assertGreater(basic, weak_engagement)
        self.assertTrue(0 <= enriched <= 100)

    def test_dashboard_cleanup_keeps_newest_concept_keyword(self):
        newest_first = [
            {"id": 3, "concept": "Epoxy Magnet", "keyword": "Epoxy Magnet", "searches": 150, "competition": 3000, "score": 70},
            {"id": 2, "concept": "Epoxy Magnet", "keyword": " epoxy   magnet ", "searches": 100, "competition": 2500, "score": 60},
            {"id": 1, "concept": "Wedding", "keyword": "low volume tag", "searches": 20, "competition": 100, "score": 80},
        ]
        cleaned = clean_erank_records(newest_first)
        self.assertEqual(len(cleaned), 1)
        self.assertEqual(cleaned[0]["id"], 3)
        self.assertEqual(cleaned[0]["searches"], 150)

    def test_new_csv_is_inserted_before_old_concept_rows_are_removed(self):
        fake_supabase = FakeSupabase([
            {"id": 1, "concept": "Epoxy Magnet", "keyword": "epoxy magnet", "searches": 100},
            {"id": 2, "concept": "Epoxy Magnet", "keyword": "magnet favor", "searches": 80},
        ])
        incoming = [
            {"concept": "Epoxy Magnet", "keyword": "epoxy magnet", "searches": 150, "competition": 3000, "score": 70},
            {"concept": "Epoxy Magnet", "keyword": "epoxy party favor", "searches": 120, "competition": 4000, "score": 65},
        ]

        with patch.object(db_handler, "supabase", fake_supabase):
            result = db_handler.replace_erank_keywords_for_concept("Epoxy Magnet", incoming)

        self.assertEqual(fake_supabase.events, ["select", "insert", "delete"])
        self.assertEqual(result["updated"], 1)
        self.assertEqual(result["replaced_old_rows"], 2)
        self.assertEqual({row["keyword"] for row in fake_supabase.rows}, {"epoxy magnet", "epoxy party favor"})


class FakeResponse:
    def __init__(self, data):
        self.data = data


class FakeTable:
    def __init__(self, database):
        self.database = database
        self.operation = None
        self.concept = None
        self.records = None
        self.ids = None

    def select(self, _columns):
        self.operation = "select"
        return self

    def eq(self, column, value):
        if column == "concept":
            self.concept = value
        return self

    def insert(self, records):
        self.operation = "insert"
        self.records = [dict(record) for record in records]
        return self

    def delete(self):
        self.operation = "delete"
        return self

    def in_(self, column, values):
        if column == "id":
            self.ids = set(values)
        return self

    def execute(self):
        self.database.events.append(self.operation)
        if self.operation == "select":
            return FakeResponse([
                {"id": row["id"], "keyword": row["keyword"]}
                for row in self.database.rows
                if row.get("concept") == self.concept
            ])
        if self.operation == "insert":
            next_id = max([row.get("id", 0) for row in self.database.rows] + [0]) + 1
            inserted = []
            for offset, record in enumerate(self.records):
                item = dict(record)
                item["id"] = next_id + offset
                self.database.rows.append(item)
                inserted.append(item)
            return FakeResponse(inserted)
        if self.operation == "delete":
            self.database.rows = [row for row in self.database.rows if row.get("id") not in self.ids]
            return FakeResponse([])
        raise AssertionError("Beklenmeyen sahte Supabase işlemi")


class FakeSupabase:
    def __init__(self, rows):
        self.rows = [dict(row) for row in rows]
        self.events = []

    def table(self, _name):
        return FakeTable(self)


if __name__ == "__main__":
    unittest.main()
