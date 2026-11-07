from app.shared import get_db_connection
from psycopg2.extras import RealDictCursor

conn = get_db_connection()
with conn.cursor(cursor_factory=RealDictCursor) as cur:
    cur.execute("SELECT COUNT(*) FROM consumption.con_station_availability_history;")
    print("History count:", cur.fetchone())
    
    cur.execute("SELECT COUNT(*) FROM app.station_groups WHERE user_id = '11111111-1111-1111-1111-111111111111';")
    print("Groups count:", cur.fetchone())

    cur.execute("""
        SELECT COUNT(*)
        FROM consumption.con_station_availability_history h
        JOIN app.station_group_stations sgs ON h.station_id = sgs.station_id
        JOIN app.station_groups sg ON sgs.station_group_id = sg.id
        WHERE sg.user_id = '11111111-1111-1111-1111-111111111111'
    """)
    print("Join count:", cur.fetchone())
conn.close()
