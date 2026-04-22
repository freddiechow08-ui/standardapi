import sqlite3
con = sqlite3.connect("patents_clean.db")

# Show non-fake patent numbers
rows = con.execute("""
    SELECT patent_number FROM patents 
    WHERE patent_number NOT IN (
        'HK123456','HK234567','HK345678','HK456789','HK567890',
        'HK678901','HK789012','HK890123','HK901234','HK012345'
    )
    AND patent_number != ''
    LIMIT 30
""").fetchall()

print("=== Real patent numbers ===")
for r in rows:
    print(r[0])