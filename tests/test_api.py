import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
from app.main import app

DUMMY_GROUPS = [
    {
        "name": "Test Home Group",
        "stations": ["test-uuid-1"]
    }
]

@patch('app.main.load_groups')
def test_read_groups_route(mock_load):
    mock_load.return_value = DUMMY_GROUPS
    with TestClient(app) as test_client:
        response = test_client.get("/api/groups")
        assert response.status_code == 200
        assert response.json() == {"groups": DUMMY_GROUPS}

@patch('app.main.load_groups')
@patch('app.main.get_db_connection')
def test_current_availability_mocks_database(mock_db_conn, mock_load):
    mock_load.return_value = DUMMY_GROUPS
    
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
    
    # Mocking rows coming out of the DB query via psycopg2
    mock_cursor.fetchall.return_value = [
        {
            "station_id": "test-uuid-1",
            "station_name": "W 21st St & 6th Ave",
            "lat": 40.7,
            "lon": -74.0,
            "num_bikes_available": 14,
            "num_docks_available": 20,
            "last_reported": None
        }
    ]
    mock_db_conn.return_value = mock_conn
    
    with TestClient(app) as test_client:
        response = test_client.get("/api/availability/current")
        assert response.status_code == 200
        
        data = response.json().get("data", [])
        assert len(data) == 1
        assert data[0]["name"] == "Test Home Group"
        assert len(data[0]["stations"]) == 1
        
        station_data = data[0]["stations"][0]
        assert station_data["station_id"] == "test-uuid-1"
        assert station_data["num_bikes_available"] == 14
