{{ 
    config(
        materialized='table'
    ) 
}}

WITH hourly_stats AS (
    SELECT
        station_id,
        DATE_TRUNC('hour', reported_at) as reported_hour,
        AVG(wait_time_seconds) as avg_wait_time_seconds,
        COUNT(*) FILTER (WHERE num_docks_available = 0) * 1.0 / NULLIF(COUNT(*), 0) as proportion_full
    FROM {{ ref('int_station_wait_times') }}
    GROUP BY 1, 2
),

station_info AS (
    SELECT DISTINCT ON (station_id)
        station_id,
        station_name,
        lat,
        lon
    FROM {{ ref('int_station_status') }}
    ORDER BY station_id, reported_at DESC
)

SELECT
    s.station_id,
    i.station_name,
    i.lat,
    i.lon,
    s.reported_hour,
    ROUND((s.avg_wait_time_seconds / 60.0)::numeric, 2) as expected_wait_time_minutes,
    ROUND(s.proportion_full::numeric, 4) as proportion_full
FROM hourly_stats s
JOIN station_info i ON s.station_id = i.station_id
ORDER BY s.reported_hour DESC, s.station_id
