from pathlib import Path
import logging

logger = logging.getLogger(__name__)

def get_project_root(start: Path = Path(__file__).resolve()) -> Path:
    """
    Search upwards for a 'pyproject.toml' to identify the project root.
    If not found, fallback to the current working directory.
    """
    for p in start.parents:
        if (p / 'pyproject.toml').exists():
            return p
    logger.warning("Could not find project root containing 'pyproject.toml'. Falling back to CWD.")
    return Path.cwd()

if __name__ == "__main__":
    # Test the root finder
    print(f"Project root identified as: {get_project_root()}")
