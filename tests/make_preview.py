"""Generate deterministic UI snapshots for browser verification, not production."""
import copy
import json
import time
from pathlib import Path
from unittest.mock import patch
from tests.test_events import setup, match
from app import game, events

room = match.__wrapped__(setup.__wrapped__())
state = room.game
now = time.time()
state["world"]["trails"] = [{"column": 16, "ring": "C"}]
state["world"]["black_domains"] = [{"column": 8, "ring": "B"}]
state["crews"]["a"]["ships"][0].update(column=22, ring="A", phased=True)
out = {}

def snap(name):
    out[name] = copy.deepcopy(room.snapshot("a"))

snap("board")
state["phase"] = "placement"
snap("placement")
state["phase"] = "battle"
events.pending(state,"event_card",3.2,owner="a",number=1,deck="nebula",card="gear-up",label="前进档位 +1")
state["pending"]["started_at"] = now - 1.3
snap("card")
events.pending(state,"world_coordinate",4,purpose="fragments",stage="opposite",coordinate={"column":14,"ring":"A","die6":1},opposite={"column":2,"ring":"C"})
snap("coordinates")
events.pending(state,"droplet_roll",2,stage="result",roll=23)
snap("droplet")
events.pending(state,"fragment_check",2,owner="a",number=1,stage="result",roll=18,success=True)
snap("fragment")
Path(__file__).parents[2].joinpath("v3-preview.json").write_text(json.dumps(out,ensure_ascii=False),encoding="utf-8")
