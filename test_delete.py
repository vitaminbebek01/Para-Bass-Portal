from etsy_hybrid_module.db_handler import delete_erank_keyword, get_all_erank_keywords
import sys

try:
    data = get_all_erank_keywords()
    if data:
        print(f"Total records: {len(data)}")
        first_id = data[0]['id']
        print(f"Attempting to delete ID: {first_id}")
        delete_erank_keyword(first_id)
        print("Delete single successful!")
        
        if len(data) > 1:
            second_id = data[1]['id']
            print(f"Attempting to delete ID list: {[second_id]}")
            delete_erank_keyword([second_id])
            print("Delete list successful!")
    else:
        print("No records to delete.")
except Exception as e:
    print(f"Error: {e}")
