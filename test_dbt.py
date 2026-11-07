import os
import subprocess
from dotenv import load_dotenv

load_dotenv("settings.env")
load_dotenv("secrets.env", override=True)

subprocess.run(["uv", "run", "dbt", "run", "--select", "con_station_availability_history"], cwd="data_pipeline/dbt", env=os.environ)
