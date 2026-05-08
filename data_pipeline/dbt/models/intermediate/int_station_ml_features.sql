{{ config(materialized='table') }}

SELECT
    station_id,
    station_name,
    DATE_TRUNC('hour', reported_at) as ds,
    ROUND(AVG(num_bikes_available), 1) as y
FROM {{ ref('int_station_status') }}
GROUP BY
    station_id,
    station_name,
    DATE_TRUNC('hour', reported_at)
