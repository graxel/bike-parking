import os
import pytest
import signal
import requests
import psycopg2
from unittest.mock import patch, MagicMock
from data_pipeline.ingest import main as ingest_main, timeout_handler

# 1. Test Network Timeout Handling
@patch('data_pipeline.ingest_data.requests.get')
def test_requests_timeout_resilience(mock_get):
    """
    Demonstrates that the system correctly handles a network timeout.
    The 'timeout' parameter in requests.get should raise a Timeout exception.
    """
    mock_get.side_effect = requests.exceptions.Timeout("API hung!")
    
    # We expect the ingestion to catch this and log an error before raising
    # Note: ingest.py catches Exception and re-raises
    with pytest.raises(requests.exceptions.Timeout):
        # We need to mock the connection so it doesn't try to connect for real
        with patch('data_pipeline.ingest.get_db_connection') as mock_conn:
            ingest_main()

# 2. Test DB Connection Timeout Handling
@patch('psycopg2.connect')
def test_db_connection_timeout_resilience(mock_connect):
    """
    Demonstrates that if the database is down or unreachable, 
    the system fails fast with a timeout.
    """
    mock_connect.side_effect = psycopg2.OperationalError("timeout expired")
    
    with pytest.raises(psycopg2.OperationalError):
        ingest_main()

# 3. Test Signal Alarm (The 'Dead Man's Switch')
def test_timeout_handler_logic():
    """
    Verifies that the custom timeout handler actually raises a TimeoutError.
    This is the mechanism used in ingest.py as a final fail-safe.
    """
    with pytest.raises(TimeoutError, match="The ingestion process timed out after 18 seconds!"):
        timeout_handler(signal.SIGALRM, MagicMock())

# 4. Test Idempotency (ON CONFLICT)
@patch('data_pipeline.ingest_data.execute_values')
def test_ingestion_idempotency(mock_execute):
    """
    Demonstrates that we use 'ON CONFLICT' to handle duplicate data.
    This ensures that running the same ingest twice doesn't crash the pipeline.
    """
    # This is a unit test of the logic in ingest_data.py
    from data_pipeline.ingest_data import ingest_information
    
    mock_conn = MagicMock()
    with patch('data_pipeline.ingest_data.requests.get') as mock_get:
        mock_get.return_value.json.return_value = {
            "data": {"stations": [{"station_id": "1", "name": "Test"}]}
        }
        
        ingest_information(mock_conn)
        
        # Verify the query includes 'ON CONFLICT'
        # mock_execute is called with (cursor, query, values)
        args, kwargs = mock_execute.call_args
        query = args[1]
        assert "ON CONFLICT" in query
        assert "DO UPDATE" in query

# 5. Path Calculation (Demonstrates Interoperability)
def test_dag_path_calculation():
    """
    Verifies that the DAG correctly calculates paths for interoperability.
    This ensures the 'exec' command in Airflow will find the right binaries.
    """
    from data_pipeline.dags.citibike_ingest_dag import PROJECT_ROOT, VENV_PYTHON
    
    # Check that paths are absolute and point to expected locations
    assert os.path.isabs(PROJECT_ROOT)
    assert os.path.isabs(VENV_PYTHON)
    assert "bike-parking" in PROJECT_ROOT
    assert VENV_PYTHON.endswith("/bin/python")
