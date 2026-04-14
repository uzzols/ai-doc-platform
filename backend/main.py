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

load_dotenv()

app = FastAPI(title="AI Document Platform API")

# ✅ CORS
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

# ✅ OpenAI
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# ✅ Supabase
supabase_url = os.getenv("SUPABASE_URL")
supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not supabase_url or not supabase_key:
    raise ValueError("Missing Supabase environment variables")

supabase: Client = create_client(supabase_url, supabase_key)

print("🔥 SUPABASE URL:", supabase_url)

# Memory storage
document_chunks = []
chunk_embeddings = []

# ---------- MODELS ----------
class AskRequest(BaseModel):
    question: str
    user_id: str


# ---------- DEBUG ROUTE ----------
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


# ---------- HEALTH ----------
@app.get("/")
def root():
    return {"status": "ok"}


# ---------- HELPERS ----------
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
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))


# ---------- UPLOAD ----------
@app.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    user_id: str = Form(...)
):
    global document_chunks, chunk_embeddings

    if not file.filename:
        raise HTTPException(status_code=400, detail="No file")

    contents = await file.read()
    filename = file.filename.lower()

    text = ""

    try:
        # CSV
        if filename.endswith(".csv"):
            df = pd.read_csv(io.StringIO(contents.decode("utf-8")))
            text = df.to_csv(index=False)
            file_type = "csv"

        # PDF
        elif filename.endswith(".pdf"):
            pdf = fitz.open(stream=contents, filetype="pdf")
            for page in pdf:
                text += page.get_text()
            file_type = "pdf"

        # TXT
        elif filename.endswith(".txt"):
            text = contents.decode("utf-8")
            file_type = "txt"

        # DOCX
        elif filename.endswith(".docx"):
            doc = Document(io.BytesIO(contents))
            text = "\n".join([p.text for p in doc.paragraphs])
            file_type = "docx"

        else:
            raise HTTPException(status_code=400, detail="Unsupported file type")

        document_chunks = chunk_text(text)
        chunk_embeddings = [get_embedding(c) for c in document_chunks]

        # ✅ SAVE DOCUMENT
        result = supabase.table("documents").insert({
            "user_id": user_id,
            "filename": file.filename,
            "file_type": file_type
        }).execute()

        print("📄 DOCUMENT SAVED:", result)

        return {
            "message": "Upload successful",
            "chunks": len(document_chunks),
            "saved_to_supabase": True
        }

    except Exception as e:
        print("❌ UPLOAD ERROR:", str(e))
        raise HTTPException(status_code=500, detail=str(e))


# ---------- ASK ----------
@app.post("/ask")
def ask_ai(request: AskRequest):
    global document_chunks, chunk_embeddings

    if not document_chunks:
        return {"answer": "Upload file first"}

    try:
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

        # ✅ SAVE CHAT
        chat = supabase.table("chat_history").insert({
            "user_id": request.user_id,
            "question": request.question,
            "answer": final_answer
        }).execute()

        print("💬 CHAT SAVED:", chat)

        return {
            "answer": final_answer,
            "saved_to_supabase": True,
            "debug": str(chat)
        }

    except Exception as e:
        print("❌ ASK ERROR:", str(e))
        return {
            "answer": f"Error: {str(e)}",
            "saved_to_supabase": False
        }