"""DEV/E2E ONLY. Replaces the trained model with a rule stub so the stack can run
without ml/artifacts. Scores are NOT from the Random Forest."""
import sys, json
import smartguard_api.inference as inf
class Stub:
    is_available=True; load_error=None
    def __init__(self,*a,**k): pass
    def load(self): pass
    def score(self,f):
        v=0.10
        if f.get("geographic_risk"): v+=0.45
        if not f.get("device_consistency"): v+=0.35
        return inf.RiskAssessment(risk_score=round(min(v,1.0),4),model_version="dev-stub",latency_ms=5,exceeded_budget=False,
            contributions=[{"feature":"counterparty_reputation","value":0.9,"importance":0.19}])
inf.RiskScorer=Stub
from smartguard_api.db import SessionLocal, create_all
from smartguard_api.models import User
from smartguard_api.seed import seed_users
create_all()
d=json.load(open('deployed.json'))
with SessionLocal() as db:
    if not db.query(User).count(): seed_users(db)
    for role,addr in zip(('buyer','seller','arbitrator','admin'),d['accounts']):
        u=db.query(User).filter(User.role==role).first()
        if u: u.wallet_address=addr
    db.commit()
import uvicorn
from smartguard_api.main import app
uvicorn.run(app,host="127.0.0.1",port=8000,log_level="warning")
