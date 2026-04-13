"use client";

import { useEffect, useRef, useState } from "react";
import {
  SignInButton,
  SignUpButton,
  UserButton,
  useUser,
} from "@clerk/nextjs";

type RetrievedChunk = {
  text: string;
  metadata: {
    filename: string;
    file_type: string;
    page?: number | null;
    chunk_index: number;
  };
};

type ChatMessage = {
  question: string;
  answer: string;
};

export default function Home() {
  const { isSignedIn } = useUser();

  const [status, setStatus] = useState("Loading...");
  const [file, setFile] = useState<File | null>(null);
  const [uploadResult, setUploadResult] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [retrievedChunks, setRetrievedChunks] = useState<RetrievedChunk[]>([]);
  const [retrievedCount, setRetrievedCount] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isAsking, setIsAsking] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/health`)
      .then((res) => res.json())
      .then(() => setStatus("Connected"))
      .catch(() => setStatus("Backend connection failed"));
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0] || null;

    if (!selectedFile) {
      setFile(null);
      return;
    }

    const fileName = selectedFile.name.toLowerCase();

    const isPdf =
      selectedFile.type === "application/pdf" || fileName.endsWith(".pdf");

    const isCsv =
      selectedFile.type === "text/csv" ||
      selectedFile.type === "application/vnd.ms-excel" ||
      fileName.endsWith(".csv");

    const isTxt =
      selectedFile.type === "text/plain" || fileName.endsWith(".txt");

    const isDocx =
      selectedFile.type ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      fileName.endsWith(".docx");

    if (!isPdf && !isCsv && !isTxt && !isDocx) {
      setFile(null);
      setUploadResult("Only PDF, CSV, TXT, and DOCX files are allowed.");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    setFile(selectedFile);
    setUploadResult("");
  };

  const handleUpload = async () => {
    if (!file) {
      setUploadResult("Please choose a PDF, CSV, TXT, or DOCX file first.");
      return;
    }

    setIsUploading(true);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/upload`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        setUploadResult(data.detail || data.error || "Upload failed.");
        return;
      }

      setUploadResult(
        `Upload successful ✅
File: ${data.filename}
Type: ${data.file_type}
Chunks created: ${data.chunks_created}`
      );

      setAnswer("");
      setRetrievedChunks([]);
      setRetrievedCount(0);
      setChatHistory([]);
    } catch {
      setUploadResult("Upload failed.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleClear = () => {
    setFile(null);
    setUploadResult("");
    setAnswer("");
    setRetrievedChunks([]);
    setRetrievedCount(0);
    setQuestion("");
    setChatHistory([]);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleAsk = async () => {
    const trimmedQuestion = question.trim();

    if (!trimmedQuestion) {
      setAnswer("Please enter a question.");
      setRetrievedChunks([]);
      setRetrievedCount(0);
      return;
    }

    setIsAsking(true);

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/ask`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ question: trimmedQuestion }),
      });

      const data = await response.json();
      const nextAnswer = data.answer || "";

      setAnswer(nextAnswer);
      setRetrievedChunks(data.retrieved_chunks || []);
      setRetrievedCount(data.retrieved_chunks_count || 0);

      setChatHistory((prev) => [
        ...prev,
        {
          question: trimmedQuestion,
          answer: nextAnswer,
        },
      ]);

      setQuestion("");
    } catch {
      setAnswer("AI request failed.");
      setRetrievedChunks([]);
      setRetrievedCount(0);
    } finally {
      setIsAsking(false);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 py-10 px-4">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="bg-white rounded-2xl shadow-md border border-gray-100 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold mb-2 text-gray-900">
                AI Document Platform
              </h1>
              <p className="text-gray-700">
                Backend status: {status === "Connected" ? "Connected ✅" : status}
              </p>
              <p className="text-sm text-gray-500 mt-2">
                Supports PDF, CSV, TXT, and DOCX files.
              </p>
            </div>

            <div className="flex items-center gap-3">
              {!isSignedIn ? (
                <>
                  <SignInButton mode="modal">
                    <button className="px-4 py-2 border border-gray-300 rounded-lg bg-white hover:bg-gray-50">
                      Sign In
                    </button>
                  </SignInButton>

                  <SignUpButton mode="modal">
                    <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
                      Sign Up
                    </button>
                  </SignUpButton>
                </>
              ) : (
                <UserButton />
              )}
            </div>
          </div>
        </div>

        {!isSignedIn ? (
          <div className="bg-white rounded-2xl shadow-md border border-gray-100 p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              Sign in to use the app
            </h2>
            <p className="text-gray-600 mb-4">
              Please sign in or create an account to upload files and ask AI questions.
            </p>

            <div className="flex gap-3">
              <SignInButton mode="modal">
                <button className="px-4 py-2 border border-gray-300 rounded-lg bg-white hover:bg-gray-50">
                  Sign In
                </button>
              </SignInButton>

              <SignUpButton mode="modal">
                <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
                  Sign Up
                </button>
              </SignUpButton>
            </div>
          </div>
        ) : (
          <>
            <div className="bg-white rounded-2xl shadow-md border border-gray-100 p-6 space-y-4">
              <h2 className="text-xl font-semibold text-gray-900">1. Upload File</h2>

              <input
                type="file"
                accept=".pdf,.csv,.txt,.docx,application/pdf,text/csv,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="block"
                disabled={isUploading || isAsking}
              />

              {file && (
                <p className="text-sm text-gray-700">
                  Selected file: <span className="font-medium">{file.name}</span>
                </p>
              )}

              <div className="flex gap-2 mt-2">
                <button
                  onClick={handleUpload}
                  disabled={!file || isUploading || isAsking}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isUploading ? "Uploading..." : "Upload Document"}
                </button>

                <button
                  onClick={handleClear}
                  disabled={isUploading || isAsking}
                  className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Clear
                </button>
              </div>

              {isUploading && (
                <p className="text-sm text-blue-600">
                  Uploading and processing your file...
                </p>
              )}

              {uploadResult && (
                <div>
                  <h3 className="font-medium mb-2 text-gray-900">Upload Result</h3>
                  <div className="text-left text-sm bg-green-50 border border-green-200 text-green-800 p-4 rounded-lg whitespace-pre-wrap break-words">
                    {uploadResult}
                  </div>
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl shadow-md border border-gray-100 p-6 space-y-4">
              <h2 className="text-xl font-semibold text-gray-900">2. Ask AI</h2>

              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask a question about the uploaded file..."
                className="w-full border border-gray-300 rounded-lg p-3 min-h-[120px] focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isAsking || isUploading}
              />

              <button
                onClick={handleAsk}
                disabled={isAsking || isUploading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isAsking ? "Thinking..." : "Ask AI"}
              </button>

              {isAsking && (
                <p className="text-sm text-blue-600">
                  AI is analyzing your document...
                </p>
              )}
            </div>

            {answer && (
              <div className="bg-white rounded-2xl shadow-md border border-gray-100 p-6">
                <h2 className="text-xl font-semibold mb-3 text-gray-900">
                  Latest AI Answer
                </h2>
                <div className="whitespace-pre-wrap break-words text-[15px] leading-7 text-gray-800 bg-gray-50 border border-gray-200 rounded-lg p-4 max-h-96 overflow-auto">
                  {answer}
                </div>
              </div>
            )}

            {chatHistory.length > 0 && (
              <div className="bg-white rounded-2xl shadow-md border border-gray-100 p-6 space-y-4">
                <h2 className="text-xl font-semibold text-gray-900">Chat History</h2>

                {chatHistory.map((item, index) => (
                  <div
                    key={index}
                    className="border border-gray-200 rounded-lg p-4 space-y-2 bg-gray-50"
                  >
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Question</p>
                      <p className="text-sm text-gray-800 whitespace-pre-wrap">
                        {item.question}
                      </p>
                    </div>

                    <div>
                      <p className="text-sm font-semibold text-gray-900">Answer</p>
                      <p className="text-sm text-gray-800 whitespace-pre-wrap">
                        {item.answer}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {retrievedChunks.length > 0 && (
              <div className="bg-white rounded-2xl shadow-md border border-gray-100 p-6 space-y-4">
                <h2 className="text-xl font-semibold text-gray-900">
                  Retrieved Sources ({retrievedCount})
                </h2>

                {retrievedChunks.map((chunk, index) => (
                  <div
                    key={index}
                    className="bg-gray-100 rounded-lg p-4 border border-gray-200"
                  >
                    <h3 className="font-medium mb-2 text-sm text-gray-900">
                      {chunk.metadata.filename}
                      {chunk.metadata.file_type === "pdf" && chunk.metadata.page
                        ? ` — Page ${chunk.metadata.page}`
                        : ""}
                      {` — Chunk ${chunk.metadata.chunk_index}`}
                    </h3>

                    <pre className="whitespace-pre-wrap break-words text-sm text-gray-800">
                      {chunk.text}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}