# InformedVoter-ET 🇪🇹

InformedVoter-ET is a high-performance, lightweight backend designed to democratize access to political party positions, manifestos, and broadcast media debate transcripts in Ethiopia.

Instead of relying on heavy database deployments or vector stores, this engine compiles structured raw data into highly optimized JSON indices. These are loaded directly into server memory (RAM) at startup, facilitating ultra-low latency direct lookups and providing a deterministic, un-hallucinated context layer for Gemini-routed localized synthesis.

---

##  Key Architectural Benefits

- **Sub-Millisecond Read Latency:** `/api/parties` and `/api/topics` utilize direct RAM dictionary lookups ($O(1)$ complexity), returning responses in under 2ms.
- **Deterministic RAG:** The chat engine completely bypasses vector embedding search drift. Gemini acts as an *intent router* and *synthesizer*, but the background data layer remains perfectly rigid and accurate.
- **Zero Database Overhead:** No infrastructure like PostgreSQL or Pinecone is required, keeping production hosting exceptionally cost-efficient and completely stateless.

---

##  Getting Started

### Prerequisites

* Python 3.10+
* A Gemini API Key (Required exclusively for the `/api/chat` route)

### Installation & Local Setup

1. **Clone the Repository & Navigate:**
```bash
git clone https://github.com/your-username/InformedVoter-ET.git
cd InformedVoter-ET
```

2. **Set Up the Environment & Dependencies:**
```bash
default:
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
```

3. **Configure Environment Variables:**
Create a `.env` file in the root directory:
```text
GEMINI_API_KEY=AIzaSyYourActualGeminiKeyGoesHere
```
4. **Fire Up the Application Server:**
```bash
uvicorn src.main:app --reload --host 127.0.0.1 --port 8000
```
Explore the interactive API dashboard at `[http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)`.

---

## Core Endpoints
* `GET /api/parties/{slug}` — Retrieves core platform metadata, ideological alignment, and categorized policy stances for an individual political party.
* `GET /api/topics/{topic_id}` — Retrieves comparative policy stance cards from all registered parties for a high-level category (e.g., `economic_policy`, `governance_constitutional`).
* `POST /api/chat` — Routes natural language questions, maps context via RAM indexes, and delivers localized synthesized responses paired with original media/transcript citations.
---
##  Data Attribution & Sources

The underlying political manifestos, transcript metrics, and media panel data used to populate this engine's static index were sourced from the [electionwatch.et](https://github.com/frectonz/electionwatch.et) created by [@frectonz](https://github.com/frectonz). 
