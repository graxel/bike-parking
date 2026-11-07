from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import patch, MagicMock

from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def mock_cursor(mock_db_conn, fetchall=None, fetchone=None):
    mock_conn = MagicMock()
    cur = mock_conn.cursor.return_value.__enter__.return_value
    if fetchall is not None:
        cur.fetchall.side_effect = fetchall
    if fetchone is not None:
        cur.fetchone.side_effect = fetchone
    mock_db_conn.return_value = mock_conn
    return cur


def ts(hour):
    return datetime(2026, 11, 4, hour, tzinfo=timezone.utc)


@patch('app.main.get_db_connection')
def test_map_stations(mock_db_conn):
    mock_cursor(
        mock_db_conn,
        fetchall=[[("a", "A St", 40.7, -74.0, 20)]],
        fetchone=[(ts(0), ts(5))],
    )
    res = client.get("/map/stations")
    assert res.status_code == 200
    body = res.json()
    assert body["stations"] == [{"id": "a", "name": "A St", "lat": 40.7, "lon": -74.0, "capacity": 20}]
    assert body["history_start"] == int(ts(0).timestamp())
    assert body["history_end"] == int(ts(5).timestamp())
    assert body["step_seconds"] == 900


@patch('app.main.get_db_connection')
def test_map_now_frame_format(mock_db_conn):
    mock_cursor(mock_db_conn, fetchall=[[("a", 3, 10, ts(1)), ("b", 0, 7, ts(2))]])
    res = client.get("/map/now")
    assert res.status_code == 200
    assert res.json() == {
        "stations": ["a", "b"],
        "frames": [{"t": int(ts(2).timestamp()), "docks": [3, 0], "bikes": [10, 7]}],
    }


def q(hour, minute):
    return int(datetime(2026, 11, 4, hour, minute, tzinfo=timezone.utc).timestamp())


@patch('app.main.get_db_connection')
def test_map_snapshots_aligns_frames_to_stations(mock_db_conn):
    mock_cursor(mock_db_conn, fetchall=[[
        (q(1, 0), "b", 5.0, 6.0),
        (q(1, 0), "a", 1.5, 2.0),
        (q(1, 15), "b", 7.0, 8.0),
        (q(1, 15), "a", 1.0, 2.5),
    ]])
    res = client.get("/map/snapshots", params={"start": "2026-11-04T01:00:00Z", "end": "2026-11-04T01:15:00Z"})
    assert res.status_code == 200
    assert res.json() == {
        "stations": ["a", "b"],
        "frames": [
            {"t": q(1, 0), "docks": [1.5, 5.0], "bikes": [2.0, 6.0]},
            {"t": q(1, 15), "docks": [1.0, 7.0], "bikes": [2.5, 8.0]},
        ],
    }
    assert "86400" in res.headers["cache-control"]


@patch('app.main.get_db_connection')
def test_map_snapshots_carries_forward_up_to_an_hour(mock_db_conn):
    # "a" last reported before the window starts; "b" reports throughout
    mock_cursor(mock_db_conn, fetchall=[[
        (q(0, 30), "a", 3.0, 4.0),
        *[(q(1, m), "b", 9.0, 9.0) for m in (0, 15, 30, 45)],
    ]])
    res = client.get("/map/snapshots", params={"start": "2026-11-04T01:00:00Z", "end": "2026-11-04T01:45:00Z"})
    frames = res.json()["frames"]
    assert [f["t"] for f in frames] == [q(1, m) for m in (0, 15, 30, 45)]
    # carried through 01:30 (one hour after 00:30), gone at 01:45
    assert [f["docks"][0] for f in frames] == [3.0, 3.0, 3.0, None]


@patch('app.main.get_db_connection')
def test_map_snapshots_skips_buckets_with_no_reports(mock_db_conn):
    # Nothing reports for over an hour in the middle: those buckets are omitted
    mock_cursor(mock_db_conn, fetchall=[[(q(1, 0), "a", 1.0, 1.0), (q(2, 30), "a", 2.0, 2.0)]])
    res = client.get("/map/snapshots", params={"start": "2026-11-04T01:00:00Z", "end": "2026-11-04T02:30:00Z"})
    assert [f["t"] for f in res.json()["frames"]] == [q(1, 0), q(1, 15), q(1, 30), q(1, 45), q(2, 0), q(2, 30)]


@patch('app.main.get_db_connection')
def test_map_snapshots_rejects_huge_span(mock_db_conn):
    res = client.get("/map/snapshots", params={"start": "2026-11-01T00:00:00Z", "end": "2026-11-04T00:00:00Z"})
    assert res.status_code == 400
    mock_db_conn.assert_not_called()


@patch('app.main.get_db_connection')
def test_station_hourly_series(mock_db_conn):
    mock_cursor(
        mock_db_conn,
        fetchone=[("a", "A St", 40.7, -74.0, 20, 4, 16, ts(3))],
        fetchall=[[(100, Decimal("4.5"), 3, 6, Decimal("15.5"), 14, 17)]],
    )
    res = client.get("/station/a")
    assert res.status_code == 200
    body = res.json()
    assert body["station"]["bikes"] == 4
    assert body["resolution"] == "hour"
    assert body["series"]["t"] == [100]
    assert body["series"]["bikes_avg"] == [4.5]
    assert body["series"]["docks_max"] == [17.0]


@patch('app.main.get_db_connection')
def test_station_raw_series(mock_db_conn):
    mock_cursor(
        mock_db_conn,
        fetchone=[("a", "A St", 40.7, -74.0, 20, 4, 16, ts(3))],
        fetchall=[[(100, 4, 16), (160, 5, 15)]],
    )
    res = client.get("/station/a", params={"resolution": "raw", "days": 3})
    assert res.status_code == 200
    assert res.json()["series"] == {"t": [100, 160], "bikes": [4.0, 5.0], "docks": [16.0, 15.0]}


@patch('app.main.get_db_connection')
def test_station_not_found(mock_db_conn):
    mock_cursor(mock_db_conn, fetchone=[None])
    assert client.get("/station/nope").status_code == 404


@patch('app.main.get_db_connection')
def test_map_snapshots_5_minute_step(mock_db_conn):
    cur = mock_cursor(mock_db_conn, fetchall=[[(q(1, 0), "a", 1.0, 1.0), (q(1, 5), "a", 2.0, 2.0)]])
    res = client.get("/map/snapshots", params={"start": "2026-11-04T01:00:00Z", "end": "2026-11-04T01:10:00Z", "step": 300})
    assert res.status_code == 200
    assert "con_station_availability_5min" in cur.execute.call_args[0][0]
    # 01:10 has no row of its own; 01:05 is carried forward
    assert [(f["t"], f["docks"][0]) for f in res.json()["frames"]] == [(q(1, 0), 1.0), (q(1, 5), 2.0), (q(1, 10), 2.0)]


@patch('app.main.get_db_connection')
def test_map_rejects_unknown_step(mock_db_conn):
    assert client.get("/map/stations", params={"step": 60}).status_code == 400
    res = client.get("/map/snapshots", params={"start": "2026-11-04T01:00:00Z", "end": "2026-11-04T01:10:00Z", "step": 60})
    assert res.status_code == 400
    mock_db_conn.assert_not_called()
