import logging

logger = logging.getLogger(__name__)

USER = {
    "id": "11111111-1111-1111-1111-111111111111",
    "email": "firstuser@gmail.com",
    "password_hash": "0o4nw38uqvq0493wg",
    "created_at": "2026-04-20T12:32:45Z",
    "updated_at": "2026-04-20T12:32:45Z",
}

GROUPS = [
    {
        "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
        "name": "Home",
        "description": None,
        "stations": [
            "66de482a-0aca-11e7-82f6-3863bb44ef7c",
            "66de4897-0aca-11e7-82f6-3863bb44ef7c",
            "66de1295-0aca-11e7-82f6-3863bb44ef7c",
        ],
    },
    {
        "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2",
        "name": "Subway",
        "description": None,
        "stations": [
            "66de4078-0aca-11e7-82f6-3863bb44ef7c",
        ],
    },
    {
        "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3",
        "name": "Work",
        "description": None,
        "stations": [
            "90c35466-db3c-4b0d-993e-6e92883773b4",
            "66db2afe-0aca-11e7-82f6-3863bb44ef7c",
        ],
    },
    {
        "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4",
        "name": "Gym",
        "description": None,
        "stations": [
            "bca594e5-779f-4866-bd6b-818871f97d38",
            "66de0d91-0aca-11e7-82f6-3863bb44ef7c",
        ],
    },
]

def seed_app_data(conn):
    logger.info("Seeding starter app data...")
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO app.users (
                id,
                email,
                password_hash,
                created_at,
                updated_at
            )
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE
            SET email = EXCLUDED.email,
                password_hash = EXCLUDED.password_hash,
                updated_at = EXCLUDED.updated_at;
        """, (
            USER["id"],
            USER["email"],
            USER["password_hash"],
            USER["created_at"],
            USER["updated_at"],
        ))

        for group in GROUPS:
            cur.execute("""
                INSERT INTO app.station_groups (
                    id,
                    user_id,
                    name,
                    description,
                    created_at,
                    updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE
                SET user_id = EXCLUDED.user_id,
                    name = EXCLUDED.name,
                    description = EXCLUDED.description,
                    updated_at = EXCLUDED.updated_at;
            """, (
                group["id"],
                USER["id"],
                group["name"],
                group["description"],
                USER["created_at"],
                USER["updated_at"],
            ))

            cur.execute("""
                DELETE FROM app.station_group_stations
                WHERE station_group_id = %s;
            """, (group["id"],))

            for sort_order, station_id in enumerate(group["stations"], start=1):
                cur.execute("""
                    INSERT INTO app.station_group_stations (
                        station_group_id,
                        station_id,
                        added_at,
                        sort_order
                    )
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (station_group_id, station_id) DO UPDATE
                    SET added_at = EXCLUDED.added_at,
                        sort_order = EXCLUDED.sort_order;
                """, (
                    group["id"],
                    station_id,
                    USER["created_at"],
                    sort_order,
                ))

    conn.commit()
    logger.info("Starter app data seeded successfully.")


if __name__ == "__main__":
    from data_pipeline.db_connection import get_db_connection

    conn = get_db_connection()
    try:
        seed_app_data(conn)
    finally:
        conn.close()