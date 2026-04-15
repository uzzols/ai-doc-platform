from fastapi import FastAPI, UploadFile, File, HTTPException, Form
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

# In-memory document store
document_store = {}


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


@app.get("/")
def root():
    return {"status": "ok"}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/debug-supabase")
def debug_supabase():
    try:
        test = supabase.table("chat_history").insert({
            "user_id": "debug-user",
            "question": "test question",
            "answer": "test answer"
        }).execute()

        return {
            "success": True,
            "result": str(test),
            "supabase_url": supabase_url
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "supabase_url": supabase_url
        }


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


@app.get("/conversations/{user_id}")
def get_conversations(user_id: str):
    try:
        result = (
            supabase.table("conversations")
            .select("*")
            .eq("user_id", user_id)
            .order("updated_at", desc=True)
            .execute()
        )
        return result.data
    except Exception as e:
        print("CONVERSATIONS ERROR:", str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/conversations")
def create_conversation(request: CreateConversationRequest):
    try:
        result = supabase.table("conversations").insert({
            "user_id": request.user_id,
            "title": request.title or "New Chat",
            "filename": request.filename
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
        update_data = {}

        if request.title is not None:
            update_data["title"] = request.title

        if request.filename is not None:
            update_data["filename"] = request.filename

        update_data["updated_at"] = "now()"

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
        # Delete messages first
        supabase.table("chat_history").delete().eq("conversation_id", conversation_id).execute()

        # Delete conversation
        supabase.table("conversations").delete().eq("id", conversation_id).execute()

        return {"message": "Conversation deleted"}
    except Exception as e:
        print("DELETE CONVERSATION ERROR:", str(e))
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


def chunk_text(text, size=1000):
    return [text[i:i + size] for i in range(0, len(text), size) if text[i:i + size].strip()]


def get_embedding(text):
    res = client.embeddings.create(
        model="text-embedding-3-small",
        input=text
    )
    return res.data[0].embedding


def cosine_similarity(a, b):
    a = np.array(a)
    b = np.array(b)
    denom = np.linalg.norm(a) * np.linalg.norm(b)
    if denom == 0:
        return 0
    return np.dot(a, b) / denom


@app.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    user_id: str = Form(...)
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file")

    contents = await file.read()
    filename_lower = file.filename.lower()
    text = ""
    file_type = ""

    try:
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

        document_chunks = chunk_text(text)
        chunk_embeddings = [get_embedding(chunk) for chunk in document_chunks]

        document_store[file.filename] = {
            "user_id": user_id,
            "chunks": document_chunks,
            "embeddings": chunk_embeddings
        }

        result = supabase.table("documents").insert({
            "user_id": user_id,
            "filename": file.filename,
            "file_type": file_type
        }).execute()

        print("DOCUMENT SAVED:", result)

        return {
            "message": "Upload successful",
            "filename": file.filename,
            "chunks": len(document_chunks),
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

        # Get conversation info
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

        doc_data = document_store.get(selected_filename)

        if not doc_data:
            return {
                "answer": f"The selected document '{selected_filename}' is not loaded in memory yet. Please upload it again before asking.",
                "saved_to_supabase": False
            }

        if doc_data["user_id"] != request.user_id:
            return {
                "answer": "You do not have access to this document.",
                "saved_to_supabase": False
            }

        document_chunks = doc_data["chunks"]
        chunk_embeddings = doc_data["embeddings"]

        q_emb = get_embedding(request.question)
        scores = [cosine_similarity(q_emb, emb) for emb in chunk_embeddings]
        top_idx = np.argsort(scores)[-3:][::-1]
        context = "\n\n".join([document_chunks[i] for i in top_idx])

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

        chat = supabase.table("chat_history").insert({
            "user_id": request.user_id,
            "conversation_id": request.conversation_id,
            "question": request.question,
            "answer": final_answer,
            "filename": selected_filename
        }).execute()

        # Update conversation timestamp
        current_title = conversation.get("title") or "New Chat"
        new_title = current_title

        if current_title == "New Chat":
            shortened = request.question.strip()
            new_title = shortened[:40] + ("..." if len(shortened) > 40 else "")

        supabase.table("conversations").update({
            "title": new_title,
            "filename": selected_filename,
            "updated_at": "now()"
        }).eq("id", request.conversation_id).execute()

        print("CHAT SAVED:", chat)

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