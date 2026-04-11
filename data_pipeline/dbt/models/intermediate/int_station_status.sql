{{ 
    config(
        materialized='incremental',
        unique_key=['station_id', 'reported_at']
    ) 
}}

WITH new_data AS (
    SELECT 
        s.station_id,
        i.name as station_name,
        i.lat,
        i.lon,
        s.num_bikes_available,
        s.num_docks_available,
        s.last_reported as reported_at,
        s.ingested_at
    FROM {{ ref('stg_station_status') }} s
    LEFT JOIN {{ ref('stg_station_information') }} i
        ON s.station_id = i.station_id
        
    {% if is_incremental() %}
        -- This ensures we only look at rows ingested since the last dbt run
        -- instead of scanning the entire staging history
        WHERE s.ingested_at > (SELECT MAX(ingested_at) FROM {{ this }})
    {% endif %}
)

-- Now we only run our DISTINCT ON sorting on the small batch of new data
SELECT DISTINCT ON (station_id, reported_at)
    station_id,
    station_name,
    lat,
    lon,
    num_bikes_available,
    num_docks_available,
    reported_at,
    ingested_at
FROM new_data
ORDER BY station_id, reported_at, ingested_at DESC
