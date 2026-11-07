{{ config(
    materialized='incremental',
    unique_key=['station_id', 'bucket_start'],
    tags=['history'],
    post_hook=[
        "DELETE FROM {{ this }} WHERE bucket_start < date_trunc('day', NOW() - INTERVAL '8 days');",
        "CREATE INDEX IF NOT EXISTS con_station_availability_15min_bucket_idx ON {{ this }} (bucket_start);",
        "CREATE INDEX IF NOT EXISTS con_station_availability_15min_station_bucket_idx ON {{ this }} (station_id, bucket_start);"
    ]
) }}

-- 15-minute buckets for the map's time tape (same as con_station_availability_history, finer)
{{ bucketed_availability(900) }}
