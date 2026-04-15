from fastapi import FastAPI, UploadFile, File, HTTPException, Form, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from openai import OpenAI
from docx import Document
from supabase import create_client, Client
import pandas as pd
import io
import fitz
import os
import numpy as np
from typing import Optional
from datetime import datetime, timezone
import uuid

load_dotenv()

app = FastAPI(title="AI Document Platform API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://ai-doc-platform-zeta.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

supabase_url = os.getenv("SUPABASE_URL")
supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not supabase_url or not supabase_key:
    raise ValueError("Missing Supabase environment variables")

supabase: Client = create_client(supabase_url, supabase_key)


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


def chunk_text(text: str, size: int = 1000):
    return [text[i:i + size] for i in range(0, len(text), size) if text[i:i + size].strip()]


def get_embedding(text: str):
    res = client.embeddings.create(
        model="text-embedding-3-small",
        input=text
    )
    return res.data[0].embedding


def cosine_similarity(a, b):
    a = np.array(a, dtype=float)
    b = np.array(b, dtype=float)
    denom = np.linalg.norm(a) * np.linalg.norm(b)
    if denom == 0:
        return 0.0
    return float(np.dot(a, b) / denom)


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


def load_document_chunks(user_id: str, filename: str):
    result = (
        supabase.table("document_chunks")
        .select("*")
        .eq("user_id", user_id)
        .eq("filename", filename)
        .order("chunk_index", desc=False)
        .execute()
    )
    return result.data or []


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
        # delete related chats first
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
        supabase.table("documents").delete().eq("user_id", user_id).eq("filename", file.filename).execute()

        rows = []
        for idx, chunk in enumerate(chunks):
            emb = get_embedding(chunk)
            rows.append({
                "user_id": user_id,
                "filename": file.filename,
                "chunk_index": idx,
                "chunk_text": chunk,
                "embedding": emb,
                "created_at": utc_now_iso()
            })

        # Insert in batches
        batch_size = 50
        for i in range(0, len(rows), batch_size):
            supabase.table("document_chunks").insert(rows[i:i + batch_size]).execute()

        supabase.table("documents").insert({
            "user_id": user_id,
            "filename": file.filename,
            "file_type": file_type,
            "uploaded_at": utc_now_iso()
        }).execute()

        return {
            "message": "Upload successful",
            "filename": file.filename,
            "chunks": len(chunks),
            "saved_to_supabase": True
        }

    except HTTPException:
        raise
    except Exception as e:
        print("UPLOAD ERROR:", str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/ask")
def ask_ai(request: AskRequest):
    try:
        if not request.conversation_id:
            return {
                "answer": "No active conversation selected.",
                "saved_to_supabase": False
            }

        convo_result = (
            supabase.table("conversations")
            .select("*")
            .eq("id", request.conversation_id)
            .eq("user_id", request.user_id)
            .execute()
        )

        if not convo_result.data:
            return {
                "answer": "Conversation not found.",
                "saved_to_supabase": False
            }

        conversation = convo_result.data[0]
        selected_filename = request.filename or conversation.get("filename")

        if not selected_filename:
            return {
                "answer": "No document selected for this conversation.",
                "saved_to_supabase": False
            }

        stored_chunks = load_document_chunks(request.user_id, selected_filename)

        if not stored_chunks:
            return {
                "answer": f"No stored chunks found for '{selected_filename}'. Please upload it again.",
                "saved_to_supabase": False
            }

        q_emb = get_embedding(request.question)

        scored = []
        for row in stored_chunks:
            emb = row.get("embedding", [])
            score = cosine_similarity(q_emb, emb)
            scored.append((score, row["chunk_text"]))

        scored.sort(key=lambda x: x[0], reverse=True)
        top_chunks = [text for _, text in scored[:3]]
        context = "\n\n".join(top_chunks)

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

        current_title = conversation.get("title") or "New Chat"
        new_title = current_title

        if current_title == "New Chat":
            shortened = request.question.strip()
            new_title = shortened[:40] + ("..." if len(shortened) > 40 else "")

        supabase.table("conversations").update({
            "title": new_title,
            "filename": selected_filename,
            "updated_at": now_iso
        }).eq("id", request.conversation_id).execute()

        return {
            "answer": final_answer,
            "saved_to_supabase": True,
            "conversation_id": request.conversation_id,
            "title": new_title
        }

    except Exception as e:
        print("ASK ERROR:", str(e))
        return {
            "answer": f"Error: {str(e)}",
            "saved_to_supabase": False
        }