"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useUser, UserButton } from "@clerk/nextjs";

type ChatItem = {
  id?: string;
  question: string;
  answer: string;
  created_at?: string;
  filename?: string | null;
};

type DocumentItem = {
  id?: string;
  filename: string;
  file_type?: string;
  uploaded_at?: string;
};

function LoadingDots() {
  return (
    <div className="flex items-center gap-1">
      <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.3s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.15s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" />
    </div>
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
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const BACKEND_URL = "https://ai-doc-platform-24cv.onrender.com";

  const sortedHistory = useMemo(() => {
    return [...history].sort((a, b) => {
      const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
      return aTime - bTime;
    });
  }, [history]);

  const sortedDocuments = useMemo(() => {
    return [...documents].sort((a, b) => {
      const aTime = a.uploaded_at ? new Date(a.uploaded_at).getTime() : 0;
      const bTime = b.uploaded_at ? new Date(b.uploaded_at).getTime() : 0;
      return bTime - aTime;
    });
  }, [documents]);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

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
    scrollToBottom();
  }, [sortedHistory, displayedAnswer, loading]);

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
    }, 8);

    return () => clearInterval(interval);
  }, [answer]);

  const handleUpload = async () => {
    if (!file) {
      setMessage("Please select a file.");
      return;
    }

    if (!user?.id) {
      setMessage("User not found. Please sign in again.");
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
        setMessage(data.detail || data.error || "Upload failed");
        return;
      }

      setMessage("Upload successful.");
      setFile(null);
      await fetchDocuments();
    } catch (error) {
      setMessage("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleAsk = async () => {
    if (!question.trim()) return;

    if (!user?.id) {
      setAnswer("User not found. Please sign in again.");
      return;
    }

    const currentQuestion = question;
    setQuestion("");

    try {
      setLoading(true);
      setAnswer("");

      const tempQuestion: ChatItem = {
        question: currentQuestion,
        answer: "",
        created_at: new Date().toISOString(),
        filename: selectedDocument || null,
      };

      setHistory((prev) => [...prev, tempQuestion]);

      const res = await fetch(`${BACKEND_URL}/ask`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: currentQuestion,
          user_id: user.id,
          filename: selectedDocument || null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setAnswer(data.detail || data.error || "Error getting response");
        return;
      }

      const finalAnswer = data.answer || "No response";
      setAnswer(finalAnswer);

      setHistory((prev) => prev.slice(0, -1));
      await fetchHistory();
    } catch (error) {
      setAnswer("Error getting response");
      setHistory((prev) => prev.slice(0, -1));
    } finally {
      setLoading(false);
    }
  };

  const handleNewChat = () => {
    setQuestion("");
    setAnswer("");
    setDisplayedAnswer("");
  };

  const handleClearLocalView = () => {
    setHistory([]);
    setAnswer("");
    setDisplayedAnswer("");
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
    <main className="h-screen bg-[#f7f7f8] text-gray-900">
      {!isSignedIn ? (
        <div className="flex h-screen items-center justify-center p-6">
          <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
            <h1 className="mb-2 text-2xl font-bold">AI Document Platform</h1>
            <p className="mb-6 text-gray-600">
              Sign in to upload documents and chat with your files.
            </p>

            <div className="flex gap-3">
              <Link
                href="/sign-in"
                className="flex-1 rounded-lg border border-gray-200 bg-white px-4 py-2 text-center hover:bg-gray-50"
              >
                Sign In
              </Link>
              <Link
                href="/sign-up"
                className="flex-1 rounded-lg bg-black px-4 py-2 text-center text-white hover:bg-gray-800"
              >
                Sign Up
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex h-screen">
          {sidebarOpen && (
            <aside className="flex w-[240px] flex-col border-r border-gray-200 bg-white p-3">
              <div className="mb-3 flex items-center justify-between">
                <button
                  onClick={handleNewChat}
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-left text-sm hover:bg-gray-50"
                >
                  + New chat
                </button>
              </div>

              <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
                <p className="mb-2 text-sm font-medium text-gray-800">Upload file</p>

                <input
                  type="file"
                  accept=".pdf,.csv,.txt,.docx"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="mb-3 w-full text-xs text-gray-700"
                />

                <div className="flex gap-2">
                  <button
                    onClick={handleUpload}
                    disabled={uploading}
                    className="rounded-lg bg-black px-3 py-2 text-xs text-white hover:bg-gray-800 disabled:opacity-70"
                  >
                    {uploading ? "Uploading..." : "Upload"}
                  </button>

                  <button
                    onClick={() => {
                      setFile(null);
                      setMessage("");
                    }}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs hover:bg-gray-100"
                  >
                    Clear
                  </button>
                </div>

                {message && (
                  <p className="mt-3 text-xs text-gray-600">{message}</p>
                )}
              </div>

              <div className="mb-4">
                <label className="mb-2 block text-sm font-medium text-gray-800">
                  Selected document
                </label>
                <select
                  value={selectedDocument}
                  onChange={(e) => setSelectedDocument(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 bg-white p-2.5 text-xs text-gray-900"
                >
                  {sortedDocuments.length === 0 ? (
                    <option value="">No documents uploaded</option>
                  ) : (
                    sortedDocuments.map((doc, index) => (
                      <option
                        key={doc.id || `${doc.filename}-${index}`}
                        value={doc.filename}
                      >
                        {doc.filename}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium text-gray-800">Files</p>
                <button
                  onClick={handleClearLocalView}
                  className="text-xs text-gray-500 hover:text-black"
                >
                  Clear
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto space-y-2 pr-1">
                {sortedDocuments.length === 0 ? (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-500">
                    No documents yet
                  </div>
                ) : (
                  sortedDocuments.map((doc, index) => (
                    <button
                      key={doc.id || `${doc.filename}-${index}`}
                      onClick={() => setSelectedDocument(doc.filename)}
                      className={`w-full rounded-xl border p-3 text-left transition ${
                        selectedDocument === doc.filename
                          ? "border-black bg-black text-white"
                          : "border-gray-200 bg-white hover:bg-gray-50"
                      }`}
                    >
                      <p className="truncate text-xs font-medium">{doc.filename}</p>
                      <p
                        className={`mt-1 text-[11px] ${
                          selectedDocument === doc.filename
                            ? "text-gray-300"
                            : "text-gray-500"
                        }`}
                      >
                        {doc.file_type?.toUpperCase() || "FILE"}
                      </p>
                    </button>
                  ))
                )}
              </div>
            </aside>
          )}

          <section className="flex min-w-0 flex-1 flex-col">
            <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
              <div className="flex items-center gap-3">
                {!sidebarOpen && (
                  <button
                    onClick={() => setSidebarOpen(true)}
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-100"
                  >
                    ☰
                  </button>
                )}

                <div>
                  <h1 className="text-lg font-semibold">AI Document Platform</h1>
                  <p className="text-xs text-gray-500">
                    {selectedDocument
                      ? `Current file: ${selectedDocument}`
                      : "No file selected"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSidebarOpen((prev) => !prev)}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-100"
                >
                  {sidebarOpen ? "Hide panel" : "Show panel"}
                </button>
                <UserButton />
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-6">
                {sortedHistory.length === 0 && !loading && !displayedAnswer && (
                  <div className="mt-20 text-center">
                    <h2 className="mb-3 text-4xl font-semibold text-gray-900">
                      Ask your document anything
                    </h2>
                    <p className="text-gray-500">
                      Upload a file, select it, and start chatting.
                    </p>
                  </div>
                )}

                {sortedHistory.map((item, index) => (
                  <div key={item.id || `${item.question}-${index}`} className="space-y-4">
                    <div className="flex justify-end">
                      <div className="max-w-[75%] rounded-3xl bg-black px-5 py-4 text-white">
                        <p className="whitespace-pre-wrap text-sm leading-6">{item.question}</p>
                      </div>
                    </div>

                    <div className="flex justify-start">
                      <div className="max-w-[92%] rounded-3xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
                        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                          AI
                        </p>
                        <p className="whitespace-pre-wrap text-sm leading-6 text-gray-800">
                          {item.answer}
                        </p>

                        <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-500">
                          {item.filename && <span>File: {item.filename}</span>}
                          {item.created_at && <span>{formatDate(item.created_at)}</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                {loading && (
                  <div className="space-y-4">
                    <div className="flex justify-end">
                      <div className="max-w-[75%] rounded-3xl bg-black px-5 py-4 text-white">
                        <p className="whitespace-pre-wrap text-sm leading-6">Thinking...</p>
                      </div>
                    </div>

                    <div className="flex justify-start">
                      <div className="max-w-[92%] rounded-3xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
                        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                          AI
                        </p>
                        <div className="flex items-center gap-3 text-sm text-gray-700">
                          <LoadingDots />
                          Thinking...
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {!loading && displayedAnswer && (
                  <div className="flex justify-start">
                    <div className="max-w-[92%] rounded-3xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                        AI
                      </p>
                      <p className="whitespace-pre-wrap text-sm leading-6 text-gray-800">
                        {displayedAnswer}
                      </p>
                    </div>
                  </div>
                )}

                <div ref={chatEndRef} />
              </div>
            </div>

            <div className="border-t border-gray-200 bg-white px-4 py-4">
              <div className="mx-auto w-full max-w-6xl">
                <div className="rounded-3xl border border-gray-200 bg-white p-3 shadow-sm">
                  <textarea
                    placeholder="Message your document..."
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (!loading) {
                          handleAsk();
                        }
                      }
                    }}
                    rows={3}
                    className="w-full resize-none bg-transparent p-2 text-sm text-gray-900 outline-none placeholder:text-gray-400"
                  />

                  <div className="mt-2 flex items-center justify-between">
                    <p className="text-xs text-gray-500">
                      Enter to send, Shift + Enter for new line
                    </p>

                    <button
                      onClick={handleAsk}
                      disabled={loading || !question.trim()}
                      className="rounded-2xl bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {loading ? "Thinking..." : "Send"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}