{{ config(
    materialized='incremental',
    unique_key='station_id',
    incremental_strategy='merge'
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
    WHERE reported_at > (SELECT MAX(reported_at) FROM {{ this }})
{% endif %}
