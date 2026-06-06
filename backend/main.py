"""
FastAPI backend for the Medical AI Research Agent.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from agent import run_research_agent, ResearchReport

app = FastAPI(title="Research Agent API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class QueryRequest(BaseModel):
    query: str


class QueryResponse(BaseModel):
    success: bool
    report: ResearchReport | None = None
    error: str | None = None


@app.get("/health")
def health():
    return {"status": "ok", "agent": "Research Agent v1.0"}


@app.post("/research", response_model=QueryResponse)
def research(req: QueryRequest):
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")
    try:
        report = run_research_agent(req.query.strip())
        return QueryResponse(success=True, report=report)
    except Exception as e:
        return QueryResponse(success=False, error=str(e))
