{{ config(
    materialized='incremental',
    unique_key='station_id',  -- Each station only has 1 row
    incremental_strategy='merge'  -- or 'delete+insert'
) }}
 
SELECT
    station_id,
    station_name,
    lat,
    lon,
    num_bikes_available,
    num_docks_available,
    capacity,
    reported_at
FROM {{ ref('int_station_status') }}
 
{% if is_incremental() %}
    -- Only get records newer than what we currently have
    WHERE reported_at > (SELECT MAX(reported_at) FROM {{ this }})
{% endif %}
