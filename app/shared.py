"""Shared utilities for all bike-parking microservices."""

import os
import yaml
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

load_dotenv("settings.env")
load_dotenv("secrets.env", override=True)


def get_db_connection():
    conn = psycopg2.connect(
        host=os.getenv("DB_HOST"),
        port=os.getenv("DB_PORT"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        dbname=os.getenv("DB_NAME"),
    )
    return conn


def load_groups():
    config_path = os.path.join(os.path.dirname(__file__), "config", "groups.yaml")
    if not os.path.exists(config_path):
        return []
    with open(config_path, "r") as f:
        data = yaml.safe_load(f)
    return data.get("groups", [])
