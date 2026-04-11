{{ config(materialized='table') }}

SELECT DISTINCT ON (station_id)
    station_id,
    station_name,
    lat,
    lon,
    num_bikes_available,
    num_docks_available,
    reported_at
FROM {{ ref('int_station_status') }}
ORDER BY station_id, reported_at DESC
