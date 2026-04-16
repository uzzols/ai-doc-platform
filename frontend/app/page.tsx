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
  document_type?: string | null;
  extracted_data?: Record<string, any> | null;
};

type ConversationItem = {
  id: string;
  title: string;
  filename?: string | null;
  created_at?: string;
  updated_at?: string;
  is_public?: boolean;
  share_token?: string | null;
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

function formatFieldLabel(key: string) {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function renderFieldValue(value: any) {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
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
  const [searchText, setSearchText] = useState("");
  const [renamingConversationId, setRenamingConversationId] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [shareLink, setShareLink] = useState("");
  const [sharedView, setSharedView] = useState(false);
  const [sharedTitle, setSharedTitle] = useState("");
  const [showInsights, setShowInsights] = useState(false);

  const [history, setHistory] = useState<ChatItem[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [selectedDocument, setSelectedDocument] = useState("");
  const [activeConversationId, setActiveConversationId] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const BACKEND_URL = "https://ai-doc-platform-24cv.onrender.com";
  const FRONTEND_URL = "https://ai-doc-platform-zeta.vercel.app";

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

  const sortedConversations = useMemo(() => {
    return [...conversations].sort((a, b) => {
      const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      return bTime - aTime;
    });
  }, [conversations]);

  const selectedDocumentMeta = useMemo(() => {
    return documents.find((doc) => doc.filename === selectedDocument) || null;
  }, [documents, selectedDocument]);

  const extractedEntries = useMemo(() => {
    if (
      !selectedDocumentMeta?.extracted_data ||
      typeof selectedDocumentMeta.extracted_data !== "object"
    ) {
      return [];
    }
    return Object.entries(selectedDocumentMeta.extracted_data);
  }, [selectedDocumentMeta]);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const fetchSharedConversation = async (token: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/shared/${token}`);
      const data = await res.json();

      if (res.ok) {
        setSharedView(true);
        setSharedTitle(data.conversation?.title || "Shared conversation");
        setSelectedDocument(data.conversation?.filename || "");
        setHistory(Array.isArray(data.messages) ? data.messages : []);
      }
    } catch (error) {
      console.error("Failed to fetch shared conversation:", error);
    }
  };

  const fetchDocuments = async () => {
    if (!user?.id) return [];

    try {
      const res = await fetch(`${BACKEND_URL}/documents/${user.id}`);
      const data = await res.json();

      if (res.ok) {
        const docs = Array.isArray(data) ? data : [];
        setDocuments(docs);
        return docs;
      }
    } catch (error) {
      console.error("Failed to fetch documents:", error);
    }

    return [];
  };

  const fetchHistory = async (conversationId: string) => {
    if (!conversationId) return;

    try {
      const res = await fetch(`${BACKEND_URL}/history/${conversationId}`);
      const data = await res.json();

      if (res.ok) {
        setHistory(Array.isArray(data) ? data : []);
      } else {
        setHistory([]);
      }
    } catch (error) {
      console.error("Failed to fetch history:", error);
      setHistory([]);
    }
  };

  const fetchConversations = async (
    search?: string,
    preserveActive = true,
    preferredConversationId?: string
  ) => {
    if (!user?.id) return [];

    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);

      const qs = params.toString();
      const url = `${BACKEND_URL}/conversations/${user.id}${qs ? `?${qs}` : ""}`;

      const res = await fetch(url);
      const data = await res.json();

      if (!res.ok) return [];

      const convos = Array.isArray(data) ? data : [];
      setConversations(convos);

      if (convos.length === 0) {
        setActiveConversationId("");
        setHistory([]);
        return [];
      }

      if (preferredConversationId) {
        const preferred = convos.find((c) => c.id === preferredConversationId);
        if (preferred) {
          setActiveConversationId(preferred.id);
          setSelectedDocument(preferred.filename || "");
          await fetchHistory(preferred.id);
          return convos;
        }
      }

      if (preserveActive && activeConversationId) {
        const existing = convos.find((c) => c.id === activeConversationId);
        if (existing) return convos;
      }

      if (!activeConversationId || !preserveActive) {
        const first = convos[0];
        setActiveConversationId(first.id);
        setSelectedDocument(first.filename || "");
        await fetchHistory(first.id);
      }

      return convos;
    } catch (error) {
      console.error("Failed to fetch conversations:", error);
      return [];
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const shareToken = params.get("share");

    if (shareToken) {
      fetchSharedConversation(shareToken);
      return;
    }

    if (isSignedIn && user?.id) {
      const init = async () => {
        const docs = await fetchDocuments();
        const convos = await fetchConversations();

        if ((!convos || convos.length === 0) && docs && docs.length > 0) {
          setSelectedDocument(docs[0].filename);
        }
      };

      init();
    }
  }, [isSignedIn, user?.id]);

  useEffect(() => {
    scrollToBottom();
  }, [sortedHistory, displayedAnswer, loading]);

  const createNewConversation = async (filename?: string) => {
    if (!user?.id) return null;

    try {
      const res = await fetch(`${BACKEND_URL}/conversations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: user.id,
          title: "New Chat",
          filename: filename || null,
        }),
      });

      const data = await res.json();

      if (res.ok && data?.id) {
        const newConversation = data as ConversationItem;

        setActiveConversationId(newConversation.id);
        setSelectedDocument(newConversation.filename || filename || "");
        setConversations((prev) => {
          const exists = prev.some((c) => c.id === newConversation.id);
          return exists ? prev : [newConversation, ...prev];
        });
        setHistory([]);
        setQuestion("");
        setAnswer("");
        setDisplayedAnswer("");
        setShareLink("");

        await fetchConversations(searchText || undefined, true, newConversation.id);

        setTimeout(() => {
          inputRef.current?.focus();
        }, 100);

        return newConversation;
      }
    } catch (error) {
      console.error("Failed to create conversation:", error);
    }

    return null;
  };

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
      setMessage("Uploading, classifying, extracting, and indexing document...");

      const res = await fetch(`${BACKEND_URL}/upload`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage(data.detail || data.error || "Upload failed");
        return;
      }

      const uploadedFilename = data.filename || file.name;
      setMessage("Upload successful.");
      setFile(null);

      await fetchDocuments();
      setSelectedDocument(uploadedFilename);

      setQuestion("");
      setAnswer("");
      setDisplayedAnswer("");
      setShareLink("");

      setActiveConversationId("");
      setHistory([]);

      await fetchConversations(searchText || undefined, true);
    } catch (error) {
      console.error("Upload failed:", error);
      setMessage("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleAsk = async () => {
    if (!question.trim() || loading) return;
    if (!user?.id) return;

    if (!selectedDocument) {
      setAnswer("Please select a document first.");
      return;
    }

    let conversationId = activeConversationId;

    if (!conversationId) {
      const createdConversation = await createNewConversation(selectedDocument);
      if (!createdConversation?.id) {
        setAnswer("Failed to create a new conversation.");
        return;
      }
      conversationId = createdConversation.id;
    }

    const currentQuestion = question.trim();
    setQuestion("");
    setAnswer("");
    setDisplayedAnswer("");

    const tempQuestion: ChatItem = {
      question: currentQuestion,
      answer: "",
      created_at: new Date().toISOString(),
      filename: selectedDocument || null,
    };

    try {
      setLoading(true);
      setHistory((prev) => [...prev, tempQuestion]);

      const res = await fetch(`${BACKEND_URL}/ask-stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: currentQuestion,
          user_id: user.id,
          conversation_id: conversationId,
          filename: selectedDocument,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        const errorMessage =
          errorData?.detail || errorData?.error || "Error getting response";

        setHistory((prev) =>
          prev.map((item, index) =>
            index === prev.length - 1 ? { ...item, answer: errorMessage } : item
          )
        );
        setAnswer(errorMessage);
        return;
      }

      if (!res.body) {
        throw new Error("No response stream");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");

      let finalText = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const eventChunk of events) {
          const lines = eventChunk.split("\n");
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;

            const jsonStr = line.replace("data: ", "").trim();

            try {
              const data = JSON.parse(jsonStr);

              if (data.token) {
                finalText += data.token;
                setAnswer(finalText);
                setDisplayedAnswer(finalText);

                setHistory((prev) =>
                  prev.map((item, index) =>
                    index === prev.length - 1
                      ? { ...item, answer: finalText }
                      : item
                  )
                );
              }

              if (data.done) {
                await fetchHistory(conversationId);
                await fetchConversations(searchText || undefined, true, conversationId);
              }
            } catch (e) {
              console.error("Stream parse error:", e);
            }
          }
        }
      }
    } catch (error) {
      console.error("Streaming error:", error);

      const errorMessage = "Error getting response";

      setHistory((prev) =>
        prev.map((item, index) =>
          index === prev.length - 1
            ? { ...item, answer: errorMessage }
            : item
        )
      );
      setAnswer(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectConversation = async (conversation: ConversationItem) => {
    setActiveConversationId(conversation.id);
    setSelectedDocument(conversation.filename || "");
    setQuestion("");
    setAnswer("");
    setDisplayedAnswer("");
    setShareLink("");
    await fetchHistory(conversation.id);
  };

  const handleDocumentChange = async (filename: string) => {
    setSelectedDocument(filename);
    setQuestion("");
    setAnswer("");
    setDisplayedAnswer("");
    setShareLink("");

    if (!filename) {
      setShowInsights(false);
      return;
    }

    const matchingConversation = sortedConversations.find(
      (conversation) => conversation.filename === filename
    );

    if (matchingConversation) {
      setActiveConversationId(matchingConversation.id);
      await fetchHistory(matchingConversation.id);
    } else {
      setActiveConversationId("");
      setHistory([]);
    }
  };

  const handleNewChat = async () => {
    if (!selectedDocument) {
      alert("Please select a document first.");
      return;
    }

    setQuestion("");
    setAnswer("");
    setDisplayedAnswer("");
    setShareLink("");
    setHistory([]);

    await createNewConversation(selectedDocument);
  };

  const handleDeleteConversation = async (conversationId: string) => {
    try {
      await fetch(`${BACKEND_URL}/conversations/${conversationId}`, {
        method: "DELETE",
      });

      if (activeConversationId === conversationId) {
        setActiveConversationId("");
        setHistory([]);
        setQuestion("");
        setAnswer("");
        setDisplayedAnswer("");
        setShareLink("");
      }

      const updatedConvos = await fetchConversations(
        searchText || undefined,
        false,
        undefined
      );

      if (updatedConvos.length > 0) {
        const first = updatedConvos[0];
        setActiveConversationId(first.id);
        setSelectedDocument(first.filename || selectedDocument || "");
        await fetchHistory(first.id);
      } else {
        setActiveConversationId("");
        setHistory([]);
      }
    } catch (error) {
      console.error("Failed to delete conversation:", error);
    }
  };

  const handleRenameConversation = async (conversationId: string) => {
    const title = renameValue.trim();
    if (!title) return;

    try {
      const res = await fetch(`${BACKEND_URL}/conversations/${conversationId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title }),
      });

      if (res.ok) {
        setRenamingConversationId("");
        setRenameValue("");
        await fetchConversations(searchText || undefined, true, activeConversationId);
      }
    } catch (error) {
      console.error("Failed to rename conversation:", error);
    }
  };

  const handleShareConversation = async (conversationId: string) => {
    try {
      const res = await fetch(
        `${BACKEND_URL}/conversations/${conversationId}/share`,
        {
          method: "POST",
        }
      );
      const data = await res.json();

      if (res.ok && data?.share_path) {
        const fullUrl = `${FRONTEND_URL}/${data.share_path}`;
        setShareLink(fullUrl);

        try {
          await navigator.clipboard.writeText(fullUrl);
          alert("Share link copied to clipboard");
        } catch {
          alert(`Share link: ${fullUrl}`);
        }
      }
    } catch (error) {
      console.error("Failed to share conversation:", error);
    }
  };

  const handleDeleteDocument = async () => {
    if (!selectedDocument || !user?.id) return;

    const confirmed = window.confirm(
      `Delete "${selectedDocument}" and all chats linked to it?`
    );

    if (!confirmed) return;

    try {
      const deletedDocument = selectedDocument;
      const encodedFilename = encodeURIComponent(deletedDocument);

      const res = await fetch(
        `${BACKEND_URL}/documents/${user.id}/${encodedFilename}`,
        {
          method: "DELETE",
        }
      );

      if (res.ok) {
        setActiveConversationId("");
        setHistory([]);
        setQuestion("");
        setAnswer("");
        setDisplayedAnswer("");
        setShareLink("");

        const docs = await fetchDocuments();
        const remainingDocs = (docs || []).filter(
          (d: DocumentItem) => d.filename !== deletedDocument
        );

        await fetchConversations(searchText || undefined, false);

        if (remainingDocs.length > 0) {
          setSelectedDocument(remainingDocs[0].filename);
        } else {
          setSelectedDocument("");
          setConversations([]);
          setHistory([]);
        }
      }
    } catch (error) {
      console.error("Failed to delete document:", error);
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

  if (sharedView) {
    return (
      <main className="min-h-screen bg-[#f7f7f8] text-gray-900">
        <div className="mx-auto max-w-4xl px-6 py-10">
          <div className="mb-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h1 className="text-2xl font-bold">{sharedTitle}</h1>
            <p className="mt-2 text-sm text-gray-500">Shared conversation</p>
            {selectedDocument && (
              <p className="mt-1 text-sm text-gray-500">File: {selectedDocument}</p>
            )}
          </div>

          <div className="space-y-6">
            {sortedHistory.map((item, index) => (
              <div key={item.id || `${item.question}-${index}`} className="space-y-4">
                <div className="flex justify-end">
                  <div className="max-w-[75%] rounded-3xl bg-black px-5 py-4 text-white">
                    <p className="whitespace-pre-wrap text-sm leading-6">
                      {item.question}
                    </p>
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
                      {item.created_at && <span>{formatDate(item.created_at)}</span>}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    );
  }

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
            <aside className="flex w-[320px] flex-col border-r border-gray-200 bg-white p-3">
              <div className="mb-3">
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

                {message && <p className="mt-3 text-xs text-gray-600">{message}</p>}
              </div>

              <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
                <label className="mb-2 block text-sm font-medium text-gray-800">
                  Current document for new chat
                </label>
                <select
                  value={selectedDocument}
                  onChange={(e) => handleDocumentChange(e.target.value)}
                  className="mb-3 w-full rounded-lg border border-gray-200 bg-white p-2.5 text-xs text-gray-900"
                >
                  {sortedDocuments.length === 0 ? (
                    <option value="">No documents uploaded</option>
                  ) : (
                    <>
                      <option value="">Select a document</option>
                      {sortedDocuments.map((doc, index) => (
                        <option
                          key={doc.id || `${doc.filename}-${index}`}
                          value={doc.filename}
                        >
                          {doc.filename}
                        </option>
                      ))}
                    </>
                  )}
                </select>

                <div className="flex gap-2">
                  <button
                    onClick={handleDeleteDocument}
                    disabled={!selectedDocument}
                    className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    Delete document
                  </button>
                </div>
              </div>

              <div className="mb-3">
                <input
                  type="text"
                  placeholder="Search chats..."
                  value={searchText}
                  onChange={async (e) => {
                    const value = e.target.value;
                    setSearchText(value);
                    await fetchConversations(value || undefined, false);
                  }}
                  className="w-full rounded-lg border border-gray-200 bg-white p-2.5 text-sm text-gray-900 outline-none"
                />
              </div>

              <div className="mb-2 text-sm font-medium text-gray-800">All chats</div>

              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                {sortedConversations.length === 0 ? (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-500">
                    No chats yet
                  </div>
                ) : (
                  sortedConversations.map((conversation) => (
                    <div
                      key={conversation.id}
                      className={`rounded-xl border p-3 transition ${
                        activeConversationId === conversation.id
                          ? "border-black bg-black text-white"
                          : "border-gray-200 bg-white hover:bg-gray-50"
                      }`}
                    >
                      {renamingConversationId === conversation.id ? (
                        <div className="space-y-2">
                          <input
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            className="w-full rounded-lg border border-gray-300 bg-white p-2 text-sm text-black outline-none"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleRenameConversation(conversation.id)}
                              className="rounded-lg bg-white px-2 py-1 text-xs text-black"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => {
                                setRenamingConversationId("");
                                setRenameValue("");
                              }}
                              className="rounded-lg bg-white px-2 py-1 text-xs text-black"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => handleSelectConversation(conversation)}
                            className="w-full text-left"
                          >
                            <p className="truncate text-sm font-medium">
                              {conversation.title || "New Chat"}
                            </p>
                            <p
                              className={`mt-1 truncate text-[11px] ${
                                activeConversationId === conversation.id
                                  ? "text-gray-300"
                                  : "text-gray-500"
                              }`}
                            >
                              {conversation.filename || "No document selected"}
                            </p>
                          </button>

                          <div className="mt-2 flex flex-wrap gap-2">
                            <button
                              onClick={() => {
                                setRenamingConversationId(conversation.id);
                                setRenameValue(conversation.title || "");
                              }}
                              className={`text-[11px] ${
                                activeConversationId === conversation.id
                                  ? "text-gray-300 hover:text-white"
                                  : "text-gray-500 hover:text-black"
                              }`}
                            >
                              Rename
                            </button>

                            <button
                              onClick={() => handleShareConversation(conversation.id)}
                              className={`text-[11px] ${
                                activeConversationId === conversation.id
                                  ? "text-gray-300 hover:text-white"
                                  : "text-gray-500 hover:text-black"
                              }`}
                            >
                              Share
                            </button>

                            <button
                              onClick={() => handleDeleteConversation(conversation.id)}
                              className={`text-[11px] ${
                                activeConversationId === conversation.id
                                  ? "text-gray-300 hover:text-white"
                                  : "text-gray-500 hover:text-black"
                              }`}
                            >
                              Delete
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))
                )}
              </div>

              <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
                <button
                  onClick={() => setShowInsights((prev) => !prev)}
                  className="flex w-full items-center justify-between text-sm font-medium text-gray-800"
                >
                  <span>Document Insights</span>
                  <span>{showInsights ? "Hide" : "Show"}</span>
                </button>

                {showInsights && (
                  <div className="mt-3">
                    {!selectedDocumentMeta ? (
                      <p className="text-xs text-gray-500">
                        Select a document to see insights.
                      </p>
                    ) : (
                      <div className="space-y-3 text-xs">
                        <div>
                          <div className="font-medium text-gray-700">Document Type</div>
                          <div className="mt-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-gray-900">
                            {selectedDocumentMeta.document_type || "Not available"}
                          </div>
                        </div>

                        <div>
                          <div className="font-medium text-gray-700">Extracted Data</div>
                          <div className="mt-1 rounded-lg border border-gray-200 bg-white p-3">
                            {extractedEntries.length === 0 ? (
                              <div className="text-gray-500">
                                No extracted fields available.
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {extractedEntries.map(([key, value]) => (
                                  <div
                                    key={key}
                                    className="border-b border-gray-100 pb-2 last:border-b-0 last:pb-0"
                                  >
                                    <div className="font-medium text-gray-700">
                                      {formatFieldLabel(key)}
                                    </div>
                                    <div className="mt-1 whitespace-pre-wrap text-gray-900">
                                      {renderFieldValue(value)}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
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
              <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-6">
                {shareLink && (
                  <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700">
                    Share link copied:
                    <div className="mt-2 break-all text-xs text-gray-500">
                      {shareLink}
                    </div>
                  </div>
                )}

                {sortedHistory.length === 0 && !loading && !displayedAnswer && (
                  <div className="mt-20 text-center">
                    <h2 className="mb-3 text-4xl font-semibold text-gray-900">
                      Ask your document anything
                    </h2>
                    <p className="text-gray-500">
                      {selectedDocument
                        ? activeConversationId
                          ? "This conversation is empty. Ask your first question."
                          : "Choose New chat to start with the selected document, or open any previous chat from the sidebar."
                        : "Select a document for a new chat, or open a previous chat from the sidebar."}
                    </p>
                  </div>
                )}

                {sortedHistory.map((item, index) => (
                  <div key={item.id || `${item.question}-${index}`} className="space-y-4">
                    <div className="flex justify-end">
                      <div className="max-w-[75%] rounded-3xl bg-black px-5 py-4 text-white">
                        <p className="whitespace-pre-wrap text-sm leading-6">
                          {item.question}
                        </p>
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

                {loading &&
                  sortedHistory.length > 0 &&
                  sortedHistory[sortedHistory.length - 1].answer === "" && (
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
                  )}

                <div ref={chatEndRef} />
              </div>
            </div>

            <div className="border-t border-gray-200 bg-white px-4 py-4">
              <div className="mx-auto w-full max-w-5xl">
                <div className="rounded-3xl border border-gray-200 bg-white p-3 shadow-sm">
                  <textarea
                    ref={inputRef}
                    placeholder="Message your document..."
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (!loading) handleAsk();
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
                      disabled={loading || !question.trim() || !selectedDocument}
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