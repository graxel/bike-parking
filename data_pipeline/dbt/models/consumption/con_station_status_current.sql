{{ config(
    materialized='incremental',
    unique_key='station_id',
    incremental_strategy='delete+insert',
    tags=['current']
) }}
 
SELECT DISTINCT ON (station_id)
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
      AND reported_at >= date_trunc('hour', now() - interval '2 hours')
{% else %}
    WHERE reported_at >= date_trunc('hour', now() - interval '2 hours')
{% endif %}
ORDER BY station_id, reported_at DESC
