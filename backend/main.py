from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv
from openai import OpenAI
from docx import Document
from supabase import create_client, Client
from sentence_transformers import CrossEncoder
import pandas as pd
import io
import fitz
import os
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
import uuid
import time
import json

load_dotenv()

app = FastAPI()

FRONTEND_URL = os.getenv("FRONTEND_URL", "https://ai-doc-platform-zeta.vercel.app")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

supabase: Client = create_client(
    os.getenv("SUPABASE_URL"),
    os.getenv("SUPABASE_SERVICE_ROLE_KEY")
)

# ✅ RERANKER
reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L6-v2")

# ================= MODELS =================

class AskRequest(BaseModel):
    question: str
    user_id: str
    conversation_id: Optional[str] = None
    filename: Optional[str] = None


# ================= HELPERS =================

def utc_now():
    return datetime.now(timezone.utc).isoformat()


def chunk_text(text: str, size=1000):
    return [text[i:i+size] for i in range(0, len(text), size) if text[i:i+size].strip()]


def get_embedding(text: str):
    res = client.embeddings.create(
        model="text-embedding-3-small",
        input=text
    )
    return res.data[0].embedding


def rerank_chunks(question, chunks, top_n=3):
    pairs = [(question, c["chunk_text"]) for c in chunks]
    scores = reranker.predict(pairs)

    rescored = []
    for c, s in zip(chunks, scores):
        rescored.append({**c, "score": float(s)})

    rescored.sort(key=lambda x: x["score"], reverse=True)
    return rescored[:top_n]


def get_chunks(user_id, filename, question):
    emb = get_embedding(question)

    result = supabase.rpc(
        "match_documents",
        {
            "query_embedding": emb,
            "match_count": 10,
            "p_user_id": user_id,
            "p_filename": filename,
        }
    ).execute()

    return result.data or []


# ================= ROUTES =================

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/upload")
async def upload(file: UploadFile = File(...), user_id: str = Form(...)):
    contents = await file.read()

    if file.filename.endswith(".csv"):
        df = pd.read_csv(io.StringIO(contents.decode("utf-8")))
        text = df.to_csv(index=False)
    elif file.filename.endswith(".pdf"):
        pdf = fitz.open(stream=contents, filetype="pdf")
        text = "".join([p.get_text() for p in pdf])
    elif file.filename.endswith(".docx"):
        doc = Document(io.BytesIO(contents))
        text = "\n".join([p.text for p in doc.paragraphs])
    else:
        text = contents.decode("utf-8")

    chunks = chunk_text(text)

    supabase.table("document_chunks_v2")\
        .delete()\
        .eq("user_id", user_id)\
        .eq("filename", file.filename)\
        .execute()

    rows = []
    for i, chunk in enumerate(chunks):
        rows.append({
            "user_id": user_id,
            "filename": file.filename,
            "chunk_index": i,
            "chunk_text": chunk,
            "embedding": get_embedding(chunk),
            "created_at": utc_now()
        })

    supabase.table("document_chunks_v2").insert(rows).execute()

    supabase.table("documents").insert({
        "user_id": user_id,
        "filename": file.filename
    }).execute()

    return {"message": "uploaded"}


# ================= ASK =================

@app.post("/ask")
def ask(req: AskRequest):
    start = time.time()

    convo = supabase.table("conversations")\
        .select("*")\
        .eq("id", req.conversation_id)\
        .eq("user_id", req.user_id)\
        .execute()

    if not convo.data:
        return {"answer": "Conversation not found"}

    filename = req.filename or convo.data[0]["filename"]

    chunks = get_chunks(req.user_id, filename, req.question)
    reranked = rerank_chunks(req.question, chunks)

    context = "\n\n".join([c["chunk_text"] for c in reranked])

    res = client.responses.create(
        model="gpt-4.1-mini",
        input=f"Context:\n{context}\n\nQuestion:\n{req.question}"
    )

    answer = res.output_text

    supabase.table("chat_history").insert({
        "user_id": req.user_id,
        "conversation_id": req.conversation_id,
        "question": req.question,
        "answer": answer,
        "filename": filename,
        "created_at": utc_now()
    }).execute()

    supabase.table("usage_events").insert({
        "user_id": req.user_id,
        "conversation_id": req.conversation_id,
        "question": req.question,
        "response_time_ms": int((time.time() - start)*1000)
    }).execute()

    return {"answer": answer}


# ================= STREAM =================

@app.post("/ask-stream")
def ask_stream(req: AskRequest):
    start = time.time()

    convo = supabase.table("conversations")\
        .select("*")\
        .eq("id", req.conversation_id)\
        .eq("user_id", req.user_id)\
        .execute()

    filename = req.filename or convo.data[0]["filename"]

    chunks = get_chunks(req.user_id, filename, req.question)
    reranked = rerank_chunks(req.question, chunks)

    context = "\n\n".join([c["chunk_text"] for c in reranked])

    def generate():
        collected = []

        stream = client.responses.create(
            model="gpt-4.1-mini",
            input=f"Context:\n{context}\n\nQuestion:\n{req.question}",
            stream=True
        )

        for event in stream:
            if event.type == "response.output_text.delta":
                token = event.delta
                collected.append(token)
                yield f"data: {json.dumps({'token': token})}\n\n"

        final = "".join(collected)

        supabase.table("chat_history").insert({
            "user_id": req.user_id,
            "conversation_id": req.conversation_id,
            "question": req.question,
            "answer": final,
            "filename": filename,
            "created_at": utc_now()
        }).execute()

        payload = {
            "done": True,
            "response_time_ms": int((time.time() - start)*1000)
        }

        yield f"data: {json.dumps(payload)}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")