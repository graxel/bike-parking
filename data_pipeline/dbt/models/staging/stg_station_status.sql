SELECT
    (raw_json->>'station_id')::varchar as station_id,
    (raw_json->>'num_bikes_available')::int as num_bikes_available,
    (raw_json->>'num_docks_available')::int as num_docks_available,
    (raw_json->>'num_bikes_disabled')::int as num_bikes_disabled,
    (raw_json->>'num_docks_disabled')::int as num_docks_disabled,
    (raw_json->>'is_installed')::boolean as is_installed,
    (raw_json->>'is_renting')::boolean as is_renting,
    (raw_json->>'is_returning')::boolean as is_returning,
    to_timestamp((raw_json->>'last_reported')::numeric) as last_reported,
    ingested_at
FROM {{ source('raw', 'station_status') }}
