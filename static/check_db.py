import sqlite3
con = sqlite3.connect("patents_clean.db")

print("=== Sample patent numbers ===")
rows = con.execute("SELECT patent_number, title, assignee FROM patents LIMIT 20").fetchall()
for r in rows:
    print(r)

print("\n=== Format counts ===")
rows = con.execute("""
    SELECT 
        CASE 
            WHEN patent_number GLOB 'HK3*' THEN 'HK3xxxxxxx (granted)'
            WHEN patent_number GLOB 'HK4*' THEN 'HK4xxxxxxx'
            WHEN patent_number GLOB 'HK1*' THEN 'HK1xxxxxxx'
            WHEN patent_number GLOB 'HK2*' THEN 'HK2xxxxxxx'
            ELSE 'other: '||substr(patent_number,1,4)
        END as fmt,
        COUNT(*) as cnt
    FROM patents
    GROUP BY fmt
    ORDER BY cnt DESC
""").fetchall()
for r in rows:
    print(r)