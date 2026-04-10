{{ config(materialized='table') }}

SELECT
    station_id,
    station_name,
    lat,
    lon,
    DATE_TRUNC('hour', reported_at) as reported_hour,
    MIN(num_bikes_available) as min_bikes_available,
    MAX(num_bikes_available) as max_bikes_available,
    ROUND(AVG(num_bikes_available), 1) as avg_bikes_available,
    MIN(num_docks_available) as min_docks_available,
    MAX(num_docks_available) as max_docks_available,
    ROUND(AVG(num_docks_available), 1) as avg_docks_available
FROM {{ ref('int_station_status') }}
WHERE reported_at >= CURRENT_DATE - INTERVAL '8 days'
GROUP BY 
    station_id,
    station_name,
    lat,
    lon,
    DATE_TRUNC('hour', reported_at)
ORDER BY 
    station_id, 
    reported_hour ASC
