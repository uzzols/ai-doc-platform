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

# Store document chunks in memory by filename
document_store = {}


class AskRequest(BaseModel):
    question: str
    user_id: str
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


@app.get("/history/{user_id}")
def get_chat_history(user_id: str):
    try:
        result = (
            supabase.table("chat_history")
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .execute()
        )
        return result.data
    except Exception as e:
        print("HISTORY ERROR:", str(e))
        raise HTTPException(status_code=500, detail=str(e))


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

        # Save in memory for current backend session
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
        selected_filename = request.filename
        document_chunks = []
        chunk_embeddings = []

        # If a specific document is selected, use it
        if selected_filename:
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

        else:
            # fallback: use the most recently uploaded in-memory document for this user
            user_docs = [
                doc for doc in document_store.values()
                if doc["user_id"] == request.user_id
            ]

            if not user_docs:
                return {"answer": "Upload file first"}

            latest_doc = user_docs[-1]
            document_chunks = latest_doc["chunks"]
            chunk_embeddings = latest_doc["embeddings"]

        if not document_chunks:
            return {"answer": "Upload file first"}

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
            "question": request.question,
            "answer": final_answer,
            "filename": selected_filename
        }).execute()

        print("CHAT SAVED:", chat)

        return {
            "answer": final_answer,
            "saved_to_supabase": True,
            "debug": str(chat)
        }

    except Exception as e:
        print("ASK ERROR:", str(e))
        return {
            "answer": f"Error: {str(e)}",
            "saved_to_supabase": False
        }