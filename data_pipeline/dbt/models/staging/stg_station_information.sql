SELECT
    station_id,
    (raw_json->>'name')::varchar as name,
    (raw_json->>'lat')::float as lat,
    (raw_json->>'lon')::float as lon,
    (raw_json->>'capacity')::int as capacity,
    (raw_json->>'has_kiosk')::boolean as has_kiosk,
    (raw_json->>'region_id')::varchar as region_id,
    ingested_at
FROM {{ source('raw', 'station_information') }}
