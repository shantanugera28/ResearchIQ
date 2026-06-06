"""
Research Agent — LangGraph agentic workflow with PydanticAI structured output.

Flow:
  START → search_web → fetch_arxiv → synthesize → validate_output → END

LLM: Groq (llama-3.3-70b) — free tier
PydanticAI: v1.x API
"""

import os
import re
import json
import httpx
from typing import List, Optional
from typing_extensions import TypedDict

from dotenv import load_dotenv
from pydantic import BaseModel, Field
from pydantic_ai import Agent as PydanticAgent
from pydantic_ai.models.groq import GroqModel
from pydantic_ai.providers.groq import GroqProvider

from langgraph.graph import StateGraph, START, END
from tavily import TavilyClient
from groq import Groq

load_dotenv()

# ─────────────────────────────────────────────
# Pydantic output schema (PydanticAI validates this)
# ─────────────────────────────────────────────

class Paper(BaseModel):
    title: str
    summary: str
    relevance: str   # Why this matters to the query
    source: str      # URL or arxiv ID


class ResearchReport(BaseModel):
    query: str
    overview: str = Field(description="High-level 3-4 sentence answer to the query")
    key_findings: List[str] = Field(description="5-7 bullet point findings")
    papers: List[Paper] = Field(description="2-5 most relevant papers/sources")
    limitations: str = Field(description="Gaps or caveats in current research")
    future_directions: str = Field(description="What to explore next")
    confidence: float = Field(ge=0.0, le=1.0, description="Agent confidence 0-1")


# ─────────────────────────────────────────────
# LangGraph State
# ─────────────────────────────────────────────

class AgentState(TypedDict):
    query: str
    web_results: List[dict]
    arxiv_results: List[dict]
    raw_synthesis: str
    report: Optional[ResearchReport]
    error: Optional[str]


# ─────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────

def get_tavily():
    key = os.getenv("TAVILY_API_KEY")
    if not key:
        raise ValueError("TAVILY_API_KEY not set")
    return TavilyClient(api_key=key)


def get_groq_client():
    key = os.getenv("GROQ_API_KEY")
    if not key:
        raise ValueError("GROQ_API_KEY not set")
    return Groq(api_key=key)


def search_arxiv(query: str, max_results: int = 5) -> List[dict]:
    """Call arXiv API — completely free, no key needed."""
    import urllib.parse
    q = urllib.parse.quote(query)
    url = f"https://export.arxiv.org/api/query?search_query=all:{q}&start=0&max_results={max_results}"
    try:
        resp = httpx.get(url, timeout=15)
        entries = []
        raw_entries = re.findall(r"<entry>(.*?)</entry>", resp.text, re.DOTALL)
        for entry in raw_entries:
            title_m = re.search(r"<title>(.*?)</title>", entry, re.DOTALL)
            summary_m = re.search(r"<summary>(.*?)</summary>", entry, re.DOTALL)
            id_m = re.search(r"<id>(.*?)</id>", entry, re.DOTALL)
            if title_m and summary_m:
                entries.append({
                    "title": title_m.group(1).strip().replace("\n", " "),
                    "summary": summary_m.group(1).strip()[:600],
                    "url": id_m.group(1).strip() if id_m else "",
                })
        return entries
    except Exception as e:
        return [{"error": str(e)}]


# ─────────────────────────────────────────────
# LangGraph Nodes
# ─────────────────────────────────────────────

def node_search_web(state: AgentState) -> AgentState:
    """Node 1: Web search via Tavily."""
    try:
        client = get_tavily()
        results = client.search(
            query=state["query"],
            search_depth="advanced",
            max_results=6,
            include_raw_content=False,
        )
        web_results = [
            {
                "title": r.get("title", ""),
                "content": r.get("content", "")[:500],
                "url": r.get("url", ""),
                "score": r.get("score", 0),
            }
            for r in results.get("results", [])
        ]
        return {**state, "web_results": web_results}
    except Exception as e:
        return {**state, "web_results": [], "error": f"Web search failed: {e}"}


def node_fetch_arxiv(state: AgentState) -> AgentState:
    """Node 2: Fetch relevant papers from arXiv."""
    arxiv_results = search_arxiv(state["query"], max_results=5)
    return {**state, "arxiv_results": arxiv_results}


