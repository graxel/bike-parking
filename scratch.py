import os
from app.shared import get_db_connection

query = """
EXPLAIN ANALYZE SELECT 
    h.station_id,
    h.reported_hour,
    h.min_docks_available,
    h.avg_docks_available,
    h.max_docks_available,
    sg.name as group_name
FROM consumption.con_station_availability_history h
JOIN app.station_group_stations sgs ON h.station_id = sgs.station_id
JOIN app.station_groups sg ON sgs.station_group_id = sg.id
WHERE sg.user_id = '11111111-1111-1111-1111-111111111111'
  AND h.reported_hour >= NOW() - INTERVAL '8 days'
ORDER BY h.reported_hour ASC;
"""
conn = get_db_connection()
with conn.cursor() as cur:
    cur.execute(query)
    rows = cur.fetchall()
    for r in rows:
        print(r[0])
