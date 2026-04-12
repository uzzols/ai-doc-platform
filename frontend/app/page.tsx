"use client";

import { useEffect, useRef, useState } from "react";

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

  const handleUpload = async () => {
    if (!file) {
      setUploadResult("Please choose a file first.");
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
      setUploadResult(JSON.stringify(data, null, 2));
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
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="bg-white rounded-xl shadow p-6">
          <h1 className="text-3xl font-bold mb-2">AI Document Platform</h1>
          <p className="text-gray-700">
  Backend status: {status === "Connected" ? "Connected ✅" : status}
</p>
        </div>

        <div className="bg-white rounded-xl shadow p-6 space-y-4">
          <h2 className="text-xl font-semibold">1. Upload File</h2>

          <input
            type="file"
            ref={fileInputRef}
            onChange={(e) => setFile(e.target.files?.[0] || null)}
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
              className="px-4 py-2 bg-black text-white rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isUploading ? "Uploading..." : "Upload File"}
            </button>

            <button
              onClick={handleClear}
              disabled={isUploading || isAsking}
              className="px-4 py-2 bg-gray-300 text-black rounded hover:bg-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Clear
            </button>
          </div>

          {uploadResult && (
            <div>
              <h3 className="font-medium mb-2">Upload Result</h3>
              <pre className="text-left text-sm bg-gray-100 p-4 rounded overflow-auto whitespace-pre-wrap break-words">
                {uploadResult}
              </pre>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl shadow p-6 space-y-4">
          <h2 className="text-xl font-semibold">2. Ask AI</h2>

          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a question about the uploaded file..."
            className="w-full border rounded p-3 min-h-[120px]"
            disabled={isAsking || isUploading}
          />

          <button
            onClick={handleAsk}
            disabled={isAsking || isUploading}
            className="px-4 py-2 bg-black text-white rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isAsking ? "Thinking..." : "Ask AI"}
          </button>
        </div>

        {answer && (
          <div className="bg-white rounded-xl shadow p-6">
            <h2 className="text-xl font-semibold mb-3">Latest AI Answer</h2>
            <div className="whitespace-pre-wrap break-words text-sm text-gray-800">
              {answer}
            </div>
          </div>
        )}

        {chatHistory.length > 0 && (
          <div className="bg-white rounded-xl shadow p-6 space-y-4">
            <h2 className="text-xl font-semibold">Chat History</h2>

            {chatHistory.map((item, index) => (
              <div key={index} className="border rounded p-4 space-y-2">
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
          <div className="bg-white rounded-xl shadow p-6 space-y-4">
            <h2 className="text-xl font-semibold">
              Retrieved Sources ({retrievedCount})
            </h2>

            {retrievedChunks.map((chunk, index) => (
              <div key={index} className="bg-gray-100 rounded p-4">
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
      </div>
    </main>
  );
}