def node_synthesize(state: AgentState) -> AgentState:
    """Node 3: Groq llama-3.3-70b synthesises web + arxiv into raw text."""
    if state.get("error"):
        return state

    web_text = "\n\n".join(
        f"[WEB] {r['title']}\n{r['content']}\nURL: {r['url']}"
        for r in state.get("web_results", [])
    )
    arxiv_text = "\n\n".join(
        f"[ARXIV] {r['title']}\n{r['summary']}\nURL: {r['url']}"
        for r in state.get("arxiv_results", [])
        if "error" not in r
    )

    prompt = f"""You are a research analyst. Given these search results about: "{state['query']}"

WEB RESULTS:
{web_text or 'None available'}

ARXIV PAPERS:
{arxiv_text or 'None available'}

Write a comprehensive research synthesis covering:
1. Overview answer to the query (3-4 sentences)
2. Key findings (at least 5 specific bullet points)
3. Most relevant papers/sources with why they matter
4. Limitations in current research
5. Future research directions
6. Your confidence level (0.0 to 1.0)

Be specific, cite sources by URL, and be rigorous."""

    try:
        client = get_groq_client()
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=2000,
            temperature=0.3,
        )
        raw = response.choices[0].message.content
        return {**state, "raw_synthesis": raw}
    except Exception as e:
        return {**state, "error": f"Groq synthesis failed: {e}"}


def node_validate_output(state: AgentState) -> AgentState:
    """Node 4: PydanticAI (v1.x) + Groq structures synthesis into ResearchReport."""
    if state.get("error"):
        return state

    try:
        groq_key = os.getenv("GROQ_API_KEY")

        # PydanticAI v1.x: GroqModel takes model name + provider kwarg
        model = GroqModel(
            "llama-3.3-70b-versatile",
            provider=GroqProvider(api_key=groq_key),
        )

        validator_agent = PydanticAgent(
            model=model,
            output_type=ResearchReport,   # v1.x uses output_type, not result_type
            system_prompt=(
                "You convert raw research synthesis text into a strictly structured ResearchReport. "
                "Extract and organize all information precisely. "
                "papers must use real titles and URLs from the synthesis. "
                "confidence should reflect how well-sourced the information is (0.0-1.0). "
                "Always return valid structured data matching the schema exactly."
            ),
        )

        prompt = f"""Convert this research synthesis into a structured ResearchReport.
Query: {state['query']}

Synthesis:
{state.get('raw_synthesis', '')}"""

        result = validator_agent.run_sync(prompt)
        report = result.output   # v1.x uses .output, not .data
        report.query = state["query"]
        return {**state, "report": report}
    except Exception as e:
        return {**state, "error": f"PydanticAI validation failed: {e}"}


# ─────────────────────────────────────────────
# Build LangGraph
# ─────────────────────────────────────────────

def build_graph():
    graph = StateGraph(AgentState)
    graph.add_node("search_web", node_search_web)
    graph.add_node("fetch_arxiv", node_fetch_arxiv)
    graph.add_node("synthesize", node_synthesize)
    graph.add_node("validate_output", node_validate_output)

    graph.add_edge(START, "search_web")
    graph.add_edge("search_web", "fetch_arxiv")
    graph.add_edge("fetch_arxiv", "synthesize")
    graph.add_edge("synthesize", "validate_output")
    graph.add_edge("validate_output", END)

    return graph.compile()


COMPILED_GRAPH = None

def get_graph():
    global COMPILED_GRAPH
    if COMPILED_GRAPH is None:
        COMPILED_GRAPH = build_graph()
    return COMPILED_GRAPH


def run_research_agent(query: str) -> ResearchReport:
    """Entry point: run the full agentic pipeline for a query."""
    graph = get_graph()
    initial_state: AgentState = {
        "query": query,
        "web_results": [],
        "arxiv_results": [],
        "raw_synthesis": "",
        "report": None,
        "error": None,
    }
    final_state = graph.invoke(initial_state)
    if final_state.get("error"):
        raise RuntimeError(final_state["error"])
    if not final_state.get("report"):
        raise RuntimeError("Agent produced no report")
    return final_state["report"]
