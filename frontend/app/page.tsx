"use client";

import { useState } from "react";
import Link from "next/link";
import { useUser, UserButton } from "@clerk/nextjs";

export default function Home() {
  const { isSignedIn, user } = useUser();

  const [file, setFile] = useState<File | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const BACKEND_URL = "https://ai-doc-platform-24cv.onrender.com";

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
      setLoading(true);
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
    } catch (err) {
      setMessage("❌ Upload failed");
    } finally {
      setLoading(false);
    }
  };

  const handleAsk = async () => {
    if (!question) {
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
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setAnswer(data.detail || data.error || "❌ Error getting response");
        return;
      }

      setAnswer(data.answer || "No response");
    } catch (err) {
      setAnswer("❌ Error getting response");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold">AI Document Platform</h1>
          <p className="text-gray-600 mt-1">
            Upload documents and ask AI questions
          </p>
        </div>

        <div className="flex items-center gap-3">
          {!isSignedIn ? (
            <>
              <Link
                href="/sign-in"
                className="px-4 py-2 border rounded-lg bg-white hover:bg-gray-100"
              >
                Sign In
              </Link>

              <Link
                href="/sign-up"
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Sign Up
              </Link>
            </>
          ) : (
            <UserButton />
          )}
        </div>
      </div>

      <div className="bg-white p-4 rounded-xl shadow mb-6">
        <p className="text-gray-700">
          Backend status: <span className="text-green-600">Connected ✅</span>
        </p>
        <p className="text-sm text-gray-500 mt-1">
          Supports PDF, CSV, TXT, DOCX files
        </p>
      </div>

      {!isSignedIn ? (
        <div className="bg-white p-6 rounded-xl shadow text-center">
          <h2 className="text-xl font-semibold mb-2">
            Sign in to use the app 🔐
          </h2>
          <p className="text-gray-600 mb-4">
            Please sign in or create an account to upload files and ask AI
            questions.
          </p>

          <div className="flex justify-center gap-4">
            <Link
              href="/sign-in"
              className="px-4 py-2 border rounded-lg bg-white hover:bg-gray-100"
            >
              Sign In
            </Link>

            <Link
              href="/sign-up"
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Sign Up
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="bg-white p-6 rounded-xl shadow mb-6">
            <h2 className="text-lg font-semibold mb-3">1. Upload File</h2>

            <input
              type="file"
              accept=".pdf,.csv,.txt,.docx"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="mb-3"
            />

            <div className="flex gap-3">
              <button
                onClick={handleUpload}
                disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                {loading ? "Uploading..." : "Upload Document"}
              </button>

              <button
                onClick={() => {
                  setFile(null);
                  setMessage("");
                }}
                className="px-4 py-2 border rounded-lg bg-white hover:bg-gray-100"
              >
                Clear
              </button>
            </div>

            {message && <p className="mt-3 text-sm text-gray-700">{message}</p>}
          </div>

          <div className="bg-white p-6 rounded-xl shadow">
            <h2 className="text-lg font-semibold mb-3">2. Ask AI</h2>

            <textarea
              placeholder="Ask a question about the uploaded file..."
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              className="w-full border rounded-lg p-3 mb-3"
            />

            <button
              onClick={handleAsk}
              disabled={loading}
              className="px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800"
            >
              {loading ? "Thinking..." : "Ask AI"}
            </button>

            {answer && (
              <div className="mt-4 p-4 bg-gray-100 rounded-lg">
                <strong>Answer:</strong>
                <p className="mt-2 whitespace-pre-wrap">{answer}</p>
              </div>
            )}
          </div>
        </>
      )}
    </main>
  );
}