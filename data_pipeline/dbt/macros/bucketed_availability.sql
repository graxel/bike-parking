{#
  Average bikes/docks per station in fixed-size time buckets, over the last 8 days.
  Shared by the con_station_availability_<n>min models; averages are over station
  check-ins (rows of int_station_status) within each bucket.
#}
{% macro bucketed_availability(bucket_seconds) %}
SELECT
    station_id,
    to_timestamp(floor(extract(epoch FROM reported_at) / {{ bucket_seconds }}) * {{ bucket_seconds }}) AS bucket_start,
    ROUND(AVG(num_bikes_available), 1) AS avg_bikes_available,
    ROUND(AVG(num_docks_available), 1) AS avg_docks_available
FROM {{ ref('int_station_status') }}

{% if is_incremental() %}
    WHERE reported_at >= (
        SELECT GREATEST(
            MAX(bucket_start) - INTERVAL '2 hours',
            date_trunc('day', now() - interval '8 days')
        )
        FROM {{ this }}
    )
{% else %}
    WHERE reported_at >= date_trunc('day', NOW() - INTERVAL '8 days')
{% endif %}

GROUP BY
    station_id,
    to_timestamp(floor(extract(epoch FROM reported_at) / {{ bucket_seconds }}) * {{ bucket_seconds }})
{% endmacro %}
