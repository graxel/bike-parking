{{ 
    config(
        materialized='table'
    ) 
}}

WITH status_reports AS (
    SELECT
        station_id,
        reported_at,
        num_docks_available
    FROM {{ ref('int_station_status') }}
),

next_availability AS (
    SELECT
        station_id,
        reported_at,
        num_docks_available,
        -- Find the first timestamp at or after this one where num_docks_available > 0
        -- We include CURRENT ROW because if num_docks_available > 0 right now, wait is 0
        MIN(CASE WHEN num_docks_available > 0 THEN reported_at ELSE NULL END) 
            OVER (
                PARTITION BY station_id 
                ORDER BY reported_at 
                ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING
            ) as next_dock_available_at
    FROM status_reports
)

SELECT
    station_id,
    reported_at,
    num_docks_available,
    next_dock_available_at,
    CASE 
        WHEN num_docks_available > 0 THEN 0
        WHEN next_dock_available_at IS NOT NULL THEN 
            EXTRACT(EPOCH FROM (next_dock_available_at - reported_at))
        ELSE NULL -- Still full or unknown
    END as wait_time_seconds
FROM next_availability
