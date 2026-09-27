import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parents[2]))
from migration.tests.conftest import DSN, db  # noqa: E402,F401  (same fixture: fresh core schema in the test database)
