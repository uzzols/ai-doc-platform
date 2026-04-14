"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useUser, UserButton } from "@clerk/nextjs";

type ChatItem = {
  id?: string;
  question: string;
  answer: string;
  created_at?: string;
};

type DocumentItem = {
  id?: string;
  filename: string;
  created_at?: string;
  user_id?: string;
};

function Spinner() {
  return (
    <div className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-black" />
  );
}

export default function Home() {
  const { isSignedIn, user } = useUser();

  const [file, setFile] = useState<File | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [displayedAnswer, setDisplayedAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");

  const [history, setHistory] = useState<ChatItem[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [selectedDocument, setSelectedDocument] = useState("");

  const BACKEND_URL = "https://ai-doc-platform-24cv.onrender.com";

  const sortedHistory = useMemo(() => {
    return [...history].sort((a, b) => {
      const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return dateB - dateA;
    });
  }, [history]);

  const sortedDocuments = useMemo(() => {
    return [...documents].sort((a, b) => {
      const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return dateB - dateA;
    });
  }, [documents]);

  const fetchHistory = async () => {
    if (!user?.id) return;

    try {
      const res = await fetch(`${BACKEND_URL}/history/${user.id}`);
      const data = await res.json();

      if (res.ok) {
        setHistory(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error("Failed to fetch history:", error);
    }
  };

  const fetchDocuments = async () => {
    if (!user?.id) return;

    try {
      const res = await fetch(`${BACKEND_URL}/documents/${user.id}`);
      const data = await res.json();

      if (res.ok) {
        const docs = Array.isArray(data) ? data : [];
        setDocuments(docs);

        if (!selectedDocument && docs.length > 0) {
          setSelectedDocument(docs[0].filename);
        }
      }
    } catch (error) {
      console.error("Failed to fetch documents:", error);
    }
  };

  useEffect(() => {
    if (isSignedIn && user?.id) {
      fetchHistory();
      fetchDocuments();
    }
  }, [isSignedIn, user?.id]);

  useEffect(() => {
    if (!answer) {
      setDisplayedAnswer("");
      return;
    }

    let index = 0;
    setDisplayedAnswer("");

    const interval = setInterval(() => {
      index += 1;
      setDisplayedAnswer(answer.slice(0, index));

      if (index >= answer.length) {
        clearInterval(interval);
      }
    }, 12);

    return () => clearInterval(interval);
  }, [answer]);

  const handleUpload = async () => {
    if (!file) {
      setMessage("❌ Please select a file");
      return;
    }

    if (!user?.id) {
      setMessage("❌ User not found. Please sign in again.");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("user_id", user.id);

    try {
      setUploading(true);
      setMessage("");

      const res = await fetch(`${BACKEND_URL}/upload`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage(data.detail || data.error || "❌ Upload failed");
        return;
      }

      setMessage("✅ Upload successful");
      setFile(null);
      await fetchDocuments();
    } catch (err) {
      setMessage("❌ Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleAsk = async () => {
    if (!question.trim()) {
      setAnswer("❌ Please enter a question");
      return;
    }

    if (!user?.id) {
      setAnswer("❌ User not found. Please sign in again.");
      return;
    }

    try {
      setLoading(true);
      setAnswer("");

      const res = await fetch(`${BACKEND_URL}/ask`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question,
          user_id: user.id,
          filename: selectedDocument || null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setAnswer(data.detail || data.error || "❌ Error getting response");
        return;
      }

      setAnswer(data.answer || "No response");
      setQuestion("");
      await fetchHistory();
    } catch (err) {
      setAnswer("❌ Error getting response");
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (value?: string) => {
    if (!value) return "";
    try {
      return new Date(value).toLocaleString();
    } catch {
      return value;
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">AI Document Platform</h1>
            <p className="mt-1 text-gray-600">
              Upload documents and ask AI questions
            </p>
          </div>

          <div className="flex items-center gap-3">
            {!isSignedIn ? (
              <>
                <Link
                  href="/sign-in"
                  className="rounded-lg border bg-white px-4 py-2 hover:bg-gray-100"
                >
                  Sign In
                </Link>

                <Link
                  href="/sign-up"
                  className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
                >
                  Sign Up
                </Link>
              </>
            ) : (
              <UserButton />
            )}
          </div>
        </div>

        <div className="mb-6 rounded-xl bg-white p-4 shadow">
          <p className="text-gray-700">
            Backend status: <span className="text-green-600">Connected ✅</span>
          </p>
          <p className="mt-1 text-sm text-gray-500">
            Supports PDF, CSV, TXT, DOCX files
          </p>
        </div>

        {!isSignedIn ? (
          <div className="rounded-xl bg-white p-6 text-center shadow">
            <h2 className="mb-2 text-xl font-semibold">
              Sign in to use the app 🔐
            </h2>
            <p className="mb-4 text-gray-600">
              Please sign in or create an account to upload files and ask AI
              questions.
            </p>

            <div className="flex justify-center gap-4">
              <Link
                href="/sign-in"
                className="rounded-lg border bg-white px-4 py-2 hover:bg-gray-100"
              >
                Sign In
              </Link>

              <Link
                href="/sign-up"
                className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
              >
                Sign Up
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-6">
              <div className="rounded-xl bg-white p-6 shadow">
                <h2 className="mb-3 text-lg font-semibold">1. Upload File</h2>

                <input
                  type="file"
                  accept=".pdf,.csv,.txt,.docx"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="mb-3"
                />

                <div className="flex gap-3">
                  <button
                    onClick={handleUpload}
                    disabled={uploading}
                    className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-70"
                  >
                    {uploading ? (
                      <>
                        <Spinner />
                        Uploading...
                      </>
                    ) : (
                      "Upload Document"
                    )}
                  </button>

                  <button
                    onClick={() => {
                      setFile(null);
                      setMessage("");
                    }}
                    className="rounded-lg border bg-white px-4 py-2 hover:bg-gray-100"
                  >
                    Clear
                  </button>
                </div>

                {message && (
                  <p className="mt-3 text-sm text-gray-700">{message}</p>
                )}
              </div>

              <div className="rounded-xl bg-white p-6 shadow">
                <h2 className="mb-3 text-lg font-semibold">2. Select Document</h2>

                {sortedDocuments.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    No uploaded documents yet.
                  </p>
                ) : (
                  <select
                    value={selectedDocument}
                    onChange={(e) => setSelectedDocument(e.target.value)}
                    className="w-full rounded-lg border p-3"
                  >
                    {sortedDocuments.map((doc, index) => (
                      <option key={doc.id || `${doc.filename}-${index}`} value={doc.filename}>
                        {doc.filename}
                      </option>
                    ))}
                  </select>
                )}

                <div className="mt-4 rounded-lg bg-gray-50 p-4">
                  <p className="mb-2 text-sm font-medium text-gray-700">
                    Uploaded Documents
                  </p>
                  {sortedDocuments.length === 0 ? (
                    <p className="text-sm text-gray-500">Nothing uploaded yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {sortedDocuments.map((doc, index) => (
                        <div
                          key={doc.id || `${doc.filename}-${index}`}
                          className="rounded-lg border bg-white p-3"
                        >
                          <p className="font-medium text-gray-800">{doc.filename}</p>
                          {doc.created_at && (
                            <p className="mt-1 text-xs text-gray-500">
                              {formatDate(doc.created_at)}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-xl bg-white p-6 shadow">
                <h2 className="mb-3 text-lg font-semibold">3. Ask AI</h2>

                <textarea
                  placeholder="Ask a question about the uploaded file..."
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  className="mb-3 w-full rounded-lg border p-3"
                  rows={5}
                />

                <button
                  onClick={handleAsk}
                  disabled={loading}
                  className="flex items-center gap-2 rounded-lg bg-black px-4 py-2 text-white hover:bg-gray-800 disabled:opacity-70"
                >
                  {loading ? (
                    <>
                      <Spinner />
                      Thinking...
                    </>
                  ) : (
                    "Ask AI"
                  )}
                </button>

                {(loading || displayedAnswer) && (
                  <div className="mt-4 rounded-lg bg-gray-100 p-4">
                    <strong>Answer:</strong>
                    <p className="mt-2 whitespace-pre-wrap">
                      {loading && !displayedAnswer
                        ? "AI is thinking..."
                        : displayedAnswer}
                      {loading && <span className="animate-pulse">▍</span>}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-xl bg-white p-6 shadow h-fit">
              <h2 className="mb-3 text-lg font-semibold">Chat History</h2>

              {sortedHistory.length === 0 ? (
                <p className="text-sm text-gray-500">No chat history yet.</p>
              ) : (
                <div className="space-y-4 max-h-[700px] overflow-y-auto pr-1">
                  {sortedHistory.map((item, index) => (
                    <div
                      key={item.id || `${item.question}-${index}`}
                      className="rounded-lg border bg-gray-50 p-4"
                    >
                      <p className="text-sm font-semibold text-gray-800">
                        Q: {item.question}
                      </p>
                      <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">
                        A: {item.answer}
                      </p>
                      {item.created_at && (
                        <p className="mt-3 text-xs text-gray-500">
                          {formatDate(item.created_at)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}