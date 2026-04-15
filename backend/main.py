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

app = FastAPI(title="AI Document Platform API")

FRONTEND_URL = os.getenv("FRONTEND_URL", "https://ai-doc-platform-zeta.vercel.app")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
RERANKER_MODEL = os.getenv(
    "RERANKER_MODEL",
    "cross-encoder/ms-marco-MiniLM-L6-v2"
)

if not OPENAI_API_KEY:
    raise ValueError("Missing OPENAI_API_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    raise ValueError("Missing Supabase environment variables")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        FRONTEND_URL,
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = OpenAI(api_key=OPENAI_API_KEY)
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

# Load reranker once at startup
reranker = CrossEncoder(RERANKER_MODEL)


class AskRequest(BaseModel):
    question: str
    user_id: str
    conversation_id: Optional[str] = None
    filename: Optional[str] = None


class CreateConversationRequest(BaseModel):
    user_id: str
    title: Optional[str] = "New Chat"
    filename: Optional[str] = None


class UpdateConversationRequest(BaseModel):
    title: Optional[str] = None
    filename: Optional[str] = None


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def chunk_text(text: str, size: int = 1000) -> List[str]:
    return [text[i:i + size] for i in range(0, len(text), size) if text[i:i + size].strip()]


def get_embedding(text: str) -> List[float]:
    res = client.embeddings.create(
        model="text-embedding-3-small",
        input=text
    )
    return res.data[0].embedding


def extract_file_text(filename: str, contents: bytes):
    filename_lower = filename.lower()
    text = ""
    file_type = ""

    if filename_lower.endswith(".csv"):
        try:
            df = pd.read_csv(io.StringIO(contents.decode("utf-8")))
        except Exception:
            df = pd.read_csv(io.StringIO(contents.decode("latin-1")))
        text = df.to_csv(index=False)
        file_type = "csv"

    elif filename_lower.endswith(".pdf"):
        pdf = fitz.open(stream=contents, filetype="pdf")
        for page in pdf:
            text += page.get_text()
        pdf.close()
        file_type = "pdf"

    elif filename_lower.endswith(".txt"):
        try:
            text = contents.decode("utf-8")
        except Exception:
            text = contents.decode("latin-1")
        file_type = "txt"

    elif filename_lower.endswith(".docx"):
        doc = Document(io.BytesIO(contents))
        text = "\n".join([p.text for p in doc.paragraphs if p.text.strip()])
        file_type = "docx"

    else:
        raise HTTPException(status_code=400, detail="Unsupported file type")

    if not text.strip():
        raise HTTPException(status_code=400, detail="Could not extract text from file")

    return text, file_type


def get_relevant_chunks(
    user_id: str,
    filename: str,
    question: str,
    match_count: int = 10
) -> List[Dict[str, Any]]:
    query_embedding = get_embedding(question)

    result = supabase.rpc(
        "match_documents",
        {
            "query_embedding": query_embedding,
            "match_count": match_count,
            "p_user_id": user_id,
            "p_filename": filename,
        },
    ).execute()

    return result.data or []


def rerank_chunks(
    question: str,
    matched_chunks: List[Dict[str, Any]],
    top_n: int = 3
) -> List[Dict[str, Any]]:
    if not matched_chunks:
        return []

    pairs = [(question, row["chunk_text"]) for row in matched_chunks]
    scores = reranker.predict(pairs)

    rescored = []
    for row, score in zip(matched_chunks, scores):
        rescored.append({
            **row,
            "rerank_score": float(score)
        })

    rescored.sort(key=lambda x: x["rerank_score"], reverse=True)
    return rescored[:top_n]


def build_context_from_chunks(chunks: List[Dict[str, Any]]) -> str:
    return "\n\n".join([row["chunk_text"] for row in chunks if row.get("chunk_text")])


def get_conversation_for_user(conversation_id: str, user_id: str) -> Optional[Dict[str, Any]]:
    convo_result = (
        supabase.table("conversations")
        .select("*")
        .eq("id", conversation_id)
        .eq("user_id", user_id)
        .execute()
    )
    return convo_result.data[0] if convo_result.data else None


def update_conversation_metadata(
    conversation: Dict[str, Any],
    conversation_id: str,
    question: str,
    filename: str,
    now_iso: str
) -> str:
    current_title = conversation.get("title") or "New Chat"
    new_title = current_title

    if current_title == "New Chat":
        shortened = question.strip()
        new_title = shortened[:40] + ("..." if len(shortened) > 40 else "")

    supabase.table("conversations").update({
        "title": new_title,
        "filename": filename,
        "updated_at": now_iso
    }).eq("id", conversation_id).execute()

    return new_title


def insert_usage_event(
    user_id: str,
    conversation_id: Optional[str],
    filename: Optional[str],
    question: str,
    model: str,
    response_time_ms: int,
    now_iso: str
):
    supabase.table("usage_events").insert({
        "user_id": user_id,
        "conversation_id": conversation_id,
        "filename": filename,
        "question": question,
        "model": model,
        "response_time_ms": response_time_ms,
        "created_at": now_iso
    }).execute()


@app.get("/")
def root():
    return {"status": "ok"}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/documents/{user_id}")
def get_documents(user_id: str):
    try:
        result = (
            supabase.table("documents")
            .select("*")
            .eq("user_id", user_id)
            .order("uploaded_at", desc=True)
            .execute()
        )
        return result.data
    except Exception as e:
        print("DOCUMENTS ERROR:", str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/documents/{user_id}/{filename}")
def delete_document(user_id: str, filename: str):
    try:
        convo_result = (
            supabase.table("conversations")
            .select("id")
            .eq("user_id", user_id)
            .eq("filename", filename)
            .execute()
        )

        convo_ids = [row["id"] for row in (convo_result.data or [])]
        for convo_id in convo_ids:
            supabase.table("chat_history").delete().eq("conversation_id", convo_id).execute()

        supabase.table("conversations").delete().eq("user_id", user_id).eq("filename", filename).execute()
        supabase.table("document_chunks").delete().eq("user_id", user_id).eq("filename", filename).execute()
        supabase.table("document_chunks_v2").delete().eq("user_id", user_id).eq("filename", filename).execute()
        supabase.table("documents").delete().eq("user_id", user_id).eq("filename", filename).execute()

        return {"message": "Document and related chats deleted"}
    except Exception as e:
        print("DELETE DOCUMENT ERROR:", str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/conversations/{user_id}")
def get_conversations(
    user_id: str,
    filename: Optional[str] = None,
    search: Optional[str] = None,
):
    try:
        query = (
            supabase.table("conversations")
            .select("*")
            .eq("user_id", user_id)
        )

        if filename:
            query = query.eq("filename", filename)

        if search:
            query = query.or_(f"title.ilike.%{search}%,filename.ilike.%{search}%")

        result = query.order("updated_at", desc=True).execute()
        return result.data
    except Exception as e:
        print("CONVERSATIONS ERROR:", str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/conversations")
def create_conversation(request: CreateConversationRequest):
    try:
        now_iso = utc_now_iso()
        result = supabase.table("conversations").insert({
            "user_id": request.user_id,
            "title": request.title or "New Chat",
            "filename": request.filename,
            "created_at": now_iso,
            "updated_at": now_iso,
            "is_public": False,
            "share_token": None,
        }).execute()

        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to create conversation")

        return result.data[0]
    except Exception as e:
        print("CREATE CONVERSATION ERROR:", str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.patch("/conversations/{conversation_id}")
def update_conversation(conversation_id: str, request: UpdateConversationRequest):
    try:
        update_data = {
            "updated_at": utc_now_iso()
        }

        if request.title is not None:
            update_data["title"] = request.title

        if request.filename is not None:
            update_data["filename"] = request.filename

        result = (
            supabase.table("conversations")
            .update(update_data)
            .eq("id", conversation_id)
            .execute()
        )

        return result.data[0] if result.data else {}
    except Exception as e:
        print("UPDATE CONVERSATION ERROR:", str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/conversations/{conversation_id}")
def delete_conversation(conversation_id: str):
    try:
        supabase.table("chat_history").delete().eq("conversation_id", conversation_id).execute()
        supabase.table("conversations").delete().eq("id", conversation_id).execute()
        return {"message": "Conversation deleted"}
    except Exception as e:
        print("DELETE CONVERSATION ERROR:", str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/conversations/{conversation_id}/share")
def share_conversation(conversation_id: str):
    try:
        token = str(uuid.uuid4())
        result = (
            supabase.table("conversations")
            .update({
                "is_public": True,
                "share_token": token,
                "updated_at": utc_now_iso()
            })
            .eq("id", conversation_id)
            .execute()
        )

        if not result.data:
            raise HTTPException(status_code=404, detail="Conversation not found")

        return {
            "share_token": token,
            "share_path": f"?share={token}"
        }
    except Exception as e:
        print("SHARE CONVERSATION ERROR:", str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/shared/{share_token}")
def get_shared_conversation(share_token: str):
    try:
        convo_result = (
            supabase.table("conversations")
            .select("*")
            .eq("share_token", share_token)
            .eq("is_public", True)
            .execute()
        )

        if not convo_result.data:
            raise HTTPException(status_code=404, detail="Shared conversation not found")

        conversation = convo_result.data[0]

        history_result = (
            supabase.table("chat_history")
            .select("*")
            .eq("conversation_id", conversation["id"])
            .order("created_at", desc=False)
            .execute()
        )

        return {
            "conversation": conversation,
            "messages": history_result.data or []
        }
    except HTTPException:
        raise
    except Exception as e:
        print("GET SHARED CONVERSATION ERROR:", str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/history/{conversation_id}")
def get_chat_history(conversation_id: str):
    try:
        result = (
            supabase.table("chat_history")
            .select("*")
            .eq("conversation_id", conversation_id)
            .order("created_at", desc=False)
            .execute()
        )
        return result.data
    except Exception as e:
        print("HISTORY ERROR:", str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    user_id: str = Form(...)
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file")

    try:
        contents = await file.read()
        text, file_type = extract_file_text(file.filename, contents)
        chunks = chunk_text(text)

        # Remove prior stored chunks for same user/file, then replace
        supabase.table("document_chunks").delete().eq("user_id", user_id).eq("filename", file.filename).execute()
        supabase.table("document_chunks_v2").delete().eq("user_id", user_id).eq("filename", file.filename).execute()
        supabase.table("documents").delete().eq("user_id", user_id).eq("filename", file.filename).execute()

        rows_v2 = []
        now_iso = utc_now_iso()

        for idx, chunk in enumerate(chunks):
            emb = get_embedding(chunk)
            rows_v2.append({
                "user_id": user_id,
                "filename": file.filename,
                "chunk_index": idx,
                "chunk_text": chunk,
                "embedding": emb,
                "created_at": now_iso
            })

        batch_size = 50
        for i in range(0, len(rows_v2), batch_size):
            supabase.table("document_chunks_v2").insert(rows_v2[i:i + batch_size]).execute()

        supabase.table("documents").insert({
            "user_id": user_id,
            "filename": file.filename,
            "file_type": file_type,
            "uploaded_at": now_iso
        }).execute()

        return {
            "message": "Upload successful",
            "filename": file.filename,
            "chunks": len(chunks),
            "saved_to_supabase": True,
            "vector_table": "document_chunks_v2",
            "reranker_model": RERANKER_MODEL
        }

    except HTTPException:
        raise
    except Exception as e:
        print("UPLOAD ERROR:", str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/ask")
def ask_ai(request: AskRequest):
    start_time = time.time()

    try:
        if not request.conversation_id:
            return {
                "answer": "No active conversation selected.",
                "saved_to_supabase": False
            }

        conversation = get_conversation_for_user(request.conversation_id, request.user_id)

        if not conversation:
            return {
                "answer": "Conversation not found.",
                "saved_to_supabase": False
            }

        selected_filename = request.filename or conversation.get("filename")

        if not selected_filename:
            return {
                "answer": "No document selected for this conversation.",
                "saved_to_supabase": False
            }

        matched_chunks = get_relevant_chunks(
            request.user_id,
            selected_filename,
            request.question,
            match_count=10
        )

        if not matched_chunks:
            return {
                "answer": f"No stored chunks found for '{selected_filename}'. Please upload it again.",
                "saved_to_supabase": False
            }

        reranked_chunks = rerank_chunks(request.question, matched_chunks, top_n=3)
        context = build_context_from_chunks(reranked_chunks)

        response = client.responses.create(
            model="gpt-4.1-mini",
            input=f"""
Answer using only this context:

{context}

Question:
{request.question}
"""
        )

        final_answer = response.output_text
        now_iso = utc_now_iso()

        supabase.table("chat_history").insert({
            "user_id": request.user_id,
            "conversation_id": request.conversation_id,
            "question": request.question,
            "answer": final_answer,
            "filename": selected_filename,
            "created_at": now_iso
        }).execute()

        new_title = update_conversation_metadata(
            conversation=conversation,
            conversation_id=request.conversation_id,
            question=request.question,
            filename=selected_filename,
            now_iso=now_iso
        )

        response_time_ms = int((time.time() - start_time) * 1000)

        insert_usage_event(
            user_id=request.user_id,
            conversation_id=request.conversation_id,
            filename=selected_filename,
            question=request.question,
            model="gpt-4.1-mini",
            response_time_ms=response_time_ms,
            now_iso=now_iso
        )

        return {
            "answer": final_answer,
            "saved_to_supabase": True,
            "conversation_id": request.conversation_id,
            "title": new_title,
            "response_time_ms": response_time_ms,
            "retrieved_count": len(matched_chunks),
            "reranked_count": len(reranked_chunks),
            "reranker_model": RERANKER_MODEL
        }

    except Exception as e:
        print("ASK ERROR:", str(e))
        return {
            "answer": f"Error: {str(e)}",
            "saved_to_supabase": False
        }


@app.post("/ask-stream")
def ask_ai_stream(request: AskRequest):
    start_time = time.time()

    try:
        if not request.conversation_id:
            raise HTTPException(status_code=400, detail="No active conversation selected.")

        conversation = get_conversation_for_user(request.conversation_id, request.user_id)

        if not conversation:
            raise HTTPException(status_code=404, detail="Conversation not found.")

        selected_filename = request.filename or conversation.get("filename")

        if not selected_filename:
            raise HTTPException(status_code=400, detail="No document selected for this conversation.")

        matched_chunks = get_relevant_chunks(
            request.user_id,
            selected_filename,
            request.question,
            match_count=10
        )

        if not matched_chunks:
            raise HTTPException(
                status_code=404,
                detail=f"No stored chunks found for '{selected_filename}'. Please upload it again."
            )

        reranked_chunks = rerank_chunks(request.question, matched_chunks, top_n=3)
        context = build_context_from_chunks(reranked_chunks)

        def generate():
            collected: List[str] = []

            stream = client.responses.create(
                model="gpt-4.1-mini",
                input=f"""
Answer using only this context:

{context}

Question:
{request.question}
""",
                stream=True
            )

            for event in stream:
                if event.type == "response.output_text.delta":
                    delta = event.delta
                    collected.append(delta)
                    yield f"data: {json.dumps({'token': delta})}\n\n"

            final_answer = "".join(collected)
            now_iso = utc_now_iso()

            supabase.table("chat_history").insert({
                "user_id": request.user_id,
                "conversation_id": request.conversation_id,
                "question": request.question,
                "answer": final_answer,
                "filename": selected_filename,
                "created_at": now_iso
            }).execute()

            new_title = update_conversation_metadata(
                conversation=conversation,
                conversation_id=request.conversation_id,
                question=request.question,
                filename=selected_filename,
                now_iso=now_iso
            )

            response_time_ms = int((time.time() - start_time) * 1000)

            insert_usage_event(
                user_id=request.user_id,
                conversation_id=request.conversation_id,
                filename=selected_filename,
                question=request.question,
                model="gpt-4.1-mini",
                response_time_ms=response_time_ms,
                now_iso=now_iso
            )

          payload = {
             "done": True,
             "title": new_title,
             "response_time_ms": response_time_ms,
             "retrieved_count": len(matched_chunks),
             "reranked_count": len(reranked_chunks),
             "reranker_model": RERANKER_MODEL
         }

        yield f"data: {json.dumps(payload)}\n\n"

        return StreamingResponse(generate(), media_type="text/event-stream")

    except HTTPException:
        raise
    except Exception as e:
        print("ASK STREAM ERROR:", str(e))
        raise HTTPException(status_code=500, detail=str(e))