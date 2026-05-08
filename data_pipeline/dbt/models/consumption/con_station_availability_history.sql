{{ config(
    materialized='incremental',
    unique_key=['station_id', 'reported_hour'],
    incremental_strategy='delete+insert',
    incremental_predicates = [
        "DBT_INTERNAL_DEST.reported_hour >= date_trunc('hour', now() - interval '2 hours')"
    ],
    tags=['history']
) }}

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

{% if is_incremental() %}
    WHERE DATE_TRUNC('hour', reported_at) >= (
        SELECT GREATEST(
            MAX(reported_hour) - INTERVAL '2 hours',
            date_trunc('hour', now() - interval '8 hours')
        )
        FROM {{ this }}
    )
{% else %}
    WHERE reported_at >= CURRENT_DATE - INTERVAL '7 days'
{% endif %}

GROUP BY 
    station_id,
    station_name,
    lat,
    lon,
    DATE_TRUNC('hour', reported_at)
