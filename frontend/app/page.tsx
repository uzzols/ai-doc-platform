"use client";

import { useState } from "react";
import {
  SignInButton,
  SignUpButton,
  UserButton,
  useUser,
} from "@clerk/nextjs";

export default function Home() {
  const { isSignedIn } = useUser();

  const [file, setFile] = useState<File | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");

  const API_URL = process.env.NEXT_PUBLIC_API_URL;

  // Upload file
  const handleUpload = async () => {
    if (!file) return;

    setLoading(true);
    setUploadMessage("");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`${API_URL}/upload`, {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        setUploadMessage("Upload successful ✅");
      } else {
        setUploadMessage("Upload failed ❌");
      }
    } catch (error) {
      setUploadMessage("Error uploading file ❌");
    }

    setLoading(false);
  };

  // Ask AI
  const handleAsk = async () => {
    if (!question) return;

    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/ask`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ question }),
      });

      const data = await res.json();
      setAnswer(data.answer);
    } catch (error) {
      setAnswer("Error getting answer ❌");
    }

    setLoading(false);
  };

  return (
    <div style={{ padding: "30px", maxWidth: "800px", margin: "auto" }}>
      
      {/* 🔐 HEADER */}
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        {!isSignedIn ? (
          <div style={{ display: "flex", gap: "10px" }}>
            <SignInButton />
            <SignUpButton />
          </div>
        ) : (
          <UserButton />
        )}
      </div>

      <h1>AI Document Platform</h1>

      {!isSignedIn ? (
        <p>Please sign in to use the app 🔐</p>
      ) : (
        <>
          {/* 📂 Upload */}
          <h2>1. Upload File</h2>
          <input
            type="file"
            accept=".pdf,.csv,.txt,.docx"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />

          <br /><br />

          <button onClick={handleUpload}>
            {loading ? "Uploading..." : "Upload File"}
          </button>

          <p>{uploadMessage}</p>

          {/* 💬 Ask AI */}
          <h2>2. Ask AI</h2>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a question..."
            style={{ width: "100%", height: "100px" }}
          />

          <br /><br />

          <button onClick={handleAsk}>
            {loading ? "Thinking..." : "Ask AI"}
          </button>

          <h3>Answer:</h3>
          <p>{answer}</p>
        </>
      )}
    </div>
  );
}