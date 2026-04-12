from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from openai import OpenAI
import pandas as pd
import io
import fitz
import os
import numpy as np

load_dotenv()

app = FastAPI(title="AI Document Platform API")

app.add_middleware(
    CORSMiddleware,
  allow_origins=[
    "http://localhost:3000",
    "https://your-frontend-app.vercel.app",
]
,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

stored_text = ""
document_chunks = []
chunk_embeddings = []
chunk_metadata = []
current_filename = ""
current_file_type = ""


class AskRequest(BaseModel):
    question: str


@app.get("/")
def read_root():
    return {"message": "Backend is running"}


@app.get("/health")
def health_check():
    return {"status": "ok"}


def chunk_text(text, chunk_size=1000):
    chunks = []
    for i in range(0, len(text), chunk_size):
        chunks.append(text[i:i + chunk_size])
    return chunks


def get_embedding(text):
    response = client.embeddings.create(
        model="text-embedding-3-small",
        input=text
    )
    return response.data[0].embedding


def cosine_similarity(a, b):
    a = np.array(a)
    b = np.array(b)
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))


@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    global stored_text, document_chunks, chunk_embeddings, chunk_metadata, current_filename, current_file_type

    contents = await file.read()

    if file.filename.lower().endswith(".csv"):
        df = pd.read_csv(io.StringIO(contents.decode("utf-8")))
        stored_text = df.to_csv(index=False)

        current_filename = file.filename
        current_file_type = "csv"

        document_chunks = chunk_text(stored_text)
        chunk_embeddings = [get_embedding(chunk) for chunk in document_chunks]
        chunk_metadata = [
            {
                "filename": file.filename,
                "file_type": "csv",
                "page": None,
                "chunk_index": i + 1
            }
            for i in range(len(document_chunks))
        ]

        return {
            "filename": file.filename,
            "file_type": "csv",
            "columns": list(df.columns),
            "rows": df.head(5).to_dict(),
            "chunks_created": len(document_chunks)
        }

    if file.filename.lower().endswith(".pdf"):
        pdf_document = fitz.open(stream=contents, filetype="pdf")
        extracted_text = ""

        current_filename = file.filename
        current_file_type = "pdf"

        document_chunks = []
        chunk_embeddings = []
        chunk_metadata = []

        for page_number, page in enumerate(pdf_document, start=1):
            page_text = page.get_text()
            extracted_text += page_text

            page_chunks = chunk_text(page_text)

            for chunk_idx, chunk in enumerate(page_chunks, start=1):
                if chunk.strip():
                    document_chunks.append(chunk)
                    chunk_metadata.append(
                        {
                            "filename": file.filename,
                            "file_type": "pdf",
                            "page": page_number,
                            "chunk_index": chunk_idx
                        }
                    )

        chunk_embeddings = [get_embedding(chunk) for chunk in document_chunks]
        stored_text = extracted_text

        return {
            "filename": file.filename,
            "file_type": "pdf",
            "text_preview": extracted_text[:2000],
            "text_length": len(extracted_text),
            "chunks_created": len(document_chunks)
        }

    stored_text = ""
    document_chunks = []
    chunk_embeddings = []
    chunk_metadata = []
    current_filename = ""
    current_file_type = ""

    return {
        "filename": file.filename,
        "content_type": file.content_type,
        "message": "File uploaded but not processed"
    }


@app.post("/ask")
def ask_ai(request: AskRequest):
    global document_chunks, chunk_embeddings, chunk_metadata

    if not document_chunks:
        return {"answer": "Please upload and process a file first."}

    try:
        question_embedding = get_embedding(request.question)

        similarities = [
            cosine_similarity(question_embedding, emb)
            for emb in chunk_embeddings
        ]

        top_indices = np.argsort(similarities)[-3:][::-1]
        top_chunks = [document_chunks[i] for i in top_indices]
        top_chunk_metadata = [chunk_metadata[i] for i in top_indices]

        context = "\n\n".join(top_chunks)

        response = client.responses.create(
            model="gpt-4.1-mini",
            input=f"""
You are answering questions about an uploaded file.

Use only the retrieved context below. If the answer is not clearly in the context, say so.

Retrieved Context:
{context}

Question:
{request.question}
"""
        )

        return {
            "answer": response.output_text,
            "retrieved_chunks_count": len(top_chunks),
            "retrieved_chunks": [
                {
                    "text": chunk,
                    "metadata": metadata
                }
                for chunk, metadata in zip(top_chunks, top_chunk_metadata)
            ]
        }

    except Exception as e:
        return {"answer": f"Backend error: {str(e)}"